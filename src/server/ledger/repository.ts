import type {
  CharacterTransaction,
  CharacterWalletJournalEntry,
  LedgerQueryFilters,
  PaginatedLedgerResult,
  LedgerSummary,
  LedgerFilterOptions,
} from './types.ts';
import { makeJournalEntryKey } from './types.ts';
import { StorageManager, DurableFileDatabaseAdapter } from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';

export interface ILedgerRepository {
  reset?(): void;
  saveTransactions(transactions: CharacterTransaction[]): { inserted: number; updated: number };
  getTransactions(filters: LedgerQueryFilters): PaginatedLedgerResult<CharacterTransaction>;
  getAllTransactions(characterId?: number, characterIds?: number[]): CharacterTransaction[];
  getTransactionsByTypeId?(typeId: number, characterId?: number, characterIds?: number[]): CharacterTransaction[];
  getHistoricalBuyLots(characterId?: number, characterIds?: number[], typeId?: number): CharacterTransaction[];
  getLastActivityDates?(characterId?: number, characterIds?: number[]): Map<string, number>;
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
  private jnByCorporation: Map<number, Set<string>> = new Map();

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
    if (jn.characterId) {
      if (!this.jnByCharacter.has(jn.characterId)) {
        this.jnByCharacter.set(jn.characterId, new Set());
      }
      this.jnByCharacter.get(jn.characterId)!.add(key);
    }
    if (jn.observedByCharacterIds) {
      for (const cid of jn.observedByCharacterIds) {
        if (!this.jnByCharacter.has(cid)) {
          this.jnByCharacter.set(cid, new Set());
        }
        this.jnByCharacter.get(cid)!.add(key);
      }
    }
    if (jn.isCorporationWallet && jn.corporationId) {
      if (!this.jnByCorporation.has(jn.corporationId)) {
        this.jnByCorporation.set(jn.corporationId, new Set());
      }
      this.jnByCorporation.get(jn.corporationId)!.add(key);
    }
  }

  private unindexJournal(key: string, jn: CharacterWalletJournalEntry): void {
    if (jn.characterId) {
      this.jnByCharacter.get(jn.characterId)?.delete(key);
    }
    if (jn.observedByCharacterIds) {
      for (const cid of jn.observedByCharacterIds) {
        this.jnByCharacter.get(cid)?.delete(key);
      }
    }
    if (jn.isCorporationWallet && jn.corporationId) {
      this.jnByCorporation.get(jn.corporationId)?.delete(key);
    }
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

    const candidateSets: Set<string>[] = [];
    if (characterId !== undefined && this.txByCharacter.has(characterId)) {
      candidateSets.push(this.txByCharacter.get(characterId)!);
    }
    if (typeId !== undefined && this.txByType.has(typeId)) {
      candidateSets.push(this.txByType.get(typeId)!);
    }
    if (locationId !== undefined && this.txByLocation.has(locationId)) {
      candidateSets.push(this.txByLocation.get(locationId)!);
    }

    let candidateKeys: Iterable<string>;
    if (candidateSets.length > 0) {
      candidateSets.sort((a, b) => a.size - b.size);
      candidateKeys = candidateSets[0];
    } else if (characterId !== undefined || typeId !== undefined || locationId !== undefined) {
      candidateKeys = [];
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
      const key = entry.id || makeJournalEntryKey(entry);
      const normalizedEntry: CharacterWalletJournalEntry = {
        ...entry,
        id: key,
      };

      if (this.journalEntries.has(key)) {
        const existing = this.journalEntries.get(key)!;
        this.unindexJournal(key, existing);
        const observedBy = new Set(existing.observedByCharacterIds || (existing.characterId ? [existing.characterId] : []));
        if (normalizedEntry.characterId) observedBy.add(normalizedEntry.characterId);
        if (normalizedEntry.observedByCharacterIds) {
          for (const cid of normalizedEntry.observedByCharacterIds) observedBy.add(cid);
        }
        const updatedEntry: CharacterWalletJournalEntry = {
          ...existing,
          ...normalizedEntry,
          observedAt: existing.observedAt,
          observedByCharacterIds: Array.from(observedBy),
        };
        this.journalEntries.set(key, updatedEntry);
        this.indexJournal(key, updatedEntry);
        updated++;
      } else {
        if (!normalizedEntry.observedByCharacterIds && normalizedEntry.characterId) {
          normalizedEntry.observedByCharacterIds = [normalizedEntry.characterId];
        }
        this.journalEntries.set(key, normalizedEntry);
        this.indexJournal(key, normalizedEntry);
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
    const personalKey = `char:${characterId}:${journalId}`;
    if (this.journalEntries.has(personalKey)) {
      return this.journalEntries.get(personalKey)!;
    }
    const legacyKey = `${characterId}:${journalId}`;
    if (this.journalEntries.has(legacyKey)) {
      return this.journalEntries.get(legacyKey)!;
    }
    const charKeys = this.jnByCharacter.get(characterId);
    if (charKeys) {
      for (const key of charKeys) {
        const jn = this.journalEntries.get(key);
        if (jn && jn.journalId === journalId) return jn;
      }
    }
    return null;
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

  public getTransactionsByTypeId(typeId: number, characterId?: number, characterIds?: number[]): CharacterTransaction[] {
    const keys = this.txByType.get(typeId);
    if (!keys || keys.size === 0) return [];

    const filterSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;
    const matched: CharacterTransaction[] = [];

    for (const key of keys) {
      const tx = this.transactions.get(key);
      if (!tx) continue;
      if (filterSet && !filterSet.has(tx.characterId)) continue;
      if (characterId !== undefined && !filterSet && tx.characterId !== characterId) continue;
      matched.push(this.enrichTransaction(tx));
    }

    matched.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return matched;
  }

  public getLastActivityDates(characterId?: number, characterIds?: number[]): Map<string, number> {
    const filterSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;
    const result = new Map<string, number>();

    let candidateKeys: Iterable<string>;
    if (characterId !== undefined && !filterSet) {
      candidateKeys = this.txByCharacter.get(characterId) || [];
    } else {
      candidateKeys = this.transactions.keys();
    }

    for (const key of candidateKeys) {
      const tx = this.transactions.get(key);
      if (!tx) continue;
      if (filterSet && !filterSet.has(tx.characterId)) continue;
      if (characterId !== undefined && !filterSet && tx.characterId !== characterId) continue;

      const groupKey = `${tx.characterId}:${tx.typeId}:${tx.locationId}`;
      const txTime = new Date(tx.date).getTime();
      const existing = result.get(groupKey) || 0;
      if (txTime > existing) {
        result.set(groupKey, txTime);
      }
    }

    return result;
  }

  public getHistoricalBuyLots(characterId?: number, characterIds?: number[], typeId?: number): CharacterTransaction[] {
    const filterSet = characterIds && characterIds.length > 0 ? new Set(characterIds) : null;
    let candidateKeys: Iterable<string>;

    if (typeId !== undefined && this.txByType.has(typeId)) {
      candidateKeys = this.txByType.get(typeId)!;
    } else if (characterId !== undefined && !filterSet && this.txByCharacter.has(characterId)) {
      candidateKeys = this.txByCharacter.get(characterId)!;
    } else {
      candidateKeys = this.transactions.keys();
    }

    const matched: CharacterTransaction[] = [];
    for (const key of candidateKeys) {
      const tx = this.transactions.get(key);
      if (!tx || !tx.isBuy) continue;
      if (filterSet && !filterSet.has(tx.characterId)) continue;
      if (characterId !== undefined && !filterSet && tx.characterId !== characterId) continue;
      if (typeId !== undefined && tx.typeId !== typeId) continue;
      matched.push(this.enrichTransaction(tx));
    }

    // Sort chronologically ascending for FIFO ordering (oldest buy lots first)
    matched.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return matched;
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
    } else if (filterSet) {
      const uniqueKeys = new Set<string>();
      for (const cid of filterSet) {
        const keys = this.jnByCharacter.get(cid);
        if (keys) {
          for (const k of keys) uniqueKeys.add(k);
        }
      }
      candidateJns = Array.from(uniqueKeys).map((k) => this.journalEntries.get(k)!).filter(Boolean);
    } else {
      candidateJns = this.journalEntries.values();
    }

    for (const jn of candidateJns) {
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
    this.jnByCorporation.clear();
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
          if (jn.isCorporationWallet && jn.observedByCharacterIds && jn.observedByCharacterIds.length > 1) {
            jn.observedByCharacterIds = jn.observedByCharacterIds.filter((id) => id !== characterId);
            if (jn.characterId === characterId && jn.observedByCharacterIds.length > 0) {
              jn.characterId = jn.observedByCharacterIds[0];
            }
          } else {
            this.unindexJournal(key, jn);
            this.journalEntries.delete(key);
          }
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
    this.jnByCorporation.clear();

    for (const tx of data.transactions) {
      const key = tx.id || this.makeTxKey(tx.characterId, tx.transactionId);
      this.transactions.set(key, tx);
      this.indexTransaction(key, tx);
    }
    for (const jn of data.journalEntries) {
      const key = makeJournalEntryKey(jn);
      const normalizedJn: CharacterWalletJournalEntry = { ...jn, id: key };
      if (this.journalEntries.has(key)) {
        const existing = this.journalEntries.get(key)!;
        const observedBy = new Set(existing.observedByCharacterIds || (existing.characterId ? [existing.characterId] : []));
        if (jn.characterId) observedBy.add(jn.characterId);
        if (jn.observedByCharacterIds) {
          for (const cid of jn.observedByCharacterIds) observedBy.add(cid);
        }
        const merged: CharacterWalletJournalEntry = {
          ...existing,
          ...normalizedJn,
          observedByCharacterIds: Array.from(observedBy),
        };
        this.journalEntries.set(key, merged);
        this.indexJournal(key, merged);
      } else {
        if (!normalizedJn.observedByCharacterIds && normalizedJn.characterId) {
          normalizedJn.observedByCharacterIds = [normalizedJn.characterId];
        }
        this.journalEntries.set(key, normalizedJn);
        this.indexJournal(key, normalizedJn);
      }
    }

    if (sync) {
      this.syncToStorage();
    }
  }
}

export class InMemoryLedgerRepository extends PersistentLedgerRepository {}

/**
 * PostgreSQL implementation of Ledger Repository with parameterized SQL queries,
 * ACID transactions and B-Tree indexed access.
 */
export class PostgresLedgerRepository implements ILedgerRepository {
  private fallbackMemory: PersistentLedgerRepository;

  constructor(private adapter: IDatabaseAdapter) {
    this.fallbackMemory = new PersistentLedgerRepository(null);
  }

  private mapRowToTx(row: Record<string, unknown>): CharacterTransaction {
    const charId = Number(row.character_id);
    const txId = Number(row.transaction_id);
    return {
      id: `${charId}:${txId}`,
      characterId: charId,
      transactionId: txId,
      typeId: Number(row.type_id),
      typeName: row.type_name ? String(row.type_name) : undefined,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      totalValue: Number(row.total_value),
      isBuy: Boolean(row.is_buy),
      isPersonal: row.is_personal !== undefined ? Boolean(row.is_personal) : true,
      locationId: Number(row.location_id),
      locationName: row.location_name ? String(row.location_name) : undefined,
      clientId: Number(row.client_id),
      clientName: row.client_name ? String(row.client_name) : undefined,
      date: String(row.date),
      journalRefId: row.journal_ref_id !== null && row.journal_ref_id !== undefined ? Number(row.journal_ref_id) : 0,
      source: `esi:/characters/${charId}/wallet/transactions/`,
      observedAt: Number(row.observed_at || Date.now()),
      tax: row.tax !== null && row.tax !== undefined ? Number(row.tax) : undefined,
      brokerFee: row.broker_fee !== null && row.broker_fee !== undefined ? Number(row.broker_fee) : undefined,
      netValue: row.net_value !== null && row.net_value !== undefined ? Number(row.net_value) : undefined,
    };
  }

  private mapRowToJournal(row: Record<string, unknown>): CharacterWalletJournalEntry {
    const charId = Number(row.character_id);
    const jnId = Number(row.journal_id);
    const isCorp = Boolean(row.is_corporation_wallet);
    const corpId = row.corporation_id ? Number(row.corporation_id) : undefined;
    const div = row.division ? Number(row.division) : undefined;
    const id = makeJournalEntryKey({
      isCorporationWallet: isCorp,
      corporationId: corpId,
      division: div,
      characterId: charId,
      journalId: jnId,
    });
    return {
      id,
      characterId: charId,
      journalId: jnId,
      date: String(row.date),
      refType: String(row.ref_type),
      amount: row.amount !== null && row.amount !== undefined ? Number(row.amount) : undefined,
      balance: row.balance !== null && row.balance !== undefined ? Number(row.balance) : undefined,
      description: row.description ? String(row.description) : '',
      firstPartyId: row.first_party_id ? Number(row.first_party_id) : undefined,
      secondPartyId: row.second_party_id ? Number(row.second_party_id) : undefined,
      reason: row.reason ? String(row.reason) : undefined,
      taxReceiverId: row.tax_receiver_id ? Number(row.tax_receiver_id) : undefined,
      tax: row.tax !== null && row.tax !== undefined ? Number(row.tax) : undefined,
      contextId: row.context_id ? Number(row.context_id) : undefined,
      contextIdType: row.context_id_type ? String(row.context_id_type) : undefined,
      source: isCorp && corpId ? `/corporations/${corpId}/wallets/${div || 1}/journal/` : `esi:/characters/${charId}/wallet/journal/`,
      observedAt: Number(row.observed_at || Date.now()),
      isCorporationWallet: isCorp,
      corporationId: corpId,
      division: div,
      observedByCharacterIds: [charId],
    };
  }

  public reset(): void {
    this.fallbackMemory.reset();
    this.resetAsync().catch(() => {});
  }

  public async resetAsync(): Promise<void> {
    await this.adapter.execute('DELETE FROM transactions');
    await this.adapter.execute('DELETE FROM journal_entries');
  }

  public saveTransactions(transactions: CharacterTransaction[]): { inserted: number; updated: number } {
    this.fallbackMemory.saveTransactions(transactions);
    this.saveTransactionsAsync(transactions).catch(() => {});
    return { inserted: transactions.length, updated: 0 };
  }

  public async saveTransactionsAsync(transactions: CharacterTransaction[]): Promise<{ inserted: number; updated: number }> {
    if (transactions.length === 0) return { inserted: 0, updated: 0 };

    return await this.adapter.transaction(async (tx) => {
      let inserted = 0;
      const CHUNK_SIZE = 100;
      for (let i = 0; i < transactions.length; i += CHUNK_SIZE) {
        const chunk = transactions.slice(i, i + CHUNK_SIZE);
        for (const item of chunk) {
          const sql = `
            INSERT INTO transactions (
              character_id, transaction_id, type_id, type_name, quantity,
              unit_price, total_value, is_buy, is_personal, location_id,
              location_name, client_id, client_name, date, journal_ref_id,
              observed_at, tax, broker_fee, net_value
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, $18, $19
            )
            ON CONFLICT (character_id, transaction_id) DO UPDATE SET
              type_id = EXCLUDED.type_id,
              type_name = EXCLUDED.type_name,
              quantity = EXCLUDED.quantity,
              unit_price = EXCLUDED.unit_price,
              total_value = EXCLUDED.total_value,
              is_buy = EXCLUDED.is_buy,
              is_personal = EXCLUDED.is_personal,
              location_id = EXCLUDED.location_id,
              location_name = EXCLUDED.location_name,
              client_id = EXCLUDED.client_id,
              client_name = EXCLUDED.client_name,
              date = EXCLUDED.date,
              journal_ref_id = EXCLUDED.journal_ref_id,
              tax = EXCLUDED.tax,
              broker_fee = EXCLUDED.broker_fee,
              net_value = EXCLUDED.net_value
          `;
          const params = [
            item.characterId,
            item.transactionId,
            item.typeId,
            item.typeName || null,
            item.quantity,
            item.unitPrice,
            item.totalValue,
            item.isBuy,
            item.isPersonal ?? true,
            item.locationId,
            item.locationName || null,
            item.clientId,
            item.clientName || null,
            item.date,
            item.journalRefId || null,
            item.observedAt || Date.now(),
            item.tax ?? null,
            item.brokerFee ?? null,
            item.netValue ?? null,
          ];
          await tx.execute(sql, params);
          inserted++;
        }
      }
      return { inserted, updated: 0 };
    });
  }

  public getTransactions(filters: LedgerQueryFilters): PaginatedLedgerResult<CharacterTransaction> {
    return this.fallbackMemory.getTransactions(filters);
  }

  public async getTransactionsAsync(filters: LedgerQueryFilters): Promise<PaginatedLedgerResult<CharacterTransaction>> {
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

    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (characterId !== undefined) {
      conditions.push(`character_id = $${paramIndex++}`);
      params.push(characterId);
    }
    if (type === 'BUY') {
      conditions.push('is_buy = TRUE');
    } else if (type === 'SELL') {
      conditions.push('is_buy = FALSE');
    }
    if (typeId !== undefined) {
      conditions.push(`type_id = $${paramIndex++}`);
      params.push(typeId);
    }
    if (locationId !== undefined) {
      conditions.push(`location_id = $${paramIndex++}`);
      params.push(locationId);
    }
    if (fromDate) {
      conditions.push(`date >= $${paramIndex++}`);
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push(`date <= $${paramIndex++}`);
      params.push(toDate);
    }
    if (search && search.trim()) {
      const s = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(COALESCE(type_name, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(location_name, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(client_name, '')) LIKE $${paramIndex} OR
        CAST(transaction_id AS TEXT) LIKE $${paramIndex} OR
        CAST(type_id AS TEXT) LIKE $${paramIndex}
      )`);
      params.push(s);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Count total
    const countRes = await this.adapter.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM transactions WHERE ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0]?.count || 0);

    // Sorting column validation
    const sortColMap: Record<string, string> = {
      date: 'date',
      totalValue: 'total_value',
      unitPrice: 'unit_price',
      quantity: 'quantity',
      typeName: 'type_name',
    };
    const col = sortColMap[sortBy] || 'date';
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const offset = (validPage - 1) * validPageSize;

    const dataSql = `
      SELECT * FROM transactions
      WHERE ${whereClause}
      ORDER BY ${col} ${direction}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const dataParams = [...params, validPageSize, offset];
    const dataRes = await this.adapter.query(dataSql, dataParams);
    const items = dataRes.rows.map((r) => this.mapRowToTx(r));

    const totalPages = Math.max(1, Math.ceil(total / validPageSize));
    const summary = await this.getSummaryAsync(characterId);

    return {
      items,
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

  public getAllTransactions(characterId?: number, characterIds?: number[]): CharacterTransaction[] {
    return this.fallbackMemory.getAllTransactions(characterId, characterIds);
  }

  public async getAllTransactionsAsync(characterId?: number, characterIds?: number[]): Promise<CharacterTransaction[]> {
    let sql = 'SELECT * FROM transactions';
    const params: unknown[] = [];
    if (characterIds && characterIds.length > 0) {
      sql += ' WHERE character_id = ANY($1)';
      params.push(characterIds);
    } else if (characterId !== undefined) {
      sql += ' WHERE character_id = $1';
      params.push(characterId);
    }
    sql += ' ORDER BY date DESC';
    const res = await this.adapter.query(sql, params);
    return res.rows.map((r) => this.mapRowToTx(r));
  }

  public getHistoricalBuyLots(characterId?: number, characterIds?: number[], typeId?: number): CharacterTransaction[] {
    return this.fallbackMemory.getHistoricalBuyLots(characterId, characterIds, typeId);
  }

  public getTransactionsByTypeId(typeId: number, characterId?: number, characterIds?: number[]): CharacterTransaction[] {
    return this.fallbackMemory.getTransactionsByTypeId(typeId, characterId, characterIds);
  }

  public async getTransactionsByTypeIdAsync(typeId: number, characterId?: number, characterIds?: number[]): Promise<CharacterTransaction[]> {
    const conditions = ['type_id = $1'];
    const params: unknown[] = [typeId];
    let paramIndex = 2;

    if (characterIds && characterIds.length > 0) {
      conditions.push(`character_id = ANY($${paramIndex++})`);
      params.push(characterIds);
    } else if (characterId !== undefined) {
      conditions.push(`character_id = $${paramIndex++}`);
      params.push(characterId);
    }

    const sql = `SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY date DESC`;
    const res = await this.adapter.query(sql, params);
    return res.rows.map((r) => this.mapRowToTx(r));
  }

  public getLastActivityDates(characterId?: number, characterIds?: number[]): Map<string, number> {
    return this.fallbackMemory.getLastActivityDates(characterId, characterIds);
  }

  public async getLastActivityDatesAsync(characterId?: number, characterIds?: number[]): Promise<Map<string, number>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (characterIds && characterIds.length > 0) {
      conditions.push(`character_id = ANY($${paramIndex++})`);
      params.push(characterIds);
    } else if (characterId !== undefined) {
      conditions.push(`character_id = $${paramIndex++}`);
      params.push(characterId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT character_id, type_id, location_id, MAX(date) as last_date
      FROM transactions
      ${whereClause}
      GROUP BY character_id, type_id, location_id
    `;

    const res = await this.adapter.query<{ character_id: string | number; type_id: string | number; location_id: string | number; last_date: string }>(sql, params);
    const result = new Map<string, number>();
    for (const r of res.rows) {
      const key = `${r.character_id}:${r.type_id}:${r.location_id}`;
      result.set(key, new Date(r.last_date).getTime());
    }
    return result;
  }

  public async getHistoricalBuyLotsAsync(characterId?: number, characterIds?: number[], typeId?: number): Promise<CharacterTransaction[]> {
    const conditions = ['is_buy = TRUE'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (characterIds && characterIds.length > 0) {
      conditions.push(`character_id = ANY($${paramIndex++})`);
      params.push(characterIds);
    } else if (characterId !== undefined) {
      conditions.push(`character_id = $${paramIndex++}`);
      params.push(characterId);
    }

    if (typeId !== undefined) {
      conditions.push(`type_id = $${paramIndex++}`);
      params.push(typeId);
    }

    const sql = `SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY date ASC`;
    const res = await this.adapter.query(sql, params);
    return res.rows.map((r) => this.mapRowToTx(r));
  }

  public getTransactionById(characterId: number, transactionId: number): CharacterTransaction | null {
    return this.fallbackMemory.getTransactionById(characterId, transactionId);
  }

  public async getTransactionByIdAsync(characterId: number, transactionId: number): Promise<CharacterTransaction | null> {
    const res = await this.adapter.query(
      'SELECT * FROM transactions WHERE character_id = $1 AND transaction_id = $2',
      [characterId, transactionId]
    );
    if (res.rows.length === 0) return null;
    return this.mapRowToTx(res.rows[0]);
  }

  public getJournalEntriesForTransaction(
    characterId: number,
    transactionId: number,
    journalRefId?: number,
    txDate?: string,
    txTotalValue?: number,
    isBuy?: boolean
  ): { tax: number; brokerFee: number; entries: CharacterWalletJournalEntry[] } {
    return this.fallbackMemory.getJournalEntriesForTransaction(
      characterId,
      transactionId,
      journalRefId,
      txDate,
      txTotalValue,
      isBuy
    );
  }

  public countTransactions(characterId: number): number {
    return this.fallbackMemory.countTransactions(characterId);
  }

  public async countTransactionsAsync(characterId: number): Promise<number> {
    const res = await this.adapter.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM transactions WHERE character_id = $1',
      [characterId]
    );
    return Number(res.rows[0]?.count || 0);
  }

  public saveJournalEntries(entries: CharacterWalletJournalEntry[]): { inserted: number; updated: number } {
    this.fallbackMemory.saveJournalEntries(entries);
    this.saveJournalEntriesAsync(entries).catch(() => {});
    return { inserted: entries.length, updated: 0 };
  }

  public async saveJournalEntriesAsync(entries: CharacterWalletJournalEntry[]): Promise<{ inserted: number; updated: number }> {
    if (entries.length === 0) return { inserted: 0, updated: 0 };

    return await this.adapter.transaction(async (tx) => {
      let inserted = 0;
      for (const item of entries) {
        const sql = `
          INSERT INTO journal_entries (
            character_id, journal_id, date, ref_type, amount, balance,
            description, first_party_id, first_party_name, second_party_id,
            second_party_name, reason, tax_receiver_id, tax, context_id,
            context_id_type, observed_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16, $17
          )
          ON CONFLICT (character_id, journal_id) DO UPDATE SET
            date = EXCLUDED.date,
            ref_type = EXCLUDED.ref_type,
            amount = EXCLUDED.amount,
            balance = EXCLUDED.balance,
            description = EXCLUDED.description,
            first_party_id = EXCLUDED.first_party_id,
            first_party_name = EXCLUDED.first_party_name,
            second_party_id = EXCLUDED.second_party_id,
            second_party_name = EXCLUDED.second_party_name,
            reason = EXCLUDED.reason,
            tax_receiver_id = EXCLUDED.tax_receiver_id,
            tax = EXCLUDED.tax,
            context_id = EXCLUDED.context_id,
            context_id_type = EXCLUDED.context_id_type
        `;
        const params = [
          item.characterId,
          item.journalId,
          item.date,
          item.refType,
          item.amount,
          item.balance ?? null,
          item.description || null,
          item.firstPartyId || null,
          (item as unknown as Record<string, unknown>).firstPartyName || null,
          item.secondPartyId || null,
          (item as unknown as Record<string, unknown>).secondPartyName || null,
          item.reason || null,
          item.taxReceiverId || null,
          item.tax ?? null,
          item.contextId || null,
          item.contextIdType || null,
          item.observedAt || Date.now(),
        ];
        await tx.execute(sql, params);
        inserted++;
      }
      return { inserted, updated: 0 };
    });
  }

  public getJournalEntries(
    characterId?: number,
    page = 1,
    pageSize = 50
  ): { items: CharacterWalletJournalEntry[]; total: number } {
    return this.fallbackMemory.getJournalEntries(characterId, page, pageSize);
  }

  public async getJournalEntriesAsync(
    characterId?: number,
    page = 1,
    pageSize = 50
  ): Promise<{ items: CharacterWalletJournalEntry[]; total: number }> {
    const validPage = Math.max(1, page);
    const validPageSize = Math.max(1, Math.min(500, pageSize));
    const offset = (validPage - 1) * validPageSize;

    let countSql = 'SELECT COUNT(*) as count FROM journal_entries';
    let dataSql = 'SELECT * FROM journal_entries';
    const params: unknown[] = [];

    if (characterId !== undefined) {
      countSql += ' WHERE character_id = $1';
      dataSql += ' WHERE character_id = $1';
      params.push(characterId);
    }
    dataSql += ` ORDER BY date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    const countRes = await this.adapter.query<{ count: string }>(countSql, params);
    const total = Number(countRes.rows[0]?.count || 0);

    const dataRes = await this.adapter.query(dataSql, [...params, validPageSize, offset]);
    const items = dataRes.rows.map((r) => this.mapRowToJournal(r));

    return { items, total };
  }

  public getJournalEntryById(characterId: number, journalId: number): CharacterWalletJournalEntry | null {
    return this.fallbackMemory.getJournalEntryById(characterId, journalId);
  }

  public async getJournalEntryByIdAsync(characterId: number, journalId: number): Promise<CharacterWalletJournalEntry | null> {
    const res = await this.adapter.query(
      'SELECT * FROM journal_entries WHERE character_id = $1 AND journal_id = $2',
      [characterId, journalId]
    );
    if (res.rows.length === 0) return null;
    return this.mapRowToJournal(res.rows[0]);
  }

  public getSummary(characterId?: number, characterIds?: number[]): LedgerSummary {
    return this.fallbackMemory.getSummary(characterId, characterIds);
  }

  public async getSummaryAsync(characterId?: number, characterIds?: number[]): Promise<LedgerSummary> {
    let sql = `
      SELECT
        COUNT(*) as total_tx_count,
        SUM(CASE WHEN is_buy THEN 1 ELSE 0 END) as buy_tx_count,
        SUM(CASE WHEN NOT is_buy THEN 1 ELSE 0 END) as sell_tx_count,
        SUM(CASE WHEN is_buy THEN quantity ELSE 0 END) as total_buy_vol,
        SUM(CASE WHEN NOT is_buy THEN quantity ELSE 0 END) as total_sell_vol,
        SUM(CASE WHEN is_buy THEN total_value ELSE 0 END) as total_buy_spend,
        SUM(CASE WHEN NOT is_buy THEN total_value ELSE 0 END) as total_gross_sales,
        COUNT(DISTINCT type_id) as distinct_types,
        COUNT(DISTINCT location_id) as distinct_locations,
        COALESCE(SUM(tax), 0) as total_taxes,
        COALESCE(SUM(broker_fee), 0) as total_broker_fees
      FROM transactions
    `;
    const params: unknown[] = [];
    if (characterIds && characterIds.length > 0) {
      sql += ' WHERE character_id = ANY($1)';
      params.push(characterIds);
    } else if (characterId !== undefined) {
      sql += ' WHERE character_id = $1';
      params.push(characterId);
    }

    const res = await this.adapter.query(sql, params);
    const row = res.rows[0] || {};

    const totalTransactionsCount = Number(row.total_tx_count || 0);
    const sellTransactionsCount = Number(row.sell_tx_count || 0);
    const buyTransactionsCount = Number(row.buy_tx_count || 0);
    const totalSellVolume = Number(row.total_sell_vol || 0);
    const totalBuyVolume = Number(row.total_buy_vol || 0);
    const totalGrossSalesIsk = Math.round((Number(row.total_gross_sales || 0) + Number.EPSILON) * 100) / 100;
    const totalBuySpendIsk = Math.round((Number(row.total_buy_spend || 0) + Number.EPSILON) * 100) / 100;
    const totalTaxesIsk = Math.round((Number(row.total_taxes || 0) + Number.EPSILON) * 100) / 100;
    const totalBrokerFeesIsk = Math.round((Number(row.total_broker_fees || 0) + Number.EPSILON) * 100) / 100;
    const totalNetSalesIsk = Math.round((totalGrossSalesIsk - totalTaxesIsk - totalBrokerFeesIsk + Number.EPSILON) * 100) / 100;

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
      distinctItemsCount: Number(row.distinct_types || 0),
      distinctLocationsCount: Number(row.distinct_locations || 0),
      completeness: totalTransactionsCount > 0 ? 'COMPLETE' : 'ABSENT',
    };
  }

  public getFilterOptions(characterId: number): LedgerFilterOptions {
    return this.fallbackMemory.getFilterOptions(characterId);
  }

  public async getFilterOptionsAsync(characterId: number): Promise<LedgerFilterOptions> {
    const typesRes = await this.adapter.query<{ id: number; name: string; count: string }>(
      `SELECT type_id as id, COALESCE(type_name, 'Item #' || type_id) as name, COUNT(*) as count
       FROM transactions WHERE character_id = $1 GROUP BY type_id, type_name ORDER BY name ASC`,
      [characterId]
    );

    const locationsRes = await this.adapter.query<{ id: string; name: string; count: string }>(
      `SELECT location_id as id, COALESCE(location_name, 'Location #' || location_id) as name, COUNT(*) as count
       FROM transactions WHERE character_id = $1 GROUP BY location_id, location_name ORDER BY name ASC`,
      [characterId]
    );

    return {
      types: typesRes.rows.map((r) => ({ id: Number(r.id), name: r.name, count: Number(r.count) })),
      locations: locationsRes.rows.map((r) => ({ id: Number(r.id), name: r.name, count: Number(r.count) })),
    };
  }

  public clearCharacter(characterId: number): void {
    this.fallbackMemory.clearCharacter(characterId);
    this.clearCharacterAsync(characterId).catch(() => {});
  }

  public async clearCharacterAsync(characterId: number): Promise<void> {
    await this.adapter.execute('DELETE FROM transactions WHERE character_id = $1', [characterId]);
    await this.adapter.execute('DELETE FROM journal_entries WHERE character_id = $1', [characterId]);
  }

  public dumpData(): { transactions: CharacterTransaction[]; journalEntries: CharacterWalletJournalEntry[] } {
    return this.fallbackMemory.dumpData();
  }

  public restoreData(data: { transactions: CharacterTransaction[]; journalEntries: CharacterWalletJournalEntry[] }): void {
    this.fallbackMemory.restoreData(data);
    this.saveTransactionsAsync(data.transactions).catch(() => {});
    this.saveJournalEntriesAsync(data.journalEntries).catch(() => {});
  }
}

export const defaultLedgerRepository = StorageManager.getInstance().getConfig().engine === 'postgres'
  ? new PostgresLedgerRepository(StorageManager.getInstance().getAdapter())
  : new PersistentLedgerRepository(StorageManager.getInstance().getAdapter());
export const ledgerRepository = defaultLedgerRepository;
