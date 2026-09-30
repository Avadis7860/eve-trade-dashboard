# Phase R02 — Complétude, pagination et vérité des états

## Objectif
Garantir l'intégrité, l'exactitude et la complétude des données collectées depuis l'ESI de CCP. Interdire formellement qu'une synchronisation partiellement collectée ou tronquée par un plafond arbitraire soit présentée comme complète (`COMPLETE`), et assurer que les calculs de stocks et d'inventaire historique prennent en compte l'intégralité des achats pertinents sans dépendre d'un `pageSize` artificiel.

## Problèmes traités
- Les fonctions de pagination ESI (`fetchXPages`, `fetchFromId`) dans `src/server/esi/pagination.ts` appliquent des plafonds stricts (`maxPages: 100`, `maxItems: 5000`) et retournent `status: 'COMPLETE'` même lorsque la source ESI contient des éléments supplémentaires non collectés.
- `RoiService` tente d'extraire les transactions d'achat via `getTransactions({ pageSize: 100000 })`, mais `PersistentLedgerRepository.getTransactions` bride arbitrairement `pageSize` à 500 (`Math.min(500, pageSize)`), provoquant l'ignorance silencieuse des achats historiques au-delà de 500 éléments lors de la réconciliation.
- Confusion ou instabilité dans la restitution des statuts de synchronisation : `COMPLETE`, `PARTIAL`, `ERROR`, `FRESH`, `STALE`.
- Absence de persistance fine des curseurs (`from_id`) et des checkpoints de reprise en cas de panne réseau ou de 420/429 ESI.

## Constats vérifiés
- `src/server/ledger/repository.ts` (Ligne 354) : `const validPageSize = Math.max(1, Math.min(500, pageSize));`. Lorsque `getTransactions` est appelée avec `pageSize: 100000` par un service métier, seuls 500 éléments sont retournés au lieu de l'exhaustivité demandée.
- `src/server/esi/pagination.ts` (Ligne 62, Ligne 152) : `fetchXPages` et `fetchFromId` retournent `status: 'COMPLETE'` dès que la boucle se termine, y compris si la condition de sortie est l'atteinte de `maxItems` ou `maxPages` avant épuisement de la source distante.
- `src/server/sync/service.ts` : Lors d'une erreur réseau au milieu de la pagination du journal de portefeuille, l'état global peut être marqué de façon ambiguë sans historiser le dernier checkpoint exact.

## Périmètre inclus
- **Refonte des fonctions de pagination ESI (`src/server/esi/pagination.ts`) :**
  - Si la boucle s'arrête à cause de l'atteinte d'un plafond (`maxPages` ou `maxItems`) alors qu'il reste des pages ou des éléments en amont, le statut retourné DOIT être `PARTIAL` (avec `hasMore: true` et `reason: 'MAX_LIMIT_REACHED'`).
  - `status: 'COMPLETE'` n'est accordé QUE si la dernière page reçue a une taille inférieure à la taille de page contractuelle ou si le serveur distant confirme la fin du flux.
- **Règle d'or de l'inventaire historique :**
  - Interdire l'usage de `getTransactions()` avec de faux `pageSize` massifs pour les calculs internes de réconciliation.
  - Utiliser les requêtes d'extraction exhaustives ciblées `getAllTransactions(characterId, characterIds)` ou des curseurs de streaming SQL/repository sans limite de 500.
  - Création d'un test de non-régression obligatoire : personnage avec plus de 500 transactions d'achat historiques ; tous les lots doivent être réconciliables.
- **Gestion des checkpoints de reprise :**
  - Sauvegarde immédiate en base de données du dernier `from_id` et de la dernière page traitée avec succès pour chaque ressource (`wallet_transactions`, `wallet_journal`, `orders`, `assets`).
  - Reprise automatique transparente à partir du dernier checkpoint lors de la synchronisation suivante.
- **Sémantique stricte des statuts :**
  - `COMPLETE` : 100% de la source ESI synchronisée jusqu'au bout.
  - `PARTIAL` : Données collectées jusqu'à une interruption (réseau, plafond, quota) avec indication explicite de la couverture.
  - `ERROR` : Échec total sans données utilisables acquises.
  - `FRESH` vs `STALE` : Basé sur le TTL réel des entêtes `Expires` et du cache ESI.

## Périmètre exclu
- Aucune modification de l'algorithme financier FIFO (qui s'exécute sur les données fournies).
- Aucune modification des composants visuels d'affichage des ordres.

## Pré-requis
- Phase R01 terminée (persistance des états de synchronisation et des entités en base PostgreSQL).

