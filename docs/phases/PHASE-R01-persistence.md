# Phase R01 — Persistance et stockage durable

## Objectif
Rendre la stratégie de persistance relationnelle PostgreSQL réelle, robuste et transactionnelle pour l'ensemble des dépôts de l'application (`Ledger`, `Orders`, `Roi`, `Assets`, `Hubs`, `Sync`), en supprimant la dépendance aux `Map` en mémoire comme mécanisme principal et en éliminant les écritures bloquantes de l'adaptateur JSON.

## Problèmes traités
- Les dépôts métier (`PersistentLedgerRepository`, etc.) stockent les entités dans des `Map` mémoire privées et se contentent de synchroniser l'état global avec `DurableFileDatabaseAdapter`.
- `PostgresDatabaseAdapter` n'est pas utilisé par les repositories métier pour leurs opérations directes `SELECT`, `INSERT`, `UPDATE`, `DELETE`.
- `DurableFileDatabaseAdapter` réécrit l'intégralité du fichier `.data/eve_trade_store.json` de façon synchrone lors de chaque modification (`fs.writeFileSync`).
- En cas de redémarrage de conteneur, si le fichier JSON local n'a pas été exporté ou persiste sur un stockage éphémère, les données sont vulnérables.
- Les erreurs d'écriture disque ne sont pas toujours propagées comme exceptions transactionnelles vers les appelants.

## Constats vérifiés
- `src/server/storage/database.ts` : `PostgresDatabaseAdapter` implémente `query`, `execute`, `transaction`, mais les classes de dépôts (`src/server/ledger/repository.ts`) ne génèrent aucune requête SQL `SELECT/INSERT/UPDATE` et manipulent des `Map`.
- `src/server/storage/schema.ts` : Définit un schéma SQL relationnel avec clés primaires et index, mais ces tables restent inactives lors de l'exécution applicative normale.
- Le fichier `.data/eve_trade_store.json` pèse ~1 Mo et est lu en une passe `JSON.parse` au démarrage.

## Périmètre inclus
- **Implémentation concrète de dépôts SQL PostgreSQL :**
  - `PostgresLedgerRepository` implémentant `ILedgerRepository` avec requêtes SQL paramétrées et transactions ACID (`BEGIN`/`COMMIT`/`ROLLBACK`).
  - `PostgresOrdersRepository` implémentant `IOrdersRepository`.
  - `PostgresRoiRepository` implémentant `IRoiRepository`.
  - `PostgresAssetsRepository` implémentant `IAssetsRepository`.
  - `PostgresHubsRepository` implémentant `IHubsRepository`.
  - `PostgresSyncRepository` implémentant `ISyncRepository`.
- **Gestion des transactions et rollbacks :** Intégration de transactions SQL réelles pour les opérations multi-tables (ex: réconciliation FIFO groupée, purge de personnage, enregistrement synchronisation + entités).
- **Indexation relationnelle vérifiée :**
  - Index B-tree sur `transactions(character_id, date DESC)`.
  - Index B-tree sur `transactions(type_id)`.
  - Index B-tree sur `transactions(location_id)`.
  - Index B-tree sur `order_snapshots(character_id, state)`.
  - Index B-tree sur `explicit_cost_allocations(sell_transaction_id, buy_transaction_id)`.
  - Index composite de déduplication `(character_id, transaction_id)`.
- **Séparation stricte :** Dépôt PostgreSQL pour la production/staging et Dépôt Mémoire dédié exclusivement aux tests unitaires isolés ultra-rapides.
- **Démarrage & Migrations :** Exécution séquentielle et idempotente des migrations au démarrage du serveur avec table `schema_migrations`.
- **Isolation et purge :** Implémentation transactionnelle stricte de `clearCharacterData(characterId)` purgeant en cascade toutes les tables du personnage cible sans fuite de données inter-personnages.
- **Rôle du stockage fichier :** Définir formellement `DurableFileDatabaseAdapter` comme simple fallback de développement hors-ligne local, avec journalisation d'avertissement claire au démarrage.

