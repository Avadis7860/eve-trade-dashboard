# PHASE-10.bis — Soldes Réels des Wallets (Personnages & Divisions Corpo), Filtrage de Liquidité et Scopes ESI Complets

**Type :** intégrité financière, synchronisation ESI & paramétrage · **Dépendances :** 01, 02, 03, 09, 10 · **État :** Planifiée

---

## 1. Problème utilisateur & Résultat attendu

- **Problème constaté** :
  1. **Calcul de liquidité indirect et pollué** : Jusqu'à la Phase 10, `liquidWalletBalanceIsk` (`CapitalService.getMonetaryCapital`) déduisait le solde liquide à partir du champ `balance` de la dernière écriture trouvée dans `journalEntries` par personnage, sans appeler les routes ESI de solde réel (`GET /characters/{character_id}/wallet` et `GET /corporations/{corporation_id}/wallets`).
  2. **Collision entre journaux personnels et journaux de corporation** : Les écritures de journal de corporation (`/corporations/{corporation_id}/wallets/{division}/journal`) étaient enregistrées sous le `characterId` du personnage lecteur. Leur champ `balance` (solde de la division corpo) pouvait être pris pour le solde personnel du personnage, voire additionné plusieurs fois si plusieurs personnages de la même corporation étaient connectés.
  3. **Absence de sélection des portefeuilles dans le calcul du capital** : L'utilisateur peut avoir un personnage présentant une dette ou un solde isolé (ex. dette de `-1,5 Md ISK` ou portefeuille hors trading) ou souhaiter ne comptabiliser que le portefeuille de sa corporation (ou certaines divisions `1..7` / certains personnages précis). Sans paramètre de sélection (Sync & Inclusion Personnages vs Corporation), le solde liquide consolidé est faussé.
  4. **Scopes ESI restreints** : L'application limitait la demande OAuth SSO à 7 scopes, empêchant l'accès aux noms de divisions de corporation (`esi-corporations.read_divisions.v1`), aux structures, aux contrats ou aux autres endpoints ESI prévus par CCP pour l'usage personnel complet du tableau de bord.

- **Résultat attendu** :
  1. **Collecte directe des soldes réels ESI** : Synchronisation et persistance explicites du solde réel de chaque personnage (`GET /characters/{character_id}/wallet`) et des 7 divisions de portefeuille de chaque corporation accessible (`GET /corporations/{corporation_id}/wallets` + noms des divisions via `GET /corporations/{corporation_id}/divisions`), avec déduplication stricte par `(corporation_id, division)`.
  2. **Séparation stricte des écritures de journal** : Les écritures de journal de corporation sont distinguées des écritures personnelles (`isCorporationWallet`, `corporationId`, `division`) et ne polluent jamais le solde individuel d'un personnage.
  3. **Paramétrage granulaire des sources de liquidité et de synchronisation** : Dans les **Paramètres / Préférences**, l'utilisateur peut choisir :
     - le **mode de synchronisation et de comptabilisation** : `CHARACTERS_ONLY` (Personnages uniquement), `CORPORATION_ONLY` (Divisions de corporation uniquement), ou `BOTH_CUSTOM` (Personnages & Corporation avec sélection granulaire) ;
     - l'inclusion/exclusion individuelle de **chaque personnage** (ex. exclure un personnage ayant une dette de `1,5B ISK` du calcul de liquidité) et de **chaque division de corporation (`1` à `7`)**.
  4. **Autorisation de l'intégralité des scopes ESI officiels de CCP** : Intégration de la liste complète des scopes OAuth2 publiés dans la spécification OpenAPI officielle CCP (`https://esi.evetech.net/meta/openapi.json`) pour usage personnel sans friction lors de l'authentification SSO.

---

## 2. Dépendances exactes

- Modules amont : `src/server/auth/`, `src/server/esi/`, `src/server/sync/`, `src/server/ledger/`, `src/server/capital/`, `src/utils/preferences.ts`.
- Contrats : `docs/ESI_RESILIENCE.md`, `docs/DOMAIN_CONTRACTS.md`, `docs/METRICS.md`.

