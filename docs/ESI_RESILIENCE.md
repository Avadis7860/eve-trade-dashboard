# ESI et résilience

## Sources officielles à vérifier à chaque ajout de route
- https://developers.eveonline.com/api-explorer
- https://developers.eveonline.com/docs/services/esi/overview/
- https://developers.eveonline.com/docs/services/esi/best-practices/
- https://developers.eveonline.com/docs/services/esi/rate-limiting/
- https://developers.eveonline.com/docs/services/esi/pagination/x-pages/
- https://developers.eveonline.com/docs/services/esi/pagination/from-id/
- https://developers.eveonline.com/docs/services/sso/

Centraliser les appels dans un adaptateur serveur. Configurer un User-Agent identifiable et une date de compatibilité unique, revue avec le changelog. Confirmer routes, scopes et schémas contre l'OpenAPI courant avant codage.

## Cache
Respecter Expires/Cache-Control et ne pas rafraîchir avant expiration. Réutiliser ETag via If-None-Match et Last-Modified via If-Modified-Since lorsque pertinent. Un 304 réutilise la représentation précédente et ne crée aucun événement métier. Conserver métadonnées et instant de récupération. Pour X-Pages, vérifier la cohérence des pages ; snapshot instable = reprise contrôlée ou PARTIAL.

## Débit et erreurs
Lire les en-têtes de buckets (X-Ratelimit-*) et de limite d'erreur (X-ESI-Error-Limit-Remain/Reset) lorsqu'ils existent. Respecter Retry-After. 401 : renouvellement au plus une fois puis reconnexion ; 403 : scope/accès, pas de retry ; 404 : interprétation selon route ; 420 : suspendre jusqu'au reset et investiguer ; 429 : différer ; 5xx/réseau/timeouts : retry borné sur GET idempotent avec backoff et jitter. Concurrence bornée, aucun polling agressif ni retry infini. Ne jamais chercher à atteindre les limites.

## Pagination
Suivre la stratégie propre à la route (X-Pages, from_id, curseur). Traiter les curseurs comme opaques. Dédupliquer aux frontières, borner pages et durée, persister checkpoint après validation durable. Ne déclarer complet qu'après toutes les pages. Reprise idempotente ; erreur ou pagination interrompue = PARTIAL sans effacer l'état valide précédent.
Pour les journaux de corporation (`/corporations/{corporation_id}/wallets/{division}/journal`), la pagination X-Pages est exécutée par division sans limite artificielle tronquée (reprise par division via `divisionStatuses`, persistance transactionnelle par page via `onPageSuccess`, et agrégation stricte : `COMPLETE` si 100% des divisions accessibles sont exhaustives, `PARTIAL` en cas d'interruption ou d'erreur sur une division, `ERROR` si l'ensemble des divisions échoue).

## Routes et Scopes ESI (spécification OpenAPI officielle CCP `https://esi.evetech.net/meta/openapi.json`)
Routes principales : `/characters/{character_id}/wallet` ; `/characters/{character_id}/wallet/transactions` ; `/characters/{character_id}/wallet/journal` ; `/characters/{character_id}/orders` ; `/characters/{character_id}/orders/history` ; `/characters/{character_id}/assets` ; `/corporations/{corporation_id}/wallets` ; `/corporations/{corporation_id}/divisions` ; `/corporations/{corporation_id}/wallets/{division}/journal` ; `/corporations/{corporation_id}/wallets/{division}/transactions` et routes publiques d'enrichissement (`/universe/names`).
Scopes OAuth2 : L'application autorise l'ensemble des scopes ESI officiels définis par CCP dans `securitySchemes.OAuth2` (dont `esi-wallet.read_character_wallet.v1`, `esi-wallet.read_corporation_wallets.v1`, `esi-corporations.read_divisions.v1`, `esi-markets.read_character_orders.v1`, `esi-markets.read_corporation_orders.v1`, `esi-assets.read_assets.v1`, `esi-assets.read_corporation_assets.v1`, etc.), tout en maintenant l'invariant de lecture seule sur les ordres de marché.

L'historique ESI est limité (l'historique d'ordres est annoncé sur une fenêtre de 90 jours dans la documentation actuelle). L'historique local ne commence qu'à la première collecte. Ne jamais promettre une archive rétroactive exhaustive.