import type {
  CharacterTransaction,
  CharacterWalletJournalEntry,
  TaxReconciliationDetail,
} from './types.ts';
import { makeJournalEntryKey } from './types.ts';

export class TaxReconciliationEngine {
  /**
   * Helper to check if a journal entry represents a sales tax event.
   */
  public static isTaxJournalEntry(jn: CharacterWalletJournalEntry): boolean {
    return (
      jn.refType === 'transaction_tax' ||
      jn.refType === 'market_tax' ||
      jn.refType === 'contract_sales_tax' ||
      jn.contextIdType === 'transaction_tax'
    );
  }

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
   * Helper to check if a journal entry represents a market transaction event.
   */
  public static isMarketJournalEntry(jn: CharacterWalletJournalEntry): boolean {
    return jn.refType === 'market_transaction';
  }

  /**
   * Extract the tax amount from a journal entry.
   */
  public static extractTaxAmount(jn: CharacterWalletJournalEntry): number {
    if (jn.tax !== undefined && jn.tax > 0) {
      return jn.tax;
    }
    return Math.abs(jn.amount || 0);
  }

  /**
   * Reconciles a set of transactions with journal entries deterministically.
   * Enforces strict 1-to-1 unique allocation of each tax journal entry with O(N log N) indexation.
   *
   * @param transactions All transactions to reconcile
   * @param journalEntries All candidate journal entries
   * @returns Map of transaction key (`characterId:transactionId`) to `TaxReconciliationDetail` and matched journal entries.
   */
  public static reconcile(
    transactions: CharacterTransaction[],
    journalEntries: CharacterWalletJournalEntry[]
  ): {
    reconciliations: Map<string, TaxReconciliationDetail>;
    transactionJournalEntries: Map<string, CharacterWalletJournalEntry[]>;
  } {
    const reconciliations = new Map<string, TaxReconciliationDetail>();
    const transactionJournalEntries = new Map<string, CharacterWalletJournalEntry[]>();
    const allocatedTaxJournalKeys = new Set<string>();

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

    // =========================================================================
    // INDEXATION: Build fast O(1) secondary lookup maps for journal entries
    // =========================================================================
    // Map characterId -> Map<journalId, CharacterWalletJournalEntry>
    const jnByCharAndJournalId = new Map<number, Map<number, CharacterWalletJournalEntry>>();
    // Map characterId -> Map<contextId, CharacterWalletJournalEntry[]>
    const jnByCharAndContextId = new Map<number, Map<number, CharacterWalletJournalEntry[]>>();
    // Tax journal entries by character: Map<characterId, CharacterWalletJournalEntry[]>
    const taxJnsByChar = new Map<number, CharacterWalletJournalEntry[]>();
    // Tax journal entries by character and journalId: Map<characterId, Map<number, CharacterWalletJournalEntry>>
    const taxJnByCharAndId = new Map<number, Map<number, CharacterWalletJournalEntry>>();

    for (let i = 0; i < journalEntries.length; i++) {
      const jn = journalEntries[i];
      const charId = jn.characterId || 0;

      // Index by journalId
      let byId = jnByCharAndJournalId.get(charId);
      if (!byId) {
        byId = new Map();
        jnByCharAndJournalId.set(charId, byId);
      }
      byId.set(jn.journalId, jn);

      // Index by contextId
      if (jn.contextId !== undefined && jn.contextId !== null) {
        let byCtx = jnByCharAndContextId.get(charId);
        if (!byCtx) {
          byCtx = new Map();
          jnByCharAndContextId.set(charId, byCtx);
        }
        let list = byCtx.get(jn.contextId);
        if (!list) {
          list = [];
          byCtx.set(jn.contextId, list);
        }
        list.push(jn);
      }

      // Index tax entries
      if (this.isTaxJournalEntry(jn)) {
        let taxList = taxJnsByChar.get(charId);
        if (!taxList) {
          taxList = [];
          taxJnsByChar.set(charId, taxList);
        }
        taxList.push(jn);

        let taxById = taxJnByCharAndId.get(charId);
        if (!taxById) {
          taxById = new Map();
          taxJnByCharAndId.set(charId, taxById);
        }
        taxById.set(jn.journalId, jn);
      }
    }

    // Attach direct broker fees and direct market transaction entries first for all transactions
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      const txKey = getTxKey(tx);
      const byCtx = jnByCharAndContextId.get(tx.characterId);
      const byId = jnByCharAndJournalId.get(tx.characterId);

      // Entries matching transactionId
      if (byCtx) {
        const ctxMatches = byCtx.get(tx.transactionId);
        if (ctxMatches) {
          for (let j = 0; j < ctxMatches.length; j++) {
            const jn = ctxMatches[j];
            if (this.isBrokerFeeJournalEntry(jn) || this.isMarketJournalEntry(jn)) {
              addRelatedEntry(txKey, jn);
            }
          }
        }
      }

      // Entries matching journalRefId
      if (tx.journalRefId > 0 && byId) {
        const refMatch = byId.get(tx.journalRefId);
        if (refMatch && (this.isBrokerFeeJournalEntry(refMatch) || this.isMarketJournalEntry(refMatch))) {
          addRelatedEntry(txKey, refMatch);
        }
      }
    }

