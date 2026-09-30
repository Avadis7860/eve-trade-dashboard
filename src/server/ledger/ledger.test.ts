import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryLedgerRepository } from './repository.ts';
import { LedgerService } from './service.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from './types.ts';

describe('Ledger Module (Phase 03 - Sales Ledger)', () => {
  let repo: InMemoryLedgerRepository;
  let service: LedgerService;

  const sampleBuyTx: CharacterTransaction = {
    id: '1001:50001',
    characterId: 1001,
    transactionId: 50001,
    date: '2026-09-20T10:00:00Z',
    typeId: 34,
    typeName: 'Tritanium',
    quantity: 100000,
    unitPrice: 5.5,
    totalValue: 550000,
    isBuy: true,
    isPersonal: true,
    journalRefId: 90001,
    locationId: 60003760,
    locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    clientId: 2001,
    clientName: 'Supplier Corp',
    source: '/characters/1001/wallet/transactions/',
    observedAt: 1758362400000,
  };

  const sampleSellTx: CharacterTransaction = {
    id: '1001:50002',
    characterId: 1001,
    transactionId: 50002,
    date: '2026-09-21T14:30:00Z',
    typeId: 34,
    typeName: 'Tritanium',
    quantity: 50000,
    unitPrice: 7.2,
    totalValue: 360000,
    isBuy: false,
    isPersonal: true,
    journalRefId: 90002,
    locationId: 60008494,
    locationName: 'Amarr VIII (Oris) - Emperor Family Academy',
    clientId: 2002,
    clientName: 'Buyer Pilot',
    source: '/characters/1001/wallet/transactions/',
    observedAt: 1758465000000,
  };

  const sampleJournalEntry: CharacterWalletJournalEntry = {
    id: '1001:90002',
    characterId: 1001,
    journalId: 90002,
    date: '2026-09-21T14:30:00Z',
    refType: 'market_transaction',
    amount: 360000,
    balance: 10000000,
    contextId: 50002,
    contextIdType: 'market_transaction_id',
    description: 'Market Transaction',
    tax: 12960,
    taxReceiverId: 1000127,
    source: '/characters/1001/wallet/journal/',
    observedAt: 1758465000000,
  };

  beforeEach(() => {
    repo = new InMemoryLedgerRepository();
    service = new LedgerService(repo);
  });

  it('saves transactions idempotently without creating duplicates on re-import', () => {
    const firstSave = repo.saveTransactions([sampleBuyTx, sampleSellTx]);
    expect(firstSave.inserted).toBe(2);
    expect(firstSave.updated).toBe(0);
    expect(repo.countTransactions(1001)).toBe(2);

    // Re-importing identical transactions
    const secondSave = repo.saveTransactions([sampleBuyTx, sampleSellTx]);
    expect(secondSave.inserted).toBe(0);
    expect(secondSave.updated).toBe(2);
    expect(repo.countTransactions(1001)).toBe(2);
  });

  it('guarantees strict character isolation', () => {
    const charA_Tx: CharacterTransaction = { ...sampleBuyTx, characterId: 1001, transactionId: 1 };
    const charB_Tx: CharacterTransaction = { ...sampleBuyTx, characterId: 1002, transactionId: 2 };

    repo.saveTransactions([charA_Tx, charB_Tx]);

    const resultA = service.getTransactions(1001, {});
    expect(resultA.items).toHaveLength(1);
    expect(resultA.items[0].transactionId).toBe(1);

    const resultB = service.getTransactions(1002, {});
    expect(resultB.items).toHaveLength(1);
    expect(resultB.items[0].transactionId).toBe(2);

    const resultOther = service.getTransactions(9999, {});
    expect(resultOther.items).toHaveLength(0);
  });

  it('filters transactions by type (BUY / SELL / ALL)', () => {
    repo.saveTransactions([sampleBuyTx, sampleSellTx]);

    const all = service.getTransactions(1001, { type: 'ALL' });
    expect(all.items).toHaveLength(2);

    const buys = service.getTransactions(1001, { type: 'BUY' });
    expect(buys.items).toHaveLength(1);
    expect(buys.items[0].isBuy).toBe(true);

    const sells = service.getTransactions(1001, { type: 'SELL' });
    expect(sells.items).toHaveLength(1);
    expect(sells.items[0].isBuy).toBe(false);
  });

  it('filters by search term across item name, location, and client', () => {
    repo.saveTransactions([sampleBuyTx, sampleSellTx]);

    const searchByName = service.getTransactions(1001, { search: 'Tritanium' });
    expect(searchByName.items).toHaveLength(2);

    const searchByLocation = service.getTransactions(1001, { search: 'Amarr' });
    expect(searchByLocation.items).toHaveLength(1);
    expect(searchByLocation.items[0].transactionId).toBe(50002);

    const searchByClient = service.getTransactions(1001, { search: 'Supplier' });
    expect(searchByClient.items).toHaveLength(1);
    expect(searchByClient.items[0].transactionId).toBe(50001);
  });

  it('filters by date range correctly', () => {
    repo.saveTransactions([sampleBuyTx, sampleSellTx]);

    const range1 = service.getTransactions(1001, {
      fromDate: '2026-09-20T00:00:00Z',
      toDate: '2026-09-20T23:59:59Z',
    });
    expect(range1.items).toHaveLength(1);
    expect(range1.items[0].transactionId).toBe(50001);

    const range2 = service.getTransactions(1001, {
      fromDate: '2026-09-21T00:00:00Z',
    });
    expect(range2.items).toHaveLength(1);
    expect(range2.items[0].transactionId).toBe(50002);
  });

  it('sorts transactions by totalValue and date', () => {
    repo.saveTransactions([sampleBuyTx, sampleSellTx]);

    const sortedByValueDesc = service.getTransactions(1001, {
      sortBy: 'totalValue',
      sortOrder: 'desc',
    });
    expect(sortedByValueDesc.items[0].totalValue).toBe(550000);
    expect(sortedByValueDesc.items[1].totalValue).toBe(360000);

    const sortedByValueAsc = service.getTransactions(1001, {
      sortBy: 'totalValue',
      sortOrder: 'asc',
    });
    expect(sortedByValueAsc.items[0].totalValue).toBe(360000);
    expect(sortedByValueAsc.items[1].totalValue).toBe(550000);
  });

  it('calculates financial summary without assuming unproven costs', () => {
    repo.saveTransactions([sampleBuyTx, sampleSellTx]);

    const summary = service.getSummary(1001);
    expect(summary.totalTransactionsCount).toBe(2);
    expect(summary.buyTransactionsCount).toBe(1);
    expect(summary.sellTransactionsCount).toBe(1);
    expect(summary.totalBuyVolume).toBe(100000);
    expect(summary.totalSellVolume).toBe(50000);
    expect(summary.totalBuySpendIsk).toBe(550000);
    expect(summary.totalGrossSalesIsk).toBe(360000);
    expect(summary.distinctItemsCount).toBe(1);
    expect(summary.distinctLocationsCount).toBe(2);
    expect(summary.completeness).toBe('COMPLETE');
  });

  it('retrieves transaction detail linked to matching journal entry', () => {
    repo.saveTransactions([sampleSellTx]);
    repo.saveJournalEntries([sampleJournalEntry]);

    const detail = service.getTransactionDetail(1001, 50002);
    expect(detail).not.toBeNull();
    expect(detail?.transaction.transactionId).toBe(50002);
    expect(detail?.relatedJournalEntries).toHaveLength(1);
    expect(detail?.relatedJournalEntries[0].journalId).toBe(90002);
    expect(detail?.relatedJournalEntries[0].tax).toBe(12960);
  });

  it('extracts distinct filter options (types and locations)', () => {
    repo.saveTransactions([sampleBuyTx, sampleSellTx]);

    const options = service.getFilterOptions(1001);
    expect(options.types).toHaveLength(1);
    expect(options.types[0].id).toBe(34);
    expect(options.types[0].name).toBe('Tritanium');
    expect(options.types[0].count).toBe(2);

    expect(options.locations).toHaveLength(2);
  });
});