---

## 3. Spécifications ESI CCP vérifiées (`https://esi.evetech.net/meta/openapi.json`)

### 3.1. Routes ESI de portefeuilles et divisions
1. **`GET /characters/{character_id}/wallet`**
   - **Scope requis** : `esi-wallet.read_character_wallet.v1`
   - **Schéma de réponse (`CharactersCharacterIdWalletGet`)** : `number` (`double`) représentant le solde ISK exact du personnage.
2. **`GET /corporations/{corporation_id}/wallets`**
   - **Scope requis** : `esi-wallet.read_corporation_wallets.v1`
   - **Schéma de réponse (`CorporationsCorporationIdWalletsGet`)** : `Array<{ division: number; balance: number }>` (`division` de `1` à `7`, `balance` en `double`).
3. **`GET /corporations/{corporation_id}/divisions`**
   - **Scope requis** : `esi-corporations.read_divisions.v1`
   - **Schéma de réponse (`CorporationsCorporationIdDivisionsGet`)** : `{ hangar?: Array<{ division: number; name?: string }>, wallet?: Array<{ division: number; name?: string }> }` permettant d'afficher le vrai nom en jeu de chaque division de portefeuille (ex. *Master Wallet*, *Trading Hub*, *Taxes & Dette*).
4. **`GET /corporations/{corporation_id}/wallets/{division}/journal`** & **`GET /corporations/{corporation_id}/wallets/{division}/transactions`**
   - **Scope requis** : `esi-wallet.read_corporation_wallets.v1`

### 3.2. Liste complète des scopes OAuth2 CCP autorisés
Conformément au schéma `components.securitySchemes.OAuth2.flows.authorizationCode.scopes` de l'OpenAPI officiel CCP, l'application configure l'ensemble des scopes officiels CCP :
- **Portefeuilles, Marchés, Actifs, Contrats & Industrie** :
  - `esi-wallet.read_character_wallet.v1`
  - `esi-wallet.read_corporation_wallets.v1`
  - `esi-markets.read_character_orders.v1`
  - `esi-markets.read_corporation_orders.v1`
  - `esi-markets.structure_markets.v1`
  - `esi-assets.read_assets.v1`
  - `esi-assets.read_corporation_assets.v1`
  - `esi-contracts.read_character_contracts.v1`
  - `esi-contracts.read_corporation_contracts.v1`
  - `esi-industry.read_character_jobs.v1`
  - `esi-industry.read_character_mining.v1`
  - `esi-industry.read_corporation_jobs.v1`
  - `esi-industry.read_corporation_mining.v1`
- **Corporations, Alliances & Structures** :
  - `esi-corporations.read_blueprints.v1`
  - `esi-corporations.read_contacts.v1`
  - `esi-corporations.read_container_logs.v1`
  - `esi-corporations.read_corporation_membership.v1`
  - `esi-corporations.read_divisions.v1`
  - `esi-corporations.read_facilities.v1`
  - `esi-corporations.read_freelance_jobs.v1`
  - `esi-corporations.read_fw_stats.v1`
  - `esi-corporations.read_medals.v1`
  - `esi-corporations.read_projects.v1`
  - `esi-corporations.read_standings.v1`
  - `esi-corporations.read_starbases.v1`
  - `esi-corporations.read_structures.v1`
  - `esi-corporations.read_titles.v1`
  - `esi-corporations.track_members.v1`
  - `esi-alliances.read_contacts.v1`
  - `esi-structures.read_character.v1`
  - `esi-structures.read_corporation.v1`
  - `esi-universe.read_structures.v1`
  - `esi-search.search_structures.v1`
