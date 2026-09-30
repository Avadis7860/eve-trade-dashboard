# Tests et CI

Contrat : tests ajoutés avec le code, exécutés avant chaque push via hook local, et CI sur chaque push de branche et PR vers main. Le merge est interdit si un check requis est rouge. Ne jamais désactiver un job ou assouplir une assertion pour masquer un défaut.

Scripts à créer en phase 00 : npm run lint, typecheck, test -- --run, build ; test:e2e quand le parcours existe. Le hook pre-push exécute au minimum lint, typecheck, tests unitaires et build. CI avec checks nommés stables ; protection de main à configurer.

Niveaux : Vitest pour domaine ; React Testing Library pour composants ; MSW pour HTTP ; base isolée pour migrations et contraintes ; Playwright pour E2E ; TypeScript strict et ESLint. Aucun test ne dépend d'un compte EVE réel ou d'une API externe en direct.

Régressions minimales : SSO invalide/expiré/scope manquant ; cache/304/420/429/Retry-After/5xx/timeout ; pagination interrompue, curseur répété, reprise ; transactions dupliquées et isolation personnage ; ordres partiels/terminés/annulés/expirés/disparus ; coûts inconnus, frais doubles, ROI partiel et décimal exact ; hub inconnu ; distinction zéro/vide/stale/partial/error.

Le PR indique les commandes réellement exécutées, résultats, tests ajoutés et vérifications non effectuées. Ne jamais déclarer réussi un test non lancé.