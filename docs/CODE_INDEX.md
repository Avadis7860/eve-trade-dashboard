# Index canonique du code

**État :** Phase 05 (Hubs commerciaux configurables, allocations explicites de coûts, métriques financières TTC et calcul de ROI) terminée et validée.

## Runtime & Environnement
- **Runtime :** Node.js 22, TypeScript strict.
- **Port d'écoute :** 3000 (0.0.0.0).
- **Points d'entrée :**
  - Serveur : `server.ts`
  - Client SPA : `src/main.tsx` (via `index.html`)
- **Scripts npm :**
  - `npm run dev` : Démarrage du serveur full-stack avec middleware Vite (`tsx server.ts`).
  - `npm run build` : Compilation TypeScript et build statique client Vite (`tsc && vite build`).
  - `npm run lint` : Vérification ESLint (`eslint src/ server.ts`).
  - `npm run typecheck` : Vérification des types sans émission (`tsc --noEmit`).
  - `npm test` : Suite de tests unitaires et intégration (`vitest run`).
  - `npm start` : Démarrage en production (`NODE_ENV=production tsx server.ts`).

## Variables d'environnement
- `PORT` : Port d'écoute HTTP local du serveur (par défaut: 3000).
- `EVE_CLIENT_ID` : Identifiant client OAuth de votre application EVE Online Developer.
- `EVE_CLIENT_SECRET` : Clé secrète de votre application EVE Online Developer.
- `EVE_CALLBACK_URL` : URL de rappel de redirection configurée sur le portail développeur EVE.

