# Périmètre produit

## Inclus
- **Connexion EVE SSO multi-personnages** avec scopes minimaux en lecture seule et isolation sécurisée.
- **Gestion et décomposition du capital** en états mutuellement exclusifs : liquidités de portefeuille, escrow des ordres d'achat, stocks engagés en ordres de vente, stocks libres en hub, stocks dormants/éloignés, et stocks en transit.
- **Grand livre exhaustif des transactions et journal** avec filtres par période, personnage, objet, station et hub.
- **Moteur de réconciliation financière (FIFO multi-personnages et allocations manuelles)** reliant achats et ventes du même objet dans l'écosystème du joueur.
- **Bénéfice réalisé TTC et ROI TTC** prouvés arithmétiquement, intégrant coût d'acquisition matière, frais de courtage d'achat, frais de courtage de vente et taxes de vente SCC.
- **Fiche Product 360** accessible depuis tout élément de l'interface, centralisant historique, ordres actifs, stocks par station, vélocité, durée de détention et séries temporelles.
- **Aide opérationnelle au réapprovisionnement et aux transferts** :
  - Identification prioritaire des stocks transférables existants avant toute proposition d'achat.
  - Calcul du besoin d'achat net basé sur le run-rate réel, le stock de sécurité et un horizon de couverture en jours.
  - Export compatible EVE Multibuy (`<Nom>\t<Quantité>`) et CSV.
- **Cartographie et classification configurable des hubs** commerciaux majeurs et personnalisés.
- **Transparence totale** : affichage systématique de l'horodatage (`as_of`), de la fraîcheur, de la couverture et des preuves sous-jacentes.

## Exclu
- **Pas de reproduction du tableur externe** d'arbitrage, de scan d'opportunités de marché spéculatives ou de recommandation de prix de vente.
- **Pas de mutation en jeu** : aucune création, modification ou annulation d'ordre EVE, ni automatisation du client ou simulation de clics.
- **Pas d'estimation présentée comme certaine** : un profit sans achat antérieur prouvé reste strictly `UNKNOWN` ou `PARTIAL`.
- **Pas d'amalgame entre ordres de vente et liquidités** : la valeur notionnelle d'un ordre de vente n'est jamais additionnée au capital liquide ou au profit réalisé.
- **Pas d'historique antérieur à la première synchronisation locale** ou au-delà des fenêtres de rétention ESI (sauf déclaration explicite de lots d'ouverture).

## Vocabulaire & Invariants
- **Vente observée** : Transaction ESI persistée et immuable.
- **Ordre terminé** : Confirmé par preuve (diff de snapshot ou transaction corrélée), jamais déduit de la seule disparition de l'API.
- **TTC (Toutes Taxes et Frais Compris)** : Concerne exclusivement les prélèvements EVE Online (taxe de vente SCC et frais de courtage de station).
- **Stock Libre** : Actif physique présent en station non réservé dans un ordre de vente en cours.
- **Escrow d'achat** : Somme ISK immobilisée par la corporation de marché pour garantir un ordre d'achat ouvert.
