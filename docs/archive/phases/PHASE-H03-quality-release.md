# PHASE-H03 — Hardening UX, performance et release

**Type :** hardening final · **Dépendances :** 00–12, H01–H02 · **État :** Terminé / Archivé (intégré post-F11 / Série G)

---

## 1. Objectif

Stabiliser l'usage quotidien du système complet de trading, garantir l'accessibilité, optimiser les performances de rendu sur de gros volumes de données, et assurer une publication reproductible et sécurisée.

---

## 2. Contrôles & Exigences

1. **Accessibilité & Ergonomie** :
   - Conformité WCAG 2.1 AA : navigation clavier complète, contrastes vérifiés (chiffres ISK, alertes), focus visibles, alternatives tabulaires pour 100% des visualisations graphiques.
   - Formats monétaires lisibles (mode condensé K/M/B/T et mode complet précis au centième d'ISK).
2. **Performances & Montée en charge** :
   - Pagination et virtualisation des tables massives (plus de 20 000 transactions ou actifs).
   - Temps de calcul du résumé financier et du rapprochement FIFO inférieur à 200 ms.
   - Absence de re-rendus inutiles sur l'ensemble de l'arbre de composants React.
3. **Résilience opérationnelle & Concurrence** :
   - Gestion des coupures ESI prolongées avec mode dégradé clair.
   - Export/restauration de sauvegarde atomique vérifié de bout en bout avec checksums SHA-256.
   - Validation de l'absence totale de fuite de tokens OAuth ou données privées dans les logs serveur ou les réponses client.
4. **Validation E2E & Release** :
   - Parcours complets testés (connexion SSO simulée, synchronisation, réconciliation FIFO, consultation Product 360, génération de transferts/achats, export Multibuy/CSV).
   - Documentation d'exploitation et guide de démarrage à jour.

---

## 3. Critères de Sortie

- [ ] Suite de tests complète (unitaires, intégration, E2E) à 100% de réussite.
- [ ] Zéro violation d'accessibilité critique sur les parcours principaux.
- [ ] Rapport d'audit de sécurité et d'intégrité sans anomalie.
- [ ] `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md` parfaitement alignés avec l'état réel du dépôt.
- [ ] Prêt pour la release de production.
