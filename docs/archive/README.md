# Archives Documentaires

Ce répertoire rassemble les documents historiques, rapports d'audit préliminaires et spécifications de phases closes du projet **EVE Trade Dashboard**.

Ces documents sont conservés à des fins d'historique et de traçabilité des décisions passées, mais **ne constituent plus les sources de référence actives** pour le développement au quotidien.

---

## 1. Audits & Spécifications Archivées

| Document | Objet & Contexte | Remplacé / Résolu par |
|---|---|---|
| [AUDIT-AI-STUDIO-SESSION-FAILURES.md](AUDIT-AI-STUDIO-SESSION-FAILURES.md) | Rapport d'audit sur les défaillances de session et de sélection de personnage dans l'environnement iframe Google AI Studio | Résolu intégralement par la **Série S** (`docs/phases/PHASE-S01` à `S03`) et le code de production (`src/server/auth/`, `server.ts`) |
| [UX_REDESIGN_BLUEPRINT.md](UX_REDESIGN_BLUEPRINT.md) | Blueprint initial de refonte UX/UI en 6 espaces de décision pour la Phase 12 | Implémenté et stabilisé dans l'UI React (`src/components/`) et contracté dans [`docs/UX_STATES.md`](../UX_STATES.md) |

---

## 2. Spécifications des Phases Antérieures Closes (`docs/archive/phases/`)

L'ensemble des phases terminées et certifiées des époques précédentes sont conservées dans le sous-dossier **[phases/](phases/)** :

- **Époque 1 : Socle Initial & MVP**
  - `PHASE-00-foundation.md` : Fondations React 19, TypeScript strict, Express, CI
  - `PHASE-01-sso-character.md` : EVE SSO & Identité OAuth 2.0 PKCE
  - `PHASE-02-esi-gateway.md` : Passerelle ESI résiliente, cache ETag 304, rate-limiting
  - `PHASE-03-sales-ledger.md` : Grand Livre et transactions
  - `PHASE-04-order-lifecycle.md` : Cycle de vie des ordres et réassort
  - `PHASE-05-hubs-and-roi.md` : Hubs commerciaux et ROI TTC
  - `PHASE-06-dashboard.md` : Dashboard intégré initial
  - `PHASE-H01-security.md` : Hardening sécurité et isolation multi-personnages
  - `PHASE-H02-data-reliability.md` : Hardening intégrité, résilience et sauvegarde SHA-256

- **Époque 2 : Transformation Cockpit & Pilotage**
  - `PHASE-07-storage-and-history.md` : Durabilité du stockage et migrations SQL
  - `PHASE-08-financial-reconciliation.md` : Réconciliation financière et métriques versionnées
  - `PHASE-09-capital-and-inventory.md` : Positions de capital et inventaire mutuellement exclusif
  - `PHASE-10-product-360-analytics.md` : Product 360 et séries temporelles
  - `PHASE-10bis-wallets-and-scopes.md` : Soldes réels des portefeuilles et divisions corporation
  - `PHASE-11-restock-and-transfers.md` : Opérations, réapprovisionnement et transferts prioritaires
  - `PHASE-12-cockpit-and-ux-redesign.md` : Refonte globale cockpit et navigation en 6 espaces

- **Époque 3 : Assurance Fiabilité & Traçabilité (Série F)**
  - `PHASE-F01-sync-concurrency-lifecycle.md` à `PHASE-F11-multi-character-session-persistence.md` : Certifications d'intégrité comptable, FIFO pur, déduplication corporation, baux distribués et persistance hybride
  - `PHASE-H03-quality-release.md` : Hardening UX, performance et clôture

- **Époque 4 : Fiabilisation Finale Production & Sécurité (Série G)**
  - `PHASE-G01-security-auth-integrity.md` : Sécurité de production et Fail-Fast
  - `PHASE-G02-postgres-single-source-bootstrap.md` : Persistance PostgreSQL unique et bootstrap ordonnancé
  - `PHASE-G03-distributed-esi-sync-leases.md` : Baux distribués ESI
  - `PHASE-G04-corp-deduplication-backup-probes.md` : Déduplication corporation SQL et sondes de santé
  - `PHASE-G05-real-ci-e2e-release-ready.md` : Certification finale Release Ready et pipeline CI