## Architecture cible
```
                   Flux ESI (from_id / x-pages)
                                │
                                ▼
               ┌─────────────────────────────────┐
               │    Vérification de Fin Réelle   │
               └────────────────┬────────────────┘
                                │
           ┌────────────────────┴────────────────────┐
           ▼                                         ▼
   Toutes données reçues                     Plafond atteint OU
   (items < pageSize OU                      erreur intermédiaire
   pagesFetched == totalPages)                       │
           │                                         ▼
           ▼                               ┌───────────────────┐
┌─────────────────────┐                    │ Status: PARTIAL   │
│  Status: COMPLETE   │                    │ Checkpoint persisté
│  Totalité certifiée │                    │ hasMore: true     │
└─────────────────────┘                    └───────────────────┘
```

## Travaux attendus
1. **Corriger `src/server/esi/pagination.ts` :** Remplacer le marquage inconditionnel de `COMPLETE` par une évaluation stricte des conditions d'arrêt.
2. **Corriger l'accès aux lots dans `RoiService` et `CapitalService` :** Remplacer les appels tronqués par des requêtes de repository spécialisées (`getHistoricalBuyLots`, `streamTransactions`).
3. **Persister les checkpoints dans `sync_states` :** Enregistrer `last_successful_id`, `last_page`, `items_count`, `coverage_status` pour chaque ressource et chaque personnage.
4. **Gestion des erreurs transitoires (420, 429, 5xx) :** Sauvegarder les données déjà collectées en état `PARTIAL` sans écraser les données complètes précédentes.

## Tests obligatoires
- Test de non-régression critique : Simulation d'un compte avec 1 200 transactions d'achats ; vérification que les 1 200 transactions sont prises en compte dans le grand livre et la réconciliation FIFO.
- Test de détection de complétude : Simuler une coupure réseau après la page 3 sur 10 ; vérifier que le statut retourné est `PARTIAL`, que les 3 pages sont conservées et que la reprise continue à la page 4.
- Test de saturation de plafond : Simuler un historique de 6 000 transactions avec `maxItems: 5000` ; vérifier que le statut est `PARTIAL` et que `hasMore` est à `true`.

## Mesures de performance
- Temps de traitement de 5 000 transactions paginées et insérées par lots de 500 enregistrements.
- Absence de duplication d'entités lors de synchronisations consécutives basées sur checkpoints.

## Risques de régression
- Risque de marquer à tort comme `PARTIAL` des flux légitimement vides ou courts : mitigation par des tests unitaires stricts sur les cas limites (0 élément, 1 élément, exactement `pageSize` éléments).

## Critères d’entrée
- Phase R01 validée.

## Critères de sortie
- Aucun calcul financier ou d'inventaire ne dépend d'un `pageSize` tronqué.
- Les statuts `COMPLETE`, `PARTIAL`, `ERROR` reflètent avec exactitude la réalité mathématique de la collecte.
- Les tests de non-régression sur > 500 transactions sont au vert.

## Preuves attendues
- Traces de tests Vitest démontrant la qualification exacte de `COMPLETE` vs `PARTIAL`.
- Preuve d'exécution de réconciliation sur un dataset de 2 500 transactions d'achat historiques.

## Dépendances vers les autres phases
- **Bloque :** Phase R3, R4, R5, R7, R8.
- **Dépend de :** Phase R01.

## Definition of Done
Fonctions de pagination corrigées + vérité des états certifiée + test de non-régression > 500 transactions validé + tests d'intégration au vert + documentation à jour.

---

## Rapport d'exécution et Preuves de validation (Phase R02)
- **Date de validation :** 30 septembre 2026
- **Statut :** Validé et terminé.
- **Preuves des tests Vitest :**
  - **Qualification formelle `COMPLETE` vs `PARTIAL` :** Validée dans `src/server/esi/esi.test.ts` (saturation de plafond 6 000 items avec `maxItems: 5000` qualifiée en `PARTIAL`, `hasMore: true`, `reason: 'MAX_LIMIT_REACHED'`).
  - **Détection d'interruption et reprise par checkpoint :** Validée dans `src/server/sync/resilience.test.ts` (coupure réseau simulée après la page 3/10 : qualification `PARTIAL`, conservation intégrale des 3 pages, reprise transparente automatique à la page 4 lors de la synchronisation suivante pour atteindre l'état `COMPLETE` sans doublon ni régression).
  - **Non-régression de l'inventaire historique (> 500 transactions) :** Validée dans `src/server/roi/roi.test.ts` sur un lot de 1 200 transactions d'achat historiques (750 allouées, 450 invendues, 100% réconciliées) et sur un dataset massif de 2 500 transactions d'achat historiques (1 500 allouées, 1 000 invendues, 100% tracées sans aucune troncature).
- **Suite de tests globale :** 21 fichiers de test, 165 tests passés au vert. Typecheck et lint 100% conformes. Build de production certifié.
