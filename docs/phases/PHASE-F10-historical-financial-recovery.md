# Phase F10 — Reconstitution Historique, Recalcul et Qualification Financière

## 1. Contexte et Problème Constaté

### 1.1 Origine de l'anomalie
Au cours des cycles d'utilisation précédents et des tests diagnostiques, des données ont été synchronisées et persistées dans `.data/eve_trade_store.json` (ou dans la base de données de production) sous l'empire des anciennes règles :
- Journaux de corporation potentiellement dupliqués sous des identifiants `charA:...` et `charB:...`.
- Journaux de corporation tronqués à 3 pages (`maxPages: 3`).
- Transactions de vente enrichies avec des taxes sur-attribuées ou erronées.
- Allocations FIFO calculées sans commissions de courtage d'achat (`allocated_buy_fees_isk = 0`).
- Résumés financiers calculés avec l'ancienne formule sans couverture financière explicite.

Une simple mise à jour du code ne suffit pas à assainir l'état persistant existant sans risquer des données corrompues ou des incohérences résiduelles. Il est impératif d'exécuter une procédure de migration et de recalcul contrôlée, répétable et auditée.

### 1.2 Preuves disponibles
- Présence d'enregistrements historiques biaisés identifiés dans le rapport d'audit `docs/AUDIT-TASK-55-FINANCIAL-RECONCILIATION.md`.

### 1.3 Hypothèses à vérifier lors de l'implémentation
- L'intégrité des observations brutes ESI persistées : les transactions et ordres bruts sont intacts et peuvent servir de base saine pour un recalcul complet des projections et allocations.

### 1.4 Conséquences métier
- Sans cette phase de reconstitution, l'utilisateur continuerait à voir des chiffres faux issus des anciennes allocations précalculées.
- Une réparation mal maîtrisée risquerait d'altérer les données réelles de jeu ou de supprimer des allocations manuelles légitimes.

---

## 2. Objectifs

1. **Fournir un outil de migration et de recalcul idempotent (`FinancialRecoveryManager`)** capable de réconcilier l'intégralité du grand livre et des allocations sans altérer les observations brutes ESI d'origine.
2. **Garantir la sécurité absolue des données persistées** par la création préalable et automatique d'un instantané de sauvegarde horodaté avec empreinte SHA-256 (`.pre-recovery.bak`).
3. **Fournir un mode simulation (`dry-run`)** permettant de comparer l'état financier « Avant » et « Après » réconciliation sans modifier les fichiers.
4. **Générer un rapport d'écart financier contradictoire** quantifiant les corrections apportées (taxes corrigées, commissions réintégrées, bénéfice réconcilié).
5. **Démontrer la qualification financière finale sur un jeu de données réel et représentatif** avant le passage à la release H03.

---

## 3. Périmètre

