# Audit approfondi du produit & Contrats cibles

Ce document consigne l'audit architectural, financier, ergonomique et technique de la base de code existante d'**EVE Trade Dashboard** (à l'issue des phases 00 à 06, H01 et H02). Il établit le diagnostic factuel, distingue les défauts confirmés des améliorations souhaitées, et formalise les modèles cibles nécessaires à la transformation de l'application en un véritable système de pilotage de trading EVE Online.

---

## 1. Diagnostic de l'existant

### 1.1. Synthèse de l'état du code
- **Socle existant** : Monolithe full-stack Node.js / Express + React 19 / TypeScript, sécurisé par EVE SSO (PKCE S256), isolation stricte inter-personnages, passerelle ESI avec gestion des quotas et pagination `from_id` / `x-pages`.
- **Phases validées** : 00 à 06 (Dashboard), H01 (Sécurité & isolation), H02 (Résilience, idempotence, sauvegarde SHA-256).
- **Couverture de tests actuelle** : 119 tests unitaires et d'intégration validés (`vitest run`).

---

## 2. Tableau des constats d'audit

| Réf. | Domaine | Constat & Preuve dans le code | Impact Utilisateur | Gravité | Dépendances | Catégorie |
|---|---|---|---|---|---|---|
| **AUD-01** | **UX / Redondance** | **Bandeau de synchronisation répété** (`src/App.tsx` L.1202-1249) au sommet de tous les onglets, occupant 80px de hauteur utile sans valeur contextuelle sur les vues d'analyse. | Perte d'espace vertical sur écrans standards, distraction visuelle permanente. | Moyenne | UI / App.tsx | Défaut confirmé |
| **AUD-02** | **UX / KPI Walls** | **Répétition des cartes KPI** (Chiffre d'affaires brut, Taxes, Frais, Bénéfice) présentes à la fois dans `DashboardOverview.tsx` (L.91-175), `HubsRoiView.tsx` et `LedgerView.tsx`. | Surcharge cognitive, dilution de l'information décisionnelle propre à chaque écran. | Moyenne | DashboardOverview, HubsRoiView | Défaut confirmé |
| **AUD-03** | **Analytics** | **Absence de visualisations temporelles interactives** : aucune série chronologique (ventes journalières/hebdomadaires, évolution du profit réalisé, vélocité des stocks). Données présentées uniquement sous forme de totaux statiques et tables. | Impossibilité de visualiser les tendances, les variations saisonnières ou l'impact d'une campagne commerciale. | Élevée | UI / Métriques | Amélioration majeure |
| **AUD-04** | **Navigation / 360** | **Absence de fiche produit unifiée (Product 360)** : cliquer sur un article dans le Grand Livre (`LedgerView.tsx`) ou les Ordres (`OrdersView.tsx`) applique seulement un filtre texte sans relier transactions, ordres actifs, actifs en station, lots d'achat et rentabilité. | Navigation cloisonnée imposant des allers-retours manuels entre 4 onglets pour analyser un seul article. | Élevée | Ledger, Orders, Assets, ROI | Amélioration majeure |
| **AUD-05** | **Finance / Capital** | **Confusion entre valeur notionnelle de vente et capital engagé** : `OrderSummaryMetrics` (`src/App.tsx` L.161-162) additionne la valeur des ordres de vente (`price * volumeRemain`) sous le terme "valeur active", laissant faussement croire à du capital liquide ou disponible. | Risque d'erreur de gestion : un ordre de vente est une immobilisation d'inventaire, seul l'escrow d'achat est un engagement de liquidité. | Élevée | Orders, Metrics, Types | Défaut confirmé |
| **AUD-06** | **Finance / Inventaire** | **Absence de modélisation mutuellement exclusive des actifs physiques** : les actifs (`src/server/assets/repository.ts`) ne distinguent pas le stock libre, le stock engagé dans un ordre de vente en cours, le stock dormant/éloigné et le stock en transit. | Impossibilité de connaître le capital réellement mobilisable ou d'identifier le stock dormant. | Élevée | Assets, ROI, Domain Contracts | Amélioration majeure |
| **AUD-07** | **Réapprovisionnement** | **Génération d'achats aveugle sans vérification des stocks existants** : `OrdersService.generateRestockSuggestions` (`src/server/orders/service.ts` L.119-175) cible systématiquement Jita 4-4 sans vérifier si le joueur possède déjà du stock dans d'autres stations/hubs. | Achats superflus et immobilisation de capital alors que du stock transférable est disponible. | Élevée | Orders, Assets, Restock | Défaut confirmé |
| **AUD-08** | **Réapprovisionnement** | **Absence de paramétrage de vitesse d'écoulement et de jours de couverture** : la quantité suggérée est égale au volume total de l'ordre sans tenir compte du run-rate historique. | Réapprovisionnement rigide inadapté aux variations de demande. | Moyenne | Orders, Ledger | Amélioration majeure |
| **AUD-09** | **Stockage / Durabilité** | **Persistance volatile en mémoire vive** : les dépôts (`InMemoryLedgerRepository`, `InMemoryOrdersRepository`, etc.) reposent sur des Maps en mémoire. Seule une sauvegarde manuelle JSON (`backupService.ts`) préserve les données lors des redémarrages. | Perte des historiques et allocations lors des redémarrages du serveur si non exportés manuellement. | Critique | Storage, Infrastructure | Défaut confirmé |
| **AUD-10** | **Finance / Couverture** | **Ventes anciennes orphelines sans coût d'achat** : lors de la première synchronisation, les ventes antérieures au premier achat connu restent `UNKNOWN`. L'utilisateur n'a pas de moyen propre d'assigner un coût initial de stock sans fausser la provenance ESI. | Métriques globales affichant une couverture partielle (`PARTIAL`) persistante sans option d'inventaire d'ouverture explicite. | Moyenne | ROI, Domain Contracts | Hypothèse / Amélioration |
| **AUD-11** | **Ergonomie / Clarté** | **Manque de repères explicites sur la provenance et les formules** : les taux de ROI et profits ne détaillent pas toujours dans l'infobulle le numérateur, le dénominateur et les frais déduits. | Manque de confiance de l'utilisateur dans les calculs présentés. | Moyenne | UI, Tooltips | Amélioration souhaitée |

---

## 3. Modèle financier cible

### 3.1. Structure des flux financiers et distinction rigoureuse

```
   [ Transactions d'Achat Brutes ]
                 │
                 ├──► Frais de courtage à l'achat (Journal: brokers_fee)
                 │
                 ▼
     [ Lots d'Inventaire Coûtés ] ──► [ Reliquats Invendus : Capital Immobilisé ]
                 │
                 │ (Rapprochement FIFO ou Manuel à l'exécution de la vente)
                 ▼
   [ Transactions de Vente Brutes ]
                 │
                 ├──► Taxes de vente SCC (Journal: transaction_tax)
                 ├──► Frais de courtage à la vente (Journal: brokers_fee)
                 │
                 ▼
     [ Bénéfice Réalisé TTC ] = Vente Brute Allouée − Coût Achat Alloué − Frais Achat Alloués − Frais Vente Attribuables
```

### 3.2. Formules canoniques

1. **Chiffre d'affaires brut observé ($CA_{brut}$)** :
   $$CA_{brut} = \sum (\text{Quantité vendue} \times \text{Prix unitaire de vente})$$
   *Source* : Transactions de vente ESI (`isBuy = false`).

2. **Investissement Alloué TTC ($Inv_{TTC}$)** :
   $$Inv_{TTC} = \text{Coût d'acquisition alloué} + \text{Frais de courtage d'achat alloués}$$
   *Règle* : Si aucune transaction d'achat n'est rapprochée, $Inv_{TTC} = \text{UNKNOWN}$.

3. **Bénéfice Réalisé TTC ($Profit_{TTC}$)** :
   $$Profit_{TTC} = CA_{brut,\text{alloué}} - \text{Coût d'acquisition alloué} - \text{Frais d'achat alloués} - \text{Taxes de vente SCC} - \text{Frais de courtage de vente}$$
   *Invariant* : Les frais ne sont comptabilisés qu'une seule fois. Si $Inv_{TTC}$ est inconnu, $Profit_{TTC} = \text{UNKNOWN}$.

4. **Taux de Retour sur Investissement TTC ($ROI_{TTC}$)** :
   $$ROI_{TTC} = \left(\frac{Profit_{TTC}}{Inv_{TTC}}\right) \times 100$$
   *Condition* : Calculé uniquement si $Inv_{TTC} > 0$ et prouvé. Sinon, `null` avec statut `UNKNOWN` ou `PARTIAL`.

5. **Résultat Potentiel Non Réalisé (Estimatif)** :
   $$Profit_{potentiel} = \sum \left(\text{Volume restant ordre de vente} \times \text{Prix unitaire ordre}\right) \times (1 - \text{Taux taxe estimé}) - \text{Valeur de revient du stock}$$
   *Garde-fou* : Toujours libellé « ESTIMATION POTENTIELLE » avec mention des hypothèses de marché.

6. **Vélocité des Ventes & Durée de Détention** :
   - *Vitesse journalière ($V_{jour}$)* : Unités vendues sur la fenêtre d'observation de 90 jours (durée standard maximale d'un ordre de marché EVE Online) divisées par 90 (avec options configurables 14j, 30j, 60j, 90j).
   - *Durée moyenne de détention ($D_{detention}$)* : Moyenne pondérée de $(\text{Date vente} - \text{Date achat})$ pour les unités réconciliées.
   - *Rendement par Capital-Jour* : $\frac{ROI_{TTC}}{D_{detention}}$.

---

## 4. Modèle de capital et états d'inventaire

Les actifs et capitaux du joueur sont découpés en états **mutuellement exclusifs** :

```
                          [ CAPITAL TOTAL DU TRADER ]
                                       │
        ┌──────────────────────────────┴──────────────────────────────┐
        ▼                                                             ▼
[ LIQUIDITÉS DISPONIBLES ]                                  [ CAPITAL ENGAGÉ / ACTIFS ]
  - Solde ISK de portefeuille                                         │
                                       ┌──────────────────────────────┼──────────────────────────────┐
                                       ▼                              ▼                              ▼
                              [ ESCROW ORDRES ACHAT ]       [ STOCKS EN ORDRE DE VENTE ]    [ STOCKS PHYSIQUES EN STATION ]
                                (Liquidité bloquée en         (Marchandises posées en         (Actifs réels non mis en vente)
                                 marché pour acheter)          sell order dans un hub)                       │
                                                                              ┌──────────────────────────────┼──────────────────────────────┐
                                                                              ▼                              ▼                              ▼
                                                                     [ STOCK LIBRE AU HUB ]        [ STOCK ÉLOIGNÉ / DORMANT ]    [ STOCK EN TRANSIT ]
                                                                     (Prêt à être mis en vente      (Hors hub commercial actif,    (Dans un cargo de transport
                                                                      immédiatement)                 sans mouvement récent)         ou contrat de fret)
```

---

## 5. Architecture de Navigation UX Cible

L'application abandonne le modèle « un onglet par table technique » au profit de 6 espaces de décision :

1. **Cockpit** :
   - Situation patrimoniale consolidée (Liquidité, Escrow, Stocks en vente, Stocks libres, Stocks dormants).
   - Indicateurs de performance réalisés récents (CA, Profit TTC, ROI global).
   - Flux de trésorerie net et alertes d'action humaine (ordres expirés/disparus, ruptures imminentes).
2. **Positions (Ordres & Inventaire)** :
   - Vue unifiée des engagements : Ordres de vente actifs, ordres d'achat avec escrow.
   - Inventaire physique décomposé par statut (En vente, Libre, Dormant, En transit).
3. **Analyses (Product 360 & Hubs)** :
   - Fiche d'inspection 360° pour chaque type d'article (historique complet, prix moyens, graphiques de vente, rentabilité, stock par station).
   - Matrices de performance par paires de hubs (ex: Jita -> Amarr).
   - Graphiques d'évolution temporelle (ventes par jour/semaine, profits, vélocité).
4. **Opérations (Réapprovisionnement & Transferts)** :
   - Suggestions de **transferts prioritaires** (si stock disponible dans un autre hub).
   - Suggestions d'**achats ciblés** (basées sur la vitesse d'écoulement et un horizon de couverture en jours).
   - Export multi-formats (CSV, format jeu EVE Multibuy).
