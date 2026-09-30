# PHASE-11 — Opérations, réapprovisionnement et transferts prioritaires

**Type :** opérations & aide à la décision · **Dépendances :** 08, 09, 10 · **État :** Planifiée

---

## 1. Problème utilisateur & Résultat attendu

- **Problème** : Le module de réapprovisionnement actuel (`RestockView.tsx`) propose mécaniquement d'acheter des articles à Jita dès qu'un ordre de vente expire ou est complété. Il ne vérifie pas si le joueur dispose déjà d'un stock suffisant dans un autre hub ou dans une station de stockage (stock dormant), ce qui conduit à racheter inutilement des marchandises et à immobiliser du capital. De plus, il ne permet pas de dimensionner la quantité selon la vitesse de vente observée et un horizon de couverture paramétrable.
- **Résultat attendu** : Un système opérationnel distinguant formellement deux actions :
  1. **Suggestions de transfert prioritaires** : Si du stock libre est identifié dans un autre emplacement du joueur, l'outil propose en priorité un transfert (déplacement physique de marchandises) plutôt qu'un achat.
  2. **Suggestions d'achat raisonnées** : Si aucun stock transférable n'existe, l'outil propose un achat calculé selon le run-rate réel, le stock de sécurité et l'horizon cible en jours (ex: 14 jours de couverture).

---

## 2. Dépendances exactes

- Modules amont : `src/server/orders/service.ts`, `src/server/assets/service.ts`, `src/server/hubs/service.ts`, `src/server/capital/`, `src/server/analytics/`.
- Contrats : `docs/DOMAIN_CONTRACTS.md`, `docs/PRODUCT_SCOPE.md`.

---

## 3. Périmètre inclus & Exclusions explicites

### Inclus
- **Moteur de détection de stock transférable** :
  - Analyse des actifs libres par station pour chaque article nécessitant du réapprovisionnement.
  - Identification des stocks dormants ou excédentaires dans d'autres hubs.
  - Génération de fiches de mission de transfert locales avec station de départ, station de destination, volume en $m^3$, quantité et valeur de revient.
- **Calculateur de besoin de réapprovisionnement paramétrable** :
  - Formule basée sur la vitesse moyenne de vente journalière ($V_{jour}$) sur une fenêtre configurable (par défaut 90 jours pour correspondre au cycle de vie maximal des ordres EVE, avec options 14, 30, 60, 90 jours).
  - Horizon de couverture cible ($H_{jours}$, ex: 14 à 30 jours) et stock de sécurité minimal ($S_{securite}$).
  - Déduction stricte des stocks déjà en vente et des ordres d'achat en cours.
- **Listes opérationnelles locales séparées** :
  - *Liste des transferts logistiques à effectuer* (avec calcul du volume cargo en $m^3$).
  - *Liste des achats de marché à effectuer* (avec copie au format EVE Multibuy et export CSV).
- **Statuts de suivi opérationnel** : `SUGGESTED`, `PLANNED`, `IN_TRANSIT`, `COMPLETED`, `DISMISSED`.

### Exclusions
- Aucun ordre de marché, contrat ou mouvement d'actif n'est déclenché dans le jeu (respect absolu de la lecture seule ESI).
- Pas d'automatisation des routes de voyage ou du pilotage de vaisseau.

---

## 4. Règles de calcul & Formules

1. **Quantité Nette Nécessaire ($Q_{besoin}$)** :
   $$Q_{cible} = (V_{jour} \times H_{jours}) + S_{securite}$$
   $$Q_{existant} = \text{Stock Libre Hub} + \text{Stock en Ordre Vente} + \text{Ordres Achat en Escrow}$$
   $$Q_{besoin} = \max(0, \lceil Q_{cible} - Q_{existant} \rceil)$$
2. **Arbitrage Transfert vs Achat** :
   - Si $Q_{besoin} > 0$ et $\text{Stock Libre Ailleurs} > 0$ :
     $$Q_{transfert} = \min(Q_{besoin}, \text{Stock Libre Ailleurs})$$
     $$Q_{achat} = Q_{besoin} - Q_{transfert}$$
   - Si aucun stock libre ailleurs :
     $$Q_{achat} = Q_{besoin}$$

---

## 5. Étapes de réalisation

1. **Moteur d'arbitrage Transfert/Achat** : Implémentation de la logique d'analyse croisée dans `OrdersService` ou `ReplenishmentService`.
2. **Endpoints API Opérations** : Création de `/api/operations/restock` et `/api/operations/transfers` supportant les paramètres de calcul (horizon, fenêtre de vitesse).
3. **Interface de gestion des opérations** : Refonte de la vue avec deux onglets distincts (Transferts logistiques & Achats de marché).
4. **Calculateur de volume cargo ($m^3$)** : Intégration du volume unitaire des objets EVE pour estimer la taille des voyages de transport nécessaires (Hauler, Freighter, Blockade Runner).
5. **Tests exhaustifs** : Vérification des scénarios avec stock distant partiel, stock suffisant, stock nul, et ordres d'achat déjà placés.

---

## 6. Critères d'acceptation mesurables

- [ ] Tout article présent en stock libre dans une autre station est prioritairement proposé en transfert avant toute proposition d'achat.
- [ ] La justification de chaque proposition détaille le calcul ($V_{jour}$, $H_{jours}$, stock actuel, stock distant disponible).
- [ ] La liste des transferts affiche le volume total en $m^3$ pour faciliter le choix du vaisseau de transport.
- [ ] L'export EVE Multibuy n'inclut que les quantités réelles à acheter, excluant les quantités à transférer.
- [ ] Suite complète de tests unitaires et d'intégration validée (`vitest run`).

---

## 7. Gestion des états incertains

- Si la vitesse historique est inconnue (nouvel article) : proposition basée sur le volume de l'ordre précédent avec mention explicite `Vitesse historique non disponible`.

---

## 8. Définition de Terminé

Code réel implémenté + tests d'arbitrage transferts/achats au vert + CI verte + mise à jour de `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md`.
