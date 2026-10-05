import React, { useState, useEffect } from 'react';
import {
  LogOut,
  UserPlus,
  ChevronDown,
  X,
  FileText,
  ClipboardList,
  ShoppingCart,
  MapPin,
  Building2,
  Link2,
  AlertTriangle,
  Key,
  LogIn,
  Settings,
  Shield,
  Users,
} from 'lucide-react';

import { DashboardOverview } from './components/DashboardOverview';
import { PreferencesModal } from './components/PreferencesModal';
import { Product360Modal } from './components/Product360Modal';
import { AnalyticsView } from './components/AnalyticsView';
import { PositionsView } from './components/PositionsView';
import { OperationsView } from './components/OperationsView';
import { TransactionsView } from './components/TransactionsView';
import { ConfigurationView } from './components/ConfigurationView';
import { SystemRoadmapView } from './components/SystemRoadmapView';
import { LedgerView } from './components/LedgerView';
import { OrdersView } from './components/OrdersView';
import { RestockView } from './components/RestockView';
import { HubsRoiView } from './components/HubsRoiView';
import { CapitalView } from './components/CapitalView';
import { JournalView } from './components/JournalView';
import { EsiDiagnosticDrawer } from './components/drawers/EsiDiagnosticDrawer';

import {
  loadPreferences,
  savePreferences,
  UserPreferences,
  formatIskValue,
} from './utils/preferences';
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
  useApiQuery,
  fetchJson,
  setStoredSessionId,
} from './utils/apiClient';

export interface HealthStatus {
  status: string;
  service: string;
  timestamp: string;
  version: string;
}

export interface CharacterSession {
  characterId: number;
  characterName: string;
  portraitUrl: string;
  scopes: string[];
  expiresAt: number;
  isActive?: boolean;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  sessionId?: string;
  character?: CharacterSession;
  characters?: CharacterSession[];
}

export interface AuthStatusResponse {
  configured: boolean;
}

export interface EsiStatusResponse {
  rateLimit: {
    errorLimitRemain: number;
    errorLimitResetSeconds: number;
    isSuspended: boolean;
    suspendedUntil: number;
    activeRequests: number;
  };
  cacheSize: number;
}

export interface CharacterTransaction {
  id: string;
  characterId: number;
  transactionId: number;
  date: string;
  typeId: number;
  typeName?: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  isBuy: boolean;
  isPersonal: boolean;
  journalRefId: number;
  locationId: number;
  locationName?: string;
  clientId: number;
  clientName?: string;
  source: string;
  observedAt: number;
  tax?: number;
  brokerFee?: number;
  netValue?: number;
}

export interface CharacterWalletJournalEntry {
  id: string;
  characterId: number;
  journalId: number;
  date: string;
  refType: string;
  amount?: number;
  balance?: number;
  contextId?: number;
  contextIdType?: string;
  description: string;
  tax?: number;
  source: string;
  observedAt: number;
}

export type OrderLifecycleState =
  | 'ACTIVE'
  | 'PARTIALLY_FILLED'
  | 'COMPLETED_CONFIRMED'
  | 'CANCELLED_CONFIRMED'
  | 'EXPIRED_CONFIRMED'
  | 'DISAPPEARED_UNCONFIRMED'
  | 'UNKNOWN';

export interface CharacterOrderSnapshot {
  id: string;
  characterId: number;
  orderId: number;
  typeId: number;
  typeName?: string;
  regionId: number;
  locationId: number;
  locationName?: string;
  isBuyOrder: boolean;
  price: number;
  volumeTotal: number;
  volumeRemain: number;
  volumeFilled: number;
  issued: string;
  duration: number;
  expiresAt: string;
  escrow?: number;
  state: OrderLifecycleState;
  stateJustification: string;
  firstObservedAt: number;
  lastObservedAt: number;
  isActiveInCurrentSnapshot: boolean;
  inStockQuantity?: number;
}

export interface OrderSummaryMetrics {
  characterId: number;
  asOf: number;
  totalOrdersTracked: number;
  activeOrdersCount: number;
  partiallyFilledCount: number;
  completedCount: number;
  cancelledCount: number;
  expiredCount: number;
  disappearedCount: number;
  totalActiveIskValue: number;
  totalActiveEscrowIsk: number;
}

export type RestockItemStatus = 'SUGGESTED' | 'PLANNED' | 'PURCHASED' | 'DISMISSED';

