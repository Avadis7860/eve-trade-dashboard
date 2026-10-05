# ROADMAP OFFICIELLE DE FIABILISATION — POST F01–F11

---

## 1. Verdict documentaire

L'état consolidé du projet **EVE Trade Dashboard** (`Avadis7860/eve-trade-dashboard`) après les cycles de développement 00–12 et F01–F11 démontre une excellente maturité des règles de calcul financier (FIFO, réconciliation TTC, multi-personnages, isolation des scopes). 

Cependant, les audits contradictoires approfondis ont révélé que le passage en **production réelle** présentait des vulnérabilités structurelles et des risques de cohérence :
1. **Sécurité d'exécution :** Endpoints E2E/test potentiellement montés en production, absence d'exigence absolue sur la clé de chiffrement `SESSION_ENCRYPTION_KEY`, et risque d'emballement des refresh tokens OAuth concurrents.
2. **Dualité de persistance & Bootstrap :** Coexistence risquée de chemins mémoire et PostgreSQL créant un risque de double vérité, combinée à un démarrage HTTP synchrone qui n'attendait pas l'achèvement des migrations et de l'initialisation des pools.
3. **Concurrence & Distribution :** Risque de concurrence non maîtrisée sur les synchronisations ESI inter-instances (absence de verrou distribué fiable sans bloquer les connexions sous advisory lock xact).
4. **Intégrité Corporation & Backup :** Schéma corporation risquant de dériver entre événement économique et identité d'observateur, avec risque de perte ou duplication lors des exports/restaurations.
5. **Preuves & CI Réelle :** Absence de pipeline CI automatisé exécutant systématiquement un véritable moteur PostgreSQL et les tests E2E Playwright navigateur.

Le présent document constitue la **source de vérité canonique** pour la suite du projet. Il transforme l'intégralité des constats d'audit en une roadmap opérationnelle de 5 phases majeures (**G01 à G05**), bornées, testables et directement traduisibles en issues/branches GitHub.

---

## 2. Décisions architecturales définitives

Les arbitrages suivants sont désormais fermes, définitifs et font autorité sur l'ensemble de la base de code :

### 2.1 Source de vérité unique : PostgreSQL
* Dès lors que `DATABASE_URL` est configurée, **PostgreSQL est l'unique source de vérité persistante**.
* Les repositories ne maintiennent aucun état métier parallèle ou silencieux en mémoire susceptible de diverger de la base de données.
* Tout état en mémoire est strictement qualifié en tant que cache d'accès, buffer de batch ou projection volatile, et ne doit jamais masquer un échec d'écriture SQL.
* Aucun fallback silencieux « PostgreSQL échoue $\rightarrow$ on continue en mémoire » n'est toléré en production.

### 2.2 Bootstrap asynchrone ordonnancé
* Le cycle de vie du serveur applicatif suit une séquence de bootstrap asynchrone déterministe et bloquante :
  $$\text{Configuration} \longrightarrow \text{Connexion Adapter} \longrightarrow \text{Migrations SQL} \longrightarrow \text{Session Store} \longrightarrow \text{Repositories Ready} \longrightarrow \text{Readiness Probe = true} \longrightarrow \text{app.listen()}$$
* Le serveur HTTP n'ouvre son port de trafic applicatif qu'une fois la totalité des migrations appliquées et les stores vérifiés.
* En cas d'échec d'une étape de démarrage, le processus s'arrête immédiatement avec un code d'erreur non nul (Fail-Fast).

### 2.3 Herméticité absolue des routes E2E / Test
* Les routes de mock, injection d'état et reset E2E sont **physiquement exclues du routage** lorsque `NODE_ENV === 'production'`.
* Aucune variable d'environnement (ex: `ENABLE_E2E_TEST_ROUTES=true`) ne peut contourner cette interdiction en production.
* En production, toute requête vers ces endpoints retourne obligatoirement `404 Not Found`.

### 2.4 Clé cryptographique obligatoire en production
* En environnement de production (`NODE_ENV === 'production'`), la présence de `SESSION_ENCRYPTION_KEY` valide (32 octets hexadécimaux / 256 bits) est un prérequis strict au démarrage.
* Tout fallback vers un secret par défaut, une chaîne hardcodée ou une substitution implicite provoque l'arrêt immédiat du serveur.

