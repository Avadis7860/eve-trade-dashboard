# PHASE-12 — Cockpit, navigation unifiée et refonte ergonomique

**Type :** refonte UX/UI & intégration globale · **Dépendances :** 08, 09, 10, 10.bis, 11, R00–R08 · **État :** Terminée · **Document de référence :** [UX_REDESIGN_BLUEPRINT.md](../UX_REDESIGN_BLUEPRINT.md)

---

## 1. Problème utilisateur & Résultat attendu

- **Problème** : L'interface actuelle souffre de dispersion : bandeau de synchronisation lourd et répété de 80px sur toutes les pages, 9 onglets horizontaux plats fragmentant les flux de travail, murs de cartes KPI dupliqués dans chaque vue, fiche Product 360 monolithique nécessitant un défilement vertigineux, et rupture de contexte lors de l'inspection des détails de transactions ou d'ordres.
- **Résultat attendu** : Une refonte globale et fluide de l'interface utilisateur articulée autour d'un **Cockpit décisionnel épuré**, d'un en-tête compact avec tiroir de diagnostic ESI à la demande, d'une navigation restructurée en 6 espaces de décision sans redondance (Cockpit, Positions, Analyses, Opérations, Transactions, Configuration), d'un modèle de fenêtrage intégré (tiroirs latéraux d'inspection et fenêtres Focus élargies à onglets), et d'une densité d'information optimale pour le trading actif.

---

## 2. Dépendances exactes

- **Modules & Endpoints amont** :
  - Métriques de rentabilité et réconciliation FIFO versionnée (Phase 08 / `RoiService`).
  - Décomposition mutuellement exclusive du capital et des stocks (Phase 09 / `CapitalService`).
  - Fiche analytique et séries temporelles (Phase 10 / `AnalyticsService`).
  - Soldes réels de portefeuille et liquidités (Phase 10.bis / `WalletService`).
  - Transferts prioritaires et suggestions de réassort nettes (Phase 11 / `RestockService`).
  - Infrastructure de requêtage unifiée `useApiQuery`, mise en cache, déduplication et annulation `AbortController` (Phase R03).
  - Agrégations et pagination SQL optimisées (Phase R04).
  - Synchronisation résiliente et indicateurs de fraîcheur fiables (Phase R05).
  - Isolation inter-personnages étanche (Phase R06).
- **Contrats & Références** :
  - Blueprint complet de refonte : `docs/UX_REDESIGN_BLUEPRINT.md`.
  - États UX et contrats de navigation : `docs/UX_STATES.md`.
  - Audit ergonomique initial : `docs/PRODUCT_REDESIGN_AUDIT.md`.
  - Invariants de domaine et métriques : `docs/DOMAIN_CONTRACTS.md`, `docs/METRICS.md`.

---

## 3. Périmètre inclus & Exclusions explicites

### Inclus
- **En-tête unifié & Indicateur ESI compact** :
  - Remplacement du bandeau de synchronisation de 80px par un badge discret dans le header (`FRESH`, `STALE`, `SYNCING`) avec horodatage et déclencheur manuel.
  - Panneau / tiroir latéral de diagnostic technique ESI déployable à la demande (quotas, cache 304, erreurs CCP).
- **Cockpit Décisionnel (Espace 1)** :
  - *Synthèse patrimoniale* : Répartition du capital en 5 états mutuellement exclusifs (Liquidités, Escrow, Stocks en vente au prix de revient, Stocks libres, Stocks dormants >30j).
  - *Performance de la période* : $CA_{brut}$, Investissement alloué TTC, Taxes et frais réels, Bénéfice net réalisé TTC, ROI TTC avec preuve arithmétique auditable.
  - *Flux de trésorerie net ($Cash\_Flow_{net} = \text{Encaissements Ventes} - \text{Décaissements Achats} - \text{Taxes \& Frais}$)*.
  - *Alertes opérationnelles prioritaires* : Ordres expirés/disparus non confirmés, ruptures imminentes de stocks clés, lots dormants immobilisés.
- **Espace Positions (Espace 2)** :
  - Fusion des ordres de marché et de l'inventaire physique en 2 sous-onglets synchronisés.
  - Table dense avec barres de progression, prix unitaire, valeur engagée et stock physique disponible en station (`inStockQuantity`).
- **Espace Analyses (Espace 3)** :
  - Catalogue d'articles avec recherche instantanée, vélocité $V_{jour}$, durée de détention $D_{detention}$, rendement capital-jour $R_{cap\_jour}$.
  - Matrices comparatives des paires de hubs (volumes, rentabilité TTC, flux commerciaux).
- **Espace Opérations (Espace 4)** :
  - Suggestions de transferts prioritaires (marchandises disponibles dans un autre hub sans rachat).
  - Table dense des achats de réapprovisionnement nets avec export CSV et copie EVE Multibuy.
- **Espace Transactions (Espace 5)** :
  - Grand Livre exhaustif des achats et ventes avec pagination SQL et tiroir de preuve contextuel.
  - Journal de portefeuille et des frais (taxes SCC, courtage).
  - Gestion des stocks d'ouverture et réconciliation FIFO.
