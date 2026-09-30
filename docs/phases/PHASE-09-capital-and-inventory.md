# PHASE-09 — Positions de capital et inventaire mutuellement exclusif

**Type :** modélisation de capital & inventaire · **Dépendances :** 07, 08 · **État :** Planifiée

---

## 1. Problème utilisateur & Résultat attendu

- **Problème** : Aujourd'hui, l'utilisateur ne dispose pas d'une vision nette et exhaustive de son capital. Les ordres de vente affichent un total notionnel qui est confondu avec du capital liquide ou du bénéfice, l'escrow des ordres d'achat n'est pas clairement distingué, et les actifs physiques ne sont pas classés selon leur disponibilité opérationnelle (stock posé en vente, stock prêt à vendre en station de hub, stock dormant dans une station reculée, stock en cours de transport).
- **Résultat attendu** : Un moteur de modélisation du capital et de l'inventaire classant chaque ISK et chaque unité physique dans des états **mutuellement exclusifs**, valorisés au coût de revient réel (ou coût estimé explicite), avec distinction nette entre liquidité disponible, escrow engagé, stock actif en vente, stock libre en hub, stock dormant et stock en transit.

---

## 2. Dépendances exactes

- Modules amont : `src/server/assets/service.ts`, `src/server/orders/service.ts`, `src/server/roi/service.ts`, `src/server/hubs/service.ts`.
- Contrats : `docs/DOMAIN_CONTRACTS.md`, `docs/METRICS.md`.

---

## 3. Périmètre inclus & Exclusions explicites

### Inclus
- **Classification mutuellement exclusive des actifs physiques** :
  1. *Stock en ordre de vente* (`COMMITTED_SELL_ORDER`) : Quantité liée à un ordre de vente actif en station.
  2. *Stock libre au hub* (`FREE_HUB_STOCK`) : Actif présent dans une station associée à un hub commercial configuré, non posé en vente.
  3. *Stock dormant / distant* (`REMOTE_DORMANT_STOCK`) : Actif situé hors des hubs commerciaux déclarés sans mouvement depuis $X$ jours.
  4. *Stock en transit* (`IN_TRANSIT_STOCK`) : Actifs situés dans des conteneurs de fret/vaisseaux de transport ou identifiés par statut de transit.
  5. *Stock non rapproché* (`UNRECONCILED_STOCK`) : Actifs physiques sans coût d'achat identifié.
- **Classification du capital monétaire (ISK)** :
  1. *Liquidités disponibles* (`LIQUID_WALLET_BALANCE`) : Solde ISK réel du portefeuille EVE.
  2. *Escrow d'achat de marché* (`MARKET_BUY_ESCROW`) : ISK bloqués par le jeu pour garantir les ordres d'achat ouverts.
  3. *Valeur de revient de l'inventaire* (`INVENTORY_COST_VALUE`) : Coût d'acquisition réel des stocks physiques invendus.
  4. *Valeur notionnelle de vente* (`NOTIONAL_MARKET_ASK_VALUE`) : Valeur marchande brute potentielle des ordres de vente actifs (clairement étiquetée hors capital liquide).
- Endpoints API `/api/capital/summary` et `/api/capital/breakdown` exposant la distribution exacte du capital par personnage et pour tout l'écosystème.

### Exclusions
- Aucune manipulation des ordres ou des actifs en jeu (lecture seule ESI).
- Pas de spéculation sur les prix futurs de marché.

---

## 4. Règles de calcul & Modèle de données

1. **Règle d'exclusion mutuelle pour un article dans une station** :
   $$\text{Stock Total Physique} = \text{Stock en Ordre de Vente} + \text{Stock Libre en Station}$$
   *Preuve* : Si un personnage a 1 000 unités de Tritanium dans la station A, et un ordre de vente actif de 400 unités dans cette même station, le stock en vente est de 400 et le stock libre est de $1\,000 - 400 = 600$.
2. **Valorisation du capital total** :
   $$\text{Capital Net Réel} = \text{Liquidités Portefeuille} + \text{Escrow Ordres Achat} + \text{Coût de Revient Inventaire Invendu}$$
   *Garde-fou* : La valeur notionnelle des ordres de vente ($P_{ordre} \times \text{Volume}$) n'est **jamais** additionnée au capital net réel, mais affichée à titre indicatif comme chiffre d'affaires potentiel futur.

---

## 5. Étapes de réalisation

1. **Service de rapprochement Actifs ↔ Ordres** : Calcul en temps réel de la décomposition physique (`inOrder`, `freeInStation`) par type et emplacement.
2. **Moteur de classification des stocks** : Intégration des hubs configurés pour catégoriser le stock libre (Hub vs Distant/Dormant).
3. **Moteur d'agrégation de capital** : Calcul des agrégats monétaires et valorisation croisée avec les lots d'inventaire issus de la Phase 08.
4. **Endpoints API Capital** : Création du routeur `/api/capital` avec filtres par personnage, hub et groupe d'articles.
5. **Tests unitaires et d'intégration** : Vérification de l'invariance arithmétique (aucun double comptage, exclusion mutuelle respectée à 100%).

---

## 6. Critères d'acceptation mesurables

- [ ] Pour tout type et emplacement, la somme des stocks décomposés est strictement égale à la quantité retournée par l'ESI.
- [ ] La valeur notionnelle de vente n'est en aucun cas présentée comme de la trésorerie disponible.
- [ ] Le calcul du capital total distingue de manière transparente la part de liquidité immédiate, la part engagée en escrow et la part immobilisée en stocks physiques.
- [ ] Les stocks dormants (hors hub sans vente depuis plus de 30 jours) sont identifiés avec leur localisation exacte et leur valeur de revient.
- [ ] Tests automatisés complets au vert (`vitest run`).

---

## 7. Gestion des états incertains

- Stock physique sans transaction d'achat associée : étiqueté `UNRECONCILED_COST`, valorisation financière marquée `UNKNOWN` avec affichage de la quantité physique certaine.

---

## 8. Définition de Terminé

Code réel implémenté + tests de modélisation de capital au vert + CI verte + mise à jour de `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md`.
