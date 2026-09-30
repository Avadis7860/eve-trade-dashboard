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

    // Look for matching journal entries by journalRefId or contextId
    const relatedJournalEntries: CharacterWalletJournalEntry[] = [];
    const allJournal = this.repo.getJournalEntries(characterId, 1, 500);

    for (const jn of allJournal.items) {
      if (
        (transaction.journalRefId && jn.journalId === transaction.journalRefId) ||
        (jn.contextId && jn.contextId === transaction.transactionId)
      ) {
        relatedJournalEntries.push(jn);
      }
    }

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
  public getSummary(characterId: number): LedgerSummary {
    return this.repo.getSummary(characterId);
  }

  /**
   * Retrieves filter options
   */
  public getFilterOptions(characterId: number): LedgerFilterOptions {
    return this.repo.getFilterOptions(characterId);
  }
}

export const defaultLedgerService = new LedgerService();
