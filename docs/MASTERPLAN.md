# Masterplan

Mission : Transformer **EVE Trade Dashboard** en un véritable système de pilotage de trading EVE Online : consolidation des ventes réelles, classification du capital en états mutuellement exclusifs (liquidités, escrow, stocks en vente, stocks libres, stocks dormants, transit), réconciliation financière FIFO multi-personnages avec traçabilité unitaire des frais/taxes TTC, fiche Product 360 avec séries temporelles, et suggestions opérationnelles distinguant les transferts de stock prioritaires des achats de réapprovisionnement. Le tableur externe conserve l'analyse de rentabilité d'opportunités.

## Gouvernance
Un seul chantier actif, une phase, une branche, un PR. Jamais sur main. Petits livrables autonomes. Tests avant chaque push, CI sur chaque push/PR. Merge seulement si critères de phase satisfaits et CI verte. Après merge, vérifier le SHA de main et la CI avant d'ouvrir la suite. Découvertes hors périmètre à faire arbitrer, sans issue/phase improvisée.

## Phases du projet

| ID | Sujet | Dépendances | État |
|---|---|---|---|
| 00 | Fondations React/TS, serveur, outillage et CI | — | Terminé |
| 01 | EVE SSO et identité | 00 | Terminé |
| 02 | Client ESI résilient | 00–01 | Terminé |
| 03 | Transactions et grand livre | 01–02 | Terminé |
| 04 | Cycle de vie des ordres, listes de réassort | 01–03 | Terminé |
| 05 | Hubs et ROI TTC | 03–04 | Terminé |
| 06 | Dashboard intégré initial | 03–05 | Terminé |
| H01 | Hardening sécurité et isolation multi-personnages | 00–06 | Terminé |
| H02 | Hardening intégrité, résilience et sauvegarde SHA-256 | 02–06 | Terminé |
| 07 | Durabilité du stockage et historique fiable | 00–06, H01–H02 | Terminé |
| 08 | Réconciliation financière et métriques versionnées | 07 | Terminé |
| 09 | Positions de capital et inventaire mutuellement exclusif | 07, 08 | Terminé |
| 10 | Product 360 et visualisations temporelles | 07–09 | Terminé |
| 10.bis | Soldes réels des wallets (personnages & divisions corpo), filtrage de liquidité et scopes ESI complets | 01–03, 09, 10 | Terminé |
| 11 | Opérations, réapprovisionnement et transferts prioritaires | 08–10.bis | Terminé |
| 12 | Refonte du cockpit, navigation et intégration UX | 08–11 | Terminé |
| F01 | Cycle de vie sync, annulation réelle et persistance asynchrone | 00–12, R00–R08 | Terminé |
| F02 | Intégrité du stockage, anti-écrasement et vérité des données | F01 | Terminé |
| F03 | Invariants financiers, détection chronologique et valorisation FIFO | F01, F02 | Terminé |
| F04 | Preuves de qualification réelles : PostgreSQL CI et tests E2E navigateur | F01–F03 | Terminé |
| F05 | Exhaustivité et vérité des journaux de corporation (pagination et statuts) | F03 | Terminé |
| F06 | Identité canonique et déduplication des journaux de corporation multi-personnages | F05 | Terminé |
| F07 | Rapprochement fiscal déterministe et attribution unique (M+1 & non-duplication) | F06 | Terminé |
| F08 | Modélisation et attribution des frais de courtage (cycle de vie ordres & FIFO) | F07 | Terminé |
| F09 | Réconciliation financière TTC et cohérence des indicateurs (Couverture CA vs Volume) | F08 | Terminé |
| F10 | Reconstitution historique, recalcul et qualification financière finale | F09 | Terminé |
| F11 | Persistance des sessions multi-personnages et résilience iframe Google AI Studio | F10 | Terminé |
| H03 | Hardening UX, performance et release finale | 00–12, F01–F11 | Terminé |
| G01 | Sécurité de Production & Intégrité Authentification | Post F01–F11 | Terminé |
| G02 | Persistance PostgreSQL Unique & Bootstrap Asynchrone | G01 | Terminé |
| G03 | Concurrence Distribuée & Synchronisation ESI | G02 | Terminé |
| G04 | Cohérence Opérationnelle, Backup & Observabilité | G02, G03 | Terminé |
| G05 | Qualification CI Réelle, Disaster Recovery & Release Ready | G01–G04 | Terminé |
| S01 | Transport Hybride Unifié & Déconnexion Déterministe | G01–G05 | Terminé |
| S02 | Sélection & Invariance du Personnage Principal | S01 | Terminé |
| S03 | Pérennité des Flottes & Résilience Iframe AI Studio | S01, S02 | Terminé |
| P01 | Ingestion ESI Dédiée & Régulation Débit : PI, Industrie & Minage | S01–S03 | Terminé |
| P02 | Registre Minier & Coûts d'Opportunité Farm / Mining | P01 | Terminé |
| P03 | Colonies Planétaires & Flux de Matières PI | P01 | Terminé |
| P04 | Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours WIP | P01, P02 | Terminé |
| P05 | Moteur de Propagation Déterministe des Coûts (FIFO Multi-Niveaux & Chaîne de Valeur) | P01–P04 | Terminé |

Les spécifications des phases actives sont consultables dans [`docs/phases/`](phases/README.md). L'historique complet des phases antérieures et des audits clos est archivé dans [`docs/archive/`](archive/README.md).

Chaque phase suit la discipline : critères propres satisfaits, tests ajoutés et verts, index du code à jour, PR vérifiable, aucun secret. Le statut « terminé » requiert merge et revalidation de main.

## Décisions & Invariants d'Architecture
- Monolithe modulaire React 19 / TypeScript strict + Node.js / TypeScript.
- Délégation des responsabilités par modules de domaine isolés (`mining/`, `pi/`, `industry/`, `production/`) sans surcharge des modules centraux (`ledger`, `orders`, `roi/calculator`).
- Authentification SSO serveur avec PKCE S256 ; aucun secret ou token dans le bundle client.
- ESI strictement en lecture seule : aucune écriture, création, modification ou annulation d'ordres en jeu.
- Séparation stricte entre observations ESI immuables et projections recalculables.
- États de données distincts : `KNOWN`, `UNKNOWN`, `PARTIAL`, `ERROR`, `ABSENT` ne valent jamais zéro.
- Invariance de coût des matières farmées : les minerais et ressources extraites ne coûtent jamais 0.00 ISK (`FARMED_PROVENANCE` + coût d'opportunité d'extraction).
- Traçabilité de l'arbre BOM sans rupture FIFO : propagation ascendante du coût unitaire intégrant composants réels, frais de pose et taxes POCO.
- Pas de double comptage de taxes ou frais : calcul du profit TTC et du ROI strictement justifié par preuves.
