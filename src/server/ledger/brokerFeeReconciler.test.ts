import { describe, it, expect, beforeEach } from 'vitest';
import { BrokerFeeReconciliationEngine } from './brokerFeeReconciler.ts';
import { InMemoryLedgerRepository } from './repository.ts';
import { PersistentOrdersRepository } from '../orders/repository.ts';
import { RoiService } from '../roi/service.ts';
import { InMemoryRoiRepository } from '../roi/repository.ts';
import type { CharacterTransaction, CharacterWalletJournalEntry } from './types.ts';
import type { CharacterOrderSnapshot, OrderLifecycleState } from '../orders/types.ts';

describe('Phase F08 — Broker Fee Modeling and Attribution', () => {
  let ordersRepo: PersistentOrdersRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let roiRepo: InMemoryRoiRepository;
  let roiService: RoiService;

  beforeEach(() => {
    ordersRepo = new PersistentOrdersRepository(null);
    ledgerRepo = new InMemoryLedgerRepository(null, ordersRepo);
    roiRepo = new InMemoryRoiRepository(ledgerRepo, null);
    roiService = new RoiService(roiRepo, undefined, ledgerRepo);
  });

  const createOrderSnapshot = (params: {
    orderId: number;
    characterId?: number;
    typeId?: number;
    typeName?: string;
    locationId?: number;
    isBuyOrder: boolean;
    price: number;
    volumeTotal: number;
    volumeRemain?: number;
    issued?: string;
    expiresAt?: string;
    state?: OrderLifecycleState;
  }): CharacterOrderSnapshot => ({
    id: `${params.characterId ?? 1001}:${params.orderId}`,
    characterId: params.characterId ?? 1001,
    orderId: params.orderId,
    typeId: params.typeId ?? 34,
    typeName: params.typeName ?? 'Tritanium',
    regionId: 10000002,
    locationId: params.locationId ?? 60003760,
    locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    isBuyOrder: params.isBuyOrder,
    price: params.price,
    volumeTotal: params.volumeTotal,
    volumeRemain: params.volumeRemain ?? 0,
    volumeFilled: params.volumeTotal - (params.volumeRemain ?? 0),
    issued: params.issued ?? '2026-10-01T10:00:00Z',
    duration: 90,
    expiresAt: params.expiresAt ?? '2026-12-30T10:00:00Z',
    state: params.state ?? 'COMPLETED_CONFIRMED',
    stateJustification: 'Order filled',
    firstObservedAt: new Date(params.issued ?? '2026-10-01T10:00:00Z').getTime(),
    lastObservedAt: new Date(params.issued ?? '2026-10-01T10:00:00Z').getTime() + 3600000,
    lastSnapshotVolumeRemain: params.volumeRemain ?? 0,
    isActiveInCurrentSnapshot: false,
    source: '/characters/1001/orders/',
  });

  const createBuyTx = (params: {
    transactionId: number;
    date: string;
    unitPrice: number;
    quantity: number;
    journalRefId?: number;
    typeId?: number;
    locationId?: number;
    characterId?: number;
  }): CharacterTransaction => ({
    id: `${params.characterId ?? 1001}:${params.transactionId}`,
    characterId: params.characterId ?? 1001,
    transactionId: params.transactionId,
    date: params.date,
    typeId: params.typeId ?? 34,
    typeName: 'Tritanium',
    quantity: params.quantity,
    unitPrice: params.unitPrice,
    totalValue: Math.round((params.unitPrice * params.quantity + Number.EPSILON) * 100) / 100,
    isBuy: true,
    isPersonal: true,
    journalRefId: params.journalRefId ?? 0,
    locationId: params.locationId ?? 60003760,
    clientId: 9001,
    source: `/characters/${params.characterId ?? 1001}/wallet/transactions/`,
    observedAt: new Date(params.date).getTime(),
  });

  const createSellTx = (params: {
    transactionId: number;
    date: string;
    unitPrice: number;
    quantity: number;
    journalRefId?: number;
    typeId?: number;
    locationId?: number;
    characterId?: number;
  }): CharacterTransaction => ({
    id: `${params.characterId ?? 1001}:${params.transactionId}`,
    characterId: params.characterId ?? 1001,
    transactionId: params.transactionId,
    date: params.date,
    typeId: params.typeId ?? 34,
    typeName: 'Tritanium',
    quantity: params.quantity,
    unitPrice: params.unitPrice,
    totalValue: Math.round((params.unitPrice * params.quantity + Number.EPSILON) * 100) / 100,
    isBuy: false,
    isPersonal: true,
    journalRefId: params.journalRefId ?? 0,
    locationId: params.locationId ?? 60003760,
    clientId: 9002,
    source: `/characters/${params.characterId ?? 1001}/wallet/transactions/`,
    observedAt: new Date(params.date).getTime(),
  });

  const createBrokerJournal = (params: {
    journalId: number;
    date: string;
    amount: number;
    contextId?: number;
    characterId?: number;
  }): CharacterWalletJournalEntry => ({
    id: `char:${params.characterId ?? 1001}:${params.journalId}`,
    characterId: params.characterId ?? 1001,
    journalId: params.journalId,
    date: params.date,
    refType: 'brokers_fee',
    amount: -Math.abs(params.amount),
    balance: 1000000000,
    contextId: params.contextId,
    contextIdType: params.contextId ? 'market_order_id' : undefined,
    description: 'Broker fee paid to station owner',
    source: `/characters/${params.characterId ?? 1001}/wallet/journal/`,
    observedAt: new Date(params.date).getTime(),
  });

  // =========================================================================
  // TEST-F08-01: Frais de courtage sur ordre d'achat entièrement exécuté
  // =========================================================================
  it('TEST-F08-01: Broker fee on fully filled buy order (1,000 units) attributed 100% to buy transaction', () => {
    const order = createOrderSnapshot({
      orderId: 10001,
      isBuyOrder: true,
      price: 100,
      volumeTotal: 1000,
      volumeRemain: 0,
      issued: '2026-10-01T10:00:00Z',
    });
    const feeJn = createBrokerJournal({
      journalId: 90001,
      date: '2026-10-01T10:00:00Z',
      amount: 10000,
      contextId: 10001,
    });
    const buyTx = createBuyTx({
      transactionId: 50001,
      date: '2026-10-01T11:00:00Z',
      unitPrice: 100,
      quantity: 1000,
    });

    // Direct engine verification
    expect(BrokerFeeReconciliationEngine.isBrokerFeeJournalEntry(feeJn)).toBe(true);
    expect(BrokerFeeReconciliationEngine.extractFeeAmount(feeJn)).toBe(10000);

    ordersRepo.saveOrderSnapshots([order]);
    ledgerRepo.saveTransactions([buyTx]);
    ledgerRepo.saveJournalEntries([feeJn]);

    const enriched = ledgerRepo.getTransactionById(1001, 50001);
    expect(enriched).not.toBeNull();
    expect(enriched?.brokerFee).toBe(10000);
    expect(enriched?.netValue).toBe(110000); // 100,000 gross + 10,000 fee
    expect(enriched?.brokerFeeReconciliation).toEqual({
      status: 'ORDER_PRO_RATA',
      orderId: 10001,
      totalOrderFee: 10000,
      orderVolumeTotal: 1000,
      orderVolumeFilled: 1000,
      transactionQuantity: 1000,
      allocatedFeeAmount: 10000,
      justification: expect.stringContaining('Matched to order #10001 (pro-rata 1000/1000 = 100.0%)'),
    });

    const brokerSummary = ledgerRepo.getBrokerFeeSummary(1001);
    expect(brokerSummary.totalBrokerFeesCollectedIsk).toBe(10000);
    expect(brokerSummary.reconciledOrderFeesIsk).toBe(10000);
    expect(brokerSummary.allocatedBrokerFeesIsk).toBe(10000);
    expect(brokerSummary.unallocatedBrokerFeesIsk).toBe(0);
  });

  // =========================================================================
  // TEST-F08-02: Ordre d'achat exécuté en 3 transactions partielles
  // =========================================================================
  it('TEST-F08-02: Buy order executed in 3 partial transactions (300, 300, 400) prorated (30%, 30%, 40%)', () => {
    const order = createOrderSnapshot({
      orderId: 10002,
      isBuyOrder: true,
      price: 100,
      volumeTotal: 1000,
      volumeRemain: 0,
      issued: '2026-10-01T10:00:00Z',
    });
    const feeJn = createBrokerJournal({
      journalId: 90002,
      date: '2026-10-01T10:00:00Z',
      amount: 10000,
      contextId: 10002,
    });
    const tx1 = createBuyTx({
      transactionId: 50002,
      date: '2026-10-01T11:00:00Z',
      unitPrice: 100,
      quantity: 300,
    });
    const tx2 = createBuyTx({
      transactionId: 50003,
      date: '2026-10-01T12:00:00Z',
      unitPrice: 100,
      quantity: 300,
    });
    const tx3 = createBuyTx({
      transactionId: 50004,
      date: '2026-10-01T13:00:00Z',
      unitPrice: 100,
      quantity: 400,
    });

    ordersRepo.saveOrderSnapshots([order]);
    ledgerRepo.saveTransactions([tx1, tx2, tx3]);
    ledgerRepo.saveJournalEntries([feeJn]);

    const enriched1 = ledgerRepo.getTransactionById(1001, 50002);
    const enriched2 = ledgerRepo.getTransactionById(1001, 50003);
    const enriched3 = ledgerRepo.getTransactionById(1001, 50004);

    expect(enriched1?.brokerFee).toBe(3000);
    expect(enriched2?.brokerFee).toBe(3000);
    expect(enriched3?.brokerFee).toBe(4000);

    const brokerSummary = ledgerRepo.getBrokerFeeSummary(1001);
    expect(brokerSummary.totalBrokerFeesCollectedIsk).toBe(10000);
    expect(brokerSummary.allocatedBrokerFeesIsk).toBe(10000);
    expect(brokerSummary.unallocatedBrokerFeesIsk).toBe(0);
  });

  // =========================================================================
  // TEST-F08-03: Ordre d'achat annulé après exécution partielle de 50%
  // =========================================================================
  it('TEST-F08-03: Buy order cancelled after 50% fill allocates 50% to purchases, 50% to unallocated fees', () => {
    const order = createOrderSnapshot({
      orderId: 10003,
      isBuyOrder: true,
      price: 100,
      volumeTotal: 1000,
      volumeRemain: 500,
      state: 'CANCELLED_CONFIRMED',
      issued: '2026-10-01T10:00:00Z',
    });
    const feeJn = createBrokerJournal({
      journalId: 90003,
      date: '2026-10-01T10:00:00Z',
      amount: 10000,
      contextId: 10003,
    });
    const tx = createBuyTx({
      transactionId: 50005,
      date: '2026-10-01T11:00:00Z',
      unitPrice: 100,
      quantity: 500,
    });

    ordersRepo.saveOrderSnapshots([order]);
    ledgerRepo.saveTransactions([tx]);
    ledgerRepo.saveJournalEntries([feeJn]);

    const enriched = ledgerRepo.getTransactionById(1001, 50005);
    expect(enriched?.brokerFee).toBe(5000);
    expect(enriched?.netValue).toBe(55000); // 50,000 spend + 5,000 fee

    const brokerSummary = ledgerRepo.getBrokerFeeSummary(1001);
    expect(brokerSummary.totalBrokerFeesCollectedIsk).toBe(10000);
    expect(brokerSummary.reconciledOrderFeesIsk).toBe(10000);
    expect(brokerSummary.allocatedBrokerFeesIsk).toBe(5000);
    expect(brokerSummary.unallocatedBrokerFeesIsk).toBe(5000);
  });

  // =========================================================================
  // TEST-F08-04: Achat direct immédiat au marché (sans brokers_fee)
  // =========================================================================
  it('TEST-F08-04: Immediate market buy without order has allocated_buy_fees = 0', () => {
    const directBuy = createBuyTx({
      transactionId: 50006,
      date: '2026-10-01T15:00:00Z',
      unitPrice: 100,
      quantity: 200,
    });

    ledgerRepo.saveTransactions([directBuy]);

    const enriched = ledgerRepo.getTransactionById(1001, 50006);
    expect(enriched?.brokerFee).toBe(0);
    expect(enriched?.netValue).toBe(20000);
    expect(enriched?.brokerFeeReconciliation?.status).toBe('UNMATCHED');
    expect(enriched?.brokerFeeReconciliation?.allocatedFeeAmount).toBe(0);
  });

  // =========================================================================
  // TEST-F08-05: Invariance globale de conservation des frais
  // =========================================================================
  it('TEST-F08-05: Strict mathematical fee invariance (allocated + unallocated == totalCollected)', () => {
    // 1. Order 1: 1000 units, 10,000 ISK fee -> 100% executed (10,000 allocated, 0 unallocated)
    const order1 = createOrderSnapshot({ orderId: 101, isBuyOrder: true, price: 100, volumeTotal: 1000 });
    const fee1 = createBrokerJournal({ journalId: 901, amount: 10000, contextId: 101, date: '2026-10-01T10:00:00Z' });
    const tx1 = createBuyTx({ transactionId: 201, date: '2026-10-01T11:00:00Z', unitPrice: 100, quantity: 1000 });

    // 2. Order 2: 2000 units, 24,000 ISK fee -> 50% executed (12,000 allocated, 12,000 unallocated)
    const order2 = createOrderSnapshot({ orderId: 102, isBuyOrder: true, price: 200, volumeTotal: 2000 });
    const fee2 = createBrokerJournal({ journalId: 902, amount: 24000, contextId: 102, date: '2026-10-01T10:00:00Z' });
    const tx2 = createBuyTx({ transactionId: 202, date: '2026-10-01T11:30:00Z', unitPrice: 200, quantity: 1000 });

    // 3. Order 3: 500 units, 5,000 ISK fee -> 0% executed, expired (0 allocated, 5,000 unallocated)
    const order3 = createOrderSnapshot({ orderId: 103, isBuyOrder: true, price: 300, volumeTotal: 500, state: 'EXPIRED_CONFIRMED' });
    const fee3 = createBrokerJournal({ journalId: 903, amount: 5000, contextId: 103, date: '2026-10-01T10:00:00Z' });

    // 4. Orphan broker fee journal entry (no matching order in snapshot) -> 8,000 ISK unallocated
    const orphanFee = createBrokerJournal({ journalId: 904, amount: 8000, contextId: 999999, date: '2026-10-01T10:00:00Z' });

    // Total fees collected = 10,000 + 24,000 + 5,000 + 8,000 = 47,000 ISK
    // Expected allocated = 10,000 + 12,000 = 22,000 ISK
    // Expected unallocated = 0 + 12,000 + 5,000 + 8,000 = 25,000 ISK

    ordersRepo.saveOrderSnapshots([order1, order2, order3]);
    ledgerRepo.saveTransactions([tx1, tx2]);
    ledgerRepo.saveJournalEntries([fee1, fee2, fee3, orphanFee]);

    const summary = ledgerRepo.getBrokerFeeSummary(1001);
    expect(summary.totalBrokerFeesCollectedIsk).toBe(47000);
    expect(summary.allocatedBrokerFeesIsk).toBe(22000);
    expect(summary.unallocatedBrokerFeesIsk).toBe(25000);
    expect(summary.allocatedBrokerFeesIsk + summary.unallocatedBrokerFeesIsk).toBe(summary.totalBrokerFeesCollectedIsk);
  });

  // =========================================================================
  // TEST: FIFO Integration with Buy Broker Fees
  // =========================================================================
  it('integrates allocated buy broker fees seamlessly into FIFO allocations and ROI calculations', () => {
    // Buy Order: 1,000 units Tritanium @ 100 ISK, fee = 10,000 ISK (10 ISK fee/unit)
    const buyOrder = createOrderSnapshot({
      orderId: 20001,
      isBuyOrder: true,
      price: 100,
      volumeTotal: 1000,
      issued: '2026-10-01T10:00:00Z',
    });
    const buyFee = createBrokerJournal({
      journalId: 80001,
      date: '2026-10-01T10:00:00Z',
      amount: 10000,
      contextId: 20001,
    });
    const buyTx = createBuyTx({
      transactionId: 30001,
      date: '2026-10-01T11:00:00Z',
      unitPrice: 100,
      quantity: 1000,
    });

    // Sell Transaction: 600 units Tritanium @ 150 ISK (90,000 ISK revenue)
    const sellTx = createSellTx({
      transactionId: 40001,
      date: '2026-10-02T12:00:00Z',
      unitPrice: 150,
      quantity: 600,
    });

    ordersRepo.saveOrderSnapshots([buyOrder]);
    ledgerRepo.saveTransactions([buyTx, sellTx]);
    ledgerRepo.saveJournalEntries([buyFee]);

    // Run FIFO auto-reconciliation
    const fifoResult = roiService.autoReconcileFifo({ characterId: 1001 });
    expect(fifoResult.sales_fully_matched).toBe(1);

    const allocations = roiService.listAllocations(1001);
    expect(allocations.length).toBe(1);
    const alloc = allocations[0];

    // 600 units * 100 ISK = 60,000 ISK buy cost
    expect(alloc.allocated_buy_cost).toBe(60000);
    // 600/1000 * 10,000 ISK fee = 6,000 ISK allocated buy fee
    expect(alloc.allocated_buy_fees).toBe(6000);

    // Verify ROI Summary
    const summary = roiService.getSummary({ character_id: 1001 });
    expect(summary.gross_revenue_isk).toBe(90000); // 600 * 150
    expect(summary.allocated_buy_cost_isk).toBe(60000);
    expect(summary.allocated_buy_fees_isk).toBe(6000);
    expect(summary.total_allocated_investment_ttc).toBe(66000); // 60,000 + 6,000
    // Realized Profit TTC = 90,000 - 60,000 - 6,000 = 24,000 ISK
    expect(summary.realized_profit_ttc_isk).toBe(24000);
    // ROI % = (24,000 / 66,000) * 100 = 36.36%
    expect(summary.roi_percent_ttc).toBe(36.36);

    // Verify unsold inventory: 400 units remaining @ 100 ISK + 4,000 ISK remaining buy fee
    const unsold = roiService.getUnsoldInventory(1001);
    expect(unsold.length).toBe(1);
    expect(unsold[0].remaining_quantity).toBe(400);
    expect(unsold[0].tied_capital_isk).toBe(40000);
    expect(unsold[0].allocated_buy_fees_remaining).toBe(4000);
  });

  // =========================================================================
  // TEST: Sell Order Broker Fee Attribution
  // =========================================================================
  it('attributes sell order placement broker fees to sell transactions', () => {
    const sellOrder = createOrderSnapshot({
      orderId: 30001,
      isBuyOrder: false,
      price: 200,
      volumeTotal: 500,
      issued: '2026-10-01T10:00:00Z',
    });
    const sellBrokerFee = createBrokerJournal({
      journalId: 85001,
      date: '2026-10-01T10:00:00Z',
      amount: 5000,
      contextId: 30001,
    });
    const sellTx = createSellTx({
      transactionId: 45001,
      date: '2026-10-01T12:00:00Z',
      unitPrice: 200,
      quantity: 500,
    });

    ordersRepo.saveOrderSnapshots([sellOrder]);
    ledgerRepo.saveTransactions([sellTx]);
    ledgerRepo.saveJournalEntries([sellBrokerFee]);

    const enriched = ledgerRepo.getTransactionById(1001, 45001);
    expect(enriched?.brokerFee).toBe(5000);
    expect(enriched?.netValue).toBe(95000); // 100,000 - 5,000 broker fee
  });

  // =========================================================================
  // TEST: Order modified (multiple broker fee journal entries for same order)
  // =========================================================================
  it('handles multiple broker fee journal entries for modified orders', () => {
    const order = createOrderSnapshot({
      orderId: 40001,
      isBuyOrder: true,
      price: 150,
      volumeTotal: 1000,
      issued: '2026-10-01T10:00:00Z',
    });
    // Placement fee: 10,000 ISK
    const fee1 = createBrokerJournal({
      journalId: 92001,
      date: '2026-10-01T10:00:00Z',
      amount: 10000,
      contextId: 40001,
    });
    // Price modification fee: 2,000 ISK
    const fee2 = createBrokerJournal({
      journalId: 92002,
      date: '2026-10-01T11:00:00Z',
      amount: 2000,
      contextId: 40001,
    });
    const buyTx = createBuyTx({
      transactionId: 52001,
      date: '2026-10-01T12:00:00Z',
      unitPrice: 150,
      quantity: 1000,
    });

    ordersRepo.saveOrderSnapshots([order]);
    ledgerRepo.saveTransactions([buyTx]);
    ledgerRepo.saveJournalEntries([fee1, fee2]);

    const enriched = ledgerRepo.getTransactionById(1001, 52001);
    expect(enriched?.brokerFee).toBe(12000); // 10,000 + 2,000
    expect(enriched?.netValue).toBe(162000); // 150,000 + 12,000

    const summary = ledgerRepo.getBrokerFeeSummary(1001);
    expect(summary.totalBrokerFeesCollectedIsk).toBe(12000);
    expect(summary.allocatedBrokerFeesIsk).toBe(12000);
    expect(summary.unallocatedBrokerFeesIsk).toBe(0);
  });
});
