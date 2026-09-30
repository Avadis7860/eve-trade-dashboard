# Phase R00 — Baseline, mesure et gel fonctionnel

## Objectif
Établir une référence métrique objective et reproductible de l'état actuel de l'application avant toute modification structurelle ou architecturale. Figer le périmètre fonctionnel afin d'éviter les dérives pendant le chantier de remise à niveau.

## Problèmes traités
- Absence de métriques de référence chiffrées (temps de réponse, volume de requêtes par vue, consommation mémoire, durée des calculs analytiques et de synchronisation).
- Risque d'optimisations prématurées non mesurables ou d'affirmations de performance non vérifiées.
- Manque de caractérisation du comportement réel du stockage fichier (`.data/eve_trade_store.json`) vs PostgreSQL.

## Constats et Résultats du Profiling Baseline (HEAD - Post-Phase 10)

### 1. Démarrage serveur et empreinte mémoire initiale
| Indicateur | Valeur mesurée | Notes / Impact |
|---|---|---|
| **Temps d'initialisation Express (`createApp`)** | `1 275,18 ms` (~1,28 s) | Inclut le chargement des middlewares et adaptateurs |
| **Heap Utilisé au démarrage** | `19,26 Mo` | État initial avant requêtes massives |
| **Heap Total alloué** | `32,05 Mo` | Empreinte mémoire V8 initiale |
| **RSS (Resident Set Size)** | `133,19 Mo` | Empreinte mémoire résidente du processus Node.js |
| **External Memory** | `4,90 Mo` | Buffers et mémoire externe V8 |

---

### 2. Latence des Endpoints HTTP (`/api/*`)
*Mesuré sur 30 échantillons par route sous Node.js 22 (x64 linux) avec session SSO authentifiée :*

| Endpoint HTTP | p50 (médiane) | p95 | p99 | Moyenne | Taille Payload |
|---|---|---|---|---|---|
| `/api/health` | **3,79 ms** | 18,61 ms | 19,68 ms | 5,79 ms | 104 B |
| `/api/info` | **2,89 ms** | 6,67 ms | 11,99 ms | 3,41 ms | 137 B |
| `/api/ledger/transactions?page=1&pageSize=50` | **2,24 ms** | 2,84 ms | 3,47 ms | 2,34 ms | 35 B |
| `/api/ledger/summary` | **1,67 ms** | 2,73 ms | 3,81 ms | 1,81 ms | 35 B |
| `/api/ledger/filter-options` | **1,83 ms** | 2,36 ms | 5,15 ms | 1,95 ms | 35 B |
| `/api/ledger/sync-status` | **1,78 ms** | 2,28 ms | 2,37 ms | 1,82 ms | 35 B |
| `/api/orders` | **1,89 ms** | 2,80 ms | 4,96 ms | 2,01 ms | 35 B |
| `/api/orders/summary` | **1,77 ms** | 2,22 ms | 2,43 ms | 1,80 ms | 35 B |
| `/api/orders/restock` | **1,68 ms** | 3,98 ms | 6,08 ms | 1,92 ms | 35 B |
| `/api/hubs` | **1,79 ms** | 3,27 ms | 6,20 ms | 2,05 ms | 1,1 Ko |
| `/api/hubs/mappings` | **1,98 ms** | 7,05 ms | 8,53 ms | 2,81 ms | 1,1 Ko |
| `/api/roi/summary` | **3,72 ms** | 6,09 ms | 14,48 ms | 4,16 ms | 37 B |
| `/api/roi/allocations` | **2,26 ms** | 6,18 ms | 6,35 ms | 2,78 ms | 37 B |
| `/api/roi/unsold-inventory` | **2,19 ms** | 5,33 ms | 7,99 ms | 2,72 ms | 37 B |
| `/api/assets` | **2,01 ms** | 5,49 ms | 6,10 ms | 2,38 ms | 37 B |
| `/api/assets/summary` | **1,73 ms** | 1,95 ms | 2,07 ms | 1,70 ms | 37 B |
| `/api/capital/summary` | **2,53 ms** | 6,10 ms | 9,28 ms | 3,18 ms | 37 B |
| `/api/capital/breakdown` | **2,62 ms** | 7,30 ms | 7,88 ms | 2,99 ms | 37 B |
| `/api/capital/dormant` | **1,94 ms** | 7,73 ms | 15,79 ms | 2,98 ms | 37 B |
| `/api/analytics/product/34` | **2,15 ms** | 5,45 ms | 9,55 ms | 2,81 ms | 37 B |
| `/api/analytics/timeseries?range=30d` | **2,77 ms** | 5,95 ms | 10,47 ms | 3,08 ms | 37 B |

---

### 3. Coût I/O bloquant synchrone (`DurableFileDatabaseAdapter.persist`)
*Mesure du temps d'écriture synchrone bloquante `fs.writeFileSync(JSON.stringify(state))` sur disque :*

| Volumétrie (Transactions) | Taille JSON générée | Durée d'écriture synchrone bloquante | Facteur de dégradation |
|---|---|---|---|
| **100 transactions** | 70,7 Ko | **0,73 ms** | Référence (1x) |
| **1 000 transactions** | 703,5 Ko | **5,26 ms** | ~7x plus lent |
| **10 000 transactions** | 6,88 Mo | **85,52 ms** | ~117x plus lent |
| **50 000 transactions** | **34,42 Mo** | **551,30 ms** (0,55 s !) | **~755x plus lent** |

