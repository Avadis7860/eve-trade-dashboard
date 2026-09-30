# Métriques financières

« TTC » signifie ici taxes et frais EVE, pas TVA fiscale. Chaque métrique précise période, personnages, ISK, instant de calcul, fraîcheur et couverture.

Mesures : volume vendu confirmé ; chiffre d'affaires brut ; frais d'acquisition ; coût d'acquisition explicitement alloué ; frais de cession ; profit réalisé TTC ; ROI TTC ; capital immobilisé des quantités invendues.

Pour les quantités avec coût rapproché : profit réalisé = produit brut de vente − coût d'acquisition alloué − frais d'acquisition alloués − frais de cession attribuables. Investissement TTC = coût d'acquisition alloué + frais d'acquisition alloués. ROI = profit / investissement × 100. Dénominateur nul ou non prouvé : UNKNOWN. Couverture incomplète : PARTIAL.

Ne pas compter deux fois un frais potentiellement déjà reflété dans un flux net. Le rapprochement s'effectue par ordre chronologique (FIFO multi-personnages) entre les achats antérieurs et les ventes ultérieures du même objet, ou manuellement par allocation explicite. Les flux peuvent traverser les personnages d'un même compte/écosystème de trading (ex: achat sur le personnage A, vente sur le personnage B). Une vente sans achat antérieur observé reste strictement UNKNOWN. Le reliquat invendu reste en capital immobilisé, jamais en profit réalisé.

Conserver l'emplacement source. Les hubs d'achat et de vente sont attribués séparément via un mapping configurable. Emplacement non classé = UNKNOWN_HUB, pas le hub principal par défaut. Séparer chiffre d'affaires, profit, ROI, capital immobilisé et volume d'ordres ouverts.