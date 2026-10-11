# Répertoire Canonique des Phases de Travail

Ce dossier rassemble les spécifications et critères de qualification des phases de développement actives du projet **EVE Trade Dashboard**.

---

## 1. Gouvernance & Cycle de Vie des Phases

Chaque phase suit une discipline stricte de livraison :
- **1 Phase = 1 Chantier = 1 Branche = 1 Pull Request.**
- Aucun développement direct sur la branche `main`.
- Les critères de sortie de chaque phase doivent être prouvés par des tests automatisés verts.
- La documentation associée et l'inventaire `docs/CODE_INDEX.md` sont mis à jour dans la même PR.

---

## 2. Série Active : Moteur Intégré Production, PI, Industrie & Traçabilité des Coûts (Série P)

| Phase | Intitulé | État | Spécification |
|---|---|---|---|
| **P01** | Ingestion ESI Dédiée & Régulation Débit : PI, Industrie & Minage (Sub-batching, cache Expires, protection quota) | Planifiée | [PHASE-P01-esi-ingestion-rate-concurrency-pi-industry-mining.md](PHASE-P01-esi-ingestion-rate-concurrency-pi-industry-mining.md) |
| **P02** | Registre Minier & Modélisation des Coûts d'Opportunité Farm / Mining (FARMED_PROVENANCE, valeur d'extraction non nulle) | Planifiée | [PHASE-P02-mining-farm-ledger-opportunity-cost.md](PHASE-P02-mining-farm-ledger-opportunity-cost.md) |
| **P03** | Colonies Planétaires & Flux de Matières PI (Pins, cadences horaires, silos, taxes POCO) | Planifiée | [PHASE-P03-planetary-interaction-colonies-customs.md](PHASE-P03-planetary-interaction-colonies-customs.md) |
| **P04** | Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours WIP (Manufacturing, réactions, frais d'installation) | Planifiée | [PHASE-P04-industry-jobs-bom-work-in-progress.md](PHASE-P04-industry-jobs-bom-work-in-progress.md) |
| **P05** | Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur P0->P4 et BOM sans rupture) | Planifiée | [PHASE-P05-multi-tier-fifo-cost-propagation.md](PHASE-P05-multi-tier-fifo-cost-propagation.md) |

---

## 3. Séries Antérieures Récemment Complétées

### Série S : Résilience Sessions & Iframe AI Studio (Série S)
| Phase | Intitulé | État | Spécification |
|---|---|---|---|
| **S01** | Transport hybride unifié, Bearer universel et déconnexion déterministe | Terminé | [PHASE-S01-transport-hybrid-logout-determinism.md](PHASE-S01-transport-hybrid-logout-determinism.md) |
| **S02** | Sélection et invariance absolue du personnage principal sélectionné | Terminé | [PHASE-S02-active-character-selection-invariance.md](PHASE-S02-active-character-selection-invariance.md) |
| **S03** | Pérennité des flottes au bootstrap et résilience pop-up iframe AI Studio | Terminé | [PHASE-S03-fleet-persistence-iframe-resilience.md](PHASE-S03-fleet-persistence-iframe-resilience.md) |

---

## 4. Phases Antérieures Archivées

L'ensemble des phases closes des époques précédentes (Époques 1 à 4) a été consolidé et archivé dans **[`docs/archive/phases/`](../archive/phases/)** :

- **Époque 1 : Socle Initial & MVP** (`PHASE-00` à `PHASE-06`, `PHASE-H01`, `PHASE-H02`) : Fondations React 19 / TypeScript, SSO PKCE, client ESI, Grand Livre, cycle des ordres, hubs, dashboard initial et durcissement de sécurité.
- **Époque 2 : Transformation Cockpit & Pilotage** (`PHASE-07` à `PHASE-12`, `PHASE-10bis`) : Persistance SQL, réconciliation FIFO initiale, positions de capital, Product 360, soldes réels de portefeuilles, logistique & transferts, cockpit en 6 espaces.
- **Époque 3 : Assurance Fiabilité & Traçabilité (Série F)** (`PHASE-F01` à `PHASE-F11`, `PHASE-H03`) : Invariants financiers, pagination intégrale des journaux, déduplication corporation, attribution fiscale SCC M+1, attribution courtage, preuve TTC `FormulaProof`, recalcul d'historique et persistance des sessions.
- **Époque 4 : Fiabilisation Finale Production (Série G)** (`PHASE-G01` à `PHASE-G05`) : Sécurité de production, source unique PostgreSQL, baux distribués `esi_sync_leases`, sondes `/health/ready` et validation Release Ready.

Consulter **[`docs/archive/README.md`](../archive/README.md)** pour le détail de l'ensemble des documents archivés.
