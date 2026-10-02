# Phase F05 — Exhaustivité et Vérité des Journaux de Corporation

## 1. Contexte et Problème Constaté

### 1.1 Origine de l'anomalie
Lors de l'audit task-55 sur le personnage `2124224223` et sa corporation `98830`, 1 674 transactions de vente ont été observées, mais seulement 1 219 entrées fiscales `transaction_tax` ont pu être localisées dans le grand livre. 455 ventes se trouvaient privées de taxes associées.

L'examen du code source dans `src/server/sync/service.ts` (méthode `executeSyncCorporationWallets`) a confirmé que la récupération du journal ESI `/corporations/{corpId}/wallets/{divisionNumber}/journal/` était limitée arbitrairement à `maxPages: 3` (soit 1 500 entrées au maximum). Les entrées antérieures ne sont jamais récupérées.

De plus, si une division de corporation renvoie une erreur (permissions insuffisantes, timeout, rate-limit), l'exception est interceptée silencieusement (`catch { // Ignore division errors }`) et le statut global de synchronisation de la ressource est indûment forcé à `COMPLETE`.

### 1.2 Preuves disponibles
- Code `src/server/sync/service.ts` : paramètre en dur `maxPages: 3` passé à `fetchXPages`.
- Ignorance des statuts `PARTIAL` ou `ERROR` retournés par `fetchXPages` pour chaque division.
- Mise à jour aveugle du statut de synchronisation : `status: 'COMPLETE'` et `coverageStatus: 'COMPLETE'`.

