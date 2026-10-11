# Phase S01 — Transport Hybride Unifié & Déconnexion Déterministe

## 1. Statut
`TERMINÉE`

## 2. Objectif
Résoudre définitivement l'impossibilité de se déconnecter et les pertes d'authentification dans l'environnement iframe Google AI Studio en unifiant l'intégralité des requêtes frontend sous le transport hybride (`Authorization: Bearer <sessionId>` + `X-Session-ID`), en rendant la déconnexion explicite côté serveur, et en neutralisant la boucle de reconnexion automatique forcée (`auto_resume`).

## 3. Problème Architectural
L'audit technique (`docs/AUDIT-AI-STUDIO-SESSION-FAILURES.md`) a mis en évidence :
1. **Appels HTTP non authentifiés :** Le client React (`src/App.tsx`) appelle l'API native `fetch('/api/auth/logout')` sans en-tête de session. Dans l'iframe Google AI Studio, où les cookies tiers sont bloqués, le serveur ne reçoit aucun identifiant et n'invalide jamais la session.
2. **Boucle infernale d'auto-reprise :** La requête racine `/api/auth/session?auto_resume=true` se redéclenche immédiatement après la purge locale du cache, forçant le serveur à renvoyer la session non purgée.
3. **Ré-écriture agressive en `localStorage` :** Un effet de bord réactif réinjecte instantanément l'identifiant de session dans le stockage navigateur dès qu'une réponse d'auto-reprise arrive, annulant la déconnexion en quelques millisecondes.
4. **Appels mutatifs orphelins :** Plus de 12 fonctions mutatives (`sync`, `restock`, `hubs`, `allocations`) utilisent `fetch` natif sans en-tête Bearer et échouent ou perdent leur contexte de session dans l'iframe.

## 4. Constats Traités
* `CR-S01` : Impossible de se déconnecter (Logout loop / Auto-resume forcé).
* `CR-S06` : Mutations métier non authentifiées dans l'iframe.

## 5. Décisions Architecturales
* **Normalisation stricte vers `fetchJson` :**
  Remplacement de tous les appels directs à l'API native `fetch` dans `src/App.tsx` et les composants enfants par `fetchJson` ou des hooks `useApiMutation`.
* **Transport Bearer universel :**
  L'utilitaire `fetchJson` garantit l'adjonction systématique de `Authorization: Bearer ${sessionId}` et `X-Session-ID: ${sessionId}` pour toutes les requêtes HTTP (`GET`, `POST`, `PUT`, `DELETE`).
* **Déconnexion explicite et purge bilatérale :**
  - Le frontend transmet le `sessionId` explicite dans le corps et l'en-tête de `POST /api/auth/logout`.
  - Le serveur détruit la session dans `SessionStore` et supprime la ligne en persistance SQL/fichier.
  - Le frontend pose un drapeau transitoire d'intention de déconnexion (`logout_intent`) pour désactiver l'auto-reprise automatique.
* **Auto-reprise conditionnée :**
  L'auto-reprise n'est autorisée qu'au chargement initial si un `storedSessionId` valide préexiste, ou sur action explicite « Reprendre ma flotte ».

## 6. Non-objectifs
* Ne pas modifier le format de chiffrement des tokens AES-256-GCM.
* Ne pas altérer le comportement de l'adaptateur de stockage relationnel PostgreSQL ou fichier.
* Ne pas changer les endpoints ESI ou la logique de réconciliation financière.

## 7. Dépendances
* Phases G01 à G05 complétées.
* Audit contradictoire `docs/AUDIT-AI-STUDIO-SESSION-FAILURES.md`.

## 8. Modules Concernés
* `src/utils/apiClient.tsx`
* `src/App.tsx`
* `src/server/auth/router.ts`
* `src/server/auth/service.ts`
* Tests associés : `src/utils/apiClient.test.tsx`, `src/server/auth/auth.test.ts`, `src/App.test.tsx`

## 9. Contrats Impactés
* `POST /api/auth/logout` : acceptation du `sessionId` via Bearer header et corps JSON `{ sessionId }`.
* `GET /api/auth/session` : suspension d'auto-reprise si aucun jeton valide n'est fourni et si déconnexion active.

## 10. Travaux à Réaliser
1. Étendre `fetchJson` dans `src/utils/apiClient.tsx` pour supporter nativement toutes les méthodes HTTP et sérialiser les corps JSON.
2. Remplacer tous les `fetch(...)` natifs dans `src/App.tsx` par `fetchJson(...)`.
3. Corriger `handleLogout` pour envoyer la requête de déconnexion avec son Bearer token et son payload identifiant.
4. Mettre à jour `POST /api/auth/logout` dans `src/server/auth/router.ts` pour extraire le `sessionId` depuis l'en-tête Bearer, le cookie ou le corps JSON, et supprimer durablement la session.
5. Conditionner l'interrogation de `/api/auth/session` pour désactiver `auto_resume` lors d'un logout intentionnel.
6. Rédiger les tests automatisés vérifiant la déconnexion complète et l'absence de reconnexion automatique intempestive.

## 11. Critères d'Acceptation & Qualification
* [x] Un clic sur le bouton de déconnexion déconnecte immédiatement l'application sans reconnexion automatique.
* [x] La session est supprimée à la fois de la mémoire du serveur, de la base de données et du `localStorage`.
* [x] L'écran d'accueil déconnecté persiste après rechargement de page (F5) sans réactivation spontanée.
* [x] Toutes les mutations de l'application (`sync`, `restock`, `hubs`, etc.) transmettent le token Bearer avec succès.
* [x] La suite de tests `npm test` est 100 % verte.
