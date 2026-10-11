# Phase S02 — Sélection et Invariance du Personnage Principal

## 1. Statut
`TERMINÉE`

## 2. Objectif
Résoudre l'impossibilité de choisir le personnage principal dans le sélecteur d'écosystème multi-personnages, éliminer l'écrasement unilatéral du personnage actif lors du rafraîchissement périodique des jetons CCP, et garantir l'alignement strict des identifiants dans la persistance.

## 3. Problème Architectural
L'audit technique (`docs/AUDIT-AI-STUDIO-SESSION-FAILURES.md`) a identifié :
1. **Échec HTTP 400 sur la bascule de personnage :** `handleSwitchCharacter` appelle `fetch('/api/auth/switch')` sans Bearer token, provoquant une erreur 400 Bad Request immédiate et bloquant toute interaction.
2. **Écrasement forcé en arrière-plan :** Dès qu'un token périphérique expire, `AuthService.getValidSession` bascule automatiquement le personnage actif sur le premier personnage rencontré dont le token est valide, annulant le choix de l'utilisateur.
3. **Désalignement de typage :** `activeCharacterId` peut être sérialisé sous forme de chaîne de caractères dans certaines représentations, provoquant un échec de résolution dans le dictionnaire des personnages et un repli forcé sur `Object.values(characters)[0]`.
4. **Suppression de personnage fragile :** `handleUnlinkCharacter` souffre également de l'absence de transport Bearer et échoue dans l'iframe.

## 4. Constats Traités
* `CR-S02` : Rejet HTTP 400 du changement de personnage principal.
* `CR-S03` : Écrasement forcé du personnage actif lors du refresh de token.

## 5. Décisions Architecturales
* **Authentification de la bascule de personnage :**
  Utilisation de `fetchJson` pour `POST /api/auth/switch` et `DELETE /api/auth/character/:id` avec transmission systématique du Bearer token et du `sessionId`.
* **Invariance absolue de `activeCharacterId` :**
  L'algorithme de rafraîchissement des jetons dans `AuthService` ne modifie **jamais** `activeCharacterId`. Si le jeton du personnage actif expire et échoue à se renouveler, l'état d'expiration est remonté sans permuter silencieusement vers un autre personnage.
* **Typage numérique strict et canonique :**
  `activeCharacterId` et `characterId` sont systématiquement normalisés en `number` (BigInt/Number) à la lecture et à l'écriture dans `SessionStore`, dans le schéma SQL et dans le snapshot JSON.
* **Mise à jour atomique et synchronisée :**
  La sélection d'un nouveau personnage principal met à jour de façon atomique la session en mémoire et persiste immédiatement la modification dans la base de données.

## 6. Non-objectifs
* Ne pas modifier le composant visuel de dropdown dans la barre de navigation.
* Ne pas modifier les scopes ESI demandés aux personnages.
* Ne pas interférer avec les flux de synchronisation des portefeuilles ou des ordres.

## 7. Dépendances
* Phase S01 (Transport hybride unifié).
* Audit contradictoire `docs/AUDIT-AI-STUDIO-SESSION-FAILURES.md`.

## 8. Modules Concernés
* `src/App.tsx`
* `src/server/auth/router.ts`
* `src/server/auth/service.ts`
* `src/server/auth/sessionStore.ts`
* Tests associés : `src/server/auth/auth.test.ts`, `src/server/auth/sessionStore.test.ts`, `src/App.test.tsx`

## 9. Contrats Impactés
* `POST /api/auth/switch` : acceptation du token Bearer et validation stricte du lien entre le personnage et la session.
* `IAuthService` : interdiction formelle de substitution de `activeCharacterId` lors de `refreshAllExpiredCharacters`.

## 10. Travaux à Réaliser
1. Remplacer `fetch('/api/auth/switch')` par `fetchJson` dans `src/App.tsx`.
2. Remplacer `fetch('/api/auth/character/:id')` par `fetchJson` dans `src/App.tsx`.
3. Supprimer le bloc de permutation automatique dans `AuthService.getValidSession` (`src/server/auth/service.ts`).
4. Sécuriser `SessionStore.switchActiveCharacter` avec vérification de type `Number(characterId)` et persistance immédiate.
5. Vérifier la cohérence de chargement dans `SessionStore.loadFromStorageSync` et `SessionStore.init`.
6. Écrire des tests unitaires validant :
   - Le changement effectif du personnage actif par requête authentifiée Bearer.
   - La conservation du personnage actif lors d'une expiration simulée des jetons des 10 autres personnages.
   - La suppression propre d'un personnage de la flotte avec recalcul du personnage actif uniquement si le personnage supprimé était l'actif.

## 11. Critères d'Acceptation & Qualification
* [x] Sélectionner un personnage dans le menu déroulant change instantanément le personnage actif et son badge « ACTIF ».
* [x] Le personnage sélectionné reste actif après actualisation de la page (F5).
* [x] Le rafraîchissement automatique des jetons en arrière-plan n'altère jamais le personnage actif sélectionné.
* [x] Délier un personnage retire ce personnage sans impacter les autres personnages liés.
* [x] Tous les tests unitaires et d'intégration de session sont 100 % verts.
