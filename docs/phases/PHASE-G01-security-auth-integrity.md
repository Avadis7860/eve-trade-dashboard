# Phase G01 — Sécurité de Production & Intégrité Authentification

## 1. Statut
`TERMINÉE`

## 2. Objectif
Garantir l'inviolabilité absolue de l'environnement de production en éliminant physiquement tout montage de routes de test ou de reset, en imposant une cryptographie 256 bits sans fallback permissif pour les sessions, et en empêchant toute corruption ou révocation de refresh tokens OAuth CCP lors d'appels concurrents.

## 3. Problème architectural
L'audit de production a mis en évidence plusieurs vulnérabilités critiques :
1. **Risque d'exposition des routes E2E (S0-1) :** Les routes `/api/test/*` permettant le reset ou l'injection d'état risquent d'être activées en production si des variables d'environnement sont mal configurées.
2. **Fallback de clé cryptographique (S1-2) :** `crypto.ts` et `service.ts` utilisent des valeurs de clé de chiffrement par défaut en dur si `SESSION_ENCRYPTION_KEY` n'est pas définie, affaiblissant la sécurité des cookies de session.
3. **Absence de single-flight OAuth (S1-3) :** Plusieurs requêtes concurrentes utilisant un token expiré pour un même personnage déclenchent simultanément des requêtes de rafraîchissement vers CCP SSO, risquant d'invalider le refresh token du joueur par révocation unilatérale côté CCP.
4. **Contrôle CSRF / Origin (R-04) :** Nécessité de formaliser et tester l'audit d'herméticité des origines, du parsing d'en-têtes et des cookies `SameSite=Lax/Strict`.
5. **Mutation concurrente de session (R-06) :** Risque d'écrasement de session lors de bascules rapides de personnage actif (`activeCharacterId`).

## 4. Constats traités
* `S0-1` : Routes E2E accessibles en production.
* `S1-2` : Fallback de clé cryptographique en production.
* `S1-3` : Absence de single-flight OAuth (local et inter-processus).
* `R-04` : Qualification finale et durcissement des politiques CSRF / Origin / CORS.
* `R-06` : Cohérence atomique des mutations de session (`activeCharacterId`).

## 5. Décisions architecturales
* **Verrouillage physique des routes E2E :**
  Le routeur `/api/test/*` n'est enregistré dans Express que si `process.env.NODE_ENV !== 'production'`. En production, aucune variable ne permet de réactiver ces routes ; toute requête retourne obligatoirement `404 Not Found`.
* **Fail-Fast cryptographique :**
  Au démarrage en mode `NODE_ENV === 'production'`, la présence d'une `SESSION_ENCRYPTION_KEY` valide (64 caractères hexadécimaux / 32 octets) est un prérequis bloquant. Tout manquement provoque l'arrêt immédiat du processus (exit code 1).
* **Single-Flight OAuth hybride :**
  Coalescence locale des promesses via `Map<characterId, Promise<TokenResponse>>` au sein du même processus, doublée d'un verrou logique/lease court en base de données pour la coordination multi-instances.
* **Mutation atomique de session :**
  Le `ISessionStore` utilise des opérations atomiques avec versioning pour garantir que la sélection de `activeCharacterId` ne peut pas écraser un personnage tiers authentifié.

## 6. Non-objectifs
* Ne pas modifier le protocole EVE SSO PKCE S256 côté client.
* Ne pas introduire de service OAuth ou IAM tiers (Auth0, Firebase Auth, Keycloak).
* Ne pas modifier les scopes ESI demandés au joueur.

## 7. Dépendances
* Phases 00 à 12 et série F01 à F11 complétées.

## 8. Modules concernés
* `src/server/auth/router.ts`
* `src/server/auth/service.ts`
* `src/server/auth/crypto.ts`
* `src/server/auth/sessionStore.ts`
* `src/server/middleware/security.ts`
* `server.ts`
* Tests associés : `src/server/auth/auth.test.ts`, `src/server/auth/crypto.test.ts`, `src/server/auth/sessionStore.test.ts`, `src/server/security/security.test.ts`

## 9. Contrats impactés
* `ISessionStore`
* `IAuthService`
* En-têtes HTTP de sécurité & configuration d'environnement.

## 10. Travaux à réaliser
1. Refactoriser le montage des routes E2E dans `server.ts` et `router.ts` pour une exclusion inconditionnelle en production.
2. Mettre à jour `crypto.ts` pour imposer la validation stricte de `SESSION_ENCRYPTION_KEY` au bootstrap sans fallback secret codé en dur en production.
3. Implémenter le pattern Single-Flight avec déduplication locale et coordination SQL pour `refreshToken(characterId)`.
4. Écrire des tests de sécurité et de concurrence simulant 50 rafraîchissements concurrents.

## 11. Invariants à préserver
* Aucun token ni secret d'authentification ne transite vers le client web (navigateur).
* `activeCharacterId` doit obligatoirement faire partie des personnages liés à la session courante.
* L'expiration d'une session invalide immédiatement les accès aux endpoints protégés.

## 12. Tests obligatoires
* **Unitaires :** Validation du rejet des clés invalides, test de dérivation cryptographique.
* **Intégration HTTP :** Vérification que les routes `/api/test/*` répondent `404` en configuration `NODE_ENV=production`.
* **Concurrence :** 50 requêtes simultanées à un endpoint avec token expiré ne déclenchent qu'un seul appel vers CCP SSO.
* **Sécurité :** Rejet des attaques CSRF avec Origin falsifié ou malformé.

## 13. Scénarios de régression
* Connexion SSO normale d'un nouveau personnage.
* Persistance multi-personnages fonctionnelle dans l'iframe Google AI Studio.

## 14. Critères d'entrée
* Série F01–F11 validée et mergée sur `main`.

## 15. Critères de sortie
* Zéro route E2E accessible en environnement de production.
* Crash immédiat au démarrage si `SESSION_ENCRYPTION_KEY` est absente en production.
* 100% des tests de concurrence OAuth au vert.

## 16. Preuves obligatoires
* Test HTTP simulant `NODE_ENV=production` démontrant la réponse `404` sur toutes les routes de test.
* Test de charge simulant 50 rafraîchissements concurrents prouvant l'appel unique vers CCP SSO.

## 17. Risques résiduels
* Révocation manuelle du consentement sur le portail CCP devant renvoyer un code `401 Re-Auth Required` propre.

## 18. Décision release
`BLOQUANTE`
