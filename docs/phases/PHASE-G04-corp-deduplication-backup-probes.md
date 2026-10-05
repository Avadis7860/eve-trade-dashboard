# Phase G04 — Cohérence Opérationnelle, Backup & Observabilité

## 1. Statut
`PLANIFIÉE`

## 2. Objectif
Garantir l'intégrité absolue des journaux de corporation multi-directeurs, fiabiliser le système de sauvegarde et de restauration atomique SHA-256 en éliminant toute distorsion d'identité, et doter le système de sondes de santé et d'observabilité de production fiables.

## 3. Problème architectural
Lors de la synchronisation par plusieurs directeurs d'une même corporation, les entrées du journal de corporation risquent d'être enregistrées en double ou d'écraser la référence de l'observateur. De plus, les procédures de sauvegarde doivent garantir l'exhaustivité des données de corporation sans multiplier les entrées lors de la restauration. Enfin, les endpoints de santé actuels ne vérifient pas la connectivité en profondeur.

## 4. Constats traités
* `S0-3` : Schéma corporation et déduplication multi-directeurs.
* `S2-1` : Healthcheck et sondes de liveness/readiness complètes.
* `S2-2` : Snapshot temporel global et atomicité des sauvegardes.
* `R-02` : Exhaustivité et cohérence des sauvegardes de données corporation.
* `R-05` : Benchmark et validation du dimensionnement du pool de connexions SQL.

## 5. Décisions architecturales
* **Identité Canonique des Événements Corporation :**
  Clé composite immuable : `(corporation_id, division, journal_id)`. L'identité du personnage observant est conservée sous forme de métadonnée d'observation sans altérer l'unicité de la transaction financière.
* **Sauvegarde & Restauration Atomique SHA-256 :**
  Le snapshot exporté rassemble :
  - Les données privées de chaque personnage.
  - Les journaux de corporation canoniques dédupliqués.
  - Les états de synchronisation et métadonnées de version de schéma.
  La restauration s'exécute dans une transaction SQL unique avec vérification préalable de la somme de contrôle SHA-256.
* **Sondes de Production et Métriques :**
  - `/health/live` : Vérification de la vivacité du processus Node.js.
  - `/health/ready` : Vérification approfondie de la connectivité PostgreSQL, de l'état des migrations et de la disponibilité des répertoires de stockage.

## 6. Non-objectifs
* Ne pas modifier le format d'export CSV destiné aux utilisateurs finaux.
* Ne pas exposer d'informations sensibles sur les endpoints de santé publics.

## 7. Dépendances
* Phases G02 et G03.

## 8. Modules concernés
* `src/server/ledger/repository.ts`
* `src/server/storage/backupService.ts`
* `src/server/storage/router.ts`
* `src/server/system/router.ts`
* `src/server/utils/metrics.ts`
* `src/server/middleware/security.ts`
* Tests associés : `src/server/storage/backup.test.ts`, `src/server/system/observability.test.ts`

## 9. Contrats impactés
* `IBackupService`
* Format du manifest de sauvegarde JSON/Archive.
* `IHealthStatus` / `IReadinessStatus`.

## 10. Travaux à réaliser
1. Valider et verrouiller les contraintes SQL d'unicité sur les tables de journal de corporation.
2. Mettre à niveau `backupService.ts` pour exporter et importer les entités de corporation dédupliquées au sein d'une transaction atomique.
3. Implémenter les routes `/health/live` et `/health/ready`.
4. Réaliser une qualification sous charge mesurant la consommation des connexions du pool PostgreSQL sous forte concurrence.

## 11. Invariants à préserver
* Égalité financière stricte : la restauration d'une sauvegarde produit exactement les mêmes totaux de trésorerie, taxes, frais et ROI au centième d'ISK près.
* $N$ directeurs observant la même ligne de journal de corporation $\rightarrow$ exactement 1 événement économique persistant.

## 12. Tests obligatoires
* **Unitaires :** Calcul et vérification de checksum SHA-256.
* **Intégration Corporation :** Ingestion concurrente du même `journal_id` par deux directeurs $\rightarrow$ 1 seule ligne créée.
* **Disaster Recovery (DR Drill) :** Export d'une base $\rightarrow$ Purge intégrale $\rightarrow$ Restauration $\rightarrow$ Comparaison financière avant/après strictement identique (`delta = 0.00 ISK`).
* **Sondes :** Simulation de panne SQL provoquant une réponse `503 Service Unavailable` sur `/health/ready`.

## 13. Scénarios de régression
* Compatibilité ascendante des sauvegardes mono-personnages existantes.

## 14. Critères d'entrée
* Phases G02 et G03 validées et mergées sur `main`.

## 15. Critères de sortie
* 100% de déduplication des événements de corporation validée sur PostgreSQL.
* Test de Disaster Recovery validé avec succès sans divergence de calcul.
* Sondes `/health/live` et `/health/ready` opérationnelles.

## 16. Preuves obligatoires
* Rapport de test Disaster Recovery démontrant l'exactitude des soldes et du FIFO avant et après restauration.
* Rapport de test de charge sur le pool PostgreSQL démontrant l'absence d'épuisement de connexions.

## 17. Risques résiduels
* Durée d'export prolongée sur de très volumineux historiques de corporation.

## 18. Décision release
`BLOQUANTE`