- **Personnage, Compétences, Clones, Localisation, Flottes, Courrier & Divers** :
  - `esi-access.read_lists.v1`
  - `esi-activities.read_character.v1`
  - `esi-calendar.read_calendar_events.v1`
  - `esi-calendar.respond_calendar_events.v1`
  - `esi-characters.read_agents_research.v1`
  - `esi-characters.read_blueprints.v1`
  - `esi-characters.read_contacts.v1`
  - `esi-characters.read_corporation_roles.v1`
  - `esi-characters.read_fatigue.v1`
  - `esi-characters.read_freelance_jobs.v1`
  - `esi-characters.read_fw_stats.v1`
  - `esi-characters.read_loyalty.v1`
  - `esi-characters.read_medals.v1`
  - `esi-characters.read_notifications.v1`
  - `esi-characters.read_standings.v1`
  - `esi-characters.read_titles.v1`
  - `esi-characters.write_contacts.v1`
  - `esi-clones.read_clones.v1`
  - `esi-clones.read_implants.v1`
  - `esi-fittings.read_fittings.v1`
  - `esi-fittings.write_fittings.v1`
  - `esi-fleets.read_fleet.v1`
  - `esi-fleets.write_fleet.v1`
  - `esi-killmails.read_corporation_killmails.v1`
  - `esi-killmails.read_killmails.v1`
  - `esi-location.read_location.v1`
  - `esi-location.read_online.v1`
  - `esi-location.read_ship_type.v1`
  - `esi-mail.organize_mail.v1`
  - `esi-mail.read_mail.v1`
  - `esi-mail.send_mail.v1`
  - `esi-planets.manage_planets.v1`
  - `esi-planets.read_customs_offices.v1`
  - `esi-skills.read_skillqueue.v1`
  - `esi-skills.read_skills.v1`
  - `esi-ui.open_window.v1`
  - `esi-ui.write_waypoint.v1`

*(Note d'architecture : Même avec l'ensemble des scopes autorisés sur le jeton SSO, l'application respecte strictement l'invariant de lecture seule vis-à-vis du marché EVE.)*

---

## 4. Règles de calcul & Modèle de données des Wallets

### 4.1. Entités de Solde de Portefeuille (`WalletBalanceSnapshot`)
1. **Portefeuille Personnel (`CHARACTER_WALLET`)** :
   - Clé unique : `char:{characterId}`
   - Champs : `characterId`, `characterName`, `balance`, `observedAt`, `source: '/characters/{character_id}/wallet'`
2. **Division de Portefeuille de Corporation (`CORPORATION_DIVISION_WALLET`)** :
   - Clé unique : `corp:{corporationId}:div:{division}` (dédupliquée quelle que soit la quantité de personnages appartenant à cette corporation)
   - Champs : `corporationId`, `corporationName`, `division` (`1..7`), `divisionName`, `balance`, `observedByCharacterId`, `observedAt`, `source: '/corporations/{corporation_id}/wallets'`

### 4.2. Filtrage et Paramètres Utilisateur (`WalletSyncAndCapitalSettings`)
L'utilisateur configure dans les Paramètres :
- **`walletSyncMode`** :
  - `'CHARACTERS_ONLY'` : Synchronise et comptabilise uniquement les portefeuilles des personnages sélectionnés (ignore la synchronisation et les soldes des portefeuilles de corporation).
  - `'CORPORATION_ONLY'` : Synchronise et comptabilise uniquement les divisions de portefeuille de corporation sélectionnées (ignore les soldes personnels des personnages).
  - `'BOTH'` : Synchronise les deux et comptabilise la somme des portefeuilles personnels activés et des divisions de corporation activées.
- **`excludedCharacterWalletIds: number[]`** : Liste des `characterId` dont le portefeuille personnel est exclu du calcul de `liquidWalletBalanceIsk` (ex. personnage ayant une dette ou un solde négatif de `-1,5 Md ISK` ou servant à une autre activité).
- **`includedCorporationWallets: string[]`** (ou exclusions par clé `${corporationId}:${division}`) : Sélection granulaire des divisions `1` à `7` à inclure dans la liquidité disponible.

