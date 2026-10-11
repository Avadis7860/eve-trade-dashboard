# Audit Technique Approfondi — Défaillances de Session, Déconnexion et Sélection Multi-Personnages en Environnement Google AI Studio

**Projet :** Avadis7860/eve-trade-dashboard  
**Date d'audit :** 8 Octobre 2026  
**Environnement audité :** Conteneur Google AI Studio / Cloud Run (Iframe cross-origin `run.app` sous `googleusercontent.com`)  
**Statut :** Constat contradictoire pré-correction (Aucune modification de code durant l'audit)  
**Références contractuelles :** `GEMINI.md`, `SECURITY_PRIVACY.md`, `oauth-integration` (`SKILL.md`), `PHASE-F11-multi-character-session-persistence.md`  

---

## 1. Contexte et Problématique Constatée

Dans le cadre des améliorations apportées pour gérer la persistance et la reconnexion des sessions multi-personnages (flotte de 11 personnages) dans l'environnement hébergé Google AI Studio (Phase F11), trois défaillances critiques et interdépendantes ont été signalées :

1. **Impossibilité de se déconnecter :** L'utilisateur clique sur le bouton de déconnexion, mais l'application le reconnecte automatiquement en boucle (reprise immédiate sans possibilité de rester déconnecté).
2. **Impossibilité de choisir le personnage principal sélectionné :** Le changement de personnage dans le menu déroulant n'a aucun effet (échec silencieux), ou est immédiatement écrasé par le premier personnage de la liste lors du cycle de vie de la session.
3. **Impossibilité de conserver les connexions déjà établies :** Lors des redémarrages de conteneur, recompilations ou ajouts de nouveaux personnages, la flotte précédemment liée est perdue, écrasée par une nouvelle session monopersonnage, ou inaccessible.

Le présent audit dissèque méthodiquement les causes racines dans l'ensemble des couches (client React, router Express, service d'authentification, store de session, adaptateurs de stockage et contraintes d'iframe AI Studio).

---

## 2. Analyse Approfondie des Causes Racines

### 2.1 Défaillance 1 : Impossibilité de se déconnecter (Logout Loop & Reconnexion Forcée)

#### Cause Racine 1.A : Utilisation de `fetch` natif sans en-tête d'authentification
Dans `src/App.tsx` (lignes 1130-1139) :
```typescript
const handleLogout = async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' }); // ❌ fetch natif SANS Bearer
  } catch (err) {
    console.error('Logout failed:', err);
  } finally {
    setStoredSessionId(null);
    queryClient.clear();
  }
};
```
* **Mécanisme :** Dans l'environnement Google AI Studio, l'application s'exécute dans une iframe tierce. Les navigateurs modernes (Chrome CHIPS, Safari ITP, Firefox) bloquent ou partitionnent les cookies tiers (`eve_session_id`).
* **Conséquence côté backend (`src/server/auth/router.ts`) :**
  ```typescript
  router.post('/logout', (req: Request, res: Response) => {
    const sessionId = extractSessionId(req); // -> undefined
    if (sessionId) {
      authService.logout(sessionId); // ❌ Non exécuté !
    }
    res.clearCookie(SESSION_COOKIE_NAME, ...);
    res.json({ success: true });
  });
  ```
  Le serveur ne recevant ni cookie ni header `Authorization: Bearer <sessionId>`, `extractSessionId(req)` renvoie `undefined`. L'appel `authService.logout(sessionId)` n'est jamais déclenché : **la session reste vivante et intacte en mémoire et en base de données**.

#### Cause Racine 1.B : Auto-reprise inconditionnelle par `auto_resume=true`
Dans `src/App.tsx` (lignes 487-495) :
```typescript
const { data: sessionData } = useApiQuery<AuthSessionResponse>(
  ['auth', 'session'],
  () => fetchJson('/api/auth/session?auto_resume=true'), // ❌ Forcé à chaque requête
  { ttl: 30_000 }
);
```
Lorsque `handleLogout` vide le cache client (`queryClient.clear()`), le composant React se ré-exécute et relance immédiatement la requête `/api/auth/session?auto_resume=true`.
Côté backend (`src/server/auth/router.ts`, lignes 330-344) :
```typescript
if (!sessionId) {
  const autoResume = req.query.auto_resume === 'true' || req.query.auto_resume === '1';
  if (autoResume && savedSessions.length > 0) {
    const resumed = await authService.getValidSession(savedSessions[0].sessionId);
    if (resumed) {
      res.json({ ...authService.getPublicSessionInfo(resumed), sessionId: resumed.sessionId });
      return;
    }
  }
}
```
Comme la session n'a pas été supprimée en base lors de l'appel 1.A, `savedSessions` contient toujours la session précédente. Le serveur la réactive automatiquement sans intervention utilisateur et la renvoie avec code HTTP 200.

#### Cause Racine 1.C : Ré-injection automatique dans le `localStorage`
Dans `src/App.tsx` (lignes 981-985) :
```typescript
useEffect(() => {
  if (sessionData?.sessionId) {
    setStoredSessionId(sessionData.sessionId); // ❌ Ré-écriture réactive
  }
}, [sessionData]);
```
Le client reçoit la réponse d'auto-reprise et réécrit instantanément le `sessionId` dans le `localStorage`. La déconnexion est annulée en moins de 100 millisecondes. L'utilisateur est piégé dans une boucle de reconnexion continue.

---

### 2.2 Défaillance 2 : Impossibilité de choisir le personnage principal sélectionné

#### Cause Racine 2.A : Échec HTTP 400 silencieux lors du changement de personnage
Dans `src/App.tsx` (lignes 1081-1099) :
```typescript
const handleSwitchCharacter = async (characterId: number) => {
  try {
    const res = await fetch('/api/auth/switch', { // ❌ fetch natif SANS Bearer
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId }),
    });
    if (res.ok) {
      setShowCharacterDropdown(false);
      queryClient.invalidateQueries(['auth']);
    }
  } catch (err) {
    console.error('Failed to switch character:', err);
  }
};
```
* **Mécanisme :** Comme pour la déconnexion, l'appel `fetch` natif n'injecte aucun en-tête `Authorization: Bearer <sessionId>`.
* **Côté backend (`src/server/auth/router.ts`, lignes 373-379) :**
  ```typescript
  router.post('/switch', (req: Request, res: Response) => {
    const sessionId = extractSessionId(req); // -> undefined
    const { characterId } = req.body;
    if (!sessionId || !characterId) {
      res.status(400).json({ error: 'sessionId and characterId are required' }); // ❌ Erreur 400
      return;
    }
  ```
* **Résultat :** Le serveur rejette systématiquement la requête avec une erreur 400. La branche `if (res.ok)` n'est jamais exécutée, le menu ne se ferme pas, et le personnage principal ne change jamais.

#### Cause Racine 2.B : Écrasement forcé du personnage actif lors du rafraîchissement des jetons
Dans `src/server/auth/service.ts` (lignes 449-462) :
```typescript
if (hasExpiredChar) {
  try {
    const refreshed = await this.refreshAllExpiredCharacters(session);
    if (refreshed.expiresAt > now) {
      return refreshed;
    }
    // ⚠️ ALGORITHME DÉFECTUEUX :
    if (refreshed.characters) {
      for (const char of Object.values(refreshed.characters)) {
        if (char.expiresAt > now) {
          return this.sessionStore.switchActiveCharacter(sessionId, char.characterId); // ❌ ÉCRASEMENT
        }
      }
    }
  }
}
```
* **Mécanisme :** Dès qu'un personnage lié approche de l'expiration (< 60 secondes), `getValidSession` lance `refreshAllExpiredCharacters`. Si pour une raison quelconque (latence CCP, token révoqué temporairement, décalage d'horloge) `refreshed.expiresAt` n'a pas été rehaussé sur la session globale, le code parcourt l'objet `characters` et **force arbitrairement le premier personnage valide rencontré comme personnage actif**.
* **Résultat :** Le personnage choisi par l'utilisateur est unilatéralement écrasé en arrière-plan sans notification ni consentement.

#### Cause Racine 2.C : Désalignement de clé lors du rechargement de stockage
Dans `src/server/auth/sessionStore.ts` (lignes 58 & 138) :
```typescript
const activeChar = characters[storedSess.activeCharacterId] || Object.values(characters)[0];
```
Si `storedSess.activeCharacterId` est stocké sous forme de chaîne (`"777001"`) alors que l'objet `characters` est indexé par nombre (`777001`), la recherche par clé directe échoue et retombe silencieusement sur `Object.values(characters)[0]`, réinitialisant le personnage principal au premier dans l'ordre d'itération mémoire.

---

### 2.3 Défaillance 3 : Impossibilité de conserver les connexions déjà établies

#### Cause Racine 3.A : Omission de l'initialisation du `SessionStore` au démarrage
Dans `server.ts` (lignes 171-180) :
```typescript
// 1. DB Connected & Migrations Applied
const storage = StorageManager.getInstance();
await storage.initAsync();

// 2. Services Init & Store Init -> COMMENTAIRE VIDE !
console.log('[Bootstrap] Services Ready');
```
* **Mécanisme :**
  - La classe `SessionStore` (`src/server/auth/sessionStore.ts`) implémente `public async init(): Promise<void>` pour recharger les tables `sessions` et `session_characters` depuis PostgreSQL.
  - Or, cette méthode `defaultSessionStore.init()` n'est **jamais appelée** dans `bootstrapApp()` ni au démarrage du serveur.
  - Le constructeur de `SessionStore` n'exécute que `loadFromStorageSync()` qui ne gère que les fichiers JSON locaux.
* **Résultat :** À chaque redémarrage du conteneur en environnement hébergé, la mémoire du serveur redémarre avec zéro session, rendant inopérante la persistance SQL des 11 personnages.

#### Cause Racine 3.B : Écrasement de la flotte lors d'un ajout de personnage via lien `<a>`
Dans `src/App.tsx` (ligne 1344) :
```html
<a href="/api/auth/login" title="Lier un autre personnage EVE SSO">
```
* **Mécanisme :** Ce bouton est un simple lien hypertexte balise `<a>`. Il ne transmet aucun en-tête `Authorization: Bearer <sessionId>` et aucun paramètre de requête `?session_id=...`.
* **Conséquence côté backend (`src/server/auth/router.ts`) :**
  ```typescript
  let existingSessionId = extractSessionId(req);
  if (!existingSessionId && typeof req.query.session_id === 'string') {
    existingSessionId = req.query.session_id.trim();
  }
  ```
  Le serveur reçoit `existingSessionId = undefined`.
  Lorsque CCP redirige vers `/api/auth/callback`, le serveur exécute :
  `return this.sessionStore.createSession(...)` au lieu de `addOrUpdateCharacter(...)`.
* **Résultat :** L'ancien trousseau de flotte est abandonné et une nouvelle session isolée ne contenant que ce nouveau personnage est créée.

#### Cause Racine 3.C : Rupture de communication de la pop-up OAuth en iframe
Selon les spécifications strictes de Google AI Studio (`/skills/system_skills/oauth/SKILL.md`) :
- L'application s'exécute dans une iframe (`run.app` sous Google).
- Si le flux OAuth CCP s'ouvre dans une pop-up et que le navigateur coupe la référence `window.opener` pour des raisons de sécurité cross-origin (`Cross-Origin-Opener-Policy`), la page de callback exécute :
  `window.location.href = redirectTarget;`
- Or, le conteneur AI Studio ne fonctionne **pas** directement dans une fenêtre indépendante hors iframe (*"shows a static fallback page indefinitely"*).
- La fenêtre pop-up reste bloquée, le message `EVE_AUTH_SUCCESS` n'est jamais reçu par l'iframe mère, et la session n'est jamais mise à jour.

#### Cause Racine 3.D : Multiplicité des appels d'actions mutatives non authentifiés
Au moins 12 fonctions dans `src/App.tsx` utilisent l'API native `fetch` sans en-têtes de session :
- `fetch('/api/auth/logout')`
- `fetch('/api/auth/switch')`
- `fetch('/api/auth/character/:id')`
- `fetch('/api/ledger/sync')`
- `fetch('/api/orders/restock/generate')`
- `fetch('/api/orders/restock')`
- `fetch('/api/hubs')`
- `fetch('/api/hubs/mappings')`
- `fetch('/api/roi/allocations')`
- `fetch('/api/roi/reconcile')`

---

## 3. Matrice de Criticité des Défaillances

| Réf | Défaillance observée | Composants touchés | Gravité | Risque utilisateur |
|---|---|---|---|---|
| **CR-S01** | Impossible de se déconnecter (Logout loop / Auto-resume forcé) | `src/App.tsx`, `src/server/auth/router.ts` | **Critique (Bloquant)** | Impossibilité de changer de compte ou de fermer sa session |
| **CR-S02** | Rejet HTTP 400 du changement de personnage principal | `src/App.tsx`, `src/server/auth/router.ts` | **Critique (Bloquant)** | Flotte inutilisable (bloquée sur un seul perso) |
| **CR-S03** | Écrasement forcé du personnage actif lors du refresh de token | `src/server/auth/service.ts` | **Majeure** | Perte continue du contexte métier sans action utilisateur |
| **CR-S04** | Perte des sessions au redémarrage serveur (Bootstrap incomplet) | `server.ts`, `src/server/auth/sessionStore.ts` | **Critique** | Déconnexion systématique à chaque recompilation/redémarrage |
| **CR-S05** | Écrasement de la flotte lors de l'ajout d'un personnage (Lien `<a>`) | `src/App.tsx`, `src/server/auth/router.ts` | **Majeure** | Perte des 10 autres personnages lors de la connexion du 11e |
| **CR-S06** | Mutations métier non authentifiées dans l'iframe | `src/App.tsx` (12+ occurrences de `fetch`) | **Majeure** | Échec des synchronisations et réconciliations dans l'iframe |

---

## 4. Stratégie de Remédiation en 3 Phases

Pour respecter rigoureusement la règle du projet :
**1 phase = 1 chantier = 1 branche = 1 Pull Request**, le travail de remédiation est structuré en trois phases successives de la **Série S** :

```
┌────────────────────────────────────────────────────────────────────────┐
│               SÉRIE S : SESSIONS & RÉSILIENCE GOOGLE AI STUDIO         │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  [PHASE S01] Transport Hybride Unifié & Déconnexion Déterministe       │
│    - Élimination de tous les fetch natifs -> fetchJson                 │
│    - Injection systématique Authorization: Bearer + X-Session-ID       │
│    - Déconnexion explicite déterministe (suppression côté serveur)     │
│    - Conditionnement de l'auto-resume (fin de la boucle de reconnexion)│
│                                                                        │
│  [PHASE S02] Sélection & Invariance du Personnage Principal            │
│    - Sécurisation de /api/auth/switch avec Bearer                      │
│    - Invariance de activeCharacterId lors des refresh de tokens CCP    │
│    - Typage strict et alignement de clés dans SessionStore             │
│    - Tests unitaires et d'intégration de non-régression                │
│                                                                        │
│  [PHASE S03] Pérennité des Flottes & Résilience Iframe AI Studio       │
│    - Appel bloquant sessionStore.init() dans bootstrapApp()            │
│    - Remplacement du lien <a> d'ajout de personnage par bouton lié     │
│    - Pont pop-up/callback OAuth résilient sans blocage d'iframe        │
│    - Survie intégrale de la flotte de 11 personnages aux redémarrages  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Conclusion de l'Audit

Les trois défaillances observées trouvent leur origine dans une **mise en œuvre incomplète du transport hybride Cookie + Bearer Token** : l'en-tête Bearer était supporté par le serveur mais ignoré par plusieurs composants vitaux du frontend (`handleLogout`, `handleSwitchCharacter`, `handleSync`, etc.), combiné à une boucle d'auto-reprise agressive et à l'omission d'initialisation du store lors du bootstrap du serveur.

Le plan d'action de la Série S (S01, S02, S03) apporte une réponse chirurgicale, modulaire et vérifiable par tests, garantissant une expérience fluide et pérenne pour les utilisateurs de flottes multi-personnages dans Google AI Studio.
