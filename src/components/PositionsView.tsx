import React, { useState } from 'react';
import {
  ClipboardList,
  Layers,
  Search,
  Download,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import {
  CharacterOrderSnapshot,
  OrderSummaryMetrics,
} from '../App';
import { ordersToCsv, triggerCsvDownload } from '../utils/csvExport';
import { CapitalView } from './CapitalView';
import { OrderDetailDrawer } from './drawers/OrderDetailDrawer';
import type { UserPreferences } from '../utils/preferences';

interface PositionsViewProps {
  orders: CharacterOrderSnapshot[];
  orderSummary?: OrderSummaryMetrics | null;
  formatIsk: (val: number | null | undefined) => string;
  onOpenProduct360?: (typeId: number) => void;
  activeCharacterId?: number;
  characterIds?: number[];
  preferences?: UserPreferences;
  onOpenPreferences?: () => void;
  initialSubTab?: 'orders' | 'inventory';
}

export const PositionsView: React.FC<PositionsViewProps> = ({
  orders,
  orderSummary,
  formatIsk,
  onOpenProduct360,
  activeCharacterId,
  characterIds,
  preferences,
  onOpenPreferences,
  initialSubTab = 'orders',
}) => {
  const [subTab, setSubTab] = useState<'orders' | 'inventory'>(initialSubTab);
  const [selectedOrder, setSelectedOrder] = useState<CharacterOrderSnapshot | null>(null);

  // Filters for orders sub-tab
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHub, setSelectedHub] = useState<string>('ALL');

  // Filter orders
  const filteredOrders = orders.filter((o) => {
    if (stateFilter !== 'ALL') {
      if (stateFilter === 'ACTIVE_ONLY') {
        if (!o.isActiveInCurrentSnapshot && o.state !== 'ACTIVE' && o.state !== 'PARTIALLY_FILLED') {
          return false;
        }
      } else if (o.state !== stateFilter) {
        return false;
      }
    }
    if (sideFilter === 'BUY' && !o.isBuyOrder) return false;
    if (sideFilter === 'SELL' && o.isBuyOrder) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchName = o.typeName?.toLowerCase().includes(term);
      const matchId = String(o.typeId).includes(term) || String(o.orderId).includes(term);
      const matchLoc = o.locationName?.toLowerCase().includes(term);
      if (!matchName && !matchId && !matchLoc) return false;
    }
    if (selectedHub !== 'ALL') {
      if (o.locationName && !o.locationName.includes(selectedHub)) return false;
    }
    return true;
  });

  const handleExportOrdersCsv = () => {
    if (filteredOrders.length === 0) return;
    const csv = ordersToCsv(filteredOrders);
    triggerCsvDownload(`marche_ordres_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const hubsList = Array.from(
    new Set(
      orders
        .map((o) => {
          if (!o.locationName) return null;
          if (o.locationName.includes('Jita')) return 'Jita';
          if (o.locationName.includes('Amarr')) return 'Amarr';
          if (o.locationName.includes('Dodixie')) return 'Dodixie';
          if (o.locationName.includes('Rens')) return 'Rens';
          if (o.locationName.includes('Hek')) return 'Hek';
          return null;
        })
        .filter(Boolean) as string[]
    )
  );

  return (
    <div className="space-y-6">
      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2 bg-slate-900/60 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setSubTab('orders')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'orders'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ClipboardList className="w-3.5 h-3.5" />
            Ordres de Marché ({orders.filter((o) => o.isActiveInCurrentSnapshot || o.state === 'ACTIVE').length})
          </button>
          <button
            onClick={() => setSubTab('inventory')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'inventory'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Inventaire &amp; Capital Physique
          </button>
        </div>

        {subTab === 'orders' && (
          <button
            onClick={handleExportOrdersCsv}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            Exporter CSV ({filteredOrders.length})
          </button>
        )}
      </div>

      {/* SUB-TAB 1: ORDRES DE MARCHÉ */}
      {subTab === 'orders' && (
        <div className="space-y-4">
          {/* Summary Metrics Cards */}
          {orderSummary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
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

              <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
                <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  Valeur Totale Active
                </span>
                <div className="text-xl font-bold font-mono text-emerald-400">
                  {formatIsk(orderSummary.totalActiveIskValue)}
                </div>
              </div>
            </div>
          )}

          {/* Dense Filter Bar */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Rechercher article, order ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-amber-500"
                />
              </div>

              {/* State Filter */}
              <div>
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-hidden focus:border-amber-500"
                >
                  <option value="ALL">Tous les statuts</option>
                  <option value="ACTIVE_ONLY">Actifs uniquement</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PARTIALLY_FILLED">PARTIALLY_FILLED</option>
                  <option value="DISAPPEARED_UNCONFIRMED">DISAPPEARED_UNCONFIRMED (Disparus)</option>
                  <option value="COMPLETED_CONFIRMED">COMPLETED_CONFIRMED (Terminés)</option>
                  <option value="CANCELLED_CONFIRMED">CANCELLED_CONFIRMED (Annulés)</option>
                  <option value="EXPIRED_CONFIRMED">EXPIRED_CONFIRMED (Expirés)</option>
                </select>
              </div>

              {/* Side Filter */}
              <div>
                <select
                  value={sideFilter}
                  onChange={(e) => setSideFilter(e.target.value as 'ALL' | 'BUY' | 'SELL')}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-hidden focus:border-amber-500"
                >
                  <option value="ALL">Tous les sens (Achat &amp; Vente)</option>
                  <option value="SELL">Ventes uniquement</option>
                  <option value="BUY">Achats uniquement</option>
                </select>
              </div>

              {/* Hub Filter */}
              <div>
                <select
                  value={selectedHub}
                  onChange={(e) => setSelectedHub(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-hidden focus:border-amber-500"
                >
                  <option value="ALL">Tous les hubs</option>
                  {hubsList.map((h) => (
                    <option key={h} value={h}>
                      Hub : {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Orders Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
                    <th className="p-3">Article</th>
                    <th className="p-3">Sens</th>
                    <th className="p-3">Emplacement / Hub</th>
                    <th className="p-3 text-right">Prix Unit.</th>
                    <th className="p-3 text-center">Progression Volume (Restant / Total)</th>
                    <th className="p-3 text-right">Valeur Engagée</th>
                    <th className="p-3 text-center">Stock Station</th>
                    <th className="p-3 text-center">Statut Cycle</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-500 italic">
                        Aucun ordre ne correspond aux critères de filtre.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((o) => {
                      const fillPercent =
                        o.volumeTotal > 0
                          ? Math.round(((o.volumeTotal - o.volumeRemain) / o.volumeTotal) * 100)
                          : 0;

                      const engagedValue = o.isBuyOrder
                        ? (o.escrow ?? o.price * o.volumeRemain)
                        : o.price * o.volumeRemain;

                      return (
                        <tr
                          key={o.id}
                          className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                          onClick={() => setSelectedOrder(o)}
                        >
                          {/* Item */}
                          <td className="p-3 font-medium text-slate-200">
                            <div className="flex items-center gap-2">
                              <img
                                src={`https://images.evetech.net/types/${o.typeId}/icon?size=32`}
                                alt=""
                                className="w-6 h-6 rounded bg-slate-950 border border-slate-800 shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                              <div className="min-w-0">
                                <div className="truncate font-semibold group-hover:text-amber-300">
                                  {o.typeName || `Type #${o.typeId}`}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">#{o.orderId}</div>
                              </div>
                            </div>
                          </td>

                          {/* Sens */}
                          <td className="p-3 font-mono">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                o.isBuyOrder
                                  ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              }`}
                            >
                              {o.isBuyOrder ? 'ACHAT' : 'VENTE'}
                            </span>
                          </td>

                          {/* Location */}
                          <td className="p-3 text-slate-400 max-w-[200px] truncate" title={o.locationName}>
                            {o.locationName || `Station #${o.locationId}`}
                          </td>

                          {/* Unit Price */}
                          <td className="p-3 text-right font-mono text-slate-200">
                            {formatIsk(o.price)}
                          </td>

                          {/* Volume & Progress Bar */}
                          <td className="p-3 text-center min-w-[140px]">
                            <div className="space-y-1">
                              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                                <span>{o.volumeRemain.toLocaleString()} rest.</span>
                                <span>{fillPercent}%</span>
                              </div>
                              <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                                <div
                                  className="h-full bg-linear-to-r from-amber-500 to-emerald-500"
                                  style={{ width: `${fillPercent}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Engaged Value */}
                          <td className="p-3 text-right font-mono font-semibold text-amber-300">
                            {formatIsk(engagedValue)}
                          </td>

                          {/* In-Station Physical Stock */}
                          <td className="p-3 text-center font-mono">
                            {o.inStockQuantity !== undefined && o.inStockQuantity > 0 ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                                {o.inStockQuantity.toLocaleString()} u.
                              </span>
                            ) : (
                              <span className="text-slate-600 text-[10px]">0</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="p-3 text-center font-mono">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                o.state === 'ACTIVE'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : o.state === 'PARTIALLY_FILLED'
                                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                  : o.state === 'DISAPPEARED_UNCONFIRMED'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {o.state === 'PARTIALLY_FILLED' ? 'PARTIEL' : (o.state || (o.isActiveInCurrentSnapshot ? 'ACTIVE' : 'HISTORIQUE'))}
                            </span>
                          </td>

                          {/* Action */}
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {onOpenProduct360 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenProduct360(o.typeId);
                                  }}
                                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 transition-colors"
                                  title="Ouvrir Fiche Product 360"
                                >
                                  <Sparkles className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedOrder(o);
                                }}
                                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                                title="Inspecter en tiroir latéral"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
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
          </div>
        </div>
      )}

      {/* SUB-TAB 2: INVENTAIRE & CAPITAL PHYSIQUE */}
      {subTab === 'inventory' && (
        <CapitalView
          formatIsk={formatIsk}
          characterIds={characterIds}
          activeCharacterId={activeCharacterId}
          onOpenProduct360={onOpenProduct360}
          preferences={preferences}
          onOpenPreferences={onOpenPreferences}
        />
      )}

      {/* Contextual Side Drawer for Order Inspection */}
      <OrderDetailDrawer
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        order={selectedOrder}
        onOpenProduct360={onOpenProduct360}
        formatIsk={formatIsk}
      />
    </div>
  );
};
