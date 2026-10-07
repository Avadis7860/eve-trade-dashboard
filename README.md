# EVE Trade Dashboard

> **Cockpit de pilotage tactique et stratégique de commerce EVE Online.**  
> Suivi multi-personnages, intégration des divisions de corporation, réconciliation financière FIFO stricte TTC (taxes SCC et courtage unitaire), gestion des stocks physiques et arbitrage logistique automatisé via l'API officielle ESI de CCP Games.

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

**EVE Trade Dashboard** est une application web full-stack dédiée aux commerçants et négociants industriels d'EVE Online. Elle consolide les flux de marché et de portefeuille pour apporter visibilité, rigueur comptable et efficacité logistique.

### 1.1 Fonctionnalités Clés

- **Flotte Multi-Personnages & Divisions de Corporation :** Suivi synchronisé jusqu'à 11 personnages et support des 7 divisions de corporation avec filtrage de liquidité et rafraîchissement transparent des jetons OAuth en arrière-plan.
- **Réconciliation Financière FIFO TTC Déterministe :** Rapprochement chronologique strict des achats et ventes sans coût moyen synthétique, calcul du ROI et bénéfice net réels avec preuve arithmétique auditable (`FormulaProof`).
- **Attribution Fiscale & Courtage :** Rapprochement exclusif des taxes de vente SCC (8%) via corrélation M+1 et proratisation unitaire des frais de courtage (*broker fees*) sur exécutions réelles.
- **Décomposition Mutuellement Exclusive du Capital :** Répartition de chaque unité physique et ISK en 5 états étanches (`COMMITTED_SELL_ORDER`, `FREE_HUB_STOCK`, `REMOTE_DORMANT_STOCK`, `IN_TRANSIT_STOCK`, `UNRECONCILED_STOCK`).
- **Arbitrage Logistique & Réassort Marché :** Run-rate journalier $V_{jour}$, priorité absolue aux transferts inter-hubs de stocks dormants avant tout achat, calcul des volumes cargo ($m^3$) par classe de vaisseau et export **EVE Multibuy**.
- **Product 360 & Séries Temporelles :** Fiche d'inspection transversale par article (vélocité, durée moyenne de détention, rendement capital-jour, pyramide des âges du stock 0–90+ jours, flux inter-hubs).
- **Cockpit Unifié en 6 Espaces de Décision :**
  1. *Cockpit / Dashboard* : Synthèse financière, alertes prioritaires et KPIs.
  2. *Positions & Marchés* : Suivi des ordres de marché et stocks physiques.
  3. *Analytics & Product 360* : Séries temporelles, catalogue d'articles et détention.
  4. *Opérations & Logistique* : Transferts prioritaires, achats résiduels et Multibuy.
  5. *Transactions & Grand Livre* : Grand livre, journal de portefeuille et allocations FIFO.
  6. *Configuration & Système* : Comptes SSO, hubs, sauvegardes SHA-256 et diagnostics serveur.

### 1.2 Anti-Périmètre & Règles d'Or

- **Lecture Seule ESI (Read-Only) :** Aucun ordre n'est créé, modifié ou annulé en jeu.
- **Zéro Automatisation :** Aucune interaction directe avec le client EVE, conformité stricte avec la politique CCP.
- **Pas de Remplacement du Tableur d'Opportunités :** Le tableur externe du joueur conserve l'analyse d'opportunités ; le dashboard assure l'observation, le pilotage comptable et la logistique.
- **Intégrité Absolue des Données :** Les états `UNKNOWN`, `PARTIAL`, `ERROR` et `ABSENT` ne sont **jamais convertis en zéro**. En cas d'historique manquant, le statut est qualifié avec transparence.

---

## 2. Guide d'Installation & Démarrage

### 2.1 Prérequis

