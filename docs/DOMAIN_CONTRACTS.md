# Contrats du domaine

## 1. Identités, Preuves & Immuabilité
- `transaction_id`, `journal_id`, `order_id` et `asset_id` sont des identifiants distincts et non interchangeables.
- Toute observation issue de l'ESI est une preuve immuable conservant sa route source, son horodatage UTC métier et sa date d'observation locale.
- Une projection (bénéfice, ROI, besoin de réapprovisionnement, position de capital) est une interprétation explicable, versionnée et reproductible.
- Une intervention utilisateur (ex: allocation manuelle, lot d'ouverture) est une annotation séparée, datée et justifiée sans altération de la donnée brute.

## 2. États Sémantiques Fondamentaux
`KNOWN`, `UNKNOWN`, `PARTIAL`, `ERROR` et `ABSENT` sont mutuellement exclusifs et distincts de la valeur numérique zéro :
- `EMPTY` : Source synchronisée avec succès ne contenant aucun enregistrement (ex: 0 ordre actif).
- `UNKNOWN` : Donnée insuffisante pour établir un fait ou un coût (ex: vente sans achat antérieur identifié).
- `PARTIAL` : Donnée couverte à une fraction connue (ex: vente de 100 unités dont 60 couvertes par un achat antérieur).
- `ERROR` : Échec de communication ou de traitement ; ne doit jamais être transformé en liste vide ou zéro.
- `ABSENT` : Ressource non configurée ou non accessible (ex: scope d'actifs non consenti).

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
