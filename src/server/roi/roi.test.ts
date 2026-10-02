import { describe, it, expect, beforeEach } from 'vitest';
import { roiService } from './service';
import { roiRepository } from './repository';
import { ledgerRepository } from '../ledger/repository';
import { hubsRepository } from '../hubs/repository';
import type { CharacterTransaction, CharacterWalletJournalEntry } from '../ledger/types';
import type { ExplicitCostAllocation } from './types';
import { RoiCalculator, roundIsk, roundPercent } from './calculator';

describe('ROI TTC & Financial Metrics Module', () => {
  const CHAR_ID = 95432101;
  const OTHER_CHAR_ID = 95432102;
  const TRITANIUM_TYPE_ID = 34;
  const PLEX_TYPE_ID = 44992;

  function makeTx(tx: {
    characterId: number;
    transactionId: number;
    date: string;
    isBuy: boolean;
    typeId: number;
    typeName: string;
    quantity: number;
    unitPrice: number;
    locationId: number;
    locationName?: string;
    journalRefId?: number;
    clientId?: number;
    clientName?: string;
  }): CharacterTransaction {
    return {
      id: `${tx.characterId}:${tx.transactionId}`,
      characterId: tx.characterId,
      transactionId: tx.transactionId,
      date: tx.date,
      isBuy: tx.isBuy,
      isPersonal: true,
      typeId: tx.typeId,
      typeName: tx.typeName,
      quantity: tx.quantity,
      unitPrice: tx.unitPrice,
      totalValue: tx.quantity * tx.unitPrice,
      journalRefId: tx.journalRefId || 0,
      locationId: tx.locationId,
      locationName: tx.locationName,
      clientId: tx.clientId || 999,
      clientName: tx.clientName || 'Trader',
      source: 'esi:/characters/...',
      observedAt: Date.now(),
    };
  }

  function makeJournal(jn: {
    characterId: number;
    journalId: number;
    date: string;
    refType: string;
    amount: number;
    contextId?: number;
    contextIdType?: string;
    description?: string;
  }): CharacterWalletJournalEntry {
    return {
      id: `${jn.characterId}:${jn.journalId}`,
      characterId: jn.characterId,
      journalId: jn.journalId,
      date: jn.date,
      refType: jn.refType,
      amount: jn.amount,
      balance: 1000000,
      contextId: jn.contextId,
      contextIdType: jn.contextIdType,
      description: jn.description || '',
      source: 'esi:/characters/...',
      observedAt: Date.now(),
    };
  }

  beforeEach(() => {
    roiRepository.reset();
    ledgerRepository.reset();
    hubsRepository.resetToDefaults();
  });

  it('returns UNKNOWN (not 0) when sales exist without any explicit cost allocation', () => {
    // 1 sale of 100 Tritanium at 6.50 ISK each = 650 ISK revenue
    const sellTx = makeTx({
      transactionId: 1001,
      characterId: CHAR_ID,
      date: '2026-03-01T10:00:00Z',
      isBuy: false,
      journalRefId: 5001,
      locationId: 60003760, // Jita
      locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      quantity: 100,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 6.5,
      clientId: 12345,
      clientName: 'Buyer One',
    });

    ledgerRepository.saveTransactions([sellTx]);

    const summary = roiService.getSummary({ character_id: CHAR_ID });
    expect(summary.total_sales_volume).toBe(100);
    expect(summary.gross_revenue_isk).toBe(650);
    expect(summary.allocated_sales_volume).toBe(0);
    expect(summary.unallocated_sales_volume).toBe(100);
    expect(summary.coverage_status).toBe('UNKNOWN');
    expect(summary.coverage_percent).toBe(0);
    // Strict Domain Contract: ROI and Realized profit must NOT be 0 or estimated when unproven
    expect(summary.realized_profit_ttc_isk).toBeNull();
    expect(summary.roi_percent_ttc).toBeNull();
  });

  it('calculates exact Realized Profit TTC and ROI TTC on explicit allocation with fees', () => {
    // 1. Buy 100 Tritanium @ 4.00 ISK in Jita (Cost = 400 ISK, Broker fee = 12 ISK)
    const buyTx = makeTx({
      transactionId: 2001,
      characterId: CHAR_ID,
      date: '2026-03-01T08:00:00Z',
      isBuy: true,
      journalRefId: 5001,
      locationId: 60003760, // Jita
      locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      quantity: 100,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 4.0,
      clientId: 11111,
      clientName: 'Seller One',
    });

    const buyFeeJournal = makeJournal({
      journalId: 5001,
      characterId: CHAR_ID,
      date: '2026-03-01T08:00:00Z',
      refType: 'brokers_fee',
      amount: -12.0, // 12 ISK broker fee
      description: 'Broker fee for buy order',
      contextId: 2001,
      contextIdType: 'broker_fee',
    });

    // 2. Sell 100 Tritanium @ 6.00 ISK in Dodixie (Revenue = 600 ISK, Sales Tax = 48 ISK)
    const sellTx = makeTx({
      transactionId: 3001,
      characterId: CHAR_ID,
      date: '2026-03-02T12:00:00Z',
      isBuy: false,
      journalRefId: 5002,
      locationId: 60011866, // Dodixie
      locationName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
      quantity: 100,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 6.0,
      clientId: 22222,
      clientName: 'Buyer Two',
    });

    const sellFeeJournal = makeJournal({
      journalId: 5002,
      characterId: CHAR_ID,
      date: '2026-03-02T12:00:00Z',
      refType: 'transaction_tax',
      amount: -48.0, // 48 ISK sales tax
      description: 'Transaction tax for sell',
      contextId: 3001,
      contextIdType: 'transaction_tax',
    });

    ledgerRepository.saveTransactions([buyTx, sellTx]);
    ledgerRepository.saveJournalEntries([buyFeeJournal, sellFeeJournal]);

    // 3. Create explicit allocation
    const allocResult = roiService.createExplicitAllocation({
      character_id: CHAR_ID,
      sell_transaction_id: 3001,
      buy_transaction_id: 2001,
      quantity_to_allocate: 100,
    });

    expect(allocResult.success).toBe(true);
    expect(allocResult.allocation?.allocated_buy_cost).toBe(400); // 100 * 4.0
    expect(allocResult.allocation?.allocated_buy_fees).toBe(12);
    expect(allocResult.allocation?.allocated_sell_fees).toBe(48);
    expect(allocResult.allocation?.buy_hub_id).toBe('hub-jita');
    expect(allocResult.allocation?.sell_hub_id).toBe('hub-dodixie');

    // 4. Verification of financial metrics
    // Gross Revenue = 600
    // Total Allocated Investment TTC = 400 (buy cost) + 12 (buy fee) = 412
    // Realized Profit TTC = 600 - 400 - 12 - 48 = 140
    // ROI % TTC = (140 / 412) * 100 = 33.98 %
    const summary = roiService.getSummary({ character_id: CHAR_ID });
    expect(summary.total_sales_volume).toBe(100);
    expect(summary.allocated_sales_volume).toBe(100);
    expect(summary.unallocated_sales_volume).toBe(0);
    expect(summary.gross_revenue_isk).toBe(600);
    expect(summary.allocated_buy_cost_isk).toBe(400);
    expect(summary.allocated_buy_fees_isk).toBe(12);
    expect(summary.attributable_sell_fees_isk).toBe(48);
    expect(summary.total_allocated_investment_ttc).toBe(412);
    expect(summary.realized_profit_ttc_isk).toBe(140);
    expect(summary.roi_percent_ttc).toBe(33.98);
    expect(summary.coverage_status).toBe('COMPLETE');
    expect(summary.coverage_percent).toBe(100);

    // Hub pair verification (hub-jita -> hub-dodixie)
    expect(summary.hub_pairs.length).toBe(1);
    const pair = summary.hub_pairs[0];
    expect(pair.buy_hub_id).toBe('hub-jita');
    expect(pair.sell_hub_id).toBe('hub-dodixie');
    expect(pair.gross_revenue).toBe(600);
    expect(pair.realized_profit_ttc).toBe(140);
    expect(pair.roi_percent_ttc).toBe(33.98);
  });

  it('marks partial coverage as PARTIAL and tracks unsold stock as capital immobilisé', () => {
    // Buy 200 Tritanium @ 5.00 ISK (Total cost = 1,000 ISK)
    const buyTx = makeTx({
      transactionId: 2002,
      characterId: CHAR_ID,
      date: '2026-03-01T08:00:00Z',
      isBuy: true,
      journalRefId: 5003,
      locationId: 60003760, // Jita
      locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      quantity: 200,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 5.0,
      clientId: 11111,
      clientName: 'Seller One',
    });

    // Sell 100 Tritanium @ 8.00 ISK (Total revenue = 800 ISK)
    const sellTx = makeTx({
      transactionId: 3002,
      characterId: CHAR_ID,
      date: '2026-03-02T12:00:00Z',
      isBuy: false,
      journalRefId: 5004,
      locationId: 60003760, // Jita
      locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      quantity: 100,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 8.0,
      clientId: 22222,
      clientName: 'Buyer Two',
    });

    ledgerRepository.saveTransactions([buyTx, sellTx]);

    // Explicitly allocate 50 units only (out of 100 sold)
    roiService.createExplicitAllocation({
      character_id: CHAR_ID,
      sell_transaction_id: 3002,
      buy_transaction_id: 2002,
      quantity_to_allocate: 50,
    });

    const summary = roiService.getSummary({ character_id: CHAR_ID });
    expect(summary.total_sales_volume).toBe(100);
    expect(summary.allocated_sales_volume).toBe(50);
    expect(summary.unallocated_sales_volume).toBe(50);
    expect(summary.coverage_status).toBe('PARTIAL');
    expect(summary.coverage_percent).toBe(50);

    // Allocated revenue = 50 * 8 = 400 ISK
    // Allocated cost = 50 * 5 = 250 ISK
    // Profit on allocated units = 400 - 250 = 150 ISK
    // ROI = (150 / 250) * 100 = 60%
    expect(summary.realized_profit_ttc_isk).toBe(150);
    expect(summary.roi_percent_ttc).toBe(60);

    // Unsold inventory = 200 bought - 50 allocated = 150 units remaining @ 5.00 ISK = 750 ISK capital immobilisé
    expect(summary.tied_up_capital_isk).toBe(750);
    expect(summary.unsold_items_count).toBe(1);

    const unsoldList = roiService.getUnsoldInventory(CHAR_ID);
    expect(unsoldList.length).toBe(1);
    expect(unsoldList[0].remaining_quantity).toBe(150);
    expect(unsoldList[0].tied_capital_isk).toBe(750);
  });

  it('rejects invalid allocation attempts (type mismatch, over-allocation, character isolation)', () => {
    const buyTx = makeTx({
      transactionId: 2003,
      characterId: CHAR_ID,
      date: '2026-03-01T08:00:00Z',
      isBuy: true,
      journalRefId: 5005,
      locationId: 60003760,
      locationName: 'Jita',
      quantity: 10,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 5.0,
      clientId: 11111,
      clientName: 'Seller One',
    });

    const sellPlexTx = makeTx({
      transactionId: 3003,
      characterId: CHAR_ID,
      date: '2026-03-02T12:00:00Z',
      isBuy: false,
      journalRefId: 5006,
      locationId: 60003760,
      locationName: 'Jita',
      quantity: 10,
      typeId: PLEX_TYPE_ID,
      typeName: 'PLEX',
      unitPrice: 5000000,
      clientId: 22222,
      clientName: 'Buyer Two',
    });

    const sellTritTx = makeTx({
      transactionId: 3004,
      characterId: CHAR_ID,
      date: '2026-03-02T12:00:00Z',
      isBuy: false,
      journalRefId: 5007,
      locationId: 60003760,
      locationName: 'Jita',
      quantity: 5,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 6.0,
      clientId: 22222,
      clientName: 'Buyer Two',
    });

    ledgerRepository.saveTransactions([buyTx, sellPlexTx, sellTritTx]);

    // 1. Type mismatch (Tritanium buy with PLEX sell)
    const typeMismatch = roiService.createExplicitAllocation({
      character_id: CHAR_ID,
      sell_transaction_id: 3003,
      buy_transaction_id: 2003,
      quantity_to_allocate: 5,
    });
    expect(typeMismatch.success).toBe(false);
    expect(typeMismatch.error).toContain('Incompatibilité de type');

    // 2. Over-allocating sell quantity (5 available, requesting 10)
    const overSell = roiService.createExplicitAllocation({
      character_id: CHAR_ID,
      sell_transaction_id: 3004,
      buy_transaction_id: 2003,
      quantity_to_allocate: 10,
    });
    expect(overSell.success).toBe(false);
    expect(overSell.error).toContain('reliquat vendable');

    // 3. Character isolation (other character cannot allocate someone else's transactions)
    const charIsolation = roiService.createExplicitAllocation({
      character_id: OTHER_CHAR_ID,
      sell_transaction_id: 3004,
      buy_transaction_id: 2003,
      quantity_to_allocate: 5,
    });
    expect(charIsolation.success).toBe(false);
    expect(charIsolation.error).toContain('introuvable ou invalide');
  });

  it('reconciles multi-character trading ecosystem automatically via chronological FIFO', () => {
    const BUYER_CHAR_ID = 95432101;
    const SELLER_CHAR_ID = 95432102;
    const MISSILE_TYPE_ID = 209; // Scourge Heavy Missile

    // 1. Character A buys 1000 missiles @ 40 ISK in Jita (instant buy from sell order or buy order)
    const buyTx = makeTx({
      transactionId: 4001,
      characterId: BUYER_CHAR_ID,
      date: '2026-03-01T08:00:00Z',
      isBuy: true,
      journalRefId: 6001,
      locationId: 60003760, // Jita
      locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      quantity: 1000,
      typeId: MISSILE_TYPE_ID,
      typeName: 'Scourge Heavy Missile',
      unitPrice: 40.0,
    });

    const buyBrokerFee = makeJournal({
      journalId: 6001,
      characterId: BUYER_CHAR_ID,
      date: '2026-03-01T08:00:00Z',
      refType: 'brokers_fee',
      amount: -1200, // 1,200 ISK broker fee on buy
      contextId: 4001,
      contextIdType: 'broker_fee',
    });

    // 2. Character B sells 600 missiles @ 65 ISK in Amarr on the next day
    const sellTx = makeTx({
      transactionId: 5001,
      characterId: SELLER_CHAR_ID,
      date: '2026-03-02T14:00:00Z',
      isBuy: false,
      journalRefId: 6002,
      locationId: 60008494, // Amarr
      locationName: 'Amarr VIII (Oris) - Emperor Family Academy',
      quantity: 600,
      typeId: MISSILE_TYPE_ID,
      typeName: 'Scourge Heavy Missile',
      unitPrice: 65.0,
    });

    const sellTax = makeJournal({
      journalId: 6002,
      characterId: SELLER_CHAR_ID,
      date: '2026-03-02T14:00:00Z',
      refType: 'transaction_tax',
      amount: -3120, // 8% tax on 39,000 ISK = 3,120 ISK
      contextId: 5001,
      contextIdType: 'transaction_tax',
    });

    ledgerRepository.saveTransactions([buyTx, sellTx]);
    ledgerRepository.saveJournalEntries([buyBrokerFee, sellTax]);

    // 3. Run multi-character automatic FIFO reconciliation
    const result = roiService.autoReconcileFifo({
      characterIds: [BUYER_CHAR_ID, SELLER_CHAR_ID],
    });

    expect(result.allocations_created).toBe(1);
    expect(result.total_quantity_reconciled).toBe(600);
    expect(result.sales_fully_matched).toBe(1);
    expect(result.sales_unmatched).toBe(0);

    // 4. Verify allocation properties
    const allocations = roiService.listAllocations();
    expect(allocations.length).toBe(1);
    const alloc = allocations[0];
    expect(alloc.buy_character_id).toBe(BUYER_CHAR_ID);
    expect(alloc.sell_character_id).toBe(SELLER_CHAR_ID);
    expect(alloc.buy_hub_id).toBe('hub-jita');
    expect(alloc.sell_hub_id).toBe('hub-amarr');
    expect(alloc.quantity_allocated).toBe(600);
    expect(alloc.unit_buy_price).toBe(40.0);
    expect(alloc.allocated_buy_cost).toBe(24000); // 600 * 40
    expect(alloc.allocated_buy_fees).toBe(720); // 600/1000 * 1200
    expect(alloc.allocated_sell_fees).toBe(3120);

    // 5. Verify multi-character summary
    const summary = roiService.getSummary({
      character_ids: [BUYER_CHAR_ID, SELLER_CHAR_ID],
    });

    expect(summary.total_sales_volume).toBe(600);
    expect(summary.allocated_sales_volume).toBe(600);
    expect(summary.unallocated_sales_volume).toBe(0);
    expect(summary.gross_revenue_isk).toBe(39000); // 600 * 65
    expect(summary.allocated_buy_cost_isk).toBe(24000);
    expect(summary.allocated_buy_fees_isk).toBe(720);
    expect(summary.attributable_sell_fees_isk).toBe(3120);
    expect(summary.total_allocated_investment_ttc).toBe(24720); // 24000 + 720
    // Realized Profit = 39000 - 24000 - 720 - 3120 = 11,160 ISK
    expect(summary.realized_profit_ttc_isk).toBe(11160);
    // ROI % = (11160 / 24720) * 100 = 45.15%
    expect(summary.roi_percent_ttc).toBe(45.15);
    expect(summary.coverage_status).toBe('COMPLETE');
    expect(summary.coverage_percent).toBe(100);

    // 6. Remaining 400 missiles in unsold inventory as capital immobilisé
    expect(summary.unsold_items_count).toBe(1);
    expect(summary.tied_up_capital_isk).toBe(16480); // 400 * 40 = 16000 + 480 remaining fees

    const unsold = roiService.getUnsoldInventory(undefined, [BUYER_CHAR_ID, SELLER_CHAR_ID]);
    expect(unsold.length).toBe(1);
    expect(unsold[0].character_id).toBe(BUYER_CHAR_ID);
    expect(unsold[0].remaining_quantity).toBe(400);
    expect(unsold[0].tied_capital_isk).toBe(16000);
  });

  it('leaves sales without prior purchases strictly UNKNOWN and handles direct sell order purchases', () => {
    const CHAR_ID = 95432101;
    const SCOURGE_ID = 209;
    const INFERNO_ID = 210;

    // 1. Direct purchase of 50 Scourge Missiles on sell order @ 50 ISK
    const buyScourge = makeTx({
      transactionId: 6001,
      characterId: CHAR_ID,
      date: '2026-03-01T08:00:00Z',
      isBuy: true,
      locationId: 60003760, // Jita
      quantity: 50,
      typeId: SCOURGE_ID,
      typeName: 'Scourge Heavy Missile',
      unitPrice: 50.0,
    });

    // 2. Sale of 50 Scourge Missiles @ 80 ISK
    const sellScourge = makeTx({
      transactionId: 7001,
      characterId: CHAR_ID,
      date: '2026-03-02T10:00:00Z',
      isBuy: false,
      locationId: 60011866, // Dodixie
      quantity: 50,
      typeId: SCOURGE_ID,
      typeName: 'Scourge Heavy Missile',
      unitPrice: 80.0,
    });

    // 3. Sale of 200 Inferno Missiles with NO prior purchase observed (loot / production / previous history)
    const sellInferno = makeTx({
      transactionId: 7002,
      characterId: CHAR_ID,
      date: '2026-03-02T11:00:00Z',
      isBuy: false,
      locationId: 60011866, // Dodixie
      quantity: 200,
      typeId: INFERNO_ID,
      typeName: 'Inferno Heavy Missile',
      unitPrice: 70.0,
    });

    ledgerRepository.saveTransactions([buyScourge, sellScourge, sellInferno]);

    const result = roiService.autoReconcileFifo({ characterId: CHAR_ID });
    expect(result.sales_fully_matched).toBe(1); // Scourge matched
    expect(result.sales_unmatched).toBe(1); // Inferno unmatched

    const summary = roiService.getSummary({ character_id: CHAR_ID });
    expect(summary.total_sales_volume).toBe(250); // 50 + 200
    expect(summary.allocated_sales_volume).toBe(50);
    expect(summary.unallocated_sales_volume).toBe(200);
    expect(summary.coverage_status).toBe('PARTIAL');
    expect(summary.coverage_percent).toBe(20); // 50 / 250 * 100 = 20%

    // Only the proven 50 Scourge units have calculated profit
    // Scourge: 50 * 80 = 4,000 ISK revenue, 50 * 50 = 2,500 ISK cost -> 1,500 profit
    expect(summary.realized_profit_ttc_isk).toBe(1500);
    expect(summary.roi_percent_ttc).toBe(60); // 1500 / 2500 = 60%
  });

  it('correctly resolves 100% reconciliation when buyer and seller are different characters in the ecosystem', () => {
    const BUYER_ID = 1001;
    const SELLER_ID = 1002;
    const TRIT_ID = 34;

    // Character A (Jita Buyer) buys 50,000 Tritanium @ 4.5 ISK in Jita
    const buyA = makeTx({
      transactionId: 101,
      characterId: BUYER_ID,
      date: '2026-03-01T08:00:00Z',
      isBuy: true,
      locationId: 60003760, // Jita
      quantity: 50000,
      typeId: TRIT_ID,
      typeName: 'Tritanium',
      unitPrice: 4.5,
    });

    // Character B (Regional Seller) sells 50,000 Tritanium @ 6.5 ISK in Rens
    const sellB = makeTx({
      transactionId: 201,
      characterId: SELLER_ID,
      date: '2026-03-02T10:00:00Z',
      isBuy: false,
      locationId: 60004588, // Rens
      quantity: 50000,
      typeId: TRIT_ID,
      typeName: 'Tritanium',
      unitPrice: 6.5,
    });

    // Tax entry for Character B's sale: 3.6% of 325,000 = 11,700 ISK
    const taxB = makeJournal({
      journalId: 301,
      characterId: SELLER_ID,
      date: '2026-03-02T10:00:00Z',
      refType: 'transaction_tax',
      amount: -11700,
      contextId: 201,
      contextIdType: 'transaction_tax',
      description: 'Transaction Tax',
    });

    ledgerRepository.saveTransactions([buyA, sellB]);
    ledgerRepository.saveJournalEntries([taxB]);

    // When running FIFO with both character IDs:
    const reconcileResult = roiService.autoReconcileFifo({
      characterIds: [BUYER_ID, SELLER_ID],
    });

    expect(reconcileResult.allocations_created).toBe(1);
    expect(reconcileResult.total_quantity_reconciled).toBe(50000);
    expect(reconcileResult.sales_fully_matched).toBe(1);
    expect(reconcileResult.sales_unmatched).toBe(0);

    const summary = roiService.getSummary({
      character_ids: [BUYER_ID, SELLER_ID],
    });

    expect(summary.total_sales_volume).toBe(50000);
    expect(summary.allocated_sales_volume).toBe(50000);
    expect(summary.coverage_percent).toBe(100);
    expect(summary.coverage_status).toBe('COMPLETE');
    expect(summary.gross_revenue_isk).toBe(325000); // 50,000 * 6.5
    expect(summary.allocated_buy_cost_isk).toBe(225000); // 50,000 * 4.5
    expect(summary.attributable_sell_fees_isk).toBe(11700); // 11,700 tax
    // Realized Profit = 325,000 - 225,000 - 11,700 = 88,300 ISK
    expect(summary.realized_profit_ttc_isk).toBe(88300);
    // ROI = (88,300 / 225,000) * 100 = 39.24%
    expect(summary.roi_percent_ttc).toBe(39.24);
  });

  it('handles Opening Inventory Balance Lots with mandatory justification and explicit reconciliation', () => {
    // 1. Attempt to create opening balance without mandatory justification (should fail)
    const failedOb = roiService.createOpeningBalance({
      character_id: CHAR_ID,
      type_id: TRITANIUM_TYPE_ID,
      type_name: 'Tritanium',
      quantity: 1000,
      unit_cost_isk: 4.0,
      location_id: 60003760,
      justification: '', // empty!
    });
    expect(failedOb.success).toBe(false);
    expect(failedOb.error).toContain('justification explicite');

    // 2. Create valid opening balance lot
    const validOb = roiService.createOpeningBalance({
      character_id: CHAR_ID,
      type_id: TRITANIUM_TYPE_ID,
      type_name: 'Tritanium',
      quantity: 1000,
      unit_cost_isk: 4.0,
      location_id: 60003760,
      acquisition_date: '2026-02-01T00:00:00Z',
      justification: 'Stock miné et raffiné avant mise en place du système',
    });
    expect(validOb.success).toBe(true);
    expect(validOb.opening_balance).toBeDefined();
    const obId = validOb.opening_balance!.id;

    // 3. Sale of 600 Tritanium @ 7.00 ISK
    const sellTx = makeTx({
      transactionId: 9001,
      characterId: CHAR_ID,
      date: '2026-03-01T12:00:00Z',
      isBuy: false,
      locationId: 60003760,
      quantity: 600,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 7.0,
    });
    ledgerRepository.saveTransactions([sellTx]);

    // 4. Reconcile against opening balance lot
    const alloc = roiService.createExplicitAllocation({
      character_id: CHAR_ID,
      sell_transaction_id: 9001,
      opening_balance_id: obId,
      quantity_to_allocate: 600,
    });
    expect(alloc.success).toBe(true);
    expect(alloc.allocation?.source_type).toBe('OPENING_BALANCE');
    expect(alloc.allocation?.allocated_buy_cost).toBe(2400); // 600 * 4.0

    // 5. Verification of summary & unsold opening balance capital
    const summary = roiService.getSummary({ character_id: CHAR_ID });
    expect(summary.total_sales_volume).toBe(600);
    expect(summary.allocated_sales_volume).toBe(600);
    expect(summary.gross_revenue_isk).toBe(4200); // 600 * 7.0
    expect(summary.allocated_buy_cost_isk).toBe(2400);
    expect(summary.realized_profit_ttc_isk).toBe(1800); // 4200 - 2400
    expect(summary.roi_percent_ttc).toBe(75); // 1800 / 2400 * 100 = 75%
    expect(summary.tied_up_capital_isk).toBe(1600); // 400 remaining * 4.0 = 1600 ISK
    expect(summary.unsold_items_count).toBe(1);

    // 6. Detailed sales audit proof verification
    const details = roiService.getSalesReconciliationDetails({ character_id: CHAR_ID });
    expect(details.length).toBe(1);
    expect(details[0].sale_transaction_id).toBe(9001);
    expect(details[0].realized_profit_ttc_isk).toBe(1800);
    expect(details[0].proof.numerator_isk).toBe(1800);
    expect(details[0].proof.denominator_isk).toBe(2400);
    expect(details[0].proof.formula_expression).toContain('4\u202f200');
  });

  it('enforces strict temporal anteriority (rejects allocations where buy occurs after sell)', () => {
    // Sale occurs on March 1st
    const sellTx = makeTx({
      transactionId: 9101,
      characterId: CHAR_ID,
      date: '2026-03-01T12:00:00Z',
      isBuy: false,
      locationId: 60003760,
      quantity: 100,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 10.0,
    });

    // Buy occurs on March 5th (FUTURE relative to sale)
    const futureBuyTx = makeTx({
      transactionId: 9102,
      characterId: CHAR_ID,
      date: '2026-03-05T12:00:00Z',
      isBuy: true,
      locationId: 60003760,
      quantity: 100,
      typeId: TRITANIUM_TYPE_ID,
      typeName: 'Tritanium',
      unitPrice: 5.0,
    });

    ledgerRepository.saveTransactions([sellTx, futureBuyTx]);

    // Manual allocation must fail
    const res = roiService.createExplicitAllocation({
      character_id: CHAR_ID,
      sell_transaction_id: 9101,
      buy_transaction_id: 9102,
      quantity_to_allocate: 100,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('antérieure ou égale');

    // Auto FIFO must not match future buy
    const fifoResult = roiService.autoReconcileFifo({ characterId: CHAR_ID });
    expect(fifoResult.allocations_created).toBe(0);
    expect(fifoResult.sales_unmatched).toBe(1);
  });

  it('persists multiple allocations in a single batch with saveAllocations', () => {
    const alloc1: ExplicitCostAllocation = {
      id: 'test-alloc-1',
      character_id: CHAR_ID,
      sell_transaction_id: 1,
      source_type: 'TRANSACTION',
      buy_transaction_id: 10,
      type_id: TRITANIUM_TYPE_ID,
      type_name: 'Tritanium',
      quantity_allocated: 50,
      unit_buy_price: 4.0,
      allocated_buy_cost: 200,
      allocated_buy_fees: 0,
      allocated_sell_fees: 0,
      buy_location_id: 60003760,
      buy_hub_id: 'jita',
      buy_hub_name: 'Jita',
      sell_location_id: 60003760,
      sell_hub_id: 'jita',
      sell_hub_name: 'Jita',
      reconciliation_mode: 'FIFO_AUTOMATIC',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
    const alloc2: ExplicitCostAllocation = {
      id: 'test-alloc-2',
      character_id: CHAR_ID,
      sell_transaction_id: 2,
      source_type: 'TRANSACTION',
      buy_transaction_id: 11,
      type_id: TRITANIUM_TYPE_ID,
      type_name: 'Tritanium',
      quantity_allocated: 50,
      unit_buy_price: 4.0,
      allocated_buy_cost: 200,
      allocated_buy_fees: 0,
      allocated_sell_fees: 0,
      buy_location_id: 60003760,
      buy_hub_id: 'jita',
      buy_hub_name: 'Jita',
      sell_location_id: 60003760,
      sell_hub_id: 'jita',
      sell_hub_name: 'Jita',
      reconciliation_mode: 'FIFO_AUTOMATIC',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };

    roiRepository.saveAllocations([alloc1, alloc2]);
    const stored = roiRepository.listAllocations(CHAR_ID);
    expect(stored.some((a) => a.id === 'test-alloc-1')).toBe(true);
    expect(stored.some((a) => a.id === 'test-alloc-2')).toBe(true);
  });

  describe('Phase R02 Mandatory Tests — Exhaustive Inventory & Historical Buy Lots (> 500 Items)', () => {
    it('non-regression: accounts for all 1,200 historical buy lots in ledger and FIFO reconciliation without 500-page cap', () => {
      const charId = 8888;
      // 1. Generate 1,200 buy transactions (10 units each at 5.0 ISK)
      const buyTxs: CharacterTransaction[] = [];
      const baseDate = new Date('2026-01-01T00:00:00Z').getTime();

      for (let i = 1; i <= 1200; i++) {
        const txDate = new Date(baseDate + i * 60000).toISOString();
        buyTxs.push(
          makeTx({
            transactionId: 100000 + i,
            characterId: charId,
            date: txDate,
            isBuy: true,
            journalRefId: 200000 + i,
            locationId: 60003760,
            locationName: 'Jita IV - 4',
            quantity: 10,
            typeId: TRITANIUM_TYPE_ID,
            typeName: 'Tritanium',
            unitPrice: 5.0,
            clientId: 11111,
            clientName: 'Supplier Corp',
          })
        );
      }

      ledgerRepository.saveTransactions(buyTxs);

      // Verify repository has all 1,200 transactions
      expect(ledgerRepository.countTransactions(charId)).toBe(1200);

      // Verify that getAllTransactions returns all 1,200 without 500 limit
      const allTxs = ledgerRepository.getAllTransactions(charId);
      expect(allTxs.length).toBe(1200);

      // Verify that getHistoricalBuyLots returns all 1,200
      const historicalLots = ledgerRepository.getHistoricalBuyLots(charId, undefined, TRITANIUM_TYPE_ID);
      expect(historicalLots.length).toBe(1200);

      // 2. Add 1 sell transaction for 7,500 units at 7.0 ISK (should match 750 lots of 10 units)
      const sellTx = makeTx({
        transactionId: 999999,
        characterId: charId,
        date: new Date(baseDate + 2000 * 60000).toISOString(),
        isBuy: false,
        journalRefId: 999998,
        locationId: 60003760,
        locationName: 'Jita IV - 4',
        quantity: 7500,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 7.0,
        clientId: 22222,
        clientName: 'Consumer Corp',
      });

      ledgerRepository.saveTransactions([sellTx]);

      // 3. Run FIFO automatic reconciliation
      const result = roiService.autoReconcileFifo({
        characterId: charId,
        typeId: TRITANIUM_TYPE_ID,
      });

      expect(result.sales_fully_matched).toBe(1);
      expect(result.sales_unmatched).toBe(0);
      expect(result.total_quantity_reconciled).toBe(7500);
      expect(result.allocations_created).toBe(750); // Exactly 750 buy transactions matched

      // 4. Verify inventory lots: ALL 1,200 lots must be accounted for!
      const inventoryLots = roiRepository.getInventoryLots(charId, undefined, TRITANIUM_TYPE_ID);
      expect(inventoryLots.length).toBe(1200);

      // First 750 lots should be fully allocated
      const fullyAllocatedLots = inventoryLots.filter((lot) => lot.remaining_quantity === 0 && lot.allocated_quantity === 10);
      expect(fullyAllocatedLots.length).toBe(750);

      // Remaining 450 lots must be untouched with 10 units remaining
      const unallocatedLots = inventoryLots.filter((lot) => lot.remaining_quantity === 10 && lot.allocated_quantity === 0);
      expect(unallocatedLots.length).toBe(450);

      // Sum of remaining quantities must be exactly 4,500 units
      const totalRemainingQty = inventoryLots.reduce((acc, lot) => acc + lot.remaining_quantity, 0);
      expect(totalRemainingQty).toBe(4500);
    });

    it('reconciles and tracks complete inventory on a massive 2,500 historical buy transactions dataset', () => {
      const charId = 7777;
      const buyTxs: CharacterTransaction[] = [];
      const baseDate = new Date('2026-02-01T00:00:00Z').getTime();

      for (let i = 1; i <= 2500; i++) {
        buyTxs.push(
          makeTx({
            transactionId: 500000 + i,
            characterId: charId,
            date: new Date(baseDate + i * 30000).toISOString(),
            isBuy: true,
            journalRefId: 600000 + i,
            locationId: 60003760,
            locationName: 'Jita IV - 4',
            quantity: 10,
            typeId: TRITANIUM_TYPE_ID,
            typeName: 'Tritanium',
            unitPrice: 4.5,
            clientId: 11111,
            clientName: 'Bulk Mining Corp',
          })
        );
      }

      ledgerRepository.saveTransactions(buyTxs);
      expect(ledgerRepository.countTransactions(charId)).toBe(2500);

      // Sell 15,000 units (matching 1,500 lots)
      const sellTx = makeTx({
        transactionId: 888888,
        characterId: charId,
        date: new Date(baseDate + 3000 * 30000).toISOString(),
        isBuy: false,
        journalRefId: 888887,
        locationId: 60003760,
        locationName: 'Jita IV - 4',
        quantity: 15000,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 6.0,
        clientId: 22222,
        clientName: 'Industrial Client',
      });
      ledgerRepository.saveTransactions([sellTx]);

      const fifoResult = roiService.autoReconcileFifo({
        characterId: charId,
        typeId: TRITANIUM_TYPE_ID,
      });

      expect(fifoResult.allocations_created).toBe(1500);
      expect(fifoResult.total_quantity_reconciled).toBe(15000);
      expect(fifoResult.sales_fully_matched).toBe(1);

      // Check all 2,500 inventory lots are present and accurately partitioned
      const lots = roiRepository.getInventoryLots(charId, undefined, TRITANIUM_TYPE_ID);
      expect(lots.length).toBe(2500);

      const remainingLots = lots.filter((l) => l.remaining_quantity > 0);
      expect(remainingLots.length).toBe(1000); // 2500 - 1500 = 1000 lots remaining
      const totalRemainingQty = remainingLots.reduce((acc, l) => acc + l.remaining_quantity, 0);
      expect(totalRemainingQty).toBe(10000);
    });
  });

  describe('Phase F03 — Invariants Financiers, Détection Chronologique & Valorisation FIFO', () => {
    it('verifies that in multi-character mode, a sale of Character A does not absorb Character B lots when Character A has its own lots (S2-4 fix)', () => {
      const CHAR_A = 96001;
      const CHAR_B = 96002;
      const TYPE_TEST = 12005;

      // 1. Character B bought 100 units on March 01 @ 10.0 ISK (earlier date)
      const buyB = makeTx({
        transactionId: 1001,
        characterId: CHAR_B,
        date: '2026-03-01T08:00:00Z',
        isBuy: true,
        typeId: TYPE_TEST,
        typeName: 'Isotope A',
        quantity: 100,
        unitPrice: 10.0,
        locationId: 60003760,
      });

      // 2. Character A bought 100 units on March 02 @ 20.0 ISK (later date)
      const buyA = makeTx({
        transactionId: 1002,
        characterId: CHAR_A,
        date: '2026-03-02T08:00:00Z',
        isBuy: true,
        typeId: TYPE_TEST,
        typeName: 'Isotope A',
        quantity: 100,
        unitPrice: 20.0,
        locationId: 60003760,
      });

      // 3. Character A sells 100 units on March 05 @ 30.0 ISK
      const sellA = makeTx({
        transactionId: 2001,
        characterId: CHAR_A,
        date: '2026-03-05T12:00:00Z',
        isBuy: false,
        typeId: TYPE_TEST,
        typeName: 'Isotope A',
        quantity: 100,
        unitPrice: 30.0,
        locationId: 60003760,
      });

      ledgerRepository.saveTransactions([buyB, buyA, sellA]);

      // Reconcile across both characters with default selling character priority (prioritizeSellingCharacter: true)
      const result = roiService.autoReconcileFifo({
        characterIds: [CHAR_A, CHAR_B],
        prioritizeSellingCharacter: true,
      });

      expect(result.sales_fully_matched).toBe(1);
      expect(result.allocations_created).toBe(1);

      const allocs = roiRepository.listAllocations(undefined, [CHAR_A, CHAR_B]);
      expect(allocs).toHaveLength(1);

      // The allocation must belong to Character A's own buy lot, NOT Character B's older lot!
      const alloc = allocs[0];
      expect(alloc.sell_character_id).toBe(CHAR_A);
      expect(alloc.buy_character_id).toBe(CHAR_A);
      expect(alloc.buy_transaction_id).toBe(1002); // buyA transaction id
      expect(alloc.unit_buy_price).toBe(20.0);

      // Character B's lots must be completely unconsumed (100 units remaining)
      const lotsB = roiRepository.getInventoryLots(CHAR_B);
      expect(lotsB).toHaveLength(1);
      expect(lotsB[0].remaining_quantity).toBe(100);
      expect(lotsB[0].allocated_quantity).toBe(0);

      // Character A's lots must be fully consumed
      const lotsA = roiRepository.getInventoryLots(CHAR_A);
      expect(lotsA).toHaveLength(1);
      expect(lotsA[0].remaining_quantity).toBe(0);
      expect(lotsA[0].allocated_quantity).toBe(100);
    });

    it('verifies strict character isolation mode prevents cross-character lot absorption completely', () => {
      const CHAR_A = 97001;
      const CHAR_B = 97002;
      const TYPE_TEST = 12006;

      // Character B owns 100 units
      const buyB = makeTx({
        transactionId: 3001,
        characterId: CHAR_B,
        date: '2026-03-01T08:00:00Z',
        isBuy: true,
        typeId: TYPE_TEST,
        typeName: 'Isotope B',
        quantity: 100,
        unitPrice: 15.0,
        locationId: 60003760,
      });

      // Character A sells 50 units but has ZERO lots of its own
      const sellA = makeTx({
        transactionId: 4001,
        characterId: CHAR_A,
        date: '2026-03-05T12:00:00Z',
        isBuy: false,
        typeId: TYPE_TEST,
        typeName: 'Isotope B',
        quantity: 50,
        unitPrice: 25.0,
        locationId: 60003760,
      });

      ledgerRepository.saveTransactions([buyB, sellA]);

      // Reconcile with strict character isolation enabled
      const result = roiService.autoReconcileFifo({
        characterIds: [CHAR_A, CHAR_B],
        strictCharacterIsolation: true,
      });

      // Character A has no lots of its own, so sale cannot match Character B's lot
      expect(result.sales_fully_matched).toBe(0);
      expect(result.sales_unmatched).toBe(1);
      expect(result.allocations_created).toBe(0);

      // Character B's inventory lot remains 100% available
      const lotsB = roiRepository.getInventoryLots(CHAR_B);
      expect(lotsB[0].remaining_quantity).toBe(100);
    });

    it('verifies arithmetic non-conversion: NaN / non-finite values return null and zero investment produces UNKNOWN not 0% (S2-3 fix)', () => {
      // 1. Test roundIsk and roundPercent non-coercion
      expect(roundIsk(NaN)).toBeNull();
      expect(roundIsk(Infinity)).toBeNull();
      expect(roundIsk(-Infinity)).toBeNull();
      expect(roundIsk(null as unknown as number)).toBeNull();
      expect(roundIsk(undefined as unknown as number)).toBeNull();

      expect(roundPercent(NaN)).toBeNull();
      expect(roundPercent(Infinity)).toBeNull();
      expect(roundPercent(-Infinity)).toBeNull();
      expect(roundPercent(null as unknown as number)).toBeNull();

      // Normal valid numbers continue to round accurately
      expect(roundIsk(123.456)).toBe(123.46);
      expect(roundPercent(45.678)).toBe(45.68);

      // 2. Test RoiCalculator.buildProof with 0 investment
      const zeroProof = RoiCalculator.buildProof({
        asOf: '2026-10-01T00:00:00Z',
        grossRevenue: 1000,
        allocatedBuyCost: 0,
        allocatedBuyFees: 0,
        allocatedSellFees: 50,
        allocatedVolume: 10,
        totalVolume: 10,
      });

      // Investment = 0 => ROI and realized profit must be null, NOT 0%
      expect(zeroProof.total_investment_ttc_isk).toBe(0);
      expect(zeroProof.roi_percent_ttc).toBeNull();
      expect(zeroProof.realized_profit_ttc_isk).toBeNull();
      expect(zeroProof.denominator_isk).toBeNull();
      expect(zeroProof.formula_expression).toContain('Investissement nul');

      // 3. Test computeSummary with unproven sales
      const unprovenSummary = RoiCalculator.computeSummary(
        [
          makeTx({
            transactionId: 9001,
            characterId: CHAR_ID,
            date: '2026-03-01T10:00:00Z',
            isBuy: false,
            typeId: 34,
            typeName: 'Tritanium',
            quantity: 500,
            unitPrice: 5.0,
            locationId: 60003760,
          }),
        ],
        [], // no allocations
        [],
        CHAR_ID
      );

      expect(unprovenSummary.total_allocated_investment_ttc).toBe(0);
      expect(unprovenSummary.roi_percent_ttc).toBeNull();
      expect(unprovenSummary.realized_profit_ttc_isk).toBeNull();
      expect(unprovenSummary.coverage_status).toBe('UNKNOWN');
      // Must not be 0
      expect(unprovenSummary.roi_percent_ttc).not.toBe(0);
    });

    it('targeted autoReconcileFifo on a specific typeId preserves allocations of all other item types', () => {
      // 1. Setup PLEX (44992) buy & sell
      const plexBuy = makeTx({
        transactionId: 101,
        characterId: CHAR_ID,
        date: '2026-03-01T08:00:00Z',
        isBuy: true,
        locationId: 60003760,
        quantity: 500,
        typeId: PLEX_TYPE_ID,
        typeName: 'PLEX',
        unitPrice: 5_000_000,
      });
      const plexSell = makeTx({
        transactionId: 102,
        characterId: CHAR_ID,
        date: '2026-03-01T12:00:00Z',
        isBuy: false,
        locationId: 60003760,
        quantity: 500,
        typeId: PLEX_TYPE_ID,
        typeName: 'PLEX',
        unitPrice: 5_200_000,
      });

      // 2. Setup Tritanium (34) buy & sell
      const tritBuy = makeTx({
        transactionId: 201,
        characterId: CHAR_ID,
        date: '2026-03-01T08:00:00Z',
        isBuy: true,
        locationId: 60003760,
        quantity: 100_000,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 4.0,
      });
      const tritSell = makeTx({
        transactionId: 202,
        characterId: CHAR_ID,
        date: '2026-03-01T14:00:00Z',
        isBuy: false,
        locationId: 60003760,
        quantity: 100_000,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 5.5,
      });

      ledgerRepository.saveTransactions([plexBuy, plexSell, tritBuy, tritSell]);

      // Global reconciliation reconciles both
      roiService.autoReconcileFifo({ characterId: CHAR_ID });
      const initialAllocations = roiRepository.listAllocations(CHAR_ID);
      expect(initialAllocations.length).toBe(2);
      expect(initialAllocations.some((a) => a.type_id === PLEX_TYPE_ID)).toBe(true);
      expect(initialAllocations.some((a) => a.type_id === TRITANIUM_TYPE_ID)).toBe(true);

      // Now run targeted reconciliation on Tritanium ONLY
      const tritResult = roiService.autoReconcileFifo({ characterId: CHAR_ID, typeId: TRITANIUM_TYPE_ID });
      expect(tritResult.allocations_created).toBe(1);

      // CRITICAL CONTRACT: PLEX allocations MUST NOT be deleted!
      const afterTargetedAllocations = roiRepository.listAllocations(CHAR_ID);
      expect(afterTargetedAllocations.length).toBe(2);
      const plexAlloc = afterTargetedAllocations.find((a) => a.type_id === PLEX_TYPE_ID);
      expect(plexAlloc).toBeDefined();
      expect(plexAlloc?.sell_transaction_id).toBe(102);

      const tritAlloc = afterTargetedAllocations.find((a) => a.type_id === TRITANIUM_TYPE_ID);
      expect(tritAlloc).toBeDefined();
      expect(tritAlloc?.sell_transaction_id).toBe(202);
    });

    it('getSummary with date filter does not attribute fees or costs from out-of-period historical allocations', () => {
      // Historical sale in February
      const febBuy = makeTx({
        transactionId: 301,
        characterId: CHAR_ID,
        date: '2026-02-01T08:00:00Z',
        isBuy: true,
        locationId: 60003760,
        quantity: 10,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 100,
      });
      const febSell = makeTx({
        transactionId: 302,
        characterId: CHAR_ID,
        date: '2026-02-02T08:00:00Z',
        isBuy: false,
        locationId: 60003760,
        quantity: 10,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 150,
      });
      const febSellFee = makeJournal({
        journalId: 3001,
        characterId: CHAR_ID,
        date: '2026-02-02T08:00:00Z',
        refType: 'transaction_tax',
        amount: -50,
        contextId: 302,
      });

      // Recent sale in March
      const marBuy = makeTx({
        transactionId: 401,
        characterId: CHAR_ID,
        date: '2026-03-01T08:00:00Z',
        isBuy: true,
        locationId: 60003760,
        quantity: 20,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 100,
      });
      const marSell = makeTx({
        transactionId: 402,
        characterId: CHAR_ID,
        date: '2026-03-02T08:00:00Z',
        isBuy: false,
        locationId: 60003760,
        quantity: 20,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 200,
      });

      ledgerRepository.saveTransactions([febBuy, febSell, marBuy, marSell]);
      ledgerRepository.saveJournalEntries([febSellFee]);

      roiService.autoReconcileFifo({ characterId: CHAR_ID });

      // Request summary ONLY for March
      const marchSummary = roiService.getSummary({
        character_id: CHAR_ID,
        start_date: '2026-03-01T00:00:00Z',
        end_date: '2026-03-31T23:59:59Z',
      });

      expect(marchSummary.total_sales_volume).toBe(20);
      expect(marchSummary.allocated_sales_volume).toBe(20);
      expect(marchSummary.gross_revenue_isk).toBe(4000); // 20 * 200
      expect(marchSummary.allocated_buy_cost_isk).toBe(2000); // 20 * 100
      // Fees from Feb (50 ISK) must NOT leak into March summary
      expect(marchSummary.attributable_sell_fees_isk).toBe(0);
      expect(marchSummary.realized_profit_ttc_isk).toBe(2000); // 4000 - 2000
    });

    it('computeSummary strictly excludes orphan allocations without valid sell transactions', () => {
      // 1. Setup a valid sale of 50 units
      const validSell = makeTx({
        transactionId: 501,
        characterId: CHAR_ID,
        date: '2026-03-05T10:00:00Z',
        isBuy: false,
        quantity: 50,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 10,
        locationId: 60003760,
      });

      // 2. Valid allocation for transaction 501
      const validAlloc: ExplicitCostAllocation = {
        id: 'valid-alloc-1',
        character_id: CHAR_ID,
        sell_character_id: CHAR_ID,
        sell_transaction_id: 501,
        source_type: 'TRANSACTION',
        buy_transaction_id: 201,
        type_id: TRITANIUM_TYPE_ID,
        type_name: 'Tritanium',
        quantity_allocated: 50,
        unit_buy_price: 6,
        allocated_buy_cost: 300,
        allocated_buy_fees: 10,
        allocated_sell_fees: 15,
        buy_location_id: 60003760,
        buy_hub_id: 'hub-jita',
        buy_hub_name: 'Jita 4-4',
        sell_location_id: 60003760,
        sell_hub_id: 'hub-jita',
        sell_hub_name: 'Jita 4-4',
        reconciliation_mode: 'FIFO_AUTOMATIC',
        created_at: '2026-03-05T10:05:00Z',
        updated_at: '2026-03-05T10:05:00Z',
        version: 1,
      };

      // 3. Orphan allocation pointing to a non-existent sell transaction 99999
      const orphanAlloc: ExplicitCostAllocation = {
        id: 'orphan-alloc-999',
        character_id: CHAR_ID,
        sell_character_id: CHAR_ID,
        sell_transaction_id: 99999, // Does not exist in salesTransactions
        source_type: 'TRANSACTION',
        buy_transaction_id: 202,
        type_id: TRITANIUM_TYPE_ID,
        type_name: 'Tritanium',
        quantity_allocated: 100,
        unit_buy_price: 5,
        allocated_buy_cost: 500, // Should NOT be added
        allocated_buy_fees: 50, // Should NOT be added
        allocated_sell_fees: 40, // Should NOT be added
        buy_location_id: 60003760,
        buy_hub_id: 'hub-jita',
        buy_hub_name: 'Jita 4-4',
        sell_location_id: 60003760,
        sell_hub_id: 'hub-jita',
        sell_hub_name: 'Jita 4-4',
        reconciliation_mode: 'FIFO_AUTOMATIC',
        created_at: '2026-03-05T10:05:00Z',
        updated_at: '2026-03-05T10:05:00Z',
        version: 1,
      };

      const summary = RoiCalculator.computeSummary(
        [validSell],
        [validAlloc, orphanAlloc],
        [],
        CHAR_ID
      );

      // Orphan allocation MUST NOT pollute totals
      expect(summary.total_sales_volume).toBe(50);
      expect(summary.allocated_sales_volume).toBe(50);
      expect(summary.gross_revenue_isk).toBe(500); // 50 * 10
      expect(summary.allocated_buy_cost_isk).toBe(300);
      expect(summary.allocated_buy_fees_isk).toBe(10);
      expect(summary.attributable_sell_fees_isk).toBe(15);
      expect(summary.total_allocated_investment_ttc).toBe(310);
      // Profit = 500 - 300 - 10 - 15 = 175
      expect(summary.realized_profit_ttc_isk).toBe(175);
      // ROI = (175 / 310) * 100 = 56.45%
      expect(summary.roi_percent_ttc).toBe(56.45);
      expect(summary.coverage_status).toBe('COMPLETE');
    });
  });

  describe('Isolated JSON Persistence Atomicity & Rollback Verification', () => {
    let tempDir: string;
    let tempStorePath: string;

    beforeEach(async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eve-roi-atomic-test-'));
      tempStorePath = path.join(tempDir, 'test_store.json');
    });

    it('guarantees complete rollback in Memory Map, Adapter State, and Disk JSON when replaceAutoAllocations persistence fails', async () => {
      const fs = await import('node:fs');
      const { DurableFileDatabaseAdapter } = await import('../storage/database.ts');
      const { PersistentRoiRepository } = await import('./repository.ts');
      const { PersistentLedgerRepository } = await import('../ledger/repository.ts');

      const adapter = new DurableFileDatabaseAdapter(tempStorePath);
      adapter.init();

      const testLedgerRepo = new PersistentLedgerRepository(adapter);
      const testRoiRepo = new PersistentRoiRepository(testLedgerRepo, adapter);

      // 1. Populate initial state with an allocation
      const initialAlloc: ExplicitCostAllocation = {
        id: 'initial-alloc-1',
        character_id: CHAR_ID,
        sell_character_id: CHAR_ID,
        sell_transaction_id: 1001,
        source_type: 'TRANSACTION',
        buy_transaction_id: 2001,
        type_id: TRITANIUM_TYPE_ID,
        type_name: 'Tritanium',
        quantity_allocated: 50,
        unit_buy_price: 4.0,
        allocated_buy_cost: 200,
        allocated_buy_fees: 5,
        allocated_sell_fees: 10,
        buy_location_id: 60003760,
        buy_hub_id: 'hub-jita',
        buy_hub_name: 'Jita 4-4',
        sell_location_id: 60003760,
        sell_hub_id: 'hub-jita',
        sell_hub_name: 'Jita 4-4',
        reconciliation_mode: 'FIFO_AUTOMATIC',
        created_at: '2026-03-01T08:00:00Z',
        updated_at: '2026-03-01T08:00:00Z',
        version: 1,
      };

      testRoiRepo.replaceAutoAllocations({
        characterId: CHAR_ID,
        allocations: [initialAlloc],
      });

      // Verify baseline persistence across all layers
      expect(testRoiRepo.listAllocations(CHAR_ID).length).toBe(1);
      expect(adapter.getState().data.roi.allocations.length).toBe(1);
      const rawDiskInitial = JSON.parse(fs.readFileSync(tempStorePath, 'utf8'));
      expect(rawDiskInitial.data.roi.allocations.length).toBe(1);
      expect(rawDiskInitial.data.roi.allocations[0].id).toBe('initial-alloc-1');

      // 2. Simulate persistence failure during replaceAutoAllocations
      // Mock persist() to simulate a disk/rename crash
      const originalPersist = adapter.persist.bind(adapter);
      adapter.persist = () => {
        throw new Error('SIMULATED_DISK_WRITE_FAILURE');
      };

      const replacementAlloc: ExplicitCostAllocation = {
        id: 'replacement-alloc-2',
        character_id: CHAR_ID,
        sell_character_id: CHAR_ID,
        sell_transaction_id: 1001,
        source_type: 'TRANSACTION',
        buy_transaction_id: 2001,
        type_id: TRITANIUM_TYPE_ID,
        type_name: 'Tritanium',
        quantity_allocated: 100,
        unit_buy_price: 4.0,
        allocated_buy_cost: 400,
        allocated_buy_fees: 10,
        allocated_sell_fees: 20,
        buy_location_id: 60003760,
        buy_hub_id: 'hub-jita',
        buy_hub_name: 'Jita 4-4',
        sell_location_id: 60003760,
        sell_hub_id: 'hub-jita',
        sell_hub_name: 'Jita 4-4',
        reconciliation_mode: 'FIFO_AUTOMATIC',
        created_at: '2026-03-01T09:00:00Z',
        updated_at: '2026-03-01T09:00:00Z',
        version: 1,
      };

      // 3. Execution MUST throw the error
      expect(() => {
        testRoiRepo.replaceAutoAllocations({
          characterId: CHAR_ID,
          allocations: [replacementAlloc],
        });
      }).toThrow('SIMULATED_DISK_WRITE_FAILURE');

      // 4. Verify Layer 1: In-memory repository Map rolled back to initial state
      const memoryAllocs = testRoiRepo.listAllocations(CHAR_ID);
      expect(memoryAllocs.length).toBe(1);
      expect(memoryAllocs[0].id).toBe('initial-alloc-1');
      expect(memoryAllocs[0].quantity_allocated).toBe(50);

      // 5. Verify Layer 2: Adapter internal state rolled back
      const adapterStateAllocs = adapter.getState().data.roi.allocations;
      expect(adapterStateAllocs.length).toBe(1);
      expect(adapterStateAllocs[0].id).toBe('initial-alloc-1');

      // 6. Verify Layer 3: Disk JSON untouched
      const rawDiskAfterFailure = JSON.parse(fs.readFileSync(tempStorePath, 'utf8'));
      expect(rawDiskAfterFailure.data.roi.allocations.length).toBe(1);
      expect(rawDiskAfterFailure.data.roi.allocations[0].id).toBe('initial-alloc-1');

      // 7. Verify Layer 4: Simulated server reboot / new repository instantiation
      adapter.persist = originalPersist;
      const rebootedAdapter = new DurableFileDatabaseAdapter(tempStorePath);
      rebootedAdapter.init();
      const rebootedLedgerRepo = new PersistentLedgerRepository(rebootedAdapter);
      const rebootedRoiRepo = new PersistentRoiRepository(rebootedLedgerRepo, rebootedAdapter);

      const rebootedAllocs = rebootedRoiRepo.listAllocations(CHAR_ID);
      expect(rebootedAllocs.length).toBe(1);
      expect(rebootedAllocs[0].id).toBe('initial-alloc-1');
      expect(rebootedAllocs[0].quantity_allocated).toBe(50);

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('repeated idempotent reconciliations maintain identical deterministic financial metrics', () => {
      // 1. Setup multi-character purchases and sales
      const char1Buy = makeTx({
        transactionId: 801,
        characterId: CHAR_ID,
        date: '2026-03-01T08:00:00Z',
        isBuy: true,
        locationId: 60003760,
        quantity: 100,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 5.0,
      });

      const char2Buy = makeTx({
        transactionId: 802,
        characterId: OTHER_CHAR_ID,
        date: '2026-03-01T08:30:00Z',
        isBuy: true,
        locationId: 60003760,
        quantity: 100,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 5.5,
      });

      const char1Sell = makeTx({
        transactionId: 803,
        characterId: CHAR_ID,
        date: '2026-03-01T12:00:00Z',
        isBuy: false,
        locationId: 60003760,
        quantity: 150,
        typeId: TRITANIUM_TYPE_ID,
        typeName: 'Tritanium',
        unitPrice: 8.0,
      });

      ledgerRepository.saveTransactions([char1Buy, char2Buy, char1Sell]);

      // First reconciliation across ecosystem
      const res1 = roiService.autoReconcileFifo({ characterIds: [CHAR_ID, OTHER_CHAR_ID] });
      const summary1 = roiService.getSummary({ character_ids: [CHAR_ID, OTHER_CHAR_ID] });

      expect(res1.allocations_created).toBe(2);
      expect(summary1.total_sales_volume).toBe(150);
      expect(summary1.allocated_sales_volume).toBe(150);
      expect(summary1.gross_revenue_isk).toBe(1200); // 150 * 8
      // Char 1 buy (100 * 5 = 500) + Char 2 buy (50 * 5.5 = 275) = 775
      expect(summary1.allocated_buy_cost_isk).toBe(775);
      expect(summary1.realized_profit_ttc_isk).toBe(425); // 1200 - 775

      // Second reconciliation run with identical input
      const res2 = roiService.autoReconcileFifo({ characterIds: [CHAR_ID, OTHER_CHAR_ID] });
      const summary2 = roiService.getSummary({ character_ids: [CHAR_ID, OTHER_CHAR_ID] });

      // Must produce identical allocation count and exact financial match
      expect(res2.allocations_created).toBe(2);
      expect(summary2.gross_revenue_isk).toBe(summary1.gross_revenue_isk);
      expect(summary2.allocated_buy_cost_isk).toBe(summary1.allocated_buy_cost_isk);
      expect(summary2.realized_profit_ttc_isk).toBe(summary1.realized_profit_ttc_isk);
      expect(summary2.roi_percent_ttc).toBe(summary1.roi_percent_ttc);
    });
  });
});