## Périmètre exclu
- Aucune modification des contrats de synchronisation ESI (traités en R2 et R5).
- Aucune refonte des composants React (traitée en R3).

## Pré-requis
- Phase R00 terminée et baseline validée.
- Instance PostgreSQL de test et schéma SQL versionné `schema.ts`.

## Architecture cible
```
┌────────────────────────────────────────────────────────────┐
│                    Couche Service Métier                   │
│        (LedgerService, OrdersService, RoiService, etc.)    │
└─────────────────────────────┬──────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  Interface ILedgerRepository
                    │  (Contrats purs TypeScript)
                    └─────────┬─────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│   PostgresLedgerRepository    │   │    InMemoryLedgerRepository   │
│ (Production / Staging / CI)   │   │  (Tests unitaires isolés)     │
│ - Requêtes SQL paramétrées    │   │ - Collections Map locales     │
│ - Transactions ACID réelles   │   │ - Sans effet de bord          │
│ - Pool pg optimisé            │   │ - Exécution en < 1ms          │
└───────────────────────────────┘   └───────────────────────────────┘
```

## Travaux attendus
1. **Implémenter les repositories SQL réels :** Écrire les requêtes SQL paramétrées `$1, $2` pour l'ensemble des méthodes CRUD et de filtrage dans les dépôts PostgreSQL.
2. **Gestion de pool de connexions :** Configurer `pg.Pool` avec gestion des timeouts de connexion (`connectionTimeoutMillis`), idle timeouts et gestion d'erreurs sur client inactif.
3. **Tests d'idempotence et d'arrêt brutal (Crash Recovery) :** Valider que l'interruption d'une transaction SQL en cours ne laisse aucun état orphelin et restaure l'intégrité via `ROLLBACK`.
4. **Purge sélective :** Tester `clearCharacterData` en base SQL et vérifier l'absence d'effets de bord sur les autres personnages.

## Tests obligatoires
- Tests d'intégration sur instance PostgreSQL réelle :
  - Création de schéma et application des migrations versionnées.
  - Insertion de 50 000 transactions avec contraintes d'intégrité et clés étrangères.
  - Rollback complet en cas d'erreur de clé étrangère ou d'interruption simulée.
  - Test d'isolation stricte : le personnage B ne voit aucune transaction du personnage A.
- Conservation de l'ensemble des 149 tests Vitest unitaires existants exécutés sur `InMemoryRepository`.

## Mesures de performance
- Temps d'insertion par lot de 1 000 transactions en base SQL (< 100 ms).
- Temps d'exécution d'une transaction complexe de réconciliation FIFO multi-tables (< 50 ms).
- Mesure comparative de l'empreinte mémoire heap par rapport à la baseline R00.

## Risques de régression
- Divergence de comportement entre l'implémentation en mémoire (utilisée en tests) et l'implémentation PostgreSQL réelle : mitigation par une suite de tests de contrat partagée exécutée contre les deux adaptateurs.

## Critères d’entrée
- Phase R00 validée.
- Spécifications de schéma validées dans `schema.ts`.

## Critères de sortie
- 100% des repositories métier disposent d'une implémentation SQL PostgreSQL opérationnelle et couverte par des tests d'intégration.
- Aucune écriture bloquante `fs.writeFileSync` n'est invoquée sur le chemin critique de production.
- Les tests de contrat d'interfaces s'exécutent avec succès sur PostgreSQL et en mémoire.

## Preuves attendues
- Logs d'exécution des tests d'intégration PostgreSQL avec requêtes SQL réelles (`INSERT`, `SELECT`, `ROLLBACK`).
- Rapport de performance comparatif SQL vs Baseline R00.

## Dépendances vers les autres phases
- **Bloque :** Phase R2, R4, R5, R6, R7, R8.
- **Dépend de :** Phase R00.

## Definition of Done
Repositories PostgreSQL opérationnels + transactions ACID validées + tests d'intégration PostgreSQL au vert + tests unitaires au vert + code index mis à jour.
