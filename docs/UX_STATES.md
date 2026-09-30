# UX et états de données

Écrans : vue d'ensemble ; ventes filtrables ; ordres avec état et dernière observation ; achats à préparer regroupés par hub cible ; configuration des hubs.

États visibles : LOADING (chargement sans valeur fictive), FRESH (valeur et as_of), STALE (dernière valeur marquée périmée et dernier succès), PARTIAL (couverture et raison), EMPTY (source complète sans résultat), UNAVAILABLE (scope/ressource non accessible), ERROR (échec), UNKNOWN (preuve insuffisante). EMPTY, UNAVAILABLE, ERROR et zéro doivent être visuellement distincts.

Pour les ordres, afficher le motif et les preuves de la classification. Une liste de réapprovisionnement doit expliquer sa quantité, permettre une modification locale et ne jamais laisser entendre qu'un ordre a été placé dans EVE.

Les états ne reposent pas uniquement sur la couleur. Prévoir clavier, focus, libellés, tableaux accessibles, dates localisées depuis UTC et format ISK stable. Les erreurs de synchronisation ne bloquent pas la consultation des données locales précédentes.