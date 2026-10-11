# PHASE-H01 — Hardening sécurité

**Type :** hardening · **Dépendances :** 00–06 intégrées · **Statut :** Terminé

## Objectif
Auditer et corriger les surfaces sensibles sans altérer le comportement métier du dashboard EVE.

## Contrôles & Mesures Implémentées

1. **En-têtes de Sécurité & CSP :**
   - Implémentation du middleware `securityHeadersMiddleware` (`src/server/middleware/security.ts`).
   - `Content-Security-Policy` stricte (`default-src 'self'`, `img-src` restreint à `https://images.evetech.net`, connectivité limitée à `esi.evetech.net` et `login.eveonline.com`, directive `frame-ancestors` autorisant l'aperçu sécurisé AI Studio et Cloud Run).
   - `X-Content-Type-Options: nosniff`.
   - `Referrer-Policy: strict-origin-when-cross-origin`.
   - `Permissions-Policy` désactivant les APIs non utilisées (caméra, micro, géolocalisation, paiement).
   - Suppression systématique du header d'empreinte Express `X-Powered-By`.
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains` sous HTTPS.

2. **Protection CSRF & CORS Stricte :**
   - Implémentation du middleware `csrfProtectionMiddleware` sur toutes les mutations HTTP (`POST`, `PUT`, `DELETE`, `PATCH`).
   - Rejet des requêtes avec en-tête `Origin` ou `Referer` non autorisés (erreur `403 Forbidden: CSRF validation failed`).
   - CORS restrictif autorisant uniquement les origines autorisées et les méthodes explicites.

3. **Isolation Inter-Personnages & Multi-Tenant Sécurisé :**
   - Implémentation du validateur serveur `validateCharacterSessionAccess`.
   - Vérification systématique sur tous les endpoints Ledger, Orders, Hubs, ROI et Assets : tout accès à des données de personnages non rattachés à la session active est strictement rejeté en `403 Forbidden`.

4. **Expurgation des Logs & Secrets :**
   - Implémentation de `logger` (`src/server/utils/logger.ts`) avec masquage automatique (`[REDACTED]`) des en-têtes Authorization (`Bearer`), jetons OAuth (`access_token`, `refresh_token`), codes PKCE, secrets client et identifiants de session (`eve_session_id`).
   - Aucune fuite de tokens dans les erreurs HTTP retournées aux clients.

5. **Minimisation des Scopes & Conformité CCP :**
   - Audit complet des scopes demandés dans `DEFAULT_SCOPES` : 100% en lecture seule (`esi-wallet.read_*`, `esi-markets.read_*`, `esi-corporations.read_*`, `esi-assets.read_*`).
   - Zéro scope de modification de marché ou d'écriture d'ordres.
   - User-Agent contractuel conforme aux directives CCP.

6. **Purge de Session & Révocation Locale :**
   - Endpoint `/api/auth/logout` et `/api/auth/character/:characterId` avec suppression immédiate des tokens en mémoire et nettoyage des cookies HTTP-only avec les bons flags de sécurité.

## Critères de Sortie
- [x] Tests unitaires et d'intégration validant les refus session/personnage/scope/CSRF (`src/server/security/security.test.ts`).
- [x] Aucun jeton ou secret exposé dans les bundles, réponses ou logs.
- [x] Logs expurgés avec filtrage d'expressions régulières sensibles.
- [x] Audit de conformité développeur CCP validé.
- [x] CI verte sur l'intégralité des suites de tests.

## Risques Résiduels Consignés
- **Stockage en mémoire temporaire :** Les sessions restent hébergées en mémoire vive dans le SessionStore du serveur d'exécution, nécessitant une ré-authentification lors du redémarrage du processus (acceptable pour le stade actuel).
