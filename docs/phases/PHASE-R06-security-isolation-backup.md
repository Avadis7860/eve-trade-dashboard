# Phase R06 — Sécurité, isolation et sauvegarde

## Objectif
Garantir la sécurité étanche des données, l'isolation cryptographique et logique des sessions multi-personnages, l'intégrité des mécanismes de sauvegarde/restauration et l'élimination définitive de données sensibles ou réelles dans l'historique du dépôt Git.

## Problèmes traités
- Présence d'un fichier de données réel `.data/eve_trade_store.json` (~1 Mo) suivi par Git contenant des ordres et données de transactions réelles de personnages EVE Online.
- Risque d'accès non autorisé ou de fuite de données entre personnages au sein d'une même session ou entre sessions distinctes.
- Absence d'autorisation granulaire sur les endpoints de restauration de sauvegarde (`/api/backup/restore`) pouvant permettre d'écraser l'ensemble de la base sans privilège adéquat.
- Risque d'exposition d'erreurs SQL brutes ou de secrets OAuth (refresh tokens, tokens CSRF, client secrets) dans les logs serveur ou les réponses HTTP.

## Constats vérifiés
- `/.data/eve_trade_store.json` est actuellement présent sur le disque et versionné dans l'arbre Git. Il contient des ordres et transactions réelles de personnages (ex: `characterId: 2124224223`).
- `src/server/storage/backupService.ts` génère des snapshots de sauvegarde avec checksum SHA-256 (`AppBackupSnapshot`), mais la restauration remplace globalement l'état sans vérification de propriété par personnage.
- `src/server/middleware/security.ts` implémente déjà `validateCharacterSessionAccess` et des en-têtes CSP/CORS stricts, mais ce contrôle doit être étendu systématiquement à chaque endpoint SQL et d'export/import.

## Périmètre inclus
- **Assainissement du stockage et du dépôt Git :**
  - Ajout systématique de `/.data/`, `*.json.tmp`, `*.db`, `*.sqlite` dans `.gitignore`.
  - Retrait du fichier `.data/eve_trade_store.json` du suivi Git.
  - Audit de l'historique Git pour vérifier l'absence de tokens EVE OAuth ou de secrets d'infrastructure ; documentation de la procédure de purge d'historique si nécessaire (`git filter-repo` / BFG).
  - Fourniture d'un fichier d'exemple factice pour les tests locaux (`.data/eve_trade_store.example.json`).
- **Isolation stricte multi-personnages (RBAC / Session Scoping) :**
  - Toute requête SQL de lecture ou d'écriture DOIT inclure une clause explicite `character_id = $1` ou `character_id = ANY($1)` validée contre les identifiants de la session HTTP active (`req.session.characterId` et `req.session.linkedCharacterIds`).
  - Interdiction formelle qu'un utilisateur accède aux transactions, ordres, actifs ou allocations d'un personnage non rattaché à sa session authentifiée.
- **Sécurisation de la sauvegarde et de la restauration :**
  - L'export de sauvegarde (`/api/backup/export`) est strictement limité aux personnages autorisés de la session courante.
  - La restauration (`/api/backup/restore`) doit soit fonctionner en mode "Scoped Restore" (restauration uniquement des données des personnages de la session sans altérer les autres), soit exiger une confirmation administrative explicite avec validation d'empreinte SHA-256.
- **Sécurité réseau, en-têtes et journalisation :**
  - Validation des en-têtes de sécurité : `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `SameSite=Lax` / `SameSite=Strict` sur les cookies de session `HttpOnly` et `Secure`.
  - Masquage systématique des secrets et jetons dans `src/server/utils/logger.ts` (aucun token Bearer, refresh token ou code PKCE dans les journaux).
  - PostgreSQL TLS forcé en production (`ssl: { rejectUnauthorized: true }`).

## Périmètre exclu
- Aucune modification de la cinématique OAuth PKCE RFC 7636 côté client (déjà conforme aux spécifications).
- Aucun changement dans le système de gestion des fenêtres du client EVE Online.

## Pré-requis
- Phase R01 terminée (persistance PostgreSQL transactionnelle en place).

## Architecture cible
```
Requête HTTP -> Session Cookie (HttpOnly, Secure)
                     │
                     ▼
       validateCharacterSessionAccess Middleware
       (Vérifie que targetCharacterId ∈ session.authorizedCharacters)
                     │
                     ▼
       Couche Service (Scope vérifié)
                     │
                     ▼
       Requête SQL avec clause de confinement stricte
       SELECT * FROM transactions
       WHERE character_id = ANY($1::int[]) -- Injecté depuis la session certifiée
```

## Travaux attendus
1. **Nettoyer `.data/` :** Mettre à jour `.gitignore`, supprimer le fichier réel versionné et créer un template anonymisé.
2. **Renforcer l'isolation SQL :** Auditer chaque requête SQL pour garantir qu'aucune clause `WHERE character_id` ne puisse être omise ou contournée.
3. **Restructurer `backupService.ts` :** Implémenter l'export et l'import cloisonnés par personnage avec contrôle cryptographique SHA-256 et vérification d'intégrité relationnelle.
4. **Audit de sécurité complet :** Valider les en-têtes HTTP, la politique de cookies et la non-divulgation des erreurs internes de la base aux clients HTTP.

## Tests obligatoires
- Test d'isolation d'accès inter-personnages : Un utilisateur connecté avec le Personnage A tente d'accéder à `/api/ledger/transactions?characterId=9999` (Personnage B) ; vérifier le rejet immédiat avec HTTP 403 Forbidden.
- Test de restauration cloisonnée : Restaurer une sauvegarde contenant le Personnage A ; vérifier que les données du Personnage C en base ne sont ni écrasées ni corrompues.
- Test d'intégrité SHA-256 de sauvegarde : Modifier un seul caractère dans le JSON de sauvegarde ; vérifier le rejet immédiat de la restauration pour cause d'empreinte cryptographique invalide.
- Test de non-exposition des secrets : Vérifier que les logs serveur ne contiennent aucun token, même en cas de capture d'erreur réseau ESI.

## Mesures de performance
- Latence d'évaluation du middleware de sécurité < 1 ms par requête.
- Temps de validation du checksum SHA-256 sur un snapshot de sauvegarde de 50 000 enregistrements < 50 ms.

## Risques de régression
- Risque de blocage légitime lors de synchronisations multi-personnages si les identifiants ne sont pas tous propagés dans le contexte de session : mitigation par des tests de couverture sur `linkedCharacters`.

## Critères d’entrée
- Phase R01 validée.

## Critères de sortie
- Aucun fichier de données réel n'est présent dans le suivi Git et `.gitignore` est verrouillé.
- L'isolation multi-personnages est imperméable et testée contre les tentatives de traversée de droits.
- Les sauvegardes et restaurations sont cryptographiquement vérifiées et cloisonnées.

## Preuves attendues
- Rapport d'audit de sécurité des routes HTTP (matrice des codes de réponse 401/403).
- Vérification de l'absence de fichiers `.data/*.json` dans `git ls-files`.

## Dépendances vers les autres phases
- **Bloque :** Phase R7 (Tests complets), Phase R8 (Observabilité).
- **Dépend de :** Phase R01.

## Definition of Done
Fichier .data retiré de Git et anonymisé + isolation multi-personnages certifiée par tests d'intrusion locaux + export/restore sécurisé par SHA-256 + CI verte.
