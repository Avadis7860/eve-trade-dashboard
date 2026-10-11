# PHASE-01 — SSO et identité personnage

**Type :** développement · **Dépendance :** 00

Objectif : connexion EVE SSO et session privée, sans jeton dans le navigateur.

Inclus : application CCP et callback ; flux OAuth documenté par CCP, state à usage unique, PKCE si pris en charge ; validation JWT/JWKS, issuer, audience, expiration et identité ; scopes minimaux et consentement ; échange/refresh côté serveur ; stockage protégé des refresh tokens ; cookie sécurisé, endpoint de session, reconnexion et déconnexion.

Exclus : collecte métier et écriture ESI.

Sortie : tests simulés de retours valides/invalides, state rejoué, JWT expiré/incorrect, scope refusé ; aucun secret dans bundle/logs/API ; renouvellement et déconnexion vérifiés ; toutes les routes privées exigent session et identité autorisée.