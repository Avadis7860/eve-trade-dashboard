# Phase P04 — Grand Livre Industriel & Bill of Materials (BOM) : Jobs & Encours (WIP)

## 1. Statut
`TERMINÉE`

## 2. Objectif
Construire le Grand Livre Industriel d'EVE Trade Dashboard : suivi complet des lignes de fabrication, de réactions chimiques et de recherche (personnages et divisions de corporation), traçabilité de l'arbre des composants (Bill of Materials / BOM), modélisation des encours de production (Work-in-Progress / WIP) et corrélation exacte des frais d'installation de jobs avec les écritures du journal de portefeuille.

## 3. Contexte & Spécifications ESI Industrie
- `GET /characters/{character_id}/industry/jobs/` (Scope : `esi-industry.read_character_jobs.v1`).
- `GET /corporations/{corporation_id}/industry/jobs/` (Scope : `esi-industry.read_corporation_jobs.v1`).
Structure d'un job industriel CCP :
- `job_id` : Identifiant universel unique du job.
- `installer_id` : Personnage ayant lancé le travail.
- `facility_id` : Station PNJ ou structure Upwell hébergeant la chaîne.
- `activity_id` : Activité (1 = Manufacturing, 3 = TE Research, 4 = ME Research, 5 = Copying, 8 = Invention, 9 = Reactions).
- `blueprint_type_id`, `blueprint_location_id` : Blueprint source.
- `product_type_id` : Article produit en fin de chaîne.
- `status` : État (`active`, `paused`, `ready`, `delivered`, `cancelled`, `reverted`).
- `cost` : Frais d'installation payés au lancement du job (ISK).
- `runs` : Nombre de répétitions exécutées.
- `start_date`, `end_date`, `completed_date` : Jalons temporels UTC.

## 4. Problématique & Défis Comptables
1. **Disparition apparente des stocks (Le trou noir de la production) :**
   Lorsqu'un joueur lance un job de manufacture (ex: 50 000 Tritanium + 10 000 Pyerite pour fabriquer un Cruiser), les matières premières disparaissent instantanément des actifs (`assets`). Si le système ne suit pas les jobs, ces intrants apparaissent comme du capital évaporé ou une perte nette jusqu'à la livraison finale.
2. **Capital en cours de fabrication (Work-in-Progress - WIP) :**
   Les intrants engagés dans une chaîne active constituent du capital immobilisé en cours de transformation. Ils doivent être comptabilisés dans le patrimoine financier sous un statut propre.
3. **Frais d'installation et taxes de système :**
   Lancer un job engendre des coûts d'installation (`cost`) indexés sur le System Cost Index local et les taxes de structure. Ces frais doivent être imputés au coût de revient du lot sortant sans double comptage avec le journal de portefeuille (`industry_job_tax`).
4. **Préservation de l'architecture modulaire :**
   Les ordres de marché (`src/server/orders/`) ne gèrent que les buy/sell orders du marché public. Les intégrer avec les jobs de production violerait le principe de responsabilité unique.

## 5. Décisions Architecturales & Délégation des Responsabilités
* **Création d'un Module Dédié `src/server/industry/` :**
  - `src/server/industry/types.ts` : modèles de jobs, activités, statuts, nomenclature BOM et composants requis.
  - `src/server/industry/repository.ts` : persistance de la table dédiée `industry_jobs`.
  - `src/server/industry/service.ts` : corrélation des jobs avec les dépenses de journal, calcul des encours de production (WIP), calendrier des fins de fabrication.
  - `src/server/industry/router.ts` : endpoints REST (`/api/industry/jobs`, `/api/industry/summary`, `/api/industry/wip-capital`, `/api/industry/bom/:blueprintTypeId`).
* **Table Dédiée `industry_jobs` :**
  Schéma SQL indépendant avec indexation sur `installer_id`, `status`, `product_type_id`, et `end_date`.
* **Modélisation de l'Encours : `WIP_INVENTORY_CAPITAL` :**
  Dans le moteur de décomposition de capital (`capital`), un nouvel état est introduit :
  $$\text{Capital WIP} = \sum_{\text{jobs actifs}} \left( \text{Coût d'acquisition des intrants engagés} + \text{Frais de pose du job} \right)$$
  Cet état garantit la conservation rigoureuse de la masse monétaire pendant la durée du travail industriel.
* **Corrélation Déterministe des Frais de Pose :**
  Le champ `cost` du job est rapproché de l'écriture de journal de portefeuille correspondante (`industry_job_tax`), empêchant tout double comptage lors de la consolidation financière globale.

## 6. Non-objectifs
* Ne pas créer de simulateur d'optimisation de structure (calculateur de gréements de structure ou bonus d'ingénierie non ESI).
* Ne pas modifier le fonctionnement des ordres de marché EVE.

## 7. Dépendances
* Phase P01 (collecteur ESI industrie avec gestion du cache).
* Phase P02 (traçabilité des intrants minés éventuels).

## 8. Modules Concernés
* `src/server/industry/types.ts`
* `src/server/industry/repository.ts`
* `src/server/industry/service.ts`
* `src/server/industry/router.ts`
* `src/server/storage/schema.ts` (table `industry_jobs`)
* Tests : `src/server/industry/industry.test.ts`

## 9. Contrats Impactés
* `DOMAIN_CONTRACTS.md` : définition formelle du statut de capital `WIP_INVENTORY_CAPITAL` et du cycle de vie des jobs.
* `METRICS.md` : formule de valorisation des encours industriels et agrégation des frais de pose.

## 10. Critères d'Acceptation & Qualification
* [x] Les jobs de personnages et de corporations sont collectés, typés et persistés avec succès.
* [x] Les matières engagées dans un job en cours sont valorisées et présentées sous l'état `WIP_INVENTORY_CAPITAL`.
* [x] Les frais d'installation de job sont corrélés avec les débits de portefeuille sans double comptage.
* [x] La suite de tests `src/server/industry/industry.test.ts` prouve la réconciliation d'un job de fabrication de bout en bout (lancement -> WIP -> livraison).
