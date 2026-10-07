# Index canonique de la documentation

Ce document constitue la porte d'entrée unique et la source de vérité pour la navigation documentaire du projet **EVE Trade Dashboard**.

---

## 1. Documents Directeurs & Stratégie

| Document | Objet & Périmètre | Rôle |
|---|---|---|
| [MASTERPLAN](MASTERPLAN.md) | Vision produit, gouvernance, statut canonique de chaque phase et invariants fondamentaux | **Source de vérité des statuts** |
| [ROADMAP-OFFICIELLE-FIABILISATION-POST-F11](ROADMAP-OFFICIELLE-FIABILISATION-POST-F11.md) | Feuille de route officielle de production (Série G : G01 à G05) traitant l'ensemble des constats d'audit | Arbitrages & Roadmap Prod |
| [MASTERPLAN-ASSURANCE-FIABILITE](MASTERPLAN-ASSURANCE-FIABILITE.md) | Masterplan de certification de la fiabilité comptable et traçabilité (Série F) | Cadre qualité F01–F11 |
| [AUDIT-POST-PHASE-12](AUDIT-POST-PHASE-12.md) | Rapport contradictoire exhaustif post-Phase 12 (identifiant 30 chantiers de fiabilisation) | Audit initial système |
| [AUDIT-TASK-55-FINANCIAL-RECONCILIATION](AUDIT-TASK-55-FINANCIAL-RECONCILIATION.md) | Analyse approfondie des écarts financiers, déduplication corpo et réconciliation TTC | Audit comptable Task-55 |
| [MASTERPLAN-RELIABILITY-PERFORMANCE](MASTERPLAN-RELIABILITY-PERFORMANCE.md) | Feuille de route de remise à niveau et optimisation sous charge (Série R : R00 à R08) | Cadrage technique R00–R08 |
| [PRODUCT_SCOPE](PRODUCT_SCOPE.md) | Périmètre strict du produit et anti-périmètre (ce que le produit fait et ne fait pas) | Cadrage fonctionnel |
| [PRODUCT_REDESIGN_AUDIT](PRODUCT_REDESIGN_AUDIT.md) | Audit ergonomique du produit historique et spécification du modèle de pilotage cible | Cadrage produit |
| [UX_REDESIGN_BLUEPRINT](UX_REDESIGN_BLUEPRINT.md) | Spécification d'architecture UX/UI en 6 espaces de décision et modèle de fenêtrage | Spécification UX |

---

## 2. Contrats Techniques & Spécifications Métier

| Document | Domaine & Responsabilités |
|---|---|
| [ARCHITECTURE](ARCHITECTURE.md) | Architecture technique globale : monolithe modulaire, flux de données, couches applicatives |
| [ALGORITHMS](ALGORITHMS.md) | Index canonique et spécification complète des 8 algorithmes et moteurs métier majeurs |
| [DOMAIN_CONTRACTS](DOMAIN_CONTRACTS.md) | Invariants métier immuables : cycle de vie des ordres, lots FIFO, unicité des identités |
| [METRICS](METRICS.md) | Définitions formelles et formules mathématiques : ROI TTC, COGS, vélocité, couverture |
| [ESI_RESILIENCE](ESI_RESILIENCE.md) | Spécifications de la passerelle ESI : budgets d'erreurs CCP, cache 304, rate-limits, pagination |
| [SECURITY_PRIVACY](SECURITY_PRIVACY.md) | Règles de sécurité : OAuth 2.0 PKCE, chiffrement AES-256-GCM, isolation des tenants, CSP |
| [UX_STATES](UX_STATES.md) | Spécification des 5 états UI fondamentaux (`EMPTY`, `LOADING`, `PARTIAL`, `ERROR`, `SYNCING`) |
| [TESTING_CI](TESTING_CI.md) | Stratégie de qualification : pyramide de tests, conteneurs réels, seuils de couverture, CI |
| [AI_AGENT_WORKFLOW](AI_AGENT_WORKFLOW.md) | Protocole d'intervention pour les agents d'ingénierie logicielle (règles strictes de dev) |
| [CODE_INDEX](CODE_INDEX.md) | Inventaire canonique des fichiers du projet, responsabilités et suites de tests associées |

---

## 3. Index Exhaustif des Phases de Travail

Le détail complet de l'ensemble des phases et de leur gouvernance est consigné dans **[docs/phases/README.md](phases/README.md)**.

