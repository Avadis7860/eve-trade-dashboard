# Phase P05 — Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur)

## 1. Statut
`TERMINÉE`

## 2. Objectif
Construire le moteur de propagation continue des coûts de revient à travers l'arbre de transformation multi-niveaux (P0 $\rightarrow$ P1 $\rightarrow$ P2 $\rightarrow$ P3 $\rightarrow$ P4 en PI, et Minerais $\rightarrow$ Minéraux $\rightarrow$ Composants T2 $\rightarrow$ Coques en Industrie), garantissant qu'aucun lot de produit fini ne subisse de rupture de traçabilité FIFO, tout en isolant formellement ce calcul dans un sous-moteur dédié pour éviter toute surcharge de `roi/calculator.ts`.

## 3. Contexte & Problématique Métier
Dans une chaîne de fabrication complète EVE Online, le produit fini vendu sur le marché (ex: Vaisseau T2 ou composant P4) est le résultat d'une cascade d'étapes de transformation :
1. **Étage 1 (Extraction brute)** : Minerais farmés (`FARMED_PROVENANCE`) ou matériaux planétaires P0.
2. **Étage 2 (Raffinage / Transformation primaire)** : Minéraux ou matériaux P1 (avec frais de pose ou de POCO).
3. **Étage 3 (Composants intermédiaires)** : Composants avancés ou matériaux P2/P3 (avec consommations de blueprints et frais de réactions).
4. **Étage 4 (Assemblage final)** : Coque de vaisseau, module ou matériel P4 prêt à être vendu sur un hub commercial.

Sans propagation de bout en bout :
- Si l'utilisateur vend une coque de vaisseau fabriquée à partir de minerais farmés et de composants achetés, le moteur de trading actuel (`src/server/roi/`) ne trouve pas de transaction d'achat direct de la coque dans le Grand Livre et qualifie à tort la vente en `UNKNOWN`.
- Si le système impute arbitrairement un coût moyen sans lien unitaire avec les intrants, l'invariant fondamental d'auditabilité arithmétique (`FormulaProof`) est violé.

## 4. Décisions Architecturales & Délégation des Responsabilités
* **Création d'un Moteur Spécialisé `src/server/production/costPropagator.ts` :**
  Pour ne pas gonfler le calculateur de trading de base (`src/server/roi/calculator.ts`, qui reste focalisé sur la vente unitaire et le TTC), le calcul de cascade industrielle est délégué à :
  - `src/server/production/costPropagator.ts` : algorithme de propagation ascendante le long de l'arbre BOM.
  - `src/server/production/types.ts` : interfaces pour la lignée de fabrication (`ProductionLineage`, `BomInputAllocation`, `MultiTierCostBreakdown`).
  - `src/server/production/repository.ts` : persistance des liens de généalogie de lots (`production_cost_allocations`).
* **Formule Mathématique d'Héritage de Coût Unitaire :**
  Pour un lot produit fini $L_{\text{produit}}$ de quantité $Q_{\text{sortant}}$ généré par le job $J$ :
  $$C_{\text{unitaire}}(L_{\text{produit}}) = \frac{\sum_{i=1}^{n} \left( Q_{\text{entrant}, i} \times C_{\text{unitaire}}(L_{\text{entrant}, i}) \right) + \text{Frais Job ISK} + \text{Taxes Douanières POCO ISK}}{Q_{\text{sortant}}}$$
* **Intégration au Moteur de Lots Unifiés (`InventoryLot`) :**
  Dès qu'un job est marqué `delivered` (ou qu'un lot PI est exporté en orbite), le lot produit est injecté dans le référentiel des lots d'inventaire (`InventoryLot`) avec son type d'origine :
  - `provenance: 'MANUFACTURED'` ou `'PLANETARY_TRANSFORMED'`,
  - `lineage` : référence vers le `job_id` source et la liste des lots d'intrants consommés.
  Le moteur FIFO classique de `src/server/roi/` peut alors consommer ce lot manufacturé lors d'une transaction de vente de marché **exactement comme un achat direct**, sans aucune rupture de chaîne ni modification du moteur de vente.
* **Respect Absolu des Invariants de Vérité des Données :**
  - Si un intrant $i$ a un coût `UNKNOWN` (ex: composant injecté sans historique antérieur), le coût du lot produit est rigoureusement qualifié en `PARTIAL` ou `UNKNOWN`.
  - Jamais de coût inventé ou estimé silencieusement à 0.00 ISK.
  - Conservation de la preuve arithmétique d'auditabilité (`FormulaProof`) détaillée étape par étape.
* **Projection dans le Cockpit UI :**
  - Fiche Product 360 : onglet de décomposition industrielle montrant l'arbre BOM complet et le coût hérité de chaque feuille.
  - Positions de capital : valorisation des stocks de produits finis avec leur coût de fabrication réel.

## 5. Non-objectifs
* Ne pas implémenter de moteur de recommandation spéculative ("faut-il fabriquer ou acheter ?") : ce rôle reste dans le tableur externe de l'utilisateur conformément à `PRODUCT_SCOPE.md`.
* Ne pas altérer le comportement des ventes de marché pures sans étape de fabrication.

## 6. Dépendances
* Phase P01 (ingestion ESI résiliente).
* Phase P02 (traçabilité des matières farmées/minées et coûts d'opportunité).
* Phase P03 (modélisation des flux et taxes PI).
* Phase P04 (traçabilité des jobs industriels, BOM et frais de pose).

## 7. Modules Concernés
* `src/server/production/types.ts`
* `src/server/production/costPropagator.ts`
* `src/server/production/repository.ts`
* `src/server/production/service.ts`
* `src/server/roi/repository.ts` (intégration des lots `MANUFACTURED` dans `getHistoricalBuyLots`)
* `src/components/Product360Modal.tsx` (visualisation de la chaîne de valeur BOM)
* Tests : `src/server/production/production.test.ts`, `src/server/roi/roi.test.ts`

## 8. Contrats Impactés
* `DOMAIN_CONTRACTS.md` : statut `MANUFACTURED` et invariance de la chaîne de valeur sans rupture FIFO.
* `ALGORITHMS.md` : spécification de l'Algorithme 9 (Propagation de Coût Industriel Multi-Niveaux).
* `METRICS.md` : formule de calcul du coût de revient manufacturé TTC.

## 9. Critères d'Acceptation & Qualification
* [x] Une vente de produit fini (ex: Croiseur) assemblé à partir de minerais farmés et de composants achetés génère un ROI TTC 100% auditable sans statut `UNKNOWN` indu.
* [x] La consommation des intrants décrémente fidèlement les stocks physiques respectifs au prorata des runs exécutés.
* [x] La formule de calcul intègre les frais d'installation de job et les taxes POCO sans double comptage.
* [x] L'algorithme est isolé dans `src/server/production/` sans surcharger `src/server/roi/calculator.ts`.
* [x] Les preuves arithmétiques `FormulaProof` détaillent l'arbre généalogique complet du lot.
* [x] 100 % des tests unitaires et d'intégration passent au vert.
