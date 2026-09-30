# Métriques financières et formules canoniques

Toutes les métriques produites par l'application sont déterministes, auditables, horodatées (`as_of`) et précisent leur numérateur, leur dénominateur, leur couverture et leurs limites. « TTC » désigne l'intégration exacte des frais et taxes de marché EVE Online (courtage et taxe SCC).

---

## 1. Métriques de Réalisation (Ventes exécutées)

### 1.1. Chiffre d'Affaires Brut Observé ($CA_{brut}$)
- **Formule** : $CA_{brut} = \sum (\text{Quantité vendue} \times \text{Prix unitaire de vente})$
- **Source** : Transactions de vente ESI (`isBuy = false`).
- **Périmètre** : Filtrable par période, personnage, hub, article.

### 1.2. Investissement Alloué TTC ($Inv_{TTC}$)
- **Formule** : $Inv_{TTC} = \text{Coût d'acquisition matière alloué} + \text{Frais de courtage d'achat alloués}$
- **Condition** : Si une fraction de la vente n'est pas rapprochée, $Inv_{TTC}$ correspond uniquement à la part rapprochée et le statut est `PARTIAL`.

### 1.3. Bénéfice Réalisé TTC ($Profit_{TTC}$)
- **Formule** :
  $$Profit_{TTC} = CA_{brut,\text{alloué}} - \text{Coût d'acquisition alloué} - \text{Frais d'achat alloués} - \text{Taxes SCC vente} - \text{Frais courtage vente}$$
- **Règle** : Si aucune transaction d'achat n'est rapprochée, $Profit_{TTC} = \text{null}$ avec statut `UNKNOWN`.

### 1.4. Taux de Retour sur Investissement TTC ($ROI_{TTC}$)
- **Formule** :
  $$ROI_{TTC} = \left(\frac{Profit_{TTC}}{Inv_{TTC}}\right) \times 100$$
- **Condition** : Calculé si et seulement si $Inv_{TTC} > 0$. Sinon `null`.

### 1.5. Flux de Trésorerie Net de la Période ($Cash\_Flow_{net}$)
- **Formule** :
  $$Cash\_Flow_{net} = \sum \text{Encaissements Ventes Nets} - \sum \text{Dépenses Achats Brutes} - \sum \text{Frais \& Taxes Journal}$$

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
