# Métriques financières et formules canoniques

Toutes les métriques produites par l'application sont déterministes, auditables, horodatées (`as_of`) et précisent leur numérateur, leur dénominateur, leur couverture et leurs limites. « TTC » désigne l'intégration exacte des frais et taxes de marché EVE Online (courtage et taxe SCC).

---

## 1. Métriques de Réalisation (Ventes exécutées)

### 1.1. Décomposition du Chiffre d'Affaires Brut ($CA_{brut}$)
- **Chiffre d'Affaires Brut Total ($CA_{brut,total}$)** :
  $$CA_{brut,total} = \sum (\text{Quantité vendue} \times \text{Prix unitaire de vente})$$
- **Chiffre d'Affaires Alloué ($CA_{brut,alloué}$)** : Fraction du chiffre d'affaires associée avec certitude à des lots d'achat FIFO ou stocks d'ouverture démontrés :
  $$CA_{brut,alloué} = \sum (\text{Quantité allouée} \times \text{Prix unitaire de vente})$$
- **Chiffre d'Affaires Non Alloué ($CA_{brut,non\_alloué}$)** : Fraction du chiffre d'affaires provenant de ventes sans historique d'achat dans la fenêtre d'observation ESI et sans stock d'ouverture :
  $$CA_{brut,non\_alloué} = CA_{brut,total} - CA_{brut,alloué}$$
- **Invariance arithmétique stricte** :
  $$CA_{brut,total} = CA_{brut,alloué} + CA_{brut,non\_alloué}$$
  *Règle d'intégrité* : Le CA non alloué ne génère aucun profit spéculatif. Le profit sur cette part reste strictement `UNKNOWN`.

### 1.2. Indicateurs de Couverture : Financière vs Quantitative
- **Couverture Financière ($Cov_{financière}$)** : Mesure économique de la part du chiffre d'affaires dont le coût d'acquisition est prouvé :
  $$Cov_{financière} = \left(\frac{CA_{brut,alloué}}{CA_{brut,total}}\right) \times 100$$
- **Couverture Quantitative ($Cov_{volume}$)** : Mesure physique de la proportion d'unités d'articles réconciliées :
  $$Cov_{volume} = \left(\frac{\text{Volume alloué}}{\text{Volume total vendu}}\right) \times 100$$
- **Statut de Couverture** :
  - `COMPLETE` : $Cov_{financière} \ge 99.99\%$ et $Cov_{volume} \ge 99.99\%$.
  - `PARTIAL` : $0 < Cov_{financière} < 99.99\%$ ou $0 < Cov_{volume} < 99.99\%$.
  - `UNKNOWN` : $CA_{brut,alloué} = 0$ et $CA_{brut,total} > 0$.
  - `EMPTY` : 0 transaction de vente dans le périmètre.

### 1.3. Investissement Alloué TTC ($Inv_{TTC}$)
- **Formule** : $Inv_{TTC} = \text{Coût d'acquisition matière alloué} + \text{Frais de courtage d'achat alloués}$
- **Condition** : Si une fraction de la vente n'est pas rapprochée, $Inv_{TTC}$ correspond uniquement à la part rapprochée et le statut est `PARTIAL`.

### 1.4. Frais de Vente Alloués TTC ($Frais_{vente}$)
- **Formule** : $Frais_{vente} = \text{Taxes SCC vente attribuées} + \text{Frais de courtage de vente attribués}$

### 1.5. Bénéfice Réalisé TTC ($Profit_{TTC}$)
- **Formule** :
  $$Profit_{TTC} = CA_{brut,\text{alloué}} - Inv_{TTC} - Frais_{vente}$$
- **Règle** : Si aucune transaction d'achat n'est rapprochée ($Inv_{TTC} \le 0$), $Profit_{TTC} = \text{null}$ avec statut `UNKNOWN`.

### 1.6. Taux de Retour sur Investissement TTC ($ROI_{TTC}$)
- **Formule** :
  $$ROI_{TTC} = \left(\frac{Profit_{TTC}}{Inv_{TTC}}\right) \times 100$$
- **Condition** : Calculé si et seulement si $Inv_{TTC} > 0$. Sinon `null` (`UNKNOWN`).

### 1.7. Flux de Trésorerie Net de la Période ($Cash\_Flow_{net}$)
- **Formule** :
  $$Cash\_Flow_{net} = \sum \text{Encaissements Ventes Nets} - \sum \text{Dépenses Achats Brutes} - \sum \text{Frais \& Taxes Journal}$$

### 1.8. Rapprochement Fiscal Déterministe & Imputation des Taxes de Vente TTC
- **Principe d'unicité (1-to-1)** : Chaque écriture de taxe `transaction_tax` / `market_tax` du grand livre est attribuée à au plus une seule transaction de vente.
- **Invariance comptable stricte** : $\sum \text{Taxes attribuées aux ventes} \le \sum \text{Taxes réelles uniques du grand livre}$.
- **Attribution en 3 passes** :
  1. *Passe 1 (Exacte & Directe)* : Correspondance directe `context_id == transaction_id` ou référence directe `journalRefId`.
  2. *Passe 2 (Séquentielle CCP M+1)* : Succession directe de journal (`taxJn.journalId == mktJn.journalId + 1`) avec cohérence temporelle (même seconde) et cohérence arithmétique de taux.
  3. *Passe 3 (Corrélation bijective)* : Appariement déterministe 1-to-1 par cohorte temporelle et taux sans réutilisation d'écritures fiscales.
