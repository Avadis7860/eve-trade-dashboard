# Phase P03 — Colonies Planétaires & Flux de Matières PI

## 1. Statut
`TERMINÉE`

## 2. Objectif
Modéliser l'infrastructure industrielle planétaire (Planetary Interaction / PI) pour chaque personnage de la flotte : extraction de matières premières P0, transformation en P1/P2/P3/P4, inventaire immobilisé dans les spatioports et silos planétaires, cadences horaires de production et prise en compte des taxes de douanes des bureaux de douane (POCO - Planetary Customs Offices).

## 3. Contexte & Spécifications ESI
- `GET /characters/{character_id}/planets/` : liste sommaire des planètes exploitées (planet_id, planet_type, solar_system_id, upgrade_level, num_pins, last_update).
- `GET /characters/{character_id}/planets/{planet_id}/` : graphe complet des installations de la colonie planétaire :
  - `pins` : extracteurs (heads, cycle_time, product_type_id), usines de transformation (schematic_id, cycle_time), silos de stockage (`contents`), spatioports (`contents`), liens de commande (command center).
  - `routes` : acheminement des matières entre pins (source_pin_id, destination_pin_id, content_type_id, quantity).
  - `links` : liaisons réseau et bande passante utilisée.
- Scope douanier : `esi-planets.read_customs_offices.v1` pour les taux de taxe des bureaux de douane en orbite (POCO).

## 4. Problématique & Défis Métier
1. **Capital physique invisible :**
   Les stocks de matériaux planétaires (P0 à P4) situés dans les silos et spatioports des planètes ne figurent pas dans la route standard des actifs (`/characters/{id}/assets`). Ils représentent pourtant des millions (voire milliards) d'ISK de capital immobilisé souvent ignoré des bilans de patrimoine.
2. **Dynamisme des cadences horaires :**
   Contrairement à un stock statique en station, une colonie PI est une machine vivante : les têtes d'extraction s'épuisent progressivement, les usines consomment des intrants toutes les heures et créent des extrants.
3. **Frais douaniers d'exportation/importation :**
   Le transfert de matériaux entre la surface de la planète et l'espace passe par le bureau de douane orbital (POCO). Les taxes d'exportation perçues par la corporation gestionnaire du POCO et la taxe SCC doivent être imputées au coût de revient des lots exportés.
4. **Prévention de la surcharge de module :**
   Le module `src/server/assets/` est conçu pour les conteneurs et stations de la flotte. Intégrer les pins planétaires, schémas de fabrication et liens de routage dans `assets` surchargerait ce module critique.

## 5. Décisions Architecturales & Délégation des Responsabilités
* **Création d'un Module Dédié `src/server/pi/` :**
  - `src/server/pi/types.ts` : interfaces pour colonies, pins (extracteur, usine, silo, spatioport), routes, cadences et taxes POCO.
  - `src/server/pi/repository.ts` : persistance durable des états de colonie (`pi_colonies`, `pi_pins`, `pi_routes`).
  - `src/server/pi/service.ts` : calcul des volumes en stock, des taux d'extraction par heure, de l'épuisement prévisionnel des silos et de la valorisation de revient des matières stockées.
  - `src/server/pi/router.ts` : exposition API (`/api/pi/colonies`, `/api/pi/colonies/:id`, `/api/pi/stocks`, `/api/pi/production-rates`).
* **Nouvel État de Capital Physique : `PLANETARY_COLONY_STOCK` :**
  Dans le domaine de gestion du capital (`DOMAIN_CONTRACTS.md`), les volumes situés en pins et spatioports sont classés sous un état mutuellement exclusif `PLANETARY_COLONY_STOCK`, distinct de `FREE_HUB_STOCK`, `COMMITTED_SELL_ORDER`, et `IN_TRANSIT_STOCK`.
* **Imputation des Taxes Douanières POCO :**
  Les taxes prélevées lors des lancements en orbite (journal de portefeuille `planetary_export_tax`) sont reliées aux lots exportés pour être intégrées déterministement au coût de base du matériau P1-P4 récupéré.
* **Intégration Faiblement Couplée avec le Capital :**
  Le service `src/server/capital/service.ts` interroge `PiRepository.getAggregatedStocksByCharacter()` sans dépendre de la logique interne des pins ou des routes.

## 6. Non-objectifs
* Ne pas concevoir d'outil d'optimisation de placement géométrique des extracteurs sur la sphère planétaire.
* Ne pas automatiser la relance des extracteurs (strictement interdit par les conditions d'utilisation CCP).

## 7. Dépendances
* Phase P01 (collecteur ESI PI avec régulation de débit et cache 15 min).

## 8. Modules Concernés
* `src/server/pi/types.ts`
* `src/server/pi/repository.ts`
* `src/server/pi/service.ts`
* `src/server/pi/router.ts`
* `src/server/storage/schema.ts` (tables `pi_colonies`, `pi_pins`)
* Tests : `src/server/pi/pi.test.ts`

## 9. Contrats Impactés
* `DOMAIN_CONTRACTS.md` : spécification de l'état d'actif `PLANETARY_COLONY_STOCK`.
* `METRICS.md` : formule de valorisation des stocks planétaires et décomposition des cadences de flux horaire ($m^3/\text{heure}$, $\text{ISK}/\text{jour}$).

## 10. Critères d'Acceptation & Qualification
* [x] Toutes les colonies et tous les pins d'une flotte de 11 personnages sont modélisés et mis à jour sous respect du cache.
* [x] Les stocks contenus dans les silos et spatioports sont correctement quantifiés et valorisés sans doublon avec les actifs de station.
* [x] La décomposition du capital intègre la valeur notionnelle et le coût des stocks planétaires sous `PLANETARY_COLONY_STOCK`.
* [x] La suite de tests `src/server/pi/pi.test.ts` valide le calcul des cadences et l'imputation des taxes de douane POCO.
