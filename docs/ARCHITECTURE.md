# Architecture

## Cible
Monolithe modulaire full-stack : navigateur React + TypeScript → API applicative same-origin → serveur Node.js + TypeScript → modules auth, ESI, sync, ledger, orders, replenishment, hubs, metrics → stockage durable. Aucun appel ESI privé depuis le navigateur ; aucun jeton OAuth dans le bundle.

## Stack de référence
React, TypeScript strict, Vite si compatible avec AI Studio ; Node.js/TypeScript ; npm + lockfile ; Vitest, React Testing Library, MSW et Playwright lorsque le parcours existe. Base relationnelle durable recommandée (PostgreSQL), à confirmer par ADR en phase 00. Ne pas stocker de données durables sur disque éphémère Cloud Run.

## Responsabilités
- auth : SSO, validation d'identité, session, scopes ; jamais de règles financières.
- esi : transport, compatibilité, cache, quotas, pagination, erreurs.
- sync : collecte, curseurs, reprise et complétude.
- ledger : transactions et preuves financières.
- orders : snapshots et cycle de vie.
- replenishment : listes locales et provenance, jamais d'ordre en jeu.
- hubs : mapping d'emplacements configurable.
- metrics : agrégats versionnés et calculs exacts.
- ui : affichage et états, sans logique métier dupliquée.

Les observations source sont séparées des projections recalculables. Les clés privées sont isolées par character_id. Les imports sont idempotents ; un lot paginé n'est complet qu'après validation de toutes ses pages. Les décisions runtime, stockage, sessions et déploiement sont consignées dans une ADR en phase 00.