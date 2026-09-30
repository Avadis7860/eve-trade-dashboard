# Contrats du domaine

## Identités et preuves
Les identités transaction_id, journal_entry_id et order_id sont distinctes. Les données privées sont rattachées au personnage autorisé. Conserver IDs ESI, route source, horodatage métier, instant d'observation et métadonnées utiles.

## Observation vs projection
Une observation ESI est conservée comme preuve immuable. Une projection est une interprétation reconstruisible et versionnée. Une correction utilisateur est une annotation séparée, datée et justifiée ; elle ne réécrit pas la source.

## États
KNOWN, UNKNOWN, PARTIAL, ERROR et ABSENT sont distincts. Un échec n'est pas une liste vide ; une donnée non chargée n'est pas ABSENT ; aucune inconnue ne devient zéro. Les agrégats exposent as_of, fraîcheur et couverture.

## Ordres
États minimaux : ACTIVE, PARTIALLY_FILLED, COMPLETED_CONFIRMED, CANCELLED_CONFIRMED, EXPIRED_CONFIRMED, DISAPPEARED_UNCONFIRMED, UNKNOWN. La disparition d'une liste ESI ne prouve pas la vente complète. La différence de volume_remain entre snapshots compatibles du même order_id peut indiquer une exécution, mais n'est pas une transaction.

## Finance
Montants en décimal exact ; signes ESI préservés à la source. Frais identifiables et non comptés deux fois. Toute allocation achat/vente doit être explicite. Pas de FIFO/LIFO/coût moyen implicite ni d'appariement temporel présenté comme certain. Le reliquat invendu reste capital immobilisé. ROI inconnu ou partiel si preuves insuffisantes.

## Réapprovisionnement
Chaque candidat conserve personnage, source, type, quantité justifiée, hub de vente, hub d'achat cible, état, date et motif. La liste est locale, modifiable et sans effet en jeu.