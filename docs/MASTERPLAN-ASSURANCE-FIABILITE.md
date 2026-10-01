# Masterplan d'Assurance Fiabilité & Traçabilité (Post-Phase 12)

**Mission :** Garantir l'intégrité absolue des données, la robustesse de la synchronisation concurrente, l'invariance des calculs financiers et l'authenticité des preuves de test du projet **EVE Trade Dashboard** suite à l'audit contradictoire post-Phase 12.

---

## 1. Contexte & Justification de la Série F (Assurance Fiabilité)

L'audit approfondi documenté dans [`docs/AUDIT-POST-PHASE-12.md`](AUDIT-POST-PHASE-12.md) a mis en évidence que les garanties offertes par les phases R00 à R08 étaient incomplètes sur plusieurs points cruciaux :
1. **Concurrence & Annulation :** Les timeouts du `SyncCoordinator` abandonnent la promesse mais laissent tourner des tâches asynchrones d'arrière-plan sans signal d'annulation `AbortSignal`, provoquant des dépassements de concurrence et des conflits d'écritures.
2. **Persistance Sync :** `PostgresSyncRepository` délègue à une méthode asynchrone non attendue (`.catch(() => {})`), créant un risque de désynchronisation entre la mémoire et PostgreSQL.
3. **Résilience Stockage Fichier :** `DurableFileDatabaseAdapter` écrase le fichier de données par un état vide en cas d'erreur de lecture ponctuelle.
4. **Vérité des Données :** Les soldes de portefeuille non numériques sont convertis en `0 ISK`, et les échecs d'historique d'ordres sont masqués sous un statut `COMPLETE`.
5. **Exactitude des Calculs :** Le dernier prix d'achat dans les opérations sélectionne la mauvaise transaction, et le coût de revient des stocks physiques applique une moyenne implicite indue.
6. **Preuves de Test :** Les tests PostgreSQL tournent sur un mock JavaScript en mémoire, et les tests E2E n'exécutent pas de navigateur réel.

La série **F01 à F04** constitue le plan d'action méthodique et borné pour résoudre ces défaillances avant la release H03.

---

## 2. Matrice des Phases de Fiabilisation (Série F)

| ID | Intitulé de la Phase | Priorité | Problèmes Traités | Dépendances | Statut |
|---|---|---|---|---|---|
| **F01** | [Cycle de Vie Sync, Annulation Réelle & Persistance Asynchrone](phases/PHASE-F01-sync-concurrency-lifecycle.md) | **Critique (S0)** | S0-2, S0-3, S0-4, S1-4 | Post-Phase 12 | **Terminé** |
| **F02** | [Intégrité du Stockage, Anti-Écrasement & Vérité des Données](phases/PHASE-F02-data-integrity-storage.md) | **Critique (S0)** | S0-1, S0-5, S1-3, S2-2 | F01 | **Terminé** |
| **F03** | [Invariants Financiers, Détection Chronologique & Valorisation FIFO](phases/PHASE-F03-financial-inventory-invariants.md) | **Majeure (S1)** | S1-1, S1-2, S2-3, S2-4 | F01, F02 | **Prête à démarrer** |
| **F04** | [Preuves de Qualification Réelles : PostgreSQL CI & Tests E2E Navigateur](phases/PHASE-F04-testing-ci-real-postgres-e2e.md) | **Majeure (S1)** | S1-5, S2-1 | F01–F03 | **Planifiée** |

---

## 3. Graphe des Dépendances & Chemin Critique

