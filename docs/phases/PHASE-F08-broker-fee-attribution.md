# Phase F08 — Modélisation et Attribution des Frais de Courtage

## 1. Contexte et Problème Constaté

### 1.1 Origine de l'anomalie
Lors de l'audit task-55, l'examen de 1 249 allocations financières a montré que 100% d'entre elles affichaient un champ `allocated_buy_fees_isk = 0`. De même, les transactions d'achat et de vente examinées ne comportaient aucune commission de courtage (`brokers_fee`) rattachée.

L'inspection de `src/server/ledger/repository.ts` (lignes 176-180) a mis en lumière l'incompatibilité de modélisation :
```typescript
const matchesTxId = jn.contextId !== undefined && Number(jn.contextId) === Number(transactionId);
const matchesRefId = journalRefId !== undefined && Number(jn.journalId) === Number(journalRefId);
```
Dans l'API ESI EVE Online :
- Un frais de courtage (`brokers_fee`) est prélevé au moment de la **pose ou de la modification d'un ordre de marché** (`market_order`).
- Le champ `context_id` de l'entrée de journal ESI référence l'identifiant de l'ordre (`order_id`) lorsqu'il est fourni par CCP, ou reste nul.
- Les transactions de portefeuille (`/wallet/transactions/`) représentent l'exécution individuelle (totale ou partielle) et ne contiennent pas de lien direct vers l'ordre source.
- Par conséquent, la recherche directe `contextId === transactionId` échoue dans 100% des cas.

### 1.2 Preuves disponibles
- Absence totale de frais d'achat imputés dans les allocations FIFO existantes (`allocated_buy_fees_isk === 0`).
- Les entrées `brokers_fee` sont bien présentes dans les journaux de portefeuille, mais demeurent orphelines de transactions.

### 1.3 Hypothèses à vérifier lors de l'implémentation
- La possibilité de lier un `brokers_fee` à un ordre via `context_id === order_id`, puis de lier l'ordre aux transactions d'achat/vente correspondantes via les snapshots d'ordres observés (`ordersRepo`).
- Le traitement des frais de courtage sur les ordres modifiés (modification de prix ou de volume), expirés, annulés, ou partiellement exécutés.

### 1.4 Conséquences métier
- Les coûts d'acquisition des stocks achetés par ordres d'achat (`buy orders`) sont sous-évalués car ils n'intègrent pas le coût du courtage.
- Le bénéfice TTC est surévalué en ignorant les commissions payées.

---

## 2. Objectifs

1. **Modéliser le cycle de vie financier des frais de courtage** en distinguant clairement :
   - Les frais de courtage rattachés à un ordre d'achat identifié.
   - Les frais de courtage rattachés à un ordre de vente identifié.
   - Les frais de courtage d'ordres non exécutés, annulés ou orphelins (frais généraux d'opération).
2. **Fournir un mécanisme d'attribution comptable des frais d'achat aux lots FIFO** : lorsqu'un ordre d'achat est exécuté en une ou plusieurs transactions, imputer le `brokers_fee` au prorata des volumes achetés.
3. **Fournir une catégorie explicite pour les frais non attribués** (`unallocated_broker_fees_isk`), garantissant qu'aucune dépense de courtage n'est ignorée dans le bilan global.
4. **Empêcher tout double comptage** entre les frais directs de transaction et les frais d'ordres.

---

## 3. Périmètre

### 3.1 Éléments inclus
- Corrélation entre les entrées `brokers_fee` du grand livre et les ordres de marché enregistrés dans `IOrdersRepository`.
- Attribution des commissions d'ordres d'achat aux transactions d'achat associées (par type d'article, station, date et volume).
- Imputation des frais d'achat dans le moteur d'allocation FIFO de `src/server/roi/service.ts` (`allocated_buy_fees`).
- Imputation des frais de mise en vente dans les frais de vente attribuables (`attributable_sell_fees`).
- Calcul et restitution des commissions de courtage non attribuables aux lots vendus (ordres annulés/modifiés) dans les synthèses financières.

### 3.2 Exclusions explicites
- Rapprochement des taxes de vente (déjà traité par **F07**).
- Refonte des écrans du Cockpit (réservé à **F09**).

### 3.3 Limites
- Si un ordre d'achat a été passé avant la rétention de l'historique ESI ou si le `context_id` est absent, le frais reste classé `UNATTRIBUTED_FEE` et ne peut être arbitrairement rattaché à une transaction au hasard.

---

## 4. État Technique Initial

- **Fichiers concernés :**
  - `src/server/ledger/repository.ts`
  - `src/server/orders/repository.ts`
  - `src/server/roi/service.ts` (`getTransactionFees`, `autoReconcileFifo`)
  - `src/server/roi/types.ts`
- **Comportement actuel :**
  - `allocatedBuyFees` est systématiquement à 0 car `getTransactionFees(buyTx)` renvoie 0.

---

## 5. Architecture Cible et Stratégie

