# Masterplan

Mission : consolider les ventes réelles, classifier achats/ventes par hubs configurables, calculer des métriques ROI TTC explicables et préparer des listes de réapprovisionnement sans vérifier chaque ordre individuellement. Le tableur externe conserve l'analyse de rentabilité d'opportunités.

## Gouvernance
Un seul chantier actif, une phase, une branche, un PR. Jamais sur main. Petits livrables autonomes. Tests avant chaque push, CI sur chaque push/PR. Merge seulement si critères de phase satisfaits et CI verte. Après merge, vérifier le SHA de main et la CI avant d'ouvrir la suite. Découvertes hors périmètre à faire arbitrer, sans issue/phase improvisée.

## Phases
| ID | Sujet | Dépendances | État initial |
|---|---|---|---|
| 00 | Fondations React/TS, serveur, outillage et CI | — | Planifiée |
| 01 | EVE SSO et identité | 00 | Planifiée |
| 02 | Client ESI résilient | 00–01 | Planifiée |
| 03 | Transactions et grand livre | 01–02 | Planifiée |
| 04 | Cycle de vie des ordres, listes de réassort | 01–03 | Planifiée |
| 05 | Hubs et ROI TTC | 03–04 | Planifiée |
| 06 | Dashboard intégré | 03–05 | Planifiée |
| H01 | Hardening sécurité | 00–06 | Planifiée |
| H02 | Hardening intégrité et résilience | 02–06 | Planifiée |
| H03 | Hardening UX, performance et release | H01–H02 | Planifiée |

Chaque phase possède un fichier dédié dans docs/phases. Fin de phase : critères propres satisfaits, tests ajoutés et verts, docs/index code à jour, PR vérifiable, aucun secret. Le statut « terminé » requiert merge et revalidation de main.

## Décisions
Monolithe modulaire React/TypeScript + Node/TypeScript ; pas de microservices prématurés. Persistance durable, choix précis par ADR en phase 00. ESI en lecture seule au MVP. Observations distinctes des projections. Pas de moteur d'opportunités, pas de FIFO implicite.