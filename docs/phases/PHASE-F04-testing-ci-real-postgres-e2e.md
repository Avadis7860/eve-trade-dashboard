# Phase F04 — Preuves de Qualification Réelles : PostgreSQL CI & Tests E2E Navigateur

## 1. Contexte & Problématique
L'audit technique post-Phase 12 a mis en évidence des lacunes dans la chaîne de preuve automatisée :
1. **Tests PostgreSQL simulés (S1-5) :** Le fichier `src/server/storage/postgres.test.ts` utilise un mock JavaScript en mémoire (`MockPostgresDatabaseAdapter`). Les requêtes SQL réelles, les index, les contraintes d'unicité et les transactions ACID PostgreSQL ne sont pas validées contre un véritable moteur de base de données en CI.
2. **Absence de vrais tests E2E Playwright (S2-1) :** Les tests nommés "E2E" dans `src/e2e/e2e_journeys.test.ts` sont des tests HTTP Supertest sous Node.js. Aucun test ne valide le cycle de vie des composants React 19, les formulaires, le SideDrawer, les modales Product 360 ou la réactivité des filtres dans un véritable navigateur.

## 2. Objectifs & Périmètre
- Mettre en place un banc d'intégration PostgreSQL réel (via conteneur Docker / service PostgreSQL en CI ou suite conditionnelle) exécutant les 15 tests de persistance et de migrations sur une véritable base PostgreSQL 16+.
- Intégrer `@playwright/test` et configurer une suite de tests End-to-End réelle exécutant un navigateur Chromium headless pour valider les parcours utilisateurs critiques :
  - Connexion SSO simulée et affichage du Cockpit
  - Consultation et filtrage des Positions de capital
  - Ouverture de la fiche Product 360 et interaction avec les graphiques
  - Génération et copie d'une liste EVE Multibuy dans le presse-papier
  - Configuration des Hubs et ajout d'un stock d'ouverture avec justification
- Intégrer ces contrôles dans le pipeline CI sans dégrader les temps d'exécution nominaux (séparation `npm test` unitaire / `npm run test:integration` / `npm run test:e2e`).

## 3. Fichiers & Modules Concernés
- `package.json`
- `vitest.config.ts`
- `playwright.config.ts` (nouveau)
- `src/server/storage/postgres.real.test.ts` (nouveau ou complété)
- `src/e2e/browser/*.spec.ts` (nouveaux tests Playwright)
- `.github/workflows/ci.yml` (configuration du pipeline)
- `docs/TESTING_CI.md`

## 4. Modifications Conceptuelles & Règles Techniques
1. **Conteneur PostgreSQL en CI :**
   La CI doit lancer un service PostgreSQL avec variables d'environnement `DATABASE_URL=postgres://user:password@localhost:5432/eve_trade_test`.
2. **Parcours E2E Playwright :**
   Les tests doivent vérifier l'accessibilité DOM, l'absence d'erreurs dans la console navigateur (`console.error`), le comportement des états `FRESH`, `STALE`, `PARTIAL`, `ERROR` et l'affichage des preuves arithmétiques dans l'UI.
3. **Benchmarks Déterministes :**
   Validation du seuil de performance : 50 000 transactions indexées requêtées en moins de 50ms sur instance PostgreSQL réelle.

## 5. Tests Obligatoires & Scénarios de Validation
- [ ] Exécution réussie de `npm run test:integration` avec migration complète et rollback ACID sur base PostgreSQL réelle.
- [ ] Exécution réussie des 11 parcours utilisateurs dans Chromium via `npx playwright test`.
- [ ] Test d'intégrité de l'export CSV et de la chaîne de texte générée pour EVE Multibuy dans le presse-papier.
- [ ] Vérification que la CI exécute typecheck, lint, tests unitaires, intégration SQL et E2E avant tout merge.

## 6. Critères d'Entrée & de Sortie
- **Entrée :** Validation et merge de la Phase F03. Branche dédiée `feature/F04-testing-ci-real-postgres-e2e`.
- **Sortie :**
  - Vraie base PostgreSQL testée avec 100% de succès.
  - Vrais tests Playwright opérationnels et intégrés à la CI.
  - Documentation `docs/TESTING_CI.md` et `docs/CODE_INDEX.md` actualisées.
  - Feuille de route prête pour l'ouverture de la Phase H03.
