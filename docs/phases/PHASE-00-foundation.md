# PHASE-00 — Fondations et qualité

**Type :** développement · **Dépendance :** aucune

Objectif : créer un squelette exécutable React/TypeScript + serveur Node/TypeScript, reproductible et couvert par CI.

Inclus : scaffold compatible Google AI Studio ; TypeScript strict ; npm lockfile ; lint, Vitest, React Testing Library ; scripts lint/typecheck/test/build ; test de fumée ; hook pre-push ; GitHub Actions sur push et PR ; ADR sur runtime, stockage durable, sessions et déploiement ; démarrage local ; génération de docs/CODE_INDEX.md depuis le code réel.

Exclus : SSO, ESI, métier, dashboard.

Sortie : installation verrouillée, build, lint, typecheck et tests verts ; hook bloque si contrôle requis échoue ; CI exécutée sur push/PR ; index sans chemins inventés ; décisions ADR et commandes réellement testées documentées.