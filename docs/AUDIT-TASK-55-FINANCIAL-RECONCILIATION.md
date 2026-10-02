# Rapport d'Audit & Synthèse d'Investigation Task-55 : Fiabilité Financière, Journaux ESI et Réconciliation TTC

**Date d'investigation :** Octobre 2026 (Audit Post-Phase 12 / Task-55)  
**Rôle :** Architecte Logiciel Principal, Auditeur Financier Technique & Responsable Fiabilité des Données  
**Dépôt :** `Avadis7860/eve-trade-dashboard`  
**Statut :** Canonique — Validé contre le code source réel du dépôt

---

## 1. Contexte & Démarche de l'Investigation

Lors des tests en conditions réelles et des analyses diagnostiques sur le personnage `2124224223` et sa corporation associée `98830` (task-55), plusieurs incohérences majeures ont été constatées dans le calcul du bénéfice TTC, l'enrichissement des transactions de vente par leurs taxes, la prise en compte des commissions de courtage (`brokers_fee`) et l'exhaustivité des journaux de corporation.

L'objectif de cet audit contradictoire a été de :
1. Vérifier chaque anomalie rapportée directement dans le code source actuel (`src/server/sync/service.ts`, `src/server/ledger/repository.ts`, `src/server/roi/*`, etc.).
2. Qualifier le statut de chaque constat : **Confirmé dans le code**, **Confirmé par les données réelles**, **Hypothèse à vérifier**, ou **Contredit**.
3. Établir l'arbre des causes racines et concevoir la trajectoire de remédiation découpée en phases indépendantes et vérifiables (Série F05 à F10).

---

## 2. Tableau de Qualification des Constats de Task-55

| Constat / Anomalie | Statut Technique | Cause Racine Identifiée dans le Code | Impact Métier & Financier | Phase de Remédiation |
|---|---|---|---|---|
| **1. Couverture tronquée des journaux de corporation** (455 ventes sans taxe sur 1 674) | **Confirmé dans le code** | `src/server/sync/service.ts` (l. 949) : `maxPages: 3` codé en dur pour `/corporations/{corpId}/wallets/{div}/journal/`. Les erreurs par division sont silencieusement ignorées (`catch {}`) et le statut global est forcé à `COMPLETE`. | Les entrées historiques de taxes et commissions au-delà de 3 pages (~1 500 entrées) ne sont jamais synchronisées. Faux sentiment d'exhaustivité. | **F05** |
| **2. Duplication des journaux de corporation multi-personnages** | **Confirmé dans le code** | `src/server/sync/service.ts` (l. 957) : Clé d'entrée `id: `${characterId}:corp:${corpId}:${div}:${raw.id}``. Si N personnages sont dans la même corp, chaque entrée est persistée N fois. | Multiplication artificielle par N des taxes et commissions dans les agrégations du grand livre de corporation. | **F06** |
| **3. Attribution multiple d'une même taxe fiscale** (`sumEnrichedSellTax > uniqueCorpTax`) | **Confirmé dans le code** | `src/server/ledger/repository.ts` (l. 204-235) : `getJournalEntriesForTransaction` utilise un fallback heuristique (±10 ID ou ±3s) et prend la 1ère taxe trouvée (`break;`) sans marquer l'entrée comme consommée. | Une même taxe unitaire est imputée à plusieurs ventes distinctes survenues au même instant, gonflant indûment les taxes déduites. | **F07** |
| **4. Relation `taxJns.journalId = mktJn.journalId + 1` (`M + 1`)** | **Confirmé par les données & à formaliser** | Les événements ESI `market_transaction` et `transaction_tax` sont séquentiels dans le journal de wallet EVE, mais des exceptions existent (concurrence, ordres groupés). | Nécessite un algorithme déterministe d'appariement prioritaire (M+1 direct, puis corrélation stricte), rejetant tout rattachement ambigu. | **F07** |
| **5. Commissions de courtage (`brokers_fee`) absentes des transactions et allocations** (`allocated_buy_fees_isk = 0`) | **Confirmé dans le code** | `src/server/ledger/repository.ts` (l. 176-178) : Cherche `brokers_fee` via `contextId == tx.transactionId`. Or ESI associe `brokers_fee` à un ordre (`order_id`) et non à une transaction unitaire. | 100% des 1 249 allocations examinées ont des frais d'achat nuls. Les commissions d'ordres ne sont jamais imputées au coût de revient des lots FIFO. | **F08** |
| **6. Écart de Chiffre d'Affaires Alloué vs Brut (62,85% non alloué)** | **Confirmé par le modèle & les données** | `src/server/roi/calculator.ts` : `coverage_percent` mesure le ratio de volume d'unités vendues, pas le montant financier. Les ventes sans historique d'achat FIFO (anciennes ou hors scope 2 500 tx) restent non allouées. | Confusion possible de l'utilisateur entre couverture quantitative (97,57%) et couverture financière réelle. Nécessite des KPI séparés et explicables. | **F09** |
| **7. Données historiques persistées corrompues ou biaisées** | **Confirmé par le fonctionnement de la base** | Le fichier persistant `.data/eve_trade_store.json` contient des journaux dupliqués et des allocations calculées avec des taxes erronées et des frais nuls. | Risque de conserver des métriques fausses même après correction du code si une procédure de recalcul et de réparation n'est pas exécutée. | **F10** |

