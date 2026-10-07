# Répertoire Canonique des Phases de Travail

Ce dossier rassemble les cahiers des charges et critères de qualification de l'ensemble des phases de développement du projet **EVE Trade Dashboard**.

---

## 1. Gouvernance & Cycle de Vie des Phases

Chaque phase suit une discipline stricte de livraison :
- **1 Phase = 1 Chantier = 1 Branche = 1 Pull Request.**
- Aucun développement direct sur la branche `main`.
- Les critères de sortie de chaque phase doivent être prouvés par des tests automatisés verts.
- La documentation associée et l'inventaire `docs/CODE_INDEX.md` sont mis à jour dans la même PR.

---

## 2. Table Récapitulative des Phases par Époque

### Époque 1 : Socle Initial & MVP
| Phase | Intitulé | État | Document |
|---|---|---|---|
| **00** | Fondations React 19, TypeScript strict, Express, CI | Terminé | [PHASE-00-foundation.md](PHASE-00-foundation.md) |
| **01** | EVE SSO & Identité (OAuth 2.0 PKCE) | Terminé | [PHASE-01-sso-character.md](PHASE-01-sso-character.md) |
| **02** | Client ESI résilient (Cache ETag, Rate-limiting, Retry) | Terminé | [PHASE-02-esi-gateway.md](PHASE-02-esi-gateway.md) |
| **03** | Transactions et grand livre | Terminé | [PHASE-03-sales-ledger.md](PHASE-03-sales-ledger.md) |
| **04** | Cycle de vie des ordres et réapprovisionnement initial | Terminé | [PHASE-04-order-lifecycle.md](PHASE-04-order-lifecycle.md) |
| **05** | Hubs commerciaux et rentabilité brute | Terminé | [PHASE-05-hubs-and-roi.md](PHASE-05-hubs-and-roi.md) |
| **06** | Dashboard intégré initial | Terminé | [PHASE-06-dashboard.md](PHASE-06-dashboard.md) |
| **H01**| Hardening sécurité et isolation multi-personnages | Terminé | [PHASE-H01-security.md](PHASE-H01-security.md) |
| **H02**| Hardening intégrité, résilience et sauvegarde SHA-256 | Terminé | [PHASE-H02-data-reliability.md](PHASE-H02-data-reliability.md) |

### Époque 2 : Transformation Cockpit & Système de Pilotage
| Phase | Intitulé | État | Document |
|---|---|---|---|
| **07** | Durabilité du stockage et historique fiable (Migrations SQL) | Terminé | [PHASE-07-storage-and-history.md](PHASE-07-storage-and-history.md) |
| **08** | Réconciliation financière et métriques versionnées | Terminé | [PHASE-08-financial-reconciliation.md](PHASE-08-financial-reconciliation.md) |
| **09** | Positions de capital et inventaire mutuellement exclusif | Terminé | [PHASE-09-capital-and-inventory.md](PHASE-09-capital-and-inventory.md) |
| **10** | Product 360 et visualisations temporelles | Terminé | [PHASE-10-product-360-analytics.md](PHASE-10-product-360-analytics.md) |
| **10.bis** | Soldes réels des wallets et divisions corporatives (1 à 7) | Terminé | [PHASE-10bis-wallets-and-scopes.md](PHASE-10bis-wallets-and-scopes.md) |
| **11** | Opérations, réapprovisionnement et transferts prioritaires | Terminé | [PHASE-11-restock-and-transfers.md](PHASE-11-restock-and-transfers.md) |
| **12** | Refonte globale du cockpit et navigation en 6 espaces | Terminé | [PHASE-12-cockpit-and-ux-redesign.md](PHASE-12-cockpit-and-ux-redesign.md) |

