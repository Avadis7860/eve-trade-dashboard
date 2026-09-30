# EVE Trade Dashboard

Tableau de bord personnel React/TypeScript de suivi des ventes et ordres EVE Online via l'ESI officiel CCP. Le tableur existant reste la référence pour détecter les opportunités d'achat/vente : ce projet ne le reproduit pas.

**État initial :** dépôt neuf, documentation de cadrage uniquement.

Commencer par [docs/INDEX.md](docs/INDEX.md), puis [masterplan](docs/MASTERPLAN.md). Les instructions d'agent sont dans [GEMINI.md](GEMINI.md) et [docs/AI_AGENT_WORKFLOW.md](docs/AI_AGENT_WORKFLOW.md).

Principes : ESI en lecture seule au MVP ; OAuth et appels privés uniquement côté serveur ; aucune donnée inconnue/partielle/en erreur convertie en zéro ; tests avant chaque push et CI obligatoire ; index canonique du code mis à jour à chaque phase de code.