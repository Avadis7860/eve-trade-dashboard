# Phase F09 — Réconciliation Financière TTC et Cohérence des Indicateurs

## 1. Contexte et Problème Constaté

### 1.1 Origine de l'anomalie
Lors de l'audit task-55, une divergence majeure est apparue entre le chiffre d'affaires brut observé et celui pris en compte dans le calcul du bénéfice :
- Chiffre d'affaires brut total : ~15,58 milliards d'ISK.
- Chiffre d'affaires alloué à des achats connus : ~5,79 milliards d'ISK.
- Chiffre d'affaires non alloué : ~9,79 milliards d'ISK (soit 62,85% du CA total).
- L'indicateur `coverage_percent` dans `src/server/roi/calculator.ts` affichait pourtant 97,57%, car il était calculé sur le **volume d'unités d'articles vendus** et non sur la **valeur financière du chiffre d'affaires**.

Cette distorsion induit une fausse interprétation : l'utilisateur croit que 97% de son résultat financier est prouvé, alors que les deux tiers de sa valeur économique ne disposent pas d'historique d'achat démontré (ventes sans achat correspondant dans la fenêtre ESI des 2 500 transactions, ou absence de stock d'ouverture).

De plus, la formule du bénéfice réalisé :
$$\text{Profit TTC} = \text{CA alloué} - \text{Coût achat} - \text{Frais achat} - \text{Frais vente}$$
doit être rigoureusement alimentée par les composants fiabilisés lors des phases F05 à F08 (taxes dédupliquées, commissions réelles, etc.).

### 1.2 Preuves disponibles
- Formule dans `src/server/roi/calculator.ts` (lignes 323-333).
- Rapport task-55 sur le portefeuille `2124224223` / `98830`.

### 1.3 Hypothèses à vérifier lors de l'implémentation
- La clarté de restitution pour l'utilisateur des 3 blocs de résultat : Ventes réconciliées (bénéfice prouvé), Ventes en attente de stock d'ouverture (CA non alloué), et Frais généraux non rattachés.

### 1.4 Conséquences métier
- Risque de surévaluation ou sous-évaluation du ROI réel si la part non allouée est mal comprise.
- Nécessité d'une séparation nette entre performance réalisée et incertitude d'historique.

---

## 2. Objectifs

1. **Distinguer explicitement la Couverture Quantitative (Volume d'unités) de la Couverture Financière (Chiffre d'Affaires)** dans tous les types, calculs et contrats de l'application.
2. **Harmoniser la formule du bénéfice réalisé TTC** en intégrant l'ensemble des composantes vérifiables issues de F05 à F08 :
   - Chiffre d'affaires brut total vs CA alloué vs CA non alloué.
   - Coût d'achat reconnu.
   - Frais de courtage d'achat attribués (`allocated_buy_fees`).
   - Taxes de vente attribuées (`allocated_sell_taxes`).
   - Frais de courtage de vente attribués (`allocated_sell_broker_fees`).
   - Frais d'ordres non attribués (`unallocated_fees`).
3. **Fournir un statut de confiance financière explicite** (`FINANCIAL_COVERAGE_COMPLETE`, `FINANCIAL_COVERAGE_PARTIAL`, `FINANCIAL_COVERAGE_UNKNOWN`).
4. **Garantir l'absence de double comptage** et l'exactitude décimale des arrondis ISK (centimes d'ISK).

---

## 3. Périmètre

### 3.1 Éléments inclus
- Refonte des types financiers dans `src/server/roi/types.ts` pour introduire :
  - `gross_revenue_total_isk`
  - `gross_revenue_allocated_isk`
  - `gross_revenue_unallocated_isk`
  - `financial_coverage_percent` (ratio en ISK)
  - `volume_coverage_percent` (ratio en unités)
  - `unallocated_broker_fees_isk`
  - `allocated_sell_taxes_isk`
  - `allocated_sell_broker_fees_isk`
- Mise à jour du `RoiCalculator` dans `src/server/roi/calculator.ts`.
- Mise à jour du `RoiService` dans `src/server/roi/service.ts`.
- Adaptation des composants de présentation du Cockpit (`src/client/pages/CockpitPage.tsx` ou sous-composants financiers) pour afficher distinctement les métriques de couverture et de rentabilité TTC sans masquer le CA non alloué.

### 3.2 Exclusions explicites
- Reconstitution rétroactive des données persistées sur disque (réservé à **F10**).
- Automatisation d'achats ou modifications en jeu (hors périmètre absolu du produit).

### 3.3 Limites
- Si l'utilisateur n'a pas renseigné de stock d'ouverture pour des ventes très anciennes, le bénéfice sur ce volume reste légitimement `UNKNOWN` (pas d'estimation inventée).

---

## 4. État Technique Initial

- **Fichiers concernés :**
  - `src/server/roi/types.ts`
  - `src/server/roi/calculator.ts`
  - `src/server/roi/service.ts`
  - `src/client/pages/CockpitPage.tsx`
