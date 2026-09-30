# Architecture

## Vue d'Ensemble Cible
Monolithe modulaire full-stack :
- **Client Navigateur** : React 19 + TypeScript strict + Tailwind CSS v4. Interface décisionnelle découpée en 6 espaces (Cockpit, Positions, Analyses/360, Opérations/Transferts, Registre, Configuration).
- **Passerelle Applicative** : API REST same-origin Express sur Node.js 22, sécurisée par en-têtes CSP/HSTS stricts, validation de session HttpOnly/Secure et isolation inter-personnages.
- **Serveur & Moteurs Métier** :
  - `auth` : SSO EVE Online, PKCE S256, gestion multi-personnages, tokens isolés côté serveur.
  - `esi` : Passerelle HTTP résiliente, cache conditionnel ETag/304, gestion des budgets d'erreur 420/429, limitation de débit et pagination sécurisée.
  - `sync` : Orchestrateur de collecte incrémentale (`from_id` et `x-pages`), curseurs de reprise et déduplication idempotente.
  - `ledger` : Grand livre des transactions et écritures de journal de portefeuille.
  - `orders` : Machine à états de cycle de vie des ordres et analyse des diffs de snapshots.
  - `assets` : Actifs physiques de personnages et corporations, décomposition par statut.
  - `capital` : Moteur de modélisation patrimoniale et d'inventaire mutuellement exclusif.
  - `roi` : Moteur de réconciliation chronologique (FIFO multi-personnages), allocation manuelle et calcul du profit réalisé TTC.
  - `analytics` : Agrégateur Product 360 et séries temporelles (vélocité, durée de détention, rendement par capital-jour).
  - `replenishment` / `operations` : Moteur d'arbitrage transferts de stock prioritaires vs achats nets avec horizon de couverture.
  - `hubs` : Résolution d'emplacements et cartographie des hubs commerciaux.
  - `storage` : Couche de persistance durable avec transactions atomiques, migration de schéma versionnée et export/import de sauvegarde SHA-256.

## Flux de Données & Invariants
```
  [ CCP ESI Gateway ] (Lecture Seule)
          │
          ▼ (ETag, Cache, Pagination from_id/x-pages)
  [ Sync Orchestrator ]
          │
          ├──► [ Transactions & Journal ] ──► [ Moteur Réconciliation FIFO / Lots ]
          ├──► [ Snapshots d'Ordres ]    ──► [ Machine à États Cycle de Vie ]
          └──► [ Actifs Physiques ]      ──► [ Décomposition Stocks (Vente / Libre / Dormant) ]
                                                        │
                                                        ▼
                                       [ Moteur Capital & Inventaire ]
                                                        │
                                                        ▼
                                       [ Fiches Product 360 & Analytics ]
                                                        │
                                                        ▼
                                       [ Moteur Réapprovisionnement & Transferts ]
                                                        │
                                                        ▼
                                  [ Cockpit & Navigation Décisionnelle UI ]
```

## Isolation & Sécurité
1. Aucun appel ESI privé depuis le navigateur ; aucun jeton ou secret OAuth dans le bundle.
2. Clés privées et sessions strictement isolées par `character_id`.
3. Les observations ESI sont persistées comme preuves immuables ; les calculs de rentabilité et projections sont versionnés et recalculables à la demande.
