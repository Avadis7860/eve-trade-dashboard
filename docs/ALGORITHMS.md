# Index Canonique des Algorithmes & Moteurs Métier

Ce document constitue la référence canonique des algorithmes, formules mathématiques et fonctions clés implémentés dans **EVE Trade Dashboard**.

---

## Invariants Fondamentaux du Système

1. **Vérité des Données :** Les états `KNOWN`, `UNKNOWN`, `PARTIAL`, `ERROR` et `ABSENT` sont distincts et ne sont **jamais convertis en zéro**.
2. **Arithmétique Décimale Exacte :** Les montants monétaires (ISK) et quotes-parts sont calculés sans arrondi prématuré.
3. **Absence d'Invention Comptable :** Aucun FIFO implicite, LIFO ou coût moyen synthétique n'est appliqué lorsqu'une donnée est manquante : le système signale formellement `UNKNOWN` ou `PARTIAL`.
4. **Non-Duplication des Frais :** Les taxes de vente SCC et les commissions de courtage ne sont jamais comptabilisées deux fois.

---

## 1. Moteur de Réconciliation Financière FIFO TTC

- **Fichiers :** `src/server/roi/service.ts`, `src/server/roi/calculator.ts`
- **Tests :** `src/server/roi/roi.test.ts`, `src/server/roi/fifo_transaction_audit.test.ts`

