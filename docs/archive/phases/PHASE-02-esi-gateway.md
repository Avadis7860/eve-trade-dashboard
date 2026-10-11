# PHASE-02 — Passerelle ESI résiliente

**Type :** développement · **Dépendances :** 00–01

Objectif : centraliser les appels ESI avec cache, compatibilité, quotas, pagination et erreurs cohérents.

Inclus : adaptateur serveur typé et validation runtime ; User-Agent et date de compatibilité communs ; cache ETag/Last-Modified/Expires et 304 ; lecture des limites de débit et de taux d'erreur ; Retry-After, concurrence bornée, timeout et retry borné ; pagination adaptée aux routes, curseurs, déduplication, checkpoint et état de complétude ; observabilité expurgée.

Exclus : grand livre et UI métier.

Sortie : tests MSW de cache, 304, 420, 429, 5xx, timeout et pagination interrompue/reprise ; pas de retry infini, pas de polling avant expiration ; une erreur ne remplace pas la dernière donnée valide ; aucun appel privé depuis le navigateur.