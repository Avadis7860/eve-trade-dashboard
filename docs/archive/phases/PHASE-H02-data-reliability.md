# PHASE-H02 — Hardening intégrité et résilience

**Type :** hardening · **Dépendances :** 02–06 intégrées · **État :** Terminé

Objectif : prouver la justesse en cas de panne, reprise et évolution des données.

Contrôles : cache/304/420/429/Retry-After/5xx/timeout ; pagination et checkpoints ; idempotence ; contraintes et transactions DB ; restauration ; rapprochement des ordres/transactions ; frais, allocation et couverture.

Sortie : tests de panne/reprise ; aucune donnée valide effacée par erreur/partiel ; aucune omission ou double comptage après reprise ; ordres et métriques explicables depuis les observations ; migration/restauration testées ; CI verte et code index à jour.

## Résultats et garanties validées

1. **Scénarios de coupure réseau et reprise sur checkpoint :**
   - Pagination `from_id` (transactions wallet) interrompue en cours de route : conservation des pages acquises avec statut `PARTIAL` et checkpoint `lastSuccessfulId`. La synchronisation suivante reprend au checkpoint sans perte ni doublon.
   - Pagination `x-pages` (journal de portefeuille, actifs ESI, historique d'ordres) : résilience aux erreurs HTTP 504 / timeout, conservation des données partielles sans effacement des observations précédentes.
   - Outage réseau complet : aucune donnée existante n'est écrasée ou remise à zéro.

2. **Limiteur de débit et quotas d'erreurs ESI :**
   - Gestion des codes 420 (error limit) et 429 (rate limit) avec respect strict du header `Retry-After`.
   - Retries bornés exponentiels avec jitter sur erreurs transitoires 5xx.
   - Traitement des réponses `304 Not Modified` via `If-None-Match` / `If-Modified-Since` avec rafraîchissement d'expiration sans duplication d'événements.

3. **Idempotence stricte et absence de double comptage :**
   - Rejeu multiple de synchronisations identiques : nombre d'enregistrements et métriques financières (chiffre d'affaires brut/net, dépenses d'achats, taxes SCC `transaction_tax`, frais de courtage) strictement invariants.
   - Rapprochement chronologique FIFO multi-personnages : réexécutions successives idempotentes, non-dépassement des quantités d'achats et de ventes, capital immobilisé exact.
   - Coexistence des allocations manuelles et automatiques sans double comptage.

4. **Désynchronisation et cycle de vie des ordres :**
   - Les ordres disparus de la liste active sans preuve d'historique basculent en `DISAPPEARED_UNCONFIRMED` et ne sont jamais déclarés `COMPLETED_CONFIRMED` à tort.

5. **Sauvegarde, Restauration atomique et Audit d'intégrité :**
   - Module `BackupRestoreService` et routes `/api/backup/export`, `/api/backup/restore`, `/api/backup/audit`.
   - Export complet avec empreinte cryptographique SHA-256 et version de schéma.
   - Rejet immédiat des sauvegardes altérées ou corrompues (checksum mismatch).
   - Restauration atomique avec rollback automatique en cas d'erreur.
   - Audit d'intégrité détectant allocations orphelines, sur-allocations et incohérences.
