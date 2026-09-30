# Phase R03 — Architecture des requêtes frontend

## Objectif
Assainir, décentraliser et structurer la gestion des requêtes HTTP côté client dans l'application React, afin d'éliminer les rechargements massifs inutiles, de garantir l'annulation systématique des requêtes obsolètes (`AbortController`), de dédupliquer les appels en vol et de rendre le comportement des vues déterministe lors des changements rapides d'onglets, de filtres ou de personnages.

## Problèmes traités
- `App.tsx` centralise l'intégralité du fetching applicatif via de gros blocs monolithiques (`fetchLedgerData` avec 5 requêtes, `fetchOrdersData` avec 3 requêtes, `fetchRoiAndHubsData` avec 5 requêtes).
- Tout changement de pagination ou de simple filtre textuel dans le Grand Livre déclenche à nouveau la totalité de `fetchLedgerData` (y compris le résumé financier global et les options de filtres qui n'ont pas changé).
- Une synchronisation manuelle déclenche 13 requêtes HTTP en cascade simultanée via `Promise.all([fetchLedgerData(), fetchOrdersData(), fetchRoiAndHubsData()])`.
- Absence d'annulation (`AbortController`) : lorsqu'un utilisateur tape rapidement dans la barre de recherche ou change vite d'onglet, des requêtes en retard écrasent l'état le plus récent (conditions de concurrence / *race conditions*).
- Absence de couche de cache frontend, de déduplication des requêtes identiques en vol et de politique claire de réutilisation des données non mutées.

## Constats vérifiés
- `src/App.tsx` (Lignes 481–520, 522–552, 554–577) : Fonctions `fetch*` regroupées sans `AbortController` ni mise en cache des réponses immuables.
- `src/App.tsx` (Lignes 579–601) : La fonction `handleSync` attend la réponse puis exécute `Promise.all([fetchLedgerData(), fetchOrdersData(), fetchRoiAndHubsData()])`, envoyant 13 requêtes HTTP simultanées au serveur Node.js.
- Les vues dédiées (`LedgerView`, `OrdersView`, `HubsRoiView`, `CapitalView`, `AnalyticsView`) reçoivent une quantité excessive de props et ne gèrent pas de manière autonome leur cycle de rafraîchissement ciblé.

## Périmètre inclus
- **Création d'un gestionnaire unifié de requêtes client (`ApiClient` / Hook personnalisé `useQuery`) :**
  - Gestion automatique des `AbortController` : annulation de la requête précédente si les paramètres changent avant la réception de la réponse.
  - Déduplication automatique des requêtes identiques en vol (Request Coalescing).
  - Cache en mémoire client avec durée de validité (TTL) paramétrable selon la nature des données.
  - Gestion standardisée des états : `isLoading`, `isFetching`, `data`, `error`, `isStale`, `refetch`.
- **Typologie et ségrégation stricte des données :**
  - **Données statiques / quasi-statiques (Cache long, rechargement à la demande) :** Définitions des hubs (`/api/hubs`), mappings (`/api/hubs/mappings`), options de filtres (`/api/ledger/filter-options`), informations système (`/api/info`).
  - **Données globales de session (Rechargement uniquement au changement de personnage ou après synchronisation) :** Sessions liées (`/api/auth/session`), résumés consolidés (`/api/ledger/summary`, `/api/orders/summary`, `/api/capital/summary`, `/api/roi/summary`).
  - **Données dynamiques et paginées de vue (Rechargement réactif avec annulation) :** Table des transactions (`/api/ledger/transactions`), table des ordres (`/api/orders`), table du journal (`/api/ledger/journal`).
  - **Données modales isolées (Rechargement strict à l'ouverture) :** Fiche Product 360 (`/api/analytics/product/:typeId`), séries temporelles (`/api/analytics/timeseries`).
- **Décentralisation du fetching :**
  - Les composants (`LedgerView`, `OrdersView`, etc.) consomment directement les hooks de requêtes ciblés sans que `App.tsx` n'ait à orchestrer manuellement l'intégralité du graphe d'états.
  - Après une synchronisation globale ou une réconciliation FIFO, émission d'un événement d'invalidation de cache ciblé au lieu de forcer le rechargement synchrone de 13 requêtes.

## Périmètre exclu
- Aucune refonte esthétique de la charte graphique Tailwind.
- Aucun changement des contrats d'API backend existants (maintien de la rétrocompatibilité des routes).

## Pré-requis
- Phase R00 terminée (mesure de la baseline des requêtes).
- Phase R02 terminée (fiabilité des réponses et statuts ESI/serveur).

## Architecture cible
```
┌────────────────────────────────────────────────────────────┐
│                    Composant React (Vue)                   │
│          useQuery(['ledger', 'transactions', filters])     │
└─────────────────────────────┬──────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────┐
│               Client Query Manager (useQuery)              │
│ - Vérification du Cache local & TTL                         │
│ - Déduplication des requêtes en vol                         │
│ - AbortController attaché à la clé de requête               │
│ - Protection stricte anti-Race Conditions                  │
└─────────────────────────────┬──────────────────────────────┘
                              │ Fetch avec signal d'annulation
                              ▼
┌────────────────────────────────────────────────────────────┐
│                      Serveur Express                       │
│              /api/ledger/transactions?...                  │
└────────────────────────────────────────────────────────────┘
```

## Travaux attendus
1. **Implémenter le gestionnaire de requêtes client (`src/utils/apiClient.ts` ou hooks dédiés) :** Fournir `useApiQuery` et `useApiMutation` avec support des `AbortController` et invalidation de clés (`invalidateQueries(['orders'])`).
2. **Refactoriser `App.tsx` :** Décharger `App.tsx` des états locaux massifs dupliqués et supprimer les fonctions géantes `fetchLedgerData`, `fetchOrdersData`, `fetchRoiAndHubsData`.
3. **Migrer les vues :** Connecter `LedgerView`, `OrdersView`, `HubsRoiView`, `CapitalView` et `Product360Modal` aux hooks de requêtage autonomes.
4. **Tester les scénarios de race conditions :** Valider qu'une frappe rapide "Trit" -> "Trif" -> "Tritanium" n'affiche jamais les résultats de "Trit" reçus après "Tritanium".

## Tests obligatoires
- Tests React Testing Library :
  - Vérification de l'affichage de l'état de chargement (`loading spinner`) puis des données.
  - Test de changement rapide de filtre : vérifier que le signal `abort()` est envoyé et que seule la dernière réponse est rendue dans le DOM.
  - Test de bascule rapide d'onglets : aucune fuite de mémoire ou avertissement `setState on unmounted component`.
  - Test d'invalidation : déclenchement d'une mutation (ex: création d'un hub) et vérification du rafraîchissement automatique de la liste des hubs sans recharger le Grand Livre.

## Mesures de performance
- Réduction du nombre d'appels HTTP lors d'un changement de page dans le Grand Livre : de 5 requêtes à 1 seule requête ciblée.
- Réduction du nombre d'appels HTTP lors d'une synchronisation : passage de 13 requêtes en rafale non coordonnées à un rafraîchissement sélectif des vues actives.
- Élimination totale des requêtes fantômes résolues après démontage de composant.

## Risques de régression
- Risque d'invalidation de cache incomplète après une opération complexe : mitigation par une typologie claire des clés de cache (`auth`, `ledger`, `orders`, `roi`, `capital`, `analytics`).

## Critères d’entrée
- Phase R00 et R02 validées.

## Critères de sortie
- `App.tsx` est allégé et ne contient plus de cascades `fetch*` monolithiques.
- 100% des requêtes asynchrones supportent l'annulation via `AbortController`.
- La modification d'un filtre dans un domaine ne provoque aucun rechargement dans les domaines non concernés.

## Preuves attendues
- Traces réseau du navigateur démontrant l'annulation systématique des requêtes obsolètes (`status: (canceled)`).
- Rapport de réduction du volume de requêtes par rapport à la baseline R00.

## Dépendances vers les autres phases
- **Bloque :** Phase R7 (Tests complets), Phase R8 (Observabilité).
- **Dépend de :** Phase R00, Phase R02.

## Definition of Done
Couche de requêtage unifiée déployée + AbortController actif partout + suppression des cascades monolithiques de App.tsx + tests React Testing Library au vert.
