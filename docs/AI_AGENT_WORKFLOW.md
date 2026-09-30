# Workflow agent Google AI Studio

## Prompt de démarrage

~~~text
Tu travailles sur Avadis7860/eve-trade-dashboard. Lis GEMINI.md, docs/INDEX.md, docs/MASTERPLAN.md, puis le seul fichier de la phase autorisée et ses contrats nécessaires. Vérifie le SHA de main, branches, PR et CI ; ne travaille jamais sur main. Propose un plan borné aux critères de la phase. Implémente une petite tranche vérifiable. React/TypeScript côté UI, serveur Node pour SSO/ESI, ESI en lecture seule au MVP. Pas de moteur du tableur, pas de FIFO implicite. UNKNOWN/PARTIAL/ERROR/ABSENT ne sont pas zéro. Ajoute les tests avec le code, exécute les contrôles avant chaque push, vérifie la CI et mets à jour docs/CODE_INDEX.md et les contrats affectés. Ne désactive aucun contrôle rouge. Ne commence pas la phase suivante. Rapporte les fichiers, tests réellement exécutés, résultats et limites.
~~~

## Méthode
1. Charger l'index canonique et le seul chantier actif ; ne pas ingérer toute la documentation par défaut.
2. Vérifier baseline, branche, PR et CI avant changement.
3. Définir fichiers touchés et critères ; une phase = branche = PR.
4. Implémenter la tranche la plus petite possible et ses tests.
5. Avant chaque push, lancer lint, typecheck, tests et build (et E2E si requis). Après push, vérifier les checks réels.
6. Corriger les causes racines ; aucune boucle de branches correctives ni PR parallèles.
7. Actualiser l'index du code depuis les fichiers réels et les contrats touchés.
8. Présenter un bilan factuel ; attendre l'acceptation avant la phase suivante.

Découvertes hors périmètre : les signaler dans le PR, ne pas créer automatiquement une phase ou une issue. L'agent ne doit jamais inventer des résultats ni déclarer la phase finie si un critère manque.