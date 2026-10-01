# Audit Technique Approfondi et Contradictoire Post-Phase 12
**Projet :** Avadis7860/eve-trade-dashboard  
**Rôle :** Architecte logiciel principal & Auditeur technique indépendant  
**Date d'audit :** 1er Octobre 2026  
**Statut de la version :** Post-Phase 12 & Post-Roadmap R00–R08  
**Environnement audité :** `/app/applet` (TypeScript strict, Node.js Express, React 19, Vitest)  

---

## 1. Cadre d'Évaluation, Périmètre & Base de Référence

### 1.1. Contexte d'exécution et traçabilité de version
- **Environnement local :** Conteneur d'exécution AI Studio (`/app/applet`).
- **Constat d'environnement :** Le répertoire racine ne comporte pas d'arborescence `.git` active (`fatal: not a git repository`), les métadonnées Git étant purgées par la plateforme lors du packaging du conteneur. L'audit est donc réalisé sur l'arbre exhaustif des fichiers source, tests, scripts et documentations présents sur le disque.
- **Base contractuelle auditée :**
  - Spécifications initiales (Phases 00 à 06)
  - Hardening initial (H01, H02)
  - Système de pilotage (Phases 07, 08, 09, 10, 10.bis, 11, 12)
  - Fiabilité et performance (Phases R00 à R08)
  - Contrats transverses : `GEMINI.md`, `DOMAIN_CONTRACTS.md`, `ESI_RESILIENCE.md`, `METRICS.md`, `SECURITY_PRIVACY.md`, `UX_STATES.md`, `TESTING_CI.md`.

### 1.2. Vérification des vérifications automatiques
| Contrôle | Commande exécutée | Résultat observé | Conformité statique |
|---|---|---|---|
| Typecheck TypeScript | `npm run typecheck` (`tsc --noEmit`) | Succès (0 erreur) | Conforme syntaxe / types |
| Linter ESLint | `npm run lint` (`eslint src/ server.ts`) | Succès (0 warning, 0 erreur) | Conforme règles linter |
| Compilation Vite / Node | `npm run build` (`tsc && vite build`) | Succès (bundle généré) | Conforme compilation |
| Suite de tests automatisés | `npm test -- --run` (`vitest run`) | 28 suites passées, 294 tests réussis (81.05s) | Vert (sur mocks et mémoire) |

---

## 2. Synthèse Exécutive de l'Audit

L'audit contradictoire a révélé que si l'architecture globale (séparation en domaines, typage strict, modularité, enrichissement métier) présente une base conceptuelle solide et une suite de tests unitaires/intégration très active (294 tests passants), **plusieurs failles critiques d'intégrité, d'isolation, de persistance et de concurrence subsistent sous la surface des tests nominaux**.