### 3.1 Éléments inclus
- Développement du script / service de maintenance `src/server/ledger/recovery.ts` et de sa commande CLI `npm run db:recalculate-financials`.
- Procédure de déduplication des anciennes entrées de journal de corporation persistées sous l'ancien format de clé.
- Ré-exécution ordonnée des passes :
  1. Normalisation des clés canoniques de journal.
  2. Ré-attribution fiscale déterministe (moteur F07).
  3. Attribution des commissions de courtage (moteur F08).
  4. Ré-exécution du moteur FIFO sur les allocations automatiques (en préservant rigoureusement les allocations manuelles d'ouverture verrouillées).
  5. Recalcul des résumés de rentabilité TTC (moteur F09).
- Génération d'un rapport de synthèse au format JSON/Markdown détaillant les deltas observés.

### 3.2 Exclusions explicites
- Suppression des transactions ou ordres bruts ESI.
- Modification automatique des allocations de mode `MANUAL` sans accord explicite de l'utilisateur.

### 3.3 Limites
- Aucune donnée brute ESI absente des fichiers locaux ne peut être inventée : si un journal nécessitait plus de pages, une nouvelle synchronisation ESI sera requise via F05.

---

## 4. État Technique Initial

- **Fichiers concernés :**
  - `src/server/storage/database.ts`
  - `src/server/ledger/repository.ts`
  - `src/server/roi/service.ts`
  - `src/server/roi/repository.ts`
  - `scripts/maintenance/` (nouveau module)
- **Comportement actuel :**
  - Pas de procédure formelle de réconciliation globale des données historiques persistées.

---

## 5. Architecture Cible et Stratégie

```
┌──────────────────────────────────────────────────────────────────┐
│                   FinancialRecoveryManager                       │
│                                                                  │
│ 1. Backup sécurisé SHA-256 (.pre-recovery-TIMESTAMP.json)       │
│                                                                  │
│ 2. Étape A : Normalisation et déduplication des journaux         │
│                                                                  │
│ 3. Étape B : Réconciliation fiscale déterministe (F07)           │
│                                                                  │
│ 4. Étape C : Attribution des frais de courtage (F08)             │
│                                                                  │
│ 5. Étape D : Recalcul FIFO des allocations automatiques (F09)    │
│    (Conservation stricte des allocations MANUAL)                 │
│                                                                  │
│ 6. Étape E : Génération du rapport d'écart financier             │
│                                                                  │
│ 7. Écriture atomique (si non dry-run) ou annulation propre       │
└──────────────────────────────────────────────────────────────────┘
```

1. **Idempotence totale :**
   Exécuter le script de recalcul 1 fois ou 10 fois de suite produit rigoureusement le même état final.
2. **Sauvegarde inviolable :**
   Calcul d'un checksum SHA-256 sur l'état persistant avant toute mutation, avec écriture dans `.data/backups/`.
3. **Contrôle d'intégrité strict :**
   Vérification qu'aucune transaction de vente n'a perdu de quantité vendue ou n'a été altérée dans ses valeurs brutes.

---

## 6. Plan d'Implémentation Ordonné

### Étape 1 : Création du `FinancialRecoveryManager`
- Créer `src/server/ledger/recovery.ts` implémentant le pipeline de recalcul sécurisé avec support du mode `dryRun: boolean`.

### Étape 2 : Script CLI d'administration et de maintenance
- Ajouter le script `scripts/recalculate-financials.ts` exécutable via `npm run db:recalculate-financials`.

### Étape 3 : Générateur de rapport d'écart (Audit Diff)
- Calculer les métriques comparatives :
  - `deltaTaxesIsk = newTotalTaxes - oldTotalTaxes`
  - `deltaBrokerFeesIsk = newTotalFees - oldTotalFees`
  - `deltaRealizedProfitIsk = newRealizedProfit - oldRealizedProfit`
  - `reconciledSalesCount = newAllocatedSales - oldAllocatedSales`

### Étape 4 : Tests d'intégration et de non-régression
- Tester la reconstitution sur un jeu de données corrompu synthétique simulant les anomalies exactes de task-55.

---

## 7. Matrice de Tests

| ID Test | Type | Description du Cas | Résultat Attendu |
|---|---|---|---|
| `TEST-F10-01` | Intégration | Exécution en mode `dry-run: true` sur base avec doublons | Rapport d'écart généré, fichier source strictement non modifié (même hash SHA-256). |
| `TEST-F10-02` | Intégration | Exécution réelle : création du backup de sécurité | Fichier de backup présent dans `.data/backups/`, hash SHA-256 validé. |
| `TEST-F10-03` | Intégration | Recalcul avec 10 allocations manuelles verrouillées | Les 10 allocations `MANUAL` sont rigoureusement intactes (identiques en quantité et coût). |
| `TEST-F10-04` | Intégration | Idempotence : exécution 2 fois de suite du recalcul | Le 2ème rapport d'écart affiche un delta strictement nul (`delta = 0 ISK`) sur tous les postes. |
| `TEST-F10-05` | Résilience | Interruption forcée au milieu du recalcul (simulation d'erreur) | Restauration automatique de l'état initial sans corruption de base. |

---

## 8. Critères d'Entrée

- Phases F05, F06, F07, F08 et F09 validées et fusionnées.
- Branche : `feature/phase-f10-historical-financial-recovery`.

---

## 9. Critères de Sortie

1. La commande `npm run db:recalculate-financials` s'exécute de bout en bout sans erreur.
2. Le rapport d'écart démontre l'élimination des doublons de journaux et la réintégration des commissions.
3. Toutes les allocations manuelles existantes sont préservées à 100%.
4. Les tests `TEST-F10-01` à `TEST-F10-05` sont validés au vert.
5. `npm run test`, `npm run typecheck`, `npm run lint` et `npm run build` sont conformes.
6. L'ensemble de la série F (F01 à F10) est validé, ouvrant la voie à la phase finale **H03**.

---

## 10. Risques et Retour Arrière

- **Risque :** Modification accidentelle de données utilisateurs en environnement local.
  - **Mitigation :** Sauvegarde systématique et mode `dry-run` par défaut sans flag `--write`.
- **Procédure de retour arrière :** Restauration immédiate depuis le fichier `.pre-recovery.bak` via simple copie.

---

## 11. Documentation à Mettre à Jour

- `docs/TESTING_CI.md` : Documenter la commande de maintenance et de qualification financière.
- `docs/CODE_INDEX.md` : Ajouter `src/server/ledger/recovery.ts`.
- `docs/MASTERPLAN.md` : Mettre à jour le statut de la série F complète.

---

## 12. Statut

**Planifiée** (Dépend de F09).
