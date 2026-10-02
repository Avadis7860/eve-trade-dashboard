import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryLedgerRepository } from './repository.ts';
import { LedgerService } from './service.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from './types.ts';
import { makeJournalEntryKey } from './types.ts';

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

  it('retrieves transaction detail linked to matching journal entry and enriches transaction with taxes and net value', () => {
    const taxJournal: CharacterWalletJournalEntry = {
      id: '1001:90003',
      characterId: 1001,
      journalId: 90003,
      date: '2026-09-21T14:30:00Z',
      refType: 'transaction_tax',
      amount: -12960,
      balance: 10000000,
      contextId: 50002,
      contextIdType: 'transaction_tax',
      tax: 12960,
      description: 'Transaction Tax 3.6%',
      source: '/characters/1001/wallet/journal/',
      observedAt: 1758465000000,
    };

    repo.saveTransactions([sampleSellTx]);
    repo.saveJournalEntries([sampleJournalEntry, taxJournal]);

    const detail = service.getTransactionDetail(1001, 50002);
    expect(detail).not.toBeNull();
    expect(detail?.transaction.transactionId).toBe(50002);
    expect(detail?.relatedJournalEntries).toHaveLength(2);
    expect(detail?.transaction.tax).toBe(12960);
    expect(detail?.transaction.netValue).toBe(360000 - 12960); // 347,040 ISK

    const summary = service.getSummary(1001);
    expect(summary.totalTaxesIsk).toBe(12960);
    expect(summary.totalNetSalesIsk).toBe(347040);
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

  it('accurately correlates transaction_tax from SCC when contextId is omitted by CCP ESI', () => {
    // Exact structure observed in CCP ESI where contextId is missing
    const realEsiSaleTx: CharacterTransaction = {
      id: '1001:77001',
      characterId: 1001,
      transactionId: 77001,
      date: '2026-09-30T12:28:19Z',
      typeId: 34,
      typeName: 'Tritanium',
      quantity: 10000,
      unitPrice: 36.8,
      totalValue: 368000,
      isBuy: false,
      isPersonal: true,
      journalRefId: 88001,
      locationId: 60003760,
      locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      clientId: 9901,
      clientName: 'Market Buyer',
      source: '/characters/1001/wallet/transactions/',
      observedAt: 1759235299000,
    };

    const marketTxJournal: CharacterWalletJournalEntry = {
      id: '1001:88001',
      characterId: 1001,
      journalId: 88001,
      date: '2026-09-30T12:28:19Z',
      refType: 'market_transaction',
      amount: 368000,
      balance: 559924666.76,
      description: 'Market: Buyer bought stuff from Pilot',
      source: '/characters/1001/wallet/journal/',
      observedAt: 1759235299000,
    };

    const sccSalesTaxJournal: CharacterWalletJournalEntry = {
      id: '1001:88002',
      characterId: 1001,
      journalId: 88002, // Adjacent journal ID
      date: '2026-09-30T12:28:19Z', // Exact matching timestamp
      refType: 'transaction_tax',
      amount: -12420, // 3.375% sales tax
      balance: 559912246.76,
      description: 'Sales tax paid to the SCC',
      source: '/characters/1001/wallet/journal/',
      observedAt: 1759235299000,
    };

    repo.saveTransactions([realEsiSaleTx]);
    repo.saveJournalEntries([marketTxJournal, sccSalesTaxJournal]);

    const enriched = repo.getTransactionById(1001, 77001);
    expect(enriched).not.toBeNull();
    expect(enriched?.tax).toBe(12420);
    expect(enriched?.netValue).toBe(368000 - 12420); // 355,580 ISK

    const summary = service.getSummary(1001);
    expect(summary.totalTaxesIsk).toBe(12420);
    expect(summary.totalNetSalesIsk).toBe(355580);
  });

  it('retrieves all transactions without arbitrary pagination limit via getAllTransactions', () => {
    const batch: CharacterTransaction[] = [];
    for (let i = 1; i <= 600; i++) {
      batch.push({
        id: `1001:${60000 + i}`,
        characterId: 1001,
        transactionId: 60000 + i,
        date: '2026-09-20T10:00:00Z',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 10,
        unitPrice: 5.0,
        totalValue: 50.0,
        isBuy: false,
        isPersonal: true,
        journalRefId: 90000 + i,
        locationId: 60003760,
        clientId: 2001,
        source: '/test',
        observedAt: 1758362400000,
      });
    }

    repo.saveTransactions(batch);

    // Verify getTransactions has a page limit of 500
    const paginated = repo.getTransactions({ characterId: 1001, pageSize: 1000 });
    expect(paginated.items.length).toBe(500);

    // Verify getAllTransactions returns the full dataset (all 600 items)
    const all = repo.getAllTransactions(1001);
    expect(all.length).toBe(600);
  });

  describe('Phase F06 — Corporation Journal Deduplication (TEST-F06-01 to TEST-F06-04)', () => {
    it('TEST-F06-01: Saves the same corporation journal entry by 2 distinct characters idempotently (inserted: 1, updated: 1, 1 record stored)', () => {
      const corpId = 98830;
      const division = 1;
      const journalId = 789456;

      const entryCharA: CharacterWalletJournalEntry = {
        id: makeJournalEntryKey({ isCorporationWallet: true, corporationId: corpId, division, characterId: 1001, journalId }),
        characterId: 1001,
        journalId,
        date: '2026-09-30T12:00:00Z',
        refType: 'transaction_tax',
        amount: -50000,
        tax: 50000,
        description: 'Corp Tax Division 1',
        source: `/corporations/${corpId}/wallets/${division}/journal/`,
        observedAt: 1759235200000,
        isCorporationWallet: true,
        corporationId: corpId,
        division,
        observedByCharacterIds: [1001],
      };

      const entryCharB: CharacterWalletJournalEntry = {
        id: makeJournalEntryKey({ isCorporationWallet: true, corporationId: corpId, division, characterId: 1002, journalId }),
        characterId: 1002,
        journalId,
        date: '2026-09-30T12:00:00Z',
        refType: 'transaction_tax',
        amount: -50000,
        tax: 50000,
        description: 'Corp Tax Division 1',
        source: `/corporations/${corpId}/wallets/${division}/journal/`,
        observedAt: 1759235250000,
        isCorporationWallet: true,
        corporationId: corpId,
        division,
        observedByCharacterIds: [1002],
      };

      // 1. Character A imports the corporation journal entry
      const resA = repo.saveJournalEntries([entryCharA]);
      expect(resA.inserted).toBe(1);
      expect(resA.updated).toBe(0);

      // Dump to check total unique storage
      const dump1 = repo.dumpData();
      expect(dump1.journalEntries).toHaveLength(1);
      expect(dump1.journalEntries[0].id).toBe(`corp:${corpId}:${division}:${journalId}`);
      expect(dump1.journalEntries[0].observedByCharacterIds).toContain(1001);

      // 2. Character B imports the exact same corporation journal entry
      const resB = repo.saveJournalEntries([entryCharB]);
      expect(resB.inserted).toBe(0);
      expect(resB.updated).toBe(1);

      // Total stored entries remains 1 (no duplicate)
      const dump2 = repo.dumpData();
      expect(dump2.journalEntries).toHaveLength(1);
      expect(dump2.journalEntries[0].id).toBe(`corp:${corpId}:${division}:${journalId}`);
      // Both character observers are recorded in audit trace
      expect(dump2.journalEntries[0].observedByCharacterIds).toContain(1001);
      expect(dump2.journalEntries[0].observedByCharacterIds).toContain(1002);

      // Both character queries can see the entry without collision
      const listA = repo.getJournalEntries(1001);
      expect(listA.total).toBe(1);
      const listB = repo.getJournalEntries(1002);
      expect(listB.total).toBe(1);
    });

    it('TEST-F06-02: Aggregates ledger summary for an account with 3 characters in the same corp with exact single tax (not 3x)', () => {
      const corpId = 98830;
      const division = 1;
      const taxJournalId = 90050;
      const taxAmount = 75000;

      // Character 1, 2, 3 in same corp observe the same corp tax
      const entryChar1: CharacterWalletJournalEntry = {
        id: makeJournalEntryKey({ isCorporationWallet: true, corporationId: corpId, division, characterId: 1001, journalId: taxJournalId }),
        characterId: 1001,
        journalId: taxJournalId,
        date: '2026-09-30T12:00:00Z',
        refType: 'transaction_tax',
        amount: -taxAmount,
        tax: taxAmount,
        description: 'Corp Sales Tax',
        source: `/corporations/${corpId}/wallets/${division}/journal/`,
        observedAt: 1759235200000,
        isCorporationWallet: true,
        corporationId: corpId,
        division,
        observedByCharacterIds: [1001],
      };

      const entryChar2: CharacterWalletJournalEntry = {
        ...entryChar1,
        characterId: 1002,
        observedByCharacterIds: [1002],
      };

      const entryChar3: CharacterWalletJournalEntry = {
        ...entryChar1,
        characterId: 1003,
        observedByCharacterIds: [1003],
      };

      // Save from all 3 characters
      repo.saveJournalEntries([entryChar1]);
      repo.saveJournalEntries([entryChar2]);
      repo.saveJournalEntries([entryChar3]);

      // Add a sale transaction for Character 1
      const saleTx: CharacterTransaction = {
        id: '1001:50099',
        characterId: 1001,
        transactionId: 50099,
        date: '2026-09-30T12:00:00Z',
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 10000,
        unitPrice: 100,
        totalValue: 1000000,
        isBuy: false,
        isPersonal: true,
        journalRefId: taxJournalId,
        locationId: 60003760,
        clientId: 2001,
        source: '/test',
        observedAt: 1759235200000,
      };
      repo.saveTransactions([saleTx]);

      // Summary across the 3 characters of the account
      const multiCharSummary = repo.getSummary(undefined, [1001, 1002, 1003]);
      expect(multiCharSummary.totalTaxesIsk).toBe(taxAmount); // Exactly 75,000 ISK, NOT 225,000 ISK (3x)!
      expect(multiCharSummary.totalGrossSalesIsk).toBe(1000000);
      expect(multiCharSummary.totalNetSalesIsk).toBe(1000000 - taxAmount);
    });

    it('TEST-F06-03: Saves 2 entries with same journalId in 2 different divisions as 2 distinct records', () => {
      const corpId = 98830;
      const journalId = 101;

      const div1Entry: CharacterWalletJournalEntry = {
        id: makeJournalEntryKey({ isCorporationWallet: true, corporationId: corpId, division: 1, characterId: 1001, journalId }),
        characterId: 1001,
        journalId,
        date: '2026-09-30T10:00:00Z',
        refType: 'transaction_tax',
        amount: -10000,
        tax: 10000,
        description: 'Division 1 tax',
        source: `/corporations/${corpId}/wallets/1/journal/`,
        observedAt: Date.now(),
        isCorporationWallet: true,
        corporationId: corpId,
        division: 1,
      };

      const div2Entry: CharacterWalletJournalEntry = {
        id: makeJournalEntryKey({ isCorporationWallet: true, corporationId: corpId, division: 2, characterId: 1001, journalId }),
        characterId: 1001,
        journalId,
        date: '2026-09-30T10:00:00Z',
        refType: 'transaction_tax',
        amount: -20000,
        tax: 20000,
        description: 'Division 2 tax',
        source: `/corporations/${corpId}/wallets/2/journal/`,
        observedAt: Date.now(),
        isCorporationWallet: true,
        corporationId: corpId,
        division: 2,
      };

      const saveRes = repo.saveJournalEntries([div1Entry, div2Entry]);
      expect(saveRes.inserted).toBe(2);
      expect(saveRes.updated).toBe(0);

      const dump = repo.dumpData();
      expect(dump.journalEntries).toHaveLength(2);
      expect(dump.journalEntries.map((e) => e.id)).toContain(`corp:${corpId}:1:${journalId}`);
      expect(dump.journalEntries.map((e) => e.id)).toContain(`corp:${corpId}:2:${journalId}`);
    });

    it('TEST-F06-04: Saves personal journal and corp journal having same ESI id as 2 distinct records', () => {
      const charId = 2124224223;
      const corpId = 98830;
      const sharedEsiId = 500;

      const personalEntry: CharacterWalletJournalEntry = {
        id: makeJournalEntryKey({ characterId: charId, journalId: sharedEsiId }),
        characterId: charId,
        journalId: sharedEsiId,
        date: '2026-09-30T11:00:00Z',
        refType: 'market_transaction',
        amount: 250000,
        description: 'Personal Sale',
        source: `/characters/${charId}/wallet/journal/`,
        observedAt: Date.now(),
      };

      const corpEntry: CharacterWalletJournalEntry = {
        id: makeJournalEntryKey({ isCorporationWallet: true, corporationId: corpId, division: 1, characterId: charId, journalId: sharedEsiId }),
        characterId: charId,
        journalId: sharedEsiId,
        date: '2026-09-30T11:00:00Z',
        refType: 'brokers_fee',
        amount: -15000,
        description: 'Corp Broker Fee',
        source: `/corporations/${corpId}/wallets/1/journal/`,
        observedAt: Date.now(),
        isCorporationWallet: true,
        corporationId: corpId,
        division: 1,
      };

      const saveRes = repo.saveJournalEntries([personalEntry, corpEntry]);
      expect(saveRes.inserted).toBe(2);

      const dump = repo.dumpData();
      expect(dump.journalEntries).toHaveLength(2);
      expect(dump.journalEntries.map((e) => e.id)).toContain(`char:${charId}:${sharedEsiId}`);
      expect(dump.journalEntries.map((e) => e.id)).toContain(`corp:${corpId}:1:${sharedEsiId}`);
    });
  });
});