```
[ Phase 12 - Cockpit & Navigation ]
                │
                ▼
┌──────────────────────────────────────────────────────────┐
│ PHASE-F01 : Sync Concurrency, AbortSignals & Persist     │
│  • AbortController & annulation HTTP/ESI réelle          │
│  • SyncRepository asynchrone ACID                        │
│  • Élimination du masquage de statut COMPLETE sur ordres │
│  • syncAll avec résultats de corporation explicites      │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ PHASE-F02 : Stockage Durable & Vérité des Soldes         │
│  • Sauvegarde de secours (.corrupt) avant tout reset     │
│  • Règle stricte : rejet des soldes null/NaN (pas de 0)  │
│  • Isolation du calcul de fraîcheur par personnage       │
│  • Diagnostic complet incluant wallet, assets, corp      │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ PHASE-F03 : Invariants Financiers & Précision Métier     │
│  • Sélection chronologique exacte du dernier prix achat  │
│  • Coût de revient par lot FIFO strict (pas de moyenne)  │
│  • Cloisonnement des réconciliations multi-personnages   │
│  • Horodatages multiples dans les vues agrégées Cockpit  │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ PHASE-F04 : Preuves Réelles (PostgreSQL CI & E2E)        │
│  • Exécution de tests sur véritable PostgreSQL           │
│  • Tests E2E Playwright réels avec navigateur            │
│  • Tests de pannes réseau, coupures et reprises          │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│ PHASE-H03 : Hardening Final, Optimisations & Release     │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Objectifs Détaillés et Livrables par Phase

### Phase F01 — Cycle de Vie Sync, Annulation Réelle & Persistance Asynchrone
- **Objectif :** Transformer le `SyncCoordinator` et le `SyncService` pour garantir que tout timeout ou annulation interrompt réellement les requêtes réseau et les écritures SQL en cours.
- **Fichiers concernés :**
  - `src/server/sync/coordinator.ts`
  - `src/server/sync/service.ts`
  - `src/server/sync/repository.ts`
  - `src/server/esi/client.ts`
  - `src/server/esi/pagination.ts`
- **Preuve attendue :** Test unitaire démontrant qu'un timeout déclenche l'avortement effectif de la requête `fetch` et empêche toute écriture résiduelle en base après le rejet de la tâche.

### Phase F02 — Intégrité du Stockage, Anti-Écrasement & Vérité des Données
- **Objectif :** Sécuriser l'adaptateur fichier contre toute perte accidentelle de données, forcer la propagation des erreurs d'E/S, et éliminer toute conversion silencieuse de valeurs invalides en zéro.
- **Fichiers concernés :**
  - `src/server/storage/database.ts`
  - `src/server/sync/service.ts`
  - `src/server/analytics/service.ts`
  - `src/server/sync/repository.ts`
- **Preuve attendue :** Test de corruption de fichier vérifiant la création d'un backup `.corrupt.bak` sans écrasement de données, et test d'API vérifiant qu'un solde ESI non numérique renvoie `ERROR` ou `UNKNOWN` sans jamais insérer 0 ISK.

### Phase F03 — Invariants Financiers, Détection Chronologique & Valorisation FIFO
- **Objectif :** Aligner les algorithmes financiers du plan opérationnel et de la valorisation des stocks sur les contrats stricts de `METRICS.md` et `DOMAIN_CONTRACTS.md`.
- **Fichiers concernés :**
  - `src/server/operations/service.ts`
  - `src/server/capital/service.ts`
  - `src/server/roi/service.ts`
  - `src/server/roi/calculator.ts`
- **Preuve attendue :** Tests d'invariance mathématique prouvant la sélection de la transaction d'achat la plus récente quelle que soit l'ordre de la liste, et la non-attribution d'un statut `KNOWN` sur du stock physique excédant l'inventaire FIFO.

### Phase F04 — Preuves de Qualification Réelles : PostgreSQL CI & Tests E2E Navigateur
- **Objectif :** Élever la suite de validation au plus haut niveau d'exigence en exécutant de vrais conteneurs PostgreSQL et de vrais parcours Playwright.
- **Fichiers concernés :**
  - `package.json`
  - `src/server/storage/postgres.real.test.ts`
  - `playwright.config.ts`
  - `src/e2e/*.spec.ts`
  - `.github/workflows/*.yml`
- **Preuve attendue :** Exécution complète de la suite de tests contre une véritable instance PostgreSQL et validation des 11 parcours E2E dans un navigateur Chromium piloté par Playwright.

---

## 5. Gouvernance d'Exécution & Définition de Fini

Chaque phase F suit scrupuleusement la règle d'or du projet :
- **1 phase = 1 branche = 1 PR.**
- **Aucun commit direct sur main.**
- **Code réel + Tests unitaires/intégration écrits avec le code + Validation CI.**
- **Mise à jour synchronisée de `docs/CODE_INDEX.md` et des contrats concernés.**
- **Validation formelle des critères de sortie avant ouverture de la phase suivante.**
