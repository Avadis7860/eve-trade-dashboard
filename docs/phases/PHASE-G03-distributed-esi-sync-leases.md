# Phase G03 — Concurrence Distribuée & Synchronisation ESI

## 1. Statut
`PLANIFIÉE`

## 2. Objectif
Assurer une coordination infaillible des synchronisations ESI entre plusieurs processus ou instances sans saturer les quotas CCP, en implémentant un système de baux (leases) PostgreSQL résilient aux pannes et respectueux des limites de débit.

## 3. Problème architectural
Lorsque plusieurs instances de l'application s'exécutent simultanément, des crawls ESI parallèles pour un même personnage ou une même corporation peuvent être déclenchés. L'utilisation d'advisory locks transactionnels bloquerait inutilement des connexions de pool SQL pendant de longues requêtes HTTP, tandis que l'absence totale de verrouillage risque d'entraîner le bannissement temporaire de l'IP applicative par CCP.

## 4. Constats traités
* `S1-4` : Absence de verrouillage distribué ESI inter-instances.
* `S0-2` (complément) : Cohérence distribuée des statuts de synchronisation.

## 5. Décisions architecturales
* **Table de Baux Distribués (`esi_sync_leases`) :**
  Création d'une table dédiée pour gérer les baux sans bloquer les connexions SQL :
  ```sql
  CREATE TABLE IF NOT EXISTS esi_sync_leases (
    scope_key VARCHAR(128) PRIMARY KEY,
    instance_id VARCHAR(64) NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ```
* **Cycle de Vie Borné :**
  $$\text{Acquisition Lease} \longrightarrow \text{Exécution Crawl ESI (Pagination + ETag)} \longrightarrow \text{Persistance Données} \longrightarrow \text{Libération Lease}$$
  La libération est systématiquement garantie par un bloc `try ... finally`.
* **Résilience aux Crashes (Self-Healing) :**
  Les baux disposent d'une durée de vie courte (TTL 60–120s) avec renouvellement périodique (Heartbeat) pendant les opérations longues. En cas d'arrêt brutal d'un nœud, le bail expire automatiquement et peut être repris par un autre nœud.
* **Coalescence des Requêtes Concurrentes :**
  Lorsqu'un crawl est actif pour une clé de ressource, toute autre requête concurrente reçoit un statut `409 Conflict` ou s'abonne à la synchronisation en cours.

## 6. Non-objectifs
* Ne pas introduire Redis, RabbitMQ ou Kafka.
* Ne pas modifier les règles de calcul des taxes, broker fees ou FIFO des phases F01–F10.

## 7. Dépendances
* Phase G02.

## 8. Modules concernés
* `src/server/sync/coordinator.ts`
* `src/server/sync/service.ts`
* `src/server/sync/repository.ts`
* `src/server/esi/client.ts`
* `src/server/esi/rateLimiter.ts`
* Tests associés : `src/server/sync/concurrency.test.ts`, `src/server/sync/resilience.test.ts`

## 9. Contrats impactés
* `ISyncCoordinator`
* `ISyncService`
* Schéma SQL de synchronisation.

## 10. Travaux à réaliser
1. Définir le schéma SQL et les migrations pour la table `esi_sync_leases`.
2. Implémenter dans `PostgresSyncRepository` les méthodes `tryAcquireLease`, `renewLease` et `releaseLease`.
3. Intégrer la gestion des baux dans `SyncCoordinator` avec libération déterministe dans le bloc `finally`.
4. Écrire des tests de concurrence multi-instances simulant des synchronisations simultanées sur le même personnage.

## 11. Invariants à préserver
* Une ressource ESI donnée pour un personnage ou une division de corporation ne doit jamais être crawlée en parallèle par plus d'un processus.
* Les statuts `PARTIAL`, `ERROR`, `UNKNOWN` ne doivent jamais être masqués ou convertis en `COMPLETE`.

## 12. Tests obligatoires
* **Unitaires :** Acquisition, renouvellement, expiration et libération de baux.
* **Concurrence Réelle :** 10 workers concurrents tentant de synchroniser simultanément le même personnage $\rightarrow$ 1 seul exécute le crawl, 9 reçoivent l'état partagé ou attendent sans collision.
* **Test de Crash / Reprise :** Simulation d'un kill processus pendant un crawl $\rightarrow$ expiration du lease $\rightarrow$ reprise réussie par un second worker.

## 13. Scénarios de régression
* La synchronisation séquentielle d'un utilisateur unique demeure instantanée et sans overhead perceptible.

## 14. Critères d'entrée
* Phase G02 validée et mergée sur `main`.

## 15. Critères de sortie
* Zéro double appel ESI constaté sous charge concurrente.
* Libération garantie des baux SQL dans 100% des scénarios (succès, erreur ESI, timeout).

## 16. Preuves obligatoires
* Journal d'exécution d'un test de concurrence démontrant l'acquisition unique du bail et le rejet/coalescence des demandes concurrentes.

## 17. Risques résiduels
* Délais réseau ESI prolongés (couverts par le heartbeat).

## 18. Décision release
`BLOQUANTE`
