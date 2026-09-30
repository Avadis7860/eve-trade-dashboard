# PHASE-12 — Cockpit, navigation unifiée et refonte ergonomique

**Type :** refonte UX/UI & intégration globale · **Dépendances :** 08, 09, 10, 11 · **État :** Planifiée

---

## 1. Problème utilisateur & Résultat attendu

- **Problème** : L'interface actuelle souffre de dispersion : bandeau de synchronisation lourd et répété sur toutes les pages, murs de cartes KPI dupliqués dans chaque onglet, absence de liens directs entre transactions, ordres et inventaire, et séparation rigide des écrans sans tableau de bord décisionnel de haut niveau.
- **Résultat attendu** : Une refonte globale de l'interface utilisateur articulée autour d'un **Cockpit de pilotage décisionnel**, d'une barre d'état système compacte et non intrusive, d'une navigation fluide entre les 6 espaces clés (Cockpit, Positions, Analyses, Opérations, Grand Livre, Configuration), et d'une densité d'information optimale pour le trading actif.

---

## 2. Dépendances exactes

- Modules amont : ensemble des services et endpoints développés dans les phases 07 à 11.
- Contrats : `docs/UX_STATES.md`, `docs/PRODUCT_REDESIGN_AUDIT.md`, `docs/PRODUCT_SCOPE.md`.

---

## 3. Périmètre inclus & Exclusions explicites

### Inclus
- **Barre d'état ESI compacte** :
  - Remplacement du grand bandeau de 80px par un indicateur d'état discret dans le bandeau supérieur (badge d'état `FRESH`/`STALE`/`SYNCING`, heure du dernier relevé, bouton de synchronisation rapide).
  - Panneau latéral / tiroir dépliable à la demande pour consulter le détail technique de synchronisation (quotas, temps de réponse, budgets d'erreur, états par ressource).
- **Refonte du Cockpit central** :
  - *Synthèse patrimoniale* : Répartition claire du capital (Liquidité, Escrow, Marchandises en vente, Stock libre, Stock dormant).
  - *Performance de la période* : Chiffre d'affaires brut, Marge brute, Frais déduits, Bénéfice net TTC, ROI TTC.
  - *Flux de trésorerie net ($Cash\_Flow_{net} = \text{Encaissements Ventes} - \text{Décaissements Achats} - \text{Taxes \& Frais}$)*.
  - *Alertes opérationnelles prioritaires* : Ordres expirés/disparus, ruptures de stock imminentes, transferts en attente.
- **Navigation contextuelle transversale** :
  - Tout identifiant ou nom d'objet ouvre immédiatement la vue Product 360 sans quitter le contexte de travail.
  - Liens directs depuis le Grand Livre vers l'inventaire et les ordres en cours.
- **Ergonomie et densité** :
  - Suppression des murs de cartes KPI redondants au profit de filtres partagés et de tableaux denses avec tri multi-colonnes.
  - Respect strict des critères d'accessibilité (contraste élevé pour les chiffres financiers, navigation clavier, libellés explicites).

### Exclusions
- Pas d'automatisation ou de fenêtres contextuelles de jeu en dehors des liens de copie Multibuy.
- Pas de dépendances graphiques lourdes dégradant la performance de rendu.

---

## 4. Architecture des vues

```
┌────────────────────────────────────────────────────────────────────────┐
│ EVE TRADE DASHBOARD    [Perso Actif ▼] [Statut ESI: FRAIS 🟢] [Synchro] │
├───────────┬────────────┬───────────┬────────────┬───────────┬──────────┤
│ 1. COCKPIT│2. POSITIONS│3. ANALYSES│4.OPÉRATIONS│5. REGISTRE│6. CONFIG │
└───────────┴────────────┴───────────┴────────────┴───────────┴──────────┘
```

---

## 5. Étapes de réalisation

1. **Bandeau ESI compact & Drawer de diagnostic** : Intégration dans la barre de titre globale de l'application.
2. **Refonte de la vue Cockpit** : Construction des modules patrimoniaux, performance et alertes.
3. **Refonte des vues Positions et Opérations** : Regroupement cohérent des ordres, stocks et transferts.
4. **Intégration de la navigation Product 360** : Câblage des modales/tiroirs de détail depuis tous les composants.
5. **Harmonisation des filtres et états UI** : Unification des sélecteurs de période, de personnage et de hubs.
6. **Tests E2E et validation d'ergonomie** : Parcours utilisateur complets, tests clavier et vérification de non-régression.

---

## 6. Critères d'acceptation mesurables

- [ ] La barre d'état ESI n'occupe plus d'espace vertical dans le flux principal de la page.
- [ ] Le Cockpit permet d'avoir en un seul coup d'œil la situation patrimoniale exacte et les actions à mener sans aucun défilement sur écran 1080p.
- [ ] Aucun chiffre de métrique n'est répété inutilement dans des cartes doublonnées sur les sous-vues.
- [ ] La navigation vers la vue Product 360 s'effectue sans rechargement de page en conservant les filtres de la vue sous-jacente.
- [ ] Tests de composants et d'intégration au vert (`vitest run`).

---

## 7. Gestion des états de chargement & Erreurs

- Chargement par squelettes (skeletons) non intrusifs pour chaque bloc indépendant.
- Les erreurs partielles d'une ressource (ex: échec passager de la synchronisation des actifs) n'empêchent pas la consultation du Grand Livre ou des Ordres.

---

## 8. Définition de Terminé

Code réel implémenté + validation complète des parcours utilisateurs au vert + CI verte + mise à jour de `docs/CODE_INDEX.md` et `docs/MASTERPLAN.md`.
