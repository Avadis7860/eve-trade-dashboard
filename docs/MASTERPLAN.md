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
| H03 | Hardening UX, performance et release finale | 00–12, F01–F11 | Planifiée |

Voir également le rapport complet d'audit post-Phase 12 [`docs/AUDIT-POST-PHASE-12.md`](AUDIT-POST-PHASE-12.md), le rapport d'investigation financière [`docs/AUDIT-TASK-55-FINANCIAL-RECONCILIATION.md`](AUDIT-TASK-55-FINANCIAL-RECONCILIATION.md) et la feuille de route détaillée [`docs/MASTERPLAN-ASSURANCE-FIABILITE.md`](MASTERPLAN-ASSURANCE-FIABILITE.md).

Chaque phase possède un fichier dédié dans `docs/phases`. Fin de phase : critères propres satisfaits, tests ajoutés et verts, index du code à jour, PR vérifiable, aucun secret. Le statut « terminé » requiert merge et revalidation de main.

## Décisions & Invariants d'Architecture
- Monolithe modulaire React 19 / TypeScript strict + Node.js / TypeScript.
- Authentification SSO serveur avec PKCE S256 ; aucun secret ou token dans le bundle client.
- ESI strictement en lecture seule : aucune écriture, création, modification ou annulation d'ordres en jeu.
- Séparation stricte entre observations ESI immuables et projections recalculables.
- États de données distincts : `KNOWN`, `UNKNOWN`, `PARTIAL`, `ERROR`, `ABSENT` ne valent jamais zéro.
- Pas de double comptage de taxes ou frais : calcul du profit TTC et du ROI strictement justifié par preuves.
