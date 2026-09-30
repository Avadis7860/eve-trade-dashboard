import React from 'react';
import {
  ClipboardList,
  Search,
  Plus,
  Info,
  Layers,
  CheckCircle2,
  Clock,
  XCircle,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Package,
} from 'lucide-react';
import type {
  CharacterOrderSnapshot,
  OrderLifecycleState,
  OrderSummaryMetrics,
} from '../App.tsx';
import { formatIskValue } from '../utils/preferences.ts';

export interface OrdersViewProps {
  orders: CharacterOrderSnapshot[];
  orderSummary: OrderSummaryMetrics | null;
  orderStateFilter: OrderLifecycleState | 'ALL';
  ordersSearch: string;
  ordersPage: number;
  ordersTotalPages: number;
  ordersTotalCount: number;
  iskDisplayMode: 'full' | 'compact';
  onOrderStateFilterChange: (state: OrderLifecycleState | 'ALL') => void;
  onOrdersSearchChange: (search: string) => void;
  onOrdersPageChange: (page: number) => void;
  onSelectOrder: (order: CharacterOrderSnapshot) => void;
  onQuickAddRestock: (order: CharacterOrderSnapshot) => void;
  onOpenProduct360?: (typeId: number) => void;
}

export const OrdersView: React.FC<OrdersViewProps> = ({
  orders,
  orderSummary,
  orderStateFilter,
  ordersSearch,
  ordersPage,
  ordersTotalPages,
  ordersTotalCount,
  iskDisplayMode,
  onOrderStateFilterChange,
  onOrdersSearchChange,
  onOrdersPageChange,
  onSelectOrder,
  onQuickAddRestock,
  onOpenProduct360,
}) => {
  const formatIsk = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return formatIskValue(val, iskDisplayMode);
  };

  const getStateBadge = (state: OrderLifecycleState) => {
    switch (state) {
      case 'ACTIVE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Actif
          </span>
        );
      case 'PARTIALLY_FILLED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Layers className="w-3 h-3" />
            PARTIEL
          </span>
        );
      case 'COMPLETED_CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <CheckCircle2 className="w-3 h-3" />
            Complété
          </span>
        );
      case 'CANCELLED_CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
            <XCircle className="w-3 h-3" />
            Annulé
          </span>
        );
      case 'EXPIRED_CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <Clock className="w-3 h-3" />
            Expiré
          </span>
        );
      case 'DISAPPEARED_UNCONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <HelpCircle className="w-3 h-3" />
            Disparu Non Confirmé
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400">
            Inconnu
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Metrics Cards */}
      {orderSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-amber-400" />
              Ordres Actifs en Marché
            </span>
            <div className="text-xl font-bold font-mono text-slate-100">
              {orderSummary.activeOrdersCount.toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-400">
              {orderSummary.partiallyFilledCount} partiellement remplis
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Valeur Totale Active
            </span>
            <div className="text-xl font-bold font-mono text-emerald-400">
              {formatIsk(orderSummary.totalActiveIskValue)}
            </div>
            <p className="text-[11px] text-slate-400">
              Escrow actif : {formatIsk(orderSummary.totalActiveEscrowIsk)}
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-purple-400" />
              Exécutions Confirmées
            </span>
            <div className="text-xl font-bold font-mono text-purple-400">
              {orderSummary.completedCount.toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-400">
              Validées avec preuve
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-rose-400" />
              Expirés / Annulés
            </span>
            <div className="text-xl font-bold font-mono text-rose-400">
              {(orderSummary.expiredCount + orderSummary.cancelledCount).toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-400">
              {orderSummary.cancelledCount} annulés · {orderSummary.expiredCount} expirés
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-amber-400" />
              Disparus Non Confirmés
            </span>
            <div className="text-xl font-bold font-mono text-amber-400">
              {orderSummary.disappearedCount.toLocaleString()}
            </div>
            <p className="text-[11px] text-slate-400">
              En attente de transaction
            </p>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'ALL', label: 'Tous' },
              { id: 'ACTIVE', label: 'Actifs' },
              { id: 'PARTIALLY_FILLED', label: 'Partiels' },
              { id: 'COMPLETED_CONFIRMED', label: 'Complétés' },
              { id: 'CANCELLED_CONFIRMED', label: 'Annulés' },
              { id: 'EXPIRED_CONFIRMED', label: 'Expirés' },
              { id: 'DISAPPEARED_UNCONFIRMED', label: 'Disparus' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => onOrderStateFilterChange(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                orderStateFilter === tab.id
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Rechercher article, station..."
            value={ordersSearch}
            onChange={(e) => onOrdersSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
          />
        </div>
      </div>

      {/* Orders Table */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-medium">
              <tr>
                <th className="p-3">État &amp; Type</th>
                <th className="p-3">Article</th>
                <th className="p-3">Emplacement / Région</th>
                <th className="p-3 text-right">Prix Unitaire</th>
                <th className="p-3 text-right">Progression Volume</th>
                <th className="p-3 text-right">Valeur Active</th>
                <th className="p-3 text-right">Stock Station</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500 italic">
                    Aucun ordre de marché ne correspond aux filtres sélectionnés.
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const percentFilled =
                    order.volumeTotal > 0
                      ? Math.round((order.volumeFilled / order.volumeTotal) * 100)
                      : 0;

                  return (
                    <tr
                      key={order.id}
                      className="hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="p-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              order.isBuyOrder
                                ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            }`}
                          >
                            {order.isBuyOrder ? 'ACHAT' : 'VENTE'}
                          </span>
                          {getStateBadge(order.state)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          ID #{order.orderId}
                        </div>
                      </td>

                      <td className="p-3">
                        <div className="font-medium text-slate-200">
                          {onOpenProduct360 ? (
                            <button
                              onClick={() => onOpenProduct360(order.typeId)}
                              className="hover:text-amber-400 text-left transition-colors cursor-pointer"
                              title="Voir la fiche Produit 360°"
                            >
                              {order.typeName || `Type #${order.typeId}`}
                            </button>
                          ) : (
                            order.typeName || `Type #${order.typeId}`
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          Type #{order.typeId}
                        </div>
                      </td>

                      <td className="p-3 max-w-xs">
                        <div className="truncate text-slate-300" title={order.locationName}>
                          {order.locationName || `Location #${order.locationId}`}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Région #{order.regionId}
                        </div>
                      </td>

                      <td className="p-3 text-right font-mono text-slate-200">
                        {formatIsk(order.price)}
                      </td>

                      <td className="p-3 text-right">
                        <div className="font-mono text-slate-200">
                          {order.volumeFilled.toLocaleString()} / {order.volumeTotal.toLocaleString()}
                        </div>
                        <div className="w-24 bg-slate-800 h-1.5 rounded-full overflow-hidden ml-auto mt-1">
                          <div
                            className={`h-full ${
                              order.isBuyOrder ? 'bg-sky-400' : 'bg-emerald-400'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, percentFilled))}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {percentFilled}% ({order.volumeRemain.toLocaleString()} restants)
                        </div>
                      </td>

                      <td className="p-3 text-right font-mono font-medium text-slate-100">
                        {formatIsk(order.price * order.volumeRemain)}
                      </td>

                      <td className="p-3 text-right">
                        {order.inStockQuantity !== undefined ? (
                          <span className="inline-flex items-center gap-1 font-mono text-emerald-400 font-medium">
                            <Package className="w-3 h-3 text-emerald-400" />
                            {order.inStockQuantity.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono">—</span>
                        )}
                      </td>

                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => onSelectOrder(order)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                            title="Détails et historique de cycle de l'ordre"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onQuickAddRestock(order)}
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-400 transition-colors cursor-pointer"
                            title="Ajouter au réapprovisionnement"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between p-3 border-t border-slate-800 bg-slate-950/60 text-xs text-slate-400">
          <div>
            Total : <span className="font-mono text-slate-200 font-semibold">{ordersTotalCount}</span> ordres
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onOrdersPageChange(Math.max(1, ordersPage - 1))}
              disabled={ordersPage <= 1}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono">
              Page {ordersPage} sur {ordersTotalPages || 1}
            </span>
            <button
              onClick={() => onOrdersPageChange(Math.min(ordersTotalPages || 1, ordersPage + 1))}
              disabled={ordersPage >= (ordersTotalPages || 1)}
              className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
