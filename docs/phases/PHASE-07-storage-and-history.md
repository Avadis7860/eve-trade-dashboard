# PHASE-07 — Durabilité du stockage et historique fiable

**Type :** socle technique & persistance · **Dépendances :** 00–06, H01–H02 · **État :** Planifiée

---

## 1. Problème utilisateur & Résultat attendu

- **Problème** : Actuellement, l'application stocke les transactions, ordres, actifs et allocations en mémoire vive (`InMemory*Repository`). Bien qu'un mécanisme d'export/restauration JSON existe (`backupService.ts`), un redémarrage du serveur ou une fin de session conteneur Cloud Run sans export préalable efface les données synchronisées et les réconciliations de l'utilisateur.
- **Résultat attendu** : Une couche de persistance durable (base de données embarquée ou adaptateur de stockage persistant) garantissant la survie des données après redémarrage, l'intégrité référentielle, des temps de réponse constants même avec plusieurs dizaines de milliers de transactions, et l'idempotence stricte des synchronisations successives.

---

## 2. Dépendances exactes

- Modules amont : `src/server/storage/backupService.ts`, `src/server/sync/repository.ts`, `src/server/ledger/repository.ts`, `src/server/orders/repository.ts`, `src/server/roi/repository.ts`, `src/server/assets/repository.ts`.
- Contrats : `docs/DOMAIN_CONTRACTS.md`, `docs/ARCHITECTURE.md`.

---

## 3. Périmètre inclus & Exclusions explicites

### Inclus
- Mise en place de la couche de persistance PostgreSQL avec schéma relationnel versionné et transactions atomiques (ACID).
- Schéma relationnel versionné pour : transactions, écritures de journal, snapshots d'ordres, actifs physiques, hubs, associations d'emplacements, allocations de coûts, états de synchronisation.
- Support de l'adaptateur PostgreSQL avec fallback mémoire/fichier pour les tests unitaires locaux isolés sans dépendance externe.
- Migration automatique des données existantes depuis le format de sauvegarde JSON existant (`schemaVersion: 1`).
- Mécanisme de vidage/purge sélectif par personnage avec conservation de l'intégrité.
- Indexation optimisée sur `character_id`, `type_id`, `location_id`, `date` et clés composites de déduplication.

### Exclusions
- Aucune modification de l'interface utilisateur ou des routes ESI dans cette phase.

---

## 4. Contrats de données & Schémas

- **Transactions** : Déduplication stricte sur `(character_id, transaction_id)`.
- **Journal de portefeuille** : Déduplication stricte sur `(character_id, journal_id)`.
- **Snapshots d'ordres** : Historisation par `(character_id, order_id, last_observed_at)`.
- **Actifs physiques** : Snapshot idempotent des actifs ESI par `(character_id, item_id)`.
- **Allocations de coûts** : Clé unique `allocation_id`, relations vers `buy_transaction_id` et `sell_transaction_id`.

---

## 5. Étapes de réalisation

1. **Abstraction de la persistance** : Définition des interfaces de dépôts durables respectant les contrats TypeScript existants.
2. **Schéma & Migrations** : Création du schéma de tables et du moteur de migration versionné.
3. **Implémentation des dépôts durables** : Remplacement progressif des Maps mémoire par les opérations de stockage persistant.
4. **Migration & Sauvegarde** : Adaptation de `backupService.ts` pour exporter et importer directement depuis la couche persistante avec vérification de checksum SHA-256.
5. **Tests de résistance & Concurrence** : Tests d'écriture concurrente, d'arrêt brutal (crash recovery) et d'idempotence de synchronisation massive.

---

## 6. Critères d'acceptation mesurables

- [ ] Toutes les données (transactions, journal, ordres, actifs, allocations, hubs) survivent à un redémarrage complet du processus serveur sans nécessiter de restauration manuelle.
- [ ] L'import d'une sauvegarde `AppBackupSnapshot` v1 restaure fidèlement 100% des enregistrements et allocations.
- [ ] Une synchronisation ESI répétée 5 fois sur le même historique n'ajoute aucun doublon et ne modifie aucun checksum d'intégrité.
- [ ] Temps de requête sur 50 000 transactions inférieur à 50 ms pour les filtres usuels (par personnage, type, date).
- [ ] Suite de tests complète (`vitest run`) au vert, linting et typecheck stricts validés.

---

## 7. Gestion des erreurs & Données partielles

- En cas d'échec de transaction disque, un rollback complet est opéré sans corruption de l'état existant.
- Les états `UNKNOWN`, `PARTIAL`, `ERROR` et `ABSENT` restent stockés et restitués sans conversion en valeur nulle ou 0.

---

## 8. Définition de Terminé

Code réel implémenté + tests de persistance/migration au vert + CI verte + mise à jour de `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md`.
