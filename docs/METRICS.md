# Métriques financières

« TTC » signifie ici taxes et frais EVE, pas TVA fiscale. Chaque métrique précise période, personnages, ISK, instant de calcul, fraîcheur et couverture.

Mesures : volume vendu confirmé ; chiffre d'affaires brut ; frais d'acquisition ; coût d'acquisition explicitement alloué ; frais de cession ; profit réalisé TTC ; ROI TTC ; capital immobilisé des quantités invendues.

Pour les quantités avec coût explicitement rapproché : profit réalisé = produit brut de vente − coût d'acquisition alloué − frais d'acquisition alloués − frais de cession attribuables. Investissement TTC = coût d'acquisition alloué + frais d'acquisition alloués. ROI = profit / investissement × 100. Dénominateur nul ou non prouvé : UNKNOWN. Couverture incomplète : PARTIAL.

Ne pas compter deux fois un frais potentiellement déjà reflété dans un flux net. Aucune méthode FIFO, LIFO, coût moyen ou proximité temporelle implicite. Les allocations manuelles doivent être datées, justifiées et séparées de l'ESI. Le reliquat invendu reste en capital immobilisé, jamais en profit réalisé.

Conserver l'emplacement source. Les hubs d'achat et de vente sont attribués séparément via un mapping configurable. Emplacement non classé = UNKNOWN_HUB, pas le hub principal par défaut. Séparer chiffre d'affaires, profit, ROI, capital immobilisé et volume d'ordres ouverts.