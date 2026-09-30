# UX, États de données et Architecture de l'Information

## 1. Espaces de Navigation Cibles

L'application organise les parcours utilisateur en 6 espaces de décision sans redondance :

1. **Cockpit** :
   - Vue patrimoniale d'ensemble (Liquidité, Escrow, Stocks en vente, Stocks libres, Stocks dormants).
   - Indicateurs financiers de la période (Chiffre d'affaires brut, Profit réalisé TTC, ROI TTC, Cash flow net).
   - Flux d'alertes opérationnelles (ordres expirés/disparus, ruptures imminentes de stocks clés).
2. **Positions (Marché & Stocks)** :
   - Ordres de vente et d'achat actifs avec état d'exécution et prix.
   - Inventaire physique décomposé par statut (En vente, Libre au hub, Dormant, En transit).
3. **Analyses (Product 360 & Hubs)** :
   - Fiche Product 360 pour chaque article (historique, ordres, stocks, vélocité, durée de détention, rentabilité).
   - Séries temporelles interactives (ventes journalières/hebdomadaires, évolution du profit) avec alternative tabulaire.
   - Comparaison des flux entre hubs et paires de hubs.
4. **Opérations (Transferts & Réapprovisionnement)** :
   - Liste des transferts prioritaires (stocks existants à déplacer).
   - Liste des achats de réapprovisionnement nets (avec copie EVE Multibuy).
5. **Grand Livre & Journal** :
   - Registre exhaustif des transactions d'achat et vente avec preuve de réconciliation.
   - Journal des écritures de portefeuille (taxes SCC, courtage, virements).
   - Interface de gestion des allocations de coûts manuelles et réconciliation FIFO.
6. **Configuration & Système** :
   - Gestion multi-personnages EVE SSO et sélection d'écosystème.
   - Paramétrage des hubs et associations de stations/structures.
   - Centre de diagnostic ESI compact (quotas, cache, état des collectes, sauvegardes SHA-256).

## 2. États de Données Visibles

| État | Signification Visuelle | Comportement UX |
|---|---|---|
| **FRESH** | Données synchronisées récentes avec horodatage `as_of`. | Affichage normal des métriques avec badge discret. |
| **STALE** | Données locales valides mais synchronisation en retard ou inaccessible. | Affichage de la dernière valeur connue avec mention explicite "Périmé depuis [date]". |
| **PARTIAL** | Données incomplètes (ex: vente couverte à 50% par des achats). | Métrique calculée sur la part connue avec taux de couverture (%) et bouton d'allocation. |
| **EMPTY** | Source synchronisée sans enregistrement (ex: 0 ordre actif). | Message informatif dédié, distinct de l'erreur ou du zéro non initialisé. |
| **UNAVAILABLE** | Ressource inaccessible ou scope non accordé par l'utilisateur. | Invitation explicite à ré-authentifier avec les scopes nécessaires. |
| **ERROR** | Échec de requête ou de calcul. | Message d'erreur clair avec bouton de nouvelle tentative ; conservation des données locales. |
| **UNKNOWN** | Preuve insuffisante (ex: vente sans achat antérieur). | Affichage `—` ou `Non alloué`, jamais converti en 0 ou profit fictif. |

## 3. Ergonomie & Accessibilité

- **Densité adaptée** : Priorité à la lisibilité des tables avec tri multi-colonnes, recherche instantanée et filtres partagés.
- **Barre ESI non intrusive** : Indicateur compact dans l'en-tête, détails techniques déportés dans un volet latéral dépliable.
- **Accessibilité WCAG 2.1 AA** : Navigation clavier intégrale, contrastes élevés sur les montants financiers, textes alternatifs pour les visualisations, et bascule immédiate vers des tableaux accessibles.
