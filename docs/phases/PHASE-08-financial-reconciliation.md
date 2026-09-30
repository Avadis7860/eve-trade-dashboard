# PHASE-08 — Réconciliation financière et métriques versionnées

**Type :** moteur financier & domaine · **Dépendances :** 07 · **État :** Planifiée

---

## 1. Problème utilisateur & Résultat attendu

- **Problème** : L'association des coûts d'achat aux ventes dans l'écosystème du joueur doit être rigoureuse, transparente et vérifiable. Actuellement, si un achat est manquant (antérieur à la fenêtre ESI ou issu d'une fabrication/butin non traqué), la vente reste `UNKNOWN` sans possibilité d'introduire un lot d'inventaire initial explicite et justifié. De plus, les frais ne sont pas toujours décomposés avec leur source exacte.
- **Résultat attendu** : Un moteur de réconciliation financière renforcé, supportant à la fois le FIFO automatique multi-personnages, l'allocation manuelle de lots, et la gestion explicite des lots d'inventaire d'ouverture (avec justification obligatoire). Chaque métrique produite est versionnée, horodatée (`as_of`), et fournit sa preuve arithmétique (numérateur, dénominateur, frais déduits).

---

## 2. Dépendances exactes

- Modules amont : `src/server/roi/calculator.ts`, `src/server/roi/service.ts`, `src/server/roi/repository.ts`, `src/server/ledger/repository.ts`.
- Contrats : `docs/METRICS.md`, `docs/DOMAIN_CONTRACTS.md`.

---

## 3. Périmètre inclus & Exclusions explicites

### Inclus
- Découpage unitaire des lots de transactions d'achat (`InventoryLot`) avec suivi du reliquat disponible.
- Moteur FIFO chronologique robuste préservant les allocations manuelles prioritaires de l'utilisateur.
- Support des lots de stock d'ouverture (*Opening Inventory Lots*) pour valoriser les stocks initiaux acquis avant l'utilisation de l'outil, avec traçabilité séparée (`source: INITIAL_BALANCE`, date, justification).
- Décomposition unitaire de chaque résultat financier : Chiffre d'affaires brut, Coût d'achat, Frais d'achat (courtage), Frais de vente (courtage + taxe SCC), Bénéfice net TTC, ROI TTC.
- Calcul explicite du capital immobilisé en lots invendus par article, station et hub.
- Endpoints API enrichis fournissant le détail complet de la chaîne de réconciliation pour chaque ligne de vente.

### Exclusions
- Pas d'estimation arbitraire ou de FIFO implicite non déclaré.
- Pas de calcul de bénéfice sur des stocks non encore vendus (un stock invendu reste strictly du capital immobilisé).
- Pas de modification de l'interface globale (traitée en Phase 10 & 12).

---

## 4. Formules & Règles de gestion

1. **Priorité des allocations** : Les allocations manuelles définies par l'utilisateur sont prioritaires et verrouillées. Le moteur FIFO automatique ne consomme que les reliquats d'achats non verrouillés.
2. **Ordre chronologique strict** : Un achat ne peut être affecté à une vente que si $\text{Date}(\text{Achat}) \le \text{Date}(\text{Vente})$.
3. **Imputation exacte des frais** :
   $$\text{Frais Achat Alloués} = \text{Frais Courtage Total Achat} \times \left(\frac{\text{Qté Allouée}}{\text{Qté Totale Achat}}\right)$$
   $$\text{Frais Vente Alloués} = (\text{Taxe SCC Vente} + \text{Frais Courtage Vente}) \times \left(\frac{\text{Qté Allouée}}{\text{Qté Totale Vente}}\right)$$
4. **Gestion des ventes non rapprochées** : Si aucune transaction ou lot initial ne couvre la quantité vendue, la part non couverte a un coût `UNKNOWN`. Le profit et le ROI de cette fraction sont `null` avec statut `PARTIAL` ou `UNKNOWN`.

---

## 5. Étapes de réalisation

1. **Modèle de données des lots** : Définition des types `InventoryLot`, `ReconciliationProof`, `OpeningBalanceLot`.
2. **Refactorisation du moteur FIFO** : Implémentation du passage multi-personnages par lot avec conservation d'historique de calcul.
3. **Gestion des soldes d'ouverture** : Ajout du service et des routes pour déclarer/consulter/supprimer des lots d'inventaire initial avec journalisation.
4. **Calculateur de métriques décomposées** : Mise à jour de `RoiCalculator` pour générer des objets de résultat auditables avec formule et preuve associées.
5. **Tests de non-régression & Cas limites** : Tests de ventes fractionnées sur plusieurs achats, achats fractionnés sur plusieurs ventes, achats et ventes inter-personnages, suppression en cascade propre.

---

## 6. Critères d'acceptation mesurables

- [ ] 100% des allocations préservent la règle d'antériorité temporelle de l'achat sur la vente.
- [ ] Aucun frais ou taxe n'est comptabilisé deux fois dans le calcul du bénéfice réalisé TTC.
- [ ] La somme des quantités allouées sur un achat ne dépasse jamais la quantité brute de cet achat.
- [ ] Les métriques retournées par `/api/roi/summary` incluent pour chaque ligne la décomposition détaillée (CA brut, coût matière, frais achat, frais vente, profit TTC, ROI TTC, statut de couverture).
- [ ] Suite complète de tests unitaires et d'intégration validée (`vitest run`).

---

## 7. Gestion des états incertains

- Vente sans achat ni solde initial : `coverage_status: UNKNOWN`, `realized_profit_ttc: null`, `roi_percent_ttc: null`.
- Vente couverte à 60% : `coverage_status: PARTIAL`, profit calculé uniquement sur les 60% avec mention de couverture.

---

## 8. Définition de Terminé

Code réel implémenté + tests unitaires exhaustifs au vert + CI verte + mise à jour de `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md`.
