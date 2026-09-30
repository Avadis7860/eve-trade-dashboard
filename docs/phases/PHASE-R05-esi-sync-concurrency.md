# Phase R05 — Synchronisation ESI et concurrence contrôlée

## Objectif
Réduire significativement la durée globale de synchronisation des comptes et personnages EVE Online sans jamais dépasser les quotas de débit de l'ESI CCP, en introduisant un parallélisme maîtrisé à concurrence bornée, en fusionnant les synchronisations concurrentes redondantes et en tirant pleinement parti du cache conditionnel HTTP (`ETag`, `304 Not Modified`).

## Problèmes traités
- `syncAll()` dans `SyncService` exécute la synchronisation de toutes les ressources de manière strictement séquentielle (`transactions` puis `journal` puis `orders` puis `orders_history` puis `assets` puis `corporation_assets`), allongeant considérablement le temps d'attente utilisateur.
- Lors de configurations multi-personnages, les synchronisations sont également enchaînées séquentiellement sans parallélisation des requêtes indépendantes.
- Deux clics rapides sur le bouton "Synchroniser" ou deux sessions concurrentes pour le même personnage déclenchent deux processus de synchronisation concurrents qui interfèrent sur les mêmes tables.
- Re-téléchargement et ré-analyse de pages ESI qui n'ont pas changé depuis la dernière exécution.

## Constats vérifiés
- `src/server/sync/service.ts` : `syncAll()` contient une succession de `await this.syncWalletTransactions(...)`, `await this.syncWalletJournal(...)`, etc.
- `src/server/esi/rateLimiter.ts` : Limiteur de débit robuste existant (gestion du budget d'erreur ESI, suspension sur 420/429, respect `Retry-After`), mais sous-exploité par la séquence monolithique de synchronisation.
- `src/server/esi/cache.ts` : Cache ESI présent mais les flux paginés `fetchFromId` ne réutilisent pas systématiquement les `ETag` sur les pages immuables anciennes.

## Périmètre inclus
- **Comparaison et sélection de l'architecture de synchronisation :**
  - *Option 1 — Séquentielle pure (Actuelle) :* Sûre mais lente (latence additive).
  - *Option 2 — `Promise.all` sans contrôle :* Dangereuse (risque immédiat de saturation de rate limit ESI, ban 420/429).
  - *Option 3 — Pool de concurrence borné avec file de tâches globale (Retenue) :* Un nombre fixe de workers (ex: 4 à 8 workers simultanés) consomment les tâches de synchronisation sous la garde stricte du `RateLimiter` centralisé.
- **Ordonnancement par ressource et dépendances :**
  - **Ressources indépendantes (Parallélisables) :** Ordres de marché (`orders`), Actifs physiques (`assets`), Journal du portefeuille (`wallet_journal`), Transactions de vente (`wallet_transactions`).
  - **Ressources dépendantes (Ordonnancées) :** La réconciliation FIFO (`runAutoFifoReconciliation`) et l'enrichissement des stocks d'ordres (`inStockQuantity`) ne s'exécutent QU'APRÈS la finalisation conjointe des transactions, du journal et des actifs.
- **Dédoublonnement / Fusion des synchronisations en vol (Request In-Flight Merging) :**
  - Si une synchronisation pour `(characterId, 'wallet_transactions')` est déjà en cours d'exécution, tout nouvel appel s'abonne à la Promise existante sans relancer un second flux ESI concurrent.
- **Optimisation du cache conditionnel ESI :**
  - Envoi systématique de l'entête `If-None-Match` avec l'ETag de la dernière observation.
  - Gestion optimisée du code `304 Not Modified` : saut immédiat de la page sans re-parsing des données.

## Périmètre exclu
- Pas d'introduction d'un broker de messages externe (Redis / RabbitMQ). La file de concurrence est gérée au sein du processus serveur avec ordonnanceur TypeScript asynchrone et mémoire bornée.
- Aucune modification des scopes OAuth ESI.

## Pré-requis
- Phase R01 terminée (stockage persistant capable de supporter les écritures concurrentes).
- Phase R02 terminée (pagination et statuts certifiés).

## Architecture cible
```
                           Demande de Synchronisation
                                       │
                                       ▼
                   ┌───────────────────────────────────────┐
                   │     Sync Coordinator & Task Queue     │
                   │ - Fusion des requêtes en vol          │
                   │ - Graphe de dépendances de ressources │
                   └───────────────────┬───────────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
       [Worker Pool (4 max)]                         [Worker Pool (4 max)]
       Personnage A (Transactions)                   Personnage B (Actifs)
                │                                             │
                └──────────────────────┬──────────────────────┘
                                       ▼
                   ┌───────────────────────────────────────┐
                   │    Centralized ESI Rate Limiter       │
                   │ (Tokens, Error Limit, 420/429 guard)  │
                   └───────────────────┬───────────────────┘
                                       ▼
                            Serveurs ESI CCP
```

## Travaux attendus
1. **Implémenter le coordinateur de synchronisation (`SyncCoordinator`) :** Gérer la file de tâches asynchrone avec concurrence bornée paramétrable (`CONCURRENCY_LIMIT = 4`).
2. **Implémenter le verrou d'unicité de synchronisation par personnage :** Éviter l'exécution simultanée de deux tâches identiques pour un même personnage.
3. **Paralléliser les collectes indépendantes :** Lancer en parallèle les requêtes `transactions`, `journal`, `orders`, `assets` pour un même personnage ou pour des personnages distincts.
4. **Enchaîner la phase de post-traitement analytique :** Déclencher la réconciliation FIFO et le calcul des positions de capital uniquement lorsque l'ensemble des dépendances a atteint l'état `COMPLETE` ou `PARTIAL`.

## Tests obligatoires
- Test de concurrence ESI : Lancer la synchronisation simultanée de 3 personnages avec 4 ressources chacun ; vérifier qu'aucun dépassement de quota ESI ne survient et que le rate limiter régule le flux.
- Test de déduplication : Lancer 5 appels `syncWalletTransactions(charId)` en parallèle ; vérifier qu'un seul appel réseau ESI effectif est émis et que les 5 promesses se résolvent avec le même résultat.
- Test de résilience 420/429 : Simuler une réponse HTTP 420 avec `Retry-After: 5` ; vérifier que tous les workers se mettent en pause et reprennent automatiquement après 5 secondes sans perte de données.

## Mesures de performance
- Réduction de la durée totale de synchronisation complète d'un personnage de ~60% par rapport à l'exécution séquentielle.
- Consommation stricte de 0 requête réseau ESI lors de requêtes retournant `304 Not Modified`.

## Risques de régression
- Risque d'interblocage (*deadlock*) dans la file de tâches : mitigation par des timeouts de sécurité stricts sur chaque tâche et tests de saturation.

## Critères d’entrée
- Phase R01 et R02 validées.

## Critères de sortie
- Les ressources indépendantes synchronisent en parallèle sous contrôle strict du limiteur de débit.
- Deux synchronisations concurrentes sur un même personnage sont fusionnées sans interférence en base.
- Les gains de durée de synchronisation sont validés par benchmark.

## Preuves attendues
- Graphique ou journal comparatif de durée de synchronisation (Séquentiel vs Pool concurrent).
- Logs de passage des tests simulant des limitations de débit et des erreurs 420.

## Dépendances vers les autres phases
- **Bloque :** Phase R7 (Tests complets), Phase R8 (Observabilité).
- **Dépend de :** Phase R01, Phase R02.

## Definition of Done
Pool de concurrence borné en service + fusion des requêtes en vol active + respect absolu des quotas ESI validé + tests de résilience au vert.
