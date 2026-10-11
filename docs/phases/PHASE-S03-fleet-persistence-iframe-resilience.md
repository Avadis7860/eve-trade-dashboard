# Phase S03 — Pérennité des Flottes et Résilience Iframe Google AI Studio

## 1. Statut
`TERMINÉE`

## 2. Objectif
Garantir la conservation intégrale des flottes connectées (jusqu'à 11 personnages) à travers les redémarrages de serveur et les mises à jour de conteneur dans Google AI Studio, sécuriser le rattachement de personnages supplémentaires sans écrasement de flotte, et fiabiliser la communication pop-up OAuth CCP dans l'environnement iframe.

## 3. Problème Architectural
L'audit technique (`docs/AUDIT-AI-STUDIO-SESSION-FAILURES.md`) a identifié :
1. **Omission du chargement asynchrone au bootstrap :** `server.ts` n'appelle jamais `defaultSessionStore.init()`. Lors d'un démarrage avec PostgreSQL ou en conteneur hébergé, la mémoire du serveur démarre vide de toute session, ignorant les données persistées.
2. **Écrasement de la flotte lors de l'ajout d'un personnage :** Le lien `<a href="/api/auth/login">` dans l'en-tête ne transmet aucun identifiant de session, ce qui pousse le serveur à créer une nouvelle session monopersonnage qui isole et masque la flotte précédente.
3. **Rupture de communication pop-up / iframe :** Lorsque le flux CCP SSO se termine dans une pop-up et que `window.opener` est restreint par les politiques d'isolement cross-origin, la redirection vers l'URL du conteneur échoue (car le conteneur ne peut s'afficher que dans une iframe), bloquant l'utilisateur sur une page blanche.

## 4. Constats Traités
* `CR-S04` : Perte des sessions au redémarrage serveur (Bootstrap incomplet).
* `CR-S05` : Écrasement de la flotte lors de l'ajout d'un personnage (Lien `<a>`).

## 5. Décisions Architecturales
* **Bootstrap asynchrone ordonné et bloquant :**
  Dans `server.ts` (`bootstrapApp`), l'appel `await defaultSessionStore.init()` est inséré immédiatement après `await storage.initAsync()` et avant l'écoute du port HTTP. Le serveur ne commence à accepter des requêtes que lorsque l'ensemble des sessions et personnages est restauré en mémoire.
* **Bouton d'ajout contrôlé avec liaison garantie :**
  Remplacement de la balise `<a href="/api/auth/login">` par un bouton React appelant `handleEveLogin(sessionId)`. Le `sessionId` actif est systématiquement injecté dans la requête de création d'URL SSO et associé au paramètre `state` OAuth CSRF.
* **Pont pop-up / callback résilient :**
  Dans la page HTML de retour `/api/auth/callback`, si `window.opener` est inaccessible, la page n'effectue pas de redirection destructrice vers le conteneur mais affiche un écran de validation explicite avec instruction de fermer la fenêtre, tandis qu'un polling ou stockage local synchronisé informe l'iframe mère.
* **Trousseau de secours de flotte (.enc) :**
  Confirmation et durcissement de l'outil d'exportation/importation de flotte chiffré par mot de passe utilisateur, permettant de restaurer instantanément les 11 personnages en cas de réinitialisation complète du conteneur.

## 6. Non-objectifs
* Ne pas contourner les règles ESI ni stocker des refresh tokens en clair.
* Ne pas utiliser de stockage non chiffré.
* Ne pas modifier les autorisations OAuth CCP.

## 7. Dépendances
* Phases S01 (Transport hybride unifié) et S02 (Invariance du personnage actif).
* Audit contradictoire `docs/AUDIT-AI-STUDIO-SESSION-FAILURES.md`.

## 8. Modules Concernés
* `server.ts`
* `src/App.tsx`
* `src/components/ConfigurationView.tsx`
* `src/server/auth/router.ts`
* `src/server/auth/service.ts`
* `src/server/auth/sessionStore.ts`
* Tests associés : `server.test.ts`, `src/server/auth/sessionStore.test.ts`, `src/server/auth/auth.test.ts`

## 9. Contrats Impactés
* `bootstrapApp()` : séquence bloquante `DB Connected -> Migrations Applied -> SessionStore Hydrated -> Services Ready -> Listening`.
* `GET /api/auth/login` : transmission requise du `sessionId` pour tout rattachement de personnage.

## 10. Travaux à Réaliser
1. Mettre à jour `bootstrapApp()` dans `server.ts` pour appeler `await defaultSessionStore.init()`.
2. Mettre à jour `SessionStore.init()` pour consigner le nombre exact de sessions et de personnages restaurés.
3. Remplacer le lien `<a href="/api/auth/login">` dans `src/App.tsx` par un bouton appelant `handleEveLogin(getStoredSessionId() || sessionData?.sessionId)`.
4. Remplacer `handleLinkClick` dans `src/components/ConfigurationView.tsx` pour injecter le `sessionId` existant.
5. Sécuriser la page de callback dans `src/server/auth/router.ts` pour gérer gracieusement les cas où `window.opener` est null sans écran blanc.
6. Rédiger les tests d'intégration simulant un redémarrage complet du serveur avec rechargement des sessions depuis la persistance.

## 11. Critères d'Acceptation & Qualification
* [x] Après redémarrage du processus Node ou recompilation, toutes les sessions et tous les personnages liés sont conservés et immédiatement accessibles.
* [x] L'ajout d'un 2e, 3e jusqu'au 11e personnage lie bien chaque personnage à la flotte existante sans l'écraser.
* [x] La fenêtre pop-up de connexion CCP se ferme proprement et notifie l'iframe sans rester bloquée sur une page blanche.
* [x] Le trousseau de flotte chiffré exporte et réimporte fidèlement l'ensemble des 11 personnages.
* [x] La suite complète `npm test` et `npm run typecheck` est 100 % au vert.
