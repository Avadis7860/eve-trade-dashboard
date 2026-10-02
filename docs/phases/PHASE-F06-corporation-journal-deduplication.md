# Phase F06 — Identité Canonique et Déduplication des Journaux de Corporation

## 1. Contexte et Problème Constaté

### 1.1 Origine de l'anomalie
Dans l'architecture multi-personnages d'EVE Trade Dashboard, un utilisateur peut connecter plusieurs personnages appartenant à la même corporation de jeu (par exemple deux directeurs de corporation ou un directeur et un comptable).

Actuellement, dans `src/server/sync/service.ts` (ligne 957), la clé primaire générée pour chaque entrée de journal de corporation est :
```typescript
id: `${characterId}:corp:${corpId}:${divisionNumber}:${raw.id}`
```
L'identifiant persisté en base inclut le `characterId` du personnage qui a effectué la synchronisation. Par conséquent :
- Lorsque le personnage A synchronise, l'entrée est enregistrée sous la clé `charA:corp:98830:1:789456`.
- Lorsque le personnage B synchronise la même corporation, la même opération économique EVE est enregistrée sous la clé `charB:corp:98830:1:789456`.

### 1.2 Preuves disponibles
- Analyse du code source dans `src/server/sync/service.ts` (lignes 956-977) et `src/server/ledger/repository.ts` (lignes 42, 80, 107-116).
- Observations task-55 : agrégation de totaux de commissions et taxes environ 10 fois supérieurs à la réalité financière lorsque plusieurs personnages synchronisent la même corporation.

### 1.3 Hypothèses à vérifier lors de l'implémentation
- L'unicité universelle de `raw.id` (l'identifiant de journal ESI CCP) au sein d'une corporation et d'une division données : dans l'API ESI CCP, l'ID de journal de wallet est strictement unique et séquentiel par division de wallet de corporation.

### 1.4 Conséquences métier
- Violation majeure d'intégrité comptable : le même flux financier (taxe ou commission) est comptabilisé autant de fois qu'il y a de personnages observateurs dans la base.
- Biais massif dans les rapports financiers agrégés du grand livre.

---

## 2. Objectifs

1. **Établir une identité canonique stable et déterministe** pour toutes les entrées de journal de corporation : `corp:${corporationId}:${division}:${journalId}`.
2. **Découpler l'identité de l'événement économique du personnage observateur** : conserver la traçabilité de l'observateur (`observedByCharacterId`), mais dédupliquer l'enregistrement persistant.
3. **Garantir l'idempotence stricte des écritures multi-personnages** dans `PersistentLedgerRepository` et `PostgresLedgerRepository`.
4. **Fournir un mécanisme de déduplication à la lecture et au stockage** pour assainir les doublons existants sans altérer les observations originales.

---

## 3. Périmètre

### 3.1 Éléments inclus
- Refactorisation du générateur d'identifiant et du contrat `CharacterWalletJournalEntry` dans `src/server/ledger/types.ts` et `src/server/sync/service.ts`.
- Mise à jour des index de stockage dans `PersistentLedgerRepository` (`src/server/ledger/repository.ts`) pour indexer les entrées de corporation par `corporationId` et `division` en plus de `characterId`.
- Gestion des requêtes de synthèse et filtres multi-personnages dans `getSummary()`, `getJournalEntries()`, et `getAllTransactions()`.
- Migration/normalisation transparente des clés de journal en mémoire et dans l'adaptateur de persistance.

### 3.2 Exclusions explicites
- Algorithme de réconciliation des taxes (réservé à **F07**).
- Modélisation des commissions de courtage (réservé à **F08**).
- Modification de la structure de la base SQL globale (déjà gérée ou alignée avec les types existants).

### 3.3 Limites
- Ne concerne que les journaux de corporation (`isCorporationWallet === true`). Les journaux personnels de personnages conservent leur clé canonique `char:${characterId}:${journalId}`.

---

## 4. État Technique Initial

- **Fichiers concernés :**
  - `src/server/ledger/types.ts`
  - `src/server/ledger/repository.ts`
  - `src/server/sync/service.ts`
- **Comportement actuel :**
  - Stockage à plat dans `this.journalEntries: Map<string, CharacterWalletJournalEntry>`.
  - Indexation secondaire `jnByCharacter: Map<number, Set<string>>` qui associe chaque entrée au seul `characterId` observateur.
  - Absence d'index `jnByCorporation: Map<number, Set<string>>`.

---

## 5. Architecture Cible et Stratégie

1. **Clé canonique universelle :**
   ```typescript
   export function makeJournalEntryKey(entry: {
     isCorporationWallet?: boolean;
     corporationId?: number;
     division?: number;
     characterId: number;
     journalId: number;
   }): string {
     if (entry.isCorporationWallet && entry.corporationId) {
       const div = entry.division ?? 1;
       return `corp:${entry.corporationId}:${div}:${entry.journalId}`;
     }
     return `char:${entry.characterId}:${entry.journalId}`;
   }
   ```
