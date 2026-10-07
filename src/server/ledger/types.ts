/**
 * Domain types and contracts for the Sales & Purchases Ledger (Grand Livre)
 */

export interface TaxReconciliationDetail {
  status: 'EXACT_MATCH' | 'SEQUENTIAL_M_PLUS_1' | 'CORRELATED_BIJECTIVE' | 'UNMATCHED' | 'AMBIGUOUS';
  matchedJournalId?: number;
  taxAmount: number;
  taxRate?: number;
  justification: string;
}

export interface BrokerFeeReconciliationDetail {
  status: 'EXACT_TRANSACTION' | 'ORDER_PRO_RATA' | 'UNMATCHED';
  orderId?: number;
  totalOrderFee?: number;
  orderVolumeTotal?: number;
  orderVolumeFilled?: number;
  transactionQuantity?: number;
  allocatedFeeAmount: number;
  justification: string;
}

export interface BrokerFeeReconciliationSummary {
  totalBrokerFeesCollectedIsk: number;
  reconciledOrderFeesIsk: number;
  allocatedBrokerFeesIsk: number;
  unallocatedBrokerFeesIsk: number;
}

export interface CharacterTransaction {
  id: string; // Composite key: `${characterId}:${transactionId}`
  characterId: number;
  transactionId: number;
  date: string; // ISO 8601 UTC date from ESI (e.g. "2026-09-20T14:30:00Z")
  typeId: number;
  typeName?: string;
  quantity: number;
  unitPrice: number;
  totalValue: number; // unitPrice * quantity
  isBuy: boolean; // true = Achat (Buy), false = Vente (Sell)
  isPersonal: boolean;
  journalRefId: number;
  locationId: number;
  locationName?: string;
  clientId: number;
  clientName?: string;
  source: string; // e.g. "esi:/characters/{character_id}/wallet/transactions/"
  observedAt: number; // UTC unix timestamp in ms when recorded
  tax?: number; // Resolved transaction tax from ESI journal
  brokerFee?: number; // Resolved broker fee from ESI journal
  netValue?: number; // Total value net of taxes and broker fees (TTC)
  taxReconciliation?: TaxReconciliationDetail;
  brokerFeeReconciliation?: BrokerFeeReconciliationDetail;
}

export interface CharacterWalletJournalEntry {
  id: string; // Composite key: `${characterId}:${journalId}` or canonical `corp:${corpId}:${div}:${journalId}` / `char:${characterId}:${journalId}`
  characterId: number;
  journalId: number;
  date: string; // ISO 8601 UTC date
  refType: string; // e.g. "market_transaction", "brokers_fee", "transaction_tax", "market_escrow"
  amount?: number;
  balance?: number;
  contextId?: number;
  contextIdType?: string;
  description: string;
  firstPartyId?: number;
  firstPartyName?: string;
  secondPartyId?: number;
  secondPartyName?: string;
  reason?: string;
  tax?: number;
  taxReceiverId?: number;
  source: string; // e.g. "esi:/characters/{character_id}/wallet/journal/"
  observedAt: number; // UTC unix timestamp in ms
  isCorporationWallet?: boolean;
  corporationId?: number;
  division?: number;
  observedByCharacterIds?: number[];
}

export function makeJournalEntryKey(entry: {
  isCorporationWallet?: boolean;
  corporationId?: number;
  division?: number;
  characterId: number;
  journalId: number;
}): string {
  if (entry.isCorporationWallet && entry.corporationId) {
    const div = entry.division ?? 1;
    return `corp:${entry.corporationId}:${div}:${entry.journalId}`;
  }
  return `char:${entry.characterId}:${entry.journalId}`;
}

export type LedgerFilterType = 'ALL' | 'SELL' | 'BUY';

export interface LedgerQueryFilters {
  characterId?: number;
  type?: LedgerFilterType;
  typeId?: number;
  search?: string;
  locationId?: number;
  fromDate?: string; // ISO 8601
  toDate?: string; // ISO 8601
  sortBy?: 'date' | 'totalValue' | 'unitPrice' | 'quantity' | 'typeName';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface LedgerSummary {
  characterId: number;
  asOf: number;
  totalTransactionsCount: number;
  sellTransactionsCount: number;
  buyTransactionsCount: number;
  totalSellVolume: number; // units sold
  totalBuyVolume: number; // units bought
  totalGrossSalesIsk: number; // ISK from sales
  totalBuySpendIsk: number; // ISK spent on buys
  totalTaxesIsk: number; // ISK paid in transaction taxes
  totalBrokerFeesIsk: number; // ISK paid in brokers fees
  unallocatedBrokerFeesIsk?: number; // ISK in unallocated / cancelled / orphan broker fees
  totalBrokerFeesCollectedIsk?: number; // Total ISK of broker fee entries in journal
  totalNetSalesIsk: number; // ISK from sales after taxes & broker fees
  distinctItemsCount: number;
  distinctLocationsCount: number;
  completeness: 'COMPLETE' | 'PARTIAL' | 'ERROR' | 'UNKNOWN' | 'ABSENT';
}

export interface PaginatedLedgerResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: LedgerQueryFilters;
  summary: LedgerSummary;
  asOf: number;
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
}

export interface DistinctFilterOption {
  id: number;
  name: string;
  count: number;
}

export interface LedgerFilterOptions {
  types: DistinctFilterOption[];
  locations: DistinctFilterOption[];
}
