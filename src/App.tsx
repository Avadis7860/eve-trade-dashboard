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
  ClipboardList
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
}

interface AuthSessionResponse {
  authenticated: boolean;
  character?: CharacterSession;
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
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Active Tab View
  const [activeTab, setActiveTab] = useState<'ledger' | 'orders' | 'restock' | 'journal' | 'overview'>('ledger');

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

      const [txRes, summaryRes, syncRes, optionsRes, journalRes] = await Promise.all([
        fetch(`/api/ledger/transactions?${params.toString()}`).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/ledger/summary').then((r) => (r.ok ? r.json() : null)),
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

  const handleSync = async () => {
    if (isSyncing || !session) return;
    setIsSyncing(true);

    try {
      const res = await fetch('/api/ledger/sync', { method: 'POST' });
      if (res.ok) {
        await Promise.all([fetchLedgerData(), fetchOrdersData()]);
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
      if (sessionData && (sessionData as AuthSessionResponse).authenticated && (sessionData as AuthSessionResponse).character) {
        setSession((sessionData as AuthSessionResponse).character || null);
      }
      if (esiData) setEsiStatus(esiData as EsiStatusResponse);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (session) {
      fetchLedgerData();
      fetchOrdersData();
    }
  }, [session, activeTab, fetchLedgerData, fetchOrdersData]);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session');
      if (res.ok) {
        const data: AuthSessionResponse = await res.json();
        if (data.authenticated && data.character) {
          setSession(data.character);
        } else {
          setSession(null);
        }
      }
    } catch (err) {
      console.error('Session check failed:', err);
    }
  }, []);

  // Listen for window focus / visibility change to auto-detect session after OAuth login in new tab
  useEffect(() => {
    const onFocus = () => {
      if (!session) {
        checkSession();
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('visibilitychange', onFocus);
    };
  }, [session, checkSession]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setSession(null);
      setTransactions([]);
      setOrders([]);
      setRestockItems([]);
      setSummary(null);
      setOrderSummary(null);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const phases = [
    { id: '00', name: 'Fondations & CI', status: 'Terminé', desc: 'React, Vite, Express, TypeScript, Vitest, CI' },
    { id: '01', name: 'EVE SSO & Identité', status: session ? 'Connecté' : 'Terminé', desc: 'OAuth 2.0 PKCE, gestion sécurisée des sessions et tokens' },
    { id: '02', name: 'Passerelle ESI Résiliente', status: 'Terminé', desc: 'Cache 304, rate limits (420/429), gestion des erreurs et pagination' },
    { id: '03', name: 'Transactions & Grand Livre', status: 'Terminé', desc: 'Sync wallet idempotente, pagination from_id, grand livre des ventes' },
    { id: '04', name: 'Ordres & Réapprovisionnement', status: 'Actif', desc: 'Snapshots ordres de marché, cycle de vie et listes locales' },
    { id: '05', name: 'Hubs & ROI TTC', status: 'Planifiée', desc: 'Taxes, frais de courtage, rentabilité réelle' },
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
              <div className="flex items-center space-x-3 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5">
                <img
                  src={session.portraitUrl}
                  alt={session.characterName}
                  className="w-7 h-7 rounded border border-amber-500/40 bg-slate-800 object-cover"
                />
                <div className="text-left hidden sm:block">
                  <div className="text-xs font-semibold text-slate-200 leading-tight">{session.characterName}</div>
                  <div className="text-[10px] text-slate-400 font-mono">ID: {session.characterId}</div>
                </div>
                <button
                  onClick={handleLogout}
                  title="Déconnexion"
                  className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                        Chiffre d&apos;Affaires Brut (Ventes)
                      </span>
                      <div className="text-xl font-bold text-emerald-400">
                        {formatIsk(summary.totalGrossSalesIsk)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {summary.sellTransactionsCount} transactions ({summary.totalSellVolume.toLocaleString()} unités)
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <ArrowDownLeft className="w-4 h-4 text-sky-400" />
                        Dépenses d&apos;Approvisionnement (Achats)
                      </span>
                      <div className="text-xl font-bold text-sky-400">
                        {formatIsk(summary.totalBuySpendIsk)}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        {summary.buyTransactionsCount} transactions ({summary.totalBuyVolume.toLocaleString()} unités)
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <PackageCheck className="w-4 h-4 text-amber-400" />
                        Objets &amp; Types Distincts
                      </span>
                      <div className="text-xl font-bold text-slate-100">
                        {summary.distinctItemsCount}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Catalogue d&apos;articles observés
                      </div>
                    </div>

                    <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
                      <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-purple-400" />
                        Stations &amp; Emplacements
                      </span>
                      <div className="text-xl font-bold text-slate-100">
                        {summary.distinctLocationsCount}
                      </div>
                      <div className="text-xs text-slate-400 font-mono">
                        Hubs &amp; stations de transaction
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
                          <th className="py-3 px-4 text-right">Montant Total</th>
                          <th className="py-3 px-4">Emplacement / Station</th>
                          <th className="py-3 px-4 text-center">Détail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {ledgerLoading ? (
                          <tr>
                            <td colSpan={8} className="py-8 text-center text-slate-500 font-mono">
                              Chargement des transactions...
                            </td>
                          </tr>
                        ) : transactions.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="py-12 text-center text-slate-400 space-y-2">
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
                          transactions.map((tx) => (
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
                                  tx.isBuy ? 'text-sky-400' : 'text-emerald-400'
                                }`}
                              >
                                {formatIsk(tx.totalValue)}
                              </td>
                              <td className="py-3 px-4 text-slate-400 truncate max-w-[220px]" title={tx.locationName}>
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
                          ))
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
                  <span className="text-slate-200 font-semibold">{selectedTx.transactionId}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Date &amp; Heure (UTC) :</span>
                  <span className="text-slate-200">{selectedTx.date}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Type :</span>
                  <span className={selectedTx.isBuy ? 'text-sky-400' : 'text-emerald-400'}>
                    {selectedTx.isBuy ? 'Achat (Buy)' : 'Vente (Sell)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Montant Total :</span>
                  <span className="text-slate-200 font-semibold">{formatIsk(selectedTx.totalValue)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Quantité :</span>
                  <span className="text-slate-200">{selectedTx.quantity.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Prix Unitaire :</span>
                  <span className="text-slate-200">{formatIsk(selectedTx.unitPrice)}</span>
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
    </div>
  );
}
