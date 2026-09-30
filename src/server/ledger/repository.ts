import type {
  CharacterTransaction,
  CharacterWalletJournalEntry,
  LedgerQueryFilters,
  PaginatedLedgerResult,
  LedgerSummary,
  LedgerFilterOptions,
} from './types.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

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

export class PersistentLedgerRepository implements ILedgerRepository {
  private transactions: Map<string, CharacterTransaction> = new Map();
  private journalEntries: Map<string, CharacterWalletJournalEntry> = new Map();

  // Secondary indexes for sub-millisecond filtering on 50k+ items
  private txByCharacter: Map<number, Set<string>> = new Map();
  private txByType: Map<number, Set<string>> = new Map();
  private txByLocation: Map<number, Set<string>> = new Map();
  private jnByCharacter: Map<number, Set<string>> = new Map();

  constructor(private adapter: IDatabaseAdapter | null = null) {
    if (this.adapter) {
      this.loadFromStorage();
    }
  }

  private loadFromStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state?.data?.ledger) {
        this.restoreData(state.data.ledger, false);
      }
    }
  }

  private syncToStorage(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      state.data.ledger = {
        transactions: Array.from(this.transactions.values()),
        journalEntries: Array.from(this.journalEntries.values()),
      };
      this.adapter.persist();
    }
  }

  private makeTxKey(characterId: number, transactionId: number): string {
    return `${characterId}:${transactionId}`;
  }

  private makeJournalKey(characterId: number, journalId: number): string {
    return `${characterId}:${journalId}`;
  }

  private indexTransaction(key: string, tx: CharacterTransaction): void {
    if (!this.txByCharacter.has(tx.characterId)) {
      this.txByCharacter.set(tx.characterId, new Set());
    }
    this.txByCharacter.get(tx.characterId)!.add(key);

    if (!this.txByType.has(tx.typeId)) {
      this.txByType.set(tx.typeId, new Set());
    }
    this.txByType.get(tx.typeId)!.add(key);

    if (!this.txByLocation.has(tx.locationId)) {
      this.txByLocation.set(tx.locationId, new Set());
    }
    this.txByLocation.get(tx.locationId)!.add(key);
  }

  private unindexTransaction(key: string, tx: CharacterTransaction): void {
    this.txByCharacter.get(tx.characterId)?.delete(key);
    this.txByType.get(tx.typeId)?.delete(key);
    this.txByLocation.get(tx.locationId)?.delete(key);
  }

  private indexJournal(key: string, jn: CharacterWalletJournalEntry): void {
    if (!this.jnByCharacter.has(jn.characterId)) {
      this.jnByCharacter.set(jn.characterId, new Set());
    }
    this.jnByCharacter.get(jn.characterId)!.add(key);
  }

  private unindexJournal(key: string, jn: CharacterWalletJournalEntry): void {
    this.jnByCharacter.get(jn.characterId)?.delete(key);
  }

  public saveTransactions(transactions: CharacterTransaction[]): { inserted: number; updated: number } {
    let inserted = 0;
    let updated = 0;

    for (const tx of transactions) {
      const key = this.makeTxKey(tx.characterId, tx.transactionId);
      if (this.transactions.has(key)) {
        const existing = this.transactions.get(key)!;
        this.unindexTransaction(key, existing);
        const updatedTx = {
          ...existing,
          ...tx,
          observedAt: existing.observedAt,
        };
        this.transactions.set(key, updatedTx);
        this.indexTransaction(key, updatedTx);
        updated++;
      } else {
        this.transactions.set(key, tx);
        this.indexTransaction(key, tx);
        inserted++;
      }
    }

    this.syncToStorage();
    return { inserted, updated };
  }

  public getTransactionById(characterId: number, transactionId: number): CharacterTransaction | null {
    const key = this.makeTxKey(characterId, transactionId);
    const tx = this.transactions.get(key);
    if (!tx) return null;
    return this.enrichTransaction(tx);
  }

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

    const charJnKeys = this.jnByCharacter.get(characterId);
    if (!charJnKeys || charJnKeys.size === 0) {
      return { tax: 0, brokerFee: 0, entries: [] };
    }

    for (const key of charJnKeys) {
      const jn = this.journalEntries.get(key);
      if (!jn) continue;

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

    if (!dedicatedTaxFound && isBuy === false) {
      const txTime = txDate ? new Date(txDate).getTime() : 0;
      for (const key of charJnKeys) {
        const jn = this.journalEntries.get(key);
        if (!jn) continue;

        const isTaxRef = jn.refType === 'transaction_tax' || jn.refType === 'market_tax' || jn.refType === 'contract_sales_tax';
        if (!isTaxRef) continue;

        const isAdjacentId = journalRefId !== undefined && Math.abs(jn.journalId - journalRefId) <= 10;
        const jnTime = new Date(jn.date).getTime();
        const isTimeMatch = txTime > 0 && Math.abs(jnTime - txTime) <= 3000;

        if (isAdjacentId || isTimeMatch) {
          const taxAmt = jn.tax !== undefined && jn.tax > 0 ? jn.tax : Math.abs(jn.amount || 0);
          if (txTotalValue !== undefined && txTotalValue > 0) {
            const ratio = taxAmt / txTotalValue;
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

  public countTransactions(characterId: number): number {
    const set = this.txByCharacter.get(characterId);
    return set ? set.size : 0;
  }

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

    let candidateKeys: Iterable<string>;
    if (characterId !== undefined) {
      candidateKeys = this.txByCharacter.get(characterId) || [];
    } else if (typeId !== undefined) {
      candidateKeys = this.txByType.get(typeId) || [];
    } else if (locationId !== undefined) {
      candidateKeys = this.txByLocation.get(locationId) || [];
    } else {
      candidateKeys = this.transactions.keys();
    }

    const matched: CharacterTransaction[] = [];
    const searchLower = search ? search.trim().toLowerCase() : '';
    const fromTime = fromDate ? new Date(fromDate).getTime() : -Infinity;
    const toTime = toDate ? new Date(toDate).getTime() : Infinity;

    for (const key of candidateKeys) {
      const tx = this.transactions.get(key);
      if (!tx) continue;

      if (characterId !== undefined && tx.characterId !== characterId) continue;
      if (type === 'SELL' && tx.isBuy) continue;
      if (type === 'BUY' && !tx.isBuy) continue;
      if (typeId !== undefined && tx.typeId !== typeId) continue;
      if (locationId !== undefined && tx.locationId !== locationId) continue;

      const txTime = new Date(tx.date).getTime();
      if (txTime < fromTime || txTime > toTime) continue;

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

    const total = matched.length;
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const totalPages = Math.max(1, Math.ceil(total / validPageSize));
    const offset = (validPage - 1) * validPageSize;
    const paginatedItems = matched.slice(offset, offset + validPageSize).map((tx) => this.enrichTransaction(tx));

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
        this.indexJournal(key, entry);
        inserted++;
      }
    }

    this.syncToStorage();
    return { inserted, updated };
  }

  public getJournalEntries(
    characterId?: number,
    page = 1,
    pageSize = 50
  ): { items: CharacterWalletJournalEntry[]; total: number } {
    let candidateKeys: Iterable<string>;
    if (characterId !== undefined) {
      candidateKeys = this.jnByCharacter.get(characterId) || [];
    } else {
      candidateKeys = this.journalEntries.keys();
    }

    const matched: CharacterWalletJournalEntry[] = [];
    for (const key of candidateKeys) {
      const entry = this.journalEntries.get(key);
      if (!entry) continue;
      matched.push(entry);
    }

    matched.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const total = matched.length;
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const offset = (validPage - 1) * validPageSize;
    const items = matched.slice(offset, offset + validPageSize);

    return { items, total };
  }

  public getJournalEntryById(characterId: number, journalId: number): CharacterWalletJournalEntry | null {
    const key = this.makeJournalKey(characterId, journalId);
    return this.journalEntries.get(key) || null;
  }

  public getAllTransactions(characterId?: number, characterIds?: number[]): CharacterTransaction[] {
    const result: CharacterTransaction[] = [];
    const filterSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;

    if (characterId !== undefined && !filterSet) {
      const keys = this.txByCharacter.get(characterId) || [];
      for (const key of keys) {
        const tx = this.transactions.get(key);
        if (tx) result.push(this.enrichTransaction(tx));
      }
      return result;
    }

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

    let candidateTxs: Iterable<CharacterTransaction>;
    if (characterId !== undefined && !filterSet) {
      const keys = this.txByCharacter.get(characterId) || [];
      candidateTxs = Array.from(keys).map((k) => this.transactions.get(k)!).filter(Boolean);
    } else {
      candidateTxs = this.transactions.values();
    }

    for (const tx of candidateTxs) {
      if (filterSet && !filterSet.has(tx.characterId)) continue;

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

    let journalTaxesTotal = 0;
    let journalBrokerFeesTotal = 0;
    let candidateJns: Iterable<CharacterWalletJournalEntry>;
    if (characterId !== undefined && !filterSet) {
      const keys = this.jnByCharacter.get(characterId) || [];
      candidateJns = Array.from(keys).map((k) => this.journalEntries.get(k)!).filter(Boolean);
    } else {
      candidateJns = this.journalEntries.values();
    }

    for (const jn of candidateJns) {
      if (filterSet && !filterSet.has(jn.characterId)) continue;

      const isTaxRef = jn.refType === 'transaction_tax' || jn.refType === 'market_tax' || jn.refType === 'contract_sales_tax';
      const isBrokerRef = jn.refType === 'brokers_fee' || jn.refType === 'broker_fee' || jn.refType === 'contract_brokers_fee';

      if (isTaxRef) {
        const amt = jn.tax !== undefined && jn.tax > 0 ? jn.tax : Math.abs(jn.amount || 0);
        journalTaxesTotal += amt;
      } else if (isBrokerRef) {
        journalBrokerFeesTotal += Math.abs(jn.amount || 0);
      }
    }

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

  public getFilterOptions(characterId: number): LedgerFilterOptions {
    const typeMap = new Map<number, { name: string; count: number }>();
    const locationMap = new Map<number, { name: string; count: number }>();

    const keys = this.txByCharacter.get(characterId) || [];
    for (const key of keys) {
      const tx = this.transactions.get(key);
      if (!tx) continue;

      const currentType = typeMap.get(tx.typeId) || {
        name: tx.typeName || `Item #${tx.typeId}`,
        count: 0,
      };
      currentType.count++;
      if (tx.typeName && currentType.name.startsWith('Item #')) {
        currentType.name = tx.typeName;
      }
      typeMap.set(tx.typeId, currentType);

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

  public reset(): void {
    this.transactions.clear();
    this.journalEntries.clear();
    this.txByCharacter.clear();
    this.txByType.clear();
    this.txByLocation.clear();
    this.jnByCharacter.clear();
    this.syncToStorage();
  }

  public clearCharacter(characterId: number): void {
    const txKeys = this.txByCharacter.get(characterId);
    if (txKeys) {
      for (const key of Array.from(txKeys)) {
        const tx = this.transactions.get(key);
        if (tx) {
          this.unindexTransaction(key, tx);
          this.transactions.delete(key);
        }
      }
      this.txByCharacter.delete(characterId);
    }

    const jnKeys = this.jnByCharacter.get(characterId);
    if (jnKeys) {
      for (const key of Array.from(jnKeys)) {
        const jn = this.journalEntries.get(key);
        if (jn) {
          this.unindexJournal(key, jn);
          this.journalEntries.delete(key);
        }
      }
      this.jnByCharacter.delete(characterId);
    }

    this.syncToStorage();
  }

  public dumpData(): { transactions: CharacterTransaction[]; journalEntries: CharacterWalletJournalEntry[] } {
    return {
      transactions: Array.from(this.transactions.values()),
      journalEntries: Array.from(this.journalEntries.values()),
    };
  }

  public restoreData(
    data: { transactions: CharacterTransaction[]; journalEntries: CharacterWalletJournalEntry[] },
    sync = true
  ): void {
    this.transactions.clear();
    this.journalEntries.clear();
    this.txByCharacter.clear();
    this.txByType.clear();
    this.txByLocation.clear();
    this.jnByCharacter.clear();

    for (const tx of data.transactions) {
      const key = this.makeTxKey(tx.characterId, tx.transactionId);
      this.transactions.set(key, tx);
      this.indexTransaction(key, tx);
    }
    for (const jn of data.journalEntries) {
      const key = this.makeJournalKey(jn.characterId, jn.journalId);
      this.journalEntries.set(key, jn);
      this.indexJournal(key, jn);
    }

    if (sync) {
      this.syncToStorage();
    }
  }
}

export class InMemoryLedgerRepository extends PersistentLedgerRepository {}
export const defaultLedgerRepository = new PersistentLedgerRepository(StorageManager.getInstance().getAdapter());
export const ledgerRepository = defaultLedgerRepository;
