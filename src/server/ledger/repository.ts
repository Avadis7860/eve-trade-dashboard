import type {
  CharacterTransaction,
  CharacterWalletJournalEntry,
  LedgerQueryFilters,
  PaginatedLedgerResult,
  LedgerSummary,
  LedgerFilterOptions,
} from './types.ts';

export interface ILedgerRepository {
  saveTransactions(transactions: CharacterTransaction[]): { inserted: number; updated: number };
  getTransactions(filters: LedgerQueryFilters): PaginatedLedgerResult<CharacterTransaction>;
  getAllTransactions(characterId?: number, characterIds?: number[]): CharacterTransaction[];
  getTransactionById(characterId: number, transactionId: number): CharacterTransaction | null;
  getJournalEntriesForTransaction(
    characterId: number,
    transactionId: number,
    journalRefId?: number,
    txDate?: string,
    txTotalValue?: number,
    isBuy?: boolean
  ): { tax: number; brokerFee: number; entries: CharacterWalletJournalEntry[] };
  countTransactions(characterId: number): number;
  saveJournalEntries(entries: CharacterWalletJournalEntry[]): { inserted: number; updated: number };
  getJournalEntries(characterId?: number, page?: number, pageSize?: number): { items: CharacterWalletJournalEntry[]; total: number };
  getJournalEntryById(characterId: number, journalId: number): CharacterWalletJournalEntry | null;
  getSummary(characterId?: number, characterIds?: number[]): LedgerSummary;
  getFilterOptions(characterId: number): LedgerFilterOptions;
  clearCharacter(characterId: number): void;
  dumpData(): { transactions: CharacterTransaction[]; journalEntries: CharacterWalletJournalEntry[] };
  restoreData(data: { transactions: CharacterTransaction[]; journalEntries: CharacterWalletJournalEntry[] }): void;
}

export class InMemoryLedgerRepository implements ILedgerRepository {
  // Map of composite key -> transaction
  private transactions: Map<string, CharacterTransaction> = new Map();
  // Map of composite key -> journal entry
  private journalEntries: Map<string, CharacterWalletJournalEntry> = new Map();

  /**
   * Generates unique composite key ensuring strict character isolation
   */
  private makeTxKey(characterId: number, transactionId: number): string {
    return `${characterId}:${transactionId}`;
  }

  private makeJournalKey(characterId: number, journalId: number): string {
    return `${characterId}:${journalId}`;
  }

  /**
   * Persists transactions idempotently. Re-importing identical transactions will not create duplicates.
   */
  public saveTransactions(transactions: CharacterTransaction[]): { inserted: number; updated: number } {
    let inserted = 0;
    let updated = 0;

    for (const tx of transactions) {
      const key = this.makeTxKey(tx.characterId, tx.transactionId);
      if (this.transactions.has(key)) {
        // Update with fresh resolution data if available
        const existing = this.transactions.get(key)!;
        this.transactions.set(key, {
          ...existing,
          ...tx,
          // Preserve first observation time
          observedAt: existing.observedAt,
        });
        updated++;
      } else {
        this.transactions.set(key, tx);
        inserted++;
      }
    }

    return { inserted, updated };
  }

  /**
   * Returns single transaction by ID for a specific character enriched with tax and fees
   */
  public getTransactionById(characterId: number, transactionId: number): CharacterTransaction | null {
    const key = this.makeTxKey(characterId, transactionId);
    const tx = this.transactions.get(key);
    if (!tx) return null;
    return this.enrichTransaction(tx);
  }

