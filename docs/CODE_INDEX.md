# Index canonique du code

**État :** à générer en phase 00 ; aucun code applicatif n'est actuellement présent. Ne pas inventer de chemins.

À maintenir dans chaque PR de code, depuis l'arborescence réelle :
- Runtime, versions, scripts npm et points d'entrée client/serveur.
- Modules : chemin, responsabilité, dépendances et contrat.
- Flux : authentification, ESI, synchronisation, persistance, API et UI.
- Types/schémas canoniques et validations runtime.
- Migrations, repositories, clés d'unicité et transactions.
- Tests et emplacements réels.
- Variables d'environnement (noms seulement, jamais valeurs).

Format par entrée : chemin — responsabilité — contrat principal — tests associés. L'index est un catalogue concis, pas une copie du code. Supprimer les références devenues invalides. Génération initiale attendue en phase 00.