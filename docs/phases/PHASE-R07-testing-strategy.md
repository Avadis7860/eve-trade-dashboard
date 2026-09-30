# Phase R07 — Stratégie de tests complète

## Objectif
Transformer la suite de tests actuelle en une pyramide de validation automatisée industrielle et exhaustive, en conservant l'ensemble des 149 tests de domaine existants et en complétant les niveaux manquants : tests de repositories sur PostgreSQL réel, tests HTTP d'isolation, tests de composants React avec React Testing Library, tests de bout en bout (E2E Playwright) et benchmarks de performance reproductibles.

## Problèmes traités
- La couverture actuelle est quasi exclusivement concentrée sur le domaine métier en mémoire vive et l'émulation unitaire.
- Absence de tests d'intégration automatisés s'exécutant sur une véritable instance PostgreSQL avec contraintes de clés étrangères, index et transactions concurrentes.
- Absence de tests E2E simulant de véritables parcours utilisateur complets dans le navigateur.
- Le test de performance existant sur 50 000 transactions mesure une boucle JavaScript locale et ne reflète pas les conditions réelles de production.
- Les cas limites (sessions expirées, retours ESI 420/429, réponses partielles `PARTIAL`, bascules rapides de personnage) manquent de tests d'intégration automatisés.

## Constats vérifiés
- 20 fichiers de test Vitest actuels (149 tests), tous au vert, très pertinents pour les règles financières et de classification (à préserver impérativement sans affaiblissement d'assertions).
- Aucun runner E2E (Playwright) configuré dans `package.json`.
- Pas de suite de tests de performance automatisée mesurant p50/p95/p99 sous charge.

## Périmètre inclus
- **Organisation en 6 niveaux de tests distincts :**

### Niveau 1 — Domaine Métier & Invariants (Vitest)
- Conservation intégrale des 149 tests existants.
- Validation des contrats : formules TTC, ROI, non double-comptage de taxes/frais, réconciliation FIFO avec antériorité temporelle, décomposition mutuellement exclusive du capital (`COMMITTED_SELL_ORDER`, `FREE_HUB_STOCK`, `REMOTE_DORMANT_STOCK`, `IN_TRANSIT_STOCK`, `UNRECONCILED_STOCK`), sémantique stricte des statuts `UNKNOWN`, `PARTIAL`, `ERROR`, `ABSENT`.

### Niveau 2 — Repository & Stockage SQL (Vitest + PostgreSQL Réel)
- Exécution de tests contre une base PostgreSQL éphémère (Docker / Testcontainers / instance locale de test).
- Validation des migrations séquentielles idempotentes.
- Validation des contraintes d'unicité, des clés étrangères et des index B-tree.
- Validation des transactions atomiques et des rollbacks en cas de crash simulé.
- Validation de `clearCharacterData` en base SQL.

### Niveau 3 — Couche HTTP & Middleware (Supertest)
- Validation de l'ensemble des endpoints Express (`/api/auth/*`, `/api/ledger/*`, `/api/orders/*`, `/api/roi/*`, `/api/capital/*`, `/api/analytics/*`, `/api/backup/*`).
- Validation des codes HTTP contractuels : 200, 201, 400 (paramètres invalides), 401 (non authentifié), 403 (accès interdit à un autre personnage), 404, 429, 500.
- Validation de l'isolation de session : interdiction d'injecter des `character_ids` arbitraires.

### Niveau 4 — Frontend & Composants UI (React Testing Library)
- Validation de l'affichage de l'ensemble des états UX définis dans `docs/UX_STATES.md` : `LOADING`, `SUCCESS`, `EMPTY`, `PARTIAL`, `STALE`, `ERROR`.
- Validation du comportement lors des changements rapides de filtres et d'onglets (annulation `AbortController`).
- Validation de l'ouverture et fermeture fluide de la modale `Product360Modal`.
- Validation de l'export CSV RFC 4180 et de la copie EVE Multibuy.

### Niveau 5 — Parcours de Bout en Bout E2E (Playwright)
- Automatisation des 11 parcours critiques utilisateur :
  1. Chargement initial de l'application et affichage de l'état système.
  2. Simulation de connexion SSO EVE Online et émission de cookie de session sécurisé.
  3. Association et bascule entre plusieurs personnages liés.
  4. Déclenchement d'une synchronisation globale et affichage des indicateurs de complétude.
  5. Consultation, recherche et filtrage dans le Grand Livre (Ledger).
  6. Consultation des ordres de marché et filtrage par état de cycle de vie.
  7. Consultation de la vue Capital et identification des stocks dormants > 30 jours.
  8. Consultation de la vue Hubs & ROI et déclenchement d'une réconciliation FIFO.
  9. Inspection Product 360 en 1 clic sur un article et affichage des séries temporelles.
  10. Export de données au format CSV conforme RFC 4180.
  11. Export et vérification d'une sauvegarde chiffrée SHA-256.

### Niveau 6 — Benchmarks & Performance
- Scripts de benchmarks automatisés reproductibles sur volumétries standardisées :
  - Dataset 10k transactions.
  - Dataset 50k transactions.
  - Dataset 100k transactions.
  - Dataset 500k transactions.
- Mesures systématiques : latence p50, p95, p99, débit de requêtes par seconde, consommation mémoire Heap Node.js, temps d'exécution SQL `EXPLAIN ANALYZE`.

## Périmètre exclu
- Les tests E2E ne doivent jamais appeler les vrais serveurs de CCP EVE Online (serveur mock ESI local déterministe obligatoire).

## Pré-requis
- Phases R01 à R06 terminées et intégrées.

## Architecture cible
```
┌────────────────────────────────────────────────────────────┐
│                    Niveau 5 : E2E Playwright               │
│                  (11 parcours complets dans UI)            │
├────────────────────────────────────────────────────────────┤
│                Niveau 4 : React Testing Library            │
│                 (Composants & États UX dégradés)           │
├────────────────────────────────────────────────────────────┤
│                    Niveau 3 : Supertest HTTP               │
│               (Sécurité, RBAC, Sessions, Codes HTTP)       │
├────────────────────────────────────────────────────────────┤
│               Niveau 2 : Dépôts PostgreSQL Réels           │
│             (Migrations, Index, Transactions, Rollback)    │
├────────────────────────────────────────────────────────────┤
│               Niveau 1 : Domaine Métier (Vitest)           │
│             (Invariants, Formules TTC, FIFO, ROI, 149 tests)│
└────────────────────────────────────────────────────────────┘
```

## Travaux attendus
1. **Conserver et sanctuariser les 149 tests unitaires de domaine existants.**
2. **Configurer la suite de tests d'intégration PostgreSQL (Niveau 2).**
3. **Étendre la suite de tests HTTP Supertest (Niveau 3) pour couvrir 100% des routes.**
4. **Implémenter les tests de composants React Testing Library sur les états limites (Niveau 4).**
5. **Mettre en place Playwright et automatiser les 11 parcours E2E (Niveau 5).**
6. **Intégrer le script de benchmark reproductible dans `package.json` (`npm run bench`).**

## Tests obligatoires
- Exécution réussie des 6 niveaux de tests en environnement d'intégration continue (CI).
- Taux d'échec / flake toléré : 0%.

## Mesures de performance
- Durée totale de la suite unitaire + intégration < 60s.
- Durée de la suite E2E Playwright < 90s.

## Risques de régression
- Risque de tests E2E instables (*flaky tests*) liés aux timers ou au rendu asynchrone : mitigation par des sélecteurs sémantiques stricts (`getByRole`, `getByText`) et des attentes explicites sur signaux réseau.

## Critères d’entrée
- Phases R01 à R06 validées.

## Critères de sortie
- Les 6 niveaux de tests s'exécutent avec succès en local et sur la CI.
- Les 11 parcours critiques E2E sont couverts et validés.
- Les benchmarks confirment la tenue des performances sous 100k transactions.

## Preuves attendues
- Rapports d'exécution Vitest et Playwright (HTML / JUnit XML).
- Graphiques de benchmarks de charge comparatifs.

## Dépendances vers les autres phases
- **Bloque :** Phase R8 (Observabilité), Release finale de production.
- **Dépend de :** Phases R01, R02, R03, R04, R05, R06.

## Definition of Done
Pyramide de tests complète à 6 niveaux opérationnelle + 11 parcours E2E Playwright validés + benchmarks de performance 100k transactions verts + CI 100% verte.