  /**
   * Directly resolves linked tax and broker fee journal entries for a given transaction.
   * In EVE Online:
   * 1. A sale transaction has `journalRefId` pointing to the `market_transaction` entry.
   * 2. The sales tax paid to the SCC is recorded in a separate `transaction_tax` entry with negative amount.
   *    In ESI, `transaction_tax` does not always populate `contextId` with the `transactionId`.
   *    However, it has the exact same timestamp (or within +/- 3 seconds) and is in the same journal sequence.
   */
  public getJournalEntriesForTransaction(
    characterId: number,
    transactionId: number,
    journalRefId?: number,
    txDate?: string,
    txTotalValue?: number,
    isBuy?: boolean
  ): { tax: number; brokerFee: number; entries: CharacterWalletJournalEntry[] } {
    let tax = 0;
    let brokerFee = 0;
    let dedicatedTaxFound = false;
    let fallbackTax = 0;
    const entries: CharacterWalletJournalEntry[] = [];

    // Pass 1: Direct ID matches (contextId === transactionId, contextId === journalRefId, or journalId === journalRefId)
    for (const jn of this.journalEntries.values()) {
      if (jn.characterId !== characterId) continue;

      const matchesTxId = jn.contextId !== undefined && Number(jn.contextId) === Number(transactionId);
      const matchesRefId = journalRefId !== undefined && Number(jn.journalId) === Number(journalRefId);
      const matchesContextRef = jn.contextId !== undefined && journalRefId !== undefined && Number(jn.contextId) === Number(journalRefId);
      const isTaxRef = jn.refType === 'transaction_tax' || jn.refType === 'market_tax' || jn.refType === 'contract_sales_tax' || jn.contextIdType === 'transaction_tax';
      const isBrokerRef = jn.refType === 'brokers_fee' || jn.refType === 'broker_fee' || jn.refType === 'contract_brokers_fee' || jn.contextIdType === 'broker_fee';

      if (matchesTxId || matchesRefId || matchesContextRef) {
        if (isTaxRef) {
          const taxAmt = jn.tax !== undefined && jn.tax > 0 ? jn.tax : Math.abs(jn.amount || 0);
          tax += taxAmt;
          dedicatedTaxFound = true;
          entries.push(jn);
        } else if (isBrokerRef) {
          const feeAmt = Math.abs(jn.amount || 0);
          brokerFee += feeAmt;
          entries.push(jn);
        } else if (jn.refType === 'market_transaction') {
          if (jn.tax !== undefined && jn.tax > 0) {
            fallbackTax = jn.tax;
          }
          entries.push(jn);
        } else if (jn.tax !== undefined && jn.tax > 0) {
          fallbackTax = jn.tax;
          entries.push(jn);
        }
      }
    }

    // Pass 2: If this is a sale and tax wasn't matched via direct ID,
    // correlate by journalRefId proximity or timestamp (Sales tax paid to the SCC)
    if (!dedicatedTaxFound && isBuy === false) {
      const txTime = txDate ? new Date(txDate).getTime() : 0;
      for (const jn of this.journalEntries.values()) {
        if (jn.characterId !== characterId) continue;
        const isTaxRef = jn.refType === 'transaction_tax' || jn.refType === 'market_tax' || jn.refType === 'contract_sales_tax';
        if (!isTaxRef) continue;

        // Proximity by journalId (adjacent entry in journal sequence)
        const isAdjacentId = journalRefId !== undefined && Math.abs(jn.journalId - journalRefId) <= 10;

        // Proximity by date (within +/- 3 seconds)
        const jnTime = new Date(jn.date).getTime();
        const isTimeMatch = txTime > 0 && Math.abs(jnTime - txTime) <= 3000;

        if (isAdjacentId || isTimeMatch) {
          const taxAmt = jn.tax !== undefined && jn.tax > 0 ? jn.tax : Math.abs(jn.amount || 0);
          if (txTotalValue !== undefined && txTotalValue > 0) {
            const ratio = taxAmt / txTotalValue;
            // Standard EVE Online sales tax rates range between 3.375% (Accounting V) and 8%
            if (ratio >= 0.02 && ratio <= 0.12) {
              tax += taxAmt;
              dedicatedTaxFound = true;
              entries.push(jn);
              break;
            }
          } else {
            tax += taxAmt;
            dedicatedTaxFound = true;
            entries.push(jn);
            break;
          }
        }
      }
    }

    if (!dedicatedTaxFound && fallbackTax > 0) {
      tax += fallbackTax;
    }

    tax = Math.round((tax + Number.EPSILON) * 100) / 100;
    brokerFee = Math.round((brokerFee + Number.EPSILON) * 100) / 100;

    return { tax, brokerFee, entries };
  }

