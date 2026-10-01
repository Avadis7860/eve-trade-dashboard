# Phase F03 — Invariants Financiers, Détection Chronologique & Valorisation FIFO

## 1. Contexte & Problématique
L'audit post-Phase 12 a identifié des écarts de conformité avec les règles de calcul de `docs/METRICS.md` :
1. **Sélection erronée du dernier prix d'achat dans les opérations (S1-1) :** `OperationsService.getOperationsPlan` utilise une condition `txDate.getTime() > 0` qui écrase la valeur à chaque transaction de la liste au lieu de chercher l'horodatage maximal.
2. **Coût moyen implicite et projection injustifiée sur les stocks physiques (S1-2) :** `CapitalService.getPositions` calcule `costData.remainingCost / costData.remainingQty` (un coût moyen global) et applique cette valeur à tout le stock physique d'une station, marquant le statut à `KNOWN` même lorsque l'inventaire FIFO ne couvre qu'une fraction du stock physique.
3. **Conversion silencieuse des valeurs arithmétiques invalides en 0 ISK (S2-3) :** `RoiCalculator.roundIsk` et `roundPercent` convertissent les valeurs non finies ou `NaN` en `0` au lieu de propager `null` / `UNKNOWN`.
4. **Mélange automatique des stocks en multi-personnages sans contrôle d'entité (S2-4) :** L'algorithme de réconciliation FIFO automatique fusionne tous les lots de tous les personnages sélectionnés dans une file unique sans option de priorité au personnage propriétaire de la vente.

## 2. Objectifs & Périmètre
- Corriger l'algorithme d'identification de la dernière transaction d'achat pour garantir une sélection strictement chronologique basée sur `tx.date` le plus récent.
- Refactoriser la valorisation des positions de stock physique dans `CapitalService` :
  - Valoriser uniquement la quantité effectivement couverte par des lots d'achat FIFO identifiés.
  - Déclarer explicitement le statut `PARTIAL` ou `UNKNOWN` lorsque la quantité physique dépasse la quantité de lots réconciliés disponibles.
  - Éliminer le calcul d'un coût moyen synthétique non justifié par des lots discrets.
- Propager `null` ou des statuts `UNKNOWN` au niveau des calculs de ROI lorsque le dénominateur ou le numérateur est indéterminé.
- Documenter et introduire une option explicite de réconciliation FIFO avec priorité au personnage vendeur avant de consommer les lots des autres personnages du compte.

## 3. Fichiers & Modules Concernés
- `src/server/operations/service.ts`
- `src/server/capital/service.ts`
- `src/server/roi/service.ts`
- `src/server/roi/calculator.ts`
- `src/server/roi/types.ts`
- Tests associés : `src/server/operations/operations.test.ts`, `src/server/capital/capital.test.ts`, `src/server/roi/roi.test.ts`

## 4. Modifications Conceptuelles & Règles Techniques
1. **Règle Chronologique du Dernier Prix d'Achat :**
   ```typescript
   // Pour chaque transaction d'achat :
   const currentLatest = latestBuyMap.get(tx.typeId);
   if (!currentLatest || new Date(tx.date).getTime() > new Date(currentLatest.date).getTime()) {
     latestBuyMap.set(tx.typeId, { unitPrice: tx.unitPrice, date: tx.date });
   }
   ```
2. **Valorisation Exacte du Stock Physique :**
   Pour chaque type d'article, la valeur de coût de revient `totalCostBasisIsk` doit être la somme exacte des coûts des lots FIFO assignables à ce stock. Si `physicalQty > fifoRemainingQty`, le statut de couverture de coût doit être `PARTIAL` (avec indication de la fraction couverte) et non `KNOWN`.
3. **Invariance Arithmétique & Explicabilité :**
   Toute valeur financière affichée doit être accompagnée de sa formule de décomposition vérifiable.

## 5. Tests Obligatoires & Scénarios de Validation
- [ ] Test déterministe avec liste de transactions dans un ordre anti-chronologique ou aléatoire, vérifiant que le dernier prix d'achat extrait est toujours celui de la date la plus récente.
- [ ] Test d'inventaire partiel : injecter 100 unités physiques d'un article et seulement 20 unités dans les lots d'achat FIFO. Vérifier que la valorisation totale ne s'applique qu'aux 20 unités et que le statut est qualifié de `PARTIAL`.
- [ ] Test multi-personnages : vérifier qu'en mode cloisonné, une vente du Personnage A n'absorbe pas les lots du Personnage B s'il reste des lots propres au Personnage A.
- [ ] Test arithmétique de non-conversion : vérifier qu'un calcul avec investissement nul ne produit pas un ROI à 0% mais une valeur `null` accompagnée d'un statut `UNKNOWN`.

## 6. Critères d'Entrée & de Sortie
- **Entrée :** Validation et merge de la Phase F02. Branche dédiée `feature/F03-financial-inventory-invariants`.
- **Sortie :**
  - Conformité 100% avec les formules de `docs/METRICS.md`.
  - Zéro moyenne implicite sur les stocks physiques non réconciliés.
  - Tous les tests de réconciliation et de valorisation validés.
  - Mise à jour de `docs/CODE_INDEX.md`.
