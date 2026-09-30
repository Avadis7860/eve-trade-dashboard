import React, { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  ShieldCheck,
  Package,
  Layers,
  TrendingUp,
  AlertCircle,
  Truck,
  Building2,
  Search,
  Filter,
  Download,
  Clock,
  HelpCircle,
} from 'lucide-react';
import type {
  CapitalBreakdownResponse,
  PhysicalStockClassification,
} from '../server/capital/types';
import { positionsToCsv, triggerCsvDownload } from '../utils/csvExport';

interface CapitalViewProps {
  formatIsk: (val: number | null | undefined) => string;
  characterIds?: number[];
  activeCharacterId?: number;
}

export const CapitalView: React.FC<CapitalViewProps> = ({
  formatIsk,
  characterIds,
  activeCharacterId,
}) => {
  const [data, setData] = useState<CapitalBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [classificationFilter, setClassificationFilter] = useState<PhysicalStockClassification | 'ALL'>('ALL');
  const [dormantOnly, setDormantOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sortBy, setSortBy] = useState<'typeName' | 'totalPhysicalQuantity' | 'totalCostBasisIsk' | 'committedSellOrderQuantity' | 'daysInactive'>('typeName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const fetchCapitalData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortOrder,
        ...(search ? { search } : {}),
        ...(classificationFilter !== 'ALL' ? { classification: classificationFilter } : {}),
        ...(dormantOnly ? { is_dormant_only: 'true' } : {}),
      });

      if (characterIds && characterIds.length > 1) {
        params.append('character_ids', characterIds.join(','));
      } else if (activeCharacterId) {
        params.append('character_id', String(activeCharacterId));
      }

      const res = await fetch(`/api/capital/breakdown?${params.toString()}`);
      if (res.ok) {
        const json: CapitalBreakdownResponse = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load capital breakdown:', err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, search, classificationFilter, dormantOnly, characterIds, activeCharacterId]);

  useEffect(() => {
    fetchCapitalData();
  }, [fetchCapitalData]);

  const handleExportCsv = () => {
    if (!data?.positions || data.positions.length === 0) return;
    const csv = positionsToCsv(data.positions);
    triggerCsvDownload(`capital_positions_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const monetary = data?.summary.monetary;
  const physical = data?.summary.physicalSummary;
  const dormant = data?.summary.dormantSummary;

  const getClassificationBadge = (classification: PhysicalStockClassification) => {
    switch (classification) {
      case 'COMMITTED_SELL_ORDER':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
            <TrendingUp className="w-3 h-3" /> En Vente
          </span>
        );
      case 'FREE_HUB_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            <Building2 className="w-3 h-3" /> Libre au Hub
          </span>
        );
      case 'REMOTE_DORMANT_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20">
            <Clock className="w-3 h-3" /> Dormant Distant
          </span>
        );
      case 'IN_TRANSIT_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-500/10 text-sky-300 border border-sky-500/20">
            <Truck className="w-3 h-3" /> En Transit
          </span>
        );
      case 'UNRECONCILED_STOCK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20">
            <HelpCircle className="w-3 h-3" /> Coût Inconnu
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Monetary Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Net Real Capital */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-900/20 border border-amber-500/30">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono mb-1">
            <span className="flex items-center gap-1.5 text-amber-300 font-semibold uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4" /> Capital Net Réel
            </span>
            <span className="text-[10px] text-slate-500">Trésorerie + Stocks</span>
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300">
            {formatIsk(monetary?.netRealCapitalIsk || 0)}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-amber-500/20 pt-1.5 font-mono">
            <span>Actifs certains</span>
            <span className="text-emerald-400">100% Vérifié</span>
          </div>
        </div>

        {/* Liquid Wallet Cash */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono mb-1">
            <span className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase tracking-wider">
              <Wallet className="w-4 h-4 text-emerald-400" /> Liquidités Portefeuille
            </span>
            <span className="text-[10px] text-slate-500">Disponible</span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {formatIsk(monetary?.liquidWalletBalanceIsk || 0)}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-1.5 font-mono">
            <span>Part du capital</span>
            <span className="text-slate-300">
              {monetary && monetary.netRealCapitalIsk > 0
                ? `${Math.round((monetary.liquidWalletBalanceIsk / monetary.netRealCapitalIsk) * 100)}%`
                : '—'}
            </span>
          </div>
        </div>

        {/* Buy Escrow & Unsold Inventory Cost */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono mb-1">
            <span className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase tracking-wider">
              <Package className="w-4 h-4 text-sky-400" /> Escrow &amp; Stocks Invendus
            </span>
            <span className="text-[10px] text-slate-500">Immobilisé</span>
          </div>
          <div className="text-2xl font-bold font-mono text-sky-400">
            {formatIsk((monetary?.marketBuyEscrowIsk || 0) + (monetary?.inventoryCostValueIsk || 0))}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-1.5 font-mono">
            <span>Escrow: {formatIsk(monetary?.marketBuyEscrowIsk || 0)}</span>
            <span>Stocks: {formatIsk(monetary?.inventoryCostValueIsk || 0)}</span>
          </div>
        </div>

        {/* Notional Ask Value (Segregated Informational) */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 relative overflow-hidden">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono mb-1">
            <span className="flex items-center gap-1.5 text-slate-400 font-semibold uppercase tracking-wider">
              <TrendingUp className="w-4 h-4 text-purple-400" /> Notionnel Ventes (Info)
            </span>
            <span className="text-[9px] font-mono px-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
              HORS TRÉSORERIE
            </span>
          </div>
          <div className="text-2xl font-bold font-mono text-purple-300">
            {formatIsk(monetary?.notionalMarketAskValueIsk || 0)}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-1.5 font-mono">
            <span>Chiffre d&apos;affaires potentiel</span>
            <span className="text-slate-500">Sell Orders</span>
          </div>
        </div>
      </div>

      {/* Physical Decomposition KPI Banner */}
      <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-slate-400">Total Unités Physiques :</span>
            <span className="text-sm font-bold font-mono text-slate-100">
              {physical?.totalUnits?.toLocaleString() || 0}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 border-l border-slate-800 pl-4">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-xs text-slate-400">En Vente :</span>
            <span className="text-xs font-mono text-amber-300">
              {physical?.committedSellOrderUnits?.toLocaleString() || 0}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 border-l border-slate-800 pl-4">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span className="text-xs text-slate-400">Libre Hub :</span>
            <span className="text-xs font-mono text-emerald-300">
              {physical?.freeHubStockUnits?.toLocaleString() || 0}
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 border-l border-slate-800 pl-4">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-400" />
            <span className="text-xs text-slate-400">Dormant :</span>
            <span className="text-xs font-mono text-rose-300">
              {dormant?.dormantTotalUnits?.toLocaleString() || 0} ({formatIsk(dormant?.dormantCostValueIsk || 0)})
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-2 border-l border-slate-800 pl-4">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-400" />
            <span className="text-xs text-slate-400">En Transit :</span>
            <span className="text-xs font-mono text-sky-300">
              {physical?.inTransitStockUnits?.toLocaleString() || 0}
            </span>
          </div>
        </div>

        <button
          onClick={handleExportCsv}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
        >
          <Download className="w-3.5 h-3.5" /> Exporter Positions CSV
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
        <div className="flex-1 w-full md:w-auto relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Filtrer par nom d'article, type ID, station ou hub..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 font-mono"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span>État :</span>
          </div>
          <select
            value={classificationFilter}
            onChange={(e) => {
              setClassificationFilter(e.target.value as PhysicalStockClassification | 'ALL');
              setPage(1);
            }}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
          >
            <option value="ALL">Tous les états physiques</option>
            <option value="COMMITTED_SELL_ORDER">Stock en Ordre de Vente</option>
            <option value="FREE_HUB_STOCK">Stock Libre au Hub</option>
            <option value="REMOTE_DORMANT_STOCK">Stock Dormant / Éloigné</option>
            <option value="IN_TRANSIT_STOCK">Stock en Transit</option>
            <option value="UNRECONCILED_STOCK">Coût Inconnu (Non rapproché)</option>
          </select>

          <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700 select-none">
            <input
              type="checkbox"
              checked={dormantOnly}
              onChange={(e) => {
                setDormantOnly(e.target.checked);
                setPage(1);
              }}
              className="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
            />
            <span className="text-rose-300 font-medium">Stocks Dormants Uniquement</span>
          </label>
        </div>
      </div>

      {/* Positions Table */}
      <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/30">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <th
                  onClick={() => {
                    setSortBy('typeName');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                  className="py-3 px-4 font-semibold cursor-pointer hover:text-slate-200"
                >
                  Article
                </th>
                <th className="py-3 px-4 font-semibold">Emplacement &amp; Hub</th>
                <th className="py-3 px-4 font-semibold">Classification</th>
                <th
                  onClick={() => {
                    setSortBy('totalPhysicalQuantity');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                  className="py-3 px-4 font-semibold text-right cursor-pointer hover:text-slate-200"
                >
                  Total Phys.
                </th>
                <th className="py-3 px-4 font-semibold text-center">Décomposition Mutuellement Exclusive</th>
                <th
                  onClick={() => {
                    setSortBy('totalCostBasisIsk');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                  className="py-3 px-4 font-semibold text-right cursor-pointer hover:text-slate-200"
                >
                  Valeur Revient
                </th>
                <th className="py-3 px-4 font-semibold text-right">Notionnel Vente</th>
                <th
                  onClick={() => {
                    setSortBy('daysInactive');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                  className="py-3 px-4 font-semibold text-center cursor-pointer hover:text-slate-200"
                >
                  Activité
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    Chargement des positions de capital et inventaire...
                  </td>
                </tr>
              ) : !data?.positions || data.positions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    Aucun actif physique trouvé pour ces critères de filtre.
                  </td>
                </tr>
              ) : (
                data.positions.map((pos) => {
                  return (
                    <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                      {/* Article */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-200">{pos.typeName}</div>
                        <div className="text-[10px] text-slate-500 font-mono">ID: {pos.typeId}</div>
                      </td>

                      {/* Location & Hub */}
                      <td className="py-3 px-4">
                        <div className="text-slate-300 max-w-xs truncate" title={pos.locationName}>
                          {pos.locationName}
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <span className={`px-1 rounded ${pos.isConfiguredHub ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                            {pos.hubName}
                          </span>
                          {pos.locationFlag && pos.locationFlag !== 'Hangar' && (
                            <span className="text-sky-400 font-mono text-[9px] bg-sky-500/10 px-1 rounded">
                              {pos.locationFlag}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Primary Classification */}
                      <td className="py-3 px-4">
                        {getClassificationBadge(pos.primaryClassification)}
                      </td>

                      {/* Total Physical Quantity */}
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-100">
                        {pos.totalPhysicalQuantity.toLocaleString()}
                      </td>

                      {/* Mutually Exclusive Decomposition */}
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1.5 font-mono text-[11px]">
                          {pos.committedSellOrderQuantity > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30" title="Posé en ordre de vente">
                              {pos.committedSellOrderQuantity.toLocaleString()} vte
                            </span>
                          )}
                          {pos.freeHubStockQuantity > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" title="Libre en station de hub">
                              {pos.freeHubStockQuantity.toLocaleString()} hub
                            </span>
                          )}
                          {pos.remoteDormantStockQuantity > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30" title="Dormant hors hub">
                              {pos.remoteDormantStockQuantity.toLocaleString()} dorm
                            </span>
                          )}
                          {pos.inTransitQuantity > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30" title="En soute / transit">
                              {pos.inTransitQuantity.toLocaleString()} trs
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Cost Basis Valuation */}
                      <td className="py-3 px-4 text-right font-mono">
                        {pos.totalCostBasisIsk !== null ? (
                          <>
                            <div className="font-semibold text-slate-200">
                              {formatIsk(pos.totalCostBasisIsk)}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              @{formatIsk(pos.unitCostIsk)}/u
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                            UNKNOWN
                          </span>
                        )}
                      </td>

                      {/* Notional Ask Value */}
                      <td className="py-3 px-4 text-right font-mono text-purple-300">
                        {pos.sellOrderNotionalValueIsk > 0 ? (
                          <div>{formatIsk(pos.sellOrderNotionalValueIsk)}</div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Activity & Inactivity */}
                      <td className="py-3 px-4 text-center">
                        {pos.isDormant ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-mono border border-rose-500/30">
                            <AlertCircle className="w-3 h-3" /> &gt;30j ({pos.daysInactive}j)
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {pos.daysInactive === 0 ? 'Aujourd’hui' : `${pos.daysInactive}j`}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {data && data.totalPages > 1 && (
          <div className="p-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs text-slate-400">
            <span>
              Affichage de {data.positions.length} sur {data.total} position(s)
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              <span className="font-mono text-slate-300">
                Page {page} / {data.totalPages}
              </span>
              <button
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 cursor-pointer disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