- **Gestion de l'incertitude** : Toute vente non couverte par une taxe prouvée est qualifiée `UNMATCHED` avec taxe numérique nulle (0 ISK) dans le net provisoire tout en conservant le détail dans `taxReconciliation`.

### 1.9. Attribution et Proratisation des Frais de Courtage ($Brokers\_Fee$)
- **Principe de corrélation d'ordres** :
  - Dans l'ESI, les commissions de courtage sont prélevées lors de la pose ou modification d'ordre (`jn.context_id == order_id`).
  - Les frais d'un ordre d'achat ou de vente sont attribués au prorata des volumes exécutés par chaque transaction fille :
    $$Fee_{tx,i} = \text{roundIsk}\left(\text{Total\_Order\_Fee} \times \frac{q_i}{Volume\_Total_{ordre}}\right)$$
- **Les 4 états de conservation** :
  - $\text{Frais Récupérés}$ = Total des écritures `brokers_fee` collectées.
  - $\text{Frais Rapprochés}$ = Total des frais corrélés avec certitude à un ordre ou transaction.
  - $\text{Frais Alloués}$ = Quote-part imputée aux transactions exécutées et consommées en FIFO (`allocated_buy_fees_isk`, `allocated_sell_fees_isk`).
  - $\text{Frais Non Attribués}$ = Quote-part des volumes non exécutés (ordres annulés/expirés) et frais orphelins (`unallocated_broker_fees_isk`).
- **Invariance stricte** :
  $$\text{Frais Récupérés} = \text{Frais Alloués} + \text{Frais Non Attribués}$$

---

## 2. Métriques de Capital & Patrimoine

### 2.1. Capital Immobilisé en Inventaire ($Cap_{immo}$)
- **Formule** : Somme des coûts d'acquisition et frais d'achat des reliquats non alloués des transactions d'achat et des lots d'ouverture.
- **Principe** : Le reliquat invendu reste strictement du capital immobilisé et n'est jamais transformé en profit réalisé.

### 2.2. Répartition Mutuellement Exclusive du Capital
- **Liquidités ($Cap_{libre}$)** : Somme des soldes réels de portefeuille collectés directement depuis l'ESI (`GET /characters/{character_id}/wallet` pour les personnages et `GET /corporations/{corporation_id}/wallets` pour les divisions `1..7` de corporation, dédupliquées par `(corporation_id, division)`), filtrée selon les paramètres de synchronisation et d'inclusion définis par l'utilisateur (`CHARACTERS_ONLY`, `CORPORATION_ONLY` ou `BOTH`, avec possibilité d'exclure individuellement un personnage endetté ou une division spécifique).
- **Escrow Marché ($Cap_{escrow}$)** : Somme bloquée pour les buy orders en cours.
- **Valeur de Revient Stocks Vente ($Cap_{stock\_vente}$)** : Coût des actifs posés en sell orders.
- **Valeur de Revient Stocks Libres ($Cap_{stock\_libre}$)** : Coût des actifs en station disponibles.
- **Valeur de Revient Stocks Dormants ($Cap_{stock\_dormant}$)** : Coût des actifs éloignés hors hub.

---

## 3. Métriques Analytiques & Vélocité

### 3.1. Vélocité Journalière ($V_{jour}$)
- **Formule** : $\frac{\text{Quantité vendue sur la fenêtre observation}}{\text{Nombre de jours de la fenêtre}}$
- **Fenêtre par défaut** : 90 jours (calée sur la durée de validité standard maximale d'un ordre de marché EVE Online de 90 jours), avec granularités paramétrables (14j, 30j, 60j, 90j).

### 3.2. Durée Moyenne de Détention ($D_{detention}$)
- **Formule** : Moyenne pondérée en jours entre la date d'achat et la date de vente pour tous les lots réconciliés.

### 3.3. Rendement par Capital-Jour ($R_{cap\_jour}$)
- **Formule** : $\frac{ROI_{TTC}}{D_{detention}}$ (exprimé en % de gain par jour de capital immobilisé).

---

## 4. Métriques Opérationnelles (Réapprovisionnement & Transferts)

### 4.1. Quantité Cible ($Q_{cible}$)
- **Formule** : $(V_{jour} \times H_{jours\_couverture}) + S_{securite}$

### 4.2. Quantité Nette Nécessaire ($Q_{besoin}$)
- **Formule** : $\max(0, \lceil Q_{cible} - (\text{Stock Libre Hub} + \text{Stock en Vente} + \text{Buy Orders}) \rceil)$

### 4.3. Répartition Opérationnelle
- **Transfert Prioritaire ($Q_{transfert}$)** : $\min(Q_{besoin}, \text{Stock Libre Distant})$
- **Achat Net Nécessaire ($Q_{achat}$)** : $Q_{besoin} - Q_{transfert}$