> **Diagnostic critique de l'audit :** À chaque mutation (sauvegarde d'une transaction, d'un ordre, d'un mapping de hub ou d'une allocation), le serveur Express bloque complètement l'event loop Node.js pendant plus d'un demi-seconde à 50 000 transactions. La migration vers PostgreSQL (Phase R01) éliminera cette réécriture intégrale synchrone.

---

### 4. Moteurs de calculs métier (Auto-FIFO, Product 360, Capital Positions)
*Évolution de la durée de traitement en fonction du volume d'historique :*

| Volumétrie | Auto-FIFO (`RoiService`) | Product 360 (`AnalyticsService`) | Capital (`CapitalService`) | Heap Memory post-calcul |
|---|---|---|---|---|
| **100 txs** | 3,95 ms | 11,45 ms | 1,01 ms | 184,2 Mo |
| **1 000 txs** | 3,32 ms | 13,68 ms | 0,27 ms | 180,6 Mo |
| **10 000 txs** | 62,50 ms | 92,15 ms | 0,38 ms | 204,5 Mo |
| **50 000 txs** | **172,85 ms** | **498,33 ms** (~0,5 s) | 0,22 ms | 175,5 Mo |

---

### 5. Cartographie des cascades de requêtes réseau frontend (`App.tsx`)
| Action / Événement utilisateur | Nombre de requêtes HTTP déclenchées | Détail des routes appelées |
|---|---|---|
| **Montage initial (`DashboardOverview`)** | **5 requêtes** | `ledger/summary`, `orders/summary`, `roi/summary`, `capital/summary`, `analytics/timeseries` |
| **Ouverture onglet Grand Livre (`fetchLedgerData`)** | **5 requêtes** | `transactions`, `summary`, `sync-status`, `filter-options`, `journal` |
| **Changement de page / filtre dans Grand Livre** | **5 requêtes** | Re-déclenchement global des 5 requêtes de `fetchLedgerData` |
| **Ouverture onglet Ordres (`fetchOrdersData`)** | **3 requêtes** | `orders`, `summary`, `restock` |
| **Ouverture onglet Hubs & ROI (`fetchRoiAndHubsData`)** | **5 requêtes** | `summary`, `allocations`, `unsold-inventory`, `hubs`, `mappings` |
| **Ouverture onglet Capital & Stocks (`fetchCapitalData`)** | **3 requêtes** | `summary`, `breakdown`, `dormant` |
| **Ouverture onglet Analytics (`fetchAnalyticsData`)** | **2 requêtes** | `timeseries`, `breakdown` |
| **Inspection Product 360 (`fetchProduct360Data`)** | **1 requête** | `/api/analytics/product/:typeId` |
| **Bascule de personnage actif (`handleSwitchCharacter`)** | **14 requêtes** | `auth/switch` + `fetchLedgerData` (5) + `fetchOrdersData` (3) + `fetchRoiAndHubsData` (5) |
| **Synchronisation globale ("Synchroniser tout")** | **13 requêtes en cascade** | `Promise.all([fetchLedgerData(), fetchOrdersData(), fetchRoiAndHubsData()])` |

---

## Déclaration Officielle de Gel Fonctionnel

**Date de prise d'effet :** 30 septembre 2026  
**Portée :** Dépôt `Avadis7860/eve-trade-dashboard`  

1. **Gel des nouvelles fonctionnalités métier :** Aucun développement de nouvelles fonctionnalités (notamment Phase 10bis, 11, 12) ne sera initié avant la validation complète et formelle des phases de fiabilité et performance (R01 à R08).
2. **Priorité absolue à la robustesse :** Les travaux se concentrent exclusivement sur la persistance relationnelle PostgreSQL réelle, la complétude ESI et la pagination sans troncature, l'assainissement des flux de requêtes frontend, l'optimisation des calculs SQL et la couverture de tests E2E.
3. **Immutabilité des contrats de domaine :** Les invariants du domaine (distinction `KNOWN`/`UNKNOWN`/`PARTIAL`/`ERROR`/`ABSENT`, exactitude décimale ISK, isolation multi-personnages, traçabilité des coûts d'acquisition) sont strictement préservés.

---

## Vérification et Critères de Sortie

| Critère de sortie | État | Preuve / Validation |
|---|---|---|
| **Script de benchmark automatisé reproductible** | **Validé** | `npm run bench:baseline` (`scripts/baseline-bench.ts`) opérationnel et déterministe |
| **Fiche de baseline officielle consignée** | **Validé** | Tableaux comparatifs ci-dessus documentés avec données mesurées réelles |
| **Suite de tests existante 100% verte** | **Validé** | 20 fichiers de tests, 149 tests Vitest au vert |
| **Vérifications Lint & Typecheck sans erreur** | **Validé** | `npm run lint` et `npm run typecheck` 100% conformes |
| **Aucun code de production altéré** | **Validé** | Intégrité stricte des sources métier et UI |

---

## Statut de la Phase
**Terminé et Validé.** Prêt pour l'engagement de la **Phase R01 — Persistance et stockage durable PostgreSQL**.
