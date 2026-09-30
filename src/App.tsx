import { useState, useEffect, useCallback } from 'react';
import { 
  Activity, 
  Shield, 
  TrendingUp, 
  CheckCircle2, 
  Terminal, 
  Server, 
  Database,
  LogIn,
  LogOut,
  User,
  AlertTriangle,
  Key,
  RefreshCw,
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  Coins,
  Building2,
  PackageCheck,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
  FileText,
  ShoppingCart,
  Plus,
  Trash2,
  CheckSquare,
  Sparkles,
  ClipboardList,
  Percent,
  MapPin,
  Layers,
  Scale,
  Link2,
  Users,
  UserPlus,
  ChevronDown
} from 'lucide-react';

interface HealthStatus {
  status: string;
  service: string;
  timestamp: string;
  version: string;
}

interface CharacterSession {
  characterId: number;
  characterName: string;
  portraitUrl: string;
  scopes: string[];
  expiresAt: number;
  isActive?: boolean;
}

interface AuthSessionResponse {
  authenticated: boolean;
  character?: CharacterSession;
  characters?: CharacterSession[];
}

interface AuthStatusResponse {
  configured: boolean;
}

interface EsiStatusResponse {
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
  allocated_buy_cost: number;
  allocated_buy_fees: number;
  attributable_sell_fees: number;
  realized_profit_ttc: number | null;
  roi_percent_ttc: number | null;
  coverage_status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'EMPTY';
  coverage_percent: number;
  transaction_count: number;
}

export interface ExplicitCostAllocation {
  id: string;
  character_id: number;
  sell_transaction_id: number;
  buy_transaction_id: number;
  type_id: number;
  type_name: string;
  quantity_allocated: number;
  unit_buy_price: number;
  allocated_buy_cost: number;
  allocated_buy_fees: number;
  allocated_sell_fees: number;
  buy_hub_id: string;
  buy_hub_name: string;
  sell_hub_id: string;
  sell_hub_name: string;
  created_at: string;
  notes?: string;
}

export interface UnsoldInventoryItem {
  character_id: number;
  buy_transaction_id: number;
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
}

export interface RoiFinancialSummary {
  as_of: string;
  character_id?: number;
  period_label: string;
  total_sales_volume: number;
  allocated_sales_volume: number;
  unallocated_sales_volume: number;
  gross_revenue_isk: number;
  allocated_buy_cost_isk: number;
  allocated_buy_fees_isk: number;
  attributable_sell_fees_isk: number;
  total_allocated_investment_ttc: number;
  realized_profit_ttc_isk: number | null;
  roi_percent_ttc: number | null;
  tied_up_capital_isk: number;
  unsold_items_count: number;
  coverage_status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'EMPTY';
  coverage_percent: number;
  hub_pairs: HubPairPerformance[];
}

