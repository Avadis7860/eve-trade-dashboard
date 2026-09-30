import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateOrderLifecycle, calculateExpirationIso } from './lifecycle.ts';
import { InMemoryOrdersRepository } from './repository.ts';
import { OrdersService } from './service.ts';
import { InMemoryLedgerRepository } from '../ledger/repository.ts';
import { UniverseService } from '../universe/service.ts';
import type { RawEsiOrder, CharacterOrderSnapshot } from './types.ts';

describe('Orders Lifecycle & Restock Module (Phase 04)', () => {
  let repo: InMemoryOrdersRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let universeService: UniverseService;
  let service: OrdersService;

  beforeEach(() => {
    repo = new InMemoryOrdersRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    universeService = new UniverseService();
    service = new OrdersService(repo, ledgerRepo, universeService);
  });

  describe('Lifecycle State Machine (evaluateOrderLifecycle)', () => {
    it('classifies active order with untouched volume as ACTIVE', () => {
      const raw: RawEsiOrder = {
        order_id: 101,
        type_id: 34,
        region_id: 10000002,
        location_id: 60003760,
        range: 'region',
        price: 5.5,
        volume_total: 10000,
        volume_remain: 10000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
      };

      const result = evaluateOrderLifecycle(raw);
      expect(result.state).toBe('ACTIVE');
      expect(result.volumeFilled).toBe(0);
    });

    it('classifies order with reduced volume as PARTIALLY_FILLED with delta', () => {
      const raw: RawEsiOrder = {
        order_id: 101,
        type_id: 34,
        region_id: 10000002,
        location_id: 60003760,
        range: 'region',
        price: 5.5,
        volume_total: 10000,
        volume_remain: 6000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
      };

      const existing: CharacterOrderSnapshot = {
        id: '1001:101',
        characterId: 1001,
        orderId: 101,
        typeId: 34,
        regionId: 10000002,
        locationId: 60003760,
        isBuyOrder: false,
        price: 5.5,
        volumeTotal: 10000,
        volumeRemain: 8000,
        volumeFilled: 2000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
        expiresAt: '2026-12-19T10:00:00Z',
        state: 'PARTIALLY_FILLED',
        stateJustification: '',
        firstObservedAt: Date.now() - 3600000,
        lastObservedAt: Date.now() - 3600000,
        lastSnapshotVolumeRemain: 8000,
        isActiveInCurrentSnapshot: true,
        source: 'test',
      };

      const result = evaluateOrderLifecycle(raw, existing);
      expect(result.state).toBe('PARTIALLY_FILLED');
      expect(result.volumeFilled).toBe(4000);
      expect(result.justification).toContain('-2000');
    });

    it('classifies order with 0 volume remain as COMPLETED_CONFIRMED', () => {
      const raw: RawEsiOrder = {
        order_id: 101,
        type_id: 34,
        region_id: 10000002,
        location_id: 60003760,
        range: 'region',
        price: 5.5,
        volume_total: 10000,
        volume_remain: 0,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
      };

      const result = evaluateOrderLifecycle(raw);
      expect(result.state).toBe('COMPLETED_CONFIRMED');
      expect(result.volumeFilled).toBe(10000);
    });

    it('classifies cancelled and expired historical orders accurately', () => {
      const cancelledRaw: RawEsiOrder = {
        order_id: 102,
        type_id: 34,
        region_id: 10000002,
        location_id: 60003760,
        range: 'region',
        price: 5.5,
        volume_total: 10000,
        volume_remain: 4000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
        state: 'cancelled',
      };
      const cancelledResult = evaluateOrderLifecycle(cancelledRaw, undefined, true);
      expect(cancelledResult.state).toBe('CANCELLED_CONFIRMED');
      expect(cancelledResult.volumeFilled).toBe(6000);

      const expiredRaw: RawEsiOrder = {
        order_id: 103,
        type_id: 34,
        region_id: 10000002,
        location_id: 60003760,
        range: 'region',
        price: 5.5,
        volume_total: 10000,
        volume_remain: 10000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
        state: 'expired',
      };
      const expiredResult = evaluateOrderLifecycle(expiredRaw, undefined, true);
      expect(expiredResult.state).toBe('EXPIRED_CONFIRMED');
    });

    it('calculates expiration date accurately', () => {
      const exp = calculateExpirationIso('2026-01-01T00:00:00.000Z', 90);
      expect(exp).toBe('2026-04-01T00:00:00.000Z');
    });
  });

  describe('Orders Repository & Character Isolation', () => {
    const snap1: CharacterOrderSnapshot = {
      id: '1001:201',
      characterId: 1001,
      orderId: 201,
      typeId: 34,
      typeName: 'Tritanium',
      regionId: 10000002,
      locationId: 60003760,
      locationName: 'Jita IV - Moon 4',
      isBuyOrder: false,
      price: 5.5,
      volumeTotal: 100000,
      volumeRemain: 100000,
      volumeFilled: 0,
      issued: '2026-09-20T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-19T10:00:00Z',
      state: 'ACTIVE',
      stateJustification: 'Actif',
      firstObservedAt: 1758362400000,
      lastObservedAt: 1758362400000,
      lastSnapshotVolumeRemain: 100000,
      isActiveInCurrentSnapshot: true,
      source: '/characters/1001/orders/',
    };

    const snap2: CharacterOrderSnapshot = {
      id: '1002:202',
      characterId: 1002,
      orderId: 202,
      typeId: 35,
      typeName: 'Pyerite',
      regionId: 10000002,
      locationId: 60003760,
      locationName: 'Jita IV - Moon 4',
      isBuyOrder: true,
      price: 12.0,
      volumeTotal: 50000,
      volumeRemain: 50000,
      volumeFilled: 0,
      escrow: 600000,
      issued: '2026-09-20T10:00:00Z',
      duration: 90,
      expiresAt: '2026-12-19T10:00:00Z',
      state: 'ACTIVE',
      stateJustification: 'Actif',
      firstObservedAt: 1758362400000,
      lastObservedAt: 1758362400000,
      lastSnapshotVolumeRemain: 50000,
      isActiveInCurrentSnapshot: true,
      source: '/characters/1002/orders/',
    };

    it('enforces character isolation', () => {
      repo.saveOrderSnapshots([snap1, snap2]);

      const res1 = repo.getOrders({ characterId: 1001 });
      expect(res1.items).toHaveLength(1);
      expect(res1.items[0].orderId).toBe(201);

      const res2 = repo.getOrders({ characterId: 1002 });
      expect(res2.items).toHaveLength(1);
      expect(res2.items[0].orderId).toBe(202);
    });

    it('marks orders missing from new active snapshot as DISAPPEARED_UNCONFIRMED', () => {
      repo.saveOrderSnapshots([snap1]);
      expect(repo.getOrderById(1001, 201)?.state).toBe('ACTIVE');

      // Next sync: active orders snapshot arrives without order 201
      const activeOrderIds = new Set<number>([999]); // 201 is missing!
      const changed = repo.markMissingOrdersAsDisappeared(1001, activeOrderIds, Date.now());

      expect(changed).toBe(1);
      const updated = repo.getOrderById(1001, 201);
      expect(updated?.isActiveInCurrentSnapshot).toBe(false);
      expect(updated?.state).toBe('DISAPPEARED_UNCONFIRMED');
      expect(updated?.stateJustification).toContain('sans confirmation ESI');
    });

    it('computes aggregated order metrics correctly', () => {
      repo.saveOrderSnapshots([snap1]);

      const summary = repo.getSummary(1001);
      expect(summary.totalOrdersTracked).toBe(1);
      expect(summary.activeOrdersCount).toBe(1);
      expect(summary.totalActiveIskValue).toBe(550000); // 100000 * 5.5
    });
  });

  describe('Restock Suggestions & Local Lists (Zero ESI Mutations)', () => {
    it('generates restock suggestions for completed and low-stock sell orders', () => {
      const completedOrder: CharacterOrderSnapshot = {
        id: '1001:301',
        characterId: 1001,
        orderId: 301,
        typeId: 34,
        typeName: 'Tritanium',
        regionId: 10000002,
        locationId: 60008494,
        locationName: 'Amarr VIII (Oris)',
        isBuyOrder: false,
        price: 7.5,
        volumeTotal: 50000,
        volumeRemain: 0,
        volumeFilled: 50000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
        expiresAt: '2026-12-19T10:00:00Z',
        state: 'COMPLETED_CONFIRMED',
        stateJustification: 'Complété',
        firstObservedAt: 1758362400000,
        lastObservedAt: 1758362400000,
        lastSnapshotVolumeRemain: 0,
        isActiveInCurrentSnapshot: false,
        source: 'test',
      };

      repo.saveOrderSnapshots([completedOrder]);

      const result = service.generateRestockSuggestions(1001);
      expect(result.generated).toBe(1);
      expect(result.items).toHaveLength(1);

      const item = result.items[0];
      expect(item.typeId).toBe(34);
      expect(item.typeName).toBe('Tritanium');
      expect(item.suggestedQuantity).toBe(50000);
      expect(item.targetQuantity).toBe(50000);
      expect(item.sellHubId).toBe(60008494);
      expect(item.targetBuyHubId).toBe(60003760); // Default Jita
      expect(item.status).toBe('SUGGESTED');
    });

    it('allows updating quantity, notes, and status on restock list items locally', () => {
      const created = repo.createRestockItem({
        characterId: 1001,
        typeId: 34,
        typeName: 'Tritanium',
        targetBuyHubId: 60003760,
        sellHubId: 60008494,
        suggestedQuantity: 50000,
        targetQuantity: 50000,
        justification: 'Vente terminée',
      });

      const updated = service.updateRestockItem(1001, created.id, {
        targetQuantity: 75000,
        status: 'PLANNED',
        notes: 'Acheter à Jita lors du prochain convoi Hauler',
      });

      expect(updated).not.toBeNull();
      expect(updated?.targetQuantity).toBe(75000);
      expect(updated?.status).toBe('PLANNED');
      expect(updated?.notes).toContain('Hauler');

      // Delete test
      const deleted = service.deleteRestockItem(1001, created.id);
      expect(deleted).toBe(true);
      expect(service.getRestockItems(1001)).toHaveLength(0);
    });
  });
});