### Série Fondations & Socle Initial (Phases 00 à 06)
- [Phase 00 — Fondations](phases/PHASE-00-foundation.md) — *Terminée* : Socle React 19, TypeScript strict, Express, outillage et pipeline de test.
- [Phase 01 — SSO & Identité](phases/PHASE-01-sso-character.md) — *Terminée* : Intégration EVE SSO OAuth 2.0 avec PKCE RFC 7636 et gestion multi-personnages.
- [Phase 02 — Passerelle ESI](phases/PHASE-02-esi-gateway.md) — *Terminée* : Client HTTP ESI avec gestion du cache ETag/304, backoff exponentiel et rate-limiter.
- [Phase 03 — Grand Livre & Transactions](phases/PHASE-03-sales-ledger.md) — *Terminée* : Collecte et restitution des transactions d'achat/vente et entrées du journal de portefeuille.
- [Phase 04 — Cycle de Vie des Ordres](phases/PHASE-04-order-lifecycle.md) — *Terminée* : Suivi d'état des ordres de marché, détection des expirations et réassort initial.
- [Phase 05 — Hubs Commerciaux & ROI TTC](phases/PHASE-05-hubs-and-roi.md) — *Terminée* : Résolution des stations/structures en hubs commerciaux et calcul de rentabilité brute.
- [Phase 06 — Dashboard Intégré Initial](phases/PHASE-06-dashboard.md) — *Terminée* : Vue cockpit initiale unifiant les métriques clés, alertes et raccourcis.

### Série Sécurité & Hardening Initial (Phases H01 & H02)
- [Phase H01 — Sécurité & Isolation](phases/PHASE-H01-security.md) — *Terminée* : Cloisonnement strict multi-personnages, protection CSRF, en-têtes CSP et masquage des secrets.
- [Phase H02 — Intégrité & Résilience](phases/PHASE-H02-data-reliability.md) — *Terminée* : Persistance atomique, sauvegardes SHA-256 et tolérance aux défaillances réseau ESI.

### Série Transformation & Cockpit de Pilotage (Phases 07 à 12)
- [Phase 07 — Durabilité & Historique Fiable](phases/PHASE-07-storage-and-history.md) — *Terminée* : Couche de persistance structurée avec migrations relationnelles versionnées.
- [Phase 08 — Réconciliation Financière & Métriques Versionnées](phases/PHASE-08-financial-reconciliation.md) — *Terminée* : Rapprochement FIFO des achats/ventes et traçabilité unitaire des coûts.
- [Phase 09 — Positions de Capital & Inventaire](phases/PHASE-09-capital-and-inventory.md) — *Terminée* : Décomposition du capital physique et monétaire en 5 états mutuellement exclusifs.
- [Phase 10 — Product 360 & Séries Temporelles](phases/PHASE-10-product-360-analytics.md) — *Terminée* : Fiche d'inspection $360^\circ$ d'un article, calcul de vélocité $V_{jour}$ et pyramide des âges.
- [Phase 10.bis — Soldes Réels & Wallets Corporatifs](phases/PHASE-10bis-wallets-and-scopes.md) — *Terminée* : Prise en charge des soldes de portefeuille réels (personnages et divisions corpo 1 à 7).
- [Phase 11 — Opérations, Logistique & Transferts](phases/PHASE-11-restock-and-transfers.md) — *Terminée* : Arbitrage prioritaire des transferts avant achats, calcul $m^3$ cargo et export Multibuy.
- [Phase 12 — Refonte UX & Navigation en 6 Espaces](phases/PHASE-12-cockpit-and-ux-redesign.md) — *Terminée* : Architecture de l'information en 6 espaces de décision, tiroirs latéraux et accordéons.