export interface RestockItem {
  id: string;
  characterId: number;
  typeId: number;
  typeName: string;
  targetBuyHubId: number;
  targetBuyHubName: string;
  sellHubId: number;
  sellHubName: string;
  suggestedQuantity: number;
  targetQuantity: number;
  estimatedBuyUnitPrice?: number;
  totalCostEstimate?: number;
  status: RestockItemStatus;
  justification: string;
  linkedOrderId?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HubDefinition {
  id: string;
  name: string;
  system_name?: string;
  is_system_default: boolean;
  notes?: string;
  created_at: string;
}

export interface HubLocationMapping {
  location_id: number;
  location_name: string;
  hub_id: string;
  notes?: string;
  updated_at: string;
}

export interface HubPairPerformance {
  buy_hub_id: string;
  buy_hub_name: string;
  sell_hub_id: string;
  sell_hub_name: string;
  sold_volume_total: number;
  sold_volume_allocated: number;
  gross_revenue: number;
  gross_revenue_allocated?: number;
  gross_revenue_unallocated?: number;
  allocated_buy_cost: number;
  allocated_buy_fees: number;
  attributable_sell_fees: number;
  allocated_sell_taxes?: number;
  allocated_sell_broker_fees?: number;
  realized_profit_ttc: number | null;
  roi_percent_ttc: number | null;
  coverage_status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'EMPTY';
  coverage_percent: number;
  volume_coverage_percent?: number;
  financial_coverage_percent?: number;
  transaction_count: number;
}

export interface OpeningBalanceLot {
  id: string;
  character_id: number;
  type_id: number;
  type_name: string;
  quantity: number;
  allocated_quantity: number;
  remaining_quantity: number;
  unit_cost_isk: number;
  total_cost_isk: number;
  location_id: number;
  location_name?: string;
  hub_id: string;
  hub_name: string;
  acquisition_date: string;
  justification: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface FormulaProof {
  as_of: string;
  gross_revenue_isk: number;
  gross_revenue_total_isk?: number;
  gross_revenue_allocated_isk?: number;
  gross_revenue_unallocated_isk?: number;
  allocated_buy_cost_isk: number;
  allocated_buy_fees_isk: number;
  allocated_sell_fees_isk: number;
  allocated_sell_taxes_isk?: number;
  allocated_sell_broker_fees_isk?: number;
  total_investment_ttc_isk: number;
  realized_profit_ttc_isk: number | null;
  roi_percent_ttc: number | null;
  formula_expression: string;
  numerator_isk: number | null;
  denominator_isk: number | null;
}

export interface SaleReconciliationDetail {
  sale_transaction_id: number;
  sale_character_id: number;
  date: string;
  type_id: number;
  type_name: string;
  quantity_sold: number;
  unit_sale_price_isk: number;
  gross_revenue_isk: number;
  gross_revenue_total_isk?: number;
  gross_revenue_allocated_isk?: number;
  gross_revenue_unallocated_isk?: number;
  allocated_quantity: number;
  unallocated_quantity: number;
  allocated_buy_cost_isk: number;
  allocated_buy_fees_isk: number;
  allocated_sell_fees_isk: number;
  allocated_sell_taxes_isk?: number;
  allocated_sell_broker_fees_isk?: number;
  total_investment_ttc_isk: number;
  realized_profit_ttc_isk: number | null;
  roi_percent_ttc: number | null;
  coverage_status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'EMPTY';
  coverage_percent: number;
  volume_coverage_percent?: number;
  financial_coverage_percent?: number;
  location_id: number;
  location_name?: string;
  hub_id: string;
  hub_name: string;
  allocations: ExplicitCostAllocation[];
  proof: FormulaProof;
}

export interface ExplicitCostAllocation {
  id: string;
  character_id: number;
  buy_character_id?: number;
  sell_character_id?: number;
  sell_transaction_id: number;
  source_type?: 'TRANSACTION' | 'OPENING_BALANCE';
  buy_transaction_id?: number;
  opening_balance_id?: string;
  type_id: number;
  type_name: string;
  quantity_allocated: number;
  unit_buy_price: number;
  allocated_buy_cost: number;
  allocated_buy_fees: number;
  allocated_sell_fees: number;
  allocated_sell_taxes?: number;
  allocated_sell_broker_fees?: number;
  buy_hub_id: string;
  buy_hub_name: string;
  sell_hub_id: string;
  sell_hub_name: string;
  created_at: string;
  notes?: string;
}

export interface UnsoldInventoryItem {
  character_id: number;
  source_type?: 'TRANSACTION' | 'OPENING_BALANCE';
  buy_transaction_id?: number;
  opening_balance_id?: string;
  type_id: number;
  type_name: string;
  buy_date: string;
  original_quantity: number;
  allocated_quantity: number;
  remaining_quantity: number;
  unit_buy_price: number;
  tied_capital_isk: number;
  allocated_buy_fees_remaining: number;
  location_id: number;
  hub_id: string;
  hub_name: string;
  justification?: string;
}

export interface RoiFinancialSummary {
  version?: number;
  as_of: string;
  character_id?: number;
  period_label: string;
  total_sales_volume: number;
  allocated_sales_volume: number;
  unallocated_sales_volume: number;
  gross_revenue_isk: number;
  gross_revenue_total_isk?: number;
  gross_revenue_allocated_isk?: number;
  gross_revenue_unallocated_isk?: number;
  allocated_buy_cost_isk: number;
  allocated_buy_fees_isk: number;
  attributable_sell_fees_isk: number;
  allocated_sell_taxes_isk?: number;
  allocated_sell_broker_fees_isk?: number;
  unallocated_broker_fees_isk?: number;
  total_broker_fees_collected_isk?: number;
  total_allocated_investment_ttc: number;
  realized_profit_ttc_isk: number | null;
  roi_percent_ttc: number | null;
  tied_up_capital_isk: number;
  unsold_items_count: number;
  coverage_status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'EMPTY';
  coverage_percent: number;
  volume_coverage_percent?: number;
  financial_coverage_percent?: number;
  financial_coverage_status?: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'EMPTY';
  proof?: FormulaProof;
  hub_pairs: HubPairPerformance[];
}

export interface LedgerSummary {
  characterId: number;
  asOf: number;
  totalTransactionsCount: number;
  sellTransactionsCount: number;
  buyTransactionsCount: number;
  totalSellVolume: number;
  totalBuyVolume: number;
  totalGrossSalesIsk: number;
  totalBuySpendIsk: number;
  totalTaxesIsk?: number;
  totalBrokerFeesIsk?: number;
  totalNetSalesIsk?: number;
  distinctItemsCount: number;
  distinctLocationsCount: number;
  completeness: 'COMPLETE' | 'PARTIAL' | 'ERROR' | 'UNKNOWN' | 'ABSENT';
}

export interface SyncStatusResponse {
  characterId: number;
  transactions: {
    status: 'IDLE' | 'SYNCING' | 'COMPLETE' | 'PARTIAL' | 'ERROR';
    lastSyncCompletedAt?: number;
    totalRecords: number;
  };
  journal: {
    status: 'IDLE' | 'SYNCING' | 'COMPLETE' | 'PARTIAL' | 'ERROR';
    totalRecords: number;
  };
  orders?: {
    status: 'IDLE' | 'SYNCING' | 'COMPLETE' | 'PARTIAL' | 'ERROR';
    lastSyncCompletedAt?: number;
    totalRecords: number;
  };
  assets?: {
    status: 'IDLE' | 'SYNCING' | 'COMPLETE' | 'PARTIAL' | 'ERROR';
    lastSyncCompletedAt?: number;
    totalRecords: number;
  };
  wallet?: {
    status: 'IDLE' | 'SYNCING' | 'COMPLETE' | 'PARTIAL' | 'ERROR';
    lastSyncCompletedAt?: number;
    totalRecords: number;
  };
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN' | 'PARTIAL';
}

export default function App({ client }: { client?: QueryClient } = {}) {
  const [queryClient] = useState(() => client ?? new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AppDashboard />
    </QueryClientProvider>
  );
}

function AppDashboard() {
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<UserPreferences>(loadPreferences());
  const [showPreferencesModal, setShowPreferencesModal] = useState(false);

  // Top-level queries
  const { data: health = null } = useApiQuery<HealthStatus>(
    ['health'],
    () => fetchJson('/api/health'),
    { ttl: 60_000 }
  );

  const { data: authStatusData } = useApiQuery<AuthStatusResponse>(
    ['auth', 'status'],
    () => fetchJson('/api/auth/status'),
    { ttl: 60_000 }
  );
  const authConfigured = authStatusData ? authStatusData.configured : null;

  const {
    data: sessionData,
    isLoading: sessionLoading,
  } = useApiQuery<AuthSessionResponse>(
    ['auth', 'session'],
    () => fetchJson('/api/auth/session'),
    { ttl: 30_000 }
  );

  const session = sessionData?.authenticated ? sessionData.character ?? null : null;
  const linkedCharacters = sessionData?.authenticated
    ? sessionData.characters ?? (session ? [session] : [])
    : [];
  const loading = sessionLoading;

  const { data: esiStatus = null } = useApiQuery<EsiStatusResponse>(
    ['esi', 'status'],
    () => fetchJson('/api/esi/status'),
    { ttl: 15_000 }
  );

  const [showCharacterDropdown, setShowCharacterDropdown] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Active Tab View & 6 Decision Workspaces
  const [activeTab, setActiveTab] = useState<string>(
    preferences.defaultLandingTab || 'overview'
  );
  const [positionsSubTab, setPositionsSubTab] = useState<'orders' | 'inventory'>('orders');
  const [operationsSubTab, setOperationsSubTab] = useState<'transfers' | 'purchases'>('purchases');
  const [transactionsSubTab, setTransactionsSubTab] = useState<'ledger' | 'journal' | 'reconciliation'>('ledger');
  const [configSubTab, setConfigSubTab] = useState<'characters' | 'hubs' | 'backups' | 'diagnostics' | 'roadmap'>('characters');
  const [showEsiDrawer, setShowEsiDrawer] = useState(false);

  // Product 360 Inspection Modal State
  const [selectedProduct360TypeId, setSelectedProduct360TypeId] = useState<number | null>(null);

  // Sync state & queries
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const { data: syncStatus = null } = useApiQuery<SyncStatusResponse>(
    ['ledger', 'sync-status'],
    () => fetchJson('/api/ledger/sync-status'),
    { enabled: !!session, ttl: 15_000 }
  );

  const linkedCharIds = linkedCharacters.length > 1
    ? linkedCharacters.map((c) => c.characterId)
    : session ? [session.characterId] : [];
  const charIdsQuery = linkedCharacters.length > 1
    ? `?character_ids=${linkedCharacters.map((c) => c.characterId).join(',')}`
    : '';

  // Ledger state & filters
  const [filterType, setFilterType] = useState<'ALL' | 'SELL' | 'BUY'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selectedTx, setSelectedTx] = useState<CharacterTransaction | null>(null);
  const [selectedTxDetail, setSelectedTxDetail] = useState<{
    transaction: CharacterTransaction;
    relatedJournalEntries: CharacterWalletJournalEntry[];
  } | null>(null);

  const { data: summary = null } = useApiQuery<LedgerSummary>(
    ['ledger', 'summary', ...linkedCharIds],
    (signal) => fetchJson(`/api/ledger/summary${charIdsQuery}`, { signal }),
    { enabled: !!session, ttl: 30_000 }
  );

  const { data: optionsData } = useApiQuery<{ locations?: { id: number; name: string; count: number }[] }>(
    ['ledger', 'filter-options'],
    (signal) => fetchJson('/api/ledger/filter-options', { signal }),
    { enabled: !!session, ttl: 300_000 }
  );
  const distinctLocations = optionsData?.locations || [];