### 2.5 Single-Flight OAuth hybride (Processus + Distribué)
* Pour une même identité logique (même `characterId`), les demandes concurrentes de rafraîchissement de token OAuth sont coalescées au niveau local via une `Promise Map` (évitant les requêtes en double dans le même processus).
* Au niveau multi-instances, la coordination s'effectue via un verrou logique ou un lease PostgreSQL horodaté avec TTL court, garantissant qu'un seul worker n'invalide et ne renouvelle le refresh token auprès de CCP SSO.

### 2.6 Verrouillage distribué ESI via Lease PostgreSQL
* Aucun middleware lourd externe (Redis, Kafka, RabbitMQ) n'est introduit.
* La coordination de synchronisation ESI utilise un mécanisme de **Lease PostgreSQL horodaté** dans une table dédiée `esi_sync_leases` (ou advisory lock de session avec heartbeat et libération garantie dans un bloc `finally`), évitant de maintenir une transaction SQL ouverte (`pg_try_advisory_xact_lock`) pendant la durée d'appels HTTP ESI potentiellement lents ou paginés.
* Chaque lease possède un propriétaire (`instance_id`), une date d'acquisition, un TTL d'expiration et un mécanisme de libération explicite.

### 2.7 Séparation stricte Corporation : Événement vs Observateur
* Un événement économique de corporation possède une identité canonique unique et immuable :
  $$\text{Key} = \text{corp:}\{\text{corporationId}\}:\{\text{division}\}:\{\text{journalId}\}$$
* L'identité du personnage directeur ayant observé la ligne lors du crawl ESI constitue une métadonnée d'observation et ne doit jamais dupliquer l'enregistrement financier.

---

## 3. Constats conservés

| Réf. | Intitulé | Sévérité Initiale | Sévérité Retenue | Description |
|---|---|---|---|---|
| **S0-1** | Routes E2E exposées en production | S0 | **S0** | Endpoints de test E2E (`/api/test/*`) accessibles si une variable est mal positionnée. |
| **S0-2** | Dualité de persistance mémoire / PostgreSQL | S0 | **S0** | Risque de désynchronisation entre mémoire locale et tables SQL lors des mutations. |
| **S0-3** | Schéma & déduplication corporation incomplets | S0 | **S0** | Risque d'écrasement ou de duplication d'événements de journal corp observés par plusieurs directeurs. |
| **S1-1** | Écritures PostgreSQL non attendues (Fire-and-forget) | S1 | **S1** | Appels d'écritures SQL lancés sans `await`, masquant les erreurs et causant des désynchronisations. |
| **S1-2** | Fallback de clé cryptographique en production | S1 | **S1** | Présence d'une clé de secours par défaut affaiblissant le chiffrement des sessions en prod. |
| **S1-3** | Absence de single-flight OAuth inter-instances | S1 | **S1** | Risque de course lors du refresh de token sous forte concurrence menant à la révocation du refresh token CCP. |
| **S1-4** | Absence de verrou distribué ESI inter-instances | S1 | **S1** | Plusieurs instances peuvent déclencher simultanément les mêmes crawls ESI et saturer le rate-limiter CCP. |
| **S2-1** | Healthcheck & Probes insuffisants | S2 | **S2** | L'endpoint `/health` ne vérifie pas la connectivité DB ni l'état de préparation du bootstrap. |
| **S2-2** | Absence de snapshot temporel & restauration atomique | S2 | **S2** | Sauvegardes partielles risquant de restaurer un état financier désynchronisé. |
| **S3-1** | Tests PostgreSQL exécutés sur simulateur en CI | S3 | **S1** | Les tests d'intégration CI utilisaient des mocks ou `pg-mem` sans valider les vraies contraintes PostgreSQL. |

---

## 4. Constats requalifiés

