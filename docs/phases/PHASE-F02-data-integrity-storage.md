# Phase F02 — Intégrité du Stockage, Anti-Écrasement & Vérité des Données

## 1. Contexte & Problématique
L'audit post-Phase 12 a identifié des comportements à haut risque pour l'intégrité et la véracité des données :
1. **Écrasement destructif de la base locale (S0-1) :** `DurableFileDatabaseAdapter` réinitialise l'état à vide et l'enregistre sur disque si une erreur survient au chargement JSON, détruisant le fichier de données sans copie de sauvegarde. De plus, les erreurs d'écriture (`fs.writeFileSync`) sont capturées sans exception.
2. **Coercition silencieuse des soldes de portefeuille (S0-5) :** `SyncService.executeSyncCharacterWallet` convertit toute réponse non numérique ou nulle en `0 ISK` via `Number(res.data) || 0`, créant de fausses observations à zéro.
3. **Fuite d'isolation multi-personnages dans getTimeSeries (S1-3) :** `AnalyticsService.getTimeSeries` évalue la fraîcheur en dumpant tous les états de synchronisation de la base sans isoler par personnage, et interprète les statuts `PARTIAL` et `SYNCING` comme `FRESH`.
4. **Calcul de fraîcheur globale tronqué (S2-2) :** `getFullStatus` ne consulte que les transactions et les ordres pour qualifier l'état d'un personnage, ignorant l'état des actifs, du journal et des soldes.

## 2. Objectifs & Périmètre
- Sécuriser `DurableFileDatabaseAdapter` avec un mécanisme de sauvegarde préalable (`.corrupt.bak-[timestamp]`) avant toute tentative d'initialisation propre, et propager les erreurs d'E/S critiques.
- Rendre la validation des soldes de portefeuille stricte : rejeter les payloads non numériques ou nuls avec un statut `ERROR`, sans jamais enregistrer 0 ISK par défaut.
- Isoler rigoureusement les métriques et statuts de fraîcheur dans `AnalyticsService` pour le seul sous-ensemble des `characterIds` autorisés/demandés.
- Étendre `getFullStatus` pour intégrer l'ensemble des 5 flux primaires dans l'évaluation de la fraîcheur globale.

## 3. Fichiers & Modules Concernés
- `src/server/storage/database.ts`
- `src/server/sync/service.ts`
- `src/server/analytics/service.ts`
- `src/server/sync/repository.ts`
- `src/server/capital/service.ts`
- Tests associés : `src/server/storage/storage.test.ts`, `src/server/storage/backup.test.ts`, `src/server/analytics/analytics.test.ts`

## 4. Modifications Conceptuelles & Règles Techniques
1. **Politique Anti-Perte de Fichier :**
   Si `fs.readFileSync` ou `JSON.parse` échoue, le fichier corrompu doit être immédiatement renommé en `[path].corrupt.[timestamp].bak`. Une exception explicite doit être levée ou une alerte système critique enregistrée, sans écrasement aveugle du fichier principal.
2. **Règle Fondamentale des Données Invalides :**
   Une valeur manquante, `null`, ou non convertible en nombre fini est `UNKNOWN` ou `ERROR`. Elle ne doit jamais être convertie en `0`.
3. **Fraîcheur Contextuelle & Multi-Tenant :**
   Le calcul de `freshness_status` dans `getTimeSeries` et `getFullStatus` doit filtrer exclusivement sur les clés correspondant au personnage demandé. Si un flux est `SYNCING` ou `PARTIAL`, la fraîcheur globale doit refléter cet état transitoire ou partiel.

## 5. Tests Obligatoires & Scénarios de Validation
- [x] Test d'intégrité de stockage : simuler un fichier JSON tronqué et vérifier que le fichier corrompu est conservé sous forme de sauvegarde d'archive et non écrasé.
- [x] Test de persistance d'E/S : vérifier que si le disque est plein ou protégé en écriture, `persist()` lève une exception claire.
- [x] Test de validation de solde : simuler une réponse ESI renvoyant `null`, `undefined`, `"string"` ou `{}` et vérifier que la synchronisation produit un statut `ERROR` et qu'aucun snapshot à 0 ISK n'est inséré.
- [x] Test d'isolation multi-personnages : vérifier que l'erreur de synchronisation du Personnage B n'altère pas le statut de fraîcheur `FRESH` du Personnage A dans `getTimeSeries`.

## 6. Critères d'Entrée & de Sortie
- **Entrée :** Validation et merge de la Phase F01. Branche dédiée `feature/F02-data-integrity-storage`.
- **Sortie :**
  - Aucun mécanisme d'auto-écrasement sans sauvegarde résiduelle.
  - Zero coercition implicite à zéro sur les soldes et métriques.
  - Isolation multi-personnages prouvée par les tests.
  - CI verte et mise à jour de `docs/CODE_INDEX.md`.
