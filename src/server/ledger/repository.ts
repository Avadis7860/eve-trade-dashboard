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
  getTransactionById(characterId: number, transactionId: number): CharacterTransaction | null;
  countTransactions(characterId: number): number;
  saveJournalEntries(entries: CharacterWalletJournalEntry[]): { inserted: number; updated: number };
  getJournalEntries(characterId: number, page?: number, pageSize?: number): { items: CharacterWalletJournalEntry[]; total: number };
  getJournalEntryById(characterId: number, journalId: number): CharacterWalletJournalEntry | null;
  getSummary(characterId: number): LedgerSummary;
  getFilterOptions(characterId: number): LedgerFilterOptions;
  clearCharacter(characterId: number): void;
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
   * Returns single transaction by ID for a specific character
   */
  public getTransactionById(characterId: number, transactionId: number): CharacterTransaction | null {
    const key = this.makeTxKey(characterId, transactionId);
    return this.transactions.get(key) || null;
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
      if (tx.characterId !== characterId) {
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

    // 3. Paginate
    const total = matched.length;
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const totalPages = Math.max(1, Math.ceil(total / validPageSize));
    const offset = (validPage - 1) * validPageSize;
    const paginatedItems = matched.slice(offset, offset + validPageSize);

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
    characterId: number,
    page = 1,
    pageSize = 50
  ): { items: CharacterWalletJournalEntry[]; total: number } {
    const matched: CharacterWalletJournalEntry[] = [];

    for (const entry of this.journalEntries.values()) {
      if (entry.characterId === characterId) {
        matched.push(entry);
      }
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
   * Computes financial summaries without assuming unproven costs
   */
  public getSummary(characterId: number): LedgerSummary {
    let totalTransactionsCount = 0;
    let sellTransactionsCount = 0;
    let buyTransactionsCount = 0;
    let totalSellVolume = 0;
    let totalBuyVolume = 0;
    let totalGrossSalesIsk = 0;
    let totalBuySpendIsk = 0;
    const distinctTypes = new Set<number>();
    const distinctLocations = new Set<number>();

    for (const tx of this.transactions.values()) {
      if (tx.characterId !== characterId) continue;

      totalTransactionsCount++;
      distinctTypes.add(tx.typeId);
      distinctLocations.add(tx.locationId);

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

    const completeness = totalTransactionsCount > 0 ? 'COMPLETE' : 'ABSENT';

    return {
      characterId,
      asOf: Date.now(),
      totalTransactionsCount,
      sellTransactionsCount,
      buyTransactionsCount,
      totalSellVolume,
      totalBuyVolume,
      totalGrossSalesIsk,
      totalBuySpendIsk,
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
}

export const defaultLedgerRepository = new InMemoryLedgerRepository();