| Réf. | Intitulé Initial | Qualification Initiale | Qualification Finale | Justification & Analyse Réelle du Code |
|---|---|---|---|---|
| **R-04** | Faiblesse du contrôle CSRF sur Origins malformés | S1 | **REQUALIFIÉ (Mineur / Conforme)** | Le code existant (`security.ts`) rejette déjà les requêtes avec `Origin` invalide lorsque les en-têtes personnalisés sont absents. Un audit approfondi démontre que l'architecture à base d'en-têtes personnalisés (`X-Requested-With` / JWT Bearer) protège adéquatement contre les attaques CSRF cross-origin traditionnelles sur navigateurs modernes. |
| **R-05** | Risque de saturation du pool PostgreSQL (20 connexions) | S1 | **REQUALIFIÉ (Risque de charge à calibrer)** | La limite de 20 connexions n'est pas un bogue mais un paramètre de dimensionnement standard pour Node.js. Une modification arbitraire sans métriques sous charge risquerait d'épuiser les ressources de la base. Requalifié en jalon de calibration de charge dans G04/G05. |
| **R-06** | Désynchronisation de `activeCharacterId` | S2 | **REQUALIFIÉ (Intégrité de Session G01)** | Le basculement de personnage actif est déjà géré dans le session store persistant mais doit être protégé contre les écritures concurrentes de session dans le cadre de G01. |

---

## 5. Nouveaux risques retenus

| Réf. | Intitulé | Sévérité | Description |
|---|---|---|---|
| **R-01** | Absence de workflow CI GitHub Actions exhaustif | **S1** | Nécessité d'un fichier `.github/workflows/ci.yml` exécutant le lint, le typecheck, les tests unitaires, les tests d'intégration sur un conteneur PostgreSQL réel et les tests E2E Playwright. |
| **R-02** | Risque de filtrage incomplet des événements corporation dans les backups | **S1** | Risque qu'un export de données utilisateur n'inclue pas les événements économiques partagés ou les déduplique mal lors de la réimportation. |
| **R-03** | Démarrage synchrone du serveur avant complétude des migrations | **S0** | `server.ts` démarre l'écoute HTTP sans attendre la résolution des promesses d'initialisation de la base de données. |

---

## 6. Roadmap des phases finales

| Phase | Intitulé Officiel | Priorité | Dépendances | Bloquante Release |
|---|---|---|---|---|
| **G01** | [Sécurité de Production & Intégrité Authentification](phases/PHASE-G01-security-auth-integrity.md) | Critique (S0) | Post F01–F11 | **OUI** |
| **G02** | [Persistance PostgreSQL Unique & Bootstrap Asynchrone](phases/PHASE-G02-postgres-single-source-bootstrap.md) | Critique (S0) | G01 | **OUI** |
| **G03** | [Concurrence Distribuée & Synchronisation ESI](phases/PHASE-G03-distributed-esi-sync-leases.md) | Majeure (S1) | G02 | **OUI** |
| **G04** | [Cohérence Opérationnelle, Backup & Observabilité](phases/PHASE-G04-corp-deduplication-backup-probes.md) | Majeure (S1) | G02, G03 | **OUI** |
| **G05** | [Qualification CI Réelle, Disaster Recovery & Release Ready](phases/PHASE-G05-real-ci-e2e-release-ready.md) | Majeure (S1) | G01–G04 | **OUI** |

---

## 7. Graphe des dépendances & Ordre d'exécution

```
                      ┌────────────────────────────────────────────────────────┐
                      │ G01 : Sécurité Production & Intégrité Authentification │
                      └───────────────────────────┬────────────────────────────┘
                                                  │
                                                  ▼
                      ┌────────────────────────────────────────────────────────┐
                      │ G02 : Persistance PostgreSQL Unique & Bootstrap Async  │
                      └───────────────────────────┬────────────────────────────┘
                                                  │
                                 ┌────────────────┴────────────────┐
                                 ▼                                 ▼
         ┌──────────────────────────────────────┐ ┌──────────────────────────────────────┐
         │ G03 : Concurrence Distribuée ESI     │ │ G04 : Cohérence Corp, Backup & Probes│
         └───────────────────────┬──────────────┘ └────────────────┬─────────────────────┘
                                 │                                 │
                                 └────────────────┬────────────────┘
                                                  │
                                                  ▼
                      ┌────────────────────────────────────────────────────────┐
                      │ G05 : Qualification CI Réelle, DR Drill & Release Ready│
                      └────────────────────────────────────────────────────────┘
```

---

## 8. Matrice Constats → Phases

