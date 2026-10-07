# EVE Trade Dashboard

> **Tableau de bord de pilotage tactique et stratégique de commerce EVE Online.**  
> Suivi multi-personnages, intégration des divisions de corporation, réconciliation financière FIFO stricte TTC (taxes et courtage unitaires), gestion des stocks physiques et arbitrage logistique automatisé via l'ESI officielle de CCP Games.

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19.x-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.x-38B2AC?logo=tailwind-css)](https://tailwindcss.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)](https://www.postgresql.org)
[![Tests](https://img.shields.io/badge/Tests-405%20passed%20(100%25)-brightgreen?logo=vitest)](https://vitest.dev)
[![Playwright](https://img.shields.io/badge/E2E-Playwright%20Chromium-45ba4b?logo=playwright)](https://playwright.dev)
[![ESI](https://img.shields.io/badge/CCP%20ESI-Read--Only-orange)](https://esi.evetech.net)

---

## 1. Présentation du Produit

**EVE Trade Dashboard** est une application web full-stack conçue pour les commerçants industriels et négociants de New Eden. Elle transforme les flux bruts de l'API ESI en un véritable cockpit d'aide à la décision financière, logistique et opérationnelle.

### 1.1 Ce que l'application accomplit

- **Vue Flotte Multi-Personnages & Divisions de Corporation :** Consolidation transparente jusqu'à 11 personnages et support complet des 7 divisions de portefeuille corporatif, avec filtrage granulaire de liquidité et renouvellement automatique des tokens en arrière-plan.
- **Réconciliation Financière FIFO TTC Déterministe :** Rapprochement chronologique strict entre achats et ventes. Proratisation unitaire des taxes de vente SCC (8% par défaut) et des frais de courtage (*broker fees*), produisant un ROI et un bénéfice net réels justifiés par des preuves mathématiques auditables (`FormulaProof`).
- **Classification Mutuellement Exclusive du Capital :** Décomposition stricte de chaque unité physique et monétaire en 5 états étanches :
  1. `COMMITTED_SELL_ORDER` (en vente active sur le marché)
  2. `FREE_HUB_STOCK` (stock libre disponible dans un hub de vente)
  3. `REMOTE_DORMANT_STOCK` (stock dormant isolé >30 jours sans mouvement)
  4. `IN_TRANSIT_STOCK` (en cours d'acheminement / cales de transport)
  5. `UNRECONCILED_STOCK` (stock physique sans historique d'achat certifié)
- **Moteur d'Arbitrage Logistique & Réassort :** Calcul du run-rate journalier $V_{jour}$ par article et par hub. Priorisation absolue des transferts inter-stations depuis les stocks dormants avant toute recommandation d'achat sur le marché, calcul des volumes cargo ($m^3$), benchmarks par classe de transporteur et génération en 1 clic de listes au format **EVE Multibuy**.
- **Fiche d'Inspection Product 360 & Séries Temporelles :** Vue transversale pour chaque article combinant KPIs ($V_{jour}$, durée moyenne de détention $D_{detention}$, rendement capital-jour $R_{cap\_jour}$), décomposition physique par station, historique des transactions et pyramide des âges du stock (0–14j, 15–30j, 31–60j, 61–90j, >90j).
- **Cockpit Unifié en 6 Espaces de Décision :**
  - **Espace 1 : Cockpit / Dashboard** — Synthèse globale, alertes prioritaires, liquidités nettes et raccourcis d'inspection.
  - **Espace 2 : Positions & Marchés** — Ordres de vente/achat actifs et inventaire physique unifié avec indicateurs de sur-vente.
  - **Espace 3 : Analytics & Product 360** — Séries temporelles, catalogue d'articles, analyse de détention et exports.
  - **Espace 4 : Opérations & Logistique** — Transferts prioritaires, achats résiduels, jauge de fret $m^3$ et Multibuy.
  - **Espace 5 : Transactions & Grand Livre** — Grand livre exhaustif, journal de portefeuille, rapprochement fiscal et allocations FIFO.
  - **Espace 6 : Configuration & Système** — Gestion des comptes SSO, hubs personnalisés, sauvegardes SHA-256 et diagnostics serveur.

### 1.2 Anti-Périmètre & Règles d'Or (Ce que le produit n'est PAS)

- **Lecture Seule ESI Absolue (Read-Only) :** L'application ne crée, ne modifie et n'annule aucun ordre de marché en jeu. Elle ne transmet aucune action au client EVE.
- **Aucune Automatisation de Jeu :** Zéro bot, zéro simulation de clics, conformité totale avec les conditions d'utilisation de CCP Games.
- **Pas de Remplacement du Tableur d'Opportunités :** Le tableur externe du joueur conserve l'analyse d'arbitrage de marché et de détection d'opportunités. Ce dashboard est un outil d'observation, de pilotage comptable et de gestion logistique.
- **Vérité des Données :** Les états `UNKNOWN`, `PARTIAL`, `ERROR` et `ABSENT` sont distincts et ne sont **jamais convertis en zéro**. En cas d'historique manquant, le système qualifie l'état fidèlement au lieu d'inventer un coût moyen synthétique.

---

## 2. Architecture & Pile Technique

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Navigateur Web (Client)                         │
│   React 19 • Tailwind CSS 4 • Lucide Icons • Client API (Cache & Abort)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / JSON (Cookie + Bearer Header)
┌───────────────────────────────────▼────────────────────────────────────┐
│                       Serveur d'Application Node.js 22                 │
│                                                                        │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────┐ │
│   │   Auth & Crypto     │  │   Passerelle ESI    │  │  Coordinateur  │ │
│   │ AES-256-GCM / PBKDF2│  │  Limiteur CCP / 304 │  │   Baux ESI     │ │
│   └─────────────────────┘  └─────────────────────┘  └────────────────┘ │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │                     Moteurs Métier & Algorithmes                 │ │
│   │  • Réconciliateur FIFO TTC  • Attribution Taxes SCC M+1          │ │
│   │  • Courtage Broker Fees     • Décomposition Capital & Stocks     │ │
│   │  • Logistique & Réassort    • Product 360 & Vélocité             │ │
│   └──────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │                   Couche d'Accès aux Données (ACID)              │ │
│   │   PostgresDatabaseAdapter  /  DurableFileDatabaseAdapter         │ │
│   └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬───────────────────────────────┬────────────┘
                            │ SQL / Pool                    │ HTTPS
┌───────────────────────────▼───────────┐       ┌───────────▼────────────┐
│      Base de Données PostgreSQL 16    │       │     CCP Games ESI      │
│  Migrations relationnelles versionnées│       │   API Officielle EVE   │
└───────────────────────────────────────┘       └────────────────────────┘
```

- **Frontend :** SPA React 19 avec StrictMode, composants modulaires sans dépendance externe lourde, style Tailwind CSS 4, tiroirs latéraux accessibles au clavier (*SideDrawers*), accordéons de preuve mathématique.
- **Backend :** Serveur Express 4 sous Node.js 22 et TypeScript strict, démarrage ordonné bloquant `bootstrapApp()`, middlewares de sécurité (CSP strict, CORS, CSRF, isolation multi-tenant), traçabilité `X-Request-ID` avec `AsyncLocalStorage`.
- **Persistance :** 
  - Moteur cible : PostgreSQL 16 relationnel avec migrations versionnées (001 à 010), transactions ACID, index B-Tree optimisés.
  - Adaptateur de secours local : `DurableFileDatabaseAdapter` résistant aux crashs avec sauvegarde d'intégrité `.corrupt.[ts].bak`.
- **Qualité & Tests :** 405 tests automatisés (Vitest unitaire & intégration, Playwright Chromium E2E, qualification SQL sur moteur réel).

---

## 3. Guide d'Installation & Prise en Main

### 3.1 Prérequis

- **Node.js :** Version 22.0.0 ou supérieure (`node -v`).
- **Gestionnaire de paquets :** npm 10+ ou bun/pnpm.
- **Base de données (recommandé pour production) :** PostgreSQL 16 (ou utilise l'adaptateur de stockage fichier local automatique).
- **Application Développeur EVE :** Un compte sur [developers.eveonline.com](https://developers.eveonline.com).

### 3.2 Configuration de l'Application EVE Online (SSO)

1. Rendez-vous sur le portail [CCP Developers](https://developers.eveonline.com) et connectez-vous.
2. Créez une nouvelle application :
   - **Name :** `EVE Trade Dashboard`
   - **Connection Type :** `Authentication & API Access`
   - **Permissions (Scopes) :** Sélectionnez les scopes minimaux en lecture seule :
     - `esi-wallet.read_character_wallet.v1`
     - `esi-wallet.read_corporation_wallets.v1`
     - `esi-markets.read_character_orders.v1`
     - `esi-markets.read_corporation_orders.v1`
     - `esi-assets.read_assets.v1`
     - `esi-assets.read_corporation_assets.v1`
     - `esi-universe.read_structures.v1`
   - **Callback URL :** `http://localhost:3000/api/auth/callback` (adapter l'hôte et le port en production).
3. Conservez votre **Client ID** et **Secret Key**.

### 3.3 Configuration de l'Environnement

Créez un fichier `.env` à la racine du projet (copie de `.env.example`) :

```bash
cp .env.example .env
```

Renseignez les variables nécessaires :

| Variable | Description | Exemple / Valeur par défaut |
|---|---|---|
| `PORT` | Port d'écoute du serveur HTTP | `3000` |
| `NODE_ENV` | Environnement d'exécution (`development` ou `production`) | `development` |
| `EVE_CLIENT_ID` | Identifiant client issu du portail CCP Developers | `votre_client_id_ici` |
| `EVE_CLIENT_SECRET` | Clé secrète issue du portail CCP Developers | `votre_client_secret_ici` |
| `EVE_CALLBACK_URL` | URL de redirection OAuth enregistrée chez CCP | `http://localhost:3000/api/auth/callback` |
| `SESSION_ENCRYPTION_KEY` | Clé AES-256 de 64 caractères hexadécimaux (obligatoire en prod) | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` |
| `DATABASE_URL` | URL de connexion PostgreSQL (optionnel, active le mode SQL réel) | `postgresql://user:pass@localhost:5432/eve_trade` |
| `DATABASE_STORAGE_PATH`| Chemin du fichier de persistance locale (si `DATABASE_URL` omis) | `./.data/eve_trade_store.json` |
| `LOG_FORMAT` | Format des logs (`json` pour prod, standard en dev) | `json` |

> **Astuce de génération de clé cryptographique :**
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

### 3.4 Installation des Dépendances & Démarrage

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer le serveur en mode développement (avec rechargement à chaud Vite)
npm run dev
```

L'application est immédiatement accessible sur [http://localhost:3000](http://localhost:3000).

### 3.5 Scripts & Commandes Disponibles

| Commande | Action |
|---|---|
| `npm run dev` | Démarre le serveur full-stack de développement (`tsx server.ts`). |
| `npm run build` | Compile TypeScript (`tsc`) et génère les bundles statiques de production (`vite build`). |
| `npm start` | Démarre l'application en mode production optimisé (`NODE_ENV=production tsx server.ts`). |
| `npm test` | Exécute la suite complète de 405 tests unitaires et d'intégration Vitest (`vitest run`). |
| `npm run test:integration` | Exécute les tests d'intégration PostgreSQL sur un moteur relationnel réel. |
| `npm run test:e2e` | Lance les tests End-to-End dans un navigateur Chromium réel via Playwright. |
| `npm run lint` | Valide la syntaxe et les règles strictes ESLint 9 sur `src/` et `server.ts`. |
| `npm run typecheck` | Vérifie l'intégrité statique des types TypeScript sans émission (`tsc --noEmit`). |
| `npm run bench` | Exécute le banc de test sous charge (latence, allocations mémoire, calculs sous 50k transactions). |
| `npm run db:recalculate-financials` | Outil CLI de maintenance et de reconstitution historique avec audit contradictoire. |

### 3.6 Déploiement en Production & Vérification des Sondes

En production, le serveur applique un démarrage ordonné et expose deux sondes de santé de niveau industriel :

1. **Sonde de Vivacité (Liveness) :** `GET /health/live`  
   Répond `200 OK` si l'event loop Node.js est actif.
2. **Sonde de Préparation (Readiness) :** `GET /health/ready`  
   Répond `200 OK` si et seulement si :
   - La connexion PostgreSQL est active (`SELECT 1`).
   - L'ensemble des 10 migrations de schéma relationnel est appliqué.
   - Les dépôts de persistance sont initialisés.  
   *(En cas de coupure de base de données, la sonde renvoie `503 Service Unavailable`).*

---

## 4. Index Canonique des Algorithmes & Fonctions Clés

Ce chapitre recense l'ensemble des algorithmes fondamentaux du moteur, leur justification mathématique et leurs modules d'implémentation.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              INDEX CANONIQUE DES ALGORITHMES                           │
├────────────────────────┬────────────────────────────────────────┬──────────────────────┤
│ Domaine Métier         │ Module Source                          │ Algorithme Principal │
├────────────────────────┼────────────────────────────────────────┼──────────────────────┤
│ 1. Réconciliation FIFO │ src/server/roi/service.ts              │ FIFO Strict Multi-   │
│    TTC Déterministe    │ src/server/roi/calculator.ts           │ Personnages & Preuve │
├────────────────────────┼────────────────────────────────────────┼──────────────────────┤
│ 2. Fiscalité SCC M+1   │ src/server/ledger/taxReconciler.ts     │ Rapprochement 3-Pass │
│    Déterministe        │                                        │ Réservation Unicité  │
├────────────────────────┼────────────────────────────────────────┼──────────────────────┤
│ 3. Frais de Courtage   │ src/server/ledger/brokerFeeReconciler.ts│ Proratisation Ordre  │
│    (Broker Fees)       │                                        │ Reliquats Orphelins  │
├────────────────────────┼────────────────────────────────────────┼──────────────────────┤
│ 4. Décomposition du    │ src/server/capital/service.ts          │ 5 États Mutuellement │
│    Capital & Inventaire│                                        │ Exclusifs & Lots     │
├────────────────────────┼────────────────────────────────────────┼──────────────────────┤
│ 5. Logistique &        │ src/server/operations/service.ts       │ Arbitrage Transferts │
│    Réassort Marché     │ src/server/operations/volumeRegistry.ts│ Run-rate & Multibuy  │
├────────────────────────┼────────────────────────────────────────┼──────────────────────┤
│ 6. Product 360 &       │ src/server/analytics/service.ts        │ Vélocité, Détention, │
│    Séries Temporelles  │                                        │ Pyramide des Âges    │
├────────────────────────┼────────────────────────────────────────┼──────────────────────┤
│ 7. Passerelle ESI      │ src/server/esi/rateLimiter.ts          │ Backoff, Baux BDD    │
│    & Concurrence       │ src/server/sync/coordinator.ts         │ & Request Coalescing │
├────────────────────────┼────────────────────────────────────────┼──────────────────────┤
│ 8. Cryptographie &     │ src/server/auth/crypto.ts              │ AES-256-GCM, PBKDF2  │
│    Gestion de Sessions │ src/server/auth/sessionStore.ts        │ & Single-Flight Auth │
└────────────────────────┴────────────────────────────────────────┴──────────────────────┘
```

---

### Algorithme 1 — Réconciliation Financière FIFO TTC Déterministe
- **Fichiers :** `src/server/roi/service.ts`, `src/server/roi/calculator.ts`
- **Responsabilité :** Rapprocher chaque unité vendue d'un lot d'achat historique chronologique sans inventer de coût moyen.
- **Principe :**
  1. **Ségrégation Vendeur :** Priorité d'allocation donnée aux lots d'achat appartenant au personnage ayant réalisé la vente (`prioritizeSellingCharacter`), avant de consommer les lots d'autres personnages de la flotte.
  2. **Non-Coercition des Données :** Si le volume vendu excède l'historique d'achat disponible, le reliquat est qualifié de `PARTIAL` ou `UNKNOWN`. En aucun cas le prix d'achat n'est converti en 0 ISK.
  3. **Décomposition du Chiffre d'Affaires :**  
     $$\text{CA Brut Total} = \text{CA Alloué (Prouvé)} + \text{CA Non Alloué (Sans historique)}$$
  4. **Formule du Profit Net TTC & ROI TTC :**  
     $$\text{COGS TTC} = \text{Prix d'Achat Brut} + \text{Courtage d'Achat Alloué}$$
     $$\text{Frais de Vente TTC} = \text{Taxes SCC Réconciliées} + \text{Courtage de Vente Alloué}$$
     $$\text{Profit TTC} = \text{CA Brut Alloué} - \text{COGS TTC} - \text{Frais de Vente TTC}$$
     $$\text{ROI TTC} = \frac{\text{Profit TTC}}{\text{COGS TTC} + \text{Frais de Vente TTC}} \times 100$$
  5. **Preuve Mathématique Auditable :** Chaque transaction réconciliée produit un objet `FormulaProof` contenant la formule textuelle, les valeurs substituées et la certification arithmétique.

---

### Algorithme 2 — Attribution Fiscale SCC M+1 Déterministe
- **Fichier :** `src/server/ledger/taxReconciler.ts`
- **Responsabilité :** Attribuer de manière exclusive chaque écriture de taxe `tax` ou `transaction_tax` du journal de portefeuille à sa transaction de vente correspondante.
- **Principe (3 Passes Exclusives) :**
  - **Passe 1 (Lien Direct / Contexte Exact) :** Si l'entrée du journal possède un `context_id` égal au `transaction_id`, l'attribution est immédiate et univoque.
  - **Passe 2 (Séquentielle CCP M+1) :** Dans l'implémentation de CCP, l'écriture fiscale est fréquemment horodatée à la même seconde ou à la seconde suivante ($M+1$) avec un montant égal à $\text{valeur} \times \text{taux}$. La passe 2 associe de façon bijective les couples transaction-journal dans une fenêtre glissante étroite.
  - **Passe 3 (Corrélation Bijective Étroite) :** Pour les ventes simultanées du même article, une réservation d'unicité garantit qu'aucune écriture fiscale n'est attribuée à deux transactions distinctes.
  - **Invariance Comptable :** $\sum \text{Taxes Attribuées} \le \sum \text{Taxes Réelles}$.

---

### Algorithme 3 — Attribution des Frais de Courtage (Broker Fees)
- **Fichier :** `src/server/ledger/brokerFeeReconciler.ts`
- **Responsabilité :** Rapprocher les frais de mise en vente prélevés lors de la création d'un ordre de marché avec les transactions d'exécution réelles.
- **Principe :**
  1. Corrélation entre l'écriture `brokers_fee` du journal et l'ordre parent via `context_id == order_id`.
  2. Proratisation au volume exécuté : si un ordre de 100 unités subit 10 000 000 ISK de courtage et vend 20 unités, la quote-part attribuée est :
     $$\text{Quote-part} = 10\,000\,000 \times \frac{20}{100} = 2\,000\,000 \text{ ISK}$$
  3. Les reliquats non exécutés ou ordres annulés sont classés en frais résiduels `unallocated_broker_fees_isk` afin de préserver l'invariance :
     $$\text{Total Frais Journal} = \text{Frais Alloués aux Ventes} + \text{Frais Non Attribués}$$

---

### Algorithme 4 — Décomposition du Capital & Inventaire Mutuellement Exclusif
- **Fichier :** `src/server/capital/service.ts`
- **Responsabilité :** Ventiler chaque ISK et chaque mètre cube d'actif physique dans une catégorie exclusive sans doublon.
- **Principe :**
  - **Liquidités :** Soldes réels des portefeuilles personnels et divisions corporatives (filtrables par préférences).
  - **Escrow :** Caution immobilisée sur les ordres d'achat en cours sur le marché.
  - **Ordres de Vente :** Valorisation au coût de revient d'achat des stocks engagés sur le marché (`COMMITTED_SELL_ORDER`).
  - **Stock Libre vs Dormant :** Les stocks en station hub sont qualifiés de libres (`FREE_HUB_STOCK`). Les stocks sans aucune rotation ni transaction depuis plus de 30 jours sont isolés en stocks dormants (`REMOTE_DORMANT_STOCK`).
  - **Transit :** Détection automatique des cargaisons logées dans les cales de transporteurs ou vaisseaux amarrés (`IN_TRANSIT_STOCK`).

---

### Algorithme 5 — Arbitrage Logistique, Run-Rate & Réassort Marché
- **Fichiers :** `src/server/operations/service.ts`, `src/server/operations/volumeRegistry.ts`
- **Responsabilité :** Déterminer les actions de réapprovisionnement optimales pour maintenir un stock cible de couverture $H_{jours}$.
- **Principe :**
  1. **Vélocité Journalière :** $V_{jour} = \frac{\sum Q_{\text{vendue}}}{\text{Fenêtre d'Observation (jours)}}$.
  2. **Besoin Net de Couverture :**  
     $$Q_{\text{cible}} = V_{jour} \times H_{jours}$$
     $$Q_{\text{besoin}} = \max\left(0, Q_{\text{cible}} - (Q_{\text{en vente}} + Q_{\text{stock local}} + Q_{\text{achat en cours}})\right)$$
  3. **Arbitrage Prioritaire des Transferts :** Le système explore l'ensemble des stocks dormants distants. Si $Q_{\text{dormant}} > 0$, il génère en priorité une suggestion de transfert inter-hubs $Q_{\text{transfert}}$.
  4. **Achat Résiduel :** $Q_{\text{achat}} = \max(0, Q_{\text{besoin}} - Q_{\text{transfert}})$.
  5. **Calcul de Fret & Navettes :** Consultation du volume unitaire ($m^3$) dans le registre statique (`volumeRegistry.ts`) et décompte du nombre de trajets par classe de vaisseau cargo (Blockade Runner: $10\,000\text{ m}^3$, DST: $60\,000\text{ m}^3$, Freighter: $850\,000\text{ m}^3$, Jump Freighter: $350\,000\text{ m}^3$).
  6. **Export Multibuy :** Formatage texte tabulé `<Nom Article>\t<Quantité>` prêt à coller dans EVE Online.

---

### Algorithme 6 — Moteur Analytique Product 360 & Séries Temporelles
- **Fichier :** `src/server/analytics/service.ts`
- **Responsabilité :** Générer le profil complet d'un article sous toutes ses facettes.
- **Indicateurs Clés :**
  - **Durée Moyenne de Détention ($D_{detention}$) :** Moyenne pondérée du temps écoulé entre la date d'achat et la date de vente de chaque lot.
  - **Rendement Capital-Jour ($R_{cap\_jour}$) :**  
    $$R_{cap\_jour} = \frac{\text{Profit TTC}}{\text{Capital Moyen Engagé} \times \max(1, D_{detention})}$$
  - **Pyramide des Âges du Stock :** Répartition des unités invendues en 5 tranches chronologiques (0–14j, 15–30j, 31–60j, 61–90j, >90j).
  - **Matrice des Flux de Hubs :** Corrélation des achats dans les hubs d'approvisionnement (ex: Jita) et des reventes dans les hubs secondaires (ex: Amarr, Dodixie).

---

### Algorithme 7 — Passerelle ESI Résiliente & Concurrence Distribuée
- **Fichiers :** `src/server/esi/rateLimiter.ts`, `src/server/sync/coordinator.ts`, `src/server/sync/service.ts`
- **Responsabilité :** Assurer la synchronisation sans saturer les limites de débit CCP Games ni provoquer de contention de ressources.
- **Principe :**
  - **Rate Limiting Adaptatif :** Suivi dynamique des en-têtes `X-ESI-Error-Limit-Remain`. Suspension automatique des appels dès que la marge de sécurité est atteinte.
  - **Baux Distribués PostgreSQL (`esi_sync_leases`) :** Verrou logique horodaté avec TTL court et heartbeat périodique évitant d'immobiliser des transactions de base de données pendant des appels HTTP longs.
  - **Request Coalescing (Fusion des Requêtes en Vol) :** Si plusieurs clients ou composants sollicitent la même ressource ESI simultanément, une seule requête HTTP réelle est émise et la promesse est partagée.
  - **Gestion Stricte du Cache HTTP :** Support complet des requêtes conditionnelles `If-None-Match` (ETag) et `If-Modified-Since` renvoyant `304 Not Modified` sans décompte d'erreurs.

---

### Algorithme 8 — Sécurité Cryptographique & Gestion des Sessions
- **Fichiers :** `src/server/auth/crypto.ts`, `src/server/auth/sessionStore.ts`, `src/server/auth/service.ts`
- **Responsabilité :** Protéger les jetons d'accès et assurer la persistance transparente des sessions multi-personnages.
- **Principe :**
  - **OAuth 2.0 PKCE S256 :** Échange de jetons sécurisé sans transmission de secrets côté client.
  - **Chiffrement au Repos AES-256-GCM :** Tous les `access_token` et `refresh_token` stockés en base de données sont chiffrés au repos avec un vecteur d'initialisation (IV) unique et un tag d'authentification GCM (`iv:tag:ciphertext`).
  - **Trousseau de Flotte Sécurisé (PBKDF2) :** Export et réimportation du trousseau complet de 11 personnages chiffré par un mot de passe utilisateur fort via 100 000 itérations PBKDF2.
  - **Single-Flight Token Refresh :** Coalescence locale garantissant qu'une seule requête de renouvellement de token n'est adressée à CCP SSO lors de multiples appels concurrents pour le même personnage.
  - **Résilience Iframe :** Double transport de session par cookie HTTP sécurisé et en-tête d'autorisation (`Authorization: Bearer <sessionId>`) assurant la connectivité même dans les environnements restreints bloquant les cookies tiers.

---

## 5. Gouvernance Documentaire & Navigation

Le projet applique une discipline stricte de documentation canonique. Toute décision d'architecture, contrat de données ou nouvelle phase est consigné dans les documents de référence :

- **[docs/INDEX.md](docs/INDEX.md) :** Index centralisateur renvoyant vers chaque contrat et cahier des charges.
- **[docs/MASTERPLAN.md](docs/MASTERPLAN.md) :** Statut officiel de l'ensemble des phases et calendrier d'exécution.
- **[docs/CODE_INDEX.md](docs/CODE_INDEX.md) :** Inventaire canonique de chaque fichier source, de ses responsabilités et de ses tests.
- **[docs/ROADMAP-OFFICIELLE-FIABILISATION-POST-F11.md](docs/ROADMAP-OFFICIELLE-FIABILISATION-POST-F11.md) :** Traitement des audits contradictoires et série G de mise en production.
- **[docs/METRICS.md](docs/METRICS.md) :** Formules comptables formelles et règles de non-duplication des frais.
- **[docs/DOMAIN_CONTRACTS.md](docs/DOMAIN_CONTRACTS.md) :** Invariants et contrats de cycle de vie.
- **[docs/AI_AGENT_WORKFLOW.md](docs/AI_AGENT_WORKFLOW.md) :** Protocole d'ingénierie et règles de développement.

---

## 6. Règles de Contribution & Développement

1. **Ne jamais travailler directement sur la branche `main`.**
2. **Une phase = Une branche = Une Pull Request.**
3. **Tests avant chaque push :** Aucun code n'est accepté sans ses tests unitaires ou d'intégration correspondants.
4. **CI Verte Obligatoire :** Aucun contrôle rouge ne doit être désactivé ou contourné.
5. **Mise à jour synchronisée du Code Index :** Tout fichier ajouté, renommé ou supprimé doit être immédiatement répercuté dans `docs/CODE_INDEX.md`.
6. **Zéro régression sur la vérité des données :** Les données partielles, inconnues ou en erreur ne doivent jamais être masquées par des valeurs factices ou des zéros.

---

*Développé avec passion pour l'excellence opérationnelle et financière dans New Eden.*
