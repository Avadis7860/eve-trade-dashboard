# Phase F01 — Cycle de Vie Sync, Annulation Réelle & Persistance Asynchrone

## 1. Contexte & Problématique
L'audit technique post-Phase 12 a identifié des vulnérabilités critiques dans l'orchestration de la synchronisation ESI :
1. **Timeouts non interruptifs (S0-3) :** Le `SyncCoordinator` lève un timeout au bout de 45 secondes et libère son slot de travailleur, mais la tâche `item.fn()` continue de s'exécuter en arrière-plan sans `AbortSignal`. Cela génère des dépassements de concurrence non bornés et des écritures fantômes.
2. **Désynchronisation mémoire / PostgreSQL du SyncRepository (S0-2) :** `PostgresSyncRepository.updateSyncState` met à jour une copie mémoire synchrone et lance la requête SQL asynchrone avec un `.catch(() => {})` silencieux non attendu. En cas d'erreur ou de redémarrage serveur, l'état de synchronisation est corrompu ou perdu.
3. **Masquage d'erreurs d'ordres historiques (S0-4) :** Si l'appel `/orders/history/` échoue, l'erreur est absorbée et le statut de synchronisation des ordres est marqué `COMPLETE` et `FRESH`.
4. **Fragilité de `syncAll` et abandon des retours corporatifs (S1-4) :** `Promise.all` fait échouer l'ensemble de la synchronisation si une seule ressource est en timeout, tandis que les statuts des divisions de corporation sont perdus.

## 2. Objectifs & Périmètre
- Introduire un mécanisme d'annulation réelle `AbortController` / `AbortSignal` propagé depuis le `SyncCoordinator` jusqu'au client ESI HTTP (`fetch`) et aux boucles de pagination (`fetchFromId`, `fetchXPages`).
- Rendre les méthodes de persistance du `ISyncRepository` rigoureusement asynchrones (`updateSyncStateAsync`, `getSyncStateAsync`) ou garantir que la version synchrone bloque ou attend de manière sûre dans les contextes de services.
- Refactoriser `SyncService.executeSyncCharacterOrders` pour qualifier le statut à `PARTIAL` avec `reason: 'HISTORY_FETCH_FAILED'` lorsque l'historique ESI échoue.
- Sécuriser `SyncService.syncAll` avec `Promise.allSettled` et inclure explicitement les résultats des ressources de corporation dans l'objet de retour.

## 3. Fichiers & Modules Concernés
- `src/server/sync/coordinator.ts`
- `src/server/sync/repository.ts`
- `src/server/sync/service.ts`
- `src/server/esi/client.ts`
- `src/server/esi/pagination.ts`
- `src/server/sync/types.ts`
- Tests associés : `src/server/sync/concurrency.test.ts`, `src/server/sync/resilience.test.ts`, `src/server/sync/sync.test.ts`

## 4. Modifications Conceptuelles & Règles Techniques
1. **Propagation de l'AbortSignal :**
   Toute tâche enregistrée dans `SyncCoordinator.enqueue` reçoit un `signal: AbortSignal`. Si le timeout du coordinateur expire, `abortController.abort()` est invoqué immédiatement.
2. **Gestion de l'annulation dans EsiClient :**
   L'appel `fetch()` sous-jacent doit écouter le signal d'annulation et interrompre immédiatement la connexion socket.
3. **Vérité des statuts d'ordres :**
   L'état d'un flux d'ordres où le snapshot actif a réussi mais l'historique a échoué doit être `PARTIAL` (avec `errorMessage` explicite) et non `COMPLETE`.
4. **Persistance ACID Sync :**
   Toutes les mutations de `SyncState` effectuées dans `SyncService` doivent attendre la fin de l'écriture physique en base de données avant de renvoyer le résultat.

## 5. Tests Obligatoires & Scénarios de Validation
- [ ] Test unitaire vérifiant qu'un timeout dans le `SyncCoordinator` interrompt immédiatement la requête HTTP en cours et qu'aucune écriture en base n'a lieu après l'expiration.
- [ ] Test de persistance prouvant qu'après un crash ou redémarrage du processus, `PostgresSyncRepository` relit l'état exact présent dans la table `sync_states`.
- [ ] Test d'échec simulé sur `/characters/{id}/orders/history/` vérifiant que `syncCharacterOrders` retourne `status: 'PARTIAL'` et que le repository enregistre `coverageStatus: 'PARTIAL'`.
- [ ] Test de charge multi-personnages vérifiant le respect strict du plafond de concurrence de 6 travailleurs actifs au maximum lors de timeouts simulés.

## 6. Critères d'Entrée & de Sortie
- **Entrée :** Branche dédiée `feature/F01-sync-concurrency-lifecycle` créée à partir de `main`.
- **Sortie :**
  - 100% des tests unitaires et d'intégration verts.
  - Zero promesse non attendue dans `SyncRepository` et `SyncService`.
  - Pas de tâche fantôme résiduelle après expiration de délai.
  - `docs/CODE_INDEX.md` mis à jour avec les nouveaux contrats de synchronisation.