2. **Double indexation :**
   - Les entrées de corporation sont indexées dans un `jnByCorporation: Map<number, Set<string>>` (et `jnByCorpDivision`).
   - Lorsqu'une requête filtre par un `characterId`, le repository résout la corporation du personnage et consulte les entrées sans les dupliquer si plusieurs personnages partagent la même corporation.
3. **Idempotence des écritures :**
   Lorsqu'un second personnage synchronise une entrée de corporation déjà existante, l'opération effectue une mise à jour d'audit (`observedByCharacterId`, `lastObservedAt`) sans créer de nouvel élément (`inserted: 0, updated: 1`).

---

## 6. Plan d'Implémentation Ordonné

### Étape 1 : Normalisation du modèle de données et des clés d'identification
- Définir dans `src/server/ledger/types.ts` la fonction canonique de génération de clé `makeJournalEntryKey`.
- Ajouter le champ optionnel `observedByCharacterIds?: number[]` pour conserver la trace de tous les observateurs sans dupliquer l'enregistrement.

### Étape 2 : Adaptation de `PersistentLedgerRepository`
- Ajouter l'index secondaire `jnByCorporation` dans `PersistentLedgerRepository`.
- Modifier `saveJournalEntries` pour utiliser la clé canonique dédupliquée.
- Mettre à jour `getJournalEntries` et `getSummary` pour agréger les entrées de corporation une et une seule fois par périmètre.

### Étape 3 : Mise à jour de `SyncService.executeSyncCorporationWallets`
- Utiliser la nouvelle clé canonique lors de la transformation des données ESI brutes.

### Étape 4 : Tests d'isolation et d'idempotence multi-personnages
- Rédiger des tests simulant 2, 3 et 5 personnages synchronisant exactement le même jeu de journaux de corporation.

---

## 7. Matrice de Tests

| ID Test | Type | Description du Cas | Résultat Attendu |
|---|---|---|---|
| `TEST-F06-01` | Unitaire | Sauvegarde de la même entrée de corporation par 2 personnages distincts | `inserted: 1` pour le 1er perso, `updated: 1, inserted: 0` pour le 2nd. 1 seul enregistrement stocké. |
| `TEST-F06-02` | Unitaire | Agrégation du grand livre pour un compte avec 3 personnages de la même corporation | Le montant total des taxes de corporation est exactement égal au montant unitaire réel (pas x3). |
| `TEST-F06-03` | Unitaire | Sauvegarde de 2 entrées ayant le même `journalId` mais dans 2 divisions différentes de la même corporation | 2 enregistrements distincts `corp:98830:1:101` et `corp:98830:2:101`. |
| `TEST-F06-04` | Unitaire | Sauvegarde d'un journal personnel et d'un journal de corporation ayant le même `id` ESI | 2 enregistrements distincts `char:2124224223:500` et `corp:98830:1:500`. |
| `TEST-F06-05` | Intégration | Synchronisation ESI simultanée de 2 personnages avec corporation commune | Pas de collision, pas d'écrasement, `countJournalEntries` reflète le nombre d'événements uniques. |

---

## 8. Critères d'Entrée

- Phase F05 validée et complétée.
- Tests de synchronisation ESI au vert.
- Branche de travail : `feature/phase-f06-corp-journal-deduplication`.

---

## 9. Critères de Sortie

1. La clé primaire des entrées de journal de corporation ne contient plus l'identifiant du personnage observateur.
2. La synchronisation successive d'une même corporation par plusieurs personnages ne crée aucun doublon dans `PersistentLedgerRepository` ni dans les tables PostgreSQL.
3. Les totaux financiers de taxes et commissions restent rigoureusement constants quel que soit le nombre de personnages affiliés à la corporation.
4. Les tests `TEST-F06-01` à `TEST-F06-05` sont écrits, exécutés et validés avec succès.
5. `npm run test`, `npm run typecheck`, `npm run lint` et `npm run build` sont strictement au vert.

---

## 10. Risques et Retour Arrière

- **Risque :** Risque de divergence de clé lors de la lecture d'anciennes données persistées sans migration.
  - **Mitigation :** Fonction de normalisation lors du chargement initial `restoreData` pour migrer automatiquement les anciennes clés au format canonique.
- **Retour arrière :** Revert du commit de branche sans impact structurel sur les transactions.

---

## 11. Documentation à Mettre à Jour

- `docs/DOMAIN_CONTRACTS.md` : Mettre à jour la section sur l'identité canonique des événements de portefeuille de corporation.
- `docs/CODE_INDEX.md` : Mettre à jour `src/server/ledger/repository.ts`.

---

## 12. Statut

**Complétée** — Clé canonique universelle `corp:${corporationId}:${division}:${journalId}`, traçabilité multi-observateurs `observedByCharacterIds`, indexation `jnByCorporation`, idempotence stricte des écritures et invariance des totaux financiers validés par tests unitaires et intégration (TEST-F06-01 à TEST-F06-05).