---

## 3. Analyse Technique Détaillée des 6 Défaillances

### 3.1. Défaillance 1 : Troncature et Faux Statut `COMPLETE` sur les Journaux de Corporation (F05)

**Code incriminé :** `src/server/sync/service.ts`, méthode `executeSyncCorporationWallets()`
```typescript
// Ligne 949 :
const paginatedJournal = await fetchXPages<RawEsiJournalEntry>(
  this.esiClient,
  `/corporations/${corpId}/wallets/${divisionNumber}/journal/`,
  {
    accessToken,
    refreshTokenFn,
    maxPages: 3, // <--- TRONCATURE ARBITRAIRE
    signal: options?.signal,
  }
);
// Lignes 980-982 :
} catch {
  // Ignore division errors <--- MASQUAGE D'ERREUR
}
// Lignes 986-987 :
await this.syncRepo.updateSyncStateAsync(characterId, resource, {
  status: 'COMPLETE', // <--- FAUSSE DÉCLARATION DE COMPLÉTUDE
  coverageStatus: 'COMPLETE',
  ...
```

**Diagnostic :**
- L'API ESI fournit jusqu'à plusieurs dizaines de pages de journal de corporation. La limite arbitraire à 3 pages tronque les données à 1 500 entrées au maximum.
- Les ventes plus anciennes que cette fenêtre de 3 pages ne retrouvent jamais leur ligne `transaction_tax` associée.
- Le statut retourné à l'UI et au système est pourtant `COMPLETE`, violant directement `DOMAIN_CONTRACTS.md` et `ESI_RESILIENCE.md`.

---

### 3.2. Défaillance 2 : Identifiant Non Canonique et Duplication Multi-Personnages (F06)

**Code incriminé :** `src/server/sync/service.ts`, méthode `executeSyncCorporationWallets()`
```typescript
// Ligne 957 :
const entries: CharacterWalletJournalEntry[] = paginatedJournal.data.map((raw) => ({
  id: `${characterId}:corp:${corpId}:${divisionNumber}:${raw.id}`, // <--- DÉPEND DU PERSONNAGE OBSERVATEUR
  characterId,
  journalId: raw.id,
  ...
  isCorporationWallet: true,
  corporationId: corpId,
  division: divisionNumber,
}));
```

**Diagnostic :**
- Un journal de corporation appartient à la corporation et à une division donnée, indépendamment du personnage qui effectue la requête ESI.
- En intégrant `characterId` dans la clé primaire de l'entrée, deux directeurs de la même corporation synchronisant l'application créent deux enregistrements distincts en base pour chaque transaction de la corporation.
- Dans le `PersistentLedgerRepository`, `this.journalEntries.set(key, entry)` conserve les deux copies.
- Lors de l'évaluation des agrégats ou de la recherche par corporation, les montants de frais et de taxes sont multipliés par le nombre de directeurs.

