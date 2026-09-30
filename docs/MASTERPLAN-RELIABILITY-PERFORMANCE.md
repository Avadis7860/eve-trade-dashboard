# Masterplan de Fiabilité & Performance (Remise à Niveau & Hardening)

> **Document de référence canonique pour la fiabilisation et la performance du dépôt `Avadis7860/eve-trade-dashboard`.**  
> Ce plan suspend tout développement de nouvelles fonctionnalités métier tant que la persistance réelle, la complétude des synchronisations, la gestion des requêtes frontend, l'accès aux données et la couverture de tests E2E/PostgreSQL ne sont pas garantis.

---

## 1. État de référence

- **Dépôt :** `Avadis7860/eve-trade-dashboard`
- **Branche de référence :** `main`
- **Commit / Référence auditée :** HEAD (Post-Phase 10 / Product 360)
- **Date de l'audit :** 30 septembre 2026
- **Périmètre audité :** Architecture serveur Express/TypeScript, adaptateurs de stockage (`database.ts`, `schema.ts`, `backupService.ts`), dépôts métier (`PersistentLedgerRepository`, `OrdersRepository`, `RoiRepository`, `AssetsRepository`, `SyncRepository`), services (`SyncService`, `CapitalService`, `AnalyticsService`, `RoiService`), orchestrateur client `App.tsx` et composants React, suite de tests Vitest (20 fichiers, 149 tests).

