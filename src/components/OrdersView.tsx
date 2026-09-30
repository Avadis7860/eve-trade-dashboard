import React from 'react';
import {
  ClipboardList,
  Coins,
  Building2,
  AlertTriangle,
  Search,
  Download,
  FileText,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { CharacterOrderSnapshot, OrderLifecycleState, OrderSummaryMetrics } from '../App';
import { formatIskValue } from '../utils/preferences';
import { ordersToCsv, triggerCsvDownload } from '../utils/csvExport';

interface OrdersViewProps {
  orders: CharacterOrderSnapshot[];
  orderSummary: OrderSummaryMetrics | null;
  orderStateFilter: string;
  ordersSearch: string;
  ordersPage: number;
  ordersTotalPages: number;
  ordersTotalCount: number;
  iskDisplayMode: 'full' | 'compact';
  onOrderStateFilterChange: (state: string) => void;
  onOrdersSearchChange: (search: string) => void;
  onOrdersPageChange: (page: number) => void;
  onSelectOrder: (order: CharacterOrderSnapshot) => void;
  onQuickAddRestock?: (order: CharacterOrderSnapshot) => void;
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
}) => {
  const formatIsk = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return formatIskValue(val, iskDisplayMode);
  };

  const getOrderStatusBadge = (state: OrderLifecycleState) => {
    switch (state) {
      case 'ACTIVE':
        return (
          <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            ACTIF (100%)
          </span>
        );
      case 'PARTIALLY_FILLED':
        return (
          <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20">
            PARTIEL
          </span>
        );
      case 'COMPLETED_CONFIRMED':
        return (
          <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-purple-500/10 text-purple-300 border border-purple-500/20">
            COMPLÉTÉ
          </span>
        );
      case 'DISAPPEARED_UNCONFIRMED':
        return (
          <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
            DISPARU (NON CONFIRMÉ)
          </span>
        );
      case 'CANCELLED_CONFIRMED':
        return (
          <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20">
            ANNULÉ
          </span>
        );
      case 'EXPIRED_CONFIRMED':
        return (
          <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
            EXPIRÉ
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-800 text-slate-500">
            INCONNU
          </span>
        );
    }
  };

  const handleExportCsv = () => {
    const csv = ordersToCsv(orders);
    triggerCsvDownload(`eve-trade-orders-page${ordersPage}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      {/* Orders Summary Cards */}
      {orderSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <ClipboardList className="w-4 h-4 text-emerald-400" />
              Ordres Actifs en Marché
            </span>
            <div className="text-xl font-bold font-mono text-emerald-400">
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
            <div className="text-xl font-bold font-mono text-amber-300">
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
            <div className="text-xl font-bold font-mono text-sky-400">
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
            <div className="text-xl font-bold font-mono text-amber-400">
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
              onClick={() => onOrderStateFilterChange('ALL')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                orderStateFilter === 'ALL'
                  ? 'bg-slate-800 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tous
            </button>
            <button
              onClick={() => onOrderStateFilterChange('ACTIVE_ALL')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                orderStateFilter === 'ACTIVE_ALL'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              En Cours (Actifs &amp; Partiels)
            </button>
            <button
              onClick={() => onOrderStateFilterChange('COMPLETED_CONFIRMED')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                orderStateFilter === 'COMPLETED_CONFIRMED'
                  ? 'bg-purple-950 text-purple-300 border border-purple-800 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Complétés
            </button>
            <button
              onClick={() => onOrderStateFilterChange('DISAPPEARED_UNCONFIRMED')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                orderStateFilter === 'DISAPPEARED_UNCONFIRMED'
                  ? 'bg-amber-950 text-amber-300 border border-amber-800 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Disparus
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filtrer ordre, article, station..."
              value={ordersSearch}
              onChange={(e) => onOrdersSearchChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <button
            onClick={handleExportCsv}
            disabled={orders.length === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Exporter les ordres en CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>
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
                <th className="py-3 px-4 text-center">Actions</th>
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
                  const percentFilled =
                    o.volumeTotal > 0 ? Math.round((o.volumeFilled / o.volumeTotal) * 100) : 0;
                  return (
                    <tr
                      key={o.id}
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                      onClick={() => onSelectOrder(o)}
                    >
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                        {new Date(o.issued).toLocaleDateString('fr-FR')}{' '}
                        {new Date(o.issued).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
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
                            <span>
                              {o.volumeFilled.toLocaleString()} / {o.volumeTotal.toLocaleString()}
                            </span>
                            <span>{percentFilled}%</span>
                          </div>
                          <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800">
                            <div
                              className={`h-full rounded-full transition-all ${
                                percentFilled === 100
                                  ? 'bg-purple-400'
                                  : percentFilled > 0
                                  ? 'bg-sky-400'
                                  : 'bg-slate-700'
                              }`}
                              style={{ width: `${percentFilled}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-300">
                        {formatIsk(o.price)}
                      </td>
                      <td
                        className="py-3 px-4 text-slate-400 truncate max-w-[180px]"
                        title={o.locationName}
                      >
                        {o.locationName || `Location #${o.locationId}`}
                      </td>
                      <td className="py-3 px-4">{getOrderStatusBadge(o.state)}</td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectOrder(o);
                            }}
                            className="p-1 rounded bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-300 transition-colors"
                            title="Détails de l'ordre"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                          {onQuickAddRestock && !o.isBuyOrder && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onQuickAddRestock(o);
                              }}
                              className="p-1 rounded bg-slate-800 hover:bg-sky-500 hover:text-slate-950 text-slate-300 transition-colors"
                              title="Planifier le réapprovisionnement"
                            >
                              <ShoppingCart className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
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
                onClick={() => onOrdersPageChange(Math.max(1, ordersPage - 1))}
                disabled={ordersPage <= 1}
                className="p-1.5 rounded border border-slate-800 bg-slate-900 disabled:opacity-40 text-slate-300 hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => onOrdersPageChange(Math.min(ordersTotalPages, ordersPage + 1))}
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
  );
};