```
┌──────────────────────────────────────────────────────────────────┐
│                   BrokerFeeAttributionEngine                     │
│                                                                  │
│ 1. Identification de l'ordre :                                   │
│    jn.context_id -> order_id dans OrdersRepository               │
│                                                                  │
│ 2. Corrélation ordre <-> transactions :                          │
│    • Même character/corp, même typeId, même location             │
│    • Dates d'exécution dans la durée de vie de l'ordre           │
│                                                                  │
│ 3. Proratisation du brokers_fee sur les transactions d'achat    │
│                                                                  │
│ 4. Reliquat d'ordres annulés/non exécutés -> Frais non alloués  │
└──────────────────────────────────────────────────────────────────┘
```

1. **Quatre catégories de frais étanches :**
   - $\text{Frais Récupérés}$ : Total des entrées `brokers_fee` en base.
   - $\text{Frais Rapprochés}$ : Frais associés avec certitude à un ordre de marché.
   - $\text{Frais Alloués}$ : Quote-part de frais imputée aux lots FIFO consommés.
   - $\text{Frais Non Attribués}$ : Frais d'ordres annulés, expirés sans exécution ou orphelins.
2. **Explicabilité unitaire :**
   Chaque lot FIFO d'achat enrichi porte la traçabilité de sa commission de courtage unitaire : `unit_buy_fee_isk`.

---

## 6. Plan d'Implémentation Ordonné

### Étape 1 : Création du moteur d'attribution des frais de courtage
- Créer `src/server/ledger/brokerFeeReconciler.ts` capable de corréler les entrées de journal `brokers_fee` avec les snapshots d'ordres de `IOrdersRepository`.

### Étape 2 : Proratisation sur les transactions d'achat
- Calculer la part de commission de courtage revenant à chaque transaction d'achat issue d'un ordre.

### Étape 3 : Intégration dans `RoiService` et le moteur FIFO
- Dans `autoReconcileFifo`, alimenter `allocated_buy_fees` à partir des frais d'achat réellement attribués.

### Étape 4 : Gestion des frais de vente (frais de pose d'ordre de vente)
- Associer les commissions de mise en vente aux transactions de vente pour enrichir `allocated_sell_fees` (en complément de la taxe).

---

## 7. Matrice de Tests

| ID Test | Type | Description du Cas | Résultat Attendu |
|---|---|---|---|
| `TEST-F08-01` | Unitaire | Frais de courtage sur ordre d'achat entièrement exécuté (1 000 unités) | Frais de courtage imputé à 100% sur la transaction d'achat. |
| `TEST-F08-02` | Unitaire | Ordre d'achat exécuté en 3 transactions partielles (300, 300, 400 unités) | Frais réparti strictement au prorata (30%, 30%, 40%). |
| `TEST-F08-03` | Unitaire | Ordre d'achat annulé après exécution partielle de 50% | 50% des frais alloués aux achats, 50% classés en frais non attribués (perte sèche d'ordre). |
| `TEST-F08-04` | Unitaire | Achat direct immédiat au marché (sans ordre de pose, pas de `brokers_fee`) | `allocated_buy_fees = 0` (légitime, pas de commission de courtage). |
| `TEST-F08-05` | Invariance | Somme des frais alloués + frais non attribués | Rigoureusement égale à la somme des frais de courtage uniques enregistrés en base. |

---

## 8. Critères d'Entrée

- Phase F07 validée et fusionnée.
- Branche : `feature/phase-f08-broker-fee-attribution`.

---

## 9. Critères de Sortie

1. Le champ `allocated_buy_fees_isk` dans les allocations FIFO n'est plus systématiquement égal à 0 pour les achats issus d'ordres de marché.
2. Les frais de courtage des ordres annulés ou orphelins sont isolés dans une catégorie `unallocated_broker_fees_isk` et non perdus.
3. L'invariance globale de conservation des frais est validée par test.
4. Les tests `TEST-F08-01` à `TEST-F08-05` sont validés au vert.
5. `npm run test`, `npm run typecheck`, `npm run lint` et `npm run build` sont sans erreur.

---

## 10. Risques et Retour Arrière

- **Risque :** Baisse du bénéfice net affiché suite à la prise en compte réelle des commissions de courtage d'achat.
  - **Mitigation :** C'est le résultat recherché pour refléter la véritable rentabilité nette TTC.
- **Retour arrière :** Revert du commit de feature.

---

## 11. Documentation à Mettre à Jour

- `docs/METRICS.md` : Mettre à jour les formules d'investissement TTC et d'imputation des frais de courtage.
- `docs/DOMAIN_CONTRACTS.md` : Documenter la politique des 4 états de frais.
- `docs/CODE_INDEX.md` : Ajouter `src/server/ledger/brokerFeeReconciler.ts`.

---

## 12. Statut

**Terminé** — `BrokerFeeReconciliationEngine` implémenté avec corrélation des `order_id`, proratisation déterministe sur les transactions d'achat et de vente, 4 états de frais étanches et validation intégrale des tests `TEST-F08-01` à `TEST-F08-05`.
