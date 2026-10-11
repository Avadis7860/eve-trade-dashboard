# Blueprint de Refonte UX/UI & Architecture de l'Information

> **Document de cadrage canonique pour la refonte ergonomique et visuelle d'EVE Trade Dashboard (Préparation de la Phase 12).**  
> Ce document définit l'architecture de l'information cible, la rationalisation des parcours en 6 espaces de travail, le modèle de fenêtrage intégré (tiroirs latéraux, fenêtres d'analyse élargies, accordéons de preuve) et la feuille de route d'implémentation, sans altérer les contrats de domaine, les formules financières TTC ou les règles d'intégrité de données.

---

## 1. Diagnostic UX & Audit de l'existant

L'audit ergonomique du code source (`src/App.tsx`, `src/components/*`) et l'analyse des parcours réels mettent en lumière sept familles de frictions majeures :

### 1.1. Fragmentation de la navigation horizontale (9 onglets plats)
- **Constat dans le code :** `src/App.tsx` (L.1010-1095) aligne 9 boutons d'onglets au même niveau hiérarchique : `overview` (Cockpit), `analytics` (Product 360 & Séries), `ledger` (Grand Livre), `orders` (Ordres & Marché), `restock` (Réapprovisionnement), `hubs-roi` (Hubs & ROI TTC), `capital` (Capital & Stocks), `journal` (Journal & Frais), `roadmap` (Système).
- **Impact :** L'utilisateur doit constamment sauter d'un onglet à l'autre pour réaliser une tâche élémentaire (ex: vérifier un ordre de vente $\to$ inspecter le stock en station $\to$ vérifier la vélocité $\to$ passer un réassort).

### 1.2. Bandeau de synchronisation ESI redondant et encombrant
- **Constat dans le code :** `src/App.tsx` (L.1309-1358) injecte un bloc de statut ESI de plus de 80 pixels de haut au sommet de la vue principale, systématiquement visible quel que soit l'onglet actif.
- **Impact :** Perte sèche d'espace vertical sur écrans 1080p et ordinateurs portables, attirant l'attention sur la plomberie technique plutôt que sur les données financières et opérationnelles.

### 1.3. Mur de cartes KPI dupliquées (*KPI Walls*)
- **Constat dans le code :**
  - `DashboardOverview.tsx` (L.91-175) affiche 4 cartes (Chiffre d'affaires brut, Investissement alloué TTC, Bénéfice net TTC, ROI TTC).
  - `HubsRoiView.tsx` (L.135-210) réaffiche exactement les mêmes 4 cartes de synthèse financière.
  - `LedgerView.tsx` (L.65-110) affiche 4 cartes (Total transactions, Volume ventes, Chiffre d'affaires brut, Frais/Taxes).
  - `CapitalView.tsx` (L.80-140) affiche 5 cartes (Capital total, Liquidités, Escrow, Stocks engagés, Stocks physiques).
  - `OrdersView.tsx` (L.70-115) affiche 4 cartes (Ordres actifs, Valeur active, Volume restant, Réassort requis).
- **Impact :** Dilution de l'attention, répétition de métriques identiques avec des contextes légèrement différents, et défilement vertical obligatoire avant d'accéder aux données tabulaires.

### 1.4. Fiche Product 360 monolithique et linéaire
- **Constat dans le code :** `Product360Modal.tsx` présente sur une seule page déroulante de plus de 600 lignes : synthèse de stock, 8 indicateurs KPI, 4 graphiques/séries temporelles, tableau de décomposition physique par station, tableau des ordres ouverts, et registre des transactions avec preuves arithmétiques.
- **Impact :** Défilement vertigineux (*scroll fatigue*), difficulté à comparer simultanément la tendance des ventes et la localisation des stocks sans perdre son repère visuel.

### 1.5. Cartes de réapprovisionnement répétitives et verbeuses
- **Constat dans le code :** `RestockView.tsx` et le panneau de réapprovisionnement de `DashboardOverview.tsx` instancient de multiples cartes individuelles occupant une surface importante pour afficher des informations très structurées (Type ID, Hub cible, Quantité suggérée, Volume unitaire, Statut).
- **Impact :** Faible densité d'information, inadapté dès que le trader gère plus de 15 articles à réapprovisionner simultanément.

### 1.6. Rupture de contexte lors de l'inspection de détail
- **Constat dans le code :** L'inspection d'une transaction dans `LedgerView.tsx` (L.1512-1560 dans `App.tsx`) ou d'un ordre dans `OrdersView.tsx` utilise des modales modales centrées bloquantes ou nécessite de basculer d'onglet, détruisant la pagination, les filtres actifs ou la ligne de contexte où se trouvait le regard de l'utilisateur.
- **Impact :** Perte de repère visuel et friction cognitive lors des sessions d'audit financier.

### 1.7. Confusion entre monitoring technique et travail quotidien
- **Constat dans le code :** `SystemRoadmapView.tsx` mélange les métadonnées de santé serveur (`/api/health`), les quotas et budgets d'erreurs ESI (`/api/esi/status`), et le tableau statique d'avancement des phases du Masterplan.
- **Impact :** Pollution de l'interface opérationnelle par des diagnostics techniques de développement.

---

## 2. Cartographie exhaustive des composants et vues actuels

| Composant Actuel | Fichier Source | Rôle Métier Principal | Données & Endpoints Consommés | Décision UX Cible |
|---|---|---|---|---|
| **Header & Barres d'état** | `src/App.tsx` | En-tête globale, sélection SSO, bandeau ESI, 9 boutons onglets | `/api/auth/session`, `/api/esi/status`, `/api/ledger/sync-status` | **Compacter & Rationaliser** : Intégrer l'indicateur ESI dans le header sous forme de badge discret cliquable (ouvrant un tiroir technique). Réduire les onglets à 6 espaces. |
| **DashboardOverview** | `src/components/DashboardOverview.tsx` | Synthèse exécutive, métriques globales, alertes ordres, réassort express | `/api/ledger/summary`, `/api/roi/summary`, `/api/orders/summary`, `/api/orders/restock` | **Conserver & Épurer (Espace 1 : Cockpit)** : Conserver la vision patrimoniale et financière globale + alertes prioritaires. Éliminer les widgets redondants. |
| **CapitalView** | `src/components/CapitalView.tsx` | Décomposition physique et financière du capital (Liquidité, Escrow, Stocks) | `/api/capital/summary`, `/api/capital/breakdown`, `/api/capital/dormant` | **Fusionner (Espace 2 : Positions)** : Devient le sous-onglet/panneau "Inventaire & Capital" aux côtés des Ordres de marché. |
| **OrdersView** | `src/components/OrdersView.tsx` | Cycle de vie des ordres, progression de remplissage, détection de disparition | `/api/orders`, `/api/orders/summary`, `/api/orders/:id` | **Fusionner (Espace 2 : Positions)** : Devient le sous-onglet/panneau "Ordres de Marché", en lien direct avec l'inventaire en station. |
| **AnalyticsView** | `src/components/AnalyticsView.tsx` | Catalogue d'articles, recherche globale, pyramide des âges, séries temporelles | `/api/analytics/timeseries`, `/api/analytics/product/:id` | **Fusionner (Espace 3 : Analyses)** : Regroupe le catalogue d'exploration 360° et les comparatifs de hubs. |
| **HubsRoiView** | `src/components/HubsRoiView.tsx` | Paires de hubs, rentabilité TTC, stocks d'ouverture, gestion des mappings | `/api/roi/summary`, `/api/roi/allocations`, `/api/hubs`, `/api/hubs/mappings` | **Scinder** : La comparaison de performance des hubs rejoint **Analyses (Espace 3)** ; la configuration des hubs rejoint **Configuration (Espace 6)** ; les allocations manuelles rejoignent **Transactions (Espace 5)**. |
| **RestockView** | `src/components/RestockView.tsx` | Préparation des listes de réapprovisionnement, export CSV, copie Multibuy | `/api/orders/restock`, `/api/orders/restock/generate` | **Étendre (Espace 4 : Opérations)** : Intègre les suggestions de transferts prioritaires (Phase 11) et la table dense des achats nets avec copie Multibuy. |
| **LedgerView** | `src/components/LedgerView.tsx` | Grand Livre exhaustif des transactions d'achat et vente, filtrage, pagination | `/api/ledger/transactions`, `/api/ledger/summary`, `/api/ledger/filter-options` | **Conserver (Espace 5 : Transactions)** : Onglet principal "Grand Livre" avec inspection rapide en tiroir latéral. |
| **JournalView** | `src/components/JournalView.tsx` | Journal de portefeuille, taxes SCC, frais de courtage, dépôts/retraits | `/api/ledger/journal` | **Intégrer (Espace 5 : Transactions)** : Devient le sous-onglet "Journal de Portefeuille & Frais". |
| **SystemRoadmapView** | `src/components/SystemRoadmapView.tsx` | État ESI, santé serveur, roadmap Masterplan | `/api/health`, `/api/esi/status`, `/api/backup/audit` | **Déplacer (Espace 6 : Configuration)** : Intégré dans l'espace système sous forme d'onglet de diagnostic technique, distinct du travail de trading. |
| **Product360Modal** | `src/components/Product360Modal.tsx` | Fiche d'inspection transversale d'un article | `/api/analytics/product/:typeId`, `/api/assets/stock/:typeId` | **Transformer en Fenêtre d'Analyse Élargie à Onglets** : Fiche structurée avec sous-onglets (Synthèse & Marché, Séries Temporelles, Stocks & Stations, Historique & Preuves). |
| **PreferencesModal** | `src/components/PreferencesModal.tsx` | Format ISK, filtres par défaut | `localStorage` | **Conserver** en modale légère de préférences rapides ou intégrer dans **Configuration (Espace 6)**. |

---

## 3. Architecture de Navigation Cible (Les 6 Espaces Métier)

L'architecture abandonne la juxtaposition de tables techniques au profit de **6 espaces de décision spécialisés**, complétés par un en-tête d'environnement unifié :

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [LOGO] EVE TRADE DASHBOARD   │  Perso: [Altrue ▼]  │  Période: [30 derniers jours ▼]  │  ESI: [🟢 100%] [⚡] │ [⚙️] │
├──────────────┬──────────────┬──────────────┬──────────────┬───────────────────┬────────────────────────┤
│  1. COCKPIT  │ 2. POSITIONS │ 3. ANALYSES  │ 4.OPÉRATIONS │  5. TRANSACTIONS  │    6. CONFIGURATION    │
│  (Synthèse & │ (Ordres &    │ (Product 360 │ (Transferts  │  (Grand Livre &   │    (Comptes, Hubs,     │
│   Alertes)   │  Inventaire) │  & Hubs)     │  & Réassort) │   Journal Frais)  │     Diagnostics)       │
└──────────────┴──────────────┴──────────────┴──────────────┴───────────────────┴────────────────────────┘
```

### 3.1. Espace 1 : COCKPIT (Vue de Synthèse & Pilotage)
- **Rôle :** Offrir au trader une vision nette, instantanée et exhaustive de sa situation patrimoniale, de ses performances réelles sur la période et des décisions urgentes à prendre.
- **Sous-blocs :**
  1. *Synthèse Patrimoniale Consolidée* : Répartition du capital (Liquidité disponible, Escrow d'achat, Marchandises en ordre de vente au prix de revient, Stock libre en hub, Stock dormant, Stock en transit).
  2. *Performance Réalisée TTC de la Période* : Chiffre d'affaires brut ($CA_{brut}$), Investissement TTC alloué ($Inv_{TTC}$), Bénéfice net réalisé TTC ($Profit_{TTC}$), Taux de ROI TTC ($ROI_{TTC}$), Cash-flow net de trésorerie.
  3. *Flux d'Alertes Décisionnelles* : Ordres expirés ou disparus non confirmés, ruptures imminentes de stocks clés, stocks dormants >30j immobilisant du capital, transferts prioritaires en attente.
  4. *Raccourcis d'action* : Accès direct en 1 clic aux opérations de réassort, à la réconciliation financière et aux fiches Product 360 des articles en alerte.

### 3.2. Espace 2 : POSITIONS (Marché & Inventaire Physique)
- **Rôle :** Centraliser l'ensemble des engagements actifs du trader, en éliminant la frontière artificielle entre ordres de marché et stocks en station.
- **Organisation interne (Sous-onglets ou Vues synchronisées) :**
  - **Onglet A : Ordres de Marché** : Table dense des ordres d'achat et de vente actifs, volume restant vs total, prix unitaire, valeur engagée (escrow pour achat, prix de revient vs valeur de vente pour vente), statut de cycle de vie (`ACTIVE`, `PARTIALLY_FILLED`, `DISAPPEARED_UNCONFIRMED`), et disponibilité du stock physique en station (`inStockQuantity`).
  - **Onglet B : Inventaire Physique & Capital Engagé** : Décomposition des actifs par station et statut mutuellement exclusif (`COMMITTED_SELL_ORDER`, `FREE_HUB_STOCK`, `REMOTE_DORMANT_STOCK`, `IN_TRANSIT_STOCK`), valeur de revient estimée, jours d'inactivité, et bouton d'action contextuelle ("Créer ordre de vente", "Transférer vers Hub").

### 3.3. Espace 3 : ANALYSES (Product 360 & Comparaisons de Hubs)
- **Rôle :** Fournir l'outillage analytique approfondi sans encombrer les vues d'action quotidienne.
- **Organisation interne :**
  - **Onglet A : Catalogue & Fiches Product 360** : Recherche instantanée d'articles, filtre par catégorie, tableau de vélocité ($V_{jour}$), durée moyenne de détention ($D_{detention}$), rendement capital-jour ($R_{cap\_jour}$), et ouverture de la fiche Product 360 détaillée.
  - **Onglet B : Performance & Flux entre Hubs** : Matrice des paires de hubs (ex: Jita $\to$ Amarr, Jita $\to$ Dodixie), comparaison des volumes vendus, rentabilité TTC par axe commercial, taux de couverture des coûts et identification des corridors les plus performants.
  - **Onglet C : Pyramide des Âges & Inactivité** : Vue globale de la vétusté du stock immobilisé (0-14j, 15-30j, 31-60j, 61-90j, >90j) avec identification du capital dormant.

### 3.4. Espace 4 : OPÉRATIONS (Transferts & Réapprovisionnement)
- **Rôle :** Préparer efficacement les mouvements logistiques et les sessions d'achat avant déplacement en jeu.
- **Organisation interne :**
  - **Onglet A : Transferts Prioritaires (Phase 11)** : Articles dont le stock est insuffisant sur un hub de vente mais disponible dans un autre hub ou une station secondaire (évite d'acheter inutilement).
  - **Onglet B : Achats de Réapprovisionnement Net** : Table dense des besoins d'achat nets basés sur le run-rate historique et le stock physique total, avec sélecteur de hub source (ex: Jita 4-4), filtre par priorité, export CSV et bouton **Copier EVE Multibuy**.

### 3.5. Espace 5 : TRANSACTIONS (Grand Livre & Journal de Portefeuille)
- **Rôle :** Offrir une traçabilité comptable et financière absolue, vérifiable et auditable ligne par ligne.
- **Organisation interne :**
  - **Onglet A : Grand Livre des Ventes & Achats** : Table chronologique des transactions ESI avec filtres multicritères (type, station, hub, date, client), pagination SQL, statut de couverture FIFO (`COMPLETE`, `PARTIAL`, `UNKNOWN`), preuve arithmétique en tiroir latéral et lien direct d'allocation manuelle.
  - **Onglet B : Journal de Portefeuille & Frais** : Registre exhaustif des écritures de wallet (taxes de vente SCC, frais de courtage, transferts de fonds, commissions de corpo).
  - **Onglet C : Réconciliation & Stocks d'Ouverture** : Gestionnaire des stocks d'ouverture (`OpeningBalanceLot`), déclencheur de réconciliation chronologique FIFO et audit des allocations de coûts.

### 3.6. Espace 6 : CONFIGURATION (Comptes, Hubs & Diagnostic Système)
- **Rôle :** Isoler l'administration, la gestion multi-personnages, le paramétrage des hubs et la surveillance technique du système.
- **Organisation interne :**
  - **Onglet A : Personnages & Écosystème SSO** : Liaison/déliaison de personnages EVE SSO, sélection du personnage actif ou de l'écosystème commercial global, vérification des scopes ESI accordés.
  - **Onglet B : Hubs Commerciaux & Mappings** : Définition des hubs (Jita, Amarr, Dodixie, Rens, Hek, hubs personnalisés), association des stations/structures Upwell, auto-découverte depuis les transactions.
  - **Onglet C : Sauvegardes & Intégrité** : Export/restauration atomique de la base avec empreinte SHA-256, rapport d'audit d'intégrité des données.
  - **Onglet D : Diagnostic Passerelle ESI & Cache** : Quotas d'erreurs ESI (`X-ESI-Error-Limit-Remain`), latences réseau, état du cache `304 Not Modified`, journal des synchronisations par ressource et statut du serveur.

---

## 4. Matrice de Décision Détaillée (Vues & Composants)

| Élément Actuel | Emplacement Actuel | Décision | Destination Cible | Justification & Valeur Utilisateur |
|---|---|---|---|---|
| **Bandeau ESI 80px** | Haut de toutes les vues (`App.tsx`) | **Transformer en composant compact** | En-tête global (`Header`) | Libère 80px de hauteur utile sur chaque écran ; diagnostic complet accessible en 1 clic dans un tiroir latéral. |
| **Cartes KPI du Cockpit** | `DashboardOverview.tsx` | **Conserver & Recentrer** | Espace 1 (Cockpit) | Constitue le seul endroit où la vue patrimoniale macro et financière globale est résumée. |
| **Cartes KPI du Grand Livre** | `LedgerView.tsx` | **Remplacer par un bandeau contextuel compact** | Espace 5 (Transactions) | Évite le doublon avec le Cockpit ; n'affiche que les métriques spécifiques au filtre de transactions en cours (CA de la sélection, nb lignes, % couverture). |
| **Cartes KPI des Hubs** | `HubsRoiView.tsx` | **Déplacer & Compacter** | Espace 3 (Analyses $\to$ Hubs) | Supprime la duplication avec le Cockpit ; n'affiche que les métriques propres à la paire de hubs sélectionnée. |
| **Cartes KPI des Ordres** | `OrdersView.tsx` | **Compacter en sous-en-tête** | Espace 2 (Positions $\to$ Ordres) | Affiche de manière dense : Total ordres actifs, Escrow achat bloqué, Valeur de revient du stock en vente, Nb alertes. |
| **Table des Ordres** | `OrdersView.tsx` | **Conserver & Enrichir** | Espace 2 (Positions $\to$ Ordres) | Table principale de gestion des ordres avec barres de progression et statut de stock physique en station. |
| **Table du Grand Livre** | `LedgerView.tsx` | **Conserver** | Espace 5 (Transactions $\to$ Grand Livre) | Table haute performance avec pagination SQL, filtres réactifs et ouverture du tiroir de preuve. |
| **Journal de Portefeuille** | `JournalView.tsx` | **Transformer en onglet interne** | Espace 5 (Transactions $\to$ Journal) | Regroupe toutes les opérations financières au même endroit au lieu d'occuper un onglet principal dédié. |
| **Cartes de Réapprovisionnement** | `RestockView.tsx` | **Remplacer par une table dense** | Espace 4 (Opérations $\to$ Réassort) | Une table dense avec tri et filtre permet de traiter 50 articles en un coup d'œil au lieu de faire défiler des cartes. |
| **Suggestions de Transferts** | *Nouveau (Phase 11)* | **Intégrer en onglet dédié** | Espace 4 (Opérations $\to$ Transferts) | Priorise la mobilisation des stocks existants avant tout achat. |
| **Fiche Product 360** | `Product360Modal.tsx` | **Restructurer en Fenêtre d'Analyse à 4 Onglets** | Modal Focus transversale (accessible partout) | Élimine le défilement interminable en compartimentant Synthèse, Graphiques, Stocks et Preuves. |
| **Matrices de Paires de Hubs** | `HubsRoiView.tsx` | **Transformer en onglet d'analyse** | Espace 3 (Analyses $\to$ Hubs) | Analyse comparative de rentabilité commerciale entre axes d'achat et de vente. |
| **Gestion des Mappings Hubs** | `HubsRoiView.tsx` | **Déplacer en configuration** | Espace 6 (Configuration $\to$ Hubs) | Tâche administrative d'association station-hub, isolée du flux analytique. |
| **Gestion Stocks d'Ouverture** | `HubsRoiView.tsx` | **Déplacer en transactions** | Espace 5 (Transactions $\to$ Rapprochement) | Tâche comptable liée à la réconciliation des coûts d'achat. |
| **Feuille de Route Masterplan** | `SystemRoadmapView.tsx` | **Conserver dans l'espace système** | Espace 6 (Configuration $\to$ Système) | Disponible pour suivi du projet sans polluer l'expérience de trading. |

---

## 5. Hiérarchie de l'Information (Les 3 Niveaux de Consultation)

Pour garantir une expérience utilisateur à la fois rapide et exhaustive, chaque écran respecte une stricte hiérarchie à 3 niveaux :

```
┌────────────────────────────────────────────────────────────────────────┐
│ NIVEAU 1 — IMMÉDIATEMENT VISIBLE (Décision & Synthèse)                │
│ Données macro, soldes, alertes bloquantes, KPIs clés, listes denses    │
├────────────────────────────────────────────────────────────────────────┤
│ NIVEAU 2 — ACCESSIBLE EN UN CLIC (Contexte & Tiroir latéral)           │
│ Fiche rapide article, preuve de transaction, détail d'un ordre,        │
│ décomposition des stocks par station, motif d'une suggestion           │
├────────────────────────────────────────────────────────────────────────┤
│ NIVEAU 3 — ANALYSE APPROFONDIE (Fenêtre Focus & Preuves étendues)      │
│ Fiche Product 360 complète, séries temporelles multi-axes, calculs     │
│ de rentabilité détaillés, historique complet, logs de synchronisation  │
└────────────────────────────────────────────────────────────────────────┘
```

### Règle d'or : "Zéro perte d'information, zéro encombrement inutile"
- Aucune donnée métier n'est supprimée : les formules arithmétiques complètes, les identifiants ESI bruts et les dates UTC exactes sont toujours présents, mais déportés au Niveau 2 (Tiroir) ou Niveau 3 (Fenêtre Focus).
- L'utilisateur ne subit plus de défilement horizontal ou vertical superflu au Niveau 1.

---

## 6. Modèle de Consultation et Fenêtrage Intégré

Le système repose sur 4 modes de présentation strictement hiérarchisés :

```
┌──────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
│ MODE DE PRÉSENTATION         │ CAS D'USAGE EXCLUSIF         │ COMPORTEMENT D'AFFICHAGE     │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ 1. Tiroir Latéral (Drawer)   │ Inspection contextuelle      │ Glisse depuis la droite      │
│                              │ d'un élément sélectionné     │ (largeur 480px-540px).       │
│                              │ (transaction, ordre, stock)  │ Conserve l'écran d'origine.  │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ 2. Fenêtre Focus Élargie     │ Analyse multidimensionnelle  │ Modale centrée large (90vw,  │
│    (Focus Modal)             │ approfondie (Product 360,    │ max 1200px) avec onglets     │
│                              │ comparatif de hubs)          │ internes.                    │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ 3. Sections Dépliables       │ Détails secondaires,         │ Dépliage accordéon en ligne  │
│    (Accordéons)              │ explications de formules,    │ sans masquer le tableau ou   │
│                              │ notes d'audit                │ la carte parente.            │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ 4. Modales d'Action          │ Confirmations irréversibles, │ Modale compacte centrée      │
│    (Action Dialogs)          │ saisies de formulaires courts│ (max 480px) avec focus       │
│                              │ (ajout hub, stock ouverture) │ automatique et touches Esc/↵ │
└──────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
```

### 6.1. Spécifications du Tiroir Latéral (Drawer)
- **Largeur :** 500px fixe sur grand écran, pleine largeur sur mobile (`<640px`).
- **Comportement :**
  - S'ouvre instantanément sans recharger la page.
  - Préserve intégralement l'état de la vue sous-jacente : filtres, page active, tri, terme de recherche et position de défilement.
  - Fermeture par touche `Escape`, clic sur le fond semi-transparent (`backdrop`) ou bouton `✕`.
  - Navigation directe vers la Fenêtre Focus Product 360 via un bouton dédié dans l'en-tête du tiroir ("Ouvrir fiche complète 360°").

### 6.2. Spécifications de la Fenêtre Focus Product 360
- **Structure interne à 4 onglets :**
  1. *Vue Synthétique & Marché* : Stock total possédé (libre, en vente, dormant, transit), valorisation de revient, prix moyen pondéré d'achat, ordres de vente actifs et vitesse d'écoulement ($V_{jour}$).
  2. *Séries Temporelles & Tendances* : Graphiques interactifs de volume quotidien de ventes, chiffre d'affaires, profit cumulé TTC et vélocité, avec bascule immédiate vers une alternative tabulaire accessible.
  3. *Localisation des Stocks & Hubs* : Tableau exhaustif des quantités par station/structure, jours d'inactivité par lot et actions contextuelles de transfert.
  4. *Historique des Transactions & Preuves* : Liste chronologique des achats et ventes associés à cet article avec preuve de réconciliation FIFO et calcul du profit unitaire.

### 6.3. Règles de réutilisation des composants
- Le composant `ItemHeaderBadge` (icône, nom de l'article, Type ID, badge de statut) est partagé à l'identique entre le Grand Livre, les Ordres, le Tiroir et la Fiche Product 360.
- Le composant `FormulaProofBox` (détail du calcul du ROI TTC : numérateur, dénominateur, frais déduits) est réutilisé dans le Grand Livre, le Tiroir de transaction et la vue Hubs.

---

## 7. Schémas Textuels des Écrans et Fenêtres

### 7.1. En-tête Global & Navigation Principale
```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [⛊] EVE TRADE DASHBOARD    Perso: [Altrue ▼] (2 liés)   Période: [30 derniers jours ▼]   ESI: [🟢 FRESH]  │
├──────────────┬──────────────┬──────────────┬──────────────┬───────────────────┬────────────────────────┤
│  1. COCKPIT  │ 2. POSITIONS │ 3. ANALYSES  │ 4.OPÉRATIONS │  5. TRANSACTIONS  │    6. CONFIGURATION    │
└──────────────┴──────────────┴──────────────┴──────────────┴───────────────────┴────────────────────────┘
```

### 7.2. Espace 1 : COCKPIT
```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ SYNTHÈSE PATRIMONIALE CONSOLIDÉE                                              Total Actifs: 45.28 B ISK│
├─────────────────┬─────────────────┬─────────────────┬─────────────────┬────────────────────────────────┤
│ Liquidité ISK   │ Escrow Achats   │ Stocks en Vente │ Stocks Libres   │ Stocks Dormants (>30j)         │
│ 12.45 B ISK     │ 3.20 B ISK      │ 18.50 B ISK     │ 8.63 B ISK      │ 2.50 B ISK [⚠️ 14 articles]    │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┴────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PERFORMANCE RÉALISÉE TTC (Période : 30 jours)                                       Couverture: 94.2%  │
├─────────────────┬─────────────────┬─────────────────┬─────────────────┬────────────────────────────────┤
│ Chiffre Affaires│ Investissement  │ Taxes & Frais   │ Bénéfice Net TTC│ ROI TTC Réalisé                │
│ 28.40 B ISK     │ 21.10 B ISK     │ 1.42 B ISK      │ +5.88 B ISK     │ +27.87% [Preuve arithmétique ℹ️]│
└─────────────────┴─────────────────┴─────────────────┴─────────────────┴────────────────────────────────┘
┌─────────────────────────────────────────────────┬──────────────────────────────────────────────────────┐
│ ALERTES OPÉRATIONNELLES PRIORITAIRES (4)        │ RÉAPPROVISIONNEMENTS & TRANSFERTS URGENTS (5)        │
├─────────────────────────────────────────────────┼──────────────────────────────────────────────────────┤
│ 🔴 2 Ordres de vente expirés / disparus         │ ⚡ Tritanium : 500k u. transférables depuis Amarr     │
│ 🟡 3 Articles en rupture imminente (<2j stock)  │ 🛒 Prowler : Acheter 2 u. à Jita (Multibuy prêt)     │
│ ⚪ 14 Lots dormants immobilisant 2.50 B ISK     │ 🛒 Heavy Armor Repairer II : Acheter 45 u. à Jita    │
│ [Voir toutes les alertes →]                     │ [Ouvrir l'espace Opérations →]                       │
└─────────────────────────────────────────────────┴──────────────────────────────────────────────────────┘
```

### 7.3. Espace 2 : POSITIONS (Marché & Inventaire)
```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ POSITIONS : [● Ordres de Marché (34)]   [○ Inventaire & Capital Physique (128)]                        │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Filtres : [Tous les états ▼]  [Tous les Hubs ▼]  [Recherche article...]               [Exporter CSV 📥] │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Article              Hub       Sens    Prix Unit.   Volume Restant / Total    Valeur Engagée    Statut │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Ishtar               Jita 4-4  VENTE   245.0 M ISK  ████████░░ 8 / 10 (80%)   1.96 B ISK (Rev.) ACTIF  │
│ Heavy Capacitor II   Amarr     VENTE   1.85 M ISK   ██████████ 100 / 100      185.0 M ISK       ACTIF  │
│ Megathron            Dodixie   ACHAT   195.0 M ISK  ░░░░░░░░░░ 0 / 5 (0%)     975.0 M (Escrow)  EXPIRÉ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.4. Tiroir Latéral d'Inspection (Drawer)
```
┌────────────────────────────────────────────────────┐
│ DÉTAIL D'ORDRE DE MARCHÉ                       [✕] │
├────────────────────────────────────────────────────┤
│ Ishtar                                 Type ID: 587│
│ Station : Jita IV - Moon 4 - Caldari Navy Assembly │
├────────────────────────────────────────────────────┤
│ CARACTÉRISTIQUES DE L'ORDRE                        │
│ • Order ID ESI : #6849204829                       │
│ • Sens : Vente (Sell Order)                        │
│ • Prix unitaire : 245,000,000 ISK                  │
│ • Volume : 8 restant / 10 initial (2 vendus)       │
│ • Progression : [████████░░░░░░░░] 20% exécuté     │
│ • Émis le : 2026-09-28 14:22:00 UTC (Durée: 90j)   │
│ • Statut cycle de vie : PARTIALLY_FILLED           │
├────────────────────────────────────────────────────┤
│ STOCKS PHYSIQUES SUR PLACE                         │
│ • Stock libre en station : 4 unités                │
│ • Stock en ordre de vente : 8 unités               │
│ • Total présent dans ce hub : 12 unités            │
├────────────────────────────────────────────────────┤
│ ACTIONS CONTEXTUELLES                              │
│ [🔍 Ouvrir Fiche Product 360 Complète]             │
│ [🛒 Ajouter au Réapprovisionnement]                │
└────────────────────────────────────────────────────┘
```

### 7.5. Fenêtre d'Analyse Élargie : PRODUCT 360
```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PRODUCT 360 : Ishtar (Type ID: 587)                                             [Exporter CSV] [✕]     │
├──────────────────────────┬──────────────────────────┬──────────────────────────┬───────────────────────┤
│ [● Synthèse & Marché]    │ [○ Séries Temporelles]   │ [○ Stocks & Emplacements]│ [○ Transactions & ROI]│
├──────────────────────────┴──────────────────────────┴──────────────────────────┴───────────────────────┤
│ INDICATEURS CLÉS (Fenêtre 30 jours)                                                                    │
│ • Stock Total : 18 unités (8 en vente, 4 libres Jita, 6 libres Amarr)                                  │
│ • Valeur de Revient Globale : 3.69 B ISK (Prix moyen unitaire : 205.0 M ISK)                           │
│ • Vélocité : 1.4 unités / jour  │  Durée Moyenne Détention : 6.2 jours  │  Rendement Cap-Jour : +4.1% │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SITUATION PAR HUB & EMBLACEMENT                                                                        │
│ Hub / Station                               Stock Libre    En Vente    Dormant (>30j)   Valeur Revient │
│ Jita IV - Moon 4 - Caldari Navy Assembly    4 unités       8 unités    0                2.46 B ISK     │
│ Amarr VIII (Oris) - Emperor Family Academy  6 unités       0           0                1.23 B ISK     │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SUGGESTION OPÉRATIONNELLE : ⚡ Transférer 4 unités d'Amarr vers Jita au lieu d'acheter.                │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Parcours Utilisateurs Représentatifs (Avant / Après)

### Parcours 1 : Inspection d'un article depuis le Grand Livre
- **Avant :**
  1. L'utilisateur repère une vente suspecte ou très rentable dans `LedgerView`.
  2. Il clique sur le nom de l'article $\to$ cela remplit uniquement le champ texte de recherche de la page.
  3. Pour voir son stock réel, il doit cliquer sur l'onglet `capital`, retrouver l'article et scroller.
  4. Pour voir ses ordres en cours, il doit cliquer sur l'onglet `orders`, filtrer à nouveau.
  5. Pour voir sa rentabilité globale, il doit aller sur `hubs-roi` ou `analytics`.
  6. *Bilan : 5 changements d'onglets, perte du filtre d'origine du Grand Livre.*
- **Après :**
  1. L'utilisateur clique sur l'article dans le Grand Livre.
  2. Un **Tiroir Latéral** s'ouvre instantanément : stock total possédé, ordres en cours, rentabilité unitaire et preuve arithmétique de la vente.
  3. S'il souhaite une analyse approfondie des ventes sur 90 jours, il clique sur "Fiche 360°" qui s'ouvre en **Fenêtre Focus** par-dessus le Grand Livre.
  4. Il referme la fenêtre : il se retrouve **exactement sur la même ligne et la même page** du Grand Livre.
  5. *Bilan : 0 changement d'onglet, contexte 100% préservé.*

### Parcours 2 : Traitement des ordres de vente expirés ou disparus
- **Avant :**
  1. L'utilisateur consulte le Cockpit.
  2. Il voit une carte mentionnant des ordres à vérifier.
  3. Il clique sur `orders`, cherche parmi les 50 ordres ceux avec le tag orange `DISAPPEARED_UNCONFIRMED`.
  4. Il doit ensuite basculer sur `restock` pour créer manuellement une ligne d'achat.
- **Après :**
  1. Dans le Cockpit, le bloc **Alertes Opérationnelles** liste directement les 2 ordres expirés/disparus.
  2. En cliquant sur l'alerte, un tiroir s'ouvre montrant l'ordre, les transactions de vente correspondantes pour confirmer l'exécution, et l'état du stock restant.
  3. Un bouton "Reconstituer le stock" propose en 1 clic un transfert depuis un hub secondaire ou un ajout à la liste d'achat Multibuy.

### Parcours 3 : Préparation de la session de réapprovisionnement
- **Avant :**
  1. L'utilisateur va sur `restock`.
  2. Il clique sur "Générer les suggestions".
  3. Une liste de cartes massives apparaît, proposant systématiquement d'acheter à Jita même s'il possède déjà 500 unités à Dodixie.
  4. La navigation est lente et l'espace mal exploité.
- **Après :**
  1. L'utilisateur se rend dans l'espace **Opérations**.
  2. Il consulte d'abord l'onglet **Transferts Prioritaires** : il valide la liste des marchandises à déplacer entre hubs sans dépenser d'ISK.
  3. Il bascule sur l'onglet **Achats Nets** : une table dense lui présente les seuls achats indispensables, triés par priorité et budget.
  4. Il clique sur "Copier pour EVE Multibuy" et colle directement dans le client de jeu.

---

## 9. Organisation Visuelle Détaillée par Espace de Travail

### 9.1. Cockpit
- **Disposition :** Grille responsive à 2 rangées :
  - Rangée 1 : Barre patrimoniale (5 métriques de capital) + Bandeau de performance réalisée TTC.
  - Rangée 2 (2 colonnes 50/50 sur desktop) : Colonne gauche = Alertes prioritaires et actions requises ; Colonne droite = Flux opérationnels et raccourcis d'achat/transfert.
- **Principe de conception :** Aucune table paginée dans le cockpit ; uniquement des données d'arbitrage et des synthèses décisionnelles.

### 9.2. Positions
- **Disposition :** En-tête avec bascule d'onglets (Ordres de Marché / Inventaire & Stocks) + barre de filtres commune (Hub, État, Recherche texte) + Table dense avec colonnes triables.
- **Colonnes de la table Ordres :** Article (avec icône et Type ID), Hub/Station, Sens (Achat/Vente), Prix unitaire, Volume (barre de progression colorée), Valeur engagée, Date d'émission/expiration, Statut du cycle de vie, Stock physique en station, Actions (Tiroir détail, Product 360).

### 9.3. Analyses
- **Disposition :** Barre supérieure de recherche globale d'articles avec autocomplétion rapide + 3 sous-vues (Catalogue 360, Comparatif Paires de Hubs, Pyramide des Âges).
- **Graphiques :** Utilisation de graphiques vectoriels légers (SVG/Canvas), avec infobulles riches au survol et commutateur immédiat "Afficher sous forme de tableau".

### 9.4. Opérations
- **Disposition :** Sélecteur de hub d'approvisionnement cible + configuration de l'horizon de couverture (ex: 14j, 30j) + 2 sous-onglets (Transferts suggérés / Achats nécessaires) + Boutons d'export (CSV, Copie Multibuy).

### 9.5. Transactions
- **Disposition :** Barre de filtres avancés (Type de flux, Dates de début/fin, Hub, Article, Client) + Table du Grand Livre haute performance avec pagination SQL + Bouton d'ouverture du tiroir de preuve et d'allocation manuelle.

### 9.6. Configuration
- **Disposition :** Menu latéral vertical interne à 4 entrées (Personnages SSO, Hubs & Mappings, Sauvegardes & Intégrité, Diagnostic ESI/Serveur) pour une gestion claire et compartimentée.

---

## 10. Contraintes d'Accessibilité, Responsive & Performance

### 10.1. Accessibilité (Norme WCAG 2.1 AA)
- **Contraste des montants :** Ratios de contraste $\ge 4.5:1$ pour le texte standard et $\ge 3:1$ pour les grands chiffres financiers sur fond sombre.
- **Navigation clavier intégrale :**
  - Parcours séquentiel logique (`Tab`, `Shift+Tab`).
  - Fermeture systématique des tiroirs et modales par la touche `Escape`.
  - Piégeage du focus (*focus trapping*) à l'intérieur des modales et tiroirs ouverts.
  - Activation des actions de tableau et boutons par `Enter` ou `Space`.
- **Alternatives textuelles & Tables accessibles :** Tout graphique ou visualisation temporelle dispose d'un tableau HTML sémantique alternatif immédiatement accessible aux lecteurs d'écran.
- **Sémantique des états :** Utilisation d'attributs `aria-expanded`, `aria-controls`, `aria-selected` et `role="dialog"`.

### 10.2. Responsive Design
- **Desktop (1920x1080 & 1440x900) :** Optimisation pour affichage sans défilement vertical du Niveau 1.
- **Laptop (1280x800) :** Adaptation de la grille du Cockpit en 1 colonne empilée fluide ; tiroir latéral à 450px.
- **Tablette & Mobile (<768px) :**
  - Navigation par menu rétractable (*hamburger* ou barre d'onglets inférieure).
  - Tiroirs latéraux occupant 100% de la largeur de l'écran.
  - Tables avec défilement horizontal fluide et colonnes prioritaires épinglées.

### 10.3. Performance de Rendu
- **Zero Layout Shift (CLS < 0.05) :** Réservation d'espace fixe pour les cartes KPI et conteneurs de graphiques via des squelettes de chargement (*skeletons*).
- **Virtualisation / Pagination serveur :** Exploitation stricte de la pagination SQL (Phase R04) pour limiter le DOM à 25-50 lignes par tableau.
- **Gestionnaire de Requêtes Frontend (Phase R03) :**
  - Utilisation systématique de `useApiQuery` et du `QueryClient` unifié (`src/utils/apiClient.tsx`).
  - Déduplication des requêtes simultanées (*request coalescing*).
  - Annulation automatique des requêtes obsolètes via `AbortController` lors de la frappe ou du changement d'onglet.
  - Invalidation ciblée du cache lors des synchronisations sans rechargement global.

---

## 11. Risques de Régression et Dépendances Techniques

### 11.1. Invariants de Domaine & Garde-fous Métier
- **Intégrité des états :** Les statuts `KNOWN`, `UNKNOWN`, `PARTIAL`, `ERROR`, `ABSENT`, `EMPTY`, `FRESH` et `STALE` ne doivent en aucun cas être amalgamés à `0` ou `[]`.
- **Formules financières :** Le calcul du $Profit_{TTC}$ et du $ROI_{TTC}$ doit strictement appliquer les définitions de `docs/METRICS.md` et `docs/DOMAIN_CONTRACTS.md`. Aucun double comptage des taxes SCC ou courtage n'est toléré.
- **Immuabilité ESI :** L'application demeure strictement en lecture seule vis-à-vis du marché EVE. Aucune action de jeu n'est déclenchée.
- **Isolation inter-personnages :** Les données multi-personnages doivent respecter les garde-fous d'isolation établis en Phase R06.

### 11.2. Matrice des Dépendances Techniques Amont
- **Phase R03 (Architecture requêtes UI) :** Doit fournir les hooks stables `useApiQuery` et l'invalidation par clé.
- **Phase R04 (Calculs métier & Accès SQL) :** Doit fournir les agrégations SQL optimisées et les filtres côté base.
- **Phase R05 (Synchronisation ESI résiliente) :** Doit fournir les curseurs fiables et l'état de fraîcheur sans régression.
- **Phase R06 (Sécurité, Isolation & Backup) :** Doit garantir l'étanchéité des sessions multi-personnages.
- **Phase 10.bis (Wallets & Liquidités) :** Doit fournir les soldes réels de portefeuille pour alimenter la barre patrimoniale.
- **Phase 11 (Transferts & Réapprovisionnement) :** Doit fournir les endpoints de détection des transferts inter-hubs.

---

## 12. Découpage et Feuille de Route de la Phase 12

La Phase 12 sera exécutée de manière modulaire en **7 étapes de livraison autonomes**, chacune validée par des tests unitaires et d'intégration avant passage à la suivante :

```
┌────────────────────────────────────────────────────────────────────────┐
│ ÉTAPE 1 : Shell Applicatif, Navigation en 6 Espaces & Header Compact  │
├────────────────────────────────────────────────────────────────────────┤
│ ÉTAPE 2 : Tiroir Latéral Contextuel (Drawer) & Modèle de Fenêtrage     │
├────────────────────────────────────────────────────────────────────────┤
│ ÉTAPE 3 : Cockpit Décisionnel Épuré (Patrimoine, Performance, Alertes) │
├────────────────────────────────────────────────────────────────────────┤
│ ÉTAPE 4 : Espace Positions Unifié (Ordres de Marché & Stocks Physiques)│
├────────────────────────────────────────────────────────────────────────┤
│ ÉTAPE 5 : Espace Analyses & Restructuration Product 360 à 4 Onglets   │
├────────────────────────────────────────────────────────────────────────┤
│ ÉTAPE 6 : Espaces Opérations (Transferts/Achats) & Transactions        │
├────────────────────────────────────────────────────────────────────────┤
│ ÉTAPE 7 : Espace Configuration, Diagnostic ESI & Validation Finale UX │
└────────────────────────────────────────────────────────────────────────┘
```

### Détail des Étapes de Réalisation :

1. **Étape 1 — Navigation en 6 espaces & Header compact :**
   - Mise en place du nouveau `AppHeader` avec sélecteur de personnage compact, période globale et badge d'état ESI.
   - Refonte de la barre d'onglets principale réduite à 6 espaces (Cockpit, Positions, Analyses, Opérations, Transactions, Configuration).
   - Intégration du tiroir latéral de diagnostic ESI.

2. **Étape 2 — Infrastructure du Tiroir Latéral & Fenêtrage :**
   - Composant générique `SideDrawer` réutilisable avec gestion du focus, accessibilité clavier et backdrop.
   - Intégration de l'inspection rapide des transactions, ordres et lots de stock sans rechargement de page.

3. **Étape 3 — Cockpit Décisionnel Central :**
   - Refonte complète de `DashboardOverview.tsx` : barre patrimoniale (5 piliers de capital), bloc de rentabilité réalisée TTC avec infobulle de preuve, et flux d'alertes décisionnelles.
   - Suppression définitive des cartes KPI redondantes.

4. **Étape 4 — Espace Positions (Ordres & Stocks) :**
   - Fusion de la gestion des ordres (`OrdersView`) et des positions physiques (`CapitalView`) en un espace cohérent à 2 sous-onglets.
   - Table dense des ordres avec barres de progression et stock en station.

5. **Étape 5 — Espace Analyses & Product 360 à 4 Onglets :**
   - Restructuration de `Product360Modal.tsx` en fenêtre d'analyse compartimentée (Synthèse, Graphiques temporels, Localisation stations, Preuves de transaction).
   - Intégration des matrices de paires de hubs dans l'espace Analyses.

6. **Étape 6 — Espaces Opérations & Transactions :**
   - Modernisation de l'espace Opérations : table dense d'achats nets avec copie Multibuy et intégration de l'onglet Transferts prioritaires.
   - Consolidation du Grand Livre et du Journal de portefeuille dans l'espace Transactions avec tiroir de preuve.

7. **Étape 7 — Configuration & Validation Finale :**
   - Regroupement des réglages multi-personnages, hubs, sauvegardes et diagnostics dans l'espace Configuration.
   - Tests de régression complets (`vitest run`), validation de l'accessibilité clavier et benchmarks de rendu.

---

## 13. Liste des Arbitrages & Décisions à Valider Avant Implémentation

Avant toute modification du code dans le cadre de la Phase 12, les arbitrages suivants doivent être formalisés :

1. **Persistance de l'espace actif :** Mémoriser l'espace actif (1 à 6) dans l'URL (hash ou query param) ou dans le `localStorage` pour restaurer la vue exacte lors d'un rafraîchissement.
2. **Affichage du capital sur le Cockpit :** Confirmer si la valeur des marchandises en vente est affichée au prix de revient d'acquisition (recommandé pour la rigueur comptable) avec mention indicative de la valeur notionnelle de vente.
3. **Comportement sur petit écran :** Confirmer le passage automatique du tiroir latéral en mode plein écran sous le seuil de résolution de 768px de large.
4. **Découpage des PRs d'implémentation :** Valider que la Phase 12 sera livrée selon les étapes du plan sans ouvrir de chantiers parallèles non maîtrisés.
