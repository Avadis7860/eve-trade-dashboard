# PHASE-03 — Grand livre des ventes

**Type :** développement · **Dépendances :** 01–02

Objectif : persister les transactions observées de façon idempotente et les consulter sans supposer les coûts manquants.

Inclus : sync des transactions wallet avec pagination/cursor durable ; journal wallet pour frais/taxes si nécessaire ; schémas et validation ; unicité par personnage et ID source ; timestamps UTC et provenance ; normalisation achat/vente sans perdre la source ; statut par collecte ; API et liste de transactions.

Exclus : ROI final, allocation automatique non prouvée, cours et hubs définitifs.

Sortie : fixtures achat/vente/frais ; reimport sans doublon ; isolation personnage ; reprise sans omission ; historique partiel/erreur visible ; source distincte des agrégats.