| Constat | Phase Assignée | Traitement Technique | Type de Test | Preuve Finale Validante | Bloquant |
|---|---|---|---|---|---|
| **S0-1** (Routes E2E prod) | **G01** | Exclusion inconditionnelle du routeur si `NODE_ENV === 'production'` | Intégration HTTP | Requête HTTP en mode prod $\rightarrow$ `404 Not Found` | **OUI** |
| **S0-2** (Dualité mémoire/SQL) | **G02** | Suppression des stores mémoire parallèles en mode PostgreSQL | Intégration SQL & Restart | Redémarrage du serveur avec persistance bit-à-bit vérifiée | **OUI** |
| **S0-3** (Schéma & dédup corpo) | **G04** | Clé composite canonique `(corp_id, div, journal_id)` et déduplication | Intégration multi-directeurs | Ingestion concurrente par 2 directeurs $\rightarrow$ 1 seule ligne | **OUI** |
| **S1-1** (Écritures non attendues) | **G02** | Encapsulation `await` et transactions ACID sur tous les repositories | Intégration SQL | Test d'interruption/rollback en cas d'erreur de transaction | **OUI** |
| **S1-2** (Fallback clé session) | **G01** | Fail-fast strict au démarrage si `SESSION_ENCRYPTION_KEY` manque en prod | Unitaire & Démarrage | Crash immédiat du process avec exit code 1 sans clé | **OUI** |
| **S1-3** (Single-flight OAuth) | **G01** | Coalescence locale Promise Map + verrou distribué de rafraîchissement | Concurrence multi-requêtes | 50 requêtes simultanées $\rightarrow$ 1 seul refresh CCP exécuté | **OUI** |
| **S1-4** (Verrou distribué ESI) | **G03** | Table `esi_sync_leases` horodatée avec TTL et libération garantie | Concurrence & Crash | Reprise de lease après crash sans blocage transactionnel | **OUI** |
| **S2-1** (Healthcheck & Probes) | **G04** | Implémentation `/health/live` et `/health/ready` avec check DB | Intégration Système | Coupure DB $\rightarrow$ `/health/ready` répond `503` | **OUI** |
| **S2-2** (Snapshot atomique) | **G04** | Export/import transactionnel avec somme de contrôle SHA-256 | Disaster Recovery | DR drill complet avec vérification de parité financière | **OUI** |
| **S3-1** (CI Postgres réelle) | **G05** | Intégration conteneur PostgreSQL 16 dans le pipeline CI | Pipeline CI | Exécution des tests d'intégration sur vrai serveur PostgreSQL | **OUI** |
| **R-01** (Absence workflow CI) | **G05** | Création de `.github/workflows/ci.yml` multi-jobs complet | CI GitHub Actions | Build & Tests verts sur runner distant | **OUI** |
| **R-02** (Backup données corpo) | **G04** | Inclusion des entités corpo dédupliquées dans le format de backup | Intégration Backup | Export/import corpo avec intégrité des liens conservée | **OUI** |
| **R-03** (Bootstrap bloquant) | **G02** | `bootstrapApp()` asynchrone achevé avant `app.listen()` | Unitaire & Système | Logs de démarrage démontrant l'ordre strict des promesses | **OUI** |
| **R-04** (Contrôle CSRF/Origin) | **G01** | Requalification et audit exhaustif des en-têtes et CORS | Sécurité HTTP | Rejet des requêtes cross-site sans en-tête custom | **OUI** |
| **R-05** (Pool PostgreSQL) | **G04** | Qualification sous charge des 20 connexions | Benchmark de charge | Rapport de saturation confirmant l'absence de starvation | **OUI** |
| **R-06** (Session active character)| **G01** | Mutation atomique de session et isolation des contextes | Concurrence Session | Bascule concurrente de personnages sans écrasement | **OUI** |

---

## 9. Matrice Phases → Tests

| Phase | Test Unitaire | Test Intégration | Test Concurrence | Test Restart | Test E2E Navigateur | Test CI Réel (Docker Postgres) |
|---|---|---|---|---|---|---|
| **G01** | Chiffrement & clés | Routes HTTP & 404 prod | 50 refresh OAuth simultanés | — | Connexion SSO & bascule perso | Oui |
| **G02** | Rollback transactions | CRUD complet repositories | Écritures simultanées | Arrêt/Relance serveur avec vérification données | Navigation & persistance | Oui |
| **G03** | Gestion baux/leases | Cycle ESI complet | 10 syncs simultanées sur même entité | Reprise après crash worker | Déclenchement sync depuis UI | Oui |
| **G04** | Checksums SHA-256 | Sondes /health & Corp deduplication | Ingestion multi-directeurs | DR Drill (Restoration complète) | Export & Import depuis l'UI | Oui |
| **G05** | Lint & Typecheck | Suite intégration complète | Suite concurrence complète | Validation globale | Parcours complets Playwright | **Oui (Pipeline Complet)** |

