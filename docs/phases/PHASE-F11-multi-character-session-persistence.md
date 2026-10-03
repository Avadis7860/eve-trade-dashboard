# Phase F11 — Persistance des Sessions Multi-Personnages et Résilience Iframe

## 1. Contexte et Problème Constaté

### 1.1 Origine de l'anomalie
Dans l'environnement de développement et d'exécution hébergé (Google AI Studio / Cloud Run) :
- À chaque recompilation de code, redémarrage du processus Node (`node server.ts`), ou mise en veille du conteneur, l'intégralité des sessions utilisateur est perdue.
- La classe `SessionStore` (`src/server/auth/sessionStore.ts`) conserve actuellement les sessions uniquement en mémoire vive (`private sessions = new Map<string, UserSession>()`).
- Les sessions, leurs personnages liés (`characters: Record<number, LinkedCharacter>`) et leurs `refresh_token` OAuth ne sont jamais sauvegardés dans la base de données (`DurableFileDatabaseAdapter` ou PostgreSQL).
- L'application s'exécute dans une iframe (`run.app` sous `googleusercontent.com` ou `aistudio.google.com`), où les politiques de sécurité des navigateurs (CHIPS, ITP, blocage des cookies tiers) rejettent fréquemment les cookies `SameSite=Lax` ou vident le cookie `eve_session_id`.

### 1.2 Conséquence utilisateur
- Un utilisateur gérant 11 personnages de commerce doit reconnecter ses 11 personnages manuellement via CCP SSO à chaque modification, reconnexion ou redémarrage de l'environnement.
- Cette friction dégrade sévèrement l'expérience utilisateur et ralentit les tests en conditions réelles de flotte commerciale.

