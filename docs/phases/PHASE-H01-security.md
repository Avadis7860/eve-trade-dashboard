# PHASE-H01 — Hardening sécurité

**Type :** hardening · **Dépendances :** 00–06 intégrées

Objectif : auditer et corriger les surfaces sensibles sans ajouter de métier.

Contrôles : OAuth/state/JWT/refresh ; cookies, CSRF, CORS, CSP ; isolation personnage ; secrets dans dépôt, bundle, logs et exports ; dépendances ; scopes minimaux ; rétention, sauvegardes et suppression ; conditions CCP actuelles.

Sortie : tests de refus session/personnage/scope/CSRF ; aucun jeton ou secret exposé ; logs expurgés ; audit, corrections et risques résiduels consignés ; CI verte sans suppression de contrôle.