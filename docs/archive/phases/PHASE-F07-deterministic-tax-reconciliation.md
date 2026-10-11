# Phase F07 — Rapprochement Fiscal Déterministe et Attribution Unique

## 1. Contexte et Problème Constaté

### 1.1 Origine de l'anomalie
Dans l'audit task-55, la somme des taxes enrichies des ventes calculée par le système (`sumEnrichedSellTax`) dépassait le montant total réel des taxes uniques prélevées dans les journaux de corporation (`uniqueCorpTax`).

L'inspection de `src/server/ledger/repository.ts` (méthode `getJournalEntriesForTransaction`, lignes 204-235) a révélé que la recherche de taxe utilise un algorithme sans état (stateless) avec un critère de repli (fallback heuristique) :
- Si aucun lien direct n'est trouvé, la fonction parcourt toutes les entrées de journal du personnage/corporation.
- Elle cherche une entrée de type `transaction_tax` avec `journalId` proche (±10) ou date proche (±3 000 ms) et un ratio de taxe compris entre 2% et 12%.
- Dès qu'une entrée satisfait cette condition, elle est sélectionnée immédiatement (`break;`) et attribuée à la transaction.
- Comme la méthode est appelée individuellement pour chaque vente sans retenir les attributions passées, **la même entrée `transaction_tax` est réattribuée à toutes les ventes simultanées ou rapprochées**.

De plus, l'observation fréquente de la relation séquentielle `taxJns.journalId = mktJn.journalId + 1` (la taxe ESI suit immédiatement l'événement de transaction de marché) est ignorée au profit d'un matching approximatif non ordonné.

### 1.2 Preuves disponibles
- Code `src/server/ledger/repository.ts` : absence de set d'exclusion des taxes déjà consommées.
- `break;` dans la boucle de matching à 3s qui réaffecte systématiquement la première entrée candidate.
- Données réelles task-55 démontrant un sur-comptage de taxes sur les séries de ventes rapprochées.

### 1.3 Hypothèses à vérifier lors de l'implémentation
- La constance de la relation `M + 1` sur les transactions ESI CCP : vérifier les cas limites (ventes sous citadelles Upwell, taxes fractionnées, transactions multi-items).

### 1.4 Conséquences métier
- Les taxes de vente déduites du chiffre d'affaires sont surévaluées, ce qui réduit artificiellement le bénéfice net calculé.
- Violation du principe fondamental d'audit comptable : une écriture fiscale source ne peut justifier qu'une seule transaction commerciale.

---

## 2. Objectifs

1. **Garantir l'attribution exclusive (1-to-1)** de chaque entrée fiscale `transaction_tax` à au plus une seule transaction de vente.
2. **Éliminer les rapprochements arbitraires** basés sur le « premier venu » dans une fenêtre temporelle floue.
3. **Exploiter de manière déterministe le pattern d'appariement ESI CCP séquentiel (`M + 1`)** et la corrélation stricte par montant/taux.
4. **Maintenir le statut `UNKNOWN` ou `PARTIAL`** lorsqu'une taxe ne peut pas être prouvée de manière irréfutable, sans inventer un montant de taxe nul ou approximatif.

---

## 3. Périmètre