### 4.3. Formule Canonique Révisée de `LIQUID_WALLET_BALANCE` ($Cap_{\text{libre}}$)
$$Cap_{\text{libre}} = \sum_{c \in \text{Persos Actifs}} \text{Solde Réel}(c) + \sum_{(corp, div) \in \text{Divisions Corpo Actives}} \text{Solde Réel}(corp, div)$$

- **Fallback contrôlé** : Si et seulement si l'endpoint direct `GET /characters/{character_id}/wallet` n'a pas encore été appelé pour un personnage donné, le fallback éventuel sur le journal filtre **exclusivement** les entrées personnelles (`source === '/characters/{id}/wallet/journal/'`) triées par `(date DESC, journalId DESC)`. Une écriture de corporation n'est jamais utilisée pour estimer un portefeuille personnel.

---

## 5. Étapes de réalisation (lors de l'implémentation)

1. **Mise à jour des Scopes SSO (`src/server/auth/service.ts`)** : Intégration de l'ensemble des scopes CCP vérifiés dans `DEFAULT_SCOPES`.
2. **Stockage & Synchronisation des Soldes Réels (`src/server/ledger/` & `src/server/sync/`)** :
   - Ajout de la collecte de `GET /characters/{character_id}/wallet` lors de la synchronisation.
   - Mise à jour de `syncCorporationWallets` pour persister les soldes des divisions (`GET /corporations/{corporation_id}/wallets`) et leurs libellés (`GET /corporations/{corporation_id}/divisions`), et respecter le paramètre de synchronisation (`CHARACTERS_ONLY` / `CORPORATION_ONLY` / `BOTH`).
   - Isolation des entrées de journal de corporation (`isCorpJournal: true`, `corporationId`, `division`) pour éviter toute collision avec le solde personnel.
3. **Calcul du Capital & Filtrage (`src/server/capital/service.ts` & `router.ts`)** :
   - Calcul de `liquidWalletBalanceIsk` à partir des soldes réels persistés et filtrés selon la configuration choisie par l'utilisateur.
   - Exposition du détail de chaque portefeuille (personnages et divisions corpo, inclus ou exclus) dans la réponse `/api/capital/summary` pour une transparence totale.
4. **Interface Paramètres & Vue Capital (`src/App.tsx`, `src/utils/preferences.ts`)** :
   - Ajout dans le panneau Paramètres du choix du mode de synchronisation/liquidité (`Personnages`, `Corporation`, `Les deux`) et des cases à cocher par personnage et par division de corporation (avec affichage du solde réel de chacun pour identifier immédiatement un personnage endetté ou une division spécifique).
5. **Tests unitaires et d'intégration** :
   - Vérification de la non-pollution entre solde personnel et solde corpo.
   - Vérification de l'exclusion d'un personnage endetté (ex. `-1,5 Md ISK`) et de la déduplication des divisions corpo multi-personnages.

---

## 6. Critères d'acceptation mesurables

- [ ] Le solde liquide affiché correspond au solde exact retourné par `GET /characters/{character_id}/wallet` et/ou `GET /corporations/{corporation_id}/wallets` selon les portefeuilles cochés.
- [ ] Aucune écriture de journal de corporation ne peut remplacer ou gonfler le solde d'un portefeuille personnel.
- [ ] Un personnage désactivé dans les paramètres de liquidité (ex. personnage avec dette de 1,5B) est exclu du calcul de `liquidWalletBalanceIsk` et de `netRealCapitalIsk`, tout en restant visible à titre informatif dans le détail des portefeuilles.
- [ ] Les divisions de portefeuille d'une même corporation ne sont jamais comptées en double lorsque plusieurs personnages de cette corporation sont connectés.
- [ ] L'authentification EVE SSO demande l'ensemble des scopes CCP autorisés.
- [ ] Suite de tests complète (`vitest run`), `lint`, `typecheck` et `build` au vert.

---

## 7. Définition de Terminé

Code réel implémenté + tests unitaires et d'intégration des portefeuilles réels et filtres au vert + CI verte + mise à jour de `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md`.