- **Comportement actuel :**
  - Un seul champ `coverage_percent` ambigu mesurant les volumes.
  - Pas de décomposition détaillée des taxes vs frais de courtage dans le résumé financier.

---

## 5. Architecture Cible et Stratégie

### 5.1 Structure canonique du bilan de rentabilité TTC

$$\text{CA Brut Total} = \text{CA Alloué (Prouvé)} + \text{CA Non Alloué (Historique Incomplet)}$$

$$\text{Investissement TTC Alloué} = \text{Coût d'Achat Alloué} + \text{Frais Courtage Achat Alloués}$$

$$\text{Frais de Vente Alloués} = \text{Taxes Vente Attribuées} + \text{Frais Courtage Vente Attribués}$$

$$\text{Bénéfice Réalisé TTC} = \text{CA Alloué} - \text{Investissement TTC Alloué} - \text{Frais de Vente Alloués}$$

$$\text{ROI \% TTC} = \frac{\text{Bénéfice Réalisé TTC}}{\text{Investissement TTC Alloué}} \times 100$$

### 5.2 Niveaux de confiance et transparence
- **Couverture Financière :** $\frac{\text{CA Alloué}}{\text{CA Brut Total}} \times 100$.
- **Couverture Volume :** $\frac{\text{Unités Allouées}}{\text{Unités Vendues}} \times 100$.
- Si $\text{CA Non Alloué} > 0$, l'UI présente un bandeau explicatif invitant à créer un Stock d'Ouverture pour les articles concernés ou indiquant la limite de la fenêtre d'historique.

---

## 6. Plan d'Implémentation Ordonné

### Étape 1 : Extension du modèle `RoiFinancialSummary` et `FormulaProof`
- Ajouter dans `src/server/roi/types.ts` les nouveaux champs de décomposition financière et les deux métriques de couverture.

### Étape 2 : Révision du calcul dans `RoiCalculator`
- Réécrire `computeSummary` et `buildProof` pour calculer les deux couvertures et séparer les postes de taxes et commissions.

### Étape 3 : Intégration dans `RoiService`
- Mettre à jour `calculateFinancialSummary` pour intégrer les données enrichies par F07 et F08.

### Étape 4 : Mise à jour de l'interface Cockpit
- Afficher clairement dans le Cockpit les deux taux de couverture et la distinction entre bénéfice réalisé prouvé et chiffre d'affaires non rapproché.

---

## 7. Matrice de Tests

| ID Test | Type | Description du Cas | Résultat Attendu |
|---|---|---|---|
| `TEST-F09-01` | Unitaire | 100 munitions vendues (100% allouées, 100k ISK) et 1 cuirassé vendu (non alloué, 1 Mrd ISK) | `volume_coverage_percent = 99.01%`, `financial_coverage_percent = 0.01%`, statut `PARTIAL`. |
| `TEST-F09-02` | Unitaire | Calcul du bénéfice avec coût achat 10M, frais achat 200k, taxes vente 800k, frais vente 300k, CA alloué 15M | Investissement TTC = 10,2M ; Frais vente = 1,1M ; Bénéfice = 3,7M ; ROI = 36,27%. |
| `TEST-F09-03` | Unitaire | Vente avec historique d'achat totalement absent (0 allocation) | CA alloué = 0, Bénéfice = null (`UNKNOWN`), CA non alloué = 100% du CA brut. |
| `TEST-F09-04` | Invariance | Égalité stricte $\text{CA Alloué} + \text{CA Non Alloué} = \text{CA Brut Total}$ | Vérifiée au centime d'ISK près sur 500 cas aléatoires. |
| `TEST-F09-05` | Intégration | Restitution Cockpit d'un compte multi-personnages | Affichage cohérent, pas de mélange de devise ou d'entité, filtres synchronisés. |

---

## 8. Critères d'Entrée

- Phases F05, F06, F07 et F08 validées et fusionnées.
- Branche : `feature/phase-f09-ttc-financial-reconciliation`.

---

## 9. Critères de Sortie

1. La confusion entre couverture quantitative et couverture financière est éliminée des types et de l'UI.
2. La formule de calcul du bénéfice TTC est mathématiquement prouvée et vérifiée unitairement.
3. Les ventes non allouées restent visibles et ne génèrent aucun profit fictif.
4. Les tests `TEST-F09-01` à `TEST-F09-05` sont au vert.
5. `npm run test`, `npm run typecheck`, `npm run lint` et `npm run build` sont sans erreur.

---

## 10. Risques et Retour Arrière

- **Risque :** Changement visible des KPI dans le Cockpit (affichage d'un taux de couverture financière plus faible mais authentique).
  - **Mitigation :** Explication pédagogique claire dans les infobulles et libellés du Cockpit.
- **Retour arrière :** Revert du commit de feature.

---

## 11. Documentation à Mettre à Jour

- `docs/METRICS.md` : Mise à jour exhaustive des définitions et formules du Masterplan.
- `docs/DOMAIN_CONTRACTS.md` : Contrats de couverture financière.
- `docs/CODE_INDEX.md` : Mise à jour des modules ROI.

---

## 12. Statut

**Planifiée** (Dépend de F08).