### Époque 3 : Assurance Fiabilité & Traçabilité (Série F)
*Fruit de l'audit approfondi post-Phase 12 ([docs/AUDIT-POST-PHASE-12.md](../AUDIT-POST-PHASE-12.md)).*
| Phase | Intitulé | État | Document |
|---|---|---|---|
| **F01** | Cycle de vie sync, annulation réelle `AbortSignal` et persistance | Terminé | [PHASE-F01-sync-concurrency-lifecycle.md](PHASE-F01-sync-concurrency-lifecycle.md) |
| **F02** | Intégrité du stockage, anti-écrasement et sauvegarde `.corrupt.bak` | Terminé | [PHASE-F02-data-integrity-storage.md](PHASE-F02-data-integrity-storage.md) |
| **F03** | Invariants financiers, chronologie stricte et FIFO pur sans coût moyen | Terminé | [PHASE-F03-financial-inventory-invariants.md](PHASE-F03-financial-inventory-invariants.md) |
| **F04** | Qualification PostgreSQL réelle CI (`F04-A`) et tests E2E Chromium (`F04-B`) | Terminé | [PHASE-F04-testing-ci-real-postgres-e2e.md](PHASE-F04-testing-ci-real-postgres-e2e.md) |
| **F05** | Pagination complète et exhaustive des journaux corporatifs | Terminé | [PHASE-F05-corporation-journal-completeness.md](PHASE-F05-corporation-journal-completeness.md) |
| **F06** | Identité canonique et déduplication des journaux corporatifs | Terminé | [PHASE-F06-corporation-journal-deduplication.md](PHASE-F06-corporation-journal-deduplication.md) |
| **F07** | Rapprochement fiscal déterministe SCC M+1 sans double comptage | Terminé | [PHASE-F07-deterministic-tax-reconciliation.md](PHASE-F07-deterministic-tax-reconciliation.md) |
| **F08** | Attribution unitaire des frais de courtage et reliquats orphelins | Terminé | [PHASE-F08-broker-fee-attribution.md](PHASE-F08-broker-fee-attribution.md) |
| **F09** | Réconciliation financière TTC et preuve mathématique `FormulaProof` | Terminé | [PHASE-F09-ttc-financial-reconciliation.md](PHASE-F09-ttc-financial-reconciliation.md) |
| **F10** | Reconstitution historique, recalcul rétrospectif et validation à delta 0 | Terminé | [PHASE-F10-historical-financial-recovery.md](PHASE-F10-historical-financial-recovery.md) |
| **F11** | Persistance sessions multi-personnages et résilience iframe | Terminé | [PHASE-F11-multi-character-session-persistence.md](PHASE-F11-multi-character-session-persistence.md) |
| **H03** | Hardening UX, performance et release | Terminé / Archivé | [PHASE-H03-quality-release.md](PHASE-H03-quality-release.md) |

### Époque 4 : Fiabilisation Finale Production & Sécurité (Série G)
*Roadmap officielle post-F11 ([docs/ROADMAP-OFFICIELLE-FIABILISATION-POST-F11.md](../ROADMAP-OFFICIELLE-FIABILISATION-POST-F11.md)).*
| Phase | Intitulé | État | Document |
|---|---|---|---|
| **G01** | Sécurité de production, Fail-Fast clé chiffrement et single-flight OAuth | Terminé | [PHASE-G01-security-auth-integrity.md](PHASE-G01-security-auth-integrity.md) |
| **G02** | Persistance PostgreSQL unique sans maps divergentes et bootstrap ordonné | Terminé | [PHASE-G02-postgres-single-source-bootstrap.md](PHASE-G02-postgres-single-source-bootstrap.md) |
| **G03** | Baux distribués ESI PostgreSQL (`esi_sync_leases`) et concurrence | Terminé | [PHASE-G03-distributed-esi-sync-leases.md](PHASE-G03-distributed-esi-sync-leases.md) |
| **G04** | Déduplication corporation SQL, backups atomiques et sondes `/health/ready` | Terminé | [PHASE-G04-corp-deduplication-backup-probes.md](PHASE-G04-corp-deduplication-backup-probes.md) |
| **G05** | Pipeline CI GitHub Actions complet, exercice DR et certification Release | Planifiée | [PHASE-G05-real-ci-e2e-release-ready.md](PHASE-G05-real-ci-e2e-release-ready.md) |

### Époque Historique : Remise à Niveau & Performance (Série R)
*Cadrage de référence ([docs/MASTERPLAN-RELIABILITY-PERFORMANCE.md](../MASTERPLAN-RELIABILITY-PERFORMANCE.md)).*
| Phase | Intitulé | État | Document |
|---|---|---|---|
| **R00** | Baseline, mesure de performance et profilage | Archivé / Terminé | [PHASE-R00-baseline.md](PHASE-R00-baseline.md) |
| **R01** | Fondations de persistance et stockage durable | Archivé / Terminé | [PHASE-R01-persistence.md](PHASE-R01-persistence.md) |
| **R02** | Complétude des données et pagination adaptative | Archivé / Terminé | [PHASE-R02-completeness-pagination.md](PHASE-R02-completeness-pagination.md) |
| **R03** | Architecture des requêtes frontend (`apiClient`, cache, abort) | Archivé / Terminé | [PHASE-R03-frontend-query-architecture.md](PHASE-R03-frontend-query-architecture.md) |
| **R04** | Optimisation des requêtes SQL et indexation | Archivé / Terminé | [PHASE-R04-business-calculations-data-access.md](PHASE-R04-business-calculations-data-access.md) |
| **R05** | Synchronisation ESI et limitation de concurrence | Archivé / Terminé | [PHASE-R05-esi-sync-concurrency.md](PHASE-R05-esi-sync-concurrency.md) |
| **R06** | Sécurité, isolation multi-personnages et sauvegardes | Archivé / Terminé | [PHASE-R06-security-isolation-backup.md](PHASE-R06-security-isolation-backup.md) |
| **R07** | Stratégie de tests complète (Domain, SQL, HTTP, UI, E2E) | Archivé / Terminé | [PHASE-R07-testing-strategy.md](PHASE-R07-testing-strategy.md) |
| **R08** | Observabilité et métriques système de production | Archivé / Terminé | [PHASE-R08-observability-production.md](PHASE-R08-observability-production.md) |