    // Mark Buy transactions as UNMATCHED (Sales tax not applicable)
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (tx.isBuy) {
        const txKey = getTxKey(tx);
        reconciliations.set(txKey, {
          status: 'UNMATCHED',
          taxAmount: 0,
          justification: 'Buy transaction: sales tax not applicable',
        });
      }
    }

    // Filter sell transactions
    const sellTxs = transactions.filter((tx) => !tx.isBuy);

    // =========================================================================
    // PASS 1: Exact & Direct Match (context_id == transaction_id or direct ref)
    // =========================================================================
    for (let i = 0; i < sellTxs.length; i++) {
      const tx = sellTxs[i];
      const txKey = getTxKey(tx);
      if (reconciliations.has(txKey)) continue;

      const byCtx = jnByCharAndContextId.get(tx.characterId);
      const byId = jnByCharAndJournalId.get(tx.characterId);

      // Check context_id == tx.transactionId
      let matchedTaxJn: CharacterWalletJournalEntry | undefined;

      if (byCtx) {
        const ctxMatches = byCtx.get(tx.transactionId);
        if (ctxMatches) {
          for (let j = 0; j < ctxMatches.length; j++) {
            const jn = ctxMatches[j];
            if (this.isTaxJournalEntry(jn) && !allocatedTaxJournalKeys.has(getJnKey(jn))) {
              matchedTaxJn = jn;
              break;
            }
          }
        }
      }

      // Check direct journalRefId matching a tax journal entry
      if (!matchedTaxJn && tx.journalRefId > 0 && byId) {
        const refMatch = byId.get(tx.journalRefId);
        if (refMatch && this.isTaxJournalEntry(refMatch) && !allocatedTaxJournalKeys.has(getJnKey(refMatch))) {
          matchedTaxJn = refMatch;
        }
      }

      if (matchedTaxJn) {
        allocatedTaxJournalKeys.add(getJnKey(matchedTaxJn));
        const taxAmount = this.extractTaxAmount(matchedTaxJn);
        const roundedTax = Math.round((taxAmount + Number.EPSILON) * 100) / 100;
        const taxRate = tx.totalValue > 0 ? Math.round(((roundedTax / tx.totalValue) + Number.EPSILON) * 10000) / 10000 : undefined;

        reconciliations.set(txKey, {
          status: 'EXACT_MATCH',
          matchedJournalId: matchedTaxJn.journalId,
          taxAmount: roundedTax,
          taxRate,
          justification: `Direct context_id or journal reference match (journal #${matchedTaxJn.journalId})`,
        });
        addRelatedEntry(txKey, matchedTaxJn);
      }
    }

    // =========================================================================
    // PASS 2: CCP Sequential M + 1 Match (tax.journal_id == mkt.journal_id + 1)
    // =========================================================================
    for (let i = 0; i < sellTxs.length; i++) {
      const tx = sellTxs[i];
      const txKey = getTxKey(tx);
      if (reconciliations.has(txKey)) continue;

      const taxById = taxJnByCharAndId.get(tx.characterId);
      if (!taxById) continue;

      let marketJournalId = tx.journalRefId > 0 ? tx.journalRefId : undefined;
      let marketJnDate: string | undefined = undefined;

      if (!marketJournalId) {
        const byCtx = jnByCharAndContextId.get(tx.characterId);
        if (byCtx) {
          const ctxMatches = byCtx.get(tx.transactionId);
          if (ctxMatches) {
            const mkt = ctxMatches.find((j) => this.isMarketJournalEntry(j));
            if (mkt) {
              marketJournalId = mkt.journalId;
              marketJnDate = mkt.date;
              addRelatedEntry(txKey, mkt);
            }
          }
        }
      }

      if (marketJournalId) {
        const expectedTaxJournalId = marketJournalId + 1;
        const candidateTaxJn = taxById.get(expectedTaxJournalId);

        if (candidateTaxJn && !allocatedTaxJournalKeys.has(getJnKey(candidateTaxJn))) {
          const txTime = new Date(tx.date).getTime();
          const jnTime = new Date(candidateTaxJn.date).getTime();
          const isDateCoherent = Math.abs(jnTime - txTime) <= 3000 || (marketJnDate !== undefined && candidateTaxJn.date === marketJnDate);
          const taxAmt = this.extractTaxAmount(candidateTaxJn);
          const ratio = tx.totalValue > 0 ? taxAmt / tx.totalValue : 0;
          const isRateCoherent = tx.totalValue <= 0 || (ratio >= 0.01 && ratio <= 0.15);

          if (isDateCoherent && isRateCoherent) {
            allocatedTaxJournalKeys.add(getJnKey(candidateTaxJn));
            const roundedTax = Math.round((taxAmt + Number.EPSILON) * 100) / 100;
            const taxRate = tx.totalValue > 0 ? Math.round(((roundedTax / tx.totalValue) + Number.EPSILON) * 10000) / 10000 : undefined;

            reconciliations.set(txKey, {
              status: 'SEQUENTIAL_M_PLUS_1',
              matchedJournalId: candidateTaxJn.journalId,
              taxAmount: roundedTax,
              taxRate,
              justification: `Matched via CCP sequential M+1 pattern (market journal #${marketJournalId} -> tax journal #${candidateTaxJn.journalId})`,
            });
            addRelatedEntry(txKey, candidateTaxJn);
          }
        }
      }
    }

    // =========================================================================
    // PASS 3: Bijective Unambiguous Correlation under Strict Exclusivity
    // Group unallocated sells & unallocated taxes by time buckets for O(N log N) cohort pairing
    // =========================================================================
    const unallocatedSells = sellTxs.filter((tx) => !reconciliations.has(getTxKey(tx)));

    // Group unallocated sells by characterId and 5-second time window bucket
    const sellsByCharAndTime = new Map<number, Map<number, CharacterTransaction[]>>();
    for (let i = 0; i < unallocatedSells.length; i++) {
      const tx = unallocatedSells[i];
      const bucket = Math.floor(new Date(tx.date).getTime() / 5000);
      let charBuckets = sellsByCharAndTime.get(tx.characterId);
      if (!charBuckets) {
        charBuckets = new Map();
        sellsByCharAndTime.set(tx.characterId, charBuckets);
      }
      let list = charBuckets.get(bucket);
      if (!list) {
        list = [];
        charBuckets.set(bucket, list);
      }
      list.push(tx);
    }

    for (const [charId, charBuckets] of sellsByCharAndTime.entries()) {
      const allTaxJns = taxJnsByChar.get(charId) || [];
      const unallocatedTaxes = allTaxJns.filter((jn) => !allocatedTaxJournalKeys.has(getJnKey(jn)));

      for (const [bucket, bucketTxs] of charBuckets.entries()) {
        const bucketTime = bucket * 5000;
        const candidateTaxes = unallocatedTaxes.filter((jn) => {
          if (allocatedTaxJournalKeys.has(getJnKey(jn))) return false;
          const jnTime = new Date(jn.date).getTime();
          return Math.abs(jnTime - bucketTime) <= 7000;
        });

        if (candidateTaxes.length === 0) continue;

        // Sort transactions by totalValue DESC, then transactionId ASC
        bucketTxs.sort((a, b) => {
          const valDiff = b.totalValue - a.totalValue;
          if (valDiff !== 0) return valDiff;
          return a.transactionId - b.transactionId;
        });

        // Sort candidate taxes by extracted tax amount DESC, then journalId ASC
        candidateTaxes.sort((a, b) => {
          const valDiff = TaxReconciliationEngine.extractTaxAmount(b) - TaxReconciliationEngine.extractTaxAmount(a);
          if (valDiff !== 0) return valDiff;
          return a.journalId - b.journalId;
        });

        const pairCount = Math.min(bucketTxs.length, candidateTaxes.length);
        for (let i = 0; i < pairCount; i++) {
          const tx = bucketTxs[i];
          const txKey = getTxKey(tx);
          if (reconciliations.has(txKey)) continue;

          const taxJn = candidateTaxes[i];
          if (allocatedTaxJournalKeys.has(getJnKey(taxJn))) continue;

          const taxAmt = this.extractTaxAmount(taxJn);
          const ratio = tx.totalValue > 0 ? taxAmt / tx.totalValue : 0;
          const isRateCoherent = tx.totalValue <= 0 || (ratio >= 0.01 && ratio <= 0.15);

          if (isRateCoherent) {
            allocatedTaxJournalKeys.add(getJnKey(taxJn));
            const roundedTax = Math.round((taxAmt + Number.EPSILON) * 100) / 100;
            const taxRate = tx.totalValue > 0 ? Math.round(((roundedTax / tx.totalValue) + Number.EPSILON) * 10000) / 10000 : undefined;

            reconciliations.set(txKey, {
              status: 'CORRELATED_BIJECTIVE',
              matchedJournalId: taxJn.journalId,
              taxAmount: roundedTax,
              taxRate,
              justification: `Bijective correlation by value and timestamp (journal #${taxJn.journalId})`,
            });
            addRelatedEntry(txKey, taxJn);
          }
        }
      }
    }

    // =========================================================================
    // FINAL PASS: Any remaining sell transaction without an attributed tax entry
    // =========================================================================
    for (let i = 0; i < sellTxs.length; i++) {
      const tx = sellTxs[i];
      const txKey = getTxKey(tx);
      if (!reconciliations.has(txKey)) {
        reconciliations.set(txKey, {
          status: 'UNMATCHED',
          taxAmount: 0,
          justification: 'Unmatched: no unallocated journal tax entry verifiable in ledger',
        });
      }
    }

    return { reconciliations, transactionJournalEntries };
  }
}
