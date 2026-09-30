# PHASE-05 — Hubs et ROI TTC

**Type :** développement · **Dépendances :** 03–04

Objectif : classer les flux par hubs configurables et calculer uniquement les métriques démontrables.

Inclus : mapping utilisateur des stations/structures ; conservation des IDs source ; hubs d'achat et de vente distincts ; volumes, chiffre d'affaires, frais, coûts alloués, profit réalisé TTC, ROI et capital immobilisé ; moteur de réconciliation chronologique (FIFO multi-personnages) et allocations manuelles ; indicateurs de couverture ; agrégats par période, personnage(s), objet et paire de hubs.

Exclus : moteur du tableur, prix courants, recommandations de trading, coûts inventés sur ventes sans achat antérieur.

Sortie : calcul décimal exact testé ; frais non doublés ; ROI UNKNOWN/PARTIAL si preuves insuffisantes ; invendus en capital immobilisé ; tests hubs inconnus et périodes cohérentes.