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

### 3.3 Limites
- Si l'historique ESI de journal est incomplet (ex: ventes antérieures à la fenêtre ESI), les ventes concernées doivent rester classées `TAX_UNKNOWN`, sans extrapolation.

---

## 4. État Technique Initial

- **Fichiers concernés :**
  - `src/server/ledger/repository.ts` (`getJournalEntriesForTransaction`, `enrichTransaction`)
  - `src/server/ledger/types.ts`
  - `src/server/roi/service.ts` (`getTransactionFees`)
- **Comportement actuel :**
  - Traitement isolé, transaction par transaction.
  - Matching heuristique non exclusif permettant le double comptage.

---

## 5. Architecture Cible et Stratégie

```
┌──────────────────────────────────────────────────────────┐
│               TaxReconciliationEngine                     │
│                                                          │
│ 1. Tri chronologique et ordonnancement strict (M+1)      │
│ 2. Réservation exclusive (allocatedTaxJournalIds: Set)   │
│ 3. Passe 1 : context_id == tx_id (Exact)                 │
│ 4. Passe 2 : tax.journal_id == tx.journal_ref_id + 1     │
│ 5. Passe 3 : Corrélation bijective sans ambiguïté        │
│ 6. Tout candidat résiduel ambigu -> Status: AMBIGUOUS    │
└──────────────────────────────────────────────────────────┘
```

1. **Tableau de réconciliation avec réservation d'état :**
   Le moteur opère sur l'ensemble du périmètre évalué (ou par lot cohérent) avec un ensemble `usedTaxJournalKeys = new Set<string>()`.
2. **Explicabilité et preuve :**
   Chaque transaction enrichie comporte le détail :
   ```typescript
   taxReconciliation: {
     status: 'EXACT_MATCH' | 'SEQUENTIAL_M_PLUS_1' | 'CORRELATED_BIJECTIVE' | 'UNMATCHED' | 'AMBIGUOUS';
     matchedJournalId?: number;
     taxAmount: number;
     taxRate?: number;
     justification: string;
   }
   ```
3. **Invariance comptable :**
   $\sum \text{Taxes attribuées aux ventes} \le \sum \text{Taxes uniques du grand livre}$.

---

## 6. Plan d'Implémentation Ordonné

### Étape 1 : Création du `TaxReconciliationEngine`
- Créer `src/server/ledger/taxReconciler.ts` implémentant les passes d'appariement déterministes avec réservation exclusive d'identifiants.

### Étape 2 : Intégration dans `PersistentLedgerRepository`
- Remplacer l'implémentation naïve de `getJournalEntriesForTransaction` par l'appel au moteur avec contexte d'attribution partagé.
- Fournir une méthode batch `reconcileTaxesForScope(characterIds, dateRange)` pour enrichir l'ensemble des ventes en une passe atomique.

### Étape 3 : Gestion explicite des statuts de taxe
- Mettre à jour `CharacterTransaction` pour exposer le statut de réconciliation fiscale et la preuve associée.

### Étape 4 : Tests exhaustifs de non-duplication
- Tester les cas de ventes simultanées, de doublons de montants, de sauts de `journalId` et d'exceptions au pattern `M+1`.

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

**Planifiée** (Dépend de F06).