---

### 3.3. Défaillance 3 : Rapprochement Fiscal Non Déterministe & Multiple (F07)

**Code incriminé :** `src/server/ledger/repository.ts`, méthode `getJournalEntriesForTransaction()`
```typescript
// Lignes 204-235 :
if (!dedicatedTaxFound && isBuy === false) {
  const txTime = txDate ? new Date(txDate).getTime() : 0;
  for (const key of charJnKeys) {
    const jn = this.journalEntries.get(key);
    ...
    const isAdjacentId = journalRefId !== undefined && Math.abs(jn.journalId - journalRefId) <= 10;
    const jnTime = new Date(jn.date).getTime();
    const isTimeMatch = txTime > 0 && Math.abs(jnTime - txTime) <= 3000;

    if (isAdjacentId || isTimeMatch) {
      const taxAmt = jn.tax !== undefined && jn.tax > 0 ? jn.tax : Math.abs(jn.amount || 0);
      if (txTotalValue !== undefined && txTotalValue > 0) {
        const ratio = taxAmt / txTotalValue;
        if (ratio >= 0.02 && ratio <= 0.12) {
          tax += taxAmt;
          dedicatedTaxFound = true;
          entries.push(jn);
          break; // <--- SÉLECTION ARBITRAIRE DU PREMIER CANDIDAT
        }
      }
    }
  }
}
```

**Diagnostic :**
- Cette méthode est sans état (stateless) et ne mémorise pas les taxes déjà consommées par d'autres transactions.
- Si 5 ventes du même article surviennent dans le même tick de 3 secondes, chacune va itérer sur les entrées de journal et retenir la **même première ligne `transaction_tax`**.
- La somme des taxes enrichies des ventes dépasse ainsi le montant total réel des taxes prélevées par CCP.
- Le rapprochement doit devenir une passe d'attribution déterministe avec réservation exclusive (1 entrée fiscale = au plus 1 vente).

---

### 3.4. Défaillance 4 : Rupture du Lien sur les Frais de Courtage (`brokers_fee`) (F08)

**Code incriminé :** `src/server/ledger/repository.ts`, méthode `getJournalEntriesForTransaction()`
```typescript
// Lignes 176-180 :
const matchesTxId = jn.contextId !== undefined && Number(jn.contextId) === Number(transactionId);
const matchesRefId = journalRefId !== undefined && Number(jn.journalId) === Number(journalRefId);
const matchesContextRef = jn.contextId !== undefined && journalRefId !== undefined && Number(jn.contextId) === Number(journalRefId);
const isBrokerRef = jn.refType === 'brokers_fee' || ...;
```

**Diagnostic :**
- Dans l'ESI EVE Online :
  - Un `brokers_fee` est facturé lors de la **pose ou modification d'un ordre de marché** (`/characters/{id}/orders/` ou `/corporations/{id}/orders/`).
  - Son `context_id` pointe vers l'`order_id` (quand fourni par CCP), jamais vers le `transaction_id` de la transaction d'exécution ultérieure.
  - Une transaction ESI ne porte pas de `order_id` natif, seulement un `journal_ref_id` qui correspond à l'entrée `market_transaction` de débit/crédit du wallet.
- Conséquence : `matchesTxId` et `matchesRefId` échouent systématiquement pour tous les `brokers_fee`.
- Dans les 1 249 allocations examinées, `allocated_buy_fees_isk` était strictement égal à 0.
- Il est nécessaire de modéliser le cycle de vie des ordres et de rattacher les frais de courtage soit par corrélation avec l'ordre émetteur, soit via une politique comptable explicite distinguant les frais alloués aux lots FIFO des frais d'ordres non attribués.

---

### 3.5. Défaillance 5 : Distorsion entre Couverture Volume et Couverture Financière (F09)

**Code incriminé :** `src/server/roi/calculator.ts`, méthode `computeSummary()`
```typescript
// Lignes 323-327 :
if (totalSalesVolume > 0) {
  coveragePercent = roundPercent((allocatedSalesVolume / totalSalesVolume) * 100) ?? 0;
}
```

