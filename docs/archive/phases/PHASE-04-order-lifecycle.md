# PHASE-04 — Cycle des ordres et réapprovisionnement

**Type :** développement · **Dépendances :** 01–03

Objectif : identifier les ordres à traiter et préparer les achats sans inspection individuelle.

Inclus : snapshots des ordres actifs et historique accessible ; suivi par character_id + order_id ; comparaison de volume_remain entre snapshots compatibles ; états ACTIVE, PARTIALLY_FILLED, COMPLETED_CONFIRMED, CANCELLED_CONFIRMED, EXPIRED_CONFIRMED, DISAPPEARED_UNCONFIRMED, UNKNOWN ; rapprochement avec transactions sur preuves ; candidats et listes locales modifiables, regroupées par hub cible.

Exclus : toute écriture ESI de marché, achat automatique et conclusion basée sur la seule disparition.

Sortie : tests des transitions, tri par observed_at, cas de snapshot/page incomplet, quantité justifiée et traçable ; la liste ne déclenche aucune mutation ESI.