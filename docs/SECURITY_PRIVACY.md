# Sécurité et confidentialité

Les données wallet, transactions et ordres sont privées. Toute route privée exige session valide et autorisation côté serveur.

- OAuth Authorization Code, state aléatoire à usage unique, PKCE lorsque pris en charge ; callback strictement enregistré.
- Valider JWT (signature/JWKS, issuer, audience, expiration, identité et application) avant de faire confiance aux claims.
- Secret client et refresh tokens côté serveur uniquement ; cookie HttpOnly, Secure en HTTPS, SameSite adapté ; protection CSRF sur mutations applicatives.
- Aucun token dans localStorage, sessionStorage, logs, erreurs, réponses ou bundle. Chiffrer les refresh tokens au repos avec un secret externe au dépôt.
- Vérifier character_id côté serveur, ne jamais se fier à un ID client. Isoler toutes les données par personnage.
- Minimiser scopes et données. Expurger Authorization, cookies, codes OAuth, wallet et identifiants sensibles des logs.
- Déconnexion invalide la session et traite les tokens selon la documentation CCP ; prévoir suppression et sauvegardes dans la politique de rétention.
- Ne pas transmettre des données privées à Gemini ou à un tiers sans accord explicite et revue de confidentialité.
- La licence MIT du code ne remplace pas l'accord développeur CCP en vigueur. Revoir les conditions avant usage réel, distribution ou monétisation.