- **Espace Configuration (Espace 6)** :
  - Gestion multi-personnages SSO, hubs commerciaux et mappings, sauvegardes atomiques SHA-256 et diagnostics serveur.
- **Modèle de fenêtrage intégré** :
  - Tiroir latéral (*SideDrawer*) pour l'inspection sans quitter la vue courante (ordre, transaction, lot).
  - Fenêtre Focus Product 360 à 4 onglets (Synthèse & Marché, Séries temporelles, Stocks & Stations, Transactions & Preuves).

### Exclusions
- Pas d'automatisation ou de manipulation en jeu (lecture seule ESI stricte).
- Pas d'algorithme d'arbitrage spéculatif ou de conseil d'achat prédictif.
- Pas d'introduction de dépendances graphiques lourdes dégradant les temps de rendu.

---

## 4. Architecture de Navigation Cible

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [LOGO] EVE TRADE DASHBOARD   │  Perso: [Altrue ▼]  │  Période: [30 derniers jours ▼]  │  ESI: [🟢 100%] [⚡] │ [⚙️] │
├──────────────┬──────────────┬──────────────┬──────────────┬───────────────────┬────────────────────────┤
│  1. COCKPIT  │ 2. POSITIONS │ 3. ANALYSES  │ 4.OPÉRATIONS │  5. TRANSACTIONS  │    6. CONFIGURATION    │
└──────────────┴──────────────┴──────────────┴──────────────┴───────────────────┴────────────────────────┘
```

---

## 5. Étapes de Réalisation (Découpage Modulaire)

1. **Étape 1 — Navigation en 6 espaces & Header compact** : Intégration du nouvel en-tête avec sélecteur de personnage, filtre de période, badge ESI compact et réduction des onglets à 6 espaces.
2. **Étape 2 — Infrastructure du Tiroir Latéral (SideDrawer)** : Composant de tiroir latéral contextuel accessible au clavier (Escape, focus trap) pour l'inspection des transactions, ordres et lots de stock.
3. **Étape 3 — Refonte du Cockpit central** : Synthèse patrimoniale en 5 états, KPIs de performance TTC épurés, flux d'alertes décisionnelles et suppression des cartes KPI doublonnées.
4. **Étape 4 — Espace Positions (Ordres & Inventaire)** : Regroupement cohérent des ordres actifs et de l'inventaire physique en sous-onglets avec table dense.
5. **Étape 5 — Espace Analyses & Product 360 à 4 onglets** : Restructuration de la fiche transversale Product 360 en fenêtre d'analyse compartimentée et intégration des matrices de hubs.
6. **Étape 6 — Espaces Opérations & Transactions** : Modernisation du réassort (transferts + achats nets Multibuy) et consolidation du Grand Livre et du Journal de portefeuille.
7. **Étape 7 — Espace Configuration, Diagnostics & Validation Finale** : Regroupement des réglages, tests d'accessibilité WCAG 2.1 AA, non-régression et couverture complète de la suite de tests.

---

## 6. Critères d'Acceptation Mesurables

- [x] La barre d'état ESI n'occupe plus d'espace vertical dans le flux principal de la page et est déportée dans l'en-tête avec un tiroir de diagnostic à la demande.
- [x] La barre de navigation principale comporte exactement 6 espaces de travail thématiques sans redondance.
- [x] Le Cockpit permet d'avoir en un seul coup d'œil la situation patrimoniale exacte et les alertes d'action sans défilement vertical sur écran standard (1080p).
- [x] Aucune carte KPI n'est dupliquée entre le Cockpit, le Grand Livre, les Ordres et les Hubs.
- [x] L'inspection d'une transaction, d'un ordre ou d'un lot de stock s'effectue via un tiroir latéral sans perte du contexte de recherche, de tri ou de pagination de la vue d'origine.
- [x] La fiche Product 360 est accessible en fenêtre Focus à 4 onglets depuis n'importe quel écran où apparaît un article.
- [x] Les listes d'achats de réapprovisionnement sont présentées sous forme de tableau dense avec bouton de copie EVE Multibuy immédiat.
- [x] Les alternatives tabulaires sont disponibles pour toutes les représentations graphiques.
- [x] Conformité d'accessibilité WCAG 2.1 AA (contrastes $\ge 4.5:1$, navigation clavier complète, fermeture `Escape`, focus trap).
- [x] L'ensemble de la suite de tests unitaires, d'intégration et de composants est validé au vert (`vitest run`).

---

## 7. Gestion des États de Données & Résilience UX

- Application stricte des 8 états visuels documentés dans `docs/UX_STATES.md` (`FRESH`, `STALE`, `PARTIAL`, `EMPTY`, `UNAVAILABLE`, `ERROR`, `UNKNOWN`).
- Chargement par squelettes (skeletons) non intrusifs pour chaque bloc indépendant.
- Les erreurs partielles d'une ressource (ex: indisponibilité temporaire des actifs) n'empêchent pas la consultation du Grand Livre ou des Ordres.

---

## 8. Définition de Terminé

Code réel implémenté + conformité stricte au `docs/UX_REDESIGN_BLUEPRINT.md` + validation complète des parcours utilisateurs au vert + CI verte + mise à jour de `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md`.