### Répartition des Constatations par Gravité
- **S0 — Risques Critiques (Corruption, perte, ou fausse affirmation financière) :** 5 constatations
- **S1 — Risques Majeurs (Résultats faux, logique tronquée, défaut d'isolation) :** 5 constatations
- **S2 — Fragilités Significatives (Diagnostics incomplets, masquages, dette de test) :** 4 constatations
- **S3 — Défauts Documentaires & Métadonnées :** 3 constatations

```
+-----------------------------------------------------------------------------------+
| SYNTHÈSE DE FIABILITÉ DU SYSTÈME POST-PHASE 12                                    |
+-----------------------------------+-----------------------------------------------+
| Domaine                           | Niveau de Confiance & Garantie Réelle        |
+-----------------------------------+-----------------------------------------------+
| Authentification & SSO (S256)     | ÉLEVÉ (PKCE robuste, tokens isolés serveur)   |
| Déduplication Ledger / ESI        | ÉLEVÉ (Clés uniques et idempotence SQL)       |
| Synchronisation ESI & Concurrence | MOYEN-FAIBLE (Timeouts fantômes, syncAll fragile)|
| Persistance & Reprise après crash | MOYEN-FAIBLE (Écrasement fichier, repo désync)|
| Traçabilité FIFO & ROI TTC        | ÉLEVÉ en consultation, MOYEN en isolation multi|
| Décomposition Capital & Stocks    | MOYEN (Coût moyen implicite sur stocks libres)|
| Suggestions Opérations / Réassort | FAIBLE (Sélection erronée du dernier prix)    |
| Suite de tests & Preuves réelles  | MOYEN (Absence de vrai PostgreSQL et vrai E2E)|
+-----------------------------------+-----------------------------------------------+
```

---

## 3. Chaîne de Données & Graphe des Calculs

### 3.1. Graphe Réel des Dépendances Métier

```
[ EVE Online ESI Gateway ]
       │ (Rate Limiting 5 req/s, Cache RFC 7234, ETag/304, X-Pages & from_id)
       ▼
[ SyncCoordinator & SyncService ]
       │ ── Transactions (/wallet/transactions/)
       │ ── Journal (/wallet/journal/)
       │ ── Ordres Actifs & Historique (/orders/ & /orders/history/)
       │ ── Actifs (/assets/ & /corporations/{id}/assets/)
       │ ── Soldes Portefeuilles (/wallet/ & /corporations/{id}/wallets/)
       ▼
[ Repositories Persistants (Postgres / DurableFile) ]
       │
       ├───────────────────────────────┐
       ▼                               ▼
[ Engine FIFO (RoiService) ]    [ Inventaire & Capital (CapitalService) ]
  • Allocations Chronologiques    • Liquidités Réelles (Wallet)
  • Lots d'Ouverture Validés      • Escrow & Ordres d'Achat
  • Traçabilité Unitaire Frais    • Stocks Engagés en Vente
  • ROI TTC Calculé               • Stocks Libres en Hubs
       │                          • Stocks Dormants & Inactifs
       │                          • Stocks en Transit
       │                               │
       └──────────────┬────────────────┘
                      ▼
        [ Product 360 & Séries Temporelles (AnalyticsService) ]
          • Chiffre d'Affaires Brut & Coûts Réels Alloués
          • Pyramide des Âges d'Inventaire
          • Matrices de Flux Inter-Hubs
                      │
                      ▼
        [ Plan Opérationnel (OperationsService) ]
          • Détection des Ruptures & Triggers d'Ordres
          • Calcul de Vélocité Journalière
          • Transferts Prioritaires de Stock Distant Libre
          • Achats Nets Résiduels (Jita / Hub Source)
                      │
                      ▼
        [ Cockpit Unifié & Vues Métier (React 19) ]
```

### 3.2. Analyse de la Cohérence Temporelle
Les différentes ressources ESI sont synchronisées à des fréquences différentes en fonction de leurs en-têtes de cache HTTP CCP :
- `wallet/transactions` : Cache 10 minutes
- `wallet/journal` : Cache 10 minutes
- `orders` (actifs) : Cache 5 minutes
- `orders/history` : Cache 10 minutes
- `assets` : Cache 60 minutes
- `wallet` (solde) : Cache 2 minutes

**Constat critique :** L'application ne force pas un verrou temporel commun. Une vue agrégée du Cockpit peut présenter un solde de portefeuille observé il y a 1 minute, des ordres actifs vieux de 4 minutes, et des actifs physiques vieux de 45 minutes. Le système n'affiche pas explicitement les écarts d'horodatage entre ces blocs sur les cartes de synthèse.

---

## 4. Matrice Exhaustive de Traçabilité de Bout en Bout

| Indicateur / Métrique | Source d'origine | Identifiant Source | Timestamp métier | Horodatage observation | Persistance & Table | Dépendance de calcul | Statuts de couverture |
|---|---|---|---|---|---|---|---|
| **Solde Liquide** | ESI `/characters/{id}/wallet/` | ID Personnage | Date instantanée | `observedAt` | `wallet_snapshots` | Somme des soldes autorisés | `KNOWN`, `EMPTY`, `ERROR` |
| **Escrow Achat** | ESI `/characters/{id}/orders/` | `order_id` | `issued` | `lastObservedAt` | `order_snapshots` | `sum(escrow)` des ordres d'achat actifs | `KNOWN`, `PARTIAL`, `ERROR` |
| **Stock en Vente** | ESI `/characters/{id}/orders/` | `order_id` | `issued` | `lastObservedAt` | `order_snapshots` | `sum(volume_remain * price)` | `KNOWN`, `PARTIAL`, `ERROR` |
| **Stock Physique** | ESI `/characters/{id}/assets/` | `item_id` | N/A (inventaire) | `observedAt` | `character_assets` | Décomposition par station/flag | `KNOWN`, `ERROR` |
| **Coût d'Achat FIFO** | ESI `/wallet/transactions/` | `transaction_id` | `date` | `observedAt` | `transactions` + `explicit_cost_allocations` | Rapprochement chronologique unitaire | `COMPLETE`, `PARTIAL`, `UNKNOWN` |
| **Frais & Taxes TTC** | ESI `/wallet/journal/` | `journal_id` (ref_type) | `date` | `observedAt` | `journal_entries` + `explicit_cost_allocations` | Corrélation `context_id` / `journalRefId` | `COMPLETE`, `PARTIAL`, `UNKNOWN` |
| **Profit Réalisé TTC** | Ventes + Allocations | `transaction_id` | `date` vente | Date réconciliation | `explicit_cost_allocations` | `CA_alloué - Cogs - Frais_achat - Frais_vente` | `COMPLETE`, `PARTIAL`, `UNKNOWN` |
| **ROI % TTC** | Allocations FIFO | `transaction_id` | `date` vente | Date réconciliation | `explicit_cost_allocations` | `(Profit / Inv_TTC) * 100` | `COMPLETE`, `PARTIAL`, `UNKNOWN` |
| **Besoins Réassort** | Ordres + Ventes + Assets | `order_id` / `type_id` | Multi-sources | Horodatage calcul | Mémoire / `restock_items` | `Demande(horizon) - Stock_libre - En_cours` | `PROPOSED`, `ACCEPTED`, `ORDERED` |

---

## 5. Constatations Détaillées et Contradictoires (Classées S0 à S3)

### S0 — Risques Critiques

#### S0-1 : `DurableFileDatabaseAdapter` — Auto-écrasement destructif du fichier de stockage sur erreur de chargement et persistance silencieuse
- **Fichier et lignes :** `src/server/storage/database.ts:74-78`, `122-124`
- **Gravité :** S0 (Perte de données critique) | **Niveau de confiance :** 100% (Confirmé statiquement dans le code)
- **Constat :**
  ```typescript
  // database.ts:74-78
  } catch (err) {
    logger.error(`Failed to load persistent storage from ${this.storagePath}, initializing clean state: ${(err as Error).message}`);
    this.state = this.createEmptyState();
    this.persist();
  }
  ```
  Si une erreur survient à la lecture (verrouillage temporaire, fichier temporairement tronqué ou corruption mineure d'un bloc JSON), l'adaptateur réinitialise immédiatement l'état à vide et appelle `this.persist()`, **écrasant irrémédiablement le fichier sur disque avec un schéma vide**. De plus, dans `persist()` (lignes 122-124), les erreurs d'écriture (`EACCES`, `ENOSPC`) sont capturées dans un `catch` sans propager d'exception, faisant croire au serveur que la persistance a réussi.
- **Conséquence :** Perte totale de l'historique de transactions et des allocations FIFO au redémarrage en cas d'incident d'E/S.

#### S0-2 : `PostgresSyncRepository` — Méthode `updateSyncState` synchrone avec tâche de fond non attendue et masquée
- **Fichier et lignes :** `src/server/sync/repository.ts:166-168`, `201-209`
- **Gravité :** S0 (Désynchronisation mémoire/PostgreSQL et perte d'état) | **Niveau de confiance :** 100%
- **Constat :**
  ```typescript
  // repository.ts:201-209
  public updateSyncState(characterId: number, resource: SyncResourceType, updates: Partial<SyncState>): SyncState {
    const updated = this.fallbackMemory.updateSyncState(characterId, resource, updates);
    this.updateSyncStateAsync(characterId, resource, updates).catch(() => {});
    return updated;
  }
  ```
  `SyncService` utilise exclusivement l'interface synchrone `updateSyncState`. `PostgresSyncRepository` met à jour une copie locale en mémoire `fallbackMemory` et déclenche `updateSyncStateAsync` en tâche de fond avec un `.catch(() => {})` silencieux.
  Pire, `getSyncState()` (lignes 166-168) lit uniquement depuis `this.fallbackMemory.getSyncState(...)` !
- **Conséquence :** Si le processus serveur redémarre ou si PostgreSQL échoue, les curseurs de reprise (`last_cursor_from_id`, `last_page_processed`) sont perdus ou divergent de la base de données.

#### S0-3 : `SyncCoordinator` — Le timeout libère le worker mais n'annule pas la tâche asynchrone sous-jacente
- **Fichier et lignes :** `src/server/sync/coordinator.ts:125-133`
- **Gravité :** S0 (Concurrence non bornée, requêtes fantômes et corruption d'état) | **Niveau de confiance :** 100%
- **Constat :**
  ```typescript
  // coordinator.ts:125-133
  timeoutTimer = setTimeout(() => {
    if (!isSettled) {
      isSettled = true;
      item.reject(new Error(`Sync task [${item.key || item.id}] timed out after ${item.timeoutMs}ms of execution`));
      this.onTaskFinished();
    }
  }, item.timeoutMs);
  ```
  Lorsque le délai d'exécution expire, la promesse est rejetée et `this.onTaskFinished()` décrémente `activeWorkers`, démarrant immédiatement la tâche suivante dans la file. **Cependant, la tâche initiale (`item.fn()`) continue de s'exécuter en arrière-plan** car aucun `AbortController` / `AbortSignal` n'est transmis ou honoré par le client ESI / HTTP.
- **Conséquence :** Les tâches "fantômes" continuent d'effectuer des appels ESI et des écritures SQL concurrentes non contrôlées, violant la limite `maxConcurrent` et pouvant saturer le pool de connexions PostgreSQL ou le limiteur de débit CCP.

#### S0-4 : `SyncService` — Masquage de l'échec de synchronisation de l'historique des ordres en statut `COMPLETE`
- **Fichier et lignes :** `src/server/sync/service.ts:439-448`, `538-540`
- **Gravité :** S0 (Fausse déclaration de complétude d'ordres) | **Niveau de confiance :** 100%
- **Constat :**
  ```typescript
  // service.ts:439-448
  try {
    const historyRes = await fetchXPages<RawEsiOrder>(this.esiClient, `/characters/${characterId}/orders/history/`, ...);
    rawHistory = historyRes.data || [];
  } catch (histErr) {
    console.warn('[SyncService] Historical orders fetch skipped:', (histErr as Error).message);
  }
  // service.ts:538-540
  this.syncRepo.updateSyncState(characterId, resource, {
    status: 'COMPLETE',
    coverageStatus: 'COMPLETE',
  ...
  ```
  Si l'appel à `/orders/history/` échoue (timeout, 5xx, token expiré), l'erreur est capturée silencieusement et la synchronisation globale des ordres est marquée `COMPLETE`. Tous les ordres complétés ou annulés qui n'apparaissent plus dans le snapshot actif sont alors marqués `DISAPPEARED_UNCONFIRMED`, mais l'utilisateur voit un état global vert `COMPLETE`.
- **Conséquence :** Mauvaise classification des ordres et fausse impression de complétude pour l'utilisateur.

#### S0-5 : `SyncService` — Coercition silencieuse des soldes de portefeuille non numériques en `0 ISK`
- **Fichier et lignes :** `src/server/sync/service.ts:624`
- **Gravité :** S0 (Violation de la règle fondamentale "UNKNOWN ne vaut jamais 0") | **Niveau de confiance :** 100%
- **Constat :**
  ```typescript
  const balance = typeof res.data === 'number' ? res.data : Number(res.data) || 0;
  ```
  Si CCP renvoie une réponse inattendue (`null`, format invalide, objet d'erreur), l'expression `Number(res.data) || 0` force la valeur à `0` ISK et enregistre un snapshot valide (`COMPLETE`).
- **Conséquence :** Affichage d'une fausse ruine financière (solde à 0 ISK) dans le Cockpit au lieu de lever une erreur ou de marquer `UNKNOWN`.

---

### S1 — Risques Majeurs

#### S1-1 : `OperationsService` — Logique erronée de sélection du dernier prix d'achat
- **Fichier et lignes :** `src/server/operations/service.ts:201-206`
- **Gravité :** S1 (Valorisation d'achat opérationnel fausse) | **Niveau de confiance :** 100%
- **Constat :**
  ```typescript
  for (const tx of allTransactions) {
    const txDate = new Date(tx.date);
    if (tx.isBuy) {
      if (!lastBuyUnitPriceMap.has(tx.typeId) || txDate.getTime() > 0) {
        lastBuyUnitPriceMap.set(tx.typeId, tx.unitPrice);
      }
    }
  ```
  La condition `txDate.getTime() > 0` est vraie pour n'importe quelle date valide. Le dictionnaire est donc écrasé à chaque itération. Si les transactions sont triées par date décroissante (les plus récentes en premier), c'est la **plus ancienne transaction** (à la fin de la boucle) qui finit par être conservée comme "dernier prix d'achat" !
- **Conséquence :** Les suggestions d'achats de réassort utilisent des prix d'achat obsolètes pour estimer le budget nécessaire.

#### S1-2 : `CapitalService` — Coût moyen implicite et projection indue sur le stock physique non réconcilié
- **Fichier et lignes :** `src/server/capital/service.ts:150-156`, `214-223`
- **Gravité :** S1 (Violation des règles FIFO et attribution d'un statut KNOWN infondé) | **Niveau de confiance :** 100%
- **Constat :**
  ```typescript
  unitCostIsk = roundIsk(costData.remainingCost / costData.remainingQty);
  costBasisStatus = 'KNOWN';
  totalCostBasisIsk = roundIsk(unitCostIsk * totalQuantity);
  ```
  `CapitalService` calcule un coût moyen sur l'ensemble des lots restants d'un `type_id` (tous personnages et toutes stations confondus), puis multiplie ce coût moyen par la quantité physique totale `totalQuantity` présente à une station donnée. Si l'inventaire FIFO ne contient que 10 unités pour un type mais que le joueur possède 1 000 unités physiques en jeu, les 1 000 unités sont valorisées au coût des 10 unités et le statut est marqué `KNOWN`.
- **Conséquence :** Faux sentiment de valorisation exacte sur des stocks physiques non justifiés par des achats réels.

#### S1-3 : `AnalyticsService.getTimeSeries` — Fuite d'isolation multi-personnages et masquage des états `PARTIAL` / `SYNCING`
- **Fichier et lignes :** `src/server/analytics/service.ts:768-771`
- **Gravité :** S1 (Défaut d'isolation multi-tenant et faux statut de fraîcheur) | **Niveau de confiance :** 100%
- **Constat :**
  ```typescript
  const syncStates = this.syncRepo.dumpData().states;
  const hasError = syncStates.some((s: { status: string }) => s.status === 'ERROR');
  const hasStale = syncStates.some((s: { status: string }) => s.status === 'STALE');
  const freshnessStatus = hasError ? 'PARTIAL' : hasStale ? 'STALE' : syncStates.length === 0 ? 'EMPTY' : 'FRESH';
  ```
  1. `this.syncRepo.dumpData().states` récupère les états de synchronisation de TOUS les personnages enregistrés dans l'application sans filtrer par le `characterId` de la requête.
  2. `s.status === 'STALE'` n'existe pas dans le type `SyncState['status']` (qui vaut `'IDLE' | 'SYNCING' | 'COMPLETE' | 'PARTIAL' | 'ERROR'`). Cette condition est donc toujours fausse.
  3. Si un état vaut `'PARTIAL'` ou `'SYNCING'`, `hasError` et `hasStale` sont faux, donc `freshnessStatus` est évalué à `'FRESH'`.
- **Conséquence :** Un personnage B en erreur fait basculer la fiche du personnage A en `PARTIAL`, et une synchronisation incomplète ou en cours est affichée comme `FRESH`.

#### S1-4 : `SyncService.syncAll` — Échec bloquant de `Promise.all` et abandon des résultats de corporation
- **Fichier et lignes :** `src/server/sync/service.ts:1107-1122`
- **Gravité :** S1 (Fragilité des synchronisations globales et perte de diagnostic) | **Niveau de confiance :** 100%
- **Constat :**
  `syncAll` exécute les 5 flux principaux via `Promise.all([transactions, journal, orders, assets, wallet])`. Si un seul flux rejette (par exemple le timeout de 45s sur les transactions), la promesse globale `syncAll` rejette immédiatement, abandonnant l'état des 4 autres flux pour l'appelant. De plus, les résultats de `syncCorporationWallets` et `syncCorporationAssets` exécutés via `Promise.allSettled` sont complètement ignorés et non renvoyés dans l'objet de résultat.
- **Conséquence :** Risque récurrent d'erreurs globales "syncAll timed out" et invisibilité des erreurs sur les divisions de corporation.

#### S1-5 : Suite de tests PostgreSQL simulée par un Mock JavaScript
- **Fichier et lignes :** `src/server/storage/postgres.test.ts:41-44`, `package.json`
- **Gravité :** S1 (Absence de preuve d'exécution SQL réelle) | **Niveau de confiance :** 100%
- **Constat :**
  Le fichier `postgres.test.ts` utilise `MockPostgresDatabaseAdapter`, une implémentation TypeScript en mémoire qui simule les requêtes SQL via des expressions régulières et des Maps. Aucun test de la suite CI n'exécute de requêtes contre une véritable instance de base de données PostgreSQL.
- **Conséquence :** Les éventuelles erreurs de syntaxe SQL PostgreSQL, de contraintes de clés étrangères réelles, de comportement transactionnel ACID ou de types natifs (`TIMESTAMP WITH TIME ZONE`, `NUMERIC`) ne sont pas détectées en CI.

---

### S2 — Fragilités Significatives

#### S2-1 : Absence de vrais tests End-to-End Playwright dans le navigateur
- **Fichier et lignes :** `src/e2e/e2e_journeys.test.ts:1-17`, `package.json`
- **Gravité :** S2 (Couverture E2E incomplète par rapport à la roadmap R07) | **Niveau de confiance :** 100%
- **Constat :** Le fichier `e2e_journeys.test.ts` s'exécute sous Vitest avec l'environnement `node` et utilise `supertest` pour effectuer des requêtes HTTP sur l'API Express. Il n'y a aucun test Playwright pilotant un navigateur réel, vérifiant le rendu React 19, les interactions utilisateur (clics, filtres, modales) ou la gestion du cache côté client.

#### S2-2 : `getFullStatus` ignore les actifs, les portefeuilles et les corporations dans la fraîcheur
- **Fichier et lignes :** `src/server/sync/repository.ts:85-106`, `271-293`
- **Gravité :** S2 (Diagnostic de fraîcheur tronqué) | **Niveau de confiance :** 100%
- **Constat :** Le calcul de fraîcheur globale (`isFresh`, `freshness: 'FRESH' | 'STALE' | 'UNKNOWN'`) ne prend en compte que `wallet_transactions` et `character_orders`. Si les actifs (`character_assets`) ou les soldes (`character_wallet`) sont vieux de 3 jours ou en erreur, `getFullStatus` peut tout de même répondre `FRESH`.

#### S2-3 : `roundIsk` et `roundPercent` convertissent silencieusement `NaN` et infinis en `0`
- **Fichier et lignes :** `src/server/roi/calculator.ts:17-18`, `25-26`
- **Gravité :** S2 (Masquage de calculs anormaux) | **Niveau de confiance :** 100%
- **Constat :** `if (isNaN(value) || !isFinite(value)) return 0;` transforme silencieusement une division par zéro ou une incohérence arithmétique en `0 ISK` au lieu de propager `null` ou `UNKNOWN`.

#### S2-4 : Réconciliation automatique multi-personnages sans barrière de compte explicite
- **Fichier et lignes :** `src/server/roi/service.ts:367-468`
- **Gravité :** S2 (Consommation de stock inter-personnages automatique) | **Niveau de confiance :** 100%
- **Constat :** Lorsque plusieurs personnages sont sélectionnés (`characterIds`), le moteur FIFO agrège tous les lots d'achats dans un pot commun. Un achat effectué par le Personnage A peut donc être consommé automatiquement pour justifier une vente du Personnage B sans confirmation de transfert ou option de cloisonnement.

---

### S3 — Défauts Documentaires & Métadonnées

#### S3-1 : Endpoint `/api/info` obsolète
- **Fichier et lignes :** `server.ts:65`
- **Constat :** L'endpoint renvoie `phase: 'PHASE-11-restock-and-transfers'` alors que la Phase 12 a été intégrée dans le code.

#### S3-2 : Incohérences de statut dans `docs/INDEX.md` et `README.md`
- **Fichier et lignes :** `docs/INDEX.md:40`, `README.md:5`
- **Constat :** `docs/INDEX.md` indique la Phase 12 comme *Planifiée*, et `README.md` indique encore *État initial : dépôt neuf*.

#### S3-3 : Absence d'indicateur de version Git dans l'environnement conteneurisé
- **Constat :** L'environnement d'exécution ne dispose pas du dossier `.git`, nécessitant une traçabilité documentaire basée sur le manifeste d'audit.

---

## 6. Risques Infirmés ou Non Vérifiés

1. **Infirmé — Fuite de tokens OAuth côté client :** L'inspection du code confirme que les jetons `accessToken` et `refreshToken` restent strictement côté serveur dans `sessionStore.ts` et `jwt.ts`. Le navigateur ne reçoit qu'un cookie de session chiffré/sécurisé `eve_session_id`.
2. **Infirmé — Double comptage des taxes dans le grand livre :** L'analyse de `src/server/ledger/service.ts` et `src/server/roi/service.ts` démontre que les taxes issues du journal (`transaction_tax`) et les frais de courtage (`brokers_fee`) sont correctement dédupliqués et ne sont pas ajoutés deux fois.
3. **Infirmé — Écriture sur le marché ESI :** Aucune méthode d'écriture (POST/PUT/DELETE sur les ordres de marché CCP) n'existe dans le codebase. Le périmètre en lecture seule est strictement respecté.

---

## 7. Recommandations Architecturales & Feuille de Route

Pour transformer ces constats en garanties formelles sans déstabiliser l'application, nous structurons les travaux en 4 phases d'assurance de fiabilité ciblées (F01 à F04), venant compléter et clore le cycle avant la release H03 :

```
[ POST-PHASE 12 AUDIT ]
         │
         ▼
[ PHASE-F01 ] ── Fiabilité du Coordinateur, Annulation Réelle & Persistance Sync
         │
         ▼
[ PHASE-F02 ] ── Intégrité du Stockage, Anti-Écrasement & Vérité des Soldes
         │
         ▼
[ PHASE-F03 ] ── Invariants Financiers, Détection Chronologique & Valorisation FIFO
         │
         ▼
[ PHASE-F04 ] ── Preuves Réelles : PostgreSQL Conteneurisé, E2E & Invariants
         │
         ▼
[ PHASE-H03 ] ── Hardening Final, Performance & Release
```

1. **PHASE-F01 :** `docs/phases/PHASE-F01-sync-concurrency-lifecycle.md`
2. **PHASE-F02 :** `docs/phases/PHASE-F02-data-integrity-storage.md`
3. **PHASE-F03 :** `docs/phases/PHASE-F03-financial-inventory-invariants.md`
4. **PHASE-F04 :** `docs/phases/PHASE-F04-testing-ci-real-postgres-e2e.md`