- **Node.js :** Version 22.0.0 ou supérieure (`node -v`).
- **Gestionnaire de paquets :** npm 10+ (ou bun/pnpm).
- **Base de données :** PostgreSQL 16 (recommandé en production) ou mode fichier local automatique.
- **Application Développeur EVE :** Enregistrée sur [developers.eveonline.com](https://developers.eveonline.com).

### 2.2 Configuration EVE SSO (CCP Developers)

1. Rendez-vous sur [developers.eveonline.com](https://developers.eveonline.com) et créez une application.
2. Définissez la **Callback URL** : `http://localhost:3000/api/auth/callback`.
3. Cochez les scopes en lecture seule suivants :
   - `esi-wallet.read_character_wallet.v1`
   - `esi-wallet.read_corporation_wallets.v1`
   - `esi-markets.read_character_orders.v1`
   - `esi-markets.read_corporation_orders.v1`
   - `esi-assets.read_assets.v1`
   - `esi-assets.read_corporation_assets.v1`
   - `esi-universe.read_structures.v1`
4. Récupérez le **Client ID** et le **Secret Key**.

### 2.3 Variables d'Environnement (`.env`)

Copiez le modèle et complétez les valeurs :

```bash
cp .env.example .env
```

| Variable | Description | Exemple |
|---|---|---|
| `PORT` | Port d'écoute HTTP du serveur | `3000` |
| `NODE_ENV` | Environnement (`development` ou `production`) | `development` |
| `EVE_CLIENT_ID` | Identifiant client de votre application CCP | `votre_client_id` |
| `EVE_CLIENT_SECRET` | Secret de votre application CCP | `votre_secret_key` |
| `EVE_CALLBACK_URL` | URL de rappel OAuth enregistrée chez CCP | `http://localhost:3000/api/auth/callback` |
| `SESSION_ENCRYPTION_KEY` | Clé AES-256 (64 caractères hexadécimaux) | `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `DATABASE_URL` | URL de connexion PostgreSQL (optionnel) | `postgresql://user:pass@localhost:5432/eve_trade` |
| `DATABASE_STORAGE_PATH`| Fichier local si `DATABASE_URL` est omis | `./.data/eve_trade_store.json` |

### 2.4 Installation & Lancement

```bash
# 1. Installer les dépendances
npm install

# 2. Démarrer en développement (Vite dev server + API Express)
npm run dev
```

L'application s'ouvre sur [http://localhost:3000](http://localhost:3000).

### 2.5 Scripts Disponibles

```bash
npm run dev                      # Serveur de développement full-stack
npm run build                    # Compilation TypeScript et build statique de production
npm start                        # Serveur de production optimisé
npm test                         # Suite de tests Vitest (405 tests unitaires & intégration)
npm run test:integration         # Tests d'intégration sur moteur PostgreSQL réel
npm run test:e2e                 # Tests navigateurs End-to-End Chromium (Playwright)
npm run lint                     # Vérification stricte ESLint 9
npm run typecheck                # Vérification des types TypeScript sans émission
npm run bench                    # Banc de test sous charge (latence, mémoire, 50k transactions)
npm run db:recalculate-financials # Outil CLI de reconstitution et audit financier contradictoire
```

### 2.6 Sondes de Santé en Production

- **Liveness :** `GET /health/live` (vérifie la vivacité du processus Node.js).
- **Readiness :** `GET /health/ready` (vérifie la connectivité SQL, l'application des migrations et la disponibilité des dépôts).

---

## 3. Index Canonique de la Documentation (`docs/`)

L'ensemble de la documentation technique, des invariants de domaine, des spécifications d'algorithmes et des phases de travail est centralisé dans le répertoire **[`docs/`](docs/)** :

### 3.1 Moteurs Métier & Algorithmes
La spécification mathématique et algorithmique complète est consignée dans **[`docs/ALGORITHMS.md`](docs/ALGORITHMS.md)** :

| Algorithme | Responsabilité | Module Source | Spécification |
|---|---|---|---|
| **Réconciliation FIFO TTC** | Rapprochement chronologique unitaire, séparation CA alloué/non-alloué et preuve `FormulaProof` | `src/server/roi/` | [docs/ALGORITHMS.md#1](docs/ALGORITHMS.md#1-moteur-de-réconciliation-financière-fifo-ttc) |
| **Attribution Fiscale SCC M+1** | 3 passes exclusives d'attribution sans ambiguïté ni double comptage | `src/server/ledger/taxReconciler.ts` | [docs/ALGORITHMS.md#2](docs/ALGORITHMS.md#2-moteur-dattribution-fiscale-scc-m1) |
| **Courtage (Broker Fees)** | Proratisation volumétrique sur exécution réelle et traçabilité des reliquats orphelins | `src/server/ledger/brokerFeeReconciler.ts` | [docs/ALGORITHMS.md#3](docs/ALGORITHMS.md#3-moteur-dattribution-des-frais-de-courtage-broker-fees) |
| **Décomposition Capital** | 5 états mutuellement exclusifs et détection des stocks dormants (>30j) | `src/server/capital/service.ts` | [docs/ALGORITHMS.md#4](docs/ALGORITHMS.md#4-moteur-de-décomposition-du-capital--inventaire) |
| **Arbitrage Logistique** | Run-rate $V_{jour}$, priorité absolue aux transferts avant achats, jauge $m^3$ et Multibuy | `src/server/operations/service.ts` | [docs/ALGORITHMS.md#5](docs/ALGORITHMS.md#5-moteur-darbitrage-logistique--réassort-marché) |
| **Product 360 & Séries** | Vélocité, durée de détention, rendement capital-jour, pyramide des âges | `src/server/analytics/service.ts` | [docs/ALGORITHMS.md#6](docs/ALGORITHMS.md#6-moteur-analytique-product-360--séries-temporelles) |
| **Passerelle ESI & Baux** | Quotas CCP, cache 304, baux distribués PostgreSQL (`esi_sync_leases`), coalescing | `src/server/esi/`, `src/server/sync/` | [docs/ALGORITHMS.md#7](docs/ALGORITHMS.md#7-passerelle-esi-résiliente--concurrence-distribuée) |
| **Cryptographie & Sessions** | AES-256-GCM au repos, trousseau PBKDF2, single-flight OAuth, résilience iframe | `src/server/auth/` | [docs/ALGORITHMS.md#8](docs/ALGORITHMS.md#8-cryptographie--gestion-sécurisée-des-sessions) |

### 3.2 Contrats d'Architecture & Références
- **[docs/INDEX.md](docs/INDEX.md)** : Index centralisateur de navigation et cartographie documentaire.
- **[docs/MASTERPLAN.md](docs/MASTERPLAN.md)** : Statut officiel des phases, vision produit et gouvernance.
- **[docs/CODE_INDEX.md](docs/CODE_INDEX.md)** : Inventaire de l'ensemble des fichiers du projet, responsabilités et tests associés.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** : Architecture technique globale, flux de données et isolation.
- **[docs/DOMAIN_CONTRACTS.md](docs/DOMAIN_CONTRACTS.md)** : Invariants fondamentaux du domaine métier.
- **[docs/METRICS.md](docs/METRICS.md)** : Définitions et formules des métriques financières et opérationnelles.
- **[docs/ESI_RESILIENCE.md](docs/ESI_RESILIENCE.md)** : Contrats de résilience ESI, quotas CCP et politique de cache.
- **[docs/SECURITY_PRIVACY.md](docs/SECURITY_PRIVACY.md)** : Règles de sécurité, chiffrement et protection des données.
- **[docs/TESTING_CI.md](docs/TESTING_CI.md)** : Stratégie de qualification et pyramide de tests.

### 3.3 Feuilles de Route & Phases de Travail
Le catalogue complet des 42 phases de développement est détaillé dans **[`docs/phases/README.md`](docs/phases/README.md)** :
- **Époque 1 : Socle Initial & MVP** ([Phases 00 à 06](docs/phases/README.md#époque-1--socle-initial--mvp), H01, H02) — *Terminées*.
- **Époque 2 : Transformation Cockpit & Pilotage** ([Phases 07 à 12](docs/phases/README.md#époque-2--transformation-cockpit--système-de-pilotage), 10.bis) — *Terminées*.
- **Époque 3 : Assurance Fiabilité & Traçabilité** ([Série F, F01 à F11](docs/phases/README.md#époque-3--assurance-fiabilité--traçabilité-série-f), H03) — *Terminées*.
- **Époque 4 : Fiabilisation Finale Production** ([Série G, G01 à G05](docs/phases/README.md#époque-4--fiabilisation-finale-production--sécurité-série-g)) — *G01–G04 Terminées, G05 Planifiée*.
- **Époque Historique : Remise à Niveau & Performance** ([Série R, R00 à R08](docs/phases/README.md#époque-historique--remise-à-niveau--performance-série-r)) — *Archivées / Terminées*.

---

## 4. Règles de Développement & Contribution

1. **Pas de travail direct sur `main` :** Une phase = une branche = une Pull Request.
2. **Tests systématiques :** Aucun code n'est accepté sans tests unitaires ou d'intégration.
3. **CI Verte obligatoire :** Aucun contrôle rouge ne doit être désactivé ou ignoré.
4. **Mise à jour du Code Index :** Toute modification de structure de fichier est immédiatement reportée dans `docs/CODE_INDEX.md`.
5. **Vérité comptable :** Ne jamais convertir une donnée manquante en zéro ; signaler fidèlement les incertitudes.

---

*Développé pour l'excellence financière et opérationnelle dans New Eden.*
