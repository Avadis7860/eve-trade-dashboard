# Phase R04 — Optimisation des calculs métier et accès aux données

## Objectif
Transférer les opérations lourdes de filtrage, tri, pagination et agrégation statistique depuis les boucles JavaScript en mémoire vive vers le moteur relationnel PostgreSQL, tout en préservant l'intégrité absolue des règles de calcul financier (FIFO avec antériorité temporelle, enrichissement des taxes/frais TTC, calculs de rentabilité et décomposition du capital).

## Problèmes traités
- Les repositories et services métier effectuent des scans complets en mémoire de l'intégralité des transactions et des ordres :
  - `PersistentLedgerRepository.getTransactions` itère sur toutes les clés, applique des `filter()`, puis effectue un tri `matched.sort()` complet avant d'appliquer `slice()` pour la pagination.
  - `PersistentLedgerRepository.getSummary` boucle sur l'ensemble des transactions pour calculer des sommes et ensembles distincts (`distinctTypes.add`, `distinctLocations.add`).
  - `CapitalService.getPositions` charge la totalité des transactions (`getAllTransactions`) et des ordres pour calculer la date de dernière activité et les réservations de stocks par article et emplacement.
  - `AnalyticsService.getProduct360` parcourt la totalité des transactions historiques pour en extraire les ventes d'un seul `typeId`.
- Cette approche consomme une quantité croissante de mémoire et de temps processeur CPU à mesure que l'historique de l'utilisateur grandit (> 10 000 à 100 000 transactions).

## Constats vérifiés
- `src/server/ledger/repository.ts` (Lignes 299–360) : Algorithme de filtrage et tri JavaScript exécuté sur le heap Node.js pour chaque requête de page.
- `src/server/ledger/repository.ts` (Lignes 454–551) : `getSummary` effectue un parcours complet de la collection avec enrichissement individuel de chaque transaction (`enrichTransaction`) pour sommer les taxes et frais, générant des calculs redondants.
- `src/server/capital/service.ts` (Lignes 62–100) : Charge l'intégralité des transactions pour calculer une table de hachage de dernière activité.

## Périmètre inclus
- **Migration des requêtes de consultation vers SQL optimisé :**
  - `getTransactions(filters)` : Requête SQL directe avec clauses `WHERE`, `ORDER BY`, `LIMIT` et `OFFSET`, exploitant les index B-tree sur `(character_id, date DESC)`, `type_id` et `location_id`.
  - `getSummary(characterId)` : Requête SQL d'agrégation utilisant `COUNT()`, `SUM()`, `COUNT(DISTINCT type_id)`, `COUNT(DISTINCT location_id)` sans instancier des milliers d'objets en mémoire.
  - `getFilterOptions(characterId)` : Requêtes `SELECT DISTINCT type_id, type_name` et `SELECT DISTINCT location_id, location_name` directement groupées en base.
  - `getProduct360(typeId, characterId)` : Requête ciblée filtrant immédiatement sur `type_id = $1` en base SQL.
- **Sélection des calculs restant dans le domaine métier :**
  - L'algorithme de réconciliation FIFO (`RoiService.runAutoFifoReconciliation`) conserve son moteur déterministe en mémoire TypeScript pour les lots concernés, mais reçoit un sous-ensemble de données préparé et filtré en amont par SQL (uniquement les achats et ventes du `typeId` cible ou de la fenêtre sélectionnée).
  - L'enrichissement unitaire précis des taxes et frais TTC (`getJournalEntriesForTransaction`) est optimisé par une jointure SQL (`LEFT JOIN journal_entries`) ou par une requête groupée indexée sur `context_id`.

## Périmètre exclu
- Aucune modification des formules mathématiques définies dans `docs/METRICS.md` et `docs/DOMAIN_CONTRACTS.md`.
- Pas d'introduction d'un ORM lourd ; conservation de requêtes SQL écrites et typées avec précision.

## Pré-requis
- Phase R01 terminée (schéma relationnel PostgreSQL et repositories SQL en place).
- Phase R02 terminée (vérité des données et pagination exempte de troncatures).

## Architecture cible
```
AVANT (In-Memory Heap Scans) :
PostgreSQL/JSON -> Tout charger en mémoire -> filter() -> sort() -> slice() -> Réponse

CIBLE (Index-Powered SQL Processing) :
Client HTTP -> Filtres (page, search, hub, type)
                    │
                    ▼
     PostgresLedgerRepository
     SELECT * FROM transactions
     WHERE character_id = $1 AND type_id = $2
     ORDER BY date DESC
     LIMIT $3 OFFSET $4
                    │
                    ▼ (uniquement 50 lignes retournées au moteur Node.js)
     Enrichissement unitaire & Réponse rapide
```

## Travaux attendus
1. **Écrire les requêtes SQL paginées du Grand Livre :** Implémenter la construction de requêtes dynamiques sécurisées avec paramètres `$1, $2, ...` pour les filtres textuels (`ILIKE`), de dates et d'emplacements.
2. **Écrire les requêtes d'agrégation du résumé financier :** Remplacer le parcours manuel par une requête SQL `SELECT SUM(...)` optimisée.
3. **Optimiser `CapitalService` :** Utiliser des requêtes SQL d'agrégation (`MAX(date) GROUP BY type_id, location_id`) pour identifier l'inactivité des stocks dormants au lieu de scanner tout l'historique.
4. **Optimiser `AnalyticsService` :** Extraire les séries temporelles et métriques Product 360 par agrégation SQL `date_trunc('day', date)` lorsque possible.

## Tests obligatoires
- Test de conformité stricte des résultats : Comparer à l'identique les résultats de `getTransactions`, `getSummary` et `getProduct360` entre l'ancienne implémentation mémoire et la nouvelle implémentation SQL sur un même jeu de données.
- Test de pagination SQL : Vérifier la cohérence de l'ordre, du calcul de `totalPages` et de `total` lors de requêtes avec `search`, filtres combinés et offsets élevés.
- Test d'invariance des agrégats : Vérifier que le total des ventes brutes, taxes, frais et profit net calculé en SQL est strictement identique au centime près aux formules existantes.

## Mesures de performance
- Temps d'exécution de `getTransactions` sur une base de 100 000 transactions : passage de > 150 ms à < 10 ms.
- Temps de calcul de `getSummary` : passage de > 200 ms à < 5 ms.
- Réduction drastique de l'allocation d'objets sur le heap V8 lors des requêtes de consultation.

## Risques de régression
- Risque d'incohérence d'arrondi décimal sur les sommes SQL vs calculs JavaScript : mitigation par l'utilisation du type SQL `NUMERIC(20, 2)` et de la fonction `roundIsk` de référence.

## Critères d’entrée
- Phase R01 et R02 validées.

## Critères de sortie
- 100% des requêtes de liste et d'agrégation s'exécutent en SQL avec index sans scan exhaustif en mémoire.
- Les benchmarks sur 100 000 transactions confirment les gains de latence et de mémoire.
- La conformité mathématique est validée à 100% par les tests de non-régression.

## Preuves attendues
- Plans d'exécution SQL (`EXPLAIN ANALYZE`) démontrant l'utilisation effective des index B-tree (`Index Scan` au lieu de `Seq Scan`).
- Rapport de benchmark comparatif Avant/Après.

## Dépendances vers les autres phases
- **Bloque :** Phase R7 (Tests complets), Phase R8 (Observabilité).
- **Dépend de :** Phase R01, Phase R02.

## Definition of Done
Requêtes SQL paginées et agrégées en production + plans d'exécution indexés validés + conformité arithmétique 100% démontrée + tests de charge au vert.
