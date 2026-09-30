import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAssetsRepository } from './repository.ts';
import { AssetsService } from './service.ts';
import type { CharacterAsset } from './types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';

describe('ESI Assets Module (Character & Corporation Inventory Stock)', () => {
  let repo: InMemoryAssetsRepository;
  let service: AssetsService;

  const mockAsset1: CharacterAsset = {
    id: '1001:5001',
    characterId: 1001,
    itemId: 5001,
    typeId: 34, // Tritanium
    typeName: 'Tritanium',
    quantity: 150000,
    locationId: 60003760, // Jita IV - Moon 4
    locationName: 'Jita IV - Moon 4',
    locationType: 'station',
    locationFlag: 'Hangar',
    isSingleton: false,
    isCorpAsset: false,
    source: '/characters/1001/assets/',
    observedAt: Date.now(),
  };

  const mockAsset2: CharacterAsset = {
    id: '1001:5002',
    characterId: 1001,
    itemId: 5002,
    typeId: 34,
    typeName: 'Tritanium',
    quantity: 50000,
    locationId: 60008494, // Amarr VIII
    locationName: 'Amarr VIII (Oris)',
    locationType: 'station',
    locationFlag: 'Deliveries',
    isSingleton: false,
    isCorpAsset: false,
    source: '/characters/1001/assets/',
    observedAt: Date.now(),
  };

  const mockAsset3: CharacterAsset = {
    id: '1002:5003',
    characterId: 1002,
    itemId: 5003,
    typeId: 2454, // Damaged Artificial Neural Network
    typeName: 'Damaged Artificial Neural Network',
    quantity: 155,
    locationId: 60003760,
    locationName: 'Jita IV - Moon 4',
    locationType: 'station',
    locationFlag: 'Hangar',
    isSingleton: false,
    isCorpAsset: false,
    source: '/characters/1002/assets/',
    observedAt: Date.now(),
  };

  beforeEach(() => {
    repo = new InMemoryAssetsRepository();
    service = new AssetsService(repo);
    repo.saveAssets([mockAsset1, mockAsset2, mockAsset3]);
  });

  describe('Repository & Queries', () => {
    it('retrieves paginated assets with character filter', () => {
      const res = repo.getAssets({ characterId: 1001 });
      expect(res.total).toBe(2);
      expect(res.items.length).toBe(2);
      expect(res.items.every((a) => a.characterId === 1001)).toBe(true);
    });

    it('filters assets by typeId and locationId', () => {
      const res = repo.getAssets({ characterId: 1001, typeId: 34, locationId: 60003760 });
      expect(res.total).toBe(1);
      expect(res.items[0].quantity).toBe(150000);
    });

    it('computes stock for type across locations and character pool', () => {
      // Total Tritanium across all locations for character 1001
      const stock1001 = repo.getStockForType(34, undefined, [1001]);
      expect(stock1001).toBe(200000);

      // Total Tritanium at Jita specifically
      const jitaStock = repo.getStockForType(34, 60003760, [1001]);
      expect(jitaStock).toBe(150000);

      // Damaged Artificial Neural Network for character 1002
      const neuralStock = repo.getStockForType(2454, 60003760, [1002]);
      expect(neuralStock).toBe(155);
    });

    it('provides stock location breakdown for a type', () => {
      const breakdown = repo.getStockBreakdown(34, [1001]);
      expect(breakdown.typeId).toBe(34);
      expect(breakdown.totalQuantity).toBe(200000);
      expect(breakdown.locations.length).toBe(2);
      expect(breakdown.locations.find((l) => l.locationId === 60003760)?.quantity).toBe(150000);
      expect(breakdown.locations.find((l) => l.locationId === 60008494)?.quantity).toBe(50000);
    });

    it('generates accurate summary metrics', () => {
      const summary = repo.getSummary(undefined, [1001, 1002]);
      expect(summary.totalItems).toBe(3);
      expect(summary.distinctTypes).toBe(2);
      expect(summary.distinctLocations).toBe(2);
      expect(summary.totalQuantity).toBe(200155);
      expect(summary.characterCount).toBe(2);
    });

    it('clears assets when requested', () => {
      repo.clearAssets(1001);
      const res = repo.getAssets({ characterId: 1001 });
      expect(res.total).toBe(0);
      // Character 1002 assets should still be present
      const res1002 = repo.getAssets({ characterId: 1002 });
      expect(res1002.total).toBe(1);
    });
  });

  describe('Service & Order Stock Enrichment', () => {
    it('enriches an order snapshot with real in-game physical asset stock at the order station', () => {
      const order: CharacterOrderSnapshot = {
        id: '1002:999',
        characterId: 1002,
        orderId: 999,
        typeId: 2454,
        typeName: 'Damaged Artificial Neural Network',
        regionId: 10000002,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        isBuyOrder: true,
        price: 601.10,
        volumeTotal: 155,
        volumeRemain: 0,
        volumeFilled: 155,
        issued: '2026-09-30T10:00:00Z',
        duration: 90,
        expiresAt: '2026-12-29T10:00:00Z',
        state: 'COMPLETED_CONFIRMED',
        stateJustification: 'Ordre entièrement exécuté',
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        lastSnapshotVolumeRemain: 0,
        isActiveInCurrentSnapshot: false,
        source: 'test',
      };

      const enriched = service.enrichOrderWithStock(order, [1002]);
      expect(enriched.inStockQuantity).toBe(155);
    });
  });
});
