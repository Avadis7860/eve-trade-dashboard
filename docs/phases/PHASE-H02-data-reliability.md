# PHASE-H02 — Hardening intégrité et résilience

**Type :** hardening · **Dépendances :** 02–06 intégrées

Objectif : prouver la justesse en cas de panne, reprise et évolution des données.

Contrôles : cache/304/420/429/Retry-After/5xx/timeout ; pagination et checkpoints ; idempotence ; contraintes et transactions DB ; restauration ; rapprochement des ordres/transactions ; frais, allocation et couverture.

Sortie : tests de panne/reprise ; aucune donnée valide effacée par erreur/partiel ; aucune omission ou double comptage après reprise ; ordres et métriques explicables depuis les observations ; migration/restauration testées ; CI verte et code index à jour.