interface LedgerSummary {
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

interface SyncStatusResponse {
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
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
}

function formatIsk(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' ISK';
}

export default function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null);
  const [esiStatus, setEsiStatus] = useState<EsiStatusResponse | null>(null);
  const [session, setSession] = useState<CharacterSession | null>(null);
  const [linkedCharacters, setLinkedCharacters] = useState<CharacterSession[]>([]);
  const [showCharacterDropdown, setShowCharacterDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Active Tab View
  const [activeTab, setActiveTab] = useState<'ledger' | 'orders' | 'restock' | 'hubs-roi' | 'journal' | 'overview'>('ledger');

  // Ledger state
  const [transactions, setTransactions] = useState<CharacterTransaction[]>([]);
  const [journalEntries, setJournalEntries] = useState<CharacterWalletJournalEntry[]>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [selectedTx, setSelectedTx] = useState<CharacterTransaction | null>(null);
  const [selectedTxDetail, setSelectedTxDetail] = useState<{
    transaction: CharacterTransaction;
    relatedJournalEntries: CharacterWalletJournalEntry[];
  } | null>(null);

  // Ledger Filters
  const [filterType, setFilterType] = useState<'ALL' | 'SELL' | 'BUY'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [distinctLocations, setDistinctLocations] = useState<{ id: number; name: string; count: number }[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Orders State (Phase 04)
  const [orders, setOrders] = useState<CharacterOrderSnapshot[]>([]);
  const [orderSummary, setOrderSummary] = useState<OrderSummaryMetrics | null>(null);
  const [orderStateFilter, setOrderStateFilter] = useState<string>('ALL');
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [ordersTotalCount, setOrdersTotalCount] = useState(0);
  const [ordersSearch, setOrdersSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<CharacterOrderSnapshot | null>(null);

  // Restock State (Phase 04)
  const [restockItems, setRestockItems] = useState<RestockItem[]>([]);
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

  // Hubs & ROI TTC State (Phase 05)
  const [roiSummary, setRoiSummary] = useState<RoiFinancialSummary | null>(null);
  const [allocations, setAllocations] = useState<ExplicitCostAllocation[]>([]);
  const [unsoldInventory, setUnsoldInventory] = useState<UnsoldInventoryItem[]>([]);
  const [hubsList, setHubsList] = useState<HubDefinition[]>([]);
  const [hubsMappings, setHubsMappings] = useState<HubLocationMapping[]>([]);
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

  const fetchLedgerData = useCallback(async () => {
    if (!session) return;
    setLedgerLoading(true);

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '25',
        type: filterType,
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(selectedLocation ? { locationId: selectedLocation } : {}),
      });

      const charIdsQuery = linkedCharacters.length > 1
        ? `?character_ids=${linkedCharacters.map((c) => c.characterId).join(',')}`
        : '';

      const [txRes, summaryRes, syncRes, optionsRes, journalRes] = await Promise.all([
        fetch(`/api/ledger/transactions?${params.toString()}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/ledger/summary${charIdsQuery}`).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/ledger/sync-status').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/ledger/filter-options').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/ledger/journal?pageSize=25').then((r) => (r.ok ? r.json() : null)),
      ]);

      if (txRes) {
        setTransactions(txRes.items || []);
        setTotalPages(txRes.totalPages || 1);
        setTotalCount(txRes.total || 0);
      }
      if (summaryRes) setSummary(summaryRes);
      if (syncRes) setSyncStatus(syncRes);
      if (optionsRes?.locations) setDistinctLocations(optionsRes.locations);
      if (journalRes) setJournalEntries(journalRes.items || []);
    } catch (err) {
      console.error('Failed to load ledger data:', err);
    } finally {
      setLedgerLoading(false);
    }
  }, [session, page, filterType, searchQuery, selectedLocation]);

  const fetchOrdersData = useCallback(async () => {
    if (!session) return;
    try {
      const params = new URLSearchParams({
        page: String(ordersPage),
        pageSize: '25',
        ...(orderStateFilter !== 'ALL' ? { state: orderStateFilter } : {}),
        ...(ordersSearch ? { search: ordersSearch } : {}),
      });

      const [ordersRes, summaryRes, restockRes] = await Promise.all([
        fetch(`/api/orders?${params.toString()}`).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/orders/summary').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/orders/restock').then((r) => (r.ok ? r.json() : null)),
      ]);

      if (ordersRes) {
        setOrders(ordersRes.items || []);
        setOrdersTotalPages(ordersRes.totalPages || 1);
        setOrdersTotalCount(ordersRes.total || 0);
      }
      if (summaryRes) setOrderSummary(summaryRes);
      if (restockRes?.items) setRestockItems(restockRes.items);
    } catch (err) {
      console.error('Failed to load orders data:', err);
    }
  }, [session, ordersPage, orderStateFilter, ordersSearch]);

  const fetchRoiAndHubsData = useCallback(async () => {
    if (!session) return;
    try {
      const charIdsQuery = linkedCharacters.length > 1
        ? `?character_ids=${linkedCharacters.map((c) => c.characterId).join(',')}`
        : '';

      const [summaryRes, allocRes, invRes, hubsRes, mapRes] = await Promise.all([
        fetch(`/api/roi/summary${charIdsQuery}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/roi/allocations${charIdsQuery}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/roi/unsold-inventory${charIdsQuery}`).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/hubs').then((r) => (r.ok ? r.json() : null)),
        fetch('/api/hubs/mappings').then((r) => (r.ok ? r.json() : null)),
      ]);

      if (summaryRes?.summary) setRoiSummary(summaryRes.summary);
      if (allocRes?.allocations) setAllocations(allocRes.allocations);
      if (invRes?.inventory) setUnsoldInventory(invRes.inventory);
      if (hubsRes?.hubs) setHubsList(hubsRes.hubs);
      if (mapRes?.mappings) setHubsMappings(mapRes.mappings);
    } catch (err) {
      console.error('Failed to load ROI and Hubs data:', err);
    }
  }, [session, linkedCharacters]);

  const handleSync = async () => {
    if (isSyncing || !session) return;
    setIsSyncing(true);

    try {
      const res = await fetch('/api/ledger/sync', { method: 'POST' });
      if (res.ok) {
        await Promise.all([fetchLedgerData(), fetchOrdersData(), fetchRoiAndHubsData()]);
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleGenerateRestock = async () => {
    if (isGeneratingRestock || !session) return;
    setIsGeneratingRestock(true);
    try {
      const res = await fetch('/api/orders/restock/generate', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setRestockItems(data.items || []);
      }
    } catch (err) {
      console.error('Failed to generate restock suggestions:', err);
    } finally {
      setIsGeneratingRestock(false);
    }
  };

  const handleUpdateRestockStatus = async (item: RestockItem, newStatus: RestockItemStatus) => {
    try {
      const res = await fetch(`/api/orders/restock/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setRestockItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, status: newStatus } : i))
        );
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleDeleteRestockItem = async (itemId: string) => {
    try {
      const res = await fetch(`/api/orders/restock/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setRestockItems((prev) => prev.filter((i) => i.id !== itemId));
      }
    } catch (err) {
      console.error('Failed to delete item:', err);
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
        const created = await res.json();
        setRestockItems((prev) => [created, ...prev]);
        setShowAddRestockModal(false);
      }
    } catch (err) {
      console.error('Failed to create restock item:', err);
    }
  };

  const handleInspectTransaction = async (tx: CharacterTransaction) => {
    setSelectedTx(tx);
    try {
      const res = await fetch(`/api/ledger/transactions/${tx.transactionId}`);
      if (res.ok) {
        const detail = await res.json();
        setSelectedTxDetail(detail);
      } else {
        setSelectedTxDetail({ transaction: tx, relatedJournalEntries: [] });
      }
    } catch {
      setSelectedTxDetail({ transaction: tx, relatedJournalEntries: [] });
    }
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('auth_error');
    const successParam = urlParams.get('auth');

    if (errorParam) {
      setAuthError(decodeURIComponent(errorParam));
    }
    if (successParam || errorParam) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    Promise.all([
      fetch('/api/health').then((res) => (res.ok ? res.json() : null)).catch(() => null),
      fetch('/api/auth/status').then((res) => (res.ok ? res.json() : null)).catch(() => null),
      fetch('/api/auth/session').then((res) => (res.ok ? res.json() : null)).catch(() => null),
      fetch('/api/esi/status').then((res) => (res.ok ? res.json() : null)).catch(() => null),
    ]).then(([healthData, authStatusData, sessionData, esiData]) => {
      if (healthData) setHealth(healthData);
      if (authStatusData) setAuthConfigured((authStatusData as AuthStatusResponse).configured);
      if (sessionData && (sessionData as AuthSessionResponse).authenticated) {
        const authData = sessionData as AuthSessionResponse;
        if (authData.character) {
          setSession(authData.character);
        }
        if (authData.characters) {
          setLinkedCharacters(authData.characters);
        }
      }
      if (esiData) setEsiStatus(esiData as EsiStatusResponse);
      setLoading(false);
    });
  }, []);

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
        fetchRoiAndHubsData();
      }
    } catch (err) {
      console.error('Failed to create hub:', err);
    }
  };

  const handleDeleteHub = async (hubId: string) => {
    try {
      const res = await fetch(`/api/hubs/${encodeURIComponent(hubId)}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRoiAndHubsData();
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
        fetchRoiAndHubsData();
      }
    } catch (err) {
      console.error('Failed to create mapping:', err);
    }
  };

  const handleDeleteMapping = async (locationId: number) => {
    try {
      const res = await fetch(`/api/hubs/mappings/${locationId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRoiAndHubsData();
      }
    } catch (err) {
      console.error('Failed to delete mapping:', err);
    }
  };

  const handleAutoDiscoverHubs = async () => {
    try {
      const res = await fetch('/api/hubs/auto-discover', { method: 'POST' });
      if (res.ok) {
        await fetchRoiAndHubsData();
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
        fetchRoiAndHubsData();
      }
    } catch (err) {
      console.error('Failed to create allocation:', err);
    }
  };

  const handleDeleteAllocation = async (id: string) => {
    try {
      const res = await fetch(`/api/roi/allocations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRoiAndHubsData();
      }
    } catch (err) {
      console.error('Failed to delete allocation:', err);
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
        setReconcileMessage(
          `${data.result.allocations_created} allocations créées (${data.result.total_quantity_reconciled} unités rapprochées en FIFO pour ${scopeLabel})`
        );
        await fetchRoiAndHubsData();
      }
    } catch (err) {
      console.error('Failed to run auto-reconciliation:', err);
    } finally {
      setIsReconciling(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchLedgerData();
      fetchOrdersData();
      fetchRoiAndHubsData();
    }
  }, [session, activeTab, fetchLedgerData, fetchOrdersData, fetchRoiAndHubsData]);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data: AuthSessionResponse = await res.json();
        if (data.authenticated && data.character) {
          setSession(data.character);
          if (data.characters) {
            setLinkedCharacters(data.characters);
          }
        } else {
          setSession(null);
          setLinkedCharacters([]);
        }
      }
    } catch (err) {
      console.error('Session check failed:', err);
    }
  }, []);

  const handleSwitchCharacter = async (characterId: number) => {
    try {
      const res = await fetch('/api/auth/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId }),
      });
      if (res.ok) {
        const data: AuthSessionResponse = await res.json();
        if (data.authenticated && data.character) {
          setSession(data.character);
          if (data.characters) setLinkedCharacters(data.characters);
          setShowCharacterDropdown(false);
          await Promise.all([fetchLedgerData(), fetchOrdersData(), fetchRoiAndHubsData()]);
        }
      }
    } catch (err) {
      console.error('Failed to switch character:', err);
    }
  };

  const handleUnlinkCharacter = async (characterId: number) => {
    try {
      const res = await fetch(`/api/auth/character/${characterId}`, { method: 'DELETE' });
      if (res.ok) {
        const data: AuthSessionResponse = await res.json();
        if (data.authenticated && data.character) {
          setSession(data.character);
          if (data.characters) setLinkedCharacters(data.characters);
        } else {
          setSession(null);
          setLinkedCharacters([]);
        }
        await Promise.all([fetchLedgerData(), fetchOrdersData(), fetchRoiAndHubsData()]);
      }
    } catch (err) {
      console.error('Failed to unlink character:', err);
    }
  };

  // Listen for window focus / visibility change to auto-detect session after OAuth login in new tab
  useEffect(() => {
    const onFocus = () => {
      checkSession();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('visibilitychange', onFocus);
    };
  }, [checkSession]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setSession(null);
      setTransactions([]);
      setOrders([]);
      setRestockItems([]);
      setSummary(null);
      setOrderSummary(null);
      setRoiSummary(null);
      setAllocations([]);
      setUnsoldInventory([]);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const phases = [
    { id: '00', name: 'Fondations & CI', status: 'Terminé', desc: 'React, Vite, Express, TypeScript, Vitest, CI' },
    { id: '01', name: 'EVE SSO & Identité', status: session ? 'Connecté' : 'Terminé', desc: 'OAuth 2.0 PKCE, gestion sécurisée des sessions et tokens' },
    { id: '02', name: 'Passerelle ESI Résiliente', status: 'Terminé', desc: 'Cache 304, rate limits (420/429), gestion des erreurs et pagination' },
    { id: '03', name: 'Transactions & Grand Livre', status: 'Terminé', desc: 'Sync wallet idempotente, pagination from_id, grand livre des ventes' },
    { id: '04', name: 'Ordres & Réapprovisionnement', status: 'Terminé', desc: 'Snapshots ordres de marché, cycle de vie et listes locales' },
    { id: '05', name: 'Hubs & ROI TTC', status: 'Actif', desc: 'Taxes, frais de courtage, rentabilité réelle et allocations explicites' },
    { id: '06', name: 'Dashboard Intégré', status: 'Planifiée', desc: 'Vue unifiée, filtres et métriques consolidées' },
  ];

  const getOrderStatusBadge = (state: OrderLifecycleState) => {
    switch (state) {
      case 'ACTIVE':
        return <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">ACTIF (100%)</span>;
      case 'PARTIALLY_FILLED':
        return <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20">PARTIEL</span>;
      case 'COMPLETED_CONFIRMED':
        return <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20">COMPLÉTÉ</span>;
      case 'DISAPPEARED_UNCONFIRMED':
        return <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">DISPARU (NON CONFIRMÉ)</span>;
      case 'CANCELLED_CONFIRMED':
        return <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20">ANNULÉ</span>;
      case 'EXPIRED_CONFIRMED':
        return <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-slate-400 border border-slate-700">EXPIRÉ</span>;
      default:
        return <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-slate-500">INCONNU</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Top Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-mono font-bold text-lg">
                Ω
              </div>
              <div>
                <span className="font-semibold tracking-wider text-slate-100 uppercase text-sm">EVE Trade Dashboard</span>
                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono border border-slate-700">v0.1.0</span>
              </div>
            </div>

            {/* Navigation Tabs */}
            {session && (
              <nav className="hidden md:flex items-center space-x-1 pl-4 border-l border-slate-800">
                <button
                  onClick={() => setActiveTab('ledger')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'ledger'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  Grand Livre
                </button>
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'orders'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  Ordres &amp; Cycle de Vie
                </button>
                <button
                  onClick={() => setActiveTab('restock')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    activeTab === 'restock'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  Réapprovisionnement
                </button>
                <button
                  onClick={() => setActiveTab('hubs-roi')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    activeTab === 'hubs-roi'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Scale className="w-3.5 h-3.5" />
                  Hubs &amp; ROI TTC
                </button>
                <button
                  onClick={() => setActiveTab('journal')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'journal'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  Journal &amp; Frais
                </button>
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === 'overview'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  Système &amp; Roadmap
                </button>
              </nav>
            )}
          </div>

          {/* User / Session Area in Header */}
          <div className="flex items-center space-x-3">
            {session ? (
              <div className="relative">
                <div className="flex items-center space-x-2">
                  <div
                    onClick={() => setShowCharacterDropdown(!showCharacterDropdown)}
                    className="flex items-center space-x-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/40 rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors"
                  >
                    <img
                      src={session.portraitUrl}
                      alt={session.characterName}
                      className="w-7 h-7 rounded border border-amber-500/40 bg-slate-800 object-cover"
                    />
                    <div className="text-left hidden sm:block">
                      <div className="text-xs font-semibold text-slate-200 leading-tight flex items-center gap-1.5">
                        {session.characterName}
                        {linkedCharacters.length > 1 && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded border border-amber-500/30">
                            {linkedCharacters.length} persos
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">ID: {session.characterId}</div>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
                  </div>

                  <a
                    href="/api/auth/login"
                    title="Lier un autre personnage EVE SSO à cette session"
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

      {/* Main Content */}
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

        {/* If Not Authenticated -> Show Connection Hero */}
        {!session ? (
          <section className="relative overflow-hidden rounded-xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950 p-6 md:p-8 space-y-6">
            <div className="relative z-10 max-w-3xl space-y-4">
              <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
                <Shield className="w-3.5 h-3.5" />
                <span>Phase 04 — Cycle des Ordres &amp; Réapprovisionnement</span>
              </div>
              
              <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-white">
                EVE Online Trade Dashboard
              </h1>
              
              <p className="text-slate-400 text-sm md:text-base leading-relaxed">
                Connectez votre personnage EVE Online pour suivre le cycle de vie de vos ordres de marché, détecter les ruptures de stock imminentes et préparer des listes de réapprovisionnement par hub d&apos;achat et de vente sans manipulation en jeu.
              </p>

              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 max-w-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                    <User className="w-4 h-4 text-amber-400" />
                    Authentification EVE SSO
                  </span>
                  {authConfigured === false && (
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono flex items-center gap-1">
                      <Key className="w-3 h-3" /> Clés à configurer
                    </span>
                  )}
                </div>
                
                <p className="text-xs text-slate-400">
                  Le navigateur ne reçoit aucun token d&apos;accès ou secret. Tout transite par la passerelle sécurisée du serveur.
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
        ) : (
          /* Authenticated Dashboard Interface */
          <div className="space-y-6">
            {/* Top Sync & Status Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Coins className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-white">Passerelle &amp; Synchronisation ESI</h2>
                    {syncStatus && (
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          syncStatus.freshness === 'FRESH'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : syncStatus.freshness === 'STALE'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {syncStatus.freshness === 'FRESH' ? 'DONNÉES FRAÎCHES' : syncStatus.freshness === 'STALE' ? 'PÉRIMÉ' : 'NON SYNCHRONISÉ'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <span>
                      Dernière synchro :{' '}
                      {syncStatus?.transactions.lastSyncCompletedAt
                        ? new Date(syncStatus.transactions.lastSyncCompletedAt).toLocaleString('fr-FR')
                        : 'Jamais'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-3 w-full sm:w-auto">
                <button
                  onClick={handleSync}
                  disabled={isSyncing}
                  className="w-full sm:w-auto px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Synchronisation ESI...' : 'Synchroniser avec ESI'}
                </button>
              </div>
            </div>

            {/* TAB 1: SALES LEDGER */}
            {activeTab === 'ledger' && (
              <div className="space-y-6">
                {/* Summary Metrics Cards */}
                {summary && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                        Chiffre d&apos;Affaires Brut
                      </span>
                      <div className="text-xl font-bold text-emerald-400">
                        {formatIsk(summary.totalGrossSalesIsk)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {summary.sellTransactionsCount} ventes ({summary.totalSellVolume.toLocaleString()} unités)
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 space-y-1">
                      <span className="text-xs font-mono uppercase text-rose-400 flex items-center gap-1.5">
                        <Percent className="w-4 h-4 text-rose-400" />
                        Taxes &amp; Frais ESI
                      </span>
                      <div className="text-xl font-bold text-rose-400">
                        {formatIsk((summary.totalTaxesIsk || 0) + (summary.totalBrokerFeesIsk || 0))}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Taxes: {formatIsk(summary.totalTaxesIsk || 0)} | Frais: {formatIsk(summary.totalBrokerFeesIsk || 0)}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-1">
                      <span className="text-xs font-mono uppercase text-emerald-300 flex items-center gap-1.5">
                        <Coins className="w-4 h-4 text-emerald-300" />
                        Ventes Nettes (TTC)
                      </span>
                      <div className="text-xl font-bold text-emerald-300">
                        {formatIsk(summary.totalNetSalesIsk !== undefined ? summary.totalNetSalesIsk : summary.totalGrossSalesIsk)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Net encaissé après taxes
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <ArrowDownLeft className="w-4 h-4 text-sky-400" />
                        Dépenses d&apos;Achats
                      </span>
                      <div className="text-xl font-bold text-sky-400">
                        {formatIsk(summary.totalBuySpendIsk)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {summary.buyTransactionsCount} achats ({summary.totalBuyVolume.toLocaleString()} unités)
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <PackageCheck className="w-4 h-4 text-amber-400" />
                        Objets &amp; Hubs
                      </span>
                      <div className="text-xl font-bold text-slate-100">
                        {summary.distinctItemsCount} types
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {summary.distinctLocationsCount} stations observées
                      </div>
                    </div>
                  </div>
                )}

                {/* Search & Filter Toolbar */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col md:flex-row gap-3 items-center justify-between">
                  <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
                    <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <button
                        onClick={() => { setFilterType('ALL'); setPage(1); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          filterType === 'ALL' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Toutes
                      </button>
                      <button
                        onClick={() => { setFilterType('SELL'); setPage(1); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          filterType === 'SELL' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 shadow' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Ventes
                      </button>
                      <button
                        onClick={() => { setFilterType('BUY'); setPage(1); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          filterType === 'BUY' ? 'bg-sky-950 text-sky-300 border border-sky-800 shadow' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Achats
                      </button>
                    </div>

                    {distinctLocations.length > 0 && (
                      <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs">
                        <Filter className="w-3.5 h-3.5 text-slate-400" />
                        <select
                          value={selectedLocation}
                          onChange={(e) => { setSelectedLocation(e.target.value); setPage(1); }}
                          className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer max-w-[180px] truncate"
                        >
                          <option value="" className="bg-slate-900 text-slate-200">Tous les emplacements</option>
                          {distinctLocations.map((loc) => (
                            <option key={loc.id} value={loc.id} className="bg-slate-900 text-slate-200">
                              {loc.name} ({loc.count})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="relative w-full md:w-72">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Rechercher objet, station, ID..."
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500/50 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Transactions Table */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 font-mono text-slate-400">
                          <th className="py-3 px-4">Date (UTC)</th>
                          <th className="py-3 px-4">Type</th>
                          <th className="py-3 px-4">Objet</th>
                          <th className="py-3 px-4 text-right">Quantité</th>
                          <th className="py-3 px-4 text-right">Prix Unitaire</th>
                          <th className="py-3 px-4 text-right">Montant Brut</th>
                          <th className="py-3 px-4 text-right">Taxes &amp; Frais</th>
                          <th className="py-3 px-4 text-right">Net (TTC)</th>
                          <th className="py-3 px-4">Emplacement / Station</th>
                          <th className="py-3 px-4 text-center">Détail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {ledgerLoading ? (
                          <tr>
                            <td colSpan={10} className="py-8 text-center text-slate-500 font-mono">
                              Chargement des transactions...
                            </td>
                          </tr>
                        ) : transactions.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="py-12 text-center text-slate-400 space-y-2">
                              <Info className="w-8 h-8 text-slate-600 mx-auto" />
                              <div className="text-sm font-medium">Aucune transaction trouvée</div>
                              <div className="text-xs text-slate-500">
                                {summary?.totalTransactionsCount === 0
                                  ? 'Cliquez sur « Synchroniser avec ESI » pour importer vos transactions.'
                                  : 'Aucune transaction ne correspond à vos filtres actuels.'}
                              </div>
                            </td>
                          </tr>
                        ) : (
                          transactions.map((tx) => {
                            const totalFees = (tx.tax || 0) + (tx.brokerFee || 0);
                            return (
                              <tr
                                key={tx.id}
                                className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                                onClick={() => handleInspectTransaction(tx)}
                              >
                                <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                                  {new Date(tx.date).toLocaleDateString('fr-FR')} {new Date(tx.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="py-3 px-4 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-semibold border ${
                                      tx.isBuy
                                        ? 'bg-sky-950/60 text-sky-400 border-sky-800/60'
                                        : 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                                    }`}
                                  >
                                    {tx.isBuy ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                                    {tx.isBuy ? 'ACHAT' : 'VENTE'}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-medium text-slate-200">
                                  {tx.typeName || `Type #${tx.typeId}`}
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-slate-300">
                                  {tx.quantity.toLocaleString()}
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-slate-400">
                                  {formatIsk(tx.unitPrice)}
                                </td>
                                <td
                                  className={`py-3 px-4 text-right font-mono font-semibold ${
                                    tx.isBuy ? 'text-sky-400' : 'text-slate-200'
                                  }`}
                                >
                                  {formatIsk(tx.totalValue)}
                                </td>
                                <td className="py-3 px-4 text-right font-mono whitespace-nowrap">
                                  {totalFees > 0 ? (
                                    <div>
                                      <span className="text-rose-400 font-medium">-{formatIsk(totalFees)}</span>
                                      {tx.tax !== undefined && tx.tax > 0 && (
                                        <div className="text-[10px] text-slate-500">Taxe: {formatIsk(tx.tax)}</div>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-slate-600">—</span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-right font-mono font-bold whitespace-nowrap">
                                  <span className={tx.isBuy ? 'text-sky-400' : 'text-emerald-400'}>
                                    {formatIsk(tx.netValue !== undefined ? tx.netValue : tx.totalValue)}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-slate-400 truncate max-w-[200px]" title={tx.locationName}>
                                  {tx.locationName || `Location #${tx.locationId}`}
                                </td>
                                <td className="py-3 px-4 text-center">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleInspectTransaction(tx); }}
                                    className="p-1 rounded bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-300 transition-colors"
                                    title="Inspecter preuves ESI"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between p-3 border-t border-slate-800 bg-slate-950/40 text-xs">
                      <span className="text-slate-400 font-mono">
                        Page {page} sur {totalPages} ({totalCount} transactions)
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page <= 1}
                          className="p-1.5 rounded border border-slate-800 bg-slate-900 disabled:opacity-40 text-slate-300 hover:bg-slate-800"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page >= totalPages}
                          className="p-1.5 rounded border border-slate-800 bg-slate-900 disabled:opacity-40 text-slate-300 hover:bg-slate-800"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: MARKET ORDERS & LIFECYCLE (PHASE 04) */}
            {activeTab === 'orders' && (
              <div className="space-y-6">
                {/* Orders Summary Cards */}
                {orderSummary && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <ClipboardList className="w-4 h-4 text-emerald-400" />
                        Ordres Actifs en Marché
                      </span>
                      <div className="text-xl font-bold text-emerald-400">
                        {orderSummary.activeOrdersCount + orderSummary.partiallyFilledCount}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {orderSummary.partiallyFilledCount} partiellement exécutés
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <Coins className="w-4 h-4 text-amber-400" />
                        Valeur Active en Vente
                      </span>
                      <div className="text-xl font-bold text-amber-300">
                        {formatIsk(orderSummary.totalActiveIskValue)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Capital en ordres de vente
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-sky-400" />
                        Caution Escrow (Achats)
                      </span>
                      <div className="text-xl font-bold text-sky-400">
                        {formatIsk(orderSummary.totalActiveEscrowIsk)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Fonds bloqués en ordres d&apos;achat
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        Ordres Disparus Non Confirmés
                      </span>
                      <div className="text-xl font-bold text-amber-400">
                        {orderSummary.disappearedCount}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Vente ou annulation à confirmer
                      </div>
                    </div>
                  </div>
                )}

                {/* Filter Toolbar */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col md:flex-row gap-3 items-center justify-between">
                  <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
                    <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <button
                        onClick={() => { setOrderStateFilter('ALL'); setOrdersPage(1); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          orderStateFilter === 'ALL' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Tous
                      </button>
                      <button
                        onClick={() => { setOrderStateFilter('ACTIVE_ALL'); setOrdersPage(1); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          orderStateFilter === 'ACTIVE_ALL' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 shadow' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        En Cours (Actifs &amp; Partiels)
                      </button>
                      <button
                        onClick={() => { setOrderStateFilter('COMPLETED_CONFIRMED'); setOrdersPage(1); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          orderStateFilter === 'COMPLETED_CONFIRMED' ? 'bg-purple-950 text-purple-300 border border-purple-800 shadow' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Complétés
                      </button>
                      <button
                        onClick={() => { setOrderStateFilter('DISAPPEARED_UNCONFIRMED'); setOrdersPage(1); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          orderStateFilter === 'DISAPPEARED_UNCONFIRMED' ? 'bg-amber-950 text-amber-300 border border-amber-800 shadow' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Disparus
                      </button>
                    </div>
                  </div>

                  <div className="relative w-full md:w-72">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Filtrer ordre, article, station..."
                      value={ordersSearch}
                      onChange={(e) => { setOrdersSearch(e.target.value); setOrdersPage(1); }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500/50 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Orders Table */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 font-mono text-slate-400">
                          <th className="py-3 px-4">Émis le (UTC)</th>
                          <th className="py-3 px-4">Sens</th>
                          <th className="py-3 px-4">Objet</th>
                          <th className="py-3 px-4 text-center">Progression Volume</th>
                          <th className="py-3 px-4 text-right">Prix Unitaire</th>
                          <th className="py-3 px-4">Emplacement</th>
                          <th className="py-3 px-4">État &amp; Traçabilité</th>
                          <th className="py-3 px-4 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {orders.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-12 text-center text-slate-400 space-y-2">
                              <ClipboardList className="w-8 h-8 text-slate-600 mx-auto" />
                              <div className="text-sm font-medium">Aucun ordre de marché trouvé</div>
                              <div className="text-xs text-slate-500">
                                Cliquez sur « Synchroniser avec ESI » pour charger vos ordres actifs et récents.
                              </div>
                            </td>
                          </tr>
                        ) : (
                          orders.map((o) => {
                            const percentFilled = o.volumeTotal > 0 ? Math.round((o.volumeFilled / o.volumeTotal) * 100) : 0;
                            return (
                              <tr
                                key={o.id}
                                className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                                onClick={() => setSelectedOrder(o)}
                              >
                                <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                                  {new Date(o.issued).toLocaleDateString('fr-FR')} {new Date(o.issued).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="py-3 px-4 whitespace-nowrap">
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-semibold border ${
                                      o.isBuyOrder
                                        ? 'bg-sky-950/60 text-sky-400 border-sky-800/60'
                                        : 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                                    }`}
                                  >
                                    {o.isBuyOrder ? 'ACHAT' : 'VENTE'}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-medium text-slate-200">
                                  {o.typeName || `Type #${o.typeId}`}
                                </td>
                                <td className="py-3 px-4 min-w-[160px]">
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-[11px] font-mono text-slate-400">
                                      <span>{o.volumeFilled.toLocaleString()} / {o.volumeTotal.toLocaleString()}</span>
                                      <span>{percentFilled}%</span>
                                    </div>
                                    <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          percentFilled === 100 ? 'bg-purple-400' : percentFilled > 0 ? 'bg-sky-400' : 'bg-slate-700'
                                        }`}
                                        style={{ width: `${percentFilled}%` }}
                                      />
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-slate-300">
                                  {formatIsk(o.price)}
                                </td>
                                <td className="py-3 px-4 text-slate-400 truncate max-w-[180px]" title={o.locationName}>
                                  {o.locationName || `Location #${o.locationId}`}
                                </td>
                                <td className="py-3 px-4">
                                  {getOrderStatusBadge(o.state)}
                                </td>
                                <td className="py-3 px-4 text-center">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setSelectedOrder(o); }}
                                    className="p-1 rounded bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-300 transition-colors"
                                    title="Détails de l'ordre"
                                  >
                                    <FileText className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {ordersTotalPages > 1 && (
                    <div className="flex items-center justify-between p-3 border-t border-slate-800 bg-slate-950/40 text-xs">
                      <span className="text-slate-400 font-mono">
                        Page {ordersPage} sur {ordersTotalPages} ({ordersTotalCount} ordres)
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                          disabled={ordersPage <= 1}
                          className="p-1.5 rounded border border-slate-800 bg-slate-900 disabled:opacity-40 text-slate-300 hover:bg-slate-800"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
                          disabled={ordersPage >= ordersTotalPages}
                          className="p-1.5 rounded border border-slate-800 bg-slate-900 disabled:opacity-40 text-slate-300 hover:bg-slate-800"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: RESTOCK LISTS / RÉAPPROVISIONNEMENT (PHASE 04) */}
            {activeTab === 'restock' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/60">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4 text-amber-400" />
                      Listes de Réapprovisionnement Locales
                    </h3>
                    <p className="text-xs text-slate-400">
                      Préparez vos listes d&apos;achats par hub cible avant vos déplacements. Projection locale modifiable, sans mutation en jeu.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={handleGenerateRestock}
                      disabled={isGeneratingRestock}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      {isGeneratingRestock ? 'Analyse en cours...' : 'Générer suggestions'}
                    </button>
                    <button
                      onClick={() => setShowAddRestockModal(true)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter un article
                    </button>
                  </div>
                </div>

                {/* Restock Items Grouped by Hub */}
                {restockItems.length === 0 ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
                    <ShoppingCart className="w-10 h-10 text-slate-600 mx-auto" />
                    <h4 className="text-sm font-semibold text-slate-300">Aucun article dans la liste de réapprovisionnement</h4>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Cliquez sur « Générer suggestions » pour détecter automatiquement les articles épuisés ou en stock faible, ou ajoutez un article manuellement.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {restockItems.map((item) => (
                        <div
                          key={item.id}
                          className={`p-4 rounded-xl border transition-colors space-y-3 ${
                            item.status === 'PURCHASED'
                              ? 'border-emerald-800/40 bg-emerald-950/20 opacity-75'
                              : item.status === 'PLANNED'
                              ? 'border-sky-800/50 bg-sky-950/20'
                              : 'border-slate-800 bg-slate-900/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-xs font-bold text-slate-100 block">{item.typeName}</span>
                              <span className="text-[10px] text-slate-400 font-mono">Type ID: #{item.typeId}</span>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                                item.status === 'PURCHASED'
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                  : item.status === 'PLANNED'
                                  ? 'bg-sky-950 text-sky-300 border-sky-800'
                                  : 'bg-amber-950 text-amber-300 border-amber-800'
                              }`}
                            >
                              {item.status === 'SUGGESTED' ? 'SUGGÉRÉ' : item.status === 'PLANNED' ? 'PLANIFIÉ' : 'ACHETÉ'}
                            </span>
                          </div>

                          <div className="space-y-1 text-xs text-slate-300">
                            <div className="flex justify-between">
                              <span className="text-slate-400">Hub d&apos;achat cible :</span>
                              <span className="font-medium text-slate-200 truncate max-w-[160px]" title={item.targetBuyHubName}>
                                {item.targetBuyHubName}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-400">Station de revente :</span>
                              <span className="font-medium text-slate-200 truncate max-w-[160px]" title={item.sellHubName}>
                                {item.sellHubName}
                              </span>
                            </div>
                            <div className="flex justify-between font-mono">
                              <span className="text-slate-400">Quantité cible :</span>
                              <span className="font-bold text-amber-300">{item.targetQuantity.toLocaleString()} unités</span>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-400 italic bg-slate-950/60 p-2 rounded border border-slate-800/80">
                            {item.justification}
                          </div>

                          {item.notes && (
                            <div className="text-[11px] text-sky-300 bg-sky-950/30 p-2 rounded border border-sky-900/40">
                              Note : {item.notes}
                            </div>
                          )}

                          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {item.status !== 'PURCHASED' ? (
                                <button
                                  onClick={() => handleUpdateRestockStatus(item, 'PURCHASED')}
                                  className="px-2 py-1 rounded bg-emerald-950/80 hover:bg-emerald-800 text-emerald-300 text-[11px] font-medium border border-emerald-800 flex items-center gap-1 transition-colors"
                                >
                                  <CheckSquare className="w-3 h-3" />
                                  Marquer acheté
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleUpdateRestockStatus(item, 'PLANNED')}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-colors"
                                >
                                  Repasser en planifié
                                </button>
                              )}
                            </div>

                            <button
                              onClick={() => handleDeleteRestockItem(item.id)}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                              title="Supprimer de la liste"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: WALLET JOURNAL */}
            {activeTab === 'journal' && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden space-y-4 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <Coins className="w-4 h-4 text-amber-400" />
                      Journal de Portefeuille (Frais &amp; Taxes CCP)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Entrées de journal ESI pour traçabilité des commissions de courtage (brokers fee) et taxes de vente.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 font-mono text-slate-400">
                        <th className="py-2.5 px-4">Date (UTC)</th>
                        <th className="py-2.5 px-4">Type de Réf</th>
                        <th className="py-2.5 px-4">Description</th>
                        <th className="py-2.5 px-4 text-right">Montant (ISK)</th>
                        <th className="py-2.5 px-4 text-right">Taxe (ISK)</th>
                        <th className="py-2.5 px-4 text-right">Solde</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {journalEntries.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-slate-500 font-mono">
                            Aucune entrée de journal enregistrée.
                          </td>
                        </tr>
                      ) : (
                        journalEntries.map((jn) => (
                          <tr key={jn.id} className="hover:bg-slate-800/40">
                            <td className="py-2.5 px-4 font-mono text-slate-400">
                              {new Date(jn.date).toLocaleDateString('fr-FR')} {new Date(jn.date).toLocaleTimeString('fr-FR')}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-amber-400">
                              {jn.refType}
                            </td>
                            <td className="py-2.5 px-4 text-slate-300">
                              {jn.description}
                            </td>
                            <td className={`py-2.5 px-4 text-right font-mono font-medium ${
                              (jn.amount || 0) < 0 ? 'text-rose-400' : 'text-emerald-400'
                            }`}>
                              {jn.amount !== undefined ? formatIsk(jn.amount) : '—'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-slate-400">
                              {jn.tax ? formatIsk(jn.tax) : '—'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-slate-400">
                              {jn.balance !== undefined ? formatIsk(jn.balance) : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB: HUBS & ROI TTC (PHASE 05) */}
            {activeTab === 'hubs-roi' && (
              <div className="space-y-6">
                {/* Multi-Character Trading Ecosystem Card */}
                <div className="p-4 rounded-xl border border-sky-500/25 bg-gradient-to-r from-sky-950/30 via-slate-900/60 to-slate-900/30 space-y-3">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
                        <Users className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-mono uppercase text-sky-400 font-semibold flex items-center gap-2">
                          <span>Écosystème Commercial Multi-Personnages</span>
                          <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-mono border border-sky-500/30">
                            {linkedCharacters.length} personnage{linkedCharacters.length > 1 ? 's' : ''} connecté{linkedCharacters.length > 1 ? 's' : ''}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5 max-w-2xl">
                          {linkedCharacters.length > 1
                            ? 'Tous les achats et ventes de vos personnages sont regroupés dans un même pool chronologique (FIFO). Les achats du Personnage A (ex: acheteur Jita) alimentent automatiquement les ventes du Personnage B (ex: vendeur régional).'
                            : 'Un seul personnage est actuellement lié à cette session. Si vous utilisez un personnage acheteur (ex: Jita) et un personnage vendeur (ex: Dodixie / Amarr), liez votre second personnage pour que la réconciliation FIFO couvre 100% de vos flux au lieu d\'un taux partiel.'}
                        </p>
                      </div>
                    </div>

                    <a
                      href="/api/auth/login"
                      className="px-3.5 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold flex items-center gap-2 shadow-lg shadow-sky-500/10 shrink-0 transition-transform active:scale-95"
                    >
                      <UserPlus className="w-4 h-4" />
                      + Lier un Personnage EVE SSO
                    </a>
                  </div>

                  {/* Badges of all participating characters */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                    <span className="text-[11px] font-mono text-slate-400 mr-1">Personnages du pool :</span>
                    {linkedCharacters.map((c) => {
                      const isCurrent = c.characterId === session?.characterId;
                      return (
                        <div
                          key={c.characterId}
                          onClick={() => !isCurrent && handleSwitchCharacter(c.characterId)}
                          className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition-colors ${
                            isCurrent
                              ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                              : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300'
                          }`}
                          title={isCurrent ? 'Personnage actuellement sélectionné' : 'Cliquer pour basculer sur ce personnage'}
                        >
                          <img
                            src={c.portraitUrl}
                            alt={c.characterName}
                            className="w-5 h-5 rounded object-cover border border-slate-700"
                          />
                          <span className="font-medium">{c.characterName}</span>
                          {isCurrent ? (
                            <span className="text-[9px] font-mono text-amber-400 bg-amber-400/20 px-1 py-0.2 rounded">ACTIF</span>
                          ) : (
                            <span className="text-[9px] font-mono text-slate-500">BASCULER</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Financial KPIs */}
                {roiSummary && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                        Chiffre d&apos;Affaires Brut
                      </span>
                      <div className="text-xl font-bold text-emerald-400">
                        {formatIsk(roiSummary.gross_revenue_isk)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {roiSummary.total_sales_volume.toLocaleString()} unités vendues ({roiSummary.period_label})
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <Coins className="w-4 h-4 text-sky-400" />
                        Coût Alloué TTC
                      </span>
                      <div className="text-xl font-bold text-sky-400">
                        {formatIsk(roiSummary.total_allocated_investment_ttc)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Achats: {formatIsk(roiSummary.allocated_buy_cost_isk)} + Frais: {formatIsk(roiSummary.allocated_buy_fees_isk)}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <TrendingUp className="w-4 h-4 text-amber-400" />
                        Profit Réalisé TTC
                      </span>
                      <div className={`text-xl font-bold ${
                        roiSummary.realized_profit_ttc_isk === null
                          ? 'text-slate-500'
                          : roiSummary.realized_profit_ttc_isk >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}>
                        {roiSummary.realized_profit_ttc_isk !== null
                          ? formatIsk(roiSummary.realized_profit_ttc_isk)
                          : 'INCONNU'}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Net de taxes de cession ({formatIsk(roiSummary.attributable_sell_fees_isk)})
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                          <Percent className="w-4 h-4 text-purple-400" />
                          ROI Réalisé TTC
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          roiSummary.coverage_status === 'COMPLETE'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : roiSummary.coverage_status === 'PARTIAL'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : roiSummary.coverage_status === 'UNKNOWN'
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {roiSummary.coverage_status === 'COMPLETE'
                            ? '100% COUVERT'
                            : roiSummary.coverage_status === 'PARTIAL'
                            ? `${roiSummary.coverage_percent}% COUVERT`
                            : roiSummary.coverage_status === 'UNKNOWN'
                            ? 'PREUVES MANQUANTES'
                            : 'VIDE'}
                        </span>
                      </div>
                      <div className="text-xl font-bold text-slate-100">
                        {roiSummary.roi_percent_ttc !== null ? `${roiSummary.roi_percent_ttc} %` : 'NON CALCULABLE'}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {roiSummary.allocated_sales_volume} / {roiSummary.total_sales_volume} unités allouées
                      </div>
                    </div>
                  </div>
                )}

                {/* Capital Immobilisé & Invendus Card */}
                {roiSummary && (
                  <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                        <Scale className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-mono uppercase text-amber-400 font-semibold">
                          Capital Immobilisé (Stock Invendu Non Alloué)
                        </div>
                        <div className="text-lg font-bold text-slate-100">
                          {formatIsk(roiSummary.tied_up_capital_isk)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {roiSummary.unsold_items_count} lots d&apos;achats conservent du capital immobilisé sans profit fictif anticipé.
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 w-full md:w-auto">
                      {reconcileMessage && (
                        <div className="text-xs text-sky-400 font-mono flex items-center gap-1.5 mr-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                          {reconcileMessage}
                        </div>
                      )}
                      <button
                        onClick={handleAutoReconcile}
                        disabled={isReconciling}
                        className="px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 shadow disabled:opacity-50"
                        title="Rapproche automatiquement les ventes avec les achats antérieurs du même objet par ordre chronologique"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isReconciling ? 'animate-spin' : ''}`} />
                        {isReconciling ? 'Rapprochement FIFO...' : 'Rapprochement FIFO Automatique'}
                      </button>
                      <button
                        onClick={() => setShowAddAllocationModal(true)}
                        className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 shadow"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        Allocation Manuelle
                      </button>
                    </div>
                  </div>
                )}

                {/* Hub Pairs Performance Table */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
                  <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <Layers className="w-4 h-4 text-amber-400" />
                        Performance par Paire de Hubs (Hub Achat → Hub Vente)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Calculs financiers basés uniquement sur les flux vérifiables avec frais TTC attribués.
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 font-mono text-slate-400">
                          <th className="py-2.5 px-4">Hub Achat Source</th>
                          <th className="py-2.5 px-4">Hub Vente Cible</th>
                          <th className="py-2.5 px-4 text-right">Volume Alloué</th>
                          <th className="py-2.5 px-4 text-right">Chiffre d&apos;Affaires</th>
                          <th className="py-2.5 px-4 text-right">Investissement TTC</th>
                          <th className="py-2.5 px-4 text-right">Profit Réalisé TTC</th>
                          <th className="py-2.5 px-4 text-right">ROI TTC (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {!roiSummary?.hub_pairs || roiSummary.hub_pairs.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-slate-500 font-mono">
                              Aucune allocation de paire de hubs enregistrée. Rapprochez des transactions pour afficher les flux.
                            </td>
                          </tr>
                        ) : (
                          roiSummary.hub_pairs.map((pair, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/40">
                              <td className="py-2.5 px-4 font-medium text-sky-400">
                                {pair.buy_hub_name}
                              </td>
                              <td className="py-2.5 px-4 font-medium text-emerald-400">
                                {pair.sell_hub_name}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-slate-300">
                                {pair.sold_volume_allocated.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-slate-200 font-semibold">
                                {formatIsk(pair.gross_revenue)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-slate-300">
                                {formatIsk(pair.allocated_buy_cost + pair.allocated_buy_fees)}
                              </td>
                              <td className={`py-2.5 px-4 text-right font-mono font-bold ${
                                (pair.realized_profit_ttc || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {pair.realized_profit_ttc !== null ? formatIsk(pair.realized_profit_ttc) : '—'}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono text-purple-300 font-semibold">
                                {pair.roi_percent_ttc !== null ? `${pair.roi_percent_ttc} %` : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Hub Configuration & Location Mappings Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Configured Hubs */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <MapPin className="w-4 h-4 text-amber-400" />
                        <h4 className="text-sm font-bold text-slate-100">Hubs Commerciaux Configurés</h4>
                      </div>
                      <button
                        onClick={() => setShowAddHubModal(true)}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Nouveau Hub
                      </button>
                    </div>

                    <div className="space-y-2">
                      {hubsList.map((h) => (
                        <div key={h.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                          <div>
                            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                              {h.name}
                              {h.is_system_default && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">Défaut EVE</span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              Système : {h.system_name || 'N/A'} {h.notes ? `• ${h.notes}` : ''}
                            </div>
                          </div>
                          {!h.is_system_default && (
                            <button
                              onClick={() => handleDeleteHub(h.id)}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                              title="Supprimer le hub"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Location Mappings */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Building2 className="w-4 h-4 text-amber-400" />
                        <h4 className="text-sm font-bold text-slate-100">Rattachement Stations / Structures</h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleAutoDiscoverHubs}
                          className="px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
                          title="Auto-détecter les hubs et stations observées dans les transactions"
                        >
                          <Sparkles className="w-3 h-3 text-amber-400" /> Auto-découvrir
                        </button>
                        <button
                          onClick={() => setShowAddMappingModal(true)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Associer
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {hubsMappings.map((m) => {
                        const hub = hubsList.find((h) => h.id === m.hub_id);
                        return (
                          <div key={m.location_id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between">
                            <div className="max-w-[80%]">
                              <div className="text-xs font-medium text-slate-200 truncate" title={m.location_name}>
                                {m.location_name}
                              </div>
                              <div className="text-[11px] text-sky-400 font-mono">
                                ID {m.location_id} → {hub?.name || m.hub_id}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteMapping(m.location_id)}
                              className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                              title="Supprimer l'association"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Explicit Cost Allocations List */}
                <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-amber-400" />
                        Rapprochements &amp; Allocations Explicites Enregistrées
                      </h4>
                      <p className="text-xs text-slate-400">
                        Chaque allocation lie formellement une vente à un achat avec preuve sans FIFO/coût moyen implicite.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {allocations.length === 0 ? (
                      <div className="p-6 text-center text-slate-500 font-mono text-xs">
                        Aucun rapprochement enregistré. Cliquez sur « Allouer Coût d&apos;Achat » pour en créer un.
                      </div>
                    ) : (
                      allocations.map((a) => (
                        <div key={a.id} className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                          <div className="space-y-1">
                            <div className="font-semibold text-slate-200">
                              {a.type_name} — {a.quantity_allocated.toLocaleString()} unités
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              Vente #{a.sell_transaction_id} ({a.sell_hub_name}) ← Achat #{a.buy_transaction_id} ({a.buy_hub_name} @ {formatIsk(a.unit_buy_price)})
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              Coût: {formatIsk(a.allocated_buy_cost)} | Frais Achat: {formatIsk(a.allocated_buy_fees)} | Frais Vente: {formatIsk(a.allocated_sell_fees)}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteAllocation(a.id)}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                            title="Supprimer le rapprochement"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* System & Architecture Overview (Active when Overview tab is selected or unauthenticated) */}
        {(activeTab === 'overview' || !session) && (
          <section className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                    <Server className="w-4 h-4 text-sky-400" />
                    Backend &amp; SSO
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800 font-mono">
                    Port 3000
                  </span>
                </div>
                <div className="text-sm font-medium text-slate-200">
                  {loading ? (
                    <span className="text-slate-500">Chargement...</span>
                  ) : health ? (
                    <span className="text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Connecté (v{health.version})
                    </span>
                  ) : (
                    <span className="text-rose-400">Serveur indisponible</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  GET /api/health — {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : 'N/A'}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    Passerelle ESI
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                    {esiStatus?.rateLimit ? `${esiStatus.rateLimit.errorLimitRemain}/100 Budget` : 'Actif'}
                  </span>
                </div>
                <div className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Cache ETag &amp; 304
                </div>
                <div className="text-xs text-slate-500">
                  {esiStatus?.cacheSize !== undefined ? `Entrées en cache : ${esiStatus.cacheSize} | Retries bornés 5xx` : 'Gestion 420/429 & Retry-After'}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-amber-400" />
                    Sécurité Sessions
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono">
                    PKCE S256
                  </span>
                </div>
                <div className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Cookie HttpOnly &amp; SameSite
                </div>
                <div className="text-xs text-slate-500">
                  Protection anti-CSRF par state aléatoire à usage unique
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-purple-400" />
                    Cycle des Ordres
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-800 font-mono">
                    Phase 04
                  </span>
                </div>
                <div className="text-sm font-medium text-slate-200">
                  Machine à États &amp; Diff
                </div>
                <div className="text-xs text-slate-500">
                  Traçabilité des disparitions et listes locales
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Activity className="w-5 h-5 text-amber-400" />
                  <h2 className="text-lg font-semibold text-slate-100">Feuille de Route (Masterplan)</h2>
                </div>
                <span className="text-xs text-slate-400 font-mono">Phases de développement</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {phases.map((p) => (
                  <div
                    key={p.id}
                    className="p-4 rounded-lg border border-slate-800 bg-slate-900/30 hover:border-slate-700 transition-colors space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        Phase {p.id}
                      </span>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${
                          p.id === '00' || p.id === '01' || p.id === '02' || p.id === '03' || (p.id === '04' && p.status === 'Actif')
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-800/50 text-slate-500 border border-slate-800'
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <h3 className="font-medium text-slate-200 text-sm">{p.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">{p.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/20 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-amber-400" />
                Règles &amp; Invariants Métier EVE
              </h3>
              <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
                <li>La disparition d&apos;un order_id d&apos;un snapshot ESI ne prouve pas une vente complète (état DISAPPEARED_UNCONFIRMED).</li>
                <li>Les listes de réapprovisionnement sont des projections locales privées sans écriture sur le marché ESI.</li>
                <li>Tokens OAuth, secrets et requêtes privées strictement gérés côté serveur.</li>
                <li>Aucun calcul implicite FIFO non explicite ; distinction nette des états UNKNOWN, PARTIAL, ERROR, ABSENT.</li>
              </ul>
            </div>
          </section>
        )}
      </main>

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

                {/* Tax & Fee Details */}
                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="text-rose-400 block text-[11px]">Taxe de Transaction (CCP) :</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedTx.tax !== undefined && selectedTx.tax > 0 ? formatIsk(selectedTx.tax) : '0.00 ISK'}
                  </span>
                </div>

                <div className="p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="text-rose-400 block text-[11px]">Frais de Courtage (Brokers Fee) :</span>
                  <span className="text-slate-200 font-semibold">
                    {selectedTx.brokerFee !== undefined && selectedTx.brokerFee > 0 ? formatIsk(selectedTx.brokerFee) : '0.00 ISK'}
                  </span>
                </div>

                <div className="col-span-2 p-2.5 rounded bg-amber-500/10 border border-amber-500/30 flex justify-between items-center">
                  <div>
                    <span className="text-amber-300 block text-[11px] font-sans font-semibold">Montant Net Encaissé / Décaissé (TTC) :</span>
                    <span className="text-[10px] text-slate-400">Après déduction des taxes et commissions de courtage ESI</span>
                  </div>
                  <span className={`text-base font-bold ${selectedTx.isBuy ? 'text-sky-400' : 'text-emerald-400'}`}>
                    {formatIsk(selectedTx.netValue !== undefined ? selectedTx.netValue : selectedTx.totalValue)}
                  </span>
                </div>

                <div className="col-span-2">
                  <span className="text-slate-500 block">Article :</span>
                  <span className="text-slate-200 font-medium">{selectedTx.typeName} (Type ID #{selectedTx.typeId})</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Emplacement :</span>
                  <span className="text-slate-200">{selectedTx.locationName} (Location ID #{selectedTx.locationId})</span>
                </div>
              </div>

              {/* Linked Journal Entries */}
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
                    Aucune taxe ou commission de courtage supplémentaire liée à cette transaction immédiate.
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

      {/* Order Detail Modal (Phase 04) */}
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
                  <div>{getOrderStatusBadge(selectedOrder.state)}</div>
                </div>
                <div>
                  <span className="text-slate-500 block">Sens de l&apos;Ordre :</span>
                  <span className={selectedOrder.isBuyOrder ? 'text-sky-400' : 'text-emerald-400'}>
                    {selectedOrder.isBuyOrder ? 'Ordre d\'Achat' : 'Ordre de Vente'}
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
                <div>
                  <span className="text-slate-500 block">Date d&apos;Émission (UTC) :</span>
                  <span className="text-slate-200">{selectedOrder.issued}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Expiration Estimée :</span>
                  <span className="text-slate-200">{selectedOrder.expiresAt}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Article :</span>
                  <span className="text-slate-200 font-medium">{selectedOrder.typeName} (Type #{selectedOrder.typeId})</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Emplacement :</span>
                  <span className="text-slate-200">{selectedOrder.locationName}</span>
                </div>
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

      {/* Add Restock Item Modal (Phase 04) */}
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

      {/* Add Custom Hub Modal (Phase 05) */}
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

      {/* Add Location Mapping Modal (Phase 05) */}
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

      {/* Add Explicit Cost Allocation Modal (Phase 05) */}
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
    </div>
  );
}
