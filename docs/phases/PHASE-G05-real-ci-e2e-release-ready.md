# Phase G05 — Qualification CI Réelle, Disaster Recovery & Release Ready

## 1. Statut
`PLANIFIÉE`

## 2. Objectif
Consolider l'ensemble des garde-fous de qualité en intégrant un pipeline d'Intégration Continue (CI) complet avec conteneur PostgreSQL réel et suite Playwright E2E navigateur, et certifier l'ensemble du projet pour le statut officiel `RELEASE READY`.

## 3. Problème architectural
Le dépôt manquait d'une configuration CI automatisée complète exécutant systématiquement de véritables conteneurs de base de données relationnelle et des tests navigateurs headless hermétiques. Certaines garanties critiques reposaient sur des vérifications manuelles ou simulées en mémoire.

## 4. Constats traités
* `S3-1` : Absence de qualification PostgreSQL réelle en CI.
* `R-01` : Absence de workflow GitHub Actions officiel exhaustif.
* Clôture définitive et certification des 15 critères du contrat `RELEASE READY`.

## 5. Décisions architecturales
* **Pipeline GitHub Actions Officiel (`.github/workflows/ci.yml`) :**
  Déclenchement automatique sur chaque Push et Pull Request vers toute branche :
  1. **Lint & Formatting :** `npm run lint` (ESLint 9 strict).
  2. **Typecheck :** `tsc --noEmit` sur frontend et backend.
  3. **Unit & Domain Tests :** Vitest sur les modèles, algorithmes FIFO et mathématiques financières.
  4. **PostgreSQL Real Service Integration Tests :** Conteneur Docker PostgreSQL 16 dans le runner CI pour exécuter tous les tests d'intégration, transactions, verrous et migrations réels.
  5. **Browser E2E Tests :** Playwright Chromium exécutant les parcours complets d'authentification mockée, cockpit, réconciliation, et navigation.
  6. **Build de Production :** `npm run build` validant le bundle client et serveur.
* **Audit Documentaire Global :**
  Harmonisation intégrale de `docs/CODE_INDEX.md`, `docs/MASTERPLAN.md` et `docs/INDEX.md` avec le code source réel.

## 6. Non-objectifs
* Ne pas ajouter de tests graphiques instables.
* Ne pas contourner ou désactiver de tests en échec.

## 7. Dépendances
* Phases G01, G02, G03 et G04 validées et mergées sur `main`.

## 8. Modules concernés
* `.github/workflows/ci.yml`
* `vitest.config.ts`
* `playwright.config.ts`
* `src/e2e/*`
* `docs/INDEX.md`
* `docs/MASTERPLAN.md`
* `docs/CODE_INDEX.md`

## 9. Contrats impactés
* Pipeline CI/CD.
* Documentation canonique du projet.

## 10. Travaux à réaliser
1. Configurer le workflow GitHub Actions `.github/workflows/ci.yml` avec service PostgreSQL 16 et environnement Playwright.
2. S'assurer que tous les tests d'intégration s'exécutent de façon hermétique avec isolation des schémas.
3. Exécuter la chaîne de vérification de bout en bout et valider le passage au vert.
4. Mettre à jour la documentation canonique et déclarer le projet `RELEASE READY`.

## 11. Invariants à préserver
* 100% de la CI doit être verte avant tout merge.
* Aucune assertion critique ne doit être affaiblie.

## 12. Tests obligatoires
* **Pipeline Complet :**
  ```bash
  npm run lint
  npx tsc --noEmit
  npm test
  npm run test:e2e
  npm run build
  ```

## 13. Scénarios de régression
* Temps total d'exécution du pipeline CI maintenu sous les 5 minutes.

## 14. Critères d'entrée
* Phases G01 à G04 terminées avec succès.

## 15. Critères de sortie
* Workflow CI vert sur GitHub Actions avec service PostgreSQL réel et Playwright.
* Code index à jour sans aucun chemin fictif.
* Toutes les 15 conditions du contrat `RELEASE READY` remplies.

## 16. Preuves obligatoires
* Exécution complète et réussie de l'intégralité de la suite de tests en environnement conteneurisé.
* Rapport de conformité documentaire exhaustif.

## 17. Risques résiduels
* Aucun.

## 18. Décision release
`BLOQUANTE`