### Limites de l'audit
1. **Audit statique et contractuel exhaustif** réalisé sur l'ensemble du code source, des routes HTTP et des flux de données.
2. **Mesures d'exécution réalisées sous Vitest (jsdom / V8)** : 149 tests unitaires et d'intégration en mémoire exécutés avec succès (~45s cumulées).
3. **Distinction impérative entre constats vérifiés statiquement et éléments nécessitant des benchmarks réels :**
   - *Constats vérifiés statiquement dans le code :* absence de requêtes SQL dans les repositories métier (`PersistentLedgerRepository` manipule exclusivement des `Map<string, CharacterTransaction>` et `DurableFileDatabaseAdapter` sérialise l'état global en JSON bloquant `fs.writeFileSync`) ; limitation `pageSize = 500` dans `getTransactions` malgré l'appel `pageSize: 100000` de `getInventoryLots` ; multiplication des requêtes non coordonnées dans `App.tsx` ; présence d'un fichier `.data/eve_trade_store.json` de 1 Mo versionné.
   - *Éléments nécessitant des benchmarks réels en environnement de production (Phase R0) :* temps de latence réseau et saturation ESI sous concurrence, consommation mémoire du heap Node.js lors de volumétries > 100 000 transactions sur PostgreSQL réel, métriques de rendu DOM React sur les listes denses.

---

## 2. Synthèse des 4 familles de vulnérabilités identifiées

### A. Fiabilité et intégrité des données (Persistance & Stockage)
- **Déconnexion de PostgreSQL :** Bien que `PostgresDatabaseAdapter` existe dans `src/server/storage/database.ts` et que `schema.ts` définisse le schéma SQL, les repositories métier (`src/server/ledger/repository.ts`, `src/server/orders/repository.ts`, `src/server/assets/repository.ts`, `src/server/roi/repository.ts`) héritent tous d'une structure interne basée sur des `Map<string, T>` en mémoire vive.
- **Réécriture globale synchrone :** L'adaptateur par défaut `DurableFileDatabaseAdapter` sérialise l'intégralité de la base dans `.data/eve_trade_store.json` via `JSON.stringify(this.state)` et `fs.writeFileSync` à chaque mutation, induisant des écritures disques massives et bloquantes.
- **Risque d'absorption d'erreurs :** Les erreurs d'écriture disque sont journalisées (`logger.error`) mais ne propagent pas toujours d'exception vers la couche service appelante, risquant de confirmer un succès HTTP alors que le disque n'a pas persisté.
- **Fichier de données versionné :** Le fichier `.data/eve_trade_store.json` (~1 Mo) contient des snapshots de personnages réels et se trouve dans l'arborescence suivie par Git.

### B. Complétude des données et synchronisation
- **Troncature de pagination et fausse complétude :** Dans `src/server/esi/pagination.ts`, la fonction `fetchXPages` est plafonnée par défaut à `maxPages = 100` et `fetchFromId` à `maxItems = 5000`. Si une entité dépasse ce volume, la pagination s'arrête prématurément et retourne pourtant `status: 'COMPLETE'`.
- **Régression de l'inventaire historique (`getInventoryLots`) :** `RoiService.runAutoFifoReconciliation` et `getInventoryLots` nécessitent l'exhaustivité des achats historiques. Si `getTransactions` plafonne à `pageSize = 500`, les achats plus anciens sont ignorés dans le calcul de réconciliation.
- **Synchronisation séquentielle et lente :** `syncAll()` dans `SyncService` synchronise les ressources les unes après les autres (transactions, journal, ordres, actifs, corpo), entraînant des durées d'attente élevées pour l'utilisateur.
- **Rechargement redondant :** Les synchronisations répétées re-téléchargent et ré-analysent fréquemment des données déjà connues sans tirer pleinement parti des curseurs `from_id` et des entêtes conditionnelles `ETag` / `304 Not Modified`.

### C. Performance et gestion des requêtes frontend
- **Sur-sollicitation réseau dans `App.tsx` :** L'orchestrateur centralise des fonctions massives :
  - `fetchLedgerData()` déclenche 5 requêtes en parallèle (`transactions`, `summary`, `sync-status`, `filter-options`, `journal`).
  - `fetchOrdersData()` déclenche 3 requêtes (`orders`, `summary`, `restock`).
  - `fetchRoiAndHubsData()` déclenche 5 requêtes (`summary`, `allocations`, `unsold-inventory`, `hubs`, `mappings`).
- **Cascade de rechargements :** Un changement de filtre ou de pagination dans l'onglet Grand Livre déclenche à nouveau les 5 requêtes de `fetchLedgerData`. Une synchronisation déclenche 13 requêtes simultanées (`Promise.all([fetchLedgerData(), fetchOrdersData(), fetchRoiAndHubsData()])`).
- **Absence de couche de requêtage unifiée :** Absence de déduplication des requêtes en vol, d'annulation par `AbortController` lors du changement rapide de filtre ou d'onglet, et de gestion formelle des conditions de concurrence (race conditions où une réponse ancienne écrase une réponse récente).
- **Scans mémoire répétitifs :** Les services effectuent de multiples `filter()`, `map()`, `sort()` et `reduce()` sur des tableaux complets en mémoire au lieu de déléguer les projections, tris et pagination à la base relationnelle.

### D. Couverture des tests
- **Tests reposant sur les dépôts mémoire :** Les 149 tests Vitest existants s'exécutent sur les structures `Map` en mémoire. Le test de performance sur 50 000 transactions (`storage.test.ts`) valide la structure de données locale et non une base PostgreSQL réelle avec concurrence réseau et transactions disque.
- **Absence de tests E2E réels :** Aucun test de bout en bout (Playwright/Cypress) ne valide le cycle complet : authentification SSO → synchronisation ESI multi-pages → affichage temps réel → navigation entre onglets → réconciliation FIFO → export CSV.
- **Manque de validation sur les états dégradés :** Les cas de réponses partielles (`PARTIAL`), erreurs réseau transitoires, 420/429 ESI, expiration de session en cours de route et bascule rapide de personnage nécessitent des tests d'intégration stricts.

---

## 3. Matrice de priorité et dépendances

```
┌─────────────────────────────────────────────────────────────┐
│ Phase R0 — Baseline, mesure et gel fonctionnel (BLOQUANTE) │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase R1 — Persistance et stockage durable (BLOQUANTE)      │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼                               ▼
┌──────────────────────────────────┐ ┌──────────────────────────────────┐
│ Phase R2 — Complétude & Vérité   │ │ Phase R6 — Sécurité, Isolation   │
│ des états (BLOQUANTE)            │ │ & Sauvegarde (MAJEURE)           │
└──────────────┬───────────────────┘ └─────────────────┬────────────────┘
               │                                       │
      ┌────────┴────────┬───────────────────┐          │
      ▼                 ▼                   ▼          │
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ │
│ Phase R3     │ │ Phase R4     │ │ Phase R5         │ │
│ Requêtes UI  │ │ Calculs SQL  │ │ Sync ESI         │ │
│ (MAJEURE)    │ │ (MAJEURE)    │ │ Concurrence      │ │
└──────┬───────┘ └──────┬───────┘ └────────┬─────────┘ │
       │                │                  │           │
       └────────────────┼──────────────────┴───────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase R7 — Stratégie de tests complète (MAJEURE)            │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase R8 — Observabilité et critères de production (MAJEURE)│
└─────────────────────────────────────────────────────────────┘
```

| Phase | Intitulé | Priorité / Statut | Dépend de | Bloque | Fichier de cadrage |
|---|---|---|---|---|---|
| **R0** | Baseline, mesure et gel fonctionnel | **Terminé** | — | R1 à R8 | `docs/phases/PHASE-R00-baseline.md` |
| **R1** | Persistance et stockage durable PostgreSQL | **Terminé** | R0 | R2 à R8 | `docs/phases/PHASE-R01-persistence.md` |
| **R2** | Complétude, pagination et vérité des états | **Terminé** | R1 | R4 à R8 | `docs/phases/PHASE-R02-completeness-pagination.md` |
| **R3** | Architecture des requêtes frontend | **MAJEURE** | R0, R2 | R7, R8 | `docs/phases/PHASE-R03-frontend-query-architecture.md` |
| **R4** | Optimisation des calculs métier et accès SQL | **MAJEURE** | R1, R2 | R7, R8 | `docs/phases/PHASE-R04-business-calculations-data-access.md` |
| **R5** | Synchronisation ESI et concurrence contrôlée | **MAJEURE** | R1, R2 | R7, R8 | `docs/phases/PHASE-R05-esi-sync-concurrency.md` |
| **R6** | Sécurité, isolation multi-perso et backup | **MAJEURE** | R1 | R7, R8 | `docs/phases/PHASE-R06-security-isolation-backup.md` |
| **R7** | Stratégie de tests complète (Domain, SQL, HTTP, UI, E2E) | **MAJEURE** | R1–R6 | Release | `docs/phases/PHASE-R07-testing-strategy.md` |
| **R8** | Observabilité et critères d'exploitabilité | **MAJEURE** | R1–R7 | Release | `docs/phases/PHASE-R08-observability-production.md` |

---

## 4. Règles de travail et gouvernance technique

1. **Gel fonctionnel strict :** Aucune nouvelle fonctionnalité métier (ex: Phase 10bis, 11, 12) ne doit être entamée avant la clôture et validation formelle des phases R0 à R8.
2. **Unité de livraison :** 1 phase = 1 chantier = 1 branche = 1 Pull Request = 1 validation complète.
3. **Séparation des préoccupations :** Ne pas mélanger correction fonctionnelle et optimisation de performance sans nécessité démontrée.
4. **Intégrité de la suite de tests :** Ne jamais supprimer un test existant ni affaiblir une assertion pour obtenir une CI verte. Tout test rouge doit être résolu à la racine.
5. **Preuve par la mesure :** Tout gain de performance annoncé doit faire l'objet d'un comparatif mesurable Avant/Après (latence p50/p95/p99, volume mémoire, requêtes HTTP).
6. **Autonomie des tests :** Aucun test automatisé ne doit dépendre des serveurs ESI ou CCP en direct (mocking rigoureux et déterministe obligatoire).
7. **Sémantique des états préservée :** Les statuts `KNOWN`, `UNKNOWN`, `PARTIAL`, `ERROR`, `ABSENT` et `EMPTY` restent strictement distincts et ne doivent jamais être confondus avec `0` ou `[]`.
8. **Interdiction des faux positifs de synchronisation :** Une synchronisation partielle ou interrompue ne doit jamais être marquée `COMPLETE`.
9. **Source de vérité unique :** PostgreSQL constitue la source de vérité persistante officielle. L'adaptateur fichier ne doit servir que d'environnement de secours local jetable.
10. **Sobriété des APIs :** Les endpoints HTTP doivent renvoyer uniquement les données nécessaires au contexte demandé (pagination réelle en base).
11. **Garde d'infrastructure :** Ne pas introduire de microservices, de brokers de messages externes (Kafka, RabbitMQ) ou de caches distribués (Redis) non justifiés ; exploiter PostgreSQL et Node.js au maximum de leurs capacités.
12. **Mise à jour documentaire continue :** `docs/CODE_INDEX.md`, `docs/INDEX.md` et les contrats de domaine doivent être mis à jour dans la PR même de chaque phase.
