# Phase P01 — Ingestion ESI Dédiée & Régulation Débit : PI, Industrie & Minage

## 1. Statut
`TERMINÉE`

## 2. Objectif
Mettre en place la couche d'acquisition ESI hautement résiliente pour les nouvelles routes officielles CCP requises par Planetary Interaction (PI), l'Industrie et le Minage/Farm, en éliminant tout risque d'épuisement du budget d'erreur (`X-ESI-Error-Limit-Remain`) via un pool de sous-lots borné et un cache HTTP strict (`Expires` / `304 Not Modified`), sans surcharger les modules centraux existants.

## 3. Contexte & Spécifications ESI CCP
Conformément aux spécifications OpenAPI officielles de CCP (`https://esi.evetech.net/meta/openapi.json`), l'élargissement fonctionnel mobilise 5 nouvelles routes et 4 nouveaux scopes :

| Domaine | Route ESI | Méthode | Scope Requis | Cache TTL / Expires |
|---|---|---|---|---|
| **PI (Colonies)** | `/characters/{character_id}/planets/` | GET | `esi-planets.manage_planets.v1` | ~10 à 15 min |
| **PI (Détail Pins)** | `/characters/{character_id}/planets/{planet_id}/` | GET | `esi-planets.manage_planets.v1` | ~10 à 15 min |
| **PI (Douanes)** | `/characters/{character_id}/planets/{planet_id}/` (via POCO) | GET | `esi-planets.read_customs_offices.v1` | ~60 min |
| **Industrie (Perso)** | `/characters/{character_id}/industry/jobs/` | GET | `esi-industry.read_character_jobs.v1` | ~5 min |
| **Industrie (Corpo)** | `/corporations/{corporation_id}/industry/jobs/` | GET | `esi-industry.read_corporation_jobs.v1` | ~5 min |
| **Farm / Minage** | `/characters/{character_id}/mining/` | GET | `esi-industry.read_character_mining.v1` | ~10 min |

## 4. Problématique & Bottleneck Architectural
1. **Multiplication explosive des requêtes PI :**
   Pour une flotte de 11 personnages possédant chacun 6 colonies planétaires, l'interrogation du détail des pins (`/characters/{id}/planets/{planet_id}/`) requiert jusqu'à $11 \times 6 = 66$ requêtes HTTP individuelles, en plus de la liste initiale des planètes (11 requêtes).
2. **Risque sur le budget d'erreur ESI :**
   Si ces 66 requêtes sont déclenchées en rafale non régulée, tout échec transitoire ou micro-coupure CCP peut faire chuter drastiquement le quota d'erreurs (`X-ESI-Error-Limit-Remain < 50`), entraînant un blocage HTTP 420 global de l'application.
3. **Risque de surcharge de module (*Module Overloading*) :**
   Intégrer directement ces 5 routes et leur logique d'orchestration dans `src/server/sync/service.ts` créerait un « God Module » ingérable et violerait la séparation des responsabilités.

## 5. Décisions Architecturales & Délégation des Responsabilités
* **Pattern « Collecteurs Spécialisés » (Plugin Architecture) :**
  Au lieu de surcharger `src/server/sync/service.ts`, l'orchestrateur de synchronisation délègue la collecte à des sous-modules autonomes :
  - `src/server/pi/collector.ts` : collecte spécifique des colonies et pins planétaires.
  - `src/server/industry/collector.ts` : collecte des jobs de manufacture et réactions.
  - `src/server/mining/collector.ts` : collecte du ledger minier.
  Le coordinateur central (`SyncCoordinator`) se contente d'allouer les baux distribués et de réguler la cadence globale.
* **Pool Dédié et Sub-Batching Borné pour les Pins PI :**
  Pour les colonies planétaires, un sous-ordonnanceur (`PiBatchScheduler`) découpe les 66 requêtes en petits lots de 3 à 4 requêtes concurrentes maximum, avec pause adaptative en fonction de la valeur de l'en-tête `X-ESI-Error-Limit-Remain`.
* **Respect Absolu des En-têtes HTTP `Expires` & `ETag` :**
  Aucun appel vers `/planets/{planet_id}/` n'est émis si le TTL du cache local n'a pas expiré (généralement 15 minutes sur les pins PI). En cas de réponse `304 Not Modified`, l'état précédent est préservé sans aucune écriture en base.
* **Typage et Scopes Immuables Côté Serveur :**
  Les nouveaux scopes sont déclarés dans `DEFAULT_SCOPES` au sein de `src/server/auth/types.ts`. Tous les secrets et rafraîchissements restent 100 % côté serveur.

## 6. Non-objectifs
* Ne pas calculer la rentabilité d'arbitrage ou de transformation des matériaux (réservé aux phases ultérieures).
* Ne pas modifier le fonctionnement de la synchronisation du Grand Livre (`transactions`, `journal`) ou des ordres de marché.
* Aucune écriture ou interaction en jeu (lecture seule absolue).

## 7. Dépendances
* Phases S01 à S03 terminées et certifiées.
* Module `src/server/esi/cache.ts` et `src/server/esi/rateLimiter.ts` opérationnels.

## 8. Modules Concernés & Architecture des Fichiers
* `src/server/auth/types.ts` : ajout des nouveaux scopes ESI officiels.
* `src/server/esi/types.ts` : interfaces TypeScript des payloads bruts CCP (Planets, PlanetPin, IndustryJob, MiningEntry).
* `src/server/pi/collector.ts` : orchestrateur de collecte PI avec cache strict et batching borné.
* `src/server/industry/collector.ts` : collecteur de jobs industriels perso/corpo.
* `src/server/mining/collector.ts` : collecteur du ledger d'extraction minage.
* `src/server/sync/service.ts` : délégation vers les collecteurs spécialisés via interfaces unifiées.
* Tests unitaires et d'intégration : `src/server/esi/esi.test.ts`, `src/server/sync/concurrency.test.ts`, tests dédiés par collecteur.

## 9. Contrats Impactés
* `DEFAULT_SCOPES` : adjonction de `esi-planets.read_customs_offices.v1`, `esi-industry.read_character_jobs.v1`, `esi-industry.read_corporation_jobs.v1`, `esi-industry.read_character_mining.v1`.
* `GET /api/sync/status` : enrichissement avec l'état de fraîcheur des nouveaux flux (`pi`, `industry`, `mining`).

## 10. Critères d'Acceptation & Qualification
* [x] Les 5 nouvelles routes CCP sont interrogées avec gestion complète de `ETag`, `Expires`, et `304 Not Modified`.
* [x] La collecte des 66 colonies potentielles (11 persos × 6 planètes) s'exécute sans dépasser 4 requêtes concurrentes simultanées.
* [x] Aucune baisse du budget d'erreurs CCP en dessous de 80/100 lors d'un cycle de synchronisation complet.
* [x] Les collecteurs sont isolés dans leurs dossiers de domaine respectifs sans alourdir `sync/service.ts`.
* [x] 100 % des tests unitaires et d'intégration passent au vert.
