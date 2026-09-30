# Phase R08 — Observabilité et critères de production

## Objectif
Doter l'application d'un système complet d'observabilité technique et métier sans polluer l'interface utilisateur, permettant de répondre instantanément et avec précision aux questions opérationnelles clés : *Pourquoi cette page est-elle lente ? Pourquoi ces données sont-elles anciennes ? Pourquoi cette synchronisation est-elle partielle ? Combien de données ont réellement été collectées ? Combien de requêtes ESI ont été émises ?*

## Problèmes traités
- Manque de visibilité fine sur les causes profondes des ralentissements ou des statuts partiels de synchronisation.
- Absence d'indicateurs standardisés sur l'efficacité du cache ESI (`Cache-Control`, `304 Not Modified`), la consommation du budget d'erreur ESI et les temps d'exécution SQL réels.
- Difficulté à diagnostiquer les blocages réseau ou les saturations de mémoire sans inspecter manuellement les terminaux.

## Constats vérifiés
- Le logger serveur (`src/server/utils/logger.ts`) journalise des informations expurgées de haut niveau, mais sans agrégation de métriques ni corrélation de requêtes (Correlation ID / Request ID).
- L'endpoint `/api/esi/status` renvoie l'état brut du rate limiter, mais sans historique de latence, ni ratio hit/miss de cache, ni compteur de requêtes 304.
- L'interface utilisateur comporte un onglet technique de haut niveau (`SystemRoadmapView`), mais il manque un tableau de bord de métriques d'exploitation pour le diagnostic avancé.

## Périmètre inclus
- **Collecte de métriques internes du serveur :**
  - **Métriques de synchronisation ESI :**
    - Nombre total de requêtes HTTP émises vers l'ESI par ressource.
    - Ratio de cache hits vs cache misses.
    - Nombre de réponses `304 Not Modified` économisées.
    - Compteur d'erreurs CCP : HTTP 420, 429, 500, 502, 503, 504.
    - Valeur en temps réel de `X-ESI-Error-Limit-Remain` et `Reset`.
  - **Métriques de performance SQL et stockage :**
    - Durée d'exécution (p50, p95, p99) des requêtes SQL par type (`transactions_query`, `summary_aggregation`, `fifo_reconciliation`).
    - Nombre de connexions actives dans le pool `pg.Pool`.
    - Nombre de transactions SQL validées (`COMMIT`) vs annulées (`ROLLBACK`).
  - **Métriques d'état et intégrité métier :**
    - Nombre de personnages actifs synchronisés.
    - Nombre de transactions gérées par personnage.
    - Nombre de positions de capital classifiées.
    - Nombre de lots réconciliés en mode FIFO automatique vs manuel.
    - Nombre et proportion de données qualifiées en statut `PARTIAL` ou `UNKNOWN`.
  - **Métriques de santé système :**
    - Consommation mémoire : RSS, Heap Total, Heap Used, External.
    - Event Loop Lag (latence de la boucle d'événements Node.js).
    - Temps de démarrage et uptime du serveur.
- **Endpoint d'observabilité dédié et sécurisé :**
  - `/api/system/metrics` : Expose l'état métrique structuré en JSON pour l'administrateur ou les outils d'audit.
  - `/api/system/diagnostics` : Rapport d'auto-diagnostic vérifiant la santé de la connexion PostgreSQL, la validité des tables et l'état des verrous de synchronisation.
- **Journalisation structurée et contextuelle :**
  - Attribution d'un `requestId` unique à chaque cycle de synchronisation et à chaque requête HTTP.
  - Journalisation au format JSON structuré en production avec niveau (`info`, `warn`, `error`, `debug`), timestamp ISO, `requestId`, durée en millisecondes et masquage strict des données privées.

## Périmètre exclu
- Pas d'ajout d'agents tiers lourds externes (ex: Datadog agent) nécessaires pour faire fonctionner l'application. Les métriques sont natives à Node.js et PostgreSQL.
- Aucune pollution visuelle de l'interface principale : respect strict des règles de design (pas de télémétrie visible sur les vues de trading ordinaires).

## Pré-requis
- Phases R01 à R07 terminées et intégrées.

## Architecture cible
```
                           Client / Exploitant
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Serveur Express Node.js                         │
│                                                                        │
│  ┌───────────────────────┐             ┌────────────────────────────┐  │
│  │ MetricsCollector      │             │ Structured Logger          │  │
│  │ - ESI Cache Hit/Miss  │             │ - RequestId contextuel     │  │
│  │ - SQL Latencies       │             │ - Expurgation automatique  │  │
│  │ - Heap & Event Loop   │             │ - Niveaux paramétrables    │  │
│  └───────────┬───────────┘             └─────────────┬──────────────┘  │
│              │                                       │                 │
│              ▼                                       ▼                 │
│  Endpoint /api/system/metrics                  Sortie stdout           │
│  Endpoint /api/system/diagnostics              (Logs JSON structurés)  │
└────────────────────────────────────────────────────────────────────────┘
```

## Travaux attendus
1. **Implémenter `MetricsCollector` dans `src/server/utils/metrics.ts` :** Enregistrer les métriques ESI, SQL et Node.js sous forme de compteurs et d'histogrammes en mémoire circulaire légère.
2. **Instrumenter `EsiClient` et `RateLimiter` :** Incrémenter les compteurs de cache hit, 304, 420/429 et temps de réponse ESI.
3. **Instrumenter les repositories PostgreSQL :** Mesurer la durée d'exécution des requêtes SQL et enregistrer les percentiles de latence.
4. **Créer le routeur de diagnostic `/api/system/*` :** Fournir les endpoints d'inspection protégés.
5. **Intégrer les indicateurs d'intégrité dans le rapport d'audit :** Mettre à jour `/api/backup/audit` pour refléter la qualité des données en temps réel.

## Tests obligatoires
- Test de collecte des métriques : Émettre une série de 10 requêtes ESI (dont 3 en cache 304) ; vérifier que `/api/system/metrics` rapporte exactement 7 misses, 3 hits et le total exact.
- Test de diagnostic d'intégrité : Simuler une coupure de base de données ; vérifier que `/api/system/diagnostics` remonte un statut `UNHEALTHY` avec la cause exacte sans crash du serveur.
- Test de non-régression de performance de l'instrumentation : Valider que la collecte de métriques ajoute une surcharge processeur < 0.2% au temps de traitement global.

## Mesures de performance
- Temps d'accès à `/api/system/metrics` < 5 ms.
- Impact mémoire de l'observabilité < 5 Mo de heap.

## Risques de régression
- Risque d'accumulation infinie d'échantillons métriques en mémoire : mitigation par l'utilisation de tampons circulaires à taille fixe (*Ring Buffers*).

## Critères d’entrée
- Phases R01 à R07 validées.

## Critères de sortie
- Les 5 questions opérationnelles clés reçoivent une réponse quantifiable immédiate via les métriques et diagnostics.
- L'ensemble de la chaîne applicative dispose d'une traçabilité par `requestId`.
- Tous les critères d'exploitabilité en production sont satisfaits et documentés.

## Preuves attendues
- Exemple de payload JSON retourné par `/api/system/metrics` et `/api/system/diagnostics`.
- Extrait de journalisation structurée démontrant la corrélation d'une synchronisation complexe par `requestId`.

## Dépendances vers les autres phases
- **Bloque :** Release finale de production du système de pilotage.
- **Dépend de :** Phases R01, R02, R03, R04, R05, R06, R07.

## Definition of Done
MetricsCollector implémenté + endpoints /api/system/metrics et diagnostics opérationnels + logging structuré avec requestId actif + tests de conformité au vert.