### 1.3 Hypothèses à vérifier lors de l'implémentation
- La profondeur de pagination maximale des journaux de division de corporation sous ESI (généralement jusqu'à 2 500 entrées ou date limite de 30 jours selon les règles CCP).
- Le comportement du header `X-Pages` sur les endpoints de corporation lorsqu'une division est vide (retourne 1 page vide ou 204/404).

### 1.4 Conséquences métier
- 455 ventes récentes ou semi-récentes n'ont aucune taxe reconnue, faussant le calcul du bénéfice net TTC.
- L'utilisateur est induit en erreur par un indicateur de synchronisation au vert (`COMPLETE`), masquant une perte de données de plus de 27% des événements fiscaux.

---

## 2. Objectifs

1. **Garantir l'exhaustivité de la collecte des journaux de corporation** par division sans troncature artificielle (stratégie paramétrable avec support de reprise).
2. **Refléter la vérité stricte de la couverture** : propager `PARTIAL` si la pagination atteint la limite de sécurité sans avoir consommé toutes les pages ESI, ou si une division échoue.
3. **Assurer une gestion d'erreur granulaire par division** sans masquage silencieux.
4. **Permettre la reprise incrémentale et sans doublon** de la pagination des journaux de corporation.

---

## 3. Périmètre

### 3.1 Éléments inclus
- Modification de la boucle de synchronisation des divisions de portefeuille dans `src/server/sync/service.ts`.
- Intégration fine avec `fetchXPages` de `src/server/esi/pagination.ts` pour exploiter les métadonnées de pagination par division (`totalPagesExpected`, `pagesFetched`, `status`, `hasMore`).
- Stockage et suivi de l'état de synchronisation par division de corporation dans `ISyncRepository`.
- Support d'une stratégie de reprise pagination (`startPage` / `lastPage`) par division.
- Propagation de l'état réel de complétude : si une division sur 7 échoue ou est partielle, l'agrégat global de la ressource est `PARTIAL` ou `ERROR`, jamais `COMPLETE`.

### 3.2 Exclusions explicites
- Déduplication économique des entrées entre plusieurs personnages (réservé à **F06**).
- Algorithme de réconciliation fiscale transaction/taxe (réservé à **F07**).
- Modification de l'UI du Cockpit (réservé à **F09** / **H03**).

### 3.3 Limites
- Dépendance aux quotas ESI (limitation d'erreurs 100/min et rate limits CCP). Le système doit respecter les fenêtres de temporisation en cas de 420/429.

---

## 4. État Technique Initial

- **Fichiers concernés :**
  - `src/server/sync/service.ts` (`executeSyncCorporationWallets`)
  - `src/server/sync/repository.ts` & `src/server/sync/types.ts`
  - `src/server/esi/pagination.ts`
- **Comportement actuel :**
  - `maxPages: 3` fixe.
  - `catch` muet sur chaque division.
  - Absence de persistance de l'état de pagination par division de corporation.
  - `totalRecords` et `totalPersisted` enregistrent le nombre de divisions (ex: 7) au lieu du nombre d'entrées de journal persistées.

---

## 5. Architecture Cible et Stratégie

1. **Suivi d'état par division :**
   La clé de suivi de synchronisation pour les divisions de corporation s'articule sous la forme d'un état structuré par division : `corp:${corpId}:division:${divisionNumber}:journal`.
2. **Pagination adaptative :**
   - Par défaut, pagination jusqu'au bout du flux (`maxPages: 50` ou jusqu'à `targetEndPage >= reportedPages`).
   - Sauvegarde de chaque page au fur et à mesure (`onPageSuccess`) dans `ledgerRepo` pour éviter la perte en cas de timeout ou interruption réseau.
3. **Agrégation de statut booléenne stricte :**
   - `COMPLETE` uniquement si 100% des divisions accessibles ont été paginées jusqu'à leur dernière page disponible sans erreur.
   - `PARTIAL` si au moins une division a été interrompue (`MAX_LIMIT_REACHED`) ou si au moins une division a échoué alors que d'autres ont réussi.
   - `ERROR` si l'accès à toutes les divisions a échoué ou si la requête wallet initiale a été rejetée (hors absence normale de rôles).

---

## 6. Plan d'Implémentation Ordonné

### Étape 1 : Extension du modèle d'état de synchronisation pour les divisions de corporation
- Ajouter dans `src/server/sync/types.ts` le support des métadonnées de synchronisation par division (`divisionStatuses: Record<number, { status: SyncStatus; lastPage: number; hasMore: boolean; error?: string }>`).

### Étape 2 : Réécriture de la boucle de synchronisation des journaux de division
- Dans `src/server/sync/service.ts`, remplacer l'appel tronqué `maxPages: 3` par un appel configurable utilisant `fetchXPages` avec callback `onPageSuccess`.
- Conserver le curseur de dernière page et gérer le paramètre `resume`.

### Étape 3 : Gestion d'erreur explicite et agrégation de statut
- Remplacer le `catch` vide par la capture de l'erreur détaillée par division.
- Calculer le statut global consolidé (`COMPLETE` / `PARTIAL` / `ERROR`) en respectant les invariants de vérité des données.

### Étape 4 : Décompte réel des enregistrements
- Corriger le calcul de `itemsFetched`, `newItemsPersisted`, et `totalRecords` dans le `SyncResult` retourné pour comptabiliser les entrées réelles de journal et non le simple nombre de divisions.

---

## 7. Matrice de Tests

| ID Test | Type | Description du Cas | Résultat Attendu |
|---|---|---|---|
| `TEST-F05-01` | Unitaire | Division avec 1 seule page de journal (50 entrées) | Statut `COMPLETE`, 50 entrées persistées, `hasMore = false`. |
| `TEST-F05-02` | Unitaire | Division avec 5 pages de journal (250 entrées) | Toutes les 5 pages récupérées, statut `COMPLETE`, `hasMore = false`. |
| `TEST-F05-03` | Unitaire | Division avec pagination interrompue à mi-chemin (`maxPages: 2` sur 5) | Statut `PARTIAL`, `lastPage = 2`, `hasMore = true`, `reason = MAX_LIMIT_REACHED`. |
| `TEST-F05-04` | Unitaire | Reprise de synchronisation (`resume: true`) après interruption | Démarre à la page 3, récupère pages 3 à 5, statut final `COMPLETE`. |
| `TEST-F05-05` | Unitaire | Erreur 500 ESI sur la division 3 alors que divisions 1 et 2 réussissent | Statut global `PARTIAL`, erreur détaillée enregistrée pour div 3, pas de crash. |
| `TEST-F05-06` | Intégration | Synchronisation complète d'une corporation à 7 divisions | 7 divisions traitées, journal exhaustif persisté, statut `COMPLETE`. |
| `TEST-F05-07` | Non-régression | Personnage sans rôles de corporation (403 Forbidden) | Statut `PARTIAL` avec message 'Lacks corporation wallet roles', pas de boucle infinie. |

---

## 8. Critères d'Entrée

- Phase F04 validée et fusionnée (ou CI au vert sur l'état courant).
- `docs/AUDIT-TASK-55-FINANCIAL-RECONCILIATION.md` rédigé et validé.
- Branche de travail dédiée créée : `feature/phase-f05-corp-journal-completeness`.

---

## 9. Critères de Sortie

1. Aucun appel à `fetchXPages` pour les journaux de corporation ne contient une limite codée en dur de `maxPages: 3`.
2. Aucun bloc `catch` vide dans la gestion des divisions de corporation.
3. Le statut retourné est strictement `PARTIAL` ou `ERROR` dès lors qu'une division n'a pas été entièrement récupérée.
4. Les tests `TEST-F05-01` à `TEST-F05-07` sont écrits, exécutés et verts.
5. `npm run test`, `npm run typecheck`, `npm run lint` et `npm run build` sont strictement verts sans aucun contrôle désactivé.

---

## 10. Risques et Retour Arrière

- **Risque :** Augmentation du volume de requêtes ESI lors de la première synchronisation d'une corporation avec un très grand historique.
  - **Mitigation :** Respect strict de la concurrence bornée via `SyncCoordinator` et gestion des rate limits ESI avec `onPageSuccess`.
- **Procédure de retour arrière :** Revert du commit sur la branche de feature sans altération de la base existante.

---

## 11. Documentation à Mettre à Jour

- `docs/ESI_RESILIENCE.md` : Documenter la stratégie de pagination des journaux de corporation par division.
- `docs/CODE_INDEX.md` : Mettre à jour les responsabilités de `src/server/sync/service.ts`.

---

## 12. Statut

**Terminé** (Validé avec succès, tests TEST-F05-01 à TEST-F05-07 verts, gestion d'erreurs granulaires par division et pagination sans troncature).
