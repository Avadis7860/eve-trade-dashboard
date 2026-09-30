# PHASE-10 — Product 360 et visualisations temporelles

**Type :** analyse financière & interface produit · **Dépendances :** 07, 08, 09 · **État :** Terminé

---

## 1. Problème utilisateur & Résultat attendu

- **Problème** : Pour prendre une décision commerciale sur un article (ajustement de prix, arrêt de commercialisation, renforcement de stock), l'utilisateur doit aujourd'hui naviguer séparément entre le Grand Livre (ventes passées), les Ordres (prix actuel et volume restant), les Actifs (quantités en stock) et la vue Hubs (marge réalisée). De plus, l'absence totale de graphiques temporels empêche de visualiser les rythmes de vente et l'évolution des marges.
- **Résultat attendu** : Une vue unifiée **Product 360** accessible en un clic depuis n'importe quel élément de l'application (nom d'objet, ligne de tableau, graphique), combinant sur un même écran l'ensemble des données d'un article : historique d'achats/ventes, ordres en cours, stocks par station, rentabilité TTC, vélocité, durée moyenne de détention, et des graphiques chronologiques interactifs accessibles (avec alternative tabulaire).

---

## 2. Dépendances exactes

- Modules amont : `src/server/ledger/`, `src/server/orders/`, `src/server/assets/`, `src/server/roi/`, `src/server/capital/`.
- Contrats : `docs/METRICS.md`, `docs/UX_STATES.md`, `docs/PRODUCT_REDESIGN_AUDIT.md`.

---

## 3. Périmètre inclus & Exclusions explicites

### Inclus
- **Fiche d'inspection Product 360** pour tout `type_id` :
  1. *En-tête synthétique* : Nom EVE, groupe/catégorie, icône/image officielle CCP, statut global des stocks et capital engagé.
  2. *Indicateurs de performance de l'article* : Chiffre d'affaires brut historique, Coût moyen pondéré des lots vendus, Bénéfice net TTC réalisé, Taux de ROI TTC, Vitesse de vente journalière ($V_{jour}$), Durée moyenne de détention en jours ($D_{detention}$), Rendement par capital-jour.
  3. *Cartographie des stocks par emplacement* : Décomposition par station (En ordre de vente, Stock libre, Stock dormant).
  4. *Ordres de marché ouverts* : Liste des ordres d'achat et de vente actifs pour cet article avec progression d'exécution et prix unitaire.
  5. *Historique chronologique des transactions* : Table des achats et ventes filtrable avec preuve de réconciliation FIFO liée.
- **Séries temporelles & Graphiques interactifs (SVG natif ou composant réactif léger)** :
  1. *Graphique d'activité journalière & hebdomadaire* : Barres de volume vendu et courbe de chiffre d'affaires.
  2. *Graphique de profit net TTC cumulé dans le temps*.
  3. *Distribution de l'âge des lots d'inventaire* (Pyramide des âges du stock : 0-14j, 15-30j, 31-60j, 61-90j, >90j alignée avec la durée standard des ordres de 90 jours).
  4. *Matrice de comparaison des flux de hubs* (ex: Source Jita -> Destination Amarr).
- **Fenêtre d'analyse par défaut de 90 jours** : Alignée sur la durée maximale standard de dépôt d'ordres de marché dans EVE Online (90 jours), avec sélecteur de granularité (7j, 14j, 30j, 90j, 180j, tout).
- **Alternative tabulaire accessible** : Tout graphique propose un basculement immédiat vers un tableau accessible avec lecture d'écran et export CSV.

### Exclusions
- Pas d'estimation spéculative de prix futurs.
- Pas d'intégration d'outils tiers fermés ou de scraping non officiel.

---

## 4. Métriques spécifiques du Product 360

1. **Vélocité d'Écoulement ($V_{run\_rate}$)** :
   $$V_{run\_rate} = \frac{\sum_{t \in [T - \Delta t, T]} \text{Quantité Vendue}(t)}{\Delta t \text{ (en jours)}}$$
2. **Durée Moyenne de Détention ($D_{moyen}$)** :
   $$D_{moyen} = \frac{\sum_{\text{allocations}} (\text{Date Vente} - \text{Date Achat en jours}) \times \text{Quantité Allouée}}{\sum_{\text{allocations}} \text{Quantité Allouée}}$$
3. **Rendement par Capital-Jour ($R_{cap\_jour}$)** :
   $$R_{cap\_jour} = \frac{\text{ROI TTC (\%)}}{D_{moyen}}$$

---

## 5. Étapes de réalisation

1. **Endpoint API Product 360** : Création de `/api/analytics/product/:typeId` agrégeant l'ensemble des dimensions en une seule requête optimisée.
2. **Endpoints de séries temporelles** : Création de `/api/analytics/timeseries` supportant des groupements par jour/semaine/mois avec filtres de dates et hubs.
3. **Composants graphiques accessibles** : Implémentation de visualisations claires avec infobulles détaillées, gestion des contrastes et navigation clavier.
4. **Composant modal / panneau Product 360** : Création du composant d'inspection transversale avec ouverture contextuelle depuis tous les tableaux.
5. **Tests d'intégration et d'accessibilité** : Vérification de la cohérence des agrégats temporels avec le grand livre et conformité accessibilité.

---

## 6. Critères d'acceptation mesurables

- [x] Tout clic sur un nom d'article dans n'importe quel tableau ou carte ouvre la fiche Product 360 avec les données exactes de cet article.
- [x] Les graphiques temporels affichent clairement la période couverte, la date de début des données et les zones d'incertitude (périodes sans synchronisation).
- [x] Chaque graphique dispose d'un bouton d'alternative tabulaire accessible affichant les données brutes sous forme de table.
- [x] La durée moyenne de détention et la vélocité sont calculées sans extrapolation arbitraire.
- [x] Suite de tests complète validée (`vitest run`).

---

## 7. Gestion des états incertains

- Article sans vente récente : vélocité marquée `0 un./j (période observée: X jours)`.
- Vente sans date d'achat identifiée : exclue du calcul de la durée moyenne de détention avec avertissement explicite sur le taux de couverture temporelle.

---

## 8. Définition de Terminé

Code réel implémenté + composants Product 360 et graphiques testés au vert + CI verte + mise à jour de `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md`.
