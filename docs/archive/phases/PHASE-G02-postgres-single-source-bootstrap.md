# Phase G02 — Persistance PostgreSQL Unique & Bootstrap Asynchrone

## 1. Statut
`TERMINÉE`

## 2. Objectif
Établir PostgreSQL comme l'unique source de vérité persistante sans état mémoire divergent, éliminer toute écriture « fire-and-forget » non attendue, et garantir un ordre de bootstrap asynchrone strict avant l'ouverture du trafic réseau.

## 3. Problème architectural
L'audit technique a identifié des anomalies de persistance et de démarrage :
1. **Double vérité mémoire / SQL (S0-2) :** Certains repositories conservaient des maps en mémoire synchronisées de manière asynchrone non bloquante avec PostgreSQL. En cas de panne ou de reprise après crash, l'état mémoire divergeait de la base SQL.
2. **Écritures fire-and-forget (S1-1) :** Des méthodes d'écriture asynchrones étaient invoquées sans `await` (avec `.catch(() => {})`), masquant les erreurs de contraintes SQL et risquant de corrompre l'historique financier.
3. **Bootstrap HTTP non ordonnancé (R-03) :** `server.ts` ouvrait le port d'écoute HTTP (`app.listen()`) avant que la connexion à la base de données ne soit établie et que les migrations de schéma ne soient terminées.

## 4. Constats traités
* `S0-2` : Dualité de persistance mémoire / PostgreSQL.
* `S1-1` : Écritures PostgreSQL fire-and-forget non attendues.
* `R-03` : Bootstrap PostgreSQL/migrations non attendu avant ouverture du trafic.

## 5. Décisions architecturales
* **PostgreSQL Source Unique :**
  En présence de `DATABASE_URL`, toutes les lectures et écritures s'effectuent directement sur PostgreSQL. Aucun état métier n'est conservé dans des maps mémoire parallèles. L'adaptateur `MemoryDatabaseAdapter` est strictement réservé aux tests unitaires isolés.
* **Persistance Synchrone et ACID :**
  Toutes les opérations d'écriture dans `LedgerService`, `OrdersService`, `AssetsService`, `SyncService` et `SessionStore` sont obligatoirement attendues avec `await`. Les opérations multi-tables sont enveloppées dans des transactions SQL atomiques.
* **Bootstrap Asynchrone Ordonné :**
  Le cycle de démarrage de l'application est séquencé dans une fonction asynchrone bloquante `bootstrapApp()` :
  ```
  Configuration -> Connexion DB -> Migrations SQL -> Services Init -> Store Init -> app.listen()
  ```
  Le serveur n'accepte aucune requête avant que l'ensemble des dépendances ne soit opérationnel.

## 6. Non-objectifs
* Ne pas modifier le schéma relationnel métier validé en phases F01–F11.
* Ne pas remplacer l'adaptateur SQL typé par un ORM lourd.

## 7. Dépendances
* Phase G01.

## 8. Modules concernés
* `src/server/storage/database.ts`
* `src/server/storage/schema.ts`
* `src/server/storage/repository.ts`
* `src/server/ledger/repository.ts`
* `src/server/orders/repository.ts`
* `src/server/assets/repository.ts`
* `src/server/sync/repository.ts`
* `server.ts`
* Tests associés : `src/server/storage/postgres.real.test.ts`, `src/server/storage/storage.test.ts`, `server.test.ts`

## 9. Contrats impactés
* `IDatabaseAdapter`
* Méthodes asynchrones des repositories.
* Signature d'initialisation du serveur applicatif.

## 10. Travaux à réaliser
1. Supprimer toutes les structures de données en mémoire secondaires dans les repositories PostgreSQL.
2. Ajouter l'attente obligatoire (`await`) et la gestion des transactions SQL sur l'ensemble des écritures métier.
3. Implémenter le bootstrap asynchrone bloquant dans `server.ts` avec arrêt immédiat (fail-fast) en cas d'erreur de migration ou de connexion.
4. Rédiger un test de persistance post-redémarrage garantissant la conservation intégrale de l'état.

## 11. Invariants à préserver
* Zéro perte de transaction financière après validation d'une requête HTTP.
* En cas d'erreur SQL, la requête cliente doit recevoir une réponse `500 Internal Server Error` explicite et non un faux succès `200 OK`.

## 12. Tests obligatoires
* **Unitaires :** Validation des rollbacks transactionnels en cas d'erreur SQL.
* **Intégration PostgreSQL Réel :** CRUD complet et requêtes complexes sur vraie base PostgreSQL.
* **Test de Redémarrage (Restart Test) :** Écriture de données $\rightarrow$ Arrêt serveur $\rightarrow$ Relance $\rightarrow$ Validation de conformité 100%.
* **Test de Bootstrap :** Échec immédiat du démarrage si la base PostgreSQL est injoignable.

## 13. Scénarios de régression
* Maintien des performances de requêtes sous les seuils acceptables.
* Préservation de l'adaptateur fichier pour le développement local hors production.

## 14. Critères d'entrée
* Phase G01 validée et mergée sur `main`.

## 15. Critères de sortie
* Zéro appel SQL non attendu dans l'intégralité du code serveur.
* Bootstrap 100% asynchrone vérifié par tests de démarrage.
* Test de redémarrage avec PostgreSQL réel validé avec succès.

## 16. Preuves obligatoires
* Journalisation attestant l'ordre strict : `DB Connected -> Migrations Applied -> Services Ready -> Listening on port 3000`.
* Test automatisé validant la relecture exacte des données après extinction et redémarrage du processus Node.js.

## 17. Risques résiduels
* Légère augmentation du temps de démarrage à froid lors de l'application de migrations initiales.

## 18. Décision release
`BLOQUANTE`
