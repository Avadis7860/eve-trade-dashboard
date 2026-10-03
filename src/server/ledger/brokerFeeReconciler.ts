import type {
  CharacterTransaction,
  CharacterWalletJournalEntry,
  BrokerFeeReconciliationDetail,
  BrokerFeeReconciliationSummary,
} from './types.ts';
import { makeJournalEntryKey } from './types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';

export class BrokerFeeReconciliationEngine {
  /**
   * Helper to check if a journal entry represents a broker fee event.
   */
  public static isBrokerFeeJournalEntry(jn: CharacterWalletJournalEntry): boolean {
    return (
      jn.refType === 'brokers_fee' ||
      jn.refType === 'broker_fee' ||
      jn.refType === 'contract_brokers_fee' ||
      jn.contextIdType === 'broker_fee'
    );
  }

  /**
   * Extract the broker fee amount (always positive) from a journal entry.
   */
  public static extractFeeAmount(jn: CharacterWalletJournalEntry): number {
    return Math.abs(jn.amount || 0);
  }

  /**
   * Reconciles broker fee journal entries with orders and market transactions deterministically.
   * Allocates buy/sell broker fees to executed transactions pro-rata,
   * while classifying unallocated / cancelled / orphan order fees into unallocated_broker_fees_isk.
   *
   * @param transactions All transactions in scope
   * @param journalEntries All candidate journal entries
   * @param orders All candidate order snapshots from orders repository
   * @returns Map of transaction key (`characterId:transactionId`) to `BrokerFeeReconciliationDetail`, related journal entries, and summary metrics.
   */
  public static reconcile(
    transactions: CharacterTransaction[],
    journalEntries: CharacterWalletJournalEntry[],
    orders: CharacterOrderSnapshot[]
  ): {
    reconciliations: Map<string, BrokerFeeReconciliationDetail>;
    transactionJournalEntries: Map<string, CharacterWalletJournalEntry[]>;
    summary: BrokerFeeReconciliationSummary;
  } {
    const reconciliations = new Map<string, BrokerFeeReconciliationDetail>();
    const transactionJournalEntries = new Map<string, CharacterWalletJournalEntry[]>();
    const allocatedJournalKeys = new Set<string>();

    const getTxKey = (tx: { characterId: number; transactionId: number }): string =>
      `${tx.characterId}:${tx.transactionId}`;

    const getJnKey = (jn: CharacterWalletJournalEntry): string =>
      jn.id || makeJournalEntryKey(jn);

    const addRelatedEntry = (txKey: string, entry: CharacterWalletJournalEntry) => {
      let list = transactionJournalEntries.get(txKey);
      if (!list) {
        list = [];
        transactionJournalEntries.set(txKey, list);
      }
      const entryKey = getJnKey(entry);
      if (!list.some((e) => getJnKey(e) === entryKey)) {
        list.push(entry);
      }
    };

    // Filter broker fee journal entries
    const brokerJns = journalEntries.filter((jn) => this.isBrokerFeeJournalEntry(jn));
    let totalBrokerFeesCollected = 0;
    for (const jn of brokerJns) {
      totalBrokerFeesCollected += this.extractFeeAmount(jn);
    }

    let reconciledOrderFees = 0;
    let allocatedBrokerFees = 0;
    let unallocatedBrokerFees = 0;

    // Index orders by `${characterId}:${orderId}` and by orderId alone
    const ordersByCharAndId = new Map<string, CharacterOrderSnapshot>();
    const ordersById = new Map<number, CharacterOrderSnapshot[]>();

    for (const order of orders) {
      const key = `${order.characterId}:${order.orderId}`;
      ordersByCharAndId.set(key, order);

      let list = ordersById.get(order.orderId);
      if (!list) {
        list = [];
        ordersById.set(order.orderId, list);
      }
      list.push(order);
    }

    // Index transactions by `${characterId}:${transactionId}`
    const txByCharAndId = new Map<string, CharacterTransaction>();
    // Index transactions by `${characterId}:${isBuy}:${typeId}` for fast lookup
    const txsByGroup = new Map<string, CharacterTransaction[]>();

    for (const tx of transactions) {
      txByCharAndId.set(getTxKey(tx), tx);
      const groupKey = `${tx.characterId}:${tx.isBuy ? '1' : '0'}:${tx.typeId}`;
      let list = txsByGroup.get(groupKey);
      if (!list) {
        list = [];
        txsByGroup.set(groupKey, list);
      }
      list.push(tx);
    }

    // =========================================================================
    // PASS 1: Direct Match (context_id == transaction_id or direct journalRefId)
    // =========================================================================
    for (const jn of brokerJns) {
      const jnKey = getJnKey(jn);
      if (allocatedJournalKeys.has(jnKey)) continue;

      let matchedTx: CharacterTransaction | undefined;

      // 1.1 Context ID equals transactionId for the same character
      if (jn.contextId !== undefined && jn.contextId !== null) {
        const directKey = `${jn.characterId}:${jn.contextId}`;
        const candidateTx = txByCharAndId.get(directKey);
        if (candidateTx) {
          matchedTx = candidateTx;
        }
      }

      // 1.2 journalRefId direct link on transaction
      if (!matchedTx) {
        for (const tx of transactions) {
          if (tx.characterId === jn.characterId && tx.journalRefId === jn.journalId) {
            matchedTx = tx;
            break;
          }
        }
      }

      if (matchedTx) {
        const txKey = getTxKey(matchedTx);
        const feeAmount = this.extractFeeAmount(jn);
        const roundedFee = Math.round((feeAmount + Number.EPSILON) * 100) / 100;

        allocatedJournalKeys.add(jnKey);
        allocatedBrokerFees += roundedFee;
        reconciledOrderFees += roundedFee;

        const existingRec = reconciliations.get(txKey);
        const currentAmount = existingRec ? existingRec.allocatedFeeAmount : 0;
        const totalAmount = Math.round((currentAmount + roundedFee + Number.EPSILON) * 100) / 100;

        reconciliations.set(txKey, {
          status: 'EXACT_TRANSACTION',
          allocatedFeeAmount: totalAmount,
          transactionQuantity: matchedTx.quantity,
          justification: `Direct journal reference match (journal #${jn.journalId})`,
        });
        addRelatedEntry(txKey, jn);
      }
    }

    // =========================================================================
    // PASS 2: Order-Based Pro-Rata Matching
    // =========================================================================
    // Group remaining broker fee journal entries by order (characterId + orderId)
    const jnsByOrderKey = new Map<string, CharacterWalletJournalEntry[]>();

    for (const jn of brokerJns) {
      const jnKey = getJnKey(jn);
      if (allocatedJournalKeys.has(jnKey)) continue;

      if (jn.contextId !== undefined && jn.contextId !== null && jn.contextId > 0) {
        const orderKey = `${jn.characterId}:${jn.contextId}`;
        let list = jnsByOrderKey.get(orderKey);
        if (!list) {
          list = [];
          jnsByOrderKey.set(orderKey, list);
        }
        list.push(jn);
      }
    }

    // Track available quantity per transaction to prevent double-matching
    const txRemainingQty = new Map<string, number>();
    for (const tx of transactions) {
      txRemainingQty.set(getTxKey(tx), tx.quantity);
    }

    // Build ordered list of order groups sorted chronologically by order issued date
    const orderGroups: { orderKey: string; orderJns: CharacterWalletJournalEntry[]; order?: CharacterOrderSnapshot }[] = [];
    for (const [orderKey, orderJns] of jnsByOrderKey.entries()) {
      let order = ordersByCharAndId.get(orderKey);
      if (!order && orderJns.length > 0) {
        const orderId = orderJns[0].contextId!;
        const candidates = ordersById.get(orderId);
        if (candidates && candidates.length > 0) {
          order = candidates[0];
        }
      }
      orderGroups.push({ orderKey, orderJns, order });
    }

    orderGroups.sort((a, b) => {
      const timeA = a.order ? new Date(a.order.issued).getTime() : 0;
      const timeB = b.order ? new Date(b.order.issued).getTime() : 0;
      return timeA - timeB;
    });

    // For each order group, find candidate transactions and prorate fees
    for (const { orderJns, order } of orderGroups) {
      const totalOrderFee = orderJns.reduce((acc, j) => acc + this.extractFeeAmount(j), 0);
      const roundedOrderFee = Math.round((totalOrderFee + Number.EPSILON) * 100) / 100;

      if (!order) {
        // Order not found in snapshots: classify entire fee as unallocated
        unallocatedBrokerFees += roundedOrderFee;
        for (const jn of orderJns) {
          allocatedJournalKeys.add(getJnKey(jn));
        }
        continue;
      }

      // Mark order as reconciled
      reconciledOrderFees += roundedOrderFee;
      for (const jn of orderJns) {
        allocatedJournalKeys.add(getJnKey(jn));
      }

      // Find candidate transactions for this order
      const groupKey = `${order.characterId}:${order.isBuyOrder ? '1' : '0'}:${order.typeId}`;
      const candidateTxs = (txsByGroup.get(groupKey) || []).filter((tx) => {
        // Must match location if provided
        if (order!.locationId && tx.locationId && tx.locationId !== order!.locationId) {
          return false;
        }

        // Must fall within order lifespan
        const txTime = new Date(tx.date).getTime();
        const orderIssued = new Date(order!.issued).getTime();
        if (txTime < orderIssued - 5000) {
          return false;
        }

        if (order!.expiresAt) {
          const orderExpires = new Date(order!.expiresAt).getTime();
          if (txTime > orderExpires + 86400000) {
            return false;
          }
        } else if (order!.duration) {
          const maxExpiry = orderIssued + (order!.duration + 1) * 86400000;
          if (txTime > maxExpiry) {
            return false;
          }
        }

        return true;
      });

      // Sort candidate transactions chronologically
      candidateTxs.sort((a, b) => {
        const timeDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.transactionId - b.transactionId;
      });

      let orderAllocatedQty = 0;
      let orderAllocatedFee = 0;
      const orderTotalVol = order.volumeTotal > 0 ? order.volumeTotal : 1;

      for (const tx of candidateTxs) {
        if (orderAllocatedQty >= order.volumeTotal) break;

        const txKey = getTxKey(tx);
        const existingRec = reconciliations.get(txKey);
        // Skip if already has an EXACT match
        if (existingRec && existingRec.status === 'EXACT_TRANSACTION') continue;

        const availableTxQty = txRemainingQty.get(txKey) ?? tx.quantity;
        if (availableTxQty <= 0) continue;

        const availableOrderVol = order.volumeTotal - orderAllocatedQty;
        const matchedQty = Math.min(availableTxQty, availableOrderVol);
        if (matchedQty <= 0) continue;

        txRemainingQty.set(txKey, availableTxQty - matchedQty);

        const ratio = matchedQty / orderTotalVol;
        const txShareFee = Math.round(((totalOrderFee * ratio) + Number.EPSILON) * 100) / 100;

        orderAllocatedQty += matchedQty;
        orderAllocatedFee += txShareFee;

        const currentTxFee = existingRec ? existingRec.allocatedFeeAmount : 0;
        const combinedTxFee = Math.round((currentTxFee + txShareFee + Number.EPSILON) * 100) / 100;

        reconciliations.set(txKey, {
          status: 'ORDER_PRO_RATA',
          orderId: order.orderId,
          totalOrderFee: roundedOrderFee,
          orderVolumeTotal: order.volumeTotal,
          orderVolumeFilled: order.volumeFilled,
          transactionQuantity: tx.quantity,
          allocatedFeeAmount: combinedTxFee,
          justification: `Matched to order #${order.orderId} (pro-rata ${matchedQty}/${order.volumeTotal} = ${(ratio * 100).toFixed(1)}%)`,
        });

        for (const jn of orderJns) {
          addRelatedEntry(txKey, jn);
        }
      }

      orderAllocatedFee = Math.round((orderAllocatedFee + Number.EPSILON) * 100) / 100;
      allocatedBrokerFees += orderAllocatedFee;

      const orderUnallocatedFee = Math.max(0, Math.round((roundedOrderFee - orderAllocatedFee + Number.EPSILON) * 100) / 100);
      unallocatedBrokerFees += orderUnallocatedFee;
    }

    // =========================================================================
    // PASS 3: Remaining Unallocated Broker Fee Entries (Orphans / Null context)
    // =========================================================================
    for (const jn of brokerJns) {
      const jnKey = getJnKey(jn);
      if (!allocatedJournalKeys.has(jnKey)) {
        const feeAmount = this.extractFeeAmount(jn);
        unallocatedBrokerFees += Math.round((feeAmount + Number.EPSILON) * 100) / 100;
        allocatedJournalKeys.add(jnKey);
      }
    }

    // =========================================================================
    // PASS 4: Default UNMATCHED for any remaining transaction
    // =========================================================================
    for (const tx of transactions) {
      const txKey = getTxKey(tx);
      if (!reconciliations.has(txKey)) {
        reconciliations.set(txKey, {
          status: 'UNMATCHED',
          allocatedFeeAmount: 0,
          transactionQuantity: tx.quantity,
          justification: tx.isBuy
            ? 'Immediate market buy or unlinked order'
            : 'Immediate market sell or unlinked order',
        });
      }
    }

    // Final invariance rounding
    totalBrokerFeesCollected = Math.round((totalBrokerFeesCollected + Number.EPSILON) * 100) / 100;
    reconciledOrderFees = Math.round((reconciledOrderFees + Number.EPSILON) * 100) / 100;
    allocatedBrokerFees = Math.round((allocatedBrokerFees + Number.EPSILON) * 100) / 100;
    unallocatedBrokerFees = Math.round((unallocatedBrokerFees + Number.EPSILON) * 100) / 100;

    // Enforce invariant: allocated + unallocated == totalCollected
    const diff = Math.round((totalBrokerFeesCollected - (allocatedBrokerFees + unallocatedBrokerFees) + Number.EPSILON) * 100) / 100;
    if (Math.abs(diff) > 0 && Math.abs(diff) < 0.05) {
      unallocatedBrokerFees = Math.round((unallocatedBrokerFees + diff + Number.EPSILON) * 100) / 100;
    }

    const summary: BrokerFeeReconciliationSummary = {
      totalBrokerFeesCollectedIsk: totalBrokerFeesCollected,
      reconciledOrderFeesIsk: reconciledOrderFees,
      allocatedBrokerFeesIsk: allocatedBrokerFees,
      unallocatedBrokerFeesIsk: unallocatedBrokerFees,
    };

    return { reconciliations, transactionJournalEntries, summary };
  }
}