**Diagnostic :**
- L'indicateur `coverage_percent` calcule un ratio de **quantités d'articles** (`allocatedSalesVolume / totalSalesVolume`).
- Dans l'échantillon task-55 :
  - Chiffre d'affaires brut total : 15,58 Mrd ISK
  - Chiffre d'affaires des ventes allouées : 5,79 Mrd ISK
  - Chiffre d'affaires non alloué : 9,79 Mrd ISK (62,85% du CA non alloué)
  - Couverture affichée : 97,57% (car de grands volumes d'objets à faible valeur unitaire avaient été alloués).
- L'utilisateur voyait une jauge verte de couverture à 97,57% alors que près des deux tiers de la valeur financière des ventes n'étaient pas rapprochés.
- La phase F09 doit introduire des métriques distinctes : Couverture Quantitative vs Couverture Financière du CA, et présenter le CA non alloué sans inventer un profit fictif.

---

### 3.6. Défaillance 6 : Nécessité d'une Procédure de Reconstitution Historique Sûre (F10)

**Diagnostic :**
- Même une fois le code corrigé, le fichier d'état `.data/eve_trade_store.json` contiendra des snapshots et allocations biaisés.
- Il est obligatoire de définir une procédure de migration et de recalcul idempotent :
  1. Sauvegarde automatique avec hash SHA-256 (`.corrupt.bak` / `.pre-recovery.bak`).
  2. Déduplication des entrées de journal de corporation.
  3. Re-synchronisation pagination complète des journaux.
  4. Ré-exécution de l'attribution fiscale déterministe.
  5. Ré-exécution de l'attribution des frais de courtage.
  6. Recalcul des allocations FIFO et génération d'un rapport comparatif d'écart (Avant / Après).

---

## 4. Trajectoire de Remédiation : Feuille de Route Série F (F05 à F10)

L'arbre de dépendance technique et logique est le suivant :

```
[ Phase F04 : Validation CI & E2E ]
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│ PHASE F05 : Exhaustivité et Vérité des Journaux Corporation  │
│  • Pagination X-Pages sans limite arbitraire                 │
│  • Reprise sur interruption, gestion des erreurs par division│
│  • Vérité stricte des statuts (COMPLETE vs PARTIAL vs ERROR) │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ PHASE F06 : Identité Canonique et Déduplication Corporation  │
│  • Clé économique stable : (corpId, division, journalId)     │
│  • Découplage du personnage observateur et de la donnée      │
│  • Déduplication des agrégations multi-personnages           │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ PHASE F07 : Rapprochement Fiscal Déterministe & Unicité      │
│  • Attribution exclusive 1-to-1 des transaction_tax          │
│  • Exploitation validée du pattern M+1 & rejet des ambiguïtés│
│  • Élimination du fallback aléatoire à 3 secondes            │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ PHASE F08 : Modélisation et Attribution des Frais Courtage   │
│  • Traçabilité des brokers_fee via le cycle de vie des ordres│
│  • Attribution justifiée aux lots FIFO d'achat               │
│  • Catégorisation explicite des frais d'ordres non attribués │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ PHASE F09 : Réconciliation Financière TTC & KPI Cohérents    │
│  • Séparation stricte Couverture Volume vs Couverture CA     │
│  • Formule de profit TTC auditée avec preuves unitaire       │
│  • Transparence sur le CA non alloué et le résultat incertain│
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ PHASE F10 : Reconstitution Historique, Recalcul & Audit Final│
│  • Procédure de recalcul idempotent avec backup SHA-256      │
│  • Rapport d'écart avant/après sur données réelles           │
│  • Preuve de non-régression et qualification financière      │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ PHASE H03 : Release Finale et Hardening                      │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Conclusion & Directives de Gouvernance

1. **Aucun code ne doit être implémenté sans respecter l'ordre strict des dépendances (F05 → F10).**
2. **Chaque phase dispose de son propre document de spécification détaillé dans `docs/phases/`.**
3. **Le présent rapport sert de référence canonique contradictoire pour toutes les phases de la série F.**
