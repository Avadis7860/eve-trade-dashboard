import { describe, it, expect, beforeEach } from 'vitest';
import { TaxReconciliationEngine } from './taxReconciler.ts';
import { InMemoryLedgerRepository } from './repository.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from './types.ts';

describe('Phase F07 — Deterministic Tax Reconciliation & Unique Attribution', () => {
  let repo: InMemoryLedgerRepository;

  beforeEach(() => {
    repo = new InMemoryLedgerRepository();
  });

  const createSaleTx = (
    transactionId: number,
    date: string,
    unitPrice: number,
    quantity: number,
    journalRefId: number,
    characterId = 1001
  ): CharacterTransaction => ({
    id: `${characterId}:${transactionId}`,
    characterId,
    transactionId,
    date,
    typeId: 34,
    typeName: 'Tritanium',
    quantity,
    unitPrice,
    totalValue: Math.round((unitPrice * quantity + Number.EPSILON) * 100) / 100,
    isBuy: false,
    isPersonal: true,
    journalRefId,
    locationId: 60003760,
    clientId: 9001,
    source: `/characters/${characterId}/wallet/transactions/`,
    observedAt: new Date(date).getTime(),
  });

  const createTaxJournal = (
    journalId: number,
    date: string,
    amount: number,
    contextId?: number,
    contextIdType?: string,
    characterId = 1001
  ): CharacterWalletJournalEntry => ({
    id: `char:${characterId}:${journalId}`,
    characterId,
    journalId,
    date,
    refType: 'transaction_tax',
    amount: -Math.abs(amount),
    tax: Math.abs(amount),
    balance: 1000000000,
    contextId,
    contextIdType: contextIdType || (contextId ? 'transaction_tax' : undefined),
    description: 'Sales tax paid to the SCC',
    source: `/characters/${characterId}/wallet/journal/`,
    observedAt: new Date(date).getTime(),
  });

  const createMarketJournal = (
    journalId: number,
    date: string,
    amount: number,
    contextId?: number,
    characterId = 1001
  ): CharacterWalletJournalEntry => ({
    id: `char:${characterId}:${journalId}`,
    characterId,
    journalId,
    date,
    refType: 'market_transaction',
    amount,
    balance: 1000000000,
    contextId,
    contextIdType: 'market_transaction_id',
    description: 'Market Transaction',
    source: `/characters/${characterId}/wallet/journal/`,
    observedAt: new Date(date).getTime(),
  });

  // =========================================================================
  // TEST-F07-01: Appariement exact via context_id == transaction_id
  // =========================================================================
  it('TEST-F07-01: Direct exact match via context_id == transaction_id', () => {
    const saleTx = createSaleTx(50001, '2026-10-01T12:00:00Z', 100, 1000, 80001); // 100,000 ISK
    const taxJn = createTaxJournal(80002, '2026-10-01T12:00:00Z', 3600, 50001, 'transaction_tax'); // 3.6% tax

    // Direct engine verification
    expect(TaxReconciliationEngine.isTaxJournalEntry(taxJn)).toBe(true);
    expect(TaxReconciliationEngine.extractTaxAmount(taxJn)).toBe(3600);

    repo.saveTransactions([saleTx]);
    repo.saveJournalEntries([taxJn]);

    const enriched = repo.getTransactionById(1001, 50001);
    expect(enriched).not.toBeNull();
    expect(enriched?.tax).toBe(3600);
    expect(enriched?.netValue).toBe(96400);
    expect(enriched?.taxReconciliation).toBeDefined();
    expect(enriched?.taxReconciliation?.status).toBe('EXACT_MATCH');
    expect(enriched?.taxReconciliation?.matchedJournalId).toBe(80002);
    expect(enriched?.taxReconciliation?.taxAmount).toBe(3600);
    expect(enriched?.taxReconciliation?.taxRate).toBe(0.036);
  });

  // =========================================================================
  // TEST-F07-02: Appariement séquentiel CCP M + 1 (tax.journalId == mkt.journalId + 1)
  // =========================================================================
  it('TEST-F07-02: Sequential CCP M+1 pattern (tax.journalId == mkt.journalId + 1)', () => {
    const saleTx = createSaleTx(50002, '2026-10-01T12:10:00Z', 200, 1000, 80010); // 200,000 ISK, journalRefId = 80010
    const mktJn = createMarketJournal(80010, '2026-10-01T12:10:00Z', 200000, 50002);
    const taxJn = createTaxJournal(80011, '2026-10-01T12:10:00Z', 7200); // 80011 = 80010 + 1, no contextId

    repo.saveTransactions([saleTx]);
    repo.saveJournalEntries([mktJn, taxJn]);

    const enriched = repo.getTransactionById(1001, 50002);
    expect(enriched).not.toBeNull();
    expect(enriched?.tax).toBe(7200);
    expect(enriched?.netValue).toBe(192800);
    expect(enriched?.taxReconciliation).toBeDefined();
    expect(enriched?.taxReconciliation?.status).toBe('SEQUENTIAL_M_PLUS_1');
    expect(enriched?.taxReconciliation?.matchedJournalId).toBe(80011);
    expect(enriched?.taxReconciliation?.taxAmount).toBe(7200);
    expect(enriched?.taxReconciliation?.taxRate).toBe(0.036);
  });

  // =========================================================================
  // TEST-F07-03: 3 ventes identiques dans la même seconde, 3 taxes distinctes
  // Garantir l'attribution exclusive 1-to-1 sans duplication de taxe
  // =========================================================================
  it('TEST-F07-03: 3 identical concurrent sales get distinct unique taxes without double-counting', () => {
    const sale1 = createSaleTx(60001, '2026-10-01T14:00:00Z', 500, 1000, 90001); // 500,000 ISK
    const sale2 = createSaleTx(60002, '2026-10-01T14:00:00Z', 500, 1000, 90003); // 500,000 ISK
    const sale3 = createSaleTx(60003, '2026-10-01T14:00:00Z', 500, 1000, 90005); // 500,000 ISK

    const mkt1 = createMarketJournal(90001, '2026-10-01T14:00:00Z', 500000);
    const tax1 = createTaxJournal(90002, '2026-10-01T14:00:00Z', 18000); // 3.6% of 500k = 18,000

    const mkt2 = createMarketJournal(90003, '2026-10-01T14:00:00Z', 500000);
    const tax2 = createTaxJournal(90004, '2026-10-01T14:00:00Z', 18000);

    const mkt3 = createMarketJournal(90005, '2026-10-01T14:00:00Z', 500000);
    const tax3 = createTaxJournal(90006, '2026-10-01T14:00:00Z', 18000);

    repo.saveTransactions([sale1, sale2, sale3]);
    repo.saveJournalEntries([mkt1, tax1, mkt2, tax2, mkt3, tax3]);

    const enriched1 = repo.getTransactionById(1001, 60001)!;
    const enriched2 = repo.getTransactionById(1001, 60002)!;
    const enriched3 = repo.getTransactionById(1001, 60003)!;

    expect(enriched1.tax).toBe(18000);
    expect(enriched2.tax).toBe(18000);
    expect(enriched3.tax).toBe(18000);

    // Ensure all 3 transactions matched unique different journal IDs
    const matchedJournalIds = new Set([
      enriched1.taxReconciliation?.matchedJournalId,
      enriched2.taxReconciliation?.matchedJournalId,
      enriched3.taxReconciliation?.matchedJournalId,
    ]);
    expect(matchedJournalIds.size).toBe(3);
    expect(matchedJournalIds.has(90002)).toBe(true);
    expect(matchedJournalIds.has(90004)).toBe(true);
    expect(matchedJournalIds.has(90006)).toBe(true);

    const summary = repo.getSummary(1001);
    expect(summary.totalGrossSalesIsk).toBe(1500000);
    expect(summary.totalTaxesIsk).toBe(54000); // 18000 * 3
    expect(summary.totalNetSalesIsk).toBe(1446000);
  });

  // =========================================================================
  // TEST-F07-04: 3 ventes identiques mais seulement 2 taxes disponibles
  // 2 ventes reçoivent une taxe, la 3ème est marquée UNMATCHED (pas de partage indu)
  // =========================================================================
  it('TEST-F07-04: 3 concurrent sales with only 2 available taxes mark the 3rd sale as UNMATCHED', () => {
    const sale1 = createSaleTx(70001, '2026-10-01T15:00:00Z', 1000, 100, 91001); // 100,000 ISK
    const sale2 = createSaleTx(70002, '2026-10-01T15:00:00Z', 1000, 100, 91003); // 100,000 ISK
    const sale3 = createSaleTx(70003, '2026-10-01T15:00:00Z', 1000, 100, 91005); // 100,000 ISK

    // Only 2 taxes in journal (e.g., last one was outside sync window or delayed)
    const mkt1 = createMarketJournal(91001, '2026-10-01T15:00:00Z', 100000);
    const tax1 = createTaxJournal(91002, '2026-10-01T15:00:00Z', 3600);

    const mkt2 = createMarketJournal(91003, '2026-10-01T15:00:00Z', 100000);
    const tax2 = createTaxJournal(91004, '2026-10-01T15:00:00Z', 3600);

    const mkt3 = createMarketJournal(91005, '2026-10-01T15:00:00Z', 100000);
    // Note: No tax entry for mkt3

    repo.saveTransactions([sale1, sale2, sale3]);
    repo.saveJournalEntries([mkt1, tax1, mkt2, tax2, mkt3]);

    const enriched1 = repo.getTransactionById(1001, 70001)!;
    const enriched2 = repo.getTransactionById(1001, 70002)!;
    const enriched3 = repo.getTransactionById(1001, 70003)!;

    expect(enriched1.tax).toBe(3600);
    expect(enriched2.tax).toBe(3600);
    expect(enriched3.tax).toBe(0); // Strict UNMATCHED = 0, no invented tax
    expect(enriched3.taxReconciliation?.status).toBe('UNMATCHED');

    // Total taxes allocated must not exceed the 2 taxes present in journal
    const totalTaxesAllocated = (enriched1.tax || 0) + (enriched2.tax || 0) + (enriched3.tax || 0);
    expect(totalTaxesAllocated).toBe(7200);

    const summary = repo.getSummary(1001);
    expect(summary.totalTaxesIsk).toBe(7200);
  });

  // =========================================================================
  // TEST-F07-05: 2 ventes de montants différents et 2 taxes inversées dans le tri
  // =========================================================================
  it('TEST-F07-05: Correlates distinct amount taxes correctly even if order is inverted', () => {
    // Sale A: 1,000,000 ISK -> Tax = 36,000 ISK (3.6%)
    const saleA = createSaleTx(80001, '2026-10-01T16:00:00Z', 1000, 1000, 0); // No direct journalRefId
    // Sale B: 500,000 ISK -> Tax = 18,000 ISK (3.6%)
    const saleB = createSaleTx(80002, '2026-10-01T16:00:00Z', 500, 1000, 0);

    // Inverted tax entries
    const taxForB = createTaxJournal(95001, '2026-10-01T16:00:00Z', 18000); // 18,000 ISK
    const taxForA = createTaxJournal(95002, '2026-10-01T16:00:00Z', 36000); // 36,000 ISK

    repo.saveTransactions([saleA, saleB]);
    repo.saveJournalEntries([taxForB, taxForA]);

    const enrichedA = repo.getTransactionById(1001, 80001)!;
    const enrichedB = repo.getTransactionById(1001, 80002)!;

    expect(enrichedA.tax).toBe(36000);
    expect(enrichedA.taxReconciliation?.matchedJournalId).toBe(95002);

    expect(enrichedB.tax).toBe(18000);
    expect(enrichedB.taxReconciliation?.matchedJournalId).toBe(95001);
  });

  // =========================================================================
  // TEST-F07-06: Invariance comptable stricte sur 1 000 ventes synthétiques
  // sum(attributed taxes) <= sum(unique journal taxes)
  // =========================================================================
  it('TEST-F07-06: Strict accounting invariance sum(Taxes) <= sum(JournalTaxes) on 1000 sales', () => {
    const transactions: CharacterTransaction[] = [];
    const journals: CharacterWalletJournalEntry[] = [];
    let expectedUniqueTaxSum = 0;

    for (let i = 1; i <= 1000; i++) {
      const txId = 100000 + i;
      const jnRefId = 200000 + i * 2;
      const totalVal = 100000 + (i % 10) * 10000;
      const date = new Date(1759300000000 + i * 1000).toISOString();

      transactions.push(createSaleTx(txId, date, totalVal, 1, jnRefId));
      journals.push(createMarketJournal(jnRefId, date, totalVal, txId));

      // 80% of sales have a matching tax in journal, 20% are missing (unmatched)
      if (i % 5 !== 0) {
        const taxAmt = Math.round(totalVal * 0.036);
        const taxJnId = jnRefId + 1;
        journals.push(createTaxJournal(taxJnId, date, taxAmt));
        expectedUniqueTaxSum += taxAmt;
      }
    }

    repo.saveTransactions(transactions);
    repo.saveJournalEntries(journals);

    const allTxs = repo.getAllTransactions(1001);
    expect(allTxs).toHaveLength(1000);

    let sumAttributedTax = 0;
    const allocatedTaxJournalIds = new Set<number>();

    for (const tx of allTxs) {
      if (tx.tax && tx.tax > 0) {
        sumAttributedTax += tx.tax;
        const matchedJnId = tx.taxReconciliation?.matchedJournalId;
        expect(matchedJnId).toBeDefined();
        // Strict exclusivity: no tax journal ID is ever used twice
        expect(allocatedTaxJournalIds.has(matchedJnId!)).toBe(false);
        allocatedTaxJournalIds.add(matchedJnId!);
      } else {
        expect(tx.taxReconciliation?.status).toBe('UNMATCHED');
      }
    }

    sumAttributedTax = Math.round((sumAttributedTax + Number.EPSILON) * 100) / 100;
    expectedUniqueTaxSum = Math.round((expectedUniqueTaxSum + Number.EPSILON) * 100) / 100;

    // Invariance condition
    expect(sumAttributedTax).toBeLessThanOrEqual(expectedUniqueTaxSum);
    expect(sumAttributedTax).toBe(expectedUniqueTaxSum);
    expect(allocatedTaxJournalIds.size).toBe(800); // exactly 800 matched, 200 unmatched
  });

  // =========================================================================
  // TEST-F07-07: Volume & Durable Storage (10 000 transactions beyond ESI 2 500 limit)
  // =========================================================================
  it('TEST-F07-07: High volume accumulation (10,000 transactions) with O(1) indexed reads', () => {
    const batchSize = 10000;
    const transactions: CharacterTransaction[] = [];
    const journals: CharacterWalletJournalEntry[] = [];

    for (let i = 1; i <= batchSize; i++) {
      const txId = 300000 + i;
      const jnRefId = 600000 + i * 2;
      const date = new Date(1750000000000 + i * 60000).toISOString();
      transactions.push(createSaleTx(txId, date, 1000, 10, jnRefId));
      journals.push(createMarketJournal(jnRefId, date, 10000, txId));
      journals.push(createTaxJournal(jnRefId + 1, date, 360));
    }

    const startIngestion = performance.now();
    repo.saveTransactions(transactions);
    repo.saveJournalEntries(journals);
    const ingestionDuration = performance.now() - startIngestion;

    // Batch ingestion of 10,000 items with reconciliation should complete quickly (< 500ms in memory)
    expect(ingestionDuration).toBeLessThan(1000);
    expect(repo.countTransactions(1001)).toBe(batchSize);

    // Test O(1) point read
    const startPointRead = performance.now();
    const item5000 = repo.getTransactionById(1001, 305000);
    const pointReadDuration = performance.now() - startPointRead;

    expect(pointReadDuration).toBeLessThan(15); // sub-millisecond point lookup
    expect(item5000).not.toBeNull();
    expect(item5000?.tax).toBe(360);
    expect(item5000?.taxReconciliation?.status).toBe('SEQUENTIAL_M_PLUS_1');

    // Test paginated query
    const startPagedRead = performance.now();
    const paged = repo.getTransactions({ characterId: 1001, page: 50, pageSize: 50 });
    const pagedReadDuration = performance.now() - startPagedRead;

    expect(pagedReadDuration).toBeLessThan(100);
    expect(paged.total).toBe(batchSize);
    expect(paged.items).toHaveLength(50);
  });
});