## Modules & Fichiers Applicatifs
- `server.ts` — Serveur Express avec middleware Vite dev, cookie-parser, routeurs SSO, ESI, Ledger, Orders, Hubs et ROI — Fournit `/api/health`, `/api/info` et monte `/api/auth`, `/api/esi`, `/api/ledger`, `/api/orders`, `/api/hubs`, `/api/roi` — `server.test.ts`
- `src/server/auth/types.ts` — Interfaces et contrats TypeScript pour les flux SSO, JWT claims, sessions multi-personnages, personnages liés et configurations — `src/server/auth/auth.test.ts`
- `src/server/auth/pkce.ts` — Génération de tokens d'entropie cryptographique pour PKCE (RFC 7636 S256) et state CSRF — `src/server/auth/auth.test.ts`
- `src/server/auth/jwt.ts` — Décodage, extraction et validation des claims JWT CCP SSO (issuer, expiration, audience, subject `CHARACTER:EVE:<id>`) — `src/server/auth/auth.test.ts`
- `src/server/auth/sessionStore.ts` — Gestionnaire de sessions en mémoire avec TTL, liaison multi-personnages (`addOrUpdateCharacter`, `switchActiveCharacter`, `removeCharacter`), anti-rejeu et rotation — `src/server/auth/auth.test.ts`
- `src/server/auth/service.ts` — Service orchestrant la génération d'URL de login SSO, liaison de personnages à une session active, bascule et sanitisation publique — `src/server/auth/auth.test.ts`
- `src/server/auth/router.ts` — Routeur Express pour les endpoints OAuth (`/api/auth/login`, `/api/auth/callback`, `/api/auth/session`, `/api/auth/switch`, `/api/auth/character/:id`, `/api/auth/logout`) — `src/server/auth/auth.test.ts`
- `src/server/esi/types.ts` — Types et contrats de l'adaptateur ESI (réponses typées, métadonnées ETag/Expires/X-Pages/Retry-After, budget d'erreur, états de complétude `COMPLETE`/`PARTIAL`/`ERROR`) — `src/server/esi/esi.test.ts`
- `src/server/esi/cache.ts` — Cache en mémoire supportant les requêtes conditionnelles HTTP (`If-None-Match`, `If-Modified-Since`), `304 Not Modified` et TTL sans écrasement de données valides — `src/server/esi/esi.test.ts`
- `src/server/esi/rateLimiter.ts` — Limiteur de débit et gestionnaire de quotas CCP (lecture `X-ESI-Error-Limit-Remain/Reset`, suspension sur 420/429, respect `Retry-After`, file d'attente à concurrence bornée) — `src/server/esi/esi.test.ts`
- `src/server/esi/client.ts` — Client HTTP centralisé ESI avec User-Agent contractuel, retries bornés exponentiels avec jitter sur 5xx/réseau, rafraîchissement automatique sur 401, blocage sur 403, support GET et POST bulk (/universe/names/) et journalisation expurgée — `src/server/esi/esi.test.ts`
- `src/server/esi/pagination.ts` — Stratégies de pagination ESI (`x-pages` pour requêtes de marché et `from_id` pour transactions wallet) avec déduplication et conservation de données partielles en cas d'interruption — `src/server/esi/esi.test.ts`
- `src/server/esi/router.ts` — Routeur Express pour la passerelle ESI (`/api/esi/status`, `/api/esi/character/orders`, `/api/esi/character/wallet/balance`) avec vérification stricte de session serveur — `src/server/esi/esi.test.ts`
- `src/server/universe/service.ts` — Résolution et cache des identifiants EVE (articles, stations, hubs, personnages) via dictionnaire statique et requêtes groupées ESI `/universe/names/` avec isolation sécurisée des identifiants 64-bit Upwell structures pour prévenir les erreurs HTTP 400 — `src/server/universe/universe.test.ts`
- `src/server/ledger/types.ts` — Modèles de domaine et contrats pour les transactions, entrées du journal de portefeuille, filtres de requêtes, options de filtres et agrégats financiers — `src/server/ledger/ledger.test.ts`
- `src/server/ledger/repository.ts` — Dépôt de persistance des transactions et du journal de portefeuille garantissant l'isolation stricte par personnage, l'idempotence des réimports, l'enrichissement des transactions avec taxes CCP/frais de courtage et la conservation immuable de la provenance — `src/server/ledger/ledger.test.ts`
- `src/server/ledger/service.ts` — Service métier pour la recherche, le tri, le filtrage multi-critères, l'inspection détaillée et la corrélation directe entre transactions et taxes/frais de journal sans restriction de pagination — `src/server/ledger/ledger.test.ts`
- `src/server/ledger/router.ts` — Routeur Express du Grand Livre (`/api/ledger/transactions`, `/api/ledger/transactions/:id`, `/api/ledger/journal`, `/api/ledger/summary`, `/api/ledger/filter-options`, `/api/ledger/sync-status`, `/api/ledger/sync`) — `src/server/ledger/ledger.test.ts`
- `src/server/orders/types.ts` — Modèles de domaine pour les snapshots d'ordres, états de cycle de vie (`ACTIVE`, `PARTIALLY_FILLED`, `COMPLETED_CONFIRMED`, `DISAPPEARED_UNCONFIRMED`, etc.), métriques d'ordres et items de listes locales de réapprovisionnement — `src/server/orders/orders.test.ts`
- `src/server/orders/lifecycle.ts` — Moteur de classification de cycle de vie et analyseur de diff de snapshots (`evaluateOrderLifecycle`, calcul d'expiration) respectant la règle qu'une disparition n'équivaut pas à une vente confirmée — `src/server/orders/orders.test.ts`
- `src/server/orders/repository.ts` — Dépôt de persistance des snapshots d'ordres (avec détection de disparition) et des projections locales de réapprovisionnement avec isolation par personnage — `src/server/orders/orders.test.ts`
- `src/server/orders/service.ts` — Service de gestion des ordres, corrélation avec transactions, génération automatique de suggestions de réapprovisionnement et CRUD local sans mutation ESI — `src/server/orders/orders.test.ts`
- `src/server/orders/router.ts` — Routeur Express pour les ordres et listes de réapprovisionnement (`/api/orders`, `/api/orders/:id`, `/api/orders/summary`, `/api/orders/restock`, `/api/orders/restock/generate`, `/api/orders/restock/:id`) — `src/server/orders/orders.test.ts`
- `src/server/hubs/types.ts` — Contrats et interfaces de modélisation des hubs commerciaux et mappings d'emplacements — `src/server/hubs/hubs.test.ts`
- `src/server/hubs/repository.ts` — Dépôt de stockage des hubs (hubs majeurs Jita, Amarr, Dodixie, Rens, Hek + personnalisés) et des associations station/structure — `src/server/hubs/hubs.test.ts`
- `src/server/hubs/service.ts` — Résolution des stations vers leurs hubs associés, garantie `UNKNOWN_HUB` sans valeur par défaut silencieuse, CRUD hubs et mappings — `src/server/hubs/hubs.test.ts`
- `src/server/hubs/router.ts` — Routeur Express pour les hubs et associations (`/api/hubs`, `/api/hubs/mappings`, `/api/hubs/resolve/:locationId`) — `src/server/hubs/hubs.test.ts`
- `src/server/roi/types.ts` — Types pour les allocations de coûts (mode FIFO automatique et manuel), indicateurs de couverture (`COMPLETE`, `PARTIAL`, `UNKNOWN`, `EMPTY`), paires de hubs, filtres multi-personnages et capital immobilisé — `src/server/roi/roi.test.ts`
- `src/server/roi/calculator.ts` — Moteur de calcul financier TTC avec arithmétique décimale exacte, non double-comptage des frais, et gestion stricte des statuts `UNKNOWN`/`PARTIAL` — `src/server/roi/roi.test.ts`
- `src/server/roi/repository.ts` — Persistance des allocations avec versionnage, support multi-personnages pour le pool d'inventaire et calcul du capital immobilisé en stocks invendus — `src/server/roi/roi.test.ts`
- `src/server/roi/service.ts` — Moteur de réconciliation chronologique (FIFO multi-personnages) des ventes avec achats antérieurs à l'échelle de l'écosystème commercial complet, allocations manuelles, résolution sans biais des taxes CCP et commissions de courtage, et agrégats financiers — `src/server/roi/roi.test.ts`
- `src/server/roi/router.ts` — Routeur Express pour les métriques de rentabilité, déclenchement du rapprochement FIFO multi-personnages et allocations (`/api/roi/summary`, `/api/roi/reconcile`, `/api/roi/allocations`, `/api/roi/unsold-inventory`) — `src/server/roi/roi.test.ts`
- `src/server/sync/types.ts` — Types pour le suivi de synchronisation, curseurs `from_id` et indicateurs d'état (`COMPLETE`, `PARTIAL`, `ERROR`, `FRESH`, `STALE`) — `src/server/sync/sync.test.ts`
- `src/server/sync/repository.ts` — Dépôt de gestion des états de synchronisation et des curseurs par personnage et ressource — `src/server/sync/sync.test.ts`
- `src/server/sync/service.ts` — Orchestrateur de collecte ESI (`/wallet/transactions/` via pagination `from_id`, `/wallet/journal/` via `x-pages` et `/orders/` + `/orders/history/`), enrichissement de noms et sauvegarde résiliente — `src/server/sync/sync.test.ts`
- `src/main.tsx` — Point de montage React 19 dans le DOM — Initialisation React StrictMode — `src/App.test.tsx`
- `src/App.tsx` — Interface utilisateur complète : Grand Livre des ventes, Ordres & Cycle de vie, Hubs & ROI TTC avec paires de flux et allocations explicites, Listes locales de réapprovisionnement, Journal des frais et Roadmap — `src/App.test.tsx`
- `src/index.css` — Feuille de style Tailwind CSS — Import Tailwind et configuration de base du thème sombre — `src/App.test.tsx`
- `src/test/setup.ts` — Configuration de l'environnement de test DOM Vitest — Configuration jest-dom matchers — N/A
- `vite.config.ts` — Configuration du bundler Vite avec plugins React et Tailwind — Résolution et build client — N/A
- `vitest.config.ts` — Configuration des tests unitaires et d'intégration Vitest — Environnement jsdom et globals — N/A
- `eslint.config.js` — Configuration du linter ESLint en mode strict TypeScript — Validation de syntaxe et typage — N/A
- `metadata.json` — Métadonnées Google AI Studio — Identification de l'application et permissions — N/A
- `.env.example` — Modèle de configuration d'environnement sans secrets — Déclaration des variables — N/A

## Tests
- `src/server/roi/roi.test.ts` — Suite de tests complète pour le calcul du ROI TTC, réconciliation chronologique FIFO multi-personnages, achats sur sell orders directs, non double-comptage des taxes, vérification du capital immobilisé et rejet des allocations incohérentes.
- `src/server/hubs/hubs.test.ts` — Tests de résolution des stations/structures vers les hubs, non-assignation silencieuse de hub par défaut (`UNKNOWN_HUB`), persistance des mappings et protection des hubs système.
- `src/server/orders/orders.test.ts` — Tests exhaustifs de la machine à états de cycle de vie des ordres, diff de snapshots, transition `DISAPPEARED_UNCONFIRMED`, isolation, agrégats et listes de réapprovisionnement sans mutation ESI.
- `src/server/ledger/ledger.test.ts` — Tests complets du grand livre (idempotence des réimports, isolation stricte par personnage, filtres Achat/Vente/Date/Recherche, tri, métriques de synthèse sans extrapolation de coûts manquants, association transaction-journal).
- `src/server/sync/sync.test.ts` — Tests d'orchestration de synchronisation (pagination from_id, curseurs de reprise, rétention des données existantes en cas d'erreur ou d'interruption partielle, synchronisation du journal et des ordres).
- `src/server/universe/universe.test.ts` — Tests de résolution de noms univers EVE statiques et dynamiques.
- `src/server/esi/esi.test.ts` — Suite complète de tests ESI (cache ETag/Expires, 304, suspension error budget 420/429, Retry-After, retries bornés 5xx, rejet 403, renouvellement 401, pagination X-Pages & from_id avec déduplication et conservation PARTIAL).
- `src/server/auth/auth.test.ts` — Suite complète de tests unitaires SSO (PKCE S256, validation JWT CCP, protection anti-rejeu state CSRF, échange de code, rafraîchissement de tokens et purge de session).
- `src/App.test.tsx` — Tests unitaires et d'intégration de l'interface (navigation par onglets, grand livre, ordres & cycle de vie, hubs & ROI TTC, listes de réapprovisionnement).
- `server.test.ts` — Tests d'initialisation du serveur Express et vérification des routes API.
