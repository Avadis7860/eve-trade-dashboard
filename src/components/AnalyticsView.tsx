import React, { useState } from 'react';
import {
  TrendingUp,
  Search,
  Clock,
  BarChart2,
  Table as TableIcon,
  Download,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Award,
  Building2,
  ArrowUpDown,
} from 'lucide-react';
import type {
  ActivityTimeSeriesResponse,
  TimeframeOption,
  GroupByOption,
  TopSalesRankingsResponse,
} from '../server/analytics/types';
import type { UserPreferences } from '../utils/preferences';
import { formatIskValue } from '../utils/preferences';
import { timeSeriesToCsv, topSalesToCsv, triggerCsvDownload } from '../utils/csvExport';
import { useApiQuery, fetchJson } from '../utils/apiClient';

interface AnalyticsViewProps {
  preferences: UserPreferences;
  onOpenProduct360: (typeId: number) => void;
  characterIds?: number[];
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  preferences,
  onOpenProduct360,
  characterIds,
}) => {
  const [activeSection, setActiveSection] = useState<'top-sales' | 'timeseries'>('top-sales');
  const [timeframe, setTimeframe] = useState<TimeframeOption>('90d');
  const [groupBy, setGroupBy] = useState<GroupByOption>('day');
  const [searchQuery, setSearchQuery] = useState('');

  // Top Sales specific controls & filters
  const [selectedHub, setSelectedHub] = useState<string>(''); // '' = All hubs consolidated
  const [topSalesSortBy, setTopSalesSortBy] = useState<'revenue' | 'profit' | 'units' | 'transactions' | 'roi'>('revenue');
  const [topSalesSortDir, setTopSalesSortDir] = useState<'desc' | 'asc'>('desc');
  const [topSalesSearch, setTopSalesSearch] = useState('');
  const [viewLimit, setViewLimit] = useState<'all' | '25' | '50' | '100'>('all');

  // Accessible chart table toggles
  const [showActivityTable, setShowActivityTable] = useState(false);
  const [showProfitTable, setShowProfitTable] = useState(false);
  const [showAgeTable, setShowAgeTable] = useState(false);

  // 1. Top Sales query without limits
  const {
    data: topSalesData,
    isLoading: loadingTopSales,
    error: topSalesQueryError,
    refetch: refetchTopSales,
  } = useApiQuery<TopSalesRankingsResponse>(
    [
      'analytics',
      'top-sales',
      timeframe,
      selectedHub,
      topSalesSortBy,
      topSalesSortDir,
      topSalesSearch,
      ...(characterIds && characterIds.length > 0 ? characterIds : []),
    ],
    async (signal) => {
      const params = new URLSearchParams({
        timeframe,
        ...(selectedHub ? { hub_id: selectedHub } : {}),
        sort_by: topSalesSortBy,
        sort_dir: topSalesSortDir,
        ...(topSalesSearch ? { search: topSalesSearch } : {}),
        ...(characterIds && characterIds.length > 0 ? { character_ids: characterIds.join(',') } : {}),
      });
      return fetchJson<TopSalesRankingsResponse>(`/api/analytics/top-sales?${params.toString()}`, { signal });
    },
    { ttl: 15_000 }
  );

  // 2. Hubs list for filter selector
  const { data: hubsData } = useApiQuery<{ hubs?: Array<{ id: string; name: string }> }>(
    ['hubs', 'list'],
    async (signal) => fetchJson('/api/hubs', { signal }),
    { ttl: 300_000 }
  );
  const availableHubs = hubsData?.hubs || [];

  // 3. Time Series query
  const {
    data: timeseries,
    isLoading: loading,
    error: queryError,
    refetch: fetchGlobalTimeSeries,
  } = useApiQuery<ActivityTimeSeriesResponse>(
    ['analytics', 'timeseries', timeframe, groupBy, ...(characterIds && characterIds.length > 0 ? characterIds : [])],
    async (signal) => {
      const params = new URLSearchParams({
        timeframe,
        groupBy,
        ...(characterIds && characterIds.length > 0 ? { character_ids: characterIds.join(',') } : {}),
      });
      return fetchJson<ActivityTimeSeriesResponse>(`/api/analytics/timeseries?${params.toString()}`, { signal });
    },
    { ttl: 30_000 }
  );

  const error = queryError ? queryError.message : null;
  const topSalesErrorMsg = topSalesQueryError ? topSalesQueryError.message : null;

  // Load distinct traded items for search selector (cached for 5 minutes)
  const { data: filterOptions } = useApiQuery<{ types?: Array<{ id: number; name: string }> }>(
    ['ledger', 'filter-options'],
    async (signal) => fetchJson('/api/ledger/filter-options', { signal }),
    { ttl: 300_000 }
  );

  const itemsCatalog = (filterOptions?.types || []).map((t) => ({
    type_id: t.id,
    type_name: t.name,
  }));

  const handleExportCsv = () => {
    if (!timeseries) return;
    const csv = timeSeriesToCsv(timeseries.data_points);
    triggerCsvDownload(`global_analytics_timeseries_${timeframe}.csv`, csv);
  };

  const handleExportTopSalesCsv = () => {
    if (!topSalesData || !topSalesData.items.length) return;
    const csv = topSalesToCsv(topSalesData.items);
    const hubTag = selectedHub ? selectedHub : 'tous_les_hubs';
    triggerCsvDownload(`top_ventes_classement_${hubTag}_${timeframe}.csv`, csv);
  };

  const filteredCatalog = itemsCatalog.filter((item) =>
    item.type_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(item.type_id).includes(searchQuery)
  );

  const dataPoints = timeseries?.data_points || [];

  // Totals for timeseries
  const totalRevenue = dataPoints.reduce((acc, dp) => acc + dp.gross_revenue_isk, 0);
  const totalProfit = dataPoints.reduce((acc, dp) => acc + dp.realized_profit_ttc_isk, 0);
  const totalSold = dataPoints.reduce((acc, dp) => acc + dp.units_sold, 0);
  const totalBought = dataPoints.reduce((acc, dp) => acc + dp.units_bought, 0);

  // SVG dimensions
  const chartWidth = 700;
  const chartHeight = 200;
  const padding = 30;

  const maxVolume = Math.max(1, ...dataPoints.map((dp) => Math.max(dp.units_sold, dp.units_bought)));
  const maxRevenue = Math.max(1, ...dataPoints.map((dp) => dp.gross_revenue_isk));
  const minProfit = Math.min(0, ...dataPoints.map((dp) => dp.cumulative_profit_ttc_isk));
  const maxProfit = Math.max(1, ...dataPoints.map((dp) => dp.cumulative_profit_ttc_isk));
  const profitRange = maxProfit - minProfit || 1;

  // Filtered Top Sales items
  const allTopSalesItems = topSalesData?.items || [];
  const displayedTopSalesItems = viewLimit === 'all'
    ? allTopSalesItems
    : allTopSalesItems.slice(0, Number(viewLimit));

  return (
    <div className="space-y-6">
      {/* Header with Title */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Analyses Financières &amp; Inspection Produit</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              Top Ventes, Hubs &amp; Product 360
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              Classement complet des ventes du meilleur au moins bon, filtrage multi-hubs sans limite, séries temporelles et flux inter-hubs.
            </p>
          </div>

          {/* Sub-view switcher buttons */}
          <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0">
            <button
              onClick={() => setActiveSection('top-sales')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
                activeSection === 'top-sales'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Award className="w-4 h-4 text-amber-400" />
              <span>Classement des Ventes</span>
              {topSalesData && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500/10 text-amber-300 text-[10px] font-mono border border-amber-500/20">
                  {topSalesData.total_items}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveSection('timeseries')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer ${
                activeSection === 'timeseries'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-4 h-4 text-cyan-400" />
              <span>Séries &amp; Flux Globaux</span>
            </button>
          </div>
        </div>
      </div>

      {/* Item Quick-Inspection Search Bar (Common to both views for instant Product 360 access) */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="product-search" className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-amber-400" />
            <span>Rechercher un article pour ouvrir sa fiche Product 360</span>
          </label>
          <span className="text-xs text-slate-500 font-mono">
            {itemsCatalog.length} articles disponibles
          </span>
        </div>

        <div className="relative">
          <input
            id="product-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par nom d'article (ex: Tritanium, PLEX, Vexor...) ou Type ID"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        {searchQuery.trim() !== '' && (
          <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-lg bg-slate-950 divide-y divide-slate-800/60">
            {filteredCatalog.length === 0 ? (
              <div className="p-3 text-xs text-slate-500 font-mono text-center">
                Aucun article correspondant dans l&apos;historique.
              </div>
            ) : (
              filteredCatalog.slice(0, 10).map((item) => (
                <button
                  key={item.type_id}
                  onClick={() => {
                    onOpenProduct360(item.type_id);
                    setSearchQuery('');
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-850 flex items-center justify-between text-xs transition-colors cursor-pointer group"
                >
                  <div className="flex items-center space-x-2.5">
                    <img
                      src={`https://images.evetech.net/types/${item.type_id}/icon?size=32`}
                      alt=""
                      className="w-6 h-6 rounded bg-slate-900 border border-slate-800"
                    />
                    <span className="font-medium text-white group-hover:text-amber-300">
                      {item.type_name}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">ID: {item.type_id}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-amber-400 text-xs font-medium">
                    <span>Ouvrir Product 360</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* SECTION 1: TOP VENTES & CLASSEMENT SANS LIMITE AVEC FILTRE PAR HUB        */}
      {/* ========================================================================= */}
      {activeSection === 'top-sales' && (
        <div className="space-y-6">
          {/* Controls Bar for Top Sales */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Hub Filter */}
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Hub Commercial :</span>
                </span>
                <select
                  value={selectedHub}
                  onChange={(e) => setSelectedHub(e.target.value)}
                  className="bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs text-white rounded-lg px-3 py-1.5 font-medium focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="">Tous les hubs commerciaux (Consolidé)</option>
                  {availableHubs.map((hub) => (
                    <option key={hub.id} value={hub.id}>
                      {hub.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Timeframe Selector */}
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono uppercase text-slate-400">Période :</span>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-0.5 flex items-center text-xs font-mono">
                  {(['7d', '14d', '30d', '90d', '180d', 'all'] as TimeframeOption[]).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                        timeframe === tf
                          ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tf === 'all' ? 'Tout' : tf.replace('d', 'j')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Export CSV Button */}
              <button
                onClick={handleExportTopSalesCsv}
                disabled={!topSalesData?.items?.length}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 hover:text-white border border-slate-700 text-xs font-mono flex items-center space-x-1.5 transition-colors cursor-pointer"
                title="Exporter le classement complet des ventes au format CSV RFC 4180"
              >
                <Download className="w-3.5 h-3.5 text-amber-400" />
                <span>Export CSV Classement</span>
              </button>
            </div>

            {/* Sub-row: Sorting, search & limit */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
              <div className="flex flex-wrap items-center gap-3">
                {/* Sort selector */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                    <ArrowUpDown className="w-3.5 h-3.5 text-amber-400" />
                    <span>Trier par :</span>
                  </span>
                  <select
                    value={topSalesSortBy}
                    onChange={(e) => setTopSalesSortBy(e.target.value as 'revenue' | 'profit' | 'units' | 'transactions' | 'roi')}
                    className="bg-slate-950 border border-slate-800 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="revenue">Chiffre d&apos;Affaires Brut (ISK)</option>
                    <option value="profit">Profit Réalisé TTC (ISK)</option>
                    <option value="units">Unités Vendues (Volume)</option>
                    <option value="transactions">Nombre de Transactions</option>
                    <option value="roi">Rentabilité ROI % TTC</option>
                  </select>

                  <button
                    onClick={() => setTopSalesSortDir(topSalesSortDir === 'desc' ? 'asc' : 'desc')}
                    className="px-2 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-amber-400 hover:bg-slate-850 cursor-pointer"
                    title={topSalesSortDir === 'desc' ? 'Meilleurs d&apos;abord (Décroissant)' : 'Moins bons d&apos;abord (Croissant)'}
                  >
                    {topSalesSortDir === 'desc' ? '↓ Meilleurs' : '↑ Croissant'}
                  </button>
                </div>

                {/* Display limit toggle */}
                <div className="flex items-center space-x-1.5">
                  <span className="text-xs font-mono text-slate-400">Affichage :</span>
                  <div className="bg-slate-950 border border-slate-800 rounded-lg p-0.5 flex items-center text-xs font-mono">
                    {(['all', '25', '50', '100'] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => setViewLimit(opt)}
                        className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                          viewLimit === opt
                            ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {opt === 'all' ? 'Sans limite' : opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Live search input */}
              <div className="relative min-w-[240px]">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={topSalesSearch}
                  onChange={(e) => setTopSalesSearch(e.target.value)}
                  placeholder="Filtrer par nom ou Type ID..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Top Sales Error */}
          {topSalesErrorMsg && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-xs text-rose-300">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{topSalesErrorMsg}</span>
              </div>
              <button
                onClick={refetchTopSales}
                className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium cursor-pointer"
              >
                Réessayer
              </button>
            </div>
          )}

          {/* Summary KPIs Banner for Top Sales */}
          {topSalesData && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-1">
                <span className="text-xs font-mono uppercase text-slate-400">Articles Classés</span>
                <div className="text-lg sm:text-xl font-mono font-bold text-white">
                  {(topSalesData.total_items ?? 0)} <span className="text-xs text-slate-400">produits</span>
                </div>
                <div className="text-xs text-slate-400">
                  {selectedHub ? 'Filtré sur le hub actif' : 'Tous les hubs consolidés'}
                </div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-1">
                <span className="text-xs font-mono uppercase text-slate-400">CA Brut Consolidé</span>
                <div className="text-lg sm:text-xl font-mono font-bold text-amber-300">
                  {formatIskValue(topSalesData.total_gross_revenue_isk ?? 0, preferences.iskDisplayMode)}
                </div>
                <div className="text-xs text-slate-400">Sur la période sélectionnée</div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-1">
                <span className="text-xs font-mono uppercase text-slate-400">Profit Réalisé TTC</span>
                <div className="text-lg sm:text-xl font-mono font-bold text-emerald-400">
                  {topSalesData.total_realized_profit_ttc_isk !== null && topSalesData.total_realized_profit_ttc_isk !== undefined
                    ? formatIskValue(topSalesData.total_realized_profit_ttc_isk, preferences.iskDisplayMode)
                    : '—'}
                </div>
                <div className="text-xs text-slate-400">Sur les ventes rapprochées</div>
              </div>

              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-1">
                <span className="text-xs font-mono uppercase text-slate-400">Volume Total Vendu</span>
                <div className="text-lg sm:text-xl font-mono font-bold text-blue-400">
                  {(topSalesData.total_units_sold ?? 0).toLocaleString()} <span className="text-xs text-slate-400">unités</span>
                </div>
                <div className="text-xs text-slate-400">
                  Statut ESI : <span className="text-emerald-400 font-mono">{topSalesData.freshness_status || 'FRESH'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Loading indicator */}
          {loadingTopSales && !topSalesData && (
            <div className="p-12 text-center text-slate-400 text-xs font-mono flex items-center justify-center space-x-2 bg-slate-950/50 rounded-xl border border-slate-800">
              <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
              <span>Calcul du classement des meilleures ventes et agrégation multi-hubs...</span>
            </div>
          )}

          {/* Top Sales Ranked Table */}
          {topSalesData && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl overflow-hidden space-y-0">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Award className="w-4 h-4 text-amber-400" />
                    <span>Tableau des Meilleures Ventes — Classé du Meilleur au Moins Bon</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    {displayedTopSalesItems.length} articles affichés{' '}
                    {viewLimit !== 'all' && `(limite de ${viewLimit} sur ${topSalesData.total_items})`}
                  </p>
                </div>
              </div>

              {displayedTopSalesItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 font-mono">
                  Aucune vente enregistrée pour ce hub sur cette période.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-900/90 text-slate-400 font-mono uppercase text-[11px] border-b border-slate-800">
                      <tr>
                        <th className="p-3 text-center w-12">Rang</th>
                        <th className="p-3">Article</th>
                        <th className="p-3">Hub Principal</th>
                        <th className="p-3 text-right">Unités</th>
                        <th className="p-3 text-right">Prix Moyen</th>
                        <th className="p-3 text-right">CA Brut</th>
                        <th className="p-3 text-right">Profit TTC</th>
                        <th className="p-3 text-right">ROI % TTC</th>
                        <th className="p-3 text-center">Ventes</th>
                        <th className="p-3 text-right">Inspection</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {displayedTopSalesItems.map((item, index) => {
                        const rank = index + 1;
                        const rankBadge =
                          rank === 1
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
                            : rank === 2
                            ? 'bg-slate-300/20 text-slate-200 border border-slate-300/40 font-bold'
                            : rank === 3
                            ? 'bg-amber-700/20 text-amber-400 border border-amber-700/40 font-bold'
                            : 'bg-slate-900 text-slate-400 border border-slate-800';

                        return (
                          <tr
                            key={item.type_id}
                            className="hover:bg-slate-900/50 transition-colors group cursor-pointer"
                            onClick={() => onOpenProduct360(item.type_id)}
                          >
                            {/* Rang */}
                            <td className="p-3 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded text-[11px] ${rankBadge}`}>
                                #{rank}
                              </span>
                            </td>

                            {/* Article Image & Name */}
                            <td className="p-3">
                              <div className="flex items-center space-x-2.5">
                                <img
                                  src={item.image_url}
                                  alt=""
                                  className="w-7 h-7 rounded bg-slate-900 border border-slate-800 shrink-0"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = `https://images.evetech.net/types/${item.type_id}/icon?size=32`;
                                  }}
                                />
                                <div>
                                  <div className="font-semibold text-white group-hover:text-amber-300 transition-colors">
                                    {item.type_name}
                                  </div>
                                  <div className="text-[10px] text-slate-500 font-mono">ID: {item.type_id}</div>
                                </div>
                              </div>
                            </td>

                            {/* Hub Principal */}
                            <td className="p-3">
                              <div className="flex items-center space-x-1.5">
                                <span className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800 text-[11px]">
                                  {item.primary_hub_name}
                                </span>
                                {item.hubs.length > 1 && (
                                  <span
                                    className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 text-[10px] border border-amber-500/20"
                                    title={item.hubs.map((h) => `${h.hub_name}: ${h.units_sold} un.`).join('\n')}
                                  >
                                    +{item.hubs.length - 1}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Unités vendues */}
                            <td className="p-3 text-right font-medium text-slate-200">
                              {item.units_sold.toLocaleString()}
                            </td>

                            {/* Prix Moyen */}
                            <td className="p-3 text-right text-slate-400">
                              {formatIskValue(item.average_unit_sale_price_isk, preferences.iskDisplayMode)}
                            </td>

                            {/* CA Brut */}
                            <td className="p-3 text-right font-bold text-white">
                              {formatIskValue(item.gross_revenue_isk, preferences.iskDisplayMode)}
                            </td>

                            {/* Profit Réalisé TTC */}
                            <td className="p-3 text-right">
                              {item.realized_profit_ttc_isk !== null ? (
                                <div className="space-y-0.5">
                                  <div className={item.realized_profit_ttc_isk >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                    {formatIskValue(item.realized_profit_ttc_isk, preferences.iskDisplayMode)}
                                  </div>
                                  <span
                                    className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-mono ${
                                      item.coverage_status === 'COMPLETE'
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                        : item.coverage_status === 'PARTIAL'
                                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                                    }`}
                                  >
                                    {item.coverage_status === 'COMPLETE'
                                      ? 'COMPLET'
                                      : item.coverage_status === 'PARTIAL'
                                      ? 'PARTIEL'
                                      : 'INCONNU'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>

                            {/* ROI % TTC */}
                            <td className="p-3 text-right">
                              {item.roi_percent_ttc !== null ? (
                                <span className={`font-semibold ${item.roi_percent_ttc >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {item.roi_percent_ttc > 0 ? `+${item.roi_percent_ttc}%` : `${item.roi_percent_ttc}%`}
                                </span>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>

                            {/* Transactions count */}
                            <td className="p-3 text-center text-slate-400">
                              {item.sales_transactions_count}
                            </td>

                            {/* Product 360 Action */}
                            <td className="p-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenProduct360(item.type_id);
                                }}
                                className="px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-sans font-medium flex items-center space-x-1 ml-auto transition-colors cursor-pointer"
                              >
                                <span>Product 360</span>
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2: SÉRIES TEMPORELLES & PYRAMIDE DES ÂGES                         */}
      {/* ========================================================================= */}
      {activeSection === 'timeseries' && (
        <div className="space-y-6">
          {/* Controls Bar for Timeseries */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Fenêtre :</span>
                </span>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value as TimeframeOption)}
                  className="bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs text-white rounded-lg px-3 py-1.5 font-medium focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="7d">7 derniers jours</option>
                  <option value="30d">30 derniers jours</option>
                  <option value="90d">90 derniers jours</option>
                  <option value="180d">180 derniers jours</option>
                  <option value="365d">365 derniers jours</option>
                  <option value="all">Historique complet</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono uppercase text-slate-400">Agrégation :</span>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupByOption)}
                  className="bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs text-white rounded-lg px-3 py-1.5 font-medium focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="day">Par jour</option>
                  <option value="week">Par semaine</option>
                  <option value="month">Par mois</option>
                </select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={fetchGlobalTimeSeries}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white flex items-center space-x-1.5 transition-colors cursor-pointer"
                title="Rafraîchir les séries temporelles"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Actualiser</span>
              </button>

              <button
                onClick={handleExportCsv}
                disabled={!timeseries || !dataPoints.length}
                className="px-3 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white flex items-center space-x-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Exporter les séries temporelles au format CSV"
              >
                <Download className="w-3.5 h-3.5 text-amber-400" />
                <span>Exporter CSV</span>
              </button>
            </div>
          </div>

          {/* Global Summary KPIs */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-xs text-rose-300">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={fetchGlobalTimeSeries}
            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-medium cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      )}

      {loading && !timeseries && (
        <div className="p-8 text-center text-slate-400 text-xs font-mono flex items-center justify-center space-x-2">
          <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
          <span>Calcul des séries temporelles et de la pyramide des âges...</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs font-mono uppercase text-slate-400">CA Brut de la Période</span>
          <div className="text-lg sm:text-xl font-mono font-bold text-white">
            {formatIskValue(totalRevenue, preferences.iskDisplayMode)}
          </div>
          <div className="text-xs text-slate-400">{totalSold.toLocaleString()} unités vendues</div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs font-mono uppercase text-slate-400">Profit Réalisé TTC</span>
          <div className="text-lg sm:text-xl font-mono font-bold text-emerald-400">
            {formatIskValue(totalProfit, preferences.iskDisplayMode)}
          </div>
          <div className="text-xs text-slate-400">Sur les ventes rapprochées</div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs font-mono uppercase text-slate-400">Volume Acheté</span>
          <div className="text-lg sm:text-xl font-mono font-bold text-blue-400">
            {totalBought.toLocaleString()} <span className="text-xs text-slate-400">un.</span>
          </div>
          <div className="text-xs text-slate-400">Réapprovisionnement observé</div>
        </div>

        <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs font-mono uppercase text-slate-400">Fenêtre d&apos;Observation</span>
          <div className="text-lg sm:text-xl font-mono font-bold text-amber-300">
            {timeseries?.observed_days || 90} jours
          </div>
          <div className="text-xs text-slate-400">
            Statut : <span className="text-emerald-400 font-mono">{timeseries?.freshness_status || 'FRESH'}</span>
          </div>
        </div>
      </div>

      {/* Main Charts */}
      {timeseries && (
        <div className="space-y-6">
          {/* Chart 1: Activity Chart */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-amber-400" />
                  <span>Rythme d&apos;Activité Global (Unités Vendues/Achetées &amp; CA)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Évolution temporelle par {groupBy === 'day' ? 'jour' : groupBy === 'week' ? 'semaine' : 'mois'}
                </p>
              </div>

              <button
                onClick={() => setShowActivityTable(!showActivityTable)}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1.5 self-start sm:self-auto cursor-pointer"
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>{showActivityTable ? 'Afficher le graphique' : 'Alternative tabulaire accessible'}</span>
              </button>
            </div>

            {!showActivityTable ? (
              <div className="w-full overflow-x-auto">
                <div className="min-w-[600px] h-[220px] relative">
                  <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full">
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                      const y = padding + ratio * (chartHeight - 2 * padding);
                      return (
                        <line
                          key={ratio}
                          x1={padding}
                          y1={y}
                          x2={chartWidth - padding}
                          y2={y}
                          stroke="#1e293b"
                          strokeDasharray="4 4"
                        />
                      );
                    })}

                    {dataPoints.map((dp, i) => {
                      const availableW = chartWidth - 2 * padding;
                      const barW = Math.max(2, (availableW / (dataPoints.length || 1)) * 0.4);
                      const x = padding + (i / (dataPoints.length || 1)) * availableW;
                      const soldHeight = (dp.units_sold / maxVolume) * (chartHeight - 2 * padding);
                      const boughtHeight = (dp.units_bought / maxVolume) * (chartHeight - 2 * padding);

                      return (
                        <g key={dp.period_label} className="group cursor-pointer">
                          {dp.units_bought > 0 && (
                            <rect
                              x={x}
                              y={chartHeight - padding - boughtHeight}
                              width={barW}
                              height={boughtHeight}
                              fill="#3b82f6"
                              opacity="0.8"
                              rx="1"
                            >
                              <title>{`${dp.period_label}: ${dp.units_bought} un. achetées`}</title>
                            </rect>
                          )}
                          {dp.units_sold > 0 && (
                            <rect
                              x={x + barW + 1}
                              y={chartHeight - padding - soldHeight}
                              width={barW}
                              height={soldHeight}
                              fill="#10b981"
                              opacity="0.9"
                              rx="1"
                            >
                              <title>{`${dp.period_label}: ${dp.units_sold} un. vendues (${formatIskValue(dp.gross_revenue_isk, 'full')})`}</title>
                            </rect>
                          )}
                        </g>
                      );
                    })}

                    {dataPoints.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2"
                        strokeLinecap="round"
                        points={dataPoints
                          .map((dp, i) => {
                            const availableW = chartWidth - 2 * padding;
                            const x = padding + (i / (dataPoints.length - 1)) * availableW;
                            const y =
                              chartHeight -
                              padding -
                              (dp.gross_revenue_isk / maxRevenue) * (chartHeight - 2 * padding);
                            return `${x},${y}`;
                          })
                          .join(' ')}
                      />
                    )}
                  </svg>

                  <div className="flex items-center justify-center space-x-6 text-[11px] text-slate-400 mt-2 font-mono">
                    <div className="flex items-center space-x-1.5">
                      <span className="w-3 h-3 bg-emerald-500 rounded-xs inline-block" />
                      <span>Unités vendues</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <span className="w-3 h-3 bg-blue-500 rounded-xs inline-block" />
                      <span>Unités achetées</span>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <span className="w-3 h-0.5 bg-amber-500 inline-block" />
                      <span>CA Brut ISK</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-xs text-left" aria-label="Données globales d'activité">
                  <thead className="bg-slate-900/90 text-slate-400 font-mono">
                    <tr>
                      <th className="p-2.5">Période</th>
                      <th className="p-2.5 text-right">Ventes (un.)</th>
                      <th className="p-2.5 text-right">Achats (un.)</th>
                      <th className="p-2.5 text-right">CA Brut ISK</th>
                      <th className="p-2.5 text-right">Profit Net TTC ISK</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono">
                    {dataPoints.map((dp) => (
                      <tr key={dp.period_label} className="hover:bg-slate-800/40">
                        <td className="p-2.5 text-slate-300">{dp.period_label}</td>
                        <td className="p-2.5 text-right text-emerald-400">{dp.units_sold}</td>
                        <td className="p-2.5 text-right text-blue-400">{dp.units_bought}</td>
                        <td className="p-2.5 text-right text-amber-300">{formatIskValue(dp.gross_revenue_isk, 'full')}</td>
                        <td className="p-2.5 text-right text-emerald-400">{formatIskValue(dp.realized_profit_ttc_isk, 'full')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Chart 2: Cumulative Profit TTC Curve */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span>Profit Net TTC Cumulé Global</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Progression continue du bénéfice net après déduction intégrale des coûts et taxes
                </p>
              </div>

              <button
                onClick={() => setShowProfitTable(!showProfitTable)}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1.5 self-start sm:self-auto cursor-pointer"
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>{showProfitTable ? 'Afficher le graphique' : 'Alternative tabulaire accessible'}</span>
              </button>
            </div>

            {!showProfitTable ? (
              <div className="w-full overflow-x-auto">
                <div className="min-w-[600px] h-[180px] relative">
                  <svg viewBox={`0 0 ${chartWidth} 160`} className="w-full h-full">
                    {dataPoints.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.5"
                        points={dataPoints
                          .map((dp, i) => {
                            const availableW = chartWidth - 2 * padding;
                            const x = padding + (i / (dataPoints.length - 1)) * availableW;
                            const y =
                              160 -
                              20 -
                              ((dp.cumulative_profit_ttc_isk - minProfit) / profitRange) * (160 - 40);
                            return `${x},${y}`;
                          })
                          .join(' ')}
                      />
                    )}
                  </svg>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-xs text-left" aria-label="Tableau de profit global">
                  <thead className="bg-slate-900/90 text-slate-400 font-mono">
                    <tr>
                      <th className="p-2.5">Période</th>
                      <th className="p-2.5 text-right">Profit Période ISK</th>
                      <th className="p-2.5 text-right">Profit Cumulé TTC ISK</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono">
                    {dataPoints.map((dp) => (
                      <tr key={dp.period_label}>
                        <td className="p-2.5 text-slate-300">{dp.period_label}</td>
                        <td className="p-2.5 text-right text-emerald-400">{formatIskValue(dp.realized_profit_ttc_isk, 'full')}</td>
                        <td className="p-2.5 text-right text-white font-bold">{formatIskValue(dp.cumulative_profit_ttc_isk, 'full')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Chart 3: Global Stock Age Pyramid */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  <span>Pyramide des Âges Globale de l&apos;Inventaire</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Détection du vieillissement des stocks non vendus (tranches calées sur 90j max)
                </p>
              </div>

              <button
                onClick={() => setShowAgeTable(!showAgeTable)}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1.5 self-start sm:self-auto cursor-pointer"
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>{showAgeTable ? 'Afficher la pyramide' : 'Alternative tabulaire accessible'}</span>
              </button>
            </div>

            {!showAgeTable ? (
              <div className="space-y-3">
                {(timeseries.lot_age_distribution || []).map((bracket) => {
                  const isWarning = bracket.bracket === '61-90d';
                  const isCritical = bracket.bracket === '>90d';
                  const barColor = isCritical
                    ? 'bg-rose-500'
                    : isWarning
                    ? 'bg-amber-500'
                    : bracket.bracket === '31-60d'
                    ? 'bg-cyan-500'
                    : 'bg-emerald-500';

                  return (
                    <div key={bracket.bracket} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-300">{bracket.label}</span>
                        <div className="flex items-center space-x-3">
                          <span className="text-slate-400">{bracket.quantity.toLocaleString()} un.</span>
                          <span className="text-white font-semibold">
                            {formatIskValue(bracket.cost_isk, preferences.iskDisplayMode)} ({bracket.percentage_of_capital}%)
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${barColor} transition-all duration-300`}
                          style={{ width: `${Math.min(100, Math.max(bracket.percentage_of_capital, bracket.quantity > 0 ? 3 : 0))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-800 rounded-lg">
                <table className="w-full text-xs text-left" aria-label="Données pyramide des âges">
                  <thead className="bg-slate-900/90 text-slate-400 font-mono">
                    <tr>
                      <th className="p-2.5">Tranche d&apos;Âge</th>
                      <th className="p-2.5 text-right">Quantité Globale</th>
                      <th className="p-2.5 text-right">Capital Immobilisé ISK</th>
                      <th className="p-2.5 text-right">Part du Capital</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono">
                    {(timeseries.lot_age_distribution || []).map((bracket) => (
                      <tr key={bracket.bracket}>
                        <td className="p-2.5 text-slate-300">{bracket.label}</td>
                        <td className="p-2.5 text-right text-white">{bracket.quantity.toLocaleString()}</td>
                        <td className="p-2.5 text-right text-amber-300">{formatIskValue(bracket.cost_isk, 'full')}</td>
                        <td className="p-2.5 text-right text-slate-400">{bracket.percentage_of_capital}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
};
