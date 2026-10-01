# EVE Trade Dashboard

Tableau de bord personnel React/TypeScript de suivi des ventes et ordres EVE Online via l'ESI officiel CCP. Le tableur existant reste la référence pour détecter les opportunités d'achat/vente : ce projet ne le reproduit pas.

**État actuel :** Application complète post-Phase 12 (SSO, Grand livre, Ordres, Hubs & ROI TTC, Capital & Inventaire, Product 360, Opérations de réassort & transferts, Cockpit unifié). Audit contradictoire réalisé et feuille de route d'assurance fiabilité établie ([docs/AUDIT-POST-PHASE-12.md](docs/AUDIT-POST-PHASE-12.md), [docs/MASTERPLAN-ASSURANCE-FIABILITE.md](docs/MASTERPLAN-ASSURANCE-FIABILITE.md)).

Commencer par [docs/INDEX.md](docs/INDEX.md), puis le [masterplan](docs/MASTERPLAN.md) et le [rapport d'audit](docs/AUDIT-POST-PHASE-12.md). Les instructions d'agent sont dans [GEMINI.md](GEMINI.md) et [docs/AI_AGENT_WORKFLOW.md](docs/AI_AGENT_WORKFLOW.md).

Principes : ESI en lecture seule au MVP ; OAuth et appels privés uniquement côté serveur ; aucune donnée inconnue/partielle/en erreur convertie en zéro ; tests avant chaque push et CI obligatoire ; index canonique du code mis à jour à chaque phase de code.