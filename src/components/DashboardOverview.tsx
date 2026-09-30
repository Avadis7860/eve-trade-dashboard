import React from 'react';
import {
  TrendingUp,
  ArrowUpRight,
  Percent,
  Coins,
  PackageCheck,
  ClipboardList,
  AlertTriangle,
  ShoppingCart,
  Scale,
  RefreshCw,
  Copy,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import {
  RoiFinancialSummary,
  OrderSummaryMetrics,
  CharacterOrderSnapshot,
  RestockItem,
  HubPairPerformance,
} from '../App';
import { formatIskValue } from '../utils/preferences';
import { formatEveMultibuy } from '../utils/eveMultibuy';

interface DashboardOverviewProps {
  summary: {
    totalGrossSalesIsk: number;
    totalNetSalesIsk?: number;
    totalTaxesIsk?: number;
    totalBrokerFeesIsk?: number;
    totalBuySpendIsk: number;
    sellTransactionsCount: number;
    buyTransactionsCount: number;
    totalSellVolume: number;
    totalBuyVolume: number;
    distinctItemsCount: number;
    distinctLocationsCount: number;
  } | null;
  roiSummary: RoiFinancialSummary | null;
  orderSummary: OrderSummaryMetrics | null;
  orders: CharacterOrderSnapshot[];
  restockItems: RestockItem[];
  iskDisplayMode: 'full' | 'compact';
  onNavigateTab: (tab: 'ledger' | 'orders' | 'restock' | 'hubs-roi' | 'journal') => void;
  onSync: () => void;
  isSyncing: boolean;
  onAutoReconcile: () => void;
  isReconciling: boolean;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  summary,
  roiSummary,
  orderSummary,
  orders,
  restockItems,
  iskDisplayMode,
  onNavigateTab,
  onSync,
  isSyncing,
  onAutoReconcile,
  isReconciling,
}) => {
  const [copiedMultibuy, setCopiedMultibuy] = React.useState(false);

  const formatIsk = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return formatIskValue(val, iskDisplayMode);
  };

  const disappearedOrders = orders.filter((o) => o.state === 'DISAPPEARED_UNCONFIRMED');
  const pendingRestock = restockItems.filter((i) => i.status !== 'PURCHASED');

  const handleCopyMultibuy = async () => {
    const text = formatEveMultibuy(pendingRestock);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMultibuy(true);
      setTimeout(() => setCopiedMultibuy(false), 2000);
    } catch (e) {
      console.error('Failed to copy multibuy', e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gross Revenue */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
          <div className="text-xs font-mono uppercase text-slate-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
              Chiffre d&apos;Affaires Brut
            </span>
            <span className="text-slate-500 font-normal">
              {summary ? `${summary.sellTransactionsCount} ventes` : '—'}
            </span>
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400">
            {summary ? formatIsk(summary.totalGrossSalesIsk) : '0.00 ISK'}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            {summary ? `${summary.totalSellVolume.toLocaleString()} unités vendues` : '0 unité'}
          </div>
        </div>

        {/* Realized Profit TTC & ROI */}
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-1">
          <div className="text-xs font-mono uppercase text-emerald-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Bénéfice Réalisé (TTC)
            </span>
            {roiSummary?.roi_percent_ttc !== null && roiSummary?.roi_percent_ttc !== undefined && (
              <span className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                ROI +{roiSummary.roi_percent_ttc.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="text-xl font-bold font-mono text-emerald-300">
            {roiSummary?.realized_profit_ttc_isk !== null && roiSummary?.realized_profit_ttc_isk !== undefined
              ? formatIsk(roiSummary.realized_profit_ttc_isk)
              : 'En attente d\'allocation'}
          </div>
          <div className="text-[11px] text-slate-400 font-mono flex items-center justify-between">
            <span>Couverture : {roiSummary ? `${roiSummary.coverage_percent}%` : '0%'}</span>
            <button
              onClick={() => onNavigateTab('hubs-roi')}
              className="text-amber-400 hover:text-amber-300 text-[11px] underline cursor-pointer"
            >
              Gérer allocations
            </button>
          </div>
        </div>

        {/* Taxes & Broker Fees */}
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 space-y-1">
          <div className="text-xs font-mono uppercase text-rose-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Percent className="w-4 h-4 text-rose-400" />
              Taxes &amp; Frais ESI
            </span>
            <span className="text-slate-500">TTC</span>
          </div>
          <div className="text-xl font-bold font-mono text-rose-400">
            {summary
              ? formatIsk((summary.totalTaxesIsk || 0) + (summary.totalBrokerFeesIsk || 0))
              : '0.00 ISK'}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Taxes: {formatIsk(summary?.totalTaxesIsk || 0)} · Frais: {formatIsk(summary?.totalBrokerFeesIsk || 0)}
          </div>
        </div>

        {/* Tied-up Capital */}
        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 space-y-1">
          <div className="text-xs font-mono uppercase text-amber-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-amber-400" />
              Capital Immobilisé
            </span>
            <span className="text-slate-500">{roiSummary?.unsold_items_count ?? 0} lots</span>
          </div>
          <div className="text-xl font-bold font-mono text-amber-300">
            {roiSummary ? formatIsk(roiSummary.tied_up_capital_isk) : '0.00 ISK'}
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Stocks en attente de vente ou transfert
          </div>
        </div>
      </div>

      {/* Quick Action & Flow Hub */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">Actions Rapides :</span>
          <button
            onClick={() => onNavigateTab('ledger')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            Consulter Ventes
          </button>
          <button
            onClick={() => onNavigateTab('orders')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            Suivre Ordres ({orderSummary?.activeOrdersCount ?? 0})
          </button>
          <button
            onClick={() => onNavigateTab('restock')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            Réapprovisionnement ({pendingRestock.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onAutoReconcile}
            disabled={isReconciling}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            {isReconciling ? 'Rapprochement FIFO...' : 'Rapprochement FIFO'}
          </button>
          <button
            onClick={onSync}
            disabled={isSyncing}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Synchro...' : 'Actualiser ESI'}
          </button>
        </div>
      </div>

      {/* Two Column Grid: Market Activity & Restock Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Market Orders Snapshot */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-amber-400" />
              État du Marché &amp; Ordres en Cours
            </h3>
            <button
              onClick={() => onNavigateTab('orders')}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              Voir tous <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <div className="text-lg font-bold font-mono text-emerald-400">
                {orderSummary?.activeOrdersCount ?? 0}
              </div>
              <div className="text-[11px] text-slate-400">Ordres Actifs</div>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <div className="text-lg font-bold font-mono text-sky-400">
                {orderSummary?.partiallyFilledCount ?? 0}
              </div>
              <div className="text-[11px] text-slate-400">Partiels</div>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <div className="text-lg font-bold font-mono text-amber-400">
                {orderSummary?.disappearedCount ?? 0}
              </div>
              <div className="text-[11px] text-slate-400">Disparus</div>
            </div>
          </div>

          {disappearedOrders.length > 0 && (
            <div className="p-3 rounded-lg border border-amber-900/60 bg-amber-950/30 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                Attention : Ordres disparus sans transaction confirmée ({disappearedOrders.length})
              </div>
              <p className="text-[11px] text-slate-300">
                Certains ordres ne figurent plus dans le snapshot ESI. Le statut reste DISAPPEARED_UNCONFIRMED sans inventer de vente complète.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-400 block">Derniers ordres actifs :</span>
            {(() => {
              const activeOrders = orders.filter((o) => o.isActiveInCurrentSnapshot || o.state === 'ACTIVE' || o.state === 'PARTIALLY_FILLED');
              if (activeOrders.length === 0) {
                return (
                  <div className="text-xs text-slate-500 italic p-3 text-center bg-slate-950/60 rounded-lg border border-slate-800/50">
                    Aucun ordre actif en marché actuellement.
                  </div>
                );
              }
              return activeOrders.slice(0, 3).map((o) => (
                <div
                  key={o.id}
                  onClick={() => onNavigateTab('orders')}
                  className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800/80 flex items-center justify-between text-xs cursor-pointer transition-colors"
                >
                  <div>
                    <div className="font-medium text-slate-200 flex items-center gap-2">
                      <span>{o.typeName || `Type #${o.typeId}`}</span>
                      {o.inStockQuantity !== undefined && o.inStockQuantity > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" title="Quantité physique présente dans les actifs à cette station">
                          Stock: {o.inStockQuantity.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {o.isBuyOrder ? 'Achat' : 'Vente'} · {o.volumeFilled}/{o.volumeTotal} un. @ {formatIsk(o.price)}
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                    o.state === 'ACTIVE'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : o.state === 'PARTIALLY_FILLED'
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                      : 'bg-slate-800 text-slate-300'
                  }`}>
                    {o.state === 'ACTIVE' ? 'ACTIF' : o.state === 'PARTIALLY_FILLED' ? 'PARTIEL' : o.state}
                  </span>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Restock List Snapshot */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-sky-400" />
              Réapprovisionnement Urgent ({pendingRestock.length})
            </h3>
            <div className="flex items-center gap-2">
              {pendingRestock.length > 0 && (
                <button
                  onClick={handleCopyMultibuy}
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                  title="Copier au format EVE Multibuy"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedMultibuy ? 'Copié !' : 'Copier Multibuy'}
                </button>
              )}
              <button
                onClick={() => onNavigateTab('restock')}
                className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
              >
                Gérer <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {pendingRestock.length === 0 ? (
            <div className="p-8 text-center text-slate-500 space-y-2">
              <PackageCheck className="w-8 h-8 text-slate-600 mx-auto" />
              <div className="text-xs font-medium">Tous les stocks sont à jour !</div>
              <div className="text-[11px] text-slate-600">Aucun article en attente de réapprovisionnement.</div>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {pendingRestock.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-slate-200">{item.typeName}</div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {item.targetBuyHubName.split(' - ')[0]} → {item.sellHubName.split(' - ')[0]}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold font-mono text-amber-300">
                      {item.targetQuantity.toLocaleString()} un.
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-300">
                      {item.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Hub Pairs Performance */}
      {roiSummary && roiSummary.hub_pairs && roiSummary.hub_pairs.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Scale className="w-4 h-4 text-emerald-400" />
              Performance des Flux Commerciaux (Paires de Hubs)
            </h3>
            <button
              onClick={() => onNavigateTab('hubs-roi')}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
            >
              Détail &amp; Hubs <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {roiSummary.hub_pairs.slice(0, 3).map((p: HubPairPerformance) => (
              <div
                key={`${p.buy_hub_id}:${p.sell_hub_id}`}
                className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                  <span className="truncate">{p.buy_hub_name} → {p.sell_hub_name}</span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      p.coverage_status === 'COMPLETE'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : p.coverage_status === 'PARTIAL'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {p.coverage_percent}% alloc
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-slate-500 block">Chiffre Brut :</span>
                    <span className="text-slate-200">{formatIsk(p.gross_revenue)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Bénéfice TTC :</span>
                    <span className={p.realized_profit_ttc !== null && p.realized_profit_ttc >= 0 ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                      {p.realized_profit_ttc !== null ? formatIsk(p.realized_profit_ttc) : 'Incomplet'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