  /**
   * Enriches a transaction with resolved tax, brokerFee, and netValue
   */
  public enrichTransaction(tx: CharacterTransaction): CharacterTransaction {
    const { tax, brokerFee } = this.getJournalEntriesForTransaction(
      tx.characterId,
      tx.transactionId,
      tx.journalRefId,
      tx.date,
      tx.totalValue,
      tx.isBuy
    );
    const netValue = tx.isBuy
      ? Math.round(((tx.totalValue + brokerFee) + Number.EPSILON) * 100) / 100
      : Math.round(((tx.totalValue - tax - brokerFee) + Number.EPSILON) * 100) / 100;

    return {
      ...tx,
      tax,
      brokerFee,
      netValue,
    };
  }

  /**
   * Returns total transaction count for a character
   */
  public countTransactions(characterId: number): number {
    let count = 0;
    for (const tx of this.transactions.values()) {
      if (tx.characterId === characterId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Retrieves filtered and paginated transactions with full summaries
   */
  public getTransactions(filters: LedgerQueryFilters): PaginatedLedgerResult<CharacterTransaction> {
    const {
      characterId,
      type = 'ALL',
      typeId,
      search,
      locationId,
      fromDate,
      toDate,
      sortBy = 'date',
      sortOrder = 'desc',
      page = 1,
      pageSize = 50,
    } = filters;

    // 1. Filter by character and criteria
    const matched: CharacterTransaction[] = [];
    const searchLower = search ? search.trim().toLowerCase() : '';
    const fromTime = fromDate ? new Date(fromDate).getTime() : -Infinity;
    const toTime = toDate ? new Date(toDate).getTime() : Infinity;

    for (const tx of this.transactions.values()) {
      if (characterId !== undefined && tx.characterId !== characterId) {
        continue;
      }

      // Filter by type (ALL, SELL, BUY)
      if (type === 'SELL' && tx.isBuy) continue;
      if (type === 'BUY' && !tx.isBuy) continue;

      // Filter by typeId
      if (typeId !== undefined && tx.typeId !== typeId) continue;

      // Filter by locationId
      if (locationId !== undefined && tx.locationId !== locationId) continue;

      // Filter by date range
      const txTime = new Date(tx.date).getTime();
      if (txTime < fromTime || txTime > toTime) continue;

      // Filter by search string (typeName, clientName, locationName, transactionId)
      if (searchLower) {
        const matchesName = tx.typeName?.toLowerCase().includes(searchLower);
        const matchesLocation = tx.locationName?.toLowerCase().includes(searchLower);
        const matchesClient = tx.clientName?.toLowerCase().includes(searchLower);
        const matchesTxId = String(tx.transactionId).includes(searchLower);
        const matchesTypeId = String(tx.typeId).includes(searchLower);

        if (!matchesName && !matchesLocation && !matchesClient && !matchesTxId && !matchesTypeId) {
          continue;
        }
      }

      matched.push(tx);
    }

    // 2. Sort
    matched.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'totalValue':
          comparison = a.totalValue - b.totalValue;
          break;
        case 'unitPrice':
          comparison = a.unitPrice - b.unitPrice;
          break;
        case 'quantity':
          comparison = a.quantity - b.quantity;
          break;
        case 'typeName':
          comparison = (a.typeName || '').localeCompare(b.typeName || '');
          break;
        default:
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // 3. Paginate & Enrich
    const total = matched.length;
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const totalPages = Math.max(1, Math.ceil(total / validPageSize));
    const offset = (validPage - 1) * validPageSize;
    const paginatedItems = matched.slice(offset, offset + validPageSize).map((tx) => this.enrichTransaction(tx));

    // 4. Calculate Summary
    const summary = this.getSummary(characterId);

    return {
      items: paginatedItems,
      total,
      page: validPage,
      pageSize: validPageSize,
      totalPages,
      filters,
      summary,
      asOf: Date.now(),
      freshness: 'FRESH',
    };
  }

  /**
   * Persists wallet journal entries idempotently
   */
  public saveJournalEntries(entries: CharacterWalletJournalEntry[]): { inserted: number; updated: number } {
    let inserted = 0;
    let updated = 0;

    for (const entry of entries) {
      const key = this.makeJournalKey(entry.characterId, entry.journalId);
      if (this.journalEntries.has(key)) {
        this.journalEntries.set(key, entry);
        updated++;
      } else {
        this.journalEntries.set(key, entry);
        inserted++;
      }
    }

    return { inserted, updated };
  }

  /**
   * Retrieves paginated journal entries for a character
   */
  public getJournalEntries(
    characterId?: number,
    page = 1,
    pageSize = 50
  ): { items: CharacterWalletJournalEntry[]; total: number } {
    const matched: CharacterWalletJournalEntry[] = [];

    for (const entry of this.journalEntries.values()) {
      if (characterId !== undefined && entry.characterId !== characterId) {
        continue;
      }
      matched.push(entry);
    }

    // Sort by date desc
    matched.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const total = matched.length;
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const offset = (validPage - 1) * validPageSize;
    const items = matched.slice(offset, offset + validPageSize);

    return { items, total };
  }

  /**
   * Returns single journal entry
   */
  public getJournalEntryById(characterId: number, journalId: number): CharacterWalletJournalEntry | null {
    const key = this.makeJournalKey(characterId, journalId);
    return this.journalEntries.get(key) || null;
  }

  /**
   * Retrieves all transactions without pagination limits, optionally filtered by character or list of characters
   */
  public getAllTransactions(characterId?: number, characterIds?: number[]): CharacterTransaction[] {
    const result: CharacterTransaction[] = [];
    const filterSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;

    for (const tx of this.transactions.values()) {
      if (filterSet) {
        if (!filterSet.has(tx.characterId)) continue;
      } else if (characterId !== undefined && tx.characterId !== characterId) {
        continue;
      }
      result.push(this.enrichTransaction(tx));
    }

    return result;
  }

  /**
   * Computes financial summaries without assuming unproven costs, verifying against both transactions and journal
   */
  public getSummary(characterId?: number, characterIds?: number[]): LedgerSummary {
    let totalTransactionsCount = 0;
    let sellTransactionsCount = 0;
    let buyTransactionsCount = 0;
    let totalSellVolume = 0;
    let totalBuyVolume = 0;
    let totalGrossSalesIsk = 0;
    let totalBuySpendIsk = 0;
    let totalTaxesIsk = 0;
    let totalBrokerFeesIsk = 0;
    const distinctTypes = new Set<number>();
    const distinctLocations = new Set<number>();

    const filterSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;

    for (const tx of this.transactions.values()) {
      if (filterSet) {
        if (!filterSet.has(tx.characterId)) continue;
      } else if (characterId !== undefined && tx.characterId !== characterId) {
        continue;
      }

      totalTransactionsCount++;
      distinctTypes.add(tx.typeId);
      distinctLocations.add(tx.locationId);

      const enriched = this.enrichTransaction(tx);
      totalTaxesIsk += (enriched.tax || 0);
      totalBrokerFeesIsk += (enriched.brokerFee || 0);

      if (tx.isBuy) {
        buyTransactionsCount++;
        totalBuyVolume += tx.quantity;
        totalBuySpendIsk += tx.totalValue;
      } else {
        sellTransactionsCount++;
        totalSellVolume += tx.quantity;
        totalGrossSalesIsk += tx.totalValue;
      }
    }

    // Direct check of wallet journal to ensure no unlinked taxes or broker fees are omitted
    let journalTaxesTotal = 0;
    let journalBrokerFeesTotal = 0;
    for (const jn of this.journalEntries.values()) {
      if (filterSet) {
        if (!filterSet.has(jn.characterId)) continue;
      } else if (characterId !== undefined && jn.characterId !== characterId) {
        continue;
      }

      const isTaxRef = jn.refType === 'transaction_tax' || jn.refType === 'market_tax' || jn.refType === 'contract_sales_tax';
      const isBrokerRef = jn.refType === 'brokers_fee' || jn.refType === 'broker_fee' || jn.refType === 'contract_brokers_fee';

      if (isTaxRef) {
        const amt = jn.tax !== undefined && jn.tax > 0 ? jn.tax : Math.abs(jn.amount || 0);
        journalTaxesTotal += amt;
      } else if (isBrokerRef) {
        journalBrokerFeesTotal += Math.abs(jn.amount || 0);
      }
    }

    // Ensure taxes and broker fees reflect full verified journal activity
    totalTaxesIsk = Math.max(totalTaxesIsk, journalTaxesTotal);
    totalBrokerFeesIsk = Math.max(totalBrokerFeesIsk, journalBrokerFeesTotal);

    totalGrossSalesIsk = Math.round((totalGrossSalesIsk + Number.EPSILON) * 100) / 100;
    totalBuySpendIsk = Math.round((totalBuySpendIsk + Number.EPSILON) * 100) / 100;
    totalTaxesIsk = Math.round((totalTaxesIsk + Number.EPSILON) * 100) / 100;
    totalBrokerFeesIsk = Math.round((totalBrokerFeesIsk + Number.EPSILON) * 100) / 100;
    const totalNetSalesIsk = Math.round((totalGrossSalesIsk - totalTaxesIsk - totalBrokerFeesIsk + Number.EPSILON) * 100) / 100;

    const completeness = totalTransactionsCount > 0 ? 'COMPLETE' : 'ABSENT';

    return {
      characterId: characterId || 0,
      asOf: Date.now(),
      totalTransactionsCount,
      sellTransactionsCount,
      buyTransactionsCount,
      totalSellVolume,
      totalBuyVolume,
      totalGrossSalesIsk,
      totalBuySpendIsk,
      totalTaxesIsk,
      totalBrokerFeesIsk,
      totalNetSalesIsk,
      distinctItemsCount: distinctTypes.size,
      distinctLocationsCount: distinctLocations.size,
      completeness,
    };
  }

  /**
   * Retrieves distinct filter options (items and locations) available in character's dataset
   */
  public getFilterOptions(characterId: number): LedgerFilterOptions {
    const typeMap = new Map<number, { name: string; count: number }>();
    const locationMap = new Map<number, { name: string; count: number }>();

    for (const tx of this.transactions.values()) {
      if (tx.characterId !== characterId) continue;

      // Track type
      const currentType = typeMap.get(tx.typeId) || {
        name: tx.typeName || `Item #${tx.typeId}`,
        count: 0,
      };
      currentType.count++;
      if (tx.typeName && currentType.name.startsWith('Item #')) {
        currentType.name = tx.typeName;
      }
      typeMap.set(tx.typeId, currentType);

      // Track location
      const currentLocation = locationMap.get(tx.locationId) || {
        name: tx.locationName || `Location #${tx.locationId}`,
        count: 0,
      };
      currentLocation.count++;
      if (tx.locationName && currentLocation.name.startsWith('Location #')) {
        currentLocation.name = tx.locationName;
      }
      locationMap.set(tx.locationId, currentLocation);
    }

    const types: LedgerFilterOptions['types'] = Array.from(typeMap.entries()).map(([id, entry]) => ({
      id,
      name: entry.name,
      count: entry.count,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const locations: LedgerFilterOptions['locations'] = Array.from(locationMap.entries()).map(([id, entry]) => ({
      id,
      name: entry.name,
      count: entry.count,
    })).sort((a, b) => a.name.localeCompare(b.name));

    return { types, locations };
  }

  /**
   * Clears all transactions and journal entries
   */
  public reset(): void {
    this.transactions.clear();
    this.journalEntries.clear();
  }

  /**
   * Purges all data for a given character (e.g. on character reset / logout)
   */
  public clearCharacter(characterId: number): void {
    for (const [key, tx] of this.transactions.entries()) {
      if (tx.characterId === characterId) {
        this.transactions.delete(key);
      }
    }
    for (const [key, jn] of this.journalEntries.entries()) {
      if (jn.characterId === characterId) {
        this.journalEntries.delete(key);
      }
    }
  }

  /**
   * Dumps entire state for backup
   */
  public dumpData(): { transactions: CharacterTransaction[]; journalEntries: CharacterWalletJournalEntry[] } {
    return {
      transactions: Array.from(this.transactions.values()),
      journalEntries: Array.from(this.journalEntries.values()),
    };
  }

  /**
   * Restores data from backup atomically
   */
  public restoreData(data: { transactions: CharacterTransaction[]; journalEntries: CharacterWalletJournalEntry[] }): void {
    this.transactions.clear();
    this.journalEntries.clear();
    for (const tx of data.transactions) {
      this.transactions.set(this.makeTxKey(tx.characterId, tx.transactionId), tx);
    }
    for (const jn of data.journalEntries) {
      this.journalEntries.set(this.makeJournalKey(jn.characterId, jn.journalId), jn);
    }
  }
}

export const defaultLedgerRepository = new InMemoryLedgerRepository();
export const ledgerRepository = defaultLedgerRepository;
