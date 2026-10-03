# Contrats du domaine

## 1. Identités, Preuves & Immuabilité
- `transaction_id`, `journal_id`, `order_id` et `asset_id` sont des identifiants distincts et non interchangeables.
- Toute observation issue de l'ESI est une preuve immuable conservant sa route source, son horodatage UTC métier et sa date d'observation locale.
- **Identité canonique des journaux** : Une entrée de journal de corporation a pour identité canonique universelle `corp:${corporationId}:${division}:${journalId}`, indépendante du personnage observateur. Les journaux personnels ont pour identité canonique `char:${characterId}:${journalId}`. La traçabilité de l'ensemble des personnages ayant observé l'événement est conservée (`observedByCharacterIds`) sans aucune duplication de l'enregistrement économique ni de son impact financier.
- Une projection (bénéfice, ROI, besoin de réapprovisionnement, position de capital) est une interprétation explicable, versionnée et reproductible.
- Une intervention utilisateur (ex: allocation manuelle, lot d'ouverture) est une annotation séparée, datée et justifiée sans altération de la donnée brute.

## 2. États Sémantiques Fondamentaux
`KNOWN`, `UNKNOWN`, `PARTIAL`, `ERROR` et `ABSENT` sont mutuellement exclusifs et distincts de la valeur numérique zéro :
- `EMPTY` : Source synchronisée avec succès ne contenant aucun enregistrement (ex: 0 ordre actif).
- `UNKNOWN` : Donnée insuffisante pour établir un fait ou un coût (ex: vente sans achat antérieur identifié).
- `PARTIAL` : Donnée couverte à une fraction connue (ex: vente de 100 unités dont 60 couvertes par un achat antérieur ; ou synchronisation ESI interrompue/plafonnée dont la source contient encore des données en amont avec `hasMore: true`).
- `ERROR` : Échec de communication ou de traitement ; ne doit jamais être transformé en liste vide ou zéro.
- `ABSENT` : Ressource non configurée ou non accessible (ex: scope d'actifs non consenti).

Une synchronisation n'est qualifiée en `COMPLETE` que si la totalité du flux ESI a été acquise jusqu'à épuisement réel de la ressource. Toute troncature par plafond (`maxPages`, `maxItems`) ou interruption réseau/quota est impérativement qualifiée en `PARTIAL` avec checkpoint de reprise persisté.

## 3. États Mutuellement Exclusifs des Actifs Physiques
Pour tout article dans une station ou structure donnée :
1. **Stock en ordre de vente (`COMMITTED_SELL_ORDER`)** :
   $$Q_{\text{vente}} = \sum \text{volume\_remain des ordres de vente actifs du joueur dans cet emplacement}$$
2. **Stock libre au hub (`FREE_HUB_STOCK`)** :
   $$Q_{\text{libre}} = \max\left(0, \text{Stock physique total station} - Q_{\text{vente}}\right)$$
   *Condition* : L'emplacement est mappé à un hub commercial configuré.
3. **Stock dormant / éloigné (`REMOTE_DORMANT_STOCK`)** :
   Actif physique situé dans un emplacement non associé à un hub de vente actif sans mouvement depuis $X$ jours.
4. **Stock en transit (`IN_TRANSIT_STOCK`)** :
   Actif localisé dans la soute d'un vaisseau de transport ou lié à un contrat de fret en cours.
5. **Stock non rapproché (`UNRECONCILED_STOCK`)** :
   Stock physique sans transaction d'achat ni lot d'inventaire initial tracé.

## 4. États du Capital Monétaire
1. **Liquidités disponibles (`LIQUID_WALLET_BALANCE`)** : Trésorerie ISK immédiatement utilisable, issue des soldes réels ESI (`GET /characters/{character_id}/wallet` et `GET /corporations/{corporation_id}/wallets` dédupliqué par `(corporation_id, division)`). Les écritures de journal de corporation sont strictement isolées des journaux personnels et ne peuvent jamais remplacer le solde d'un personnage. L'utilisateur choisit dans les paramètres s'il synchronise et comptabilise les portefeuilles des personnages, des divisions de corporation ou les deux, avec exclusion granulaire possible par personnage (ex. personnage porteur d'une dette) ou par division.
2. **Escrow ordres d'achat (`MARKET_BUY_ESCROW`)** : Trésorerie ISK bloquée par le marché pour couvrir les buy orders ouverts.
3. **Capital immobilisé en stocks invendus (`INVENTORY_COST_VALUE`)** : Somme des coûts d'acquisition et frais de courtage des reliquats physiques non vendus.
4. **Valeur notionnelle de vente (`NOTIONAL_MARKET_ASK_VALUE`)** : Valeur théorique brute de vente des ordres en cours ($\sum \text{prix} \times \text{volume\_remain}$). Cette valeur n'est **jamais** traitée comme de la liquidité ou du bénéfice.

## 5. Cycle de Vie des Ordres
États : `ACTIVE`, `PARTIALLY_FILLED`, `COMPLETED_CONFIRMED`, `CANCELLED_CONFIRMED`, `EXPIRED_CONFIRMED`, `DISAPPEARED_UNCONFIRMED`, `UNKNOWN`.
- La disparition d'un ordre d'une réponse ESI ne constitue pas une preuve de vente complète.
- La confirmation d'exécution requiert un diff de snapshot compatible ou des transactions corrélées.

## 6. Réconciliation Financière & Règles de Coût
- Rapprochement chronologique FIFO multi-personnages : les achats antérieurs du même article au sein de l'écosystème sont affectés aux ventes chronologiquement ultérieures.
- Les allocations manuelles définies par l'utilisateur sont prioritaires et verrouillées face au FIFO automatique.
- Les frais de courtage d'achat, de vente et les taxes SCC sont imputés proportionnellement aux quantités allouées.
- **Aucun double comptage** : Un frais prélevé sur le journal de portefeuille n'est pas recomptabilisé une seconde fois.

## 7. Rapprochement Fiscal & Attribution Unique des Taxes
- **Attribution exclusive (1-to-1)** : Une entrée de taxe `transaction_tax` / `market_tax` ne peut être imputée qu'à une seule transaction de vente au maximum.
- **Contrat de traçabilité** : Chaque transaction de vente enrichie expose un objet `taxReconciliation` avec `status` (`EXACT_MATCH`, `SEQUENTIAL_M_PLUS_1`, `CORRELATED_BIJECTIVE`, `UNMATCHED`, `AMBIGUOUS`), `matchedJournalId`, `taxAmount`, `taxRate` et `justification`.
- **Invariance arithmétique** : $\sum \text{Taxes attribuées aux ventes} \le \sum \text{Taxes réelles uniques du grand livre}$.
- **Absence de taxe fictive** : Toute vente non associée à une taxe prouvée est marquée `UNMATCHED` avec une taxe numérique de 0 ISK dans le net provisoire.

## 8. Modélisation et Attribution des Frais de Courtage (Phase F08)
- **Modélisation du cycle de vie des ordres** : Les écritures `brokers_fee` référençant un ordre de marché via `context_id == order_id` sont corrélées aux ordres correspondants puis ventilées au prorata des volumes exécutés sur les transactions d'achat et de vente associées.
- **Les 4 états de frais étanches** :
  1. $\text{Frais Récupérés}$ : Somme de toutes les entrées `brokers_fee` uniques collectées en base.
  2. $\text{Frais Rapprochés}$ : Somme des frais associés avec certitude à un ordre de marché ou transaction directe.
  3. $\text{Frais Alloués}$ : Quote-part de frais imputée aux lots exécutés et consommés en FIFO (`allocated_buy_fees_isk`, `allocated_sell_fees_isk`).
  4. $\text{Frais Non Attribués}$ : Reliquats de frais d'ordres annulés, expirés sans exécution ou orphelins (`unallocated_broker_fees_isk`), conservés dans le bilan global sans perte.
- **Invariance arithmétique stricte** :
  $$\text{Frais Récupérés} = \text{Frais Alloués} + \text{Frais Non Attribués}$$
- **Explicabilité unitaire** : Chaque transaction enrichie porte sa traçabilité `brokerFeeReconciliation` (`EXACT_TRANSACTION`, `ORDER_PRO_RATA`, `UNMATCHED`).

## 9. Réconciliation Financière TTC et Couverture Déterministe (Phase F09)
- **Distinction étanche Couverture Financière vs Couverture Quantitative** :
  - La couverture financière ($Cov_{financière}$) mesure le ratio économique entre le chiffre d'affaires alloué à des achats connus ($CA_{alloué}$) et le chiffre d'affaires brut total observé ($CA_{total}$).
  - La couverture quantitative ($Cov_{volume}$) mesure le ratio physique entre le volume d'unités d'articles rapprochées et le volume total d'unités vendues.
  - Ces deux grandeurs ne doivent jamais être confondues ni amalgamées : une forte couverture en volume ne garantit en aucun cas une couverture financière équivalente.
- **Invariance arithmétique stricte du chiffre d'affaires** :
  $$\text{CA Brut Total} = \text{CA Alloué (Prouvé)} + \text{CA Non Alloué (Historique Incomplet)}$$
  Vérifiée au centime d'ISK près sur tout le périmètre de calcul.
- **Traitement du chiffre d'affaires non alloué** :
  - Les ventes dépourvues d'historique d'achat ou de stock d'ouverture restent visibles et identifiées (`gross_revenue_unallocated_isk`).
  - Aucun profit fictif ou spéculatif n'est calculé sur ce volume : le profit correspondant est strictement `null` avec statut `UNKNOWN`.
- **Formule unifiée du Bénéfice Réalisé TTC** :
  $$\text{Profit TTC} = \text{CA Alloué} - \text{Coût d'Achat Alloué} - \text{Frais Courtage Achat Alloués} - \text{Taxes Vente Attribuées} - \text{Frais Courtage Vente Attribués}$$
  $$\text{Investissement TTC Alloué} = \text{Coût d'Achat Alloué} + \text{Frais Courtage Achat Alloués}$$
  $$\text{ROI \% TTC} = \left(\frac{\text{Profit TTC}}{\text{Investissement TTC Alloué}}\right) \times 100$$
  Calculé si et seulement si $\text{Investissement TTC Alloué} > 0$.