### 1.3 Fondement technique et opportunité
- Le protocole OAuth 2.0 avec PKCE de CCP EVE Online délivre un `refresh_token` pérenne pour chaque personnage autorisé (valable jusqu'à révocation explicite par le joueur).
- Dès lors que ce `refresh_token` est conservé de façon sécurisée et chiffrée côté serveur, le serveur est en mesure de renouveler automatiquement et silencieusement les `access_token` expirés (durée 20 minutes) sans aucune nouvelle interaction utilisateur.

---

## 2. Objectifs

1. **Persister durablement les sessions et personnages liés :**  
   Intégrer les sessions et les jetons de rafraîchissement au schéma de base de données durable de l'application (`sessions` et `session_characters`), garantissant la survie des 11 personnages après tout redémarrage du serveur.
2. **Chiffrement des secrets au repos :**  
   Chiffrer systématiquement les `refresh_token` et `access_token` stockés au repos via AES-256-GCM avec une clé applicative (`SESSION_ENCRYPTION_KEY` ou dérivée sécurisée) pour respecter `docs/SECURITY_PRIVACY.md`.
3. **Renouvellement automatique et transparent des 11 personnages :**  
   Au démarrage ou à la réception d'une requête, renouveler automatiquement les `access_token` périmés en arrière-plan via `POST https://login.eveonline.com/v2/oauth/token` sans aucune déconnexion ni popup.
4. **Résilience iframe Google AI Studio (Transport Hybride Cookie + Bearer) :**  
   Prendre en charge l'identification de session soit par le cookie `eve_session_id`, soit par l'en-tête HTTP `Authorization: Bearer <sessionId>` / `X-Session-ID` synchronisé avec le `localStorage` du navigateur.
5. **Trousseau de flotte exportable / importable (Procédure de secours) :**  
   Fournir une fonction d'export et d'import du trousseau des 11 personnages dans un fichier chiffré par mot de passe utilisateur (`fleet-tokens.enc`), permettant de réinjecter toute sa flotte en 1 clic en cas de destruction complète du conteneur.

---

## 3. Périmètre

### 3.1 Éléments inclus
- **Schéma et Adaptateur de données :**
  - Ajout des tables/collections `sessions` et `session_characters` dans `src/server/storage/schema.ts` (migration de schéma).
  - Implémentation du support dans `DurableFileDatabaseAdapter` et `PostgresDatabaseAdapter` (`src/server/storage/database.ts`).
- **Store de session persistant :**
  - Refonte de `src/server/auth/sessionStore.ts` pour charger, écrire et synchroniser les sessions avec l'adaptateur de base de données.
  - Implémentation du chiffrement symétrique réversible AES-256-GCM dans `src/server/auth/crypto.ts`.
- **Service d'authentification et routeur :**
  - Mécanisme de rafraîchissement proactif et silencieux pour tous les personnages d'une session dans `src/server/auth/service.ts`.
  - Support de la double lecture Cookie / Header Bearer dans `src/server/auth/router.ts`.
- **Client React & Transport :**
  - Stockage de secours du `sessionId` dans `localStorage` côté frontend (`src/App.tsx`, `src/utils/apiClient.tsx`).
  - Transmission systématique de l'en-tête `Authorization: Bearer <sessionId>` sur tous les appels d'API.
- **Interface & Trousseau de secours :**
  - Boutons « Exporter le trousseau de flotte » et « Importer un trousseau » dans l'onglet Configuration (`src/components/ConfigurationView.tsx`).

### 3.2 Exclusions explicites
- Aucun secret OAuth (`client_secret`, `refresh_token`) ne doit jamais transiter en clair vers le navigateur.
- Pas de contournement des scopes ou des règles CCP : chaque personnage doit avoir été authentifié au moins une fois via le flux OAuth officiel.
- L'import de trousseau ne court-circuite pas la validation : les tokens importés sont immédiatement vérifiés auprès du endpoint de token CCP avant d'être validés.

---

## 4. Architecture Cible et Flux

### 4.1 Modèle de Données Persistant

```
┌─────────────────────────────────────────────────────────────┐
│                          sessions                           │
├─────────────────────────────────────────────────────────────┤
│ session_id (PK, text/uuid)                                  │
│ active_character_id (bigint)                                │
│ created_at (timestamp)                                      │
│ updated_at (timestamp)                                      │
└──────────────────────────────┬──────────────────────────────┘
                               │ 1:N
┌──────────────────────────────▼──────────────────────────────┐
│                     session_characters                      │
├─────────────────────────────────────────────────────────────┤
│ id (PK, text)                                               │
│ session_id (FK -> sessions.session_id)                      │
│ character_id (bigint)                                       │
│ character_name (text)                                       │
│ scopes (jsonb / array)                                      │
│ encrypted_refresh_token (text, format: iv:tag:ciphertext)   │
│ encrypted_access_token (text, format: iv:tag:ciphertext)    │
│ expires_at (bigint/timestamp)                              │
│ created_at (bigint/timestamp)                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Flux de Restauration Silencieuse

```
Utilisateur / Navigateur              Serveur Node / Auth               CCP EVE SSO
          │                                   │                              │
          │ 1. GET /api/auth/session          │                              │
          │    (Cookie OU Bearer Token)       │                              │
          ├──────────────────────────────────►│                              │
          │                                   │ 2. Lecture DB (sessions)     │
          │                                   │    Déchiffrement AES-GCM     │
          │                                   │    des refresh_tokens        │
          │                                   │                              │
          │                                   │ 3. Détection tokens expirés  │
          │                                   │    (ex: 11 persos > 20min)   │
          │                                   │                              │
          │                                   │ 4. Refresh automatique       │
          │                                   │    (POST /v2/oauth/token)    │
          │                                   ├─────────────────────────────►│
          │                                   │◄─────────────────────────────┤
          │                                   │    Nouveaux access_tokens    │
          │                                   │                              │
          │                                   │ 5. Sauvegarde DB atomique    │
          │ 6. Réponse session 200 OK         │                              │
          │    { authenticated: true,         │                              │
          │      active: Char1,               │                              │
          │      characters: [11 persos] }    │                              │
          │◄──────────────────────────────────┤                              │
```

---

## 5. Spécifications Détaillées des Reworks

### 5.1 Rework A — Module Crypto & Persistance
1. Créer `src/server/auth/crypto.ts` avec les fonctions :
   - `encryptToken(plainText: string, key?: string): string` (format `hex(iv):hex(tag):hex(ciphertext)`).
   - `decryptToken(encryptedPayload: string, key?: string): string`.
   - Utilisation d'une clé de dérivation robuste (32 octets) issue de `SESSION_SECRET` ou `ENCRYPTION_KEY` avec fallback déterministe généré au premier démarrage.
2. Mettre à jour `src/server/storage/schema.ts` (version de migration suivante) :
   - Table `sessions` et table `session_characters`.
3. Mettre à jour `DurableFileDatabaseAdapter` et `PostgresDatabaseAdapter` :
   - Sauvegarde et chargement des sessions dans le snapshot local `.data/eve_trade_store.json`.

### 5.2 Rework B — SessionStore & Auto-Refresh
1. Adapter `SessionStore` :
   - `init()` charge les sessions existantes depuis la base de données.
   - `createSession()`, `addOrUpdateCharacter()`, `removeCharacter()`, `deleteSession()` écrivent directement dans la base de données.
2. Adapter `AuthService.getValidSession()` :
   - Si les tokens d'un ou plusieurs personnages sont expirés, déclenche `refreshAllExpiredCharacters(session)` de façon concurrente limitée (concurrence max 4 pour ne pas saturer CCP).

### 5.3 Rework C — Transport Hybride & Iframe Resilience
1. Dans `src/server/auth/router.ts` :
   - Extraire le `sessionId` depuis :
     1. `req.cookies?.['eve_session_id']`
     2. En-tête `Authorization: Bearer <sessionId>`
     3. En-tête `X-Session-ID: <sessionId>`
   - Au callback de login réussi : rediriger vers `/?auth=success&session_id=<sessionId>` pour permettre au frontend de mémoriser l'ID immédiatement.
2. Dans le client React (`src/utils/apiClient.tsx` & `src/App.tsx`) :
   - À la réception du paramètre `session_id`, le sauvegarder dans `localStorage.setItem('eve_active_session_id', id)`.
   - Dans `fetchJson`, ajouter l'en-tête `Authorization: Bearer ${storedSessionId}` si présent.

### 5.4 Rework D — Trousseau de Secours (Export / Import Chiffré)
1. Créer l'endpoint backend `POST /api/auth/fleet/export` :
   - Chiffre avec le mot de passe fourni par l'utilisateur (via PBKDF2 + AES-256-GCM) l'ensemble des couples `(characterId, characterName, refreshToken, scopes)`.
   - Retourne un payload téléchargeable `eve-fleet-backup.enc`.
2. Créer l'endpoint backend `POST /api/auth/fleet/import` :
   - Reçoit le fichier chiffré et le mot de passe.
   - Déchiffre, valide chaque refresh token auprès de CCP, enregistre la session et lie tous les personnages.
   - Restaure instantanément la flotte de 11 personnages en un clic.

---

## 6. Plan de Test et Critères de Qualification

| Identifiant | Cas de test | Comportement attendu |
|---|---|---|
| `TEST-F11-01` | Persistance multi-personnages après redémarrage | Connecter 2+ personnages, redémarrer complètement le service Node/Store. La session et la liste complète des personnages sont restaurées à 100 %. |
| `TEST-F11-02` | Auto-refresh silencieux des tokens expirés | Avancer artificiellement le timestamp d'expiration des tokens. À l'appel suivant de `/api/auth/session`, les tokens sont rafraîchis auprès de CCP sans erreur et la session reste valide. |
| `TEST-F11-03` | Transport Bearer sans cookie (Iframe) | Simuler une requête sans cookie mais avec l'en-tête `Authorization: Bearer <sessionId>`. L'authentification réussit et renvoie l'utilisateur et ses personnages. |
| `TEST-F11-04` | Chiffrement au repos des jetons | Inspecter le contenu du stockage JSON ou PostgreSQL. Les refresh tokens ne figurent jamais en clair et sont tous chiffrés sous format IV:Tag:Data. |
| `TEST-F11-05` | Export et Import de trousseau chiffré | Exporter le trousseau avec mot de passe, purger la base de données, réimporter le trousseau avec le bon mot de passe. Les personnages sont restaurés et réactivés avec succès. Mot de passe erroné rejeté avec message explicite. |

---

## 7. Critères de Sortie de Phase

- [ ] Les sessions et leurs personnages liés persistent dans la base de données (`.data/` et PostgreSQL).
- [ ] Les `refresh_token` sont chiffrés au repos via AES-256-GCM.
- [ ] Le redémarrage du conteneur ne déconnecte plus les personnages.
- [ ] Le transport hybride Cookie + Bearer Token résout les blocages dans l'iframe Google AI Studio.
- [ ] La suite de tests unitaires et d'intégration dédiée (`auth.test.ts`, `sessionStore.test.ts`, `crypto.test.ts`) est 100 % au vert.
- [ ] La documentation canonique (`docs/CODE_INDEX.md`, `docs/MASTERPLAN.md`, `docs/INDEX.md`) est synchronisée.