### 3.1 Éléments inclus
- Refonte de la réconciliation fiscale dans `src/server/ledger/repository.ts` et création d'un service de réconciliation fiscale dédié `TaxReconciliationEngine`.
- Algorithme d'attribution en deux passes avec réservation d'unicité :
  - **Passe 1 (Exacte & Directe) :** Appariement par `context_id == transaction_id` ou lien direct de journal `journalRefId`.
  - **Passe 2 (Séquentielle CCP M+1) :** Appariement par succession directe d'identifiant de journal (`taxJns.journalId === mktJn.journalId + 1`) avec cohérence de date (même seconde) et cohérence arithmétique de taux.
  - **Passe 3 (Corrélation stricte sous contrainte d'unicité) :** Appariement sur reliquats avec vérification bidirectionnelle et rejet des cas ambigus (si 2 ventes matchent la même taxe sans départage certain, la taxe reste marquée `AMBIGUOUS` et non attribuée).
- Traçabilité complète du lien : stockage de l'identifiant exact de journal ayant servi de preuve.

### 3.2 Exclusions explicites
- Attribution des commissions de courtage `brokers_fee` (réservé à **F08**).
- Calcul global du bénéfice et des indicateurs de Cockpit (réservé à **F09**).

#### 3.3 Limites & Invariant d'Accumulation Historique (Au-delà du plafond ESI de 2 500 transactions)
- **Persistance et accumulation multi-annuelle :** L'API ESI CCP présente une fenêtre glissante limitée à 2 500 transactions et environ 30 jours de journal. L'application garantit une conservation **strictement cumulative et append-only** en base de données : aucune transaction passée n'est écrasée ou supprimée lors des cycles de synchronisation ultérieurs.
- **Support des volumes multi-mois / multi-années :** Le moteur de réconciliation et les index de stockage doivent être dimensionnés pour traiter efficacement des dizaines de milliers de transactions accumulées ($50\,000+$ items).
- **Complexité algorithmique maîtrisée :** La réconciliation s'opère de manière atomique et indexée à l'ingestion ($O(N \log N)$ lors des syncs), garantissant un accès instantané en $O(1)$ lors des lectures paginées et des rendus UI sans recalcul à la volée.
- **Absence d'extrapolation pour l'historique froid :** Si une vente ancienne accumulée en base est antérieure à la fenêtre de journal disponible lors de l'import initial, son statut est formellement classé `UNMATCHED` / `TAX_UNKNOWN`. Sa taxe est comptabilisée à 0 ISK dans le net provisoire tout en traçant explicitement l'incertitude dans `taxReconciliation.status`, sans inventer de taxe approximative.

---

## 4. État Technique Initial

- **Fichiers concernés :**
  - `src/server/ledger/repository.ts` (`getJournalEntriesForTransaction`, `enrichTransaction`, indexations secondaires)
  - `src/server/ledger/types.ts` (`CharacterTransaction`, `CharacterWalletJournalEntry`, `TaxReconciliationDetail`)
  - `src/server/roi/service.ts` (`getTransactionFees`)
  - `src/server/sync/service.ts` (déclenchement de la réconciliation à l'ingestion)
- **Comportement actuel :**
  - Traitement isolé, transaction par transaction, recalculé à chaque lecture unitaire ou paginée.
  - Matching heuristique non exclusif permettant le double comptage de la même taxe sur des ventes simultanées.
  - Risque de régression de performance et d'instabilité d'état si un reconciler stateful est invoqué à la volée.

---

## 5. Architecture Cible et Stratégie

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       TaxReconciliationEngine                           │
│                                                                         │
│ Ingestion/Batch -> Tri chronologique & Indexation atomique              │
│ Réservation exclusive (allocatedTaxJournalIds: Set<string>)             │
│                                                                         │
│ 1. Passe 1 : context_id == tx_id (Exact)                                │
│ 2. Passe 2 : tax.journal_id == tx.journal_ref_id + 1 (Séquentiel M+1)   │
│ 3. Passe 3 : Corrélation bijective sans ambiguïté                       │
│ 4. Tout candidat résiduel ambigu ou manquant -> Status: UNMATCHED       │
│                                                                         │
│ Lecture UI/API -> Accès instantané O(1) via données enrichies/indexées  │
└─────────────────────────────────────────────────────────────────────────┘
```

1. **Tableau de réconciliation avec réservation d'état et indexation :**
   Le moteur opère sur l'ensemble du lot synchronisé ou à réconcilier avec un ensemble de clés uniques `usedTaxJournalKeys = new Set<string>()`. Les résultats de réconciliation sont persistés ou mis en cache indexé.
2. **Explicabilité et preuve dans le contrat :**
   Chaque transaction enrichie comporte le détail :
   ```typescript
   export interface TaxReconciliationDetail {
     status: 'EXACT_MATCH' | 'SEQUENTIAL_M_PLUS_1' | 'CORRELATED_BIJECTIVE' | 'UNMATCHED' | 'AMBIGUOUS';
     matchedJournalId?: number;
     taxAmount: number;
     taxRate?: number;
     justification: string;
   }
   ```
3. **Invariance comptable & Non-régression :**
   - $\sum \text{Taxes attribuées aux ventes} \le \sum \text{Taxes uniques réelles du grand livre}$.
   - Rétrocompatibilité totale : `tax: number` (0 si UNMATCHED), `brokerFee: number`, `netValue: number` restent des valeurs numériques fiables pour l'ensemble des modules avals (ROI, Cockpit, Analytics).

---

## 6. Plan d'Implémentation Ordonné

### Étape 1 : Création du `TaxReconciliationEngine`
- Créer `src/server/ledger/taxReconciler.ts` implémentant les 3 passes d'appariement déterministes avec réservation exclusive d'identifiants et gestion des portefeuilles personnels et de corporation.

### Étape 2 : Intégration dans `PersistentLedgerRepository` & Persistance
- Intégrer le réconciliateur dans le flux d'ingestion et de sauvegarde (`saveTransactions`, `saveJournalEntries`) avec mise à jour d'un index d'attribution optimisé.
- Rendre `enrichTransaction` et `getTransactionById` en temps constant $O(1)$ sans recalcul dynamique conflictuel.

### Étape 3 : Gestion explicite des statuts et typage
- Étendre `CharacterTransaction` avec `taxReconciliation?: TaxReconciliationDetail` sans altérer la signature numérique existante.

### Étape 4 : Tests exhaustifs d'invariance et de volume
- Valider le comportement sur des ventes simultanées, des sauts de `journalId`, des transactions de corporation (divisions 1 à 7) et des benchmarks de volume (10 000+ transactions accumulées).

---

## 7. Matrice de Tests

| ID Test | Type | Description du Cas | Résultat Attendu |
|---|---|---|---|
| `TEST-F07-01` | Unitaire | Appariement exact via `context_id == transaction_id` | Taxe attribuée, statut `EXACT_MATCH`, entrée marquée consommée. |
| `TEST-F07-02` | Unitaire | Appariement séquentiel `taxJns.journalId = mktJn.journalId + 1` | Taxe attribuée, statut `SEQUENTIAL_M_PLUS_1`. |
| `TEST-F07-03` | Unitaire | 3 ventes identiques exécutées exactement à la même seconde, 3 entrées `transaction_tax` distinctes | Chaque vente reçoit exactement 1 taxe différente ; aucune taxe n'est réutilisée 2 fois. |
| `TEST-F07-04` | Unitaire | 3 ventes identiques dans la même seconde mais seulement 2 entrées `transaction_tax` en base | 2 ventes reçoivent une taxe, la 3ème est marquée `UNMATCHED` (pas de partage indu). |
| `TEST-F07-05` | Unitaire | 2 ventes de montants différents et 2 taxes inversées dans l'ordre de tri | Le moteur apparie correctement chaque taxe à la vente correspondante par montant/taux. |
| `TEST-F07-06` | Invariance | Somme des taxes attribuées sur 1 000 ventes synthétiques | $\sum \text{Taxes attribuées} \le \sum \text{Taxes réelles en base}$ (aucun dépassement arithmétique). |
| `TEST-F07-07` | Volume/Durable | Historique accumulé de 10 000 transactions au-delà du plafond ESI 2 500 | Temps de lecture $O(1)$, aucune perte de transactions anciennes, conservation exacte de l'historique. |

---

## 8. Critères d'Entrée

- Phase F06 validée et fusionnée (journaux de corporation dédupliqués et canoniques).
- Branche : `feature/phase-f07-deterministic-tax-reconciliation`.

---

## 9. Critères de Sortie

1. Aucun algorithme ne sélectionne une taxe par un `break;` sur une recherche sans exclusion d'unicité.
2. L'invariance $\sum \text{Taxes attribuées} \le \sum \text{Taxes réelles}$ est strictement vérifiée par test automatisé.
3. Toutes les ventes enrichies disposent d'un statut de réconciliation fiscale explicite (`EXACT_MATCH`, `SEQUENTIAL_M_PLUS_1`, `UNMATCHED`, etc.).
4. Les tests `TEST-F07-01` à `TEST-F07-06` sont validés au vert.
5. `npm run test`, `npm run typecheck`, `npm run lint` et `npm run build` sont conformes.

---

## 10. Risques et Retour Arrière

- **Risque :** Certaines ventes qui bénéficiaient auparavant d'une taxe faussement attribuée se retrouvent sans taxe (`UNMATCHED`).
  - **Mitigation :** C'est le comportement correct attendu selon les règles d'intégrité comptable (mieux vaut déclarer la taxe inconnue que fausse).
- **Retour arrière :** Revert du commit de feature sur la branche de travail.

---

## 11. Documentation à Mettre à Jour

- `docs/METRICS.md` : Mettre à jour la section sur l'imputation des taxes de vente TTC.
- `docs/DOMAIN_CONTRACTS.md` : Spécifier les contrats du `TaxReconciliationEngine`.
- `docs/CODE_INDEX.md` : Ajouter `src/server/ledger/taxReconciler.ts`.

---

## 12. Statut

**Validée** (100% des tests TEST-F07-01 à TEST-F07-07 au vert, invariance comptable prouvée, O(1) reads sous volume 10 000+ items).
