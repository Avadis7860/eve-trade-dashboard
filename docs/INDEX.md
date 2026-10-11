# Index canonique de la documentation

Ce document constitue la porte d'entrée unique et la source de vérité pour la navigation documentaire du projet **EVE Trade Dashboard**.

---

## 1. Documents Directeurs & Cadrage Stratégique

| Document | Objet & Périmètre | Rôle |
|---|---|---|
| [MASTERPLAN](MASTERPLAN.md) | Vision produit, gouvernance, statut canonique de chaque phase et invariants fondamentaux | **Source de vérité des statuts** |
| [PRODUCT_SCOPE](PRODUCT_SCOPE.md) | Périmètre strict du produit et anti-périmètre (ce que le produit fait et ne fait pas) | Cadrage fonctionnel & frontières |
| [CODE_INDEX](CODE_INDEX.md) | Inventaire canonique des fichiers du projet, responsabilités et suites de tests associées | Cartographie exhaustive du code |

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

---

## 3. Feuilles de Route & Phases de Travail (`docs/phases/`)

Le répertoire **[docs/phases/README.md](phases/README.md)** documente la gouvernance et les phases actives du projet :

### Série Active : Moteur Intégré Production, PI, Industrie & Traçabilité des Coûts (Série P)
- [Phase P01 — Ingestion ESI Dédiée & Régulation Débit : PI, Industrie & Minage](phases/PHASE-P01-esi-ingestion-rate-concurrency-pi-industry-mining.md) — *Terminée* : Ingestion résiliente des 5 routes ESI, sous-lots bornés pour 66 colonies PI, cache HTTP strict `Expires` et préservation du quota d'erreurs.
- [Phase P02 — Registre Minier & Modélisation des Coûts d'Opportunité Farm / Mining](phases/PHASE-P02-mining-farm-ledger-opportunity-cost.md) — *Planifiée* : Module dédié `mining/`, traçabilité `FARMED_PROVENANCE`, double comptabilisation trésorerie vs coût d'opportunité d'extraction (`ESTIMATED_EXTRACTION_VALUE`).
- [Phase P03 — Colonies Planétaires & Flux de Matières PI](phases/PHASE-P03-planetary-interaction-colonies-customs.md) — *Planifiée* : Module dédié `pi/`, pins, extracteurs, usines P1->P4, taxes POCO douanières et état de capital `PLANETARY_COLONY_STOCK`.
- [Phase P04 — Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours WIP](phases/PHASE-P04-industry-jobs-bom-work-in-progress.md) — *Planifiée* : Module dédié `industry/`, traçabilité des jobs, nomenclature BOM, frais d'installation et état de capital `WIP_INVENTORY_CAPITAL`.
- [Phase P05 — Moteur de Propagation Déterministe des Coûts](phases/PHASE-P05-multi-tier-fifo-cost-propagation.md) — *Planifiée* : Sous-moteur `production/costPropagator`, propagation ascendante FIFO multi-niveaux sans rupture de chaîne et preuve `FormulaProof` enrichie.

### Série Complétée : Résilience Sessions & Iframe Google AI Studio (Série S)
- [Phase S01 — Transport Hybride Unifié & Déconnexion Déterministe](phases/PHASE-S01-transport-hybrid-logout-determinism.md) — *Terminée* : Remplacement de tous les fetch natifs par fetchJson, injection universelle Bearer/X-Session-ID, déconnexion bilatérale déterministe.
- [Phase S02 — Sélection & Invariance du Personnage Principal](phases/PHASE-S02-active-character-selection-invariance.md) — *Terminée* : Sécurisation de switchActiveCharacter avec Bearer, invariance absolue de activeCharacterId lors des refresh de tokens CCP, typage numérique strict.
- [Phase S03 — Pérennité des Flottes & Résilience Iframe AI Studio](phases/PHASE-S03-fleet-persistence-iframe-resilience.md) — *Terminée* : Hydratation asynchrone bloquante SessionStore.init() dans bootstrapApp(), bouton d'ajout lié à la session active, fiabilisation pop-up/callback OAuth sans blocage.

---

## 4. Archives Documentaires (`docs/archive/`)

Les spécifications des époques antérieures closes ainsi que les rapports d'audit historiques ont été consolidés dans **[docs/archive/README.md](archive/README.md)** :

- **[docs/archive/phases/](archive/phases/)** :
  - **Époque 1 : Socle Initial & MVP** (`PHASE-00` à `06`, `H01`, `H02`)
  - **Époque 2 : Transformation Cockpit & Pilotage** (`PHASE-07` à `12`, `10bis`)
  - **Époque 3 : Assurance Fiabilité & Traçabilité (Série F)** (`PHASE-F01` à `F11`, `H03`)
  - **Époque 4 : Fiabilisation Finale Production & Sécurité (Série G)** (`PHASE-G01` à `G05`)
- **[docs/archive/AUDIT-AI-STUDIO-SESSION-FAILURES.md](archive/AUDIT-AI-STUDIO-SESSION-FAILURES.md)** : Audit préliminaire des sessions résolu par la Série S.
- **[docs/archive/UX_REDESIGN_BLUEPRINT.md](archive/UX_REDESIGN_BLUEPRINT.md)** : Blueprint ergonomique de la Phase 12 formalisé dans `UX_STATES.md`.