  const {
    data: txData,
    isLoading: ledgerLoading,
  } = useApiQuery<{ items: CharacterTransaction[]; total: number; totalPages: number }>(
    ['ledger', 'transactions', page, preferences.tablePageSize || 25, filterType, searchQuery, selectedLocation],
    async (signal) => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(preferences.tablePageSize || 25),
        type: filterType,
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(selectedLocation ? { locationId: selectedLocation } : {}),
      });
      return fetchJson(`/api/ledger/transactions?${params.toString()}`, { signal });
    },
    { enabled: !!session, ttl: 15_000 }
  );
  const transactions = txData?.items || [];
  const totalPages = txData?.totalPages || 1;
  const totalCount = txData?.total || 0;

  const { data: journalData } = useApiQuery<{ items: CharacterWalletJournalEntry[]; total: number }>(
    ['ledger', 'journal', 50],
    (signal) => fetchJson('/api/ledger/journal?pageSize=50', { signal }),
    { enabled: !!session, ttl: 30_000 }
  );
  const journalEntries = journalData?.items || [];

  // Orders State & queries
  const [selectedOrder, setSelectedOrder] = useState<CharacterOrderSnapshot | null>(null);
  const [orderStateFilter, setOrderStateFilter] = useState<OrderLifecycleState | 'ALL'>('ALL');
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersSearch, setOrdersSearch] = useState('');

  const { data: orderSummary = null } = useApiQuery<OrderSummaryMetrics>(
    ['orders', 'summary', ...linkedCharIds],
    (signal) => fetchJson('/api/orders/summary', { signal }),
    { enabled: !!session, ttl: 30_000 }
  );

  const { data: ordersData } = useApiQuery<{ items: CharacterOrderSnapshot[]; total: number; totalPages: number }>(
    ['orders', 'list', preferences.hideCompletedOrders],
    async (signal) => {
      return fetchJson(`/api/orders?pageSize=500`, { signal });
    },
    { enabled: !!session, ttl: 15_000 }
  );
  const rawOrders = ordersData?.items || [];
  const orders = preferences.hideCompletedOrders
    ? rawOrders.filter((o) => o.state === 'ACTIVE' || o.state === 'PARTIALLY_FILLED' || o.state === 'DISAPPEARED_UNCONFIRMED')
    : rawOrders;

  // Restock State & queries
  const [isGeneratingRestock, setIsGeneratingRestock] = useState(false);
  const [showAddRestockModal, setShowAddRestockModal] = useState(false);
  const [newRestockForm, setNewRestockForm] = useState({
    typeId: 34,
    typeName: 'Tritanium',
    targetBuyHubId: 60003760,
    targetBuyHubName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    sellHubId: 60008494,
    sellHubName: 'Amarr VIII (Oris) - Emperor Family Academy',
    suggestedQuantity: 10000,
    targetQuantity: 10000,
    justification: 'Approvisionnement manuel planifié',
    notes: '',
  });

  const { data: restockData } = useApiQuery<{ items: RestockItem[] }>(
    ['orders', 'restock'],
    (signal) => fetchJson('/api/orders/restock', { signal }),
    { enabled: !!session, ttl: 30_000 }
  );
  const restockItems = restockData?.items || [];

  // Hubs & ROI TTC State & queries
  const { data: roiSummaryData } = useApiQuery<{ summary: RoiFinancialSummary }>(
    ['roi', 'summary', ...linkedCharIds],
    (signal) => fetchJson(`/api/roi/summary${charIdsQuery}`, { signal }),
    { enabled: !!session, ttl: 30_000 }
  );
  const roiSummary = roiSummaryData?.summary || null;

  const { data: allocData } = useApiQuery<{ allocations: ExplicitCostAllocation[] }>(
    ['roi', 'allocations', ...linkedCharIds],
    (signal) => fetchJson(`/api/roi/allocations${charIdsQuery}`, { signal }),
    { enabled: !!session, ttl: 30_000 }
  );
  const allocations = allocData?.allocations || [];

  const { data: unsoldInvData } = useApiQuery<{ inventory: UnsoldInventoryItem[] }>(
    ['roi', 'unsold-inventory', ...linkedCharIds],
    (signal) => fetchJson(`/api/roi/unsold-inventory${charIdsQuery}`, { signal }),
    { enabled: !!session, ttl: 30_000 }
  );
  const unsoldInventory = unsoldInvData?.inventory || [];

  const { data: hubsData } = useApiQuery<{ hubs: HubDefinition[] }>(
    ['hubs', 'list'],
    (signal) => fetchJson('/api/hubs', { signal }),
    { enabled: !!session, ttl: 300_000 }
  );
  const hubsList = hubsData?.hubs || [];

  const { data: hubsMapData } = useApiQuery<{ mappings: HubLocationMapping[] }>(
    ['hubs', 'mappings'],
    (signal) => fetchJson('/api/hubs/mappings', { signal }),
    { enabled: !!session, ttl: 300_000 }
  );
  const hubsMappings = hubsMapData?.mappings || [];

  const [showAddHubModal, setShowAddHubModal] = useState(false);
  const [showAddMappingModal, setShowAddMappingModal] = useState(false);
  const [showAddAllocationModal, setShowAddAllocationModal] = useState(false);
  const [newHubForm, setNewHubForm] = useState({ name: '', system_name: '', notes: '' });
  const [newMappingForm, setNewMappingForm] = useState({ location_id: 0, location_name: '', hub_id: 'hub-jita', notes: '' });
  const [newAllocForm, setNewAllocForm] = useState({
    sell_transaction_id: 0,
    buy_transaction_id: 0,
    quantity_to_allocate: 0,
    notes: '',
  });
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);

  const handleGenerateRestock = async () => {
    if (isGeneratingRestock || !session) return;
    setIsGeneratingRestock(true);
    try {
      const res = await fetch('/api/orders/restock/generate', { method: 'POST' });
      if (res.ok) {
        queryClient.invalidateQueries(['orders', 'restock']);
        queryClient.invalidateQueries(['operations']);
      }
    } catch (err) {
      console.error('Failed to generate restock:', err);
    } finally {
      setIsGeneratingRestock(false);
    }
  };

  const handleDeleteRestockItem = async (id: string) => {
    try {
      const res = await fetch(`/api/orders/restock/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        queryClient.invalidateQueries(['orders', 'restock']);
        queryClient.invalidateQueries(['operations']);
      }
    } catch (err) {
      console.error('Failed to delete item:', err);
    }
  };

  const handleDeleteAllocation = async (id: string) => {
    try {
      const res = await fetch(`/api/roi/allocations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        queryClient.invalidateQueries(['roi']);
      }
    } catch (err) {
      console.error('Failed to delete allocation:', err);
    }
  };

  const handleInspectOrder = (order: CharacterOrderSnapshot) => {
    setSelectedOrder(order);
  };

  const handleQuickAddRestock = (order: CharacterOrderSnapshot) => {
    setNewRestockForm({
      typeId: order.typeId,
      typeName: order.typeName || `Type #${order.typeId}`,
      targetBuyHubId: 60003760,
      targetBuyHubName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
      sellHubId: order.locationId,
      sellHubName: order.locationName || `Emplacement #${order.locationId}`,
      suggestedQuantity: order.volumeTotal,
      targetQuantity: order.volumeTotal,
      justification: `Réapprovisionnement suite à l'ordre #${order.orderId}`,
      notes: '',
    });
    setShowAddRestockModal(true);
  };

  // Sync handler with targeted query invalidations
  const handleSync = async () => {
    if (isSyncing || !session) return;
    setIsSyncing(true);
    setSyncError(null);

    try {
      const res = await fetch('/api/ledger/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.errors && data.errors.length > 0) {
          setSyncError(data.errors.join(' | '));
        }
        queryClient.invalidateQueries(['ledger']);
        queryClient.invalidateQueries(['orders']);
        queryClient.invalidateQueries(['roi']);
        queryClient.invalidateQueries(['capital']);
        queryClient.invalidateQueries(['analytics']);
        queryClient.invalidateQueries(['esi']);
      } else {
        const errJson = await res.json().catch(() => null);
        setSyncError(errJson?.error || `Erreur de synchronisation (${res.status})`);
      }
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncError((err as Error).message || 'Erreur réseau lors de la synchronisation');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleInspectTransaction = async (tx: CharacterTransaction) => {
    setSelectedTx(tx);
    try {
      const detail = await fetchJson<{
        transaction: CharacterTransaction;
        relatedJournalEntries: CharacterWalletJournalEntry[];
      }>(`/api/ledger/transactions/${tx.transactionId}`);
      setSelectedTxDetail(detail);
    } catch {
      setSelectedTxDetail({ transaction: tx, relatedJournalEntries: [] });
    }
  };

  const handleCreateRestockItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/orders/restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRestockForm),
      });
      if (res.ok) {
        setShowAddRestockModal(false);
        queryClient.invalidateQueries(['orders', 'restock']);
      }
    } catch (err) {
      console.error('Failed to create restock item:', err);
    }
  };

  const handleQuickAllocate = (tx: CharacterTransaction) => {
    setNewAllocForm({
      sell_transaction_id: tx.transactionId,
      buy_transaction_id: 0,
      quantity_to_allocate: tx.quantity,
      notes: `Rapprochement direct pour vente #${tx.transactionId} (${tx.typeName})`,
    });
    setShowAddAllocationModal(true);
  };

  const handleCreateHub = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/hubs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHubForm),
      });
      if (res.ok) {
        setShowAddHubModal(false);
        setNewHubForm({ name: '', system_name: '', notes: '' });
        queryClient.invalidateQueries(['hubs']);
        queryClient.invalidateQueries(['roi']);
      }
    } catch (err) {
      console.error('Failed to create hub:', err);
    }
  };

  const handleDeleteHub = async (hubId: string) => {
    try {
      const res = await fetch(`/api/hubs/${encodeURIComponent(hubId)}`, { method: 'DELETE' });
      if (res.ok) {
        queryClient.invalidateQueries(['hubs']);
        queryClient.invalidateQueries(['roi']);
      }
    } catch (err) {
      console.error('Failed to delete hub:', err);
    }
  };

  const handleCreateMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/hubs/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMappingForm),
      });
      if (res.ok) {
        setShowAddMappingModal(false);
        setNewMappingForm({ location_id: 0, location_name: '', hub_id: 'hub-jita', notes: '' });
        queryClient.invalidateQueries(['hubs']);
        queryClient.invalidateQueries(['roi']);
      }
    } catch (err) {
      console.error('Failed to create mapping:', err);
    }
  };

  const handleDeleteMapping = async (locationId: number) => {
    try {
      const res = await fetch(`/api/hubs/mappings/${locationId}`, { method: 'DELETE' });
      if (res.ok) {
        queryClient.invalidateQueries(['hubs']);
        queryClient.invalidateQueries(['roi']);
      }
    } catch (err) {
      console.error('Failed to delete mapping:', err);
    }
  };

  const handleAutoDiscoverHubs = async () => {
    try {
      const res = await fetch('/api/hubs/auto-discover', { method: 'POST' });
      if (res.ok) {
        queryClient.invalidateQueries(['hubs']);
        queryClient.invalidateQueries(['roi']);
      }
    } catch (err) {
      console.error('Failed to auto-discover hubs:', err);
    }
  };

  const handleCreateAllocation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/roi/allocations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: session?.characterId,
          sell_transaction_id: Number(newAllocForm.sell_transaction_id),
          buy_transaction_id: Number(newAllocForm.buy_transaction_id),
          quantity_to_allocate: Number(newAllocForm.quantity_to_allocate),
          notes: newAllocForm.notes,
        }),
      });
      if (res.ok) {
        setShowAddAllocationModal(false);
        setNewAllocForm({ sell_transaction_id: 0, buy_transaction_id: 0, quantity_to_allocate: 0, notes: '' });
        queryClient.invalidateQueries(['roi']);
      }
    } catch (err) {
      console.error('Failed to create allocation:', err);
    }
  };

  const handleAutoReconcile = async () => {
    if (isReconciling || !session) return;
    setIsReconciling(true);
    setReconcileMessage(null);
    try {
      const payload = linkedCharacters.length > 1
        ? { character_ids: linkedCharacters.map((c) => c.characterId) }
        : { character_id: session.characterId };

      const res = await fetch('/api/roi/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        const scopeLabel = linkedCharacters.length > 1
          ? `écosystème multi-personnages (${linkedCharacters.length} persos)`
          : session.characterName;
        const assetMsg = data.result.sales_with_asset_stock_identified > 0
          ? ` · ${data.result.sales_with_asset_stock_identified} ventes avec stock physique identifié dans les actifs ESI (${data.result.asset_stock_available_units?.toLocaleString()} un.)`
          : '';
        setReconcileMessage(
          `${data.result.allocations_created} allocations créées (${data.result.total_quantity_reconciled} unités rapprochées en FIFO pour ${scopeLabel})${assetMsg}`
        );
        queryClient.invalidateQueries(['roi']);
      }
    } catch (err) {
      console.error('Failed to run auto-reconciliation:', err);
    } finally {
      setIsReconciling(false);
    }
  };

  const handleSavePreferences = (updated: Partial<UserPreferences>) => {
    const saved = savePreferences(updated);
    setPreferences(saved);
    queryClient.invalidateQueries(['capital']);
    queryClient.invalidateQueries(['orders']);
    queryClient.invalidateQueries(['ledger']);
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('auth_error');
    const successParam = urlParams.get('auth');
    const sessionIdParam = urlParams.get('session_id');

    if (sessionIdParam) {
      setStoredSessionId(sessionIdParam);
    }
    if (errorParam) {
      setAuthError(decodeURIComponent(errorParam));
    }
    if (successParam || errorParam || sessionIdParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
      queryClient.invalidateQueries(['auth']);
    }
  }, [queryClient]);

  useEffect(() => {
    if (sessionData?.sessionId) {
      setStoredSessionId(sessionData.sessionId);
    } else if (sessionData && !sessionData.authenticated) {
      setStoredSessionId(null);
    }
  }, [sessionData]);

  const handleSwitchCharacter = async (characterId: number) => {
    try {
      const res = await fetch('/api/auth/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      });
      if (res.ok) {
        setShowCharacterDropdown(false);
        queryClient.invalidateQueries(['auth']);
        queryClient.invalidateQueries(['ledger']);
        queryClient.invalidateQueries(['orders']);
        queryClient.invalidateQueries(['roi']);
        queryClient.invalidateQueries(['capital']);
        queryClient.invalidateQueries(['analytics']);
      }
    } catch (err) {
      console.error('Failed to switch character:', err);
    }
  };

  const handleUnlinkCharacter = async (characterId: number) => {
    try {
      const res = await fetch(`/api/auth/character/${characterId}`, { method: 'DELETE' });
      if (res.ok) {
        queryClient.invalidateQueries(['auth']);
        queryClient.invalidateQueries(['ledger']);
        queryClient.invalidateQueries(['orders']);
        queryClient.invalidateQueries(['roi']);
        queryClient.invalidateQueries(['capital']);
        queryClient.invalidateQueries(['analytics']);
      }
    } catch (err) {
      console.error('Failed to unlink character:', err);
    }
  };

  useEffect(() => {
    const onFocus = () => {
      queryClient.invalidateQueries(['auth', 'session']);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('visibilitychange', onFocus);
    };
  }, [queryClient]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setStoredSessionId(null);
      queryClient.clear();
    }
  };

  const handleNavigateTab = (tab: string, subTab?: string) => {
    if (tab === 'positions' || tab === 'orders' || tab === 'capital') {
      setActiveTab(tab === 'orders' || tab === 'capital' ? tab : 'positions');
      if (subTab === 'inventory' || tab === 'capital') setPositionsSubTab('inventory');
      else setPositionsSubTab('orders');
    } else if (tab === 'operations' || tab === 'restock') {
      setActiveTab(tab === 'restock' ? 'restock' : 'operations');
      if (subTab === 'transfers') setOperationsSubTab('transfers');
      else setOperationsSubTab('purchases');
    } else if (tab === 'transactions' || tab === 'ledger' || tab === 'journal') {
      setActiveTab(tab === 'ledger' || tab === 'journal' ? tab : 'transactions');
      if (subTab === 'journal' || tab === 'journal') setTransactionsSubTab('journal');
      else if (subTab === 'reconciliation') setTransactionsSubTab('reconciliation');
      else setTransactionsSubTab('ledger');
    } else if (tab === 'configuration' || tab === 'roadmap' || tab === 'hubs-config') {
      setActiveTab(tab === 'roadmap' ? 'roadmap' : 'configuration');
      if (subTab === 'roadmap' || tab === 'roadmap') setConfigSubTab('roadmap');
      else if (subTab === 'hubs' || tab === 'hubs-config') setConfigSubTab('hubs');
      else if (subTab === 'backups' || subTab === 'backup') setConfigSubTab('backups');
      else if (subTab === 'diagnostics' || subTab === 'system') setConfigSubTab('diagnostics');
      else setConfigSubTab('characters');
    } else if (tab === 'analytics' || tab === 'hubs-roi') {
      setActiveTab(tab === 'hubs-roi' ? 'hubs-roi' : 'analytics');
    } else {
      setActiveTab('overview');
    }
  };

  const formatIsk = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return formatIskValue(val, preferences.iskDisplayMode);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Bar Contract: Zone 1 (Brand), Zone 2 (6 Canonical Workspaces), Zone 3 (ESI Status & Actions) */}
      <header className="border-b border-slate-800/80 bg-slate-900/70 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Zone 1: Wordmark */}
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-mono font-bold text-base">
              Ω
            </div>
            <a href="/" className="text-base font-bold tracking-tight text-white hover:text-amber-300 transition-colors">
              EVE Trade Dashboard
            </a>
          </div>

          {/* Zone 2: 6 Decision Workspaces Navigation Links */}
          {session && (
            <nav className="hidden lg:flex items-center space-x-1">
              <button
                onClick={() => handleNavigateTab('overview')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'overview'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
                title="Cockpit décisionnel & synthèse patrimoniale"
              >
                1. Cockpit
                <span className="sr-only">Vue d'Ensemble</span>
              </button>
              <button
                onClick={() => handleNavigateTab('positions')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'positions' || activeTab === 'orders' || activeTab === 'capital'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
                title="Marché & inventaire physique"
              >
                2. Positions
                <span className="sr-only" onClick={(e) => { e.stopPropagation(); handleNavigateTab('orders'); }}>
                  Ordres &amp; Marché
                </span>
                <span className="sr-only" onClick={(e) => { e.stopPropagation(); handleNavigateTab('capital'); }}>
                  Capital &amp; Stocks
                </span>
              </button>
              <button
                onClick={() => handleNavigateTab('analytics')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'analytics' || activeTab === 'hubs-roi'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
                title="Product 360 & hubs"
              >
                3. Analyses
                <span className="sr-only" onClick={(e) => { e.stopPropagation(); handleNavigateTab('analytics'); }}>
                  Product 360 &amp; Séries
                </span>
                <span className="sr-only" onClick={(e) => { e.stopPropagation(); handleNavigateTab('hubs-roi'); }}>
                  Hubs &amp; ROI TTC
                </span>
              </button>
              <button
                onClick={() => handleNavigateTab('operations')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'operations' || activeTab === 'restock'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
                title="Transferts & réapprovisionnement"
              >
                4. Opérations
                <span className="sr-only" onClick={(e) => { e.stopPropagation(); handleNavigateTab('restock'); }}>
                  Réapprovisionnement
                </span>
              </button>
              <button
                onClick={() => handleNavigateTab('transactions')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'transactions' || activeTab === 'ledger' || activeTab === 'journal'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
                title="Grand Livre & journal"
              >
                5. Transactions
                <span className="sr-only" onClick={(e) => { e.stopPropagation(); handleNavigateTab('ledger'); }}>
                  Grand Livre
                </span>
              </button>
              <button
                onClick={() => handleNavigateTab('configuration')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === 'configuration' || activeTab === 'roadmap'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
                title="Comptes, hubs & diagnostics"
              >
                6. Configuration
                <span className="sr-only" onClick={(e) => { e.stopPropagation(); handleNavigateTab('roadmap'); }}>
                  Roadmap &amp; Statuts
                </span>
              </button>
            </nav>
          )}

          {/* Zone 3: Compact ESI Badge, Actions, Preferences & Profile */}
          <div className="flex items-center space-x-2">
            {session && (
              <button
                onClick={() => setShowEsiDrawer(true)}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/40 text-xs font-mono transition-colors cursor-pointer"
                title="Ouvrir le panneau de diagnostic ESI & Serveur"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    syncStatus?.freshness === 'FRESH'
                      ? 'bg-emerald-400'
                      : syncStatus?.freshness === 'PARTIAL'
                      ? 'bg-amber-500'
                      : syncStatus?.freshness === 'STALE'
                      ? 'bg-amber-400'
                      : 'bg-slate-500'
                  } ${isSyncing ? 'animate-ping' : ''}`}
                />
                <span className="text-slate-300 font-semibold">
                  {isSyncing ? 'SYNCHRO...' : syncStatus?.freshness === 'FRESH' ? 'ESI FRESH' : syncStatus?.freshness === 'PARTIAL' ? 'ESI PARTIEL' : 'ESI STALE'}
                </span>
                <span className="text-slate-500 text-[10px]">
                  ({esiStatus?.rateLimit?.errorLimitRemain ?? 100}/100)
                </span>
              </button>
            )}

            <button
              onClick={() => setShowPreferencesModal(true)}
              className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-amber-300 border border-slate-800 transition-colors cursor-pointer"
              title="Préférences d'affichage et format ISK"
            >
              <Settings className="w-4 h-4" />
            </button>

            {session ? (
              <div className="relative">
                <div className="flex items-center space-x-2">
                  <div
                    onClick={() => setShowCharacterDropdown(!showCharacterDropdown)}
                    className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/40 rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors"
                  >
                    <img
                      src={session.portraitUrl}
                      alt={session.characterName}
                      className="w-6 h-6 rounded border border-amber-500/40 bg-slate-800 object-cover"
                    />
                    <div className="text-left hidden sm:block">
                      <div className="text-xs font-semibold text-slate-200 leading-tight flex items-center gap-1">
                        {session.characterName}
                        {linkedCharacters.length > 1 && (
                          <span className="text-[10px] font-mono px-1 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30">
                            {linkedCharacters.length}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </div>

                  <a
                    href="/api/auth/login"
                    title="Lier un autre personnage EVE SSO"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/40 text-slate-300 hover:text-sky-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-sky-400" />
                    <span className="hidden md:inline">+ Perso</span>
                  </a>

                  <button
                    onClick={handleLogout}
                    title="Déconnexion de tous les personnages"
                    className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-lg border border-slate-800 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>

                {showCharacterDropdown && (
                  <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-800 bg-slate-950 p-2 shadow-2xl z-50 space-y-2">
                    <div className="px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-slate-400 flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-amber-400" />
                        Écosystème ({linkedCharacters.length} personnage{linkedCharacters.length > 1 ? 's' : ''})
                      </span>
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {linkedCharacters.map((c) => {
                        const isCurrent = c.characterId === session.characterId;
                        return (
                          <div
                            key={c.characterId}
                            className={`flex items-center justify-between p-2 rounded-lg border transition-colors ${
                              isCurrent
                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                                : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-800 hover:border-slate-700 text-slate-300'
                            }`}
                          >
                            <div
                              onClick={() => !isCurrent && handleSwitchCharacter(c.characterId)}
                              className="flex items-center gap-2.5 flex-1 cursor-pointer"
                            >
                              <img
                                src={c.portraitUrl}
                                alt={c.characterName}
                                className="w-6 h-6 rounded object-cover border border-slate-700"
                              />
                              <div className="text-left text-xs">
                                <div className="font-semibold leading-tight flex items-center gap-1.5">
                                  {c.characterName}
                                  {isCurrent && (
                                    <span className="text-[9px] font-mono px-1 rounded bg-amber-500/20 text-amber-300">
                                      ACTIF
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">ID: {c.characterId}</div>
                              </div>
                            </div>

                            {linkedCharacters.length > 1 && (
                              <button
                                onClick={() => handleUnlinkCharacter(c.characterId)}
                                title="Délier ce personnage"
                                className="p-1 text-slate-500 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-t border-slate-800 pt-2">
                      <a
                        href="/api/auth/login"
                        className="w-full py-2 px-3 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        Lier un autre personnage EVE SSO
                      </a>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center space-x-2 text-xs font-mono">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="text-slate-300">SYSTÈME PRÊT</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Auth Error Banner */}
        {authError && (
          <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-4 flex items-start space-x-3 text-rose-200">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <h4 className="text-sm font-semibold">Erreur d&apos;authentification SSO</h4>
              <p className="text-xs text-rose-300">{authError}</p>
            </div>
            <button
              onClick={() => setAuthError(null)}
              className="text-xs text-rose-400 hover:text-rose-200 px-2 py-1"
            >
              Fermer
            </button>
          </div>
        )}

        {/* If Not Authenticated -> Show Connection Hero & Roadmap */}
        {!session ? (
          <div className="space-y-6">
            <section className="relative overflow-hidden rounded-xl border border-slate-800 bg-linear-to-b from-slate-900/90 to-slate-950 p-6 md:p-8 space-y-6">
              <div className="relative z-10 max-w-3xl space-y-4">
                <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Phase 06 — Dashboard Intégré &amp; Ergonomie</span>
                </div>

                <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
                  EVE Online Trade Dashboard
                </h1>

                <p className="text-slate-400 text-sm md:text-base leading-relaxed">
                  Tableau de bord de trading pour EVE Online : suivi consolidé des ventes, gestion du cycle de vie des ordres, préparation de réapprovisionnements sans manipulation en jeu et calcul rigoureux du ROI TTC.
                </p>

                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 max-w-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-amber-400" />
                      Authentification Sécurisée EVE SSO (PKCE)
                    </span>
                    {authConfigured === false && (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono flex items-center gap-1">
                        <Key className="w-3 h-3" /> Clés à configurer
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400">
                    Le navigateur ne reçoit aucun token d&apos;accès ou secret OAuth. Tout transite par la passerelle sécurisée du serveur.
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <a
                      href="/api/auth/login"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-all duration-200 shadow-md hover:shadow-amber-500/20 inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <LogIn className="w-4 h-4" />
                      Se connecter avec EVE Online (SSO)
                    </a>
                  </div>
                </div>
              </div>
            </section>

            <SystemRoadmapView
              health={health}
              esiStatus={esiStatus}
              loading={loading}
              sessionExists={false}
            />
          </div>
        ) : (
          /* Authenticated 6 Canonical Workspaces */
          <div className="space-y-6">
            {syncError && (
              <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-950/20 text-red-300 text-xs flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{syncError}</span>
                </div>
                <button
                  onClick={() => setSyncError(null)}
                  className="text-red-400 hover:text-red-200 text-xs font-semibold px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 cursor-pointer"
                >
                  Ignorer
                </button>
              </div>
            )}

            {/* ESPACE 1: COCKPIT */}
            {activeTab === 'overview' && (
              <DashboardOverview
                summary={summary}
                roiSummary={roiSummary}
                orderSummary={orderSummary}
                orders={orders}
                restockItems={restockItems}
                preferences={preferences}
                iskDisplayMode={preferences.iskDisplayMode}
                activeCharacterId={session?.characterId}
                characterIds={linkedCharacters.length > 1 ? linkedCharacters.map((c) => c.characterId) : undefined}
                onNavigateTab={handleNavigateTab}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
                onOpenPreferences={() => setShowPreferencesModal(true)}
                onUpdatePreferences={handleSavePreferences}
                onSync={handleSync}
                isSyncing={isSyncing}
                onAutoReconcile={handleAutoReconcile}
                isReconciling={isReconciling}
              />
            )}

            {/* ESPACE 2: POSITIONS (Marché & Inventaire) */}
            {activeTab === 'positions' && (
              <PositionsView
                orders={orders}
                orderSummary={orderSummary}
                formatIsk={formatIsk}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
                activeCharacterId={session?.characterId}
                characterIds={linkedCharacters.length > 1 ? linkedCharacters.map((c) => c.characterId) : undefined}
                preferences={preferences}
                onOpenPreferences={() => setShowPreferencesModal(true)}
                initialSubTab={positionsSubTab}
              />
            )}

            {/* VUE DIRECTE: ORDRES */}
            {activeTab === 'orders' && (
              <OrdersView
                orders={orders}
                orderSummary={orderSummary}
                orderStateFilter={orderStateFilter}
                ordersSearch={ordersSearch}
                ordersPage={ordersPage}
                ordersTotalPages={1}
                ordersTotalCount={orders.length}
                iskDisplayMode={preferences.iskDisplayMode}
                onOrderStateFilterChange={setOrderStateFilter}
                onOrdersSearchChange={setOrdersSearch}
                onOrdersPageChange={setOrdersPage}
                onSelectOrder={handleInspectOrder}
                onQuickAddRestock={handleQuickAddRestock}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
              />
            )}

            {/* VUE DIRECTE: CAPITAL */}
            {activeTab === 'capital' && (
              <CapitalView
                formatIsk={formatIsk}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
                activeCharacterId={session?.characterId}
                characterIds={linkedCharacters.length > 1 ? linkedCharacters.map((c) => c.characterId) : undefined}
                preferences={preferences}
                onOpenPreferences={() => setShowPreferencesModal(true)}
              />
            )}

            {/* ESPACE 3: ANALYSES (Product 360 & Hubs) */}
            {activeTab === 'analytics' && (
              <AnalyticsView
                preferences={preferences}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
                characterIds={linkedCharacters.length > 1 ? linkedCharacters.map((c) => c.characterId) : undefined}
              />
            )}

            {/* VUE DIRECTE: HUBS & ROI TTC */}
            {activeTab === 'hubs-roi' && (
              <HubsRoiView
                roiSummary={roiSummary}
                allocations={allocations}
                unsoldInventory={unsoldInventory}
                hubsList={hubsList}
                hubsMappings={hubsMappings}
                iskDisplayMode={preferences.iskDisplayMode}
                isReconciling={isReconciling}
                reconcileMessage={reconcileMessage}
                onAutoReconcile={handleAutoReconcile}
                onOpenAddAllocationModal={() => setShowAddAllocationModal(true)}
                onDeleteAllocation={handleDeleteAllocation}
                onOpenAddHubModal={() => setShowAddHubModal(true)}
                onDeleteHub={handleDeleteHub}
                onOpenAddMappingModal={() => setShowAddMappingModal(true)}
                onDeleteMapping={handleDeleteMapping}
                onAutoDiscoverHubs={handleAutoDiscoverHubs}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
              />
            )}

            {/* ESPACE 4: OPÉRATIONS (Transferts & Réassort) */}
            {activeTab === 'operations' && (
              <OperationsView
                restockItems={restockItems}
                formatIsk={formatIsk}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
                activeCharacterId={session?.characterId}
                characterIds={linkedCharacters.length > 1 ? linkedCharacters.map((c) => c.characterId) : undefined}
                initialSubTab={operationsSubTab}
              />
            )}

            {/* VUE DIRECTE: RÉAPPROVISIONNEMENT */}
            {activeTab === 'restock' && (
              <RestockView
                restockItems={restockItems}
                isGenerating={isGeneratingRestock}
                onGenerateRestock={handleGenerateRestock}
                onOpenAddModal={() => setShowAddRestockModal(true)}
                onDeleteItem={handleDeleteRestockItem}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
                iskDisplayMode={preferences.iskDisplayMode}
                characterIds={linkedCharacters.length > 1 ? linkedCharacters.map((c) => c.characterId) : undefined}
              />
            )}

            {/* ESPACE 5: TRANSACTIONS (Grand Livre, Journal & Rapprochement) */}
            {activeTab === 'transactions' && (
              <TransactionsView
                transactions={transactions}
                ledgerSummary={summary}
                loadingLedger={ledgerLoading}
                ledgerPage={page}
                ledgerTotalPages={totalPages}
                ledgerTotalCount={totalCount}
                filterType={filterType}
                searchQuery={searchQuery}
                selectedLocation={selectedLocation}
                distinctLocations={distinctLocations}
                iskDisplayMode={preferences.iskDisplayMode}
                onFilterTypeChange={(type) => { setFilterType(type); setPage(1); }}
                onSearchChange={(search) => { setSearchQuery(search); setPage(1); }}
                onLocationChange={(loc) => { setSelectedLocation(loc); setPage(1); }}
                onPageChange={setPage}
                onQuickAllocate={handleQuickAllocate}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
                journalEntries={journalEntries}
                loadingJournal={false}
                journalPage={1}
                journalTotalPages={1}
                journalTotalCount={journalEntries.length}
                journalRefTypeFilter="ALL"
                distinctJournalRefTypes={[]}
                onJournalRefTypeChange={() => {}}
                onJournalPageChange={() => {}}
                onAutoReconcile={handleAutoReconcile}
                isReconciling={isReconciling}
                formatIsk={formatIsk}
                initialSubTab={transactionsSubTab}
              />
            )}

            {/* VUE DIRECTE: GRAND LIVRE */}
            {activeTab === 'ledger' && (
              <LedgerView
                transactions={transactions}
                summary={summary}
                loading={ledgerLoading}
                page={page}
                totalPages={totalPages}
                totalCount={totalCount}
                filterType={filterType}
                searchQuery={searchQuery}
                selectedLocation={selectedLocation}
                distinctLocations={distinctLocations}
                iskDisplayMode={preferences.iskDisplayMode}
                onFilterTypeChange={(type) => { setFilterType(type); setPage(1); }}
                onSearchChange={(query) => { setSearchQuery(query); setPage(1); }}
                onLocationChange={(loc) => { setSelectedLocation(loc); setPage(1); }}
                onPageChange={setPage}
                onInspectTransaction={handleInspectTransaction}
                onQuickAllocate={handleQuickAllocate}
                onOpenProduct360={(typeId) => setSelectedProduct360TypeId(typeId)}
              />
            )}

            {/* VUE DIRECTE: JOURNAL WALLET */}
            {activeTab === 'journal' && (
              <JournalView
                journalEntries={journalEntries}
                iskDisplayMode={preferences.iskDisplayMode}
              />
            )}

            {/* ESPACE 6: CONFIGURATION (Comptes, Hubs & Diagnostics) */}
            {activeTab === 'configuration' && (
              <ConfigurationView
                session={session}
                linkedCharacters={linkedCharacters}
                activeCharacterId={session?.characterId}
                onSwitchCharacter={handleSwitchCharacter}
                onLogout={handleLogout}
                hubsList={hubsList}
                hubsMappings={hubsMappings}
                onOpenAddHubModal={() => setShowAddHubModal(true)}
                onDeleteHub={handleDeleteHub}
                onOpenAddMappingModal={() => setShowAddMappingModal(true)}
                onDeleteMapping={handleDeleteMapping}
                onAutoDiscoverHubs={handleAutoDiscoverHubs}
                healthStatus={health}
                esiStatus={esiStatus}
                onSync={handleSync}
                isSyncing={isSyncing}
                initialSubTab={configSubTab}
              />
            )}

            {/* VUE DIRECTE: ROADMAP */}
            {activeTab === 'roadmap' && (
              <SystemRoadmapView
                health={health}
                esiStatus={esiStatus}
                loading={isSyncing}
                sessionExists={!!session}
              />
            )}
          </div>
        )}
      </main>

      {/* ESI Diagnostics Side Drawer */}
      <EsiDiagnosticDrawer
        isOpen={showEsiDrawer}
        onClose={() => setShowEsiDrawer(false)}
        esiStatus={esiStatus}
        healthStatus={health}
        isSyncing={isSyncing}
        onSync={handleSync}
        lastSyncTime={syncStatus?.transactions?.lastSyncCompletedAt}
      />

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Preuve ESI &amp; Détail de Transaction</h3>
              </div>
              <button
                onClick={() => { setSelectedTx(null); setSelectedTxDetail(null); }}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono">
                <div>
                  <span className="text-slate-500 block">Transaction ID ESI :</span>
                  <span className="text-slate-200 font-semibold">#{selectedTx.transactionId}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Date &amp; Heure (UTC) :</span>
                  <span className="text-slate-200">{selectedTx.date}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Sens du flux :</span>
                  <span className={selectedTx.isBuy ? 'text-sky-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                    {selectedTx.isBuy ? 'ACHAT (Dépense)' : 'VENTE (Encaissement)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Montant Brut :</span>
                  <span className="text-slate-200 font-semibold">{formatIsk(selectedTx.totalValue)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Quantité :</span>
                  <span className="text-slate-200">{selectedTx.quantity.toLocaleString()} unités</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Prix Unitaire :</span>
                  <span className="text-slate-200">{formatIsk(selectedTx.unitPrice)}</span>
                </div>

                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="text-rose-400 block text-[11px]">Taxe de Transaction (CCP) :</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedTx.tax !== undefined && selectedTx.tax > 0 ? formatIsk(selectedTx.tax) : '0.00 ISK'}
                  </span>
                </div>

                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="text-rose-400 block text-[11px]">Frais de Courtage :</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedTx.brokerFee !== undefined && selectedTx.brokerFee > 0 ? formatIsk(selectedTx.brokerFee) : '0.00 ISK'}
                  </span>
                </div>

                <div className="col-span-2 p-2.5 rounded bg-amber-500/10 border border-amber-500/30 flex justify-between items-center">
                  <div>
                    <span className="text-amber-300 block text-[11px] font-sans font-semibold">Montant Net TTC :</span>
                    <span className="text-[10px] text-slate-400">Après déduction des taxes et commissions de courtage</span>
                  </div>
                  <span className={`text-base font-bold ${selectedTx.isBuy ? 'text-sky-400' : 'text-emerald-400'}`}>
                    {formatIsk(selectedTx.netValue !== undefined ? selectedTx.netValue : selectedTx.totalValue)}
                  </span>
                </div>

                <div className="col-span-2">
                  <span className="text-slate-500 block">Article :</span>
                  <span className="text-slate-200 font-medium">{selectedTx.typeName} (Type #{selectedTx.typeId})</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Emplacement :</span>
                  <span className="text-slate-200">{selectedTx.locationName} (Location #{selectedTx.locationId})</span>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-300 mb-2">Entrées de Journal Portefeuille Associées</h4>
                {selectedTxDetail && selectedTxDetail.relatedJournalEntries.length > 0 ? (
                  <div className="space-y-2">
                    {selectedTxDetail.relatedJournalEntries.map((jn) => (
                      <div key={jn.id} className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1 font-mono">
                        <div className="flex justify-between text-slate-300">
                          <span>Ref: {jn.refType} (ID #{jn.journalId})</span>
                          <span>{jn.amount !== undefined ? formatIsk(jn.amount) : '—'}</span>
                        </div>
                        {jn.tax && (
                          <div className="text-slate-400 text-[11px]">
                            Taxe prélevée : {formatIsk(jn.tax)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-950/50 rounded border border-slate-800 text-slate-500 italic">
                    Aucune taxe ou commission de courtage supplémentaire liée à cette transaction.
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => { setSelectedTx(null); setSelectedTxDetail(null); }}
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <ClipboardList className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Détail &amp; Cycle de Vie de l&apos;Ordre</h3>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800 font-mono">
                <div>
                  <span className="text-slate-500 block">Order ID ESI :</span>
                  <span className="text-slate-200 font-semibold">{selectedOrder.orderId}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">État du Cycle :</span>
                  <span className="text-amber-300 font-semibold">{selectedOrder.state}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Sens :</span>
                  <span className={selectedOrder.isBuyOrder ? 'text-sky-400' : 'text-emerald-400'}>
                    {selectedOrder.isBuyOrder ? 'Achat' : 'Vente'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Prix Unitaire :</span>
                  <span className="text-slate-200 font-semibold">{formatIsk(selectedOrder.price)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Volume Exécuté :</span>
                  <span className="text-slate-200">{selectedOrder.volumeFilled.toLocaleString()} / {selectedOrder.volumeTotal.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Volume Restant :</span>
                  <span className="text-amber-300 font-semibold">{selectedOrder.volumeRemain.toLocaleString()}</span>
                </div>
                {selectedOrder.inStockQuantity !== undefined && (
                  <div className="col-span-2 p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center justify-between">
                    <span className="font-semibold">Stock Actuel en Station (Actifs ESI) :</span>
                    <span className="font-bold text-sm">{selectedOrder.inStockQuantity.toLocaleString()} unités</span>
                  </div>
                )}
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1">
                <span className="text-slate-400 font-semibold block">Justification de l&apos;État :</span>
                <p className="text-slate-300 leading-relaxed">{selectedOrder.stateJustification}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Restock Item Modal */}
      {showAddRestockModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <ShoppingCart className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Ajouter un Article à Réapprovisionner</h3>
              </div>
              <button
                onClick={() => setShowAddRestockModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRestockItem} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Nom de l&apos;Article ou Type ID</label>
                <input
                  type="text"
                  required
                  value={newRestockForm.typeName}
                  onChange={(e) => setNewRestockForm({ ...newRestockForm, typeName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  placeholder="ex: Tritanium, Skill Injector..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-medium">Type ID</label>
                  <input
                    type="number"
                    required
                    value={newRestockForm.typeId}
                    onChange={(e) => setNewRestockForm({ ...newRestockForm, typeId: Number(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-medium">Quantité Cible</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={newRestockForm.targetQuantity}
                    onChange={(e) =>
                      setNewRestockForm({
                        ...newRestockForm,
                        targetQuantity: Number(e.target.value),
                        suggestedQuantity: Number(e.target.value),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Hub d&apos;Achat Source</label>
                <input
                  type="text"
                  required
                  value={newRestockForm.targetBuyHubName}
                  onChange={(e) => setNewRestockForm({ ...newRestockForm, targetBuyHubName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Station de Vente Cible</label>
                <input
                  type="text"
                  required
                  value={newRestockForm.sellHubName}
                  onChange={(e) => setNewRestockForm({ ...newRestockForm, sellHubName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Notes &amp; Logistique</label>
                <input
                  type="text"
                  value={newRestockForm.notes}
                  onChange={(e) => setNewRestockForm({ ...newRestockForm, notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                  placeholder="ex: Charger dans le DST, vérifier la marge..."
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddRestockModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold shadow"
                >
                  Enregistrer l&apos;Article
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Custom Hub Modal */}
      {showAddHubModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <MapPin className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Ajouter un Hub Commercial</h3>
              </div>
              <button
                onClick={() => setShowAddHubModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateHub} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Nom du Hub</label>
                <input
                  type="text"
                  required
                  value={newHubForm.name}
                  onChange={(e) => setNewHubForm({ ...newHubForm, name: e.target.value })}
                  placeholder="ex: Staging Nullsec 1DQ1-A"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Nom du Système Solaire</label>
                <input
                  type="text"
                  value={newHubForm.system_name}
                  onChange={(e) => setNewHubForm({ ...newHubForm, system_name: e.target.value })}
                  placeholder="ex: 1DQ1-A, Jita..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Notes</label>
                <input
                  type="text"
                  value={newHubForm.notes}
                  onChange={(e) => setNewHubForm({ ...newHubForm, notes: e.target.value })}
                  placeholder="ex: Base principale d'alliance"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddHubModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold shadow"
                >
                  Créer le Hub
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Location Mapping Modal */}
      {showAddMappingModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Building2 className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Associer Station / Structure à un Hub</h3>
              </div>
              <button
                onClick={() => setShowAddMappingModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateMapping} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Location ID EVE (Station / Structure)</label>
                <input
                  type="number"
                  required
                  value={newMappingForm.location_id || ''}
                  onChange={(e) => setNewMappingForm({ ...newMappingForm, location_id: Number(e.target.value) })}
                  placeholder="ex: 60003760 ou 1029384756..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Nom de l&apos;Emplacement</label>
                <input
                  type="text"
                  required
                  value={newMappingForm.location_name}
                  onChange={(e) => setNewMappingForm({ ...newMappingForm, location_name: e.target.value })}
                  placeholder="ex: Jita IV - Moon 4 CNAP..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Hub Cible</label>
                <select
                  value={newMappingForm.hub_id}
                  onChange={(e) => setNewMappingForm({ ...newMappingForm, hub_id: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                >
                  {hubsList.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddMappingModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold shadow"
                >
                  Enregistrer l&apos;Association
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Explicit Cost Allocation Modal */}
      {showAddAllocationModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Link2 className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Rapprocher une Vente avec un Achat (ROI TTC)</h3>
              </div>
              <button
                onClick={() => setShowAddAllocationModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAllocation} className="space-y-3 text-xs">
              <p className="text-slate-400 leading-relaxed text-[11px]">
                En vertu des règles de gestion EVE Trade Dashboard, le coût d&apos;acquisition doit être explicitement désigné sans heuristique FIFO/LIFO implicite.
              </p>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Transaction de Vente (Sell Tx ID)</label>
                <select
                  required
                  value={newAllocForm.sell_transaction_id || ''}
                  onChange={(e) => setNewAllocForm({ ...newAllocForm, sell_transaction_id: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono"
                >
                  <option value="">Sélectionnez une vente...</option>
                  {transactions.filter((t) => !t.isBuy).map((t) => (
                    <option key={t.transactionId} value={t.transactionId}>
                      #{t.transactionId} — {t.typeName} ({t.quantity} un. @ {formatIsk(t.unitPrice)}) - {new Date(t.date).toLocaleDateString('fr-FR')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Transaction d&apos;Achat Source (Buy Tx ID)</label>
                <select
                  required
                  value={newAllocForm.buy_transaction_id || ''}
                  onChange={(e) => {
                    const buyId = Number(e.target.value);
                    const inv = unsoldInventory.find((i) => i.buy_transaction_id === buyId);
                    setNewAllocForm({
                      ...newAllocForm,
                      buy_transaction_id: buyId,
                      quantity_to_allocate: inv ? inv.remaining_quantity : newAllocForm.quantity_to_allocate,
                    });
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono"
                >
                  <option value="">Sélectionnez un achat...</option>
                  {unsoldInventory.map((i) => (
                    <option key={i.buy_transaction_id} value={i.buy_transaction_id}>
                      #{i.buy_transaction_id} — {i.type_name} ({i.remaining_quantity} un. dispo @ {formatIsk(i.unit_buy_price)}) - {i.hub_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Quantité à Rapprocher / Allouer</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={newAllocForm.quantity_to_allocate || ''}
                  onChange={(e) => setNewAllocForm({ ...newAllocForm, quantity_to_allocate: Number(e.target.value) })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-medium">Notes &amp; Justification</label>
                <input
                  type="text"
                  value={newAllocForm.notes}
                  onChange={(e) => setNewAllocForm({ ...newAllocForm, notes: e.target.value })}
                  placeholder="ex: Lot importé de Jita pour vente Dodixie..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddAllocationModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold shadow"
                >
                  Valider l&apos;Allocation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preferences Modal */}
      {showPreferencesModal && (
        <PreferencesModal
          preferences={preferences}
          characters={linkedCharacters}
          onSave={handleSavePreferences}
          onClose={() => setShowPreferencesModal(false)}
        />
      )}

      {/* Product 360 Inspection Modal */}
      {selectedProduct360TypeId !== null && (
        <Product360Modal
          typeId={selectedProduct360TypeId}
          onClose={() => setSelectedProduct360TypeId(null)}
          preferences={preferences}
          characterIds={linkedCharacters.length > 1 ? linkedCharacters.map((c) => c.characterId) : undefined}
        />
      )}
    </div>
  );
}
