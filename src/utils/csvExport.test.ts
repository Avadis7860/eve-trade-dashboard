import { describe, it, expect, vi } from 'vitest';
import {
  escapeCsvField,
  transactionsToCsv,
  ordersToCsv,
  restockToCsv,
  allocationsToCsv,
  triggerCsvDownload,
} from './csvExport';
import { CharacterTransaction, CharacterOrderSnapshot, RestockItem, ExplicitCostAllocation } from '../App';

describe('CSV Export Utilities', () => {
  it('escapes special characters correctly according to RFC 4180', () => {
    expect(escapeCsvField('normal text')).toBe('normal text');
    expect(escapeCsvField('text with, comma')).toBe('"text with, comma"');
    expect(escapeCsvField('text with "quotes"')).toBe('"text with ""quotes"""');
    expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');
    expect(escapeCsvField(1234.56)).toBe('1234.56');
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('generates valid transactions CSV', () => {
    const mockTx: CharacterTransaction[] = [
      {
        id: '2119876543:50001',
        characterId: 2119876543,
        transactionId: 50001,
        date: '2026-09-20T10:00:00Z',
        typeId: 34,
        typeName: 'Tritanium, Pure',
        quantity: 100000,
        unitPrice: 5.5,
        totalValue: 550000,
        isBuy: false,
        isPersonal: true,
        journalRefId: 90001,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        clientId: 2001,
        clientName: 'Buyer Corp',
        source: 'ESI',
        observedAt: Date.now(),
        tax: 19800,
        brokerFee: 16500,
        netValue: 513700,
      },
    ];

    const csv = transactionsToCsv(mockTx);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('TransactionID,DateUTC,Type,TypeID,TypeName');
    expect(lines[1]).toContain('50001');
    expect(lines[1]).toContain('"Tritanium, Pure"');
    expect(lines[1]).toContain('VENTE');
    expect(lines[1]).toContain('513700');
  });

  it('generates valid orders CSV', () => {
    const mockOrders: CharacterOrderSnapshot[] = [
      {
        id: '2119876543:101',
        characterId: 2119876543,
        orderId: 101,
        typeId: 34,
        typeName: 'Tritanium',
        regionId: 10000002,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4',
        isBuyOrder: true,
        price: 5.5,
        volumeTotal: 100000,
        volumeRemain: 60000,
        volumeFilled: 40000,
        issued: '2026-09-20T10:00:00Z',
        duration: 90,
        expiresAt: '2026-12-19T10:00:00Z',
        state: 'PARTIALLY_FILLED',
        stateJustification: 'Partiellement exécuté',
        firstObservedAt: Date.now(),
        lastObservedAt: Date.now(),
        isActiveInCurrentSnapshot: true,
      },
    ];

    const csv = ordersToCsv(mockOrders);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('OrderID,IssuedUTC,ExpiresAtUTC,Type,TypeID');
    expect(lines[1]).toContain('101');
    expect(lines[1]).toContain('ACHAT');
    expect(lines[1]).toContain('PARTIALLY_FILLED');
  });

  it('generates valid restock items CSV', () => {
    const mockRestock: RestockItem[] = [
      {
        id: '2119876543:34:60008494',
        characterId: 2119876543,
        typeId: 34,
        typeName: 'Tritanium',
        targetBuyHubId: 60003760,
        targetBuyHubName: 'Jita IV - Moon 4',
        sellHubId: 60008494,
        sellHubName: 'Amarr VIII',
        suggestedQuantity: 50000,
        targetQuantity: 50000,
        status: 'SUGGESTED',
        justification: 'Vente complétée',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];

    const csv = restockToCsv(mockRestock);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('ItemID,TypeID,TypeName,Status');
    expect(lines[1]).toContain('Tritanium');
    expect(lines[1]).toContain('SUGGESTED');
    expect(lines[1]).toContain('Amarr VIII');
  });

  it('generates valid allocations CSV', () => {
    const mockAllocations: ExplicitCostAllocation[] = [
      {
        id: 'alloc-1',
        character_id: 2119876543,
        sell_transaction_id: 50002,
        buy_transaction_id: 50001,
        type_id: 34,
        type_name: 'Tritanium',
        quantity_allocated: 10000,
        unit_buy_price: 5.0,
        allocated_buy_cost: 50000,
        allocated_buy_fees: 1500,
        allocated_sell_fees: 3600,
        buy_hub_id: 'hub-jita',
        buy_hub_name: 'Jita 4-4',
        sell_hub_id: 'hub-amarr',
        sell_hub_name: 'Amarr 8',
        created_at: '2026-09-20T12:00:00Z',
      },
    ];

    const csv = allocationsToCsv(mockAllocations);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('AllocationID,SellTxID,BuyTxID');
    expect(lines[1]).toContain('alloc-1');
    expect(lines[1]).toContain('50002');
    expect(lines[1]).toContain('50001');
    expect(lines[1]).toContain('50000');
  });

  it('triggers browser download mechanism without error', () => {
    const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURLMock = vi.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;

    triggerCsvDownload('test.csv', 'header1,header2\r\nval1,val2');

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');
  });
});