5. **Transactions & Journal** :
   - Grand livre exhaustif des achats et ventes avec inspection de corrélation.
   - Journal des écritures de portefeuille (taxes SCC, frais de courtage, dépôts/retraits).
   - Gestion des allocations de coûts manuelles et réconciliation FIFO.
6. **Configuration & Système** :
   - Gestion multi-personnages (liaison SSO, bascule, écosystème).
   - Configuration des hubs et mappings de stations.
   - État détaillé de synchronisation ESI, quotas, cache et sauvegardes/restaurations.

---

## 6. Référence The Oz & EVE University

- **The Oz (Trading Principles)** : Importance de la distinction nette entre chiffre d'affaires et bénéfice net après toutes taxes/frais EVE, suivi de la vélocité des capitaux, gestion rigoureuse des hubs d'approvisionnement et de vente, mesure du coût d'opportunité du capital dormant.
- **EVE University (Market Mechanics)** : Prise en compte exacte des frais de courtage initiaux (non remboursables à l'annulation d'un ordre), de la taxe de vente SCC prélevée au moment de la transaction, et de l'escrow de marché bloqué lors du placement d'un ordre d'achat.
- **Principe d'indépendance** : L'outil applique ces concepts fondamentaux sans intégrer de formule propriétaire, de classement d'opportunités automatisé ou de conseil d'achat spéculatif.