### Série F — Assurance Fiabilité & Traçabilité (Phases F01 à F11)
- [Phase F01 — Cycle de Vie Sync & Concurrence](phases/PHASE-F01-sync-concurrency-lifecycle.md) — *Terminée* : Annulation réelle via `AbortSignal`, persistance asynchrone ACID et cycle de vie.
- [Phase F02 — Intégrité du Stockage & Anti-Écrasement](phases/PHASE-F02-data-integrity-storage.md) — *Terminée* : Prévention de corruption de stockage, auto-backup de secours `.corrupt.bak` et vérité des états.
- [Phase F03 — Invariants Financiers & FIFO Pur](phases/PHASE-F03-financial-inventory-invariants.md) — *Terminée* : Élimination définitive de tout coût moyen implicite, FIFO chronologique et qualification `PARTIAL`.
- [Phase F04 — Preuves Réelles PostgreSQL & E2E](phases/PHASE-F04-testing-ci-real-postgres-e2e.md) — *Terminée* : Qualification sur vrai moteur PostgreSQL (`F04-A`) et tests navigateurs Chromium Playwright (`F04-B`).
- [Phase F05 — Exhaustivité des Journaux Corporation](phases/PHASE-F05-corporation-journal-completeness.md) — *Terminée* : Pagination adaptative complète par division corporative sans troncature arbitraire.
- [Phase F06 — Déduplication Canonique Corporation](phases/PHASE-F06-corporation-journal-deduplication.md) — *Terminée* : Clé composite `corp:id:div:journalId`, déduplication multi-directeurs et métadonnées d'observateurs.
- [Phase F07 — Rapprochement Fiscal Déterministe SCC M+1](phases/PHASE-F07-deterministic-tax-reconciliation.md) — *Terminée* : 3 passes d'attribution exclusive, réservation d'unicité, zéro double comptage.
- [Phase F08 — Attribution des Frais de Courtage](phases/PHASE-F08-broker-fee-attribution.md) — *Terminée* : Corrélation ordres-journal `context_id`, proratisation par volume exécuté et traçabilité des reliquats.
- [Phase F09 — Réconciliation Financière TTC & Preuves](phases/PHASE-F09-ttc-financial-reconciliation.md) — *Terminée* : Couverture financière en ISK vs volume en unités, séparation CA alloué/non-alloué et `FormulaProof`.
- [Phase F10 — Reconstitution Historique & Recalcul](phases/PHASE-F10-historical-financial-recovery.md) — *Terminée* : Moteur de recalcul rétrospectif avec audit contradictoire à delta ISK nul et backup SHA-256.
- [Phase F11 — Persistance des Sessions & Résilience Iframe](phases/PHASE-F11-multi-character-session-persistence.md) — *Terminée* : Persistance multi-personnages sur DB, transport hybride Cookie+Bearer, chiffrement des tokens au repos.

### Série G — Fiabilisation Finale & Prêt pour Production (Phases G01 à G05)
- [Phase G01 — Sécurité de Production & Intégrité Authentification](phases/PHASE-G01-security-auth-integrity.md) — *Terminée* : Exclusion physique des routes test en prod, Fail-Fast sur clé de chiffrement, single-flight OAuth.
- [Phase G02 — Persistance PostgreSQL Unique & Bootstrap Asynchrone](phases/PHASE-G02-postgres-single-source-bootstrap.md) — *Terminée* : PostgreSQL source unique de vérité sans maps parallèles divergentes, `bootstrapApp()` bloquant avant écoute HTTP.
- [Phase G03 — Concurrence Distribuée & Synchronisation ESI](phases/PHASE-G03-distributed-esi-sync-leases.md) — *Terminée* : Table de baux distribués `esi_sync_leases` avec TTL et heartbeat, prévention de saturation ESI inter-instances.
- [Phase G04 — Cohérence Opérationnelle, Backup & Observabilité](phases/PHASE-G04-corp-deduplication-backup-probes.md) — *Terminée* : Déduplication corporation multi-directeurs sur SQL, export/import atomique SHA-256 et sondes `/health/live` & `/health/ready`.
- [Phase G05 — Qualification CI Réelle, Disaster Recovery & Release Ready](phases/PHASE-G05-real-ci-e2e-release-ready.md) — *Planifiée* : Pipeline GitHub Actions exhaustif, exercice Disaster Recovery officiel et validation des 15 critères de Release.

### Série R — Historique Performance & Remise à Niveau (Phases R00 à R08)
- [Phase R00 — Baseline & Mesure](phases/PHASE-R00-baseline.md) — *Terminée* : Profiling mémoire, latence et gel fonctionnel.
- [Phase R01 — Persistance Durable](phases/PHASE-R01-persistence.md) — *Terminée* : Fondations de stockage durable.
- [Phase R02 — Complétude & Pagination](phases/PHASE-R02-completeness-pagination.md) — *Terminée* : Stratégies de pagination et vérité des statuts.
- [Phase R03 — Requêtes Frontend](phases/PHASE-R03-frontend-query-architecture.md) — *Terminée* : Gestionnaire unifié `apiClient` avec coalescing et cache.
- [Phase R04 — Calculs Métier SQL](phases/PHASE-R04-business-calculations-data-access.md) — *Terminée* : Optimisation des accès et index relationnels.
- [Phase R05 — Concurrence ESI](phases/PHASE-R05-esi-sync-concurrency.md) — *Terminée* : Pool de workers et limitation de concurrence.
- [Phase R06 — Sécurité & Backup](phases/PHASE-R06-security-isolation-backup.md) — *Terminée* : Isolation multi-personnages et sauvegardes.
- [Phase R07 — Stratégie de Tests](phases/PHASE-R07-testing-strategy.md) — *Terminée* : Couverture des tests sur tous les domaines.
- [Phase R08 — Observabilité Production](phases/PHASE-R08-observability-production.md) — *Terminée* : Métriques in-memory et indicateurs système.
- [Phase H03 — Hardening UX, Performance & Release](phases/PHASE-H03-quality-release.md) — *Terminée / Archivée* : Synthèse de clôture post-F11.
