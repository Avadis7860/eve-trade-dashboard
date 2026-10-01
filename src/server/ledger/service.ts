import type { ILedgerRepository } from './repository.ts';
import { defaultLedgerRepository } from './repository.ts';
import type {
  CharacterTransaction,
  CharacterWalletJournalEntry,
  LedgerQueryFilters,
  PaginatedLedgerResult,
  LedgerSummary,
  LedgerFilterOptions,
} from './types.ts';

export interface TransactionDetailResult {
  transaction: CharacterTransaction;
  relatedJournalEntries: CharacterWalletJournalEntry[];
}

export class LedgerService {
  private repo: ILedgerRepository;

  constructor(repo: ILedgerRepository = defaultLedgerRepository) {
    this.repo = repo;
  }

  /**
   * Retrieves paginated transactions applying domain filters and sort orders
   */
  public getTransactions(
    characterId: number,
    params: Partial<LedgerQueryFilters>
  ): PaginatedLedgerResult<CharacterTransaction> {
    const filters: LedgerQueryFilters = {
      characterId,
      type: params.type || 'ALL',
      typeId: params.typeId !== undefined ? Number(params.typeId) : undefined,
      search: params.search,
      locationId: params.locationId !== undefined ? Number(params.locationId) : undefined,
      fromDate: params.fromDate,
      toDate: params.toDate,
      sortBy: params.sortBy || 'date',
      sortOrder: params.sortOrder || 'desc',
      page: params.page ? Number(params.page) : 1,
      pageSize: params.pageSize ? Number(params.pageSize) : 50,
    };

    return this.repo.getTransactions(filters);
  }

  /**
   * Retrieves single transaction with related wallet journal entries (fees, taxes, escrow)
   */
  public getTransactionDetail(
    characterId: number,
    transactionId: number
  ): TransactionDetailResult | null {
    const transaction = this.repo.getTransactionById(characterId, transactionId);
    if (!transaction) {
      return null;
    }

    const { entries: relatedJournalEntries } = this.repo.getJournalEntriesForTransaction(
      characterId,
      transactionId,
      transaction.journalRefId
    );

    return {
      transaction,
      relatedJournalEntries,
    };
  }

  /**
   * Retrieves paginated journal entries
   */
  public getJournalEntries(
    characterId: number,
    page = 1,
    pageSize = 50
  ): { items: CharacterWalletJournalEntry[]; total: number; page: number; pageSize: number } {
    const res = this.repo.getJournalEntries(characterId, page, pageSize);
    return {
      items: res.items,
      total: res.total,
      page,
      pageSize,
    };
  }

  /**
   * Retrieves ledger summary
   */
  public getSummary(characterId?: number, characterIds?: number[]): LedgerSummary {
    return this.repo.getSummary(characterId, characterIds);
  }

  /**
   * Retrieves all transactions without arbitrary pagination cap
   */
  public getAllTransactions(characterId?: number, characterIds?: number[]): CharacterTransaction[] {
    return this.repo.getAllTransactions(characterId, characterIds);
  }

  /**
   * Retrieves transactions for a specific item type without scanning the full ledger
   */
  public getTransactionsByTypeId(typeId: number, characterId?: number, characterIds?: number[]): CharacterTransaction[] {
    if (this.repo.getTransactionsByTypeId) {
      return this.repo.getTransactionsByTypeId(typeId, characterId, characterIds);
    }
    return this.repo.getAllTransactions(characterId, characterIds).filter((t) => t.typeId === typeId);
  }

  /**
   * Retrieves last activity dates by character, type, and location
   */
  public getLastActivityDates(characterId?: number, characterIds?: number[]): Map<string, number> {
    if (this.repo.getLastActivityDates) {
      return this.repo.getLastActivityDates(characterId, characterIds);
    }
    const allTxs = this.repo.getAllTransactions(characterId, characterIds);
    const map = new Map<string, number>();
    for (const tx of allTxs) {
      const key = `${tx.characterId}:${tx.typeId}:${tx.locationId}`;
      const time = new Date(tx.date).getTime();
      const existing = map.get(key) || 0;
      if (time > existing) {
        map.set(key, time);
      }
    }
    return map;
  }

  /**
   * Retrieves filter options
   */
  public getFilterOptions(characterId: number): LedgerFilterOptions {
    return this.repo.getFilterOptions(characterId);
  }
}

export const defaultLedgerService = new LedgerService();
