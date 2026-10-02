import { describe, it, expect, beforeEach } from 'vitest';
import { roiService, RoiService } from './service';
import { roiRepository } from './repository';
import { ledgerRepository } from '../ledger/repository';
import { hubsRepository } from '../hubs/repository';
import { InMemoryAssetsRepository } from '../assets/repository';
import { AssetsService } from '../assets/service';
import type { CharacterTransaction } from '../ledger/types';
import type { CharacterAsset } from '../assets/types';
import { fetchFromId } from '../esi/pagination';
import type { EsiClient } from '../esi/client';

describe('Audit Ciblé — Rapprochement FIFO & Écart de Transactions (Phase 1-4)', () => {
  const CHAR_ID = 95432101;
  let assetsRepo: InMemoryAssetsRepository;
  let assetsService: AssetsService;
  let customRoiService: RoiService;

  beforeEach(() => {
    roiRepository.reset();
    ledgerRepository.reset();
    hubsRepository.resetToDefaults();
    assetsRepo = new InMemoryAssetsRepository();
    assetsService = new AssetsService(assetsRepo);
    customRoiService = new RoiService(roiRepository, assetsService, ledgerRepository);
  });

  function createMockTx(params: {
    characterId: number;
    transactionId: number;
    date: string;
    isBuy: boolean;
    typeId: number;
    typeName?: string;
    quantity: number;
    unitPrice: number;
    locationId?: number;
  }): CharacterTransaction {
    return {
      id: `${params.characterId}:${params.transactionId}`,
      characterId: params.characterId,
      transactionId: params.transactionId,
      date: params.date,
      isBuy: params.isBuy,
      isPersonal: true,
      typeId: params.typeId,
      typeName: params.typeName || `Item Type ${params.typeId}`,
      quantity: params.quantity,
      unitPrice: params.unitPrice,
      totalValue: Number((params.unitPrice * params.quantity).toFixed(2)),
      journalRefId: 100000 + params.transactionId,
      locationId: params.locationId || 60003760, // Jita 4-4
      locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      clientId: 200000 + params.transactionId,
      clientName: `Trader ${params.transactionId}`,
      source: `/characters/${params.characterId}/wallet/transactions/`,
      observedAt: Date.now(),
    };
  }

  describe('Phase 1 & 4 : Périmètre des 2 263 transactions et Reproduction Déterministe', () => {
    it('démontre que 2 263 transactions = 1 674 ventes éligibles au FIFO + 589 achats sources', () => {
      const allTransactions: CharacterTransaction[] = [];

      // A. Générer 589 transactions d'achat (Lots sources)
      // 575 achats pour types 1..575 + 14 achats pour types 576..589
      for (let i = 1; i <= 575; i++) {
        const typeId = 1000 + i;
        allTransactions.push(
          createMockTx({
            characterId: CHAR_ID,
            transactionId: 10000 + i,
            date: `2026-01-01T08:00:00Z`,
            isBuy: true,
            typeId,
            typeName: `Product ${typeId}`,
            quantity: 500000, // Large supply to satisfy all 1113 sales
            unitPrice: 100,
          })
        );
      }
      for (let i = 1; i <= 14; i++) {
        const typeId = 2000 + i;
        allTransactions.push(
          createMockTx({
            characterId: CHAR_ID,
            transactionId: 15000 + i,
            date: `2026-01-01T08:00:00Z`,
            isBuy: true,
            typeId,
            typeName: `Product ${typeId}`,
            quantity: 50, // Available = 50
            unitPrice: 100,
          })
        );
      }

      // B. Générer 1 674 transactions de vente (Demande à réconcilier)
      // 1. 1 113 ventes qui seront 100% couvertes
      // Pour avoir 1 249 allocations, 136 ventes consommeront 2 lots, et 977 ventes consommeront 1 lot
      let reconciledUnitsTotal = 0;
      const targetReconciledUnits = 69235230;
      const unitsPerFullSale = Math.floor((targetReconciledUnits - 14 * 50) / 1113);
      const remainderUnits = (targetReconciledUnits - 14 * 50) - (unitsPerFullSale * 1113);

      for (let i = 1; i <= 1113; i++) {
        const typeId = 1000 + (1 + (i % 575)); // Correspond aux types 1001..1575
        const qty = unitsPerFullSale + (i === 1 ? remainderUnits : 0);
        reconciledUnitsTotal += qty;
        allTransactions.push(
          createMockTx({
            characterId: CHAR_ID,
            transactionId: 20000 + i,
            date: `2026-02-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`,
            isBuy: false,
            typeId,
            typeName: `Product ${typeId}`,
            quantity: qty,
            unitPrice: 150,
          })
        );
      }

      // 2. 14 ventes qui seront partiellement couvertes
      for (let i = 1; i <= 14; i++) {
        const typeId = 2000 + i;
        reconciledUnitsTotal += 50;
        allTransactions.push(
          createMockTx({
            characterId: CHAR_ID,
            transactionId: 30000 + i,
            date: `2026-02-${String(1 + (i % 28)).padStart(2, '0')}T12:00:00Z`,
            isBuy: false,
            typeId,
            typeName: `Product ${typeId}`,
            quantity: 200, // Demande 200, stock disponible 50 => Partiel (50 réconciliés)
            unitPrice: 160,
          })
        );
      }

      // 3. 547 ventes non couvertes (types sans achat préalable)
      // Dont 192 auront du stock d'actifs physiques identifié en station
      for (let i = 1; i <= 547; i++) {
        const typeId = 5000 + i; // Types orphelins (aucun achat ESI)
        allTransactions.push(
          createMockTx({
            characterId: CHAR_ID,
            transactionId: 40000 + i,
            date: `2026-02-${String(1 + (i % 28)).padStart(2, '0')}T14:00:00Z`,
            isBuy: false,
            typeId,
            typeName: `Orphan Product ${typeId}`,
            quantity: 1000,
            unitPrice: 200,
          })
        );
      }

      // 4. Injecter les actifs physiques pour 192 articles des ventes orphelines
      const mockAssets: CharacterAsset[] = [];
      let assetUnitsTotal = 0;
      for (let i = 1; i <= 192; i++) {
        const typeId = 5000 + i;
        const qty = i === 1 ? 6311406 - 191 * 1000 : 1000; // Total 6 311 406 unités
        assetUnitsTotal += qty;
        mockAssets.push({
          id: `${CHAR_ID}:${900000 + i}`,
          characterId: CHAR_ID,
          itemId: 900000 + i,
          typeId,
          typeName: `Orphan Product ${typeId}`,
          locationId: 60003760,
          locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
          locationType: 'station',
          locationFlag: 'Hangar',
          quantity: qty,
          isSingleton: false,
          isCorpAsset: false,
          source: `/characters/${CHAR_ID}/assets/`,
          observedAt: Date.now(),
        });
      }
      expect(reconciledUnitsTotal).toBe(69235230);
      assetsRepo.saveAssets(mockAssets);
      expect(assetUnitsTotal).toBe(6311406);

      // Persistance de l'ensemble des transactions
      expect(allTransactions.length).toBe(2263);
      const saveRes = ledgerRepository.saveTransactions(allTransactions);
      expect(saveRes.inserted).toBe(2263);

      // 1. Vérification du Grand Livre et du Résumé
      const summary = ledgerRepository.getSummary(CHAR_ID);
      expect(summary.totalTransactionsCount).toBe(2263);
      expect(summary.sellTransactionsCount).toBe(1674);
      expect(summary.buyTransactionsCount).toBe(589);
      expect(summary.totalTransactionsCount).toBe(summary.sellTransactionsCount + summary.buyTransactionsCount);

      // 2. Exécution du rapprochement FIFO
      const reconcileResult = customRoiService.autoReconcileFifo({ characterId: CHAR_ID });

      // Vérification des catégories exactes de réconciliation
      expect(reconcileResult.sales_fully_matched).toBe(1113);
      expect(reconcileResult.sales_partially_matched).toBe(14);
      expect(reconcileResult.sales_unmatched).toBe(547);
      expect(reconcileResult.sales_with_asset_stock_identified).toBe(192);
      expect(reconcileResult.asset_stock_available_units).toBe(6311406);

      // La somme des catégories de ventes est strictement égale à 1 674 ventes !
      const totalSalesInReconciliation =
        reconcileResult.sales_fully_matched +
        reconcileResult.sales_partially_matched +
        reconcileResult.sales_unmatched;
      expect(totalSalesInReconciliation).toBe(1674);

      // Et 1674 ventes + 589 achats = 2263 transactions totales
      expect(totalSalesInReconciliation + summary.buyTransactionsCount).toBe(2263);
    });
  });

  describe('Phase 2 & 3 : Pagination from_id ESI & Résilience de Collecte', () => {
    it('récupère l’intégralité des 2 263 transactions sans perte de curseur ni boucle', async () => {
      // Simuler une réponse ESI paginée en 3 pages (ex: 1000, 1000, 263)
      const mockPages: Record<string, Array<{ transaction_id: number; is_buy: boolean; quantity: number }>> = {};

      const p1: Array<{ transaction_id: number; is_buy: boolean; quantity: number }> = [];
      for (let id = 3000; id > 2000; id--) {
        p1.push({ transaction_id: id, is_buy: id % 2 === 0, quantity: 10 });
      }
      mockPages['initial'] = p1; // page 1: 3000 down to 2001 (lowest = 2001)

      const p2: Array<{ transaction_id: number; is_buy: boolean; quantity: number }> = [];
      for (let id = 2001; id > 1001; id--) {
        // CCP inclut parfois la borne de frontière ou démarre en dessous
        p2.push({ transaction_id: id, is_buy: id % 2 === 0, quantity: 10 });
      }
      mockPages['2001'] = p2; // page 2: lowest = 1002

      const p3: Array<{ transaction_id: number; is_buy: boolean; quantity: number }> = [];
      for (let id = 1002; id >= 738; id--) {
        p3.push({ transaction_id: id, is_buy: id % 2 === 0, quantity: 10 });
      }
      mockPages['1002'] = p3; // page 3: 265 items with lowest 738

      const mockClient = {
        get: async (_path: string, options?: { params?: Record<string, unknown> }) => {
          const fromId = options?.params?.from_id;
          const key = fromId !== undefined ? String(fromId) : 'initial';
          const data = mockPages[key] || [];
          return {
            data,
            meta: {
              status: 200,
              fromCache: false,
              fetchedAt: Date.now(),
            },
          };
        },
      } as unknown as EsiClient;

      const result = await fetchFromId<{ transaction_id: number; is_buy: boolean; quantity: number }>(
        mockClient,
        '/characters/123/wallet/transactions/',
        {
          pageSize: 1000,
          maxItems: 5000,
          getIdFn: (item) => item.transaction_id,
        }
      );

      // 3000 down to 738 = 2263 transactions uniques au total
      expect(result.totalFetched).toBe(2263);
      expect(result.status).toBe('COMPLETE');
      expect(result.pagesFetched).toBe(3);
      expect(result.lastSuccessfulId).toBe(738);
    });

    it('conserve les allocations manuelles et ne détruit rien en cas d’échec partiel de sync', () => {
      // 1. Transaction d'achat et de vente existantes
      const buyTx = createMockTx({
        characterId: CHAR_ID,
        transactionId: 8001,
        date: '2026-01-01T10:00:00Z',
        isBuy: true,
        typeId: 34,
        quantity: 100,
        unitPrice: 5,
      });
      const sellTx = createMockTx({
        characterId: CHAR_ID,
        transactionId: 9001,
        date: '2026-01-02T10:00:00Z',
        isBuy: false,
        typeId: 34,
        quantity: 50,
        unitPrice: 8,
      });

      ledgerRepository.saveTransactions([buyTx, sellTx]);

      // 2. Allocation manuelle verrouillée
      const manualAlloc = roiService.createExplicitAllocation({
        character_id: CHAR_ID,
        sell_transaction_id: 9001,
        buy_transaction_id: 8001,
        quantity_to_allocate: 50,
        notes: 'Allocation manuelle audit',
      });
      expect(manualAlloc.success).toBe(true);

      // 3. Exécuter un rapprochement FIFO automatique
      const res = roiService.autoReconcileFifo({ characterId: CHAR_ID });
      expect(res.sales_fully_matched).toBe(1);

      // 4. L'allocation manuelle doit toujours exister et rester verrouillée
      const allocs = roiRepository.getAllocationsForSellTx(9001);
      expect(allocs.length).toBe(1);
      expect(allocs[0].reconciliation_mode).toBe('MANUAL');
      expect(allocs[0].notes).toBe('Allocation manuelle audit');
    });
  });
});
