# Index canonique

| Besoin | Document |
|---|---|
| Audit technique approfondi Post-Phase 12 | [AUDIT-POST-PHASE-12](AUDIT-POST-PHASE-12.md) |
| Masterplan Assurance Fiabilité & Traçabilité | [MASTERPLAN-ASSURANCE-FIABILITE](MASTERPLAN-ASSURANCE-FIABILITE.md) |
| Plan et statut des phases | [MASTERPLAN](MASTERPLAN.md) |
| Roadmap Fiabilité & Performance | [MASTERPLAN-RELIABILITY-PERFORMANCE](MASTERPLAN-RELIABILITY-PERFORMANCE.md) |
| Audit produit existant & modèle cible | [PRODUCT_REDESIGN_AUDIT](PRODUCT_REDESIGN_AUDIT.md) |
| Blueprint Refonte UX/UI & Navigation (Phase 12) | [UX_REDESIGN_BLUEPRINT](UX_REDESIGN_BLUEPRINT.md) |
| Périmètre et exclusions | [PRODUCT_SCOPE](PRODUCT_SCOPE.md) |
| Architecture technique | [ARCHITECTURE](ARCHITECTURE.md) |
| Invariants et contrats métier | [DOMAIN_CONTRACTS](DOMAIN_CONTRACTS.md) |
| ESI, cache, SSO, limites | [ESI_RESILIENCE](ESI_RESILIENCE.md) |
| Sécurité et confidentialité | [SECURITY_PRIVACY](SECURITY_PRIVACY.md) |
| Métriques financières et formules | [METRICS](METRICS.md) |
| États UI et ergonomie cible | [UX_STATES](UX_STATES.md) |
| Tests et intégration continue | [TESTING_CI](TESTING_CI.md) |
| Workflow agent IA | [AI_AGENT_WORKFLOW](AI_AGENT_WORKFLOW.md) |
| Inventaire réel du code | [CODE_INDEX](CODE_INDEX.md) |

## Phases initiales (Socle)
- [00 Fondations](phases/PHASE-00-foundation.md) — *Terminé*
- [01 SSO et identité](phases/PHASE-01-sso-character.md) — *Terminé*
- [02 Passerelle ESI](phases/PHASE-02-esi-gateway.md) — *Terminé*
- [03 Ventes et grand livre](phases/PHASE-03-sales-ledger.md) — *Terminé*
- [04 Ordres et réapprovisionnement initial](phases/PHASE-04-order-lifecycle.md) — *Terminé*
- [05 Hubs et ROI TTC](phases/PHASE-05-hubs-and-roi.md) — *Terminé*
- [06 Dashboard intégré initial](phases/PHASE-06-dashboard.md) — *Terminé*

## Hardening initial
- [H01 Sécurité et isolation](phases/PHASE-H01-security.md) — *Terminé*
- [H02 Intégrité et résilience](phases/PHASE-H02-data-reliability.md) — *Terminé*

## Roadmap de transformation (Système de Pilotage)
- [07 Durabilité et historique fiable](phases/PHASE-07-storage-and-history.md) — *Terminé*
- [08 Réconciliation financière et métriques versionnées](phases/PHASE-08-financial-reconciliation.md) — *Terminé*
- [09 Positions de capital et inventaire](phases/PHASE-09-capital-and-inventory.md) — *Terminé*
- [10 Product 360 et analyses temporelles](phases/PHASE-10-product-360-analytics.md) — *Terminé*
- [10.bis Soldes réels des wallets, filtrage de liquidité et scopes ESI complets](phases/PHASE-10bis-wallets-and-scopes.md) — *Terminé*
- [11 Opérations, réapprovisionnement et transferts](phases/PHASE-11-restock-and-transfers.md) — *Terminé*
- [12 Refonte du cockpit, navigation et intégration UX](phases/PHASE-12-cockpit-and-ux-redesign.md) — *Terminé*

## Roadmap Post-Audit — Assurance Fiabilité & Traçabilité (Série F)
- [F01 Cycle de vie sync, annulation réelle et persistance asynchrone](phases/PHASE-F01-sync-concurrency-lifecycle.md) — *Terminé*
- [F02 Intégrité du stockage, anti-écrasement et vérité des données](phases/PHASE-F02-data-integrity-storage.md) — *Terminé*
- [F03 Invariants financiers, détection chronologique et valorisation FIFO](phases/PHASE-F03-financial-inventory-invariants.md) — *Terminé*
- [F04 Preuves de qualification réelles : PostgreSQL CI et tests E2E navigateur](phases/PHASE-F04-testing-ci-real-postgres-e2e.md) — *Prête à démarrer*

## Release Finale
- [H03 Hardening UX, performance et release](phases/PHASE-H03-quality-release.md) — *Planifiée (après série F)*

## Roadmap Historique — Fiabilité & Performance (R00–R08)
- [R00 Baseline, mesure et gel fonctionnel](phases/PHASE-R00-baseline.md) — *Terminé*
- [R01 Persistance et stockage durable PostgreSQL](phases/PHASE-R01-persistence.md) — *Terminé*
- [R02 Complétude, pagination et vérité des états](phases/PHASE-R02-completeness-pagination.md) — *Terminé*
- [R03 Architecture des requêtes frontend](phases/PHASE-R03-frontend-query-architecture.md) — *Terminé*
- [R04 Optimisation des calculs métier et accès SQL](phases/PHASE-R04-business-calculations-data-access.md) — *Terminé*
- [R05 Synchronisation ESI et concurrence contrôlée](phases/PHASE-R05-esi-sync-concurrency.md) — *Terminé*
- [R06 Sécurité, isolation multi-perso et backup](phases/PHASE-R06-security-isolation-backup.md) — *Terminé*
- [R07 Stratégie de tests complète (Domain, SQL, HTTP, UI, E2E)](phases/PHASE-R07-testing-strategy.md) — *Terminé*
- [R08 Observabilité et critères de production](phases/PHASE-R08-observability-production.md) — *Terminé*

Le masterplan, le masterplan d'assurance fiabilité et le rapport d'audit post-phase 12 sont les sources de vérité sur les statuts. Ne pas dupliquer ici les plans détaillés.