---

## 10. Matrice Phases → Preuves

| Phase | Intitulé | Preuve Formelle Exigée pour Validation |
|---|---|---|
| **G01** | Sécurité Production | 1. Exécution de test HTTP simulant `NODE_ENV=production` confirmant `404` sur `/api/test/*`.<br>2. Log de démarrage attestant le crash immédiat si clé absente en prod.<br>3. Log de mock CCP prouvant l'appel unique lors de 50 rafraîchissements concurrents. |
| **G02** | Persistance Unique | 1. Validation de l'absence totale de structures mémoire parallèles en mode PostgreSQL.<br>2. Rapport de test de redémarrage prouvant l'intégrité intégrale des données dans PostgreSQL.<br>3. Logs de bootstrap séquentiel `DB -> Migrations -> Store -> Listen`. |
| **G03** | Concurrence Distribuée | 1. Trace de journalisation SQL montrant l'acquisition d'un lease unique et le rejet propre des requêtes concurrentes.<br>2. Test de simulation de crash validant l'expiration automatique et la libération du lease. |
| **G04** | Cohérence & Backup | 1. Base PostgreSQL de test : insertion par 2 directeurs d'un même journal ESI débouchant sur 1 seul enregistrement économique.<br>2. Rapport de DR Drill comparant avant/après restauration avec delta financier strictement égal à `0.00 ISK`.<br>3. Rapport de sondes `/health/ready` avec coupure réseau simulée. |
| **G05** | CI Réelle & Release | 1. Pipeline GitHub Actions vert sur l'ensemble de la matrice (Lint, Typecheck, Unit, Postgres Integration, Playwright E2E, Build).<br>2. `docs/CODE_INDEX.md` strictement synchronisé avec l'arborescence réelle du dépôt. |

---

## 11. Contrat RELEASE READY

L'application **EVE Trade Dashboard** sera officiellement déclarée `RELEASE READY` **uniquement et obligatoirement** lorsque l'intégralité des 15 conditions ci-dessous seront prouvées :

1. **Phases G terminées :** Les phases G01, G02, G03, G04 et G05 sont mergées sur `main` avec leurs critères de sortie respectés.
2. **Preuves disponibles :** Toutes les preuves formelles (journaux, tests de concurrence, rapports de DR) sont enregistrées et vérifiables.
3. **CI Réelle Verte :** Le workflow GitHub Actions s'exécute avec succès sur `main` sans aucun contournement (`skip`, `only`, `any`).
4. **PostgreSQL Réel Qualifié :** 100% des tests d'intégration sont exécutés sur une instance PostgreSQL réelle.
5. **Migrations Validées :** Les migrations de schéma s'appliquent de façon strictement idempotente au démarrage.
6. **Persistance Post-Redémarrage Prouvée :** L'arrêt et la relance du serveur ne provoquent aucune perte ni corruption de données.
7. **Identité Corporation Dédupliquée :** $N$ directeurs synchronisant la même corporation ne créent aucun doublon économique.
8. **Herméticité des Routes de Test :** Les routes `/api/test/*` sont physiquement inaccessibles (`404`) en mode production.
9. **Cryptographie sans Fallback :** La clé de session de production est obligatoire et validée au bootstrap.
10. **Single-Flight OAuth Opérationnel :** Zéro révocation ou collision de refresh token sous appels concurrents.
11. **Synchronisation ESI Distribuée Maîtrisée :** Le système de baux PostgreSQL prévient tout crawl concurrent d'une même entité.
12. **Vérité des États Préservée :** Les statuts `PARTIAL`, `ERROR`, `UNKNOWN`, `ABSENT` ne sont jamais assimilés à `0` ou `COMPLETE`.
13. **Invariance Financière Démontrée :** Les calculs FIFO, TTC, taxes et frais de courtage sont prouvés identiques avant et après restauration.
14. **Disaster Recovery Démontré :** La procédure de sauvegarde/restauration SHA-256 est testée et validée sans divergence.
15. **Documentation Rigoureusement Synchronisée :** `docs/CODE_INDEX.md` et les contrats reflètent exactement le code réel de `main`.