### 1.1 Principe d'Appariement Chronologique
Chaque vente d'un article est appariée à un ou plusieurs lots d'achat antérieurs ($\text{Date d'achat} \le \text{Date de vente}$) selon un FIFO pur :
1. **Priorité Vendeur (`prioritizeSellingCharacter`) :** L'algorithme consomme en priorité les lots d'achat acquis par le même personnage que le vendeur. Si le stock est insuffisant, il consomme les lots d'achat des autres personnages de la flotte.
2. **Cloisonnement Étanche Optionnel (`strictCharacterIsolation`) :** Empêche formellement la consommation de lots appartenant à d'autres personnages (utile pour les comptabilités séparées).
3. **Gestion des Reliquats Non Alloués :** Si le volume vendu excède l'historique d'achat disponible, le volume résiduel est classé en `unallocated_quantity` et son chiffre d'affaires en `gross_revenue_unallocated_isk`. Le statut de la réconciliation devient `PARTIAL`.

### 1.2 Formules Financières TTC Déterministes
$$\text{CA Brut Total} = \text{CA Brut Alloué} + \text{CA Brut Non Alloué}$$
$$\text{COGS TTC} = \sum (\text{Quantité Allouée} \times \text{Prix Achat Unitaire}) + \text{Courtage Achat Alloué}$$
$$\text{Frais Vente TTC} = \text{Taxes SCC Vente Allouées} + \text{Courtage Vente Alloué}$$
$$\text{Profit Net TTC} = \text{CA Brut Alloué} - \text{COGS TTC} - \text{Frais Vente TTC}$$
$$\text{ROI TTC} = \frac{\text{Profit Net TTC}}{\text{COGS TTC} + \text{Frais Vente TTC}} \times 100$$

### 1.3 Preuve Mathématique Auditable (`FormulaProof`)
Chaque transaction réconciliée produit un objet immuable `FormulaProof` contenant la formule littérale, la substitution des valeurs réelles et le résultat numérique vérifiable.

---

## 2. Moteur d'Attribution Fiscale SCC M+1

- **Fichier :** `src/server/ledger/taxReconciler.ts`
- **Tests :** `src/server/ledger/taxReconciler.test.ts`, `src/server/ledger/ledger.test.ts`

### 2.1 Algorithme en 3 Passes Exclusives
L'API ESI enregistre les taxes de vente SCC (`tax` ou `transaction_tax`) dans le journal de portefeuille, souvent avec un décalage d'une seconde ($M+1$) par rapport à la transaction de vente.
1. **Passe 1 (Lien Direct / Contexte Exact) :** Si `context_id === transaction_id`, l'attribution est immédiate et univoque.
2. **Passe 2 (Séquentielle CCP M+1) :** Rapprochement d'une écriture fiscale horodatée à $t$ ou $t+1\text{s}$ avec une transaction de vente dont le montant taxe calculé correspond exactement au montant du journal.
3. **Passe 3 (Corrélation Bijective Étroite) :** Pour les ventes groupées d'un même article à la même seconde, attribution bijective avec verrou d'unicité garantissant qu'aucune ligne de journal n'est consommée deux fois.

### 2.2 Invariance Comptable
$$\sum \text{Taxes Attribuées aux Transactions} \le \sum \text{Taxes Réelles Observées dans le Journal}$$

---

## 3. Moteur d'Attribution des Frais de Courtage (Broker Fees)

- **Fichier :** `src/server/ledger/brokerFeeReconciler.ts`
- **Tests :** `src/server/ledger/brokerFeeReconciler.test.ts`, `src/server/roi/roi.test.ts`

### 3.1 Proratisation Volumétrique
Lors de la pose d'un ordre de vente, des frais de courtage sont prélevés immédiatement sur l'ordre parent (`context_id === order_id`).
Lorsqu'une transaction partielle intervient sur cet ordre, la quote-part attribuée est calculée proportionnellement :
$$\text{Frais Alloués à la Vente} = \text{Frais Total Ordre} \times \frac{\text{Quantité Transaction}}{\text{Quantité Initiale Ordre}}$$

### 3.2 Traçabilité des Reliquats Orphelins
Les frais de courtage correspondant à des unités expirées ou annulées sont isolés en `unallocated_broker_fees_isk` :
$$\text{Total Frais de Courtage Journal} = \text{Frais Alloués aux Ventes} + \text{Frais Non Attribués}$$

---

## 4. Moteur de Décomposition du Capital & Inventaire

- **Fichier :** `src/server/capital/service.ts`
- **Tests :** `src/server/capital/capital.test.ts`

### 4.1 Classification en 5 États Mutuellement Exclusifs
Chaque unité physique et chaque ISK monétaire est partitionné sans chevauchement :
1. `COMMITTED_SELL_ORDER` : Stock engagé sur le marché (valorisé au coût d'achat, hors valeur notionnelle de vente).
2. `FREE_HUB_STOCK` : Stock libre dans un hub commercial, disponible pour la vente.
3. `REMOTE_DORMANT_STOCK` : Stock situé hors hub principal sans aucun mouvement depuis plus de 30 jours.
4. `IN_TRANSIT_STOCK` : Stock présent dans les cales de transporteurs ou vaisseaux amarrés.
5. `UNRECONCILED_STOCK` : Stock physique dont l'historique d'achat est absent.

### 4.2 Filtrage Granulaire des Soldes de Portefeuille
Prise en charge de 3 modes de liquidité :
- `CHARACTERS_ONLY` : Soldes des personnages uniquement.
- `CORPORATION_ONLY` : Soldes des 7 divisions corporatives.
- `BOTH` : Consolidation globale avec exclusion paramétrable des comptes isolés ou alts de dette.

---

## 5. Moteur d'Arbitrage Logistique & Réassort Marché

- **Fichiers :** `src/server/operations/service.ts`, `src/server/operations/volumeRegistry.ts`
- **Tests :** `src/server/operations/operations.test.ts`

### 5.1 Run-Rate Journalier & Besoin Net
Pour un article donné et un hub de vente cible :
$$V_{jour} = \frac{\sum Q_{\text{vendue}}}{\text{Jours Observés}}$$
$$Q_{\text{cible}} = V_{jour} \times H_{\text{jours de couverture}}$$
$$Q_{\text{besoin}} = \max\left(0, Q_{\text{cible}} - (Q_{\text{en vente}} + Q_{\text{stock local libre}} + Q_{\text{achats en cours}})\right)$$

### 5.2 Arbitrage Prioritaire Transferts vs Achats
1. **Transferts Prioritaires :** Le système recherche en priorité les stocks dormants distants ($Q_{\text{dormant}}$).  
   $$Q_{\text{transfert}} = \min(Q_{\text{besoin}}, Q_{\text{dormant}})$$
2. **Achats Marché Résiduels :**  
   $$Q_{\text{achat}} = \max(0, Q_{\text{besoin}} - Q_{\text{transfert}})$$

### 5.3 Métriques de Fret & Export Multibuy
- Volume total cargo en $m^3$ calculé via `volumeRegistry.ts`.
- Évaluation du nombre de voyages par classe de transporteur (Blockade Runner $10\,000\text{ m}^3$, Deep Space Transport $60\,000\text{ m}^3$, Freighter $850\,000\text{ m}^3$, Jump Freighter $350\,000\text{ m}^3$).
- Formatage compatible avec le presse-papier EVE Multibuy : `<Nom Article>\t<Quantité>`.

---

## 6. Moteur Analytique Product 360 & Séries Temporelles

- **Fichier :** `src/server/analytics/service.ts`
- **Tests :** `src/server/analytics/analytics.test.ts`

### 6.1 Indicateurs Dynamiques de Performance
- **Durée Moyenne de Détention ($D_{detention}$) :** Moyenne pondérée du temps écoulé entre l'achat et la vente des lots.
- **Rendement Capital-Jour ($R_{cap\_jour}$) :**  
  $$R_{cap\_jour} = \frac{\text{Profit Net TTC}}{\text{Capital Moyen Investi} \times \max(1, D_{detention})}$$
- **Pyramide des Âges du Stock :** Segmentation de l'inventaire invendu en 5 tranches : 0–14 jours, 15–30 jours, 31–60 jours, 61–90 jours, >90 jours.
- **Matrice des Flux de Hubs :** Corrélation spatiale entre hubs d'achat et hubs de revente.

---

## 7. Passerelle ESI Résiliente & Concurrence Distribuée

- **Fichiers :** `src/server/esi/rateLimiter.ts`, `src/server/sync/coordinator.ts`, `src/server/sync/service.ts`
- **Tests :** `src/server/sync/concurrency.test.ts`, `src/server/sync/resilience.test.ts`

### 7.1 Limiteur de Débit CCP & Budgets d'Erreur
- Analyse continue des en-têtes `X-ESI-Error-Limit-Remain` et `X-ESI-Error-Limit-Reset`.
- Suspension automatique et déblocage ordonnancé dès la détection de codes HTTP 420 ou 429 avec respect du délai `Retry-After`.
- Traitement systématique du cache conditionnel HTTP `304 Not Modified` sans décompte du budget d'erreurs.

### 7.2 Baux Distribués (`esi_sync_leases`) & Coalescing
- Coordination inter-instances via un lease horodaté avec TTL court et heartbeat périodique dans PostgreSQL, sans immobiliser de connexions de transaction SQL.
- *Request Coalescing* : fusion des requêtes en vol identiques dans le processus Node.js pour éliminer les appels redondants.

---

## 8. Cryptographie & Gestion Sécurisée des Sessions

- **Fichiers :** `src/server/auth/crypto.ts`, `src/server/auth/sessionStore.ts`, `src/server/auth/service.ts`
- **Tests :** `src/server/auth/crypto.test.ts`, `src/server/auth/auth.test.ts`, `src/server/auth/sessionStore.test.ts`

### 8.1 Chiffrement Réversible AES-256-GCM
Tous les `access_token` et `refresh_token` persistés en base de données sont chiffrés au repos avec un vecteur d'initialisation (IV) unique et un tag d'authentification GCM :
$$\text{Stockage} = \text{iv} : \text{authTag} : \text{ciphertext}$$

### 8.2 Trousseau de Flotte Sécurisé (PBKDF2)
Export/import de la flotte entière chiffré par un mot de passe utilisateur via dérivation de clé PBKDF2 (100 000 itérations).

### 8.3 Single-Flight OAuth & Résilience Iframe
- Verrou de rafraîchissement local coalescé prévenant la révocation accidentelle des tokens CCP lors d'appels simultanés.
- Double canal de session : Cookie HTTP sécurisé + En-tête `Authorization: Bearer <sessionId>` assurant la continuité de navigation dans les iframes tierces.
