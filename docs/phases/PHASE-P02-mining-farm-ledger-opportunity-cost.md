# Phase P02 — Registre Minier & Coûts d'Opportunité Farm / Mining

## 1. Statut
`PLANIFIÉE`

## 2. Objectif
Ingérer et structurer les données d'extraction de ressources (`GET /characters/{character_id}/mining/`) dans un module dédié et résoudre la règle comptable fondamentale d'EVE Online : **les matières premières farmées ou minées ne coûtent jamais 0.00 ISK**. Établir une comptabilisation hermétique distinguant la trésorerie décaissée (nulle) du coût d'opportunité économique d'extraction (`ESTIMATED_EXTRACTION_VALUE`), sans polluer le Grand Livre de trésorerie (`ledger`).

## 3. Contexte & Spécification ESI Minage
Route CCP : `GET /characters/{character_id}/mining/` (Scope : `esi-industry.read_character_mining.v1`).
Structure d'une entrée ESI brute :
- `date` : Date UTC de l'extraction (`YYYY-MM-DD`).
- `solar_system_id` : Système stellaire où l'extraction a eu lieu.
- `type_id` : Identifiant du minerai ou gaz extrait (ex: Veldspar, Scordite, Mercoxit, Fullero-gas).
- `quantity` : Volume unitaire extrait.

## 4. Problématique & Règle d'Or Comptable
1. **L'illusion du « minerai gratuit » :**
   Dans de nombreux outils amateurs, les minerais extraits par le joueur sont comptabilisés à $0.00\text{ ISK}$ au prétexte qu'aucun achat de marché n'a été exécuté. Cette erreur fausse gravement l'analyse financière :
   - Elle gonfle artificiellement le retour sur investissement ($ROI = +\infty$).
   - Elle dissimule la rentabilité réelle de l'arbitrage commercial par rapport au simple fait de vendre le minerai brut sur le marché local.
2. **Double réalité économique :**
   - **Flux de trésorerie (Cash-flow)** : Le joueur n'a déboursé aucun ISK liquide de son portefeuille personnel pour acquérir le minerai brut.
   - **Coût d'opportunité (Opportunity cost)** : Le minerai extrait possède une valeur marchande intrinsèque immédiate. L'engager dans une chaîne de raffinage ou de fabrication sans imputer cette valeur détruit de la valeur économique invisible.
3. **Risque de pollution du Grand Livre (`ledger`) :**
   Mélanger les extractions physiques journalières dans la table `transactions` (qui représente des échanges monétaires réels avec taxes et contreparties) briserait l'intégrité de la réconciliation fiscale et du grand livre général.

## 5. Décisions Architecturales & Délégation des Responsabilités
* **Création d'un Module Dédié `src/server/mining/` :**
  Pour respecter le principe de responsabilité unique, toute la logique du minage et du farm est isolée dans un module autonome :
  - `src/server/mining/types.ts` : modèles et statuts de provenance.
  - `src/server/mining/repository.ts` : persistance de la table dédiée `mining_ledger`.
  - `src/server/mining/service.ts` : calcul des volumes, valorisation d'extraction et intégration avec les hubs.
  - `src/server/mining/router.ts` : endpoints REST (`/api/mining/ledger`, `/api/mining/summary`, `/api/mining/opportunity-costs`).
* **Table Dédiée `mining_ledger` :**
  Schéma SQL indépendant :
  ```sql
  CREATE TABLE mining_ledger (
    id SERIAL PRIMARY KEY,
    character_id BIGINT NOT NULL,
    date DATE NOT NULL,
    solar_system_id INT NOT NULL,
    type_id INT NOT NULL,
    quantity BIGINT NOT NULL,
    estimated_unit_value NUMERIC(18, 4),
    opportunity_cost_isk NUMERIC(18, 4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_mining_entry UNIQUE (character_id, date, solar_system_id, type_id)
  );
  ```
* **Contrat de Provenance `FARMED_PROVENANCE` :**
  Les stocks de minerais ou matières issues du minage portent impérativement le marquage d'origine :
  - `provenance: 'FARMED'` (distinct de `'MARKET_PURCHASE'` et `'OPENING_BALANCE'`).
* **Double Valorisation Hermétique :**
  Chaque lot farmé expose explicitement :
  1. `realized_cash_cost_isk = 0.00 ISK` : coût comptable décaissé (cash outflow).
  2. `opportunity_cost_isk = quantity * estimated_unit_value` : coût d'opportunité basé sur le prix moyen observé au hub le plus proche ou référence d'estimation EVE.
* **Ségrégation des Métriques de Rentabilité :**
  - **ROI Commercial Pur** : calculé sur la base de la valeur d'opportunité des entrants ($\text{Prix Vente} - \text{Coût d'Opportunité} - \text{Taxes}$).
  - **Marge de Farm Globale** : calculée sur la trésorerie brute générée par le temps de jeu ($\text{Prix Vente} - \text{Taxes}$).

## 6. Non-objectifs
* Ne pas créer d'alertes de minage temps réel en jeu.
* Ne pas tracer les consommations de charges (mining crystals, drones perdus, carburant) sauf si déclarées explicitement.

## 7. Dépendances
* Phase P01 (collecteur ESI mining validé).

## 8. Modules Concernés
* `src/server/mining/types.ts`
* `src/server/mining/repository.ts`
* `src/server/mining/service.ts`
* `src/server/mining/router.ts`
* `src/server/storage/schema.ts` (migration SQL DDL pour `mining_ledger`)
* Tests : `src/server/mining/mining.test.ts`

## 9. Contrats Impactés
* `DOMAIN_CONTRACTS.md` : ajout de la clause d'invariance des matières farmées et définition de `FARMED_PROVENANCE`.
* `METRICS.md` : formalisation mathématique de `ESTIMATED_EXTRACTION_VALUE` et de la rentabilité duale (Cash vs Opportunité).

## 10. Critères d'Acceptation & Qualification
* [ ] Le journal d'extraction est ingéré et persisté de façon idempotente sans doublons pour tous les personnages de la flotte.
* [ ] Aucun lot farmé n'est injecté avec un coût d'opportunité indéfini ou coercé silencieusement à 0.00 ISK sans statut `UNKNOWN`.
* [ ] Le module `src/server/mining/` fonctionne de manière autonome sans importer ni modifier la table `transactions`.
* [ ] La suite de tests `src/server/mining/mining.test.ts` valide la conservation stricte des deux dimensions (trésorerie vs opportunité).
