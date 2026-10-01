import React, { useState } from 'react';
import {
  X,
  TrendingUp,
  Package,
  Calendar,
  Clock,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Table as TableIcon,
  BarChart2,
  Download,
} from 'lucide-react';
import type {
  Product360Response,
  TimeframeOption,
} from '../server/analytics/types';
import type { UserPreferences } from '../utils/preferences';
import { formatIskValue } from '../utils/preferences';
import { timeSeriesToCsv, triggerCsvDownload, escapeCsvField } from '../utils/csvExport';
import { useApiQuery, fetchJson } from '../utils/apiClient';

interface Product360ModalProps {
  typeId: number | null;
  onClose: () => void;
  preferences: UserPreferences;
  characterIds?: number[];
}

export const Product360Modal: React.FC<Product360ModalProps> = ({
  typeId,
  onClose,
  preferences,
  characterIds,
}) => {
  const [timeframe, setTimeframe] = useState<TimeframeOption>('90d');
  const [activeTab, setActiveTab] = useState<'charts' | 'stocks' | 'orders' | 'transactions'>('charts');
  
  // Accessible table toggles for visualizations
  const [showActivityTable, setShowActivityTable] = useState(false);
  const [showProfitTable, setShowProfitTable] = useState(false);
  const [showAgeTable, setShowAgeTable] = useState(false);

  // Selected proof for modal inspection
  const [selectedProofTx, setSelectedProofTx] = useState<{
    id: number;
    proof: Product360Response['transactions_history'][0]['proof'];
  } | null>(null);

  const {
    data,
    isLoading: loading,
    error: queryError,
  } = useApiQuery<Product360Response>(
    ['analytics', 'product', typeId, timeframe, ...(characterIds && characterIds.length > 0 ? characterIds : [])],
    async (signal) => {
      const params = new URLSearchParams({
        timeframe,
        ...(characterIds && characterIds.length > 0 ? { character_ids: characterIds.join(',') } : {}),
      });
      return fetchJson<Product360Response>(`/api/analytics/product/${typeId}?${params.toString()}`, { signal });
    },
    { enabled: !!typeId, ttl: 30_000 }
  );

  const error = queryError ? queryError.message : null;

  if (!typeId) return null;

  const kpis = data?.kpis;
  const stockSummary = kpis?.stock_summary;
  const dataPoints = data?.timeseries.data_points || [];

  // Export time series
  const handleExportTimeseriesCsv = () => {
    if (!data) return;
    const csv = timeSeriesToCsv(data.timeseries.data_points);
    triggerCsvDownload(`product360_${data.type_id}_timeseries_${timeframe}.csv`, csv);
  };

  // Export transactions
  const handleExportTransactionsCsv = () => {
    if (!data) return;
    const headers = [
      'TransactionID',
      'DateUTC',
      'Type',
      'Quantite',
      'PrixUnitaireISK',
      'TotalBrutISK',
      'Emplacement',
      'Hub',
      'StatutReconciliation',
      'CoutAcquisitionAlloueISK',
      'ProfitRealiseTTC_ISK',
    ];
    const rows = data.transactions_history.map((t) => [
      escapeCsvField(t.transaction_id),
      escapeCsvField(t.date),
      escapeCsvField(t.is_buy ? 'ACHAT' : 'VENTE'),
      escapeCsvField(t.quantity),
      escapeCsvField(t.unit_price),
      escapeCsvField(t.total_amount_isk),
      escapeCsvField(t.location_name),
      escapeCsvField(t.hub_name),
      escapeCsvField(t.reconciliation_status),
      escapeCsvField(t.allocated_buy_cost_isk ?? ''),
      escapeCsvField(t.allocated_profit_ttc_isk ?? ''),
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\r\n');
    triggerCsvDownload(`product360_${data.type_id}_transactions_${timeframe}.csv`, csv);
  };

  // SVG Chart Dimensions & Helpers
  const chartWidth = 700;
  const chartHeight = 200;
  const padding = 30;

  // Max values for activity chart
  const maxVolume = Math.max(
    1,
    ...dataPoints.map((dp) => Math.max(dp.units_sold, dp.units_bought))
  );
  const maxRevenue = Math.max(
    1,
    ...dataPoints.map((dp) => dp.gross_revenue_isk)
  );

  // Profit curve calculations
  const minProfit = Math.min(0, ...dataPoints.map((dp) => dp.cumulative_profit_ttc_isk));
  const maxProfit = Math.max(1, ...dataPoints.map((dp) => dp.cumulative_profit_ttc_isk));
  const profitRange = maxProfit - minProfit || 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="product360-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <img
              src={`https://images.evetech.net/types/${typeId}/icon?size=64`}
              alt={data?.type_name || `Type #${typeId}`}
              className="w-14 h-14 rounded-xl border border-slate-700 bg-slate-900 p-1 object-contain shrink-0"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                  PRODUCT 360
                </span>
                <span className="text-xs font-mono text-slate-400">ID: {typeId}</span>
              </div>
              <h2 id="product360-modal-title" className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {data?.type_name || `Chargement de l'article #${typeId}...`}
              </h2>
            </div>
          </div>

          {/* Timeframe selector & Close button */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-0.5 flex items-center text-xs">
              {(['7d', '14d', '30d', '90d', '180d', 'all'] as TimeframeOption[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    timeframe === tf
                      ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf === 'all' ? 'Tout' : tf.replace('d', 'j')}
                </button>
              ))}
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Fermer la fiche Product 360"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && !data && (
            <div className="py-20 flex flex-col items-center justify-center space-y-3 text-slate-400">
              <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium">Agrégation des métriques transversales Product 360...</p>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-950/40 border border-red-800 rounded-xl flex items-center space-x-3 text-red-300 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {data && kpis && (
            <>
              {/* 6 Essential KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {/* 1. CA Brut */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1">
                  <span className="text-[11px] font-mono uppercase text-slate-400">CA Brut Observé</span>
                  <div className="text-base sm:text-lg font-mono font-bold text-white">
                    {formatIskValue(kpis.gross_revenue_isk, preferences.iskDisplayMode)}
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1">
                    <span>{kpis.units_sold.toLocaleString()} un. vendues</span>
                    <span className="text-slate-600">({kpis.sales_transactions_count} ventes)</span>
                  </div>
                </div>

                {/* 2. Coût des Ventes (COGS TTC) */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1">
                  <span className="text-[11px] font-mono uppercase text-slate-400">Coût Matière TTC</span>
                  <div className="text-base sm:text-lg font-mono font-bold text-slate-200">
                    {formatIskValue(kpis.cogs_allocated_isk, preferences.iskDisplayMode)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    + {formatIskValue(kpis.allocated_sell_fees_isk, preferences.iskDisplayMode)} taxes
                  </div>
                </div>

                {/* 3. Bénéfice Net TTC & ROI */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1">
                  <span className="text-[11px] font-mono uppercase text-slate-400">Profit Net TTC</span>
                  <div
                    className={`text-base sm:text-lg font-mono font-bold ${
                      kpis.realized_profit_ttc_isk === null
                        ? 'text-slate-400'
                        : kpis.realized_profit_ttc_isk >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {kpis.realized_profit_ttc_isk !== null
                      ? formatIskValue(kpis.realized_profit_ttc_isk, preferences.iskDisplayMode)
                      : '—'}
                  </div>
                  <div className="text-[11px]">
                    {kpis.roi_percent_ttc !== null ? (
                      <span
                        className={`font-mono font-semibold px-1.5 py-0.5 rounded text-[10px] ${
                          kpis.roi_percent_ttc >= 0
                            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                        }`}
                      >
                        ROI {kpis.roi_percent_ttc > 0 ? `+${kpis.roi_percent_ttc}%` : `${kpis.roi_percent_ttc}%`}
                      </span>
                    ) : (
                      <span className="text-slate-500 font-mono text-[10px]">Non rapproché</span>
                    )}
                  </div>
                </div>

                {/* 4. Vélocité Journalière */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1">
                  <span className="text-[11px] font-mono uppercase text-slate-400">Vélocité Journalière</span>
                  <div className="text-base sm:text-lg font-mono font-bold text-amber-300">
                    {kpis.velocity_daily} <span className="text-xs text-amber-400/70">un./j</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    sur {kpis.velocity_observation_days} jours observés
                  </div>
                </div>

                {/* 5. Durée Moyenne de Détention */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1">
                  <span className="text-[11px] font-mono uppercase text-slate-400">Durée Détention</span>
                  <div className="text-base sm:text-lg font-mono font-bold text-cyan-300">
                    {kpis.average_holding_days !== null ? `${kpis.average_holding_days} j` : '—'}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {kpis.coverage_ratio_holding_days < 1
                      ? `Couv. ${Math.round(kpis.coverage_ratio_holding_days * 100)}%`
                      : '100% rapproché'}
                  </div>
                </div>

                {/* 6. Rendement par Capital-Jour */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-1">
                  <span className="text-[11px] font-mono uppercase text-slate-400">Gain / Capital-Jour</span>
                  <div className="text-base sm:text-lg font-mono font-bold text-indigo-300">
                    {kpis.yield_per_capital_day_percent !== null
                      ? `${kpis.yield_per_capital_day_percent > 0 ? `+${kpis.yield_per_capital_day_percent}` : kpis.yield_per_capital_day_percent} %/j`
                      : '—'}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    ROI TTC / Durée
                  </div>
                </div>
              </div>

              {/* Physical Stock Status Banner */}
              {stockSummary && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 font-medium">Position d&apos;Inventaire Physique</div>
                      <div className="text-sm font-semibold text-white">
                        {stockSummary.total_quantity.toLocaleString()} unités en stock total
                        <span className="text-slate-400 font-normal ml-2">
                          (Coût de revient : {formatIskValue(stockSummary.total_cost_isk, preferences.iskDisplayMode)})
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                    <span className="px-2.5 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                      Ordre vente : {stockSummary.committed_sell_order_qty.toLocaleString()}
                    </span>
                    <span className="px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                      Libre hub : {stockSummary.free_hub_stock_qty.toLocaleString()}
                    </span>
                    {stockSummary.remote_dormant_stock_qty > 0 && (
                      <span className="px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        Dormant : {stockSummary.remote_dormant_stock_qty.toLocaleString()}
                      </span>
                    )}
                    {stockSummary.in_transit_stock_qty > 0 && (
                      <span className="px-2.5 py-1 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                        Transit : {stockSummary.in_transit_stock_qty.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Internal Tab Navigation */}
              <div className="border-b border-slate-800 flex items-center justify-between">
                <div className="flex space-x-2">
                  <button
                    onClick={() => setActiveTab('charts')}
                    className={`pb-3 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center space-x-1.5 ${
                      activeTab === 'charts'
                        ? 'border-amber-400 text-amber-300'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <BarChart2 className="w-3.5 h-3.5" />
                    <span>Séries Temporelles &amp; Graphiques</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('stocks')}
                    className={`pb-3 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center space-x-1.5 ${
                      activeTab === 'stocks'
                        ? 'border-amber-400 text-amber-300'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Stocks par Emplacement ({data.locations_breakdown.length})</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('orders')}
                    className={`pb-3 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center space-x-1.5 ${
                      activeTab === 'orders'
                        ? 'border-amber-400 text-amber-300'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Ordres de Marché Ouverts ({data.open_orders.length})</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('transactions')}
                    className={`pb-3 px-3 text-xs font-semibold border-b-2 transition-colors flex items-center space-x-1.5 ${
                      activeTab === 'transactions'
                        ? 'border-amber-400 text-amber-300'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    <span>Grand Livre &amp; Preuves ({data.transactions_history.length})</span>
                  </button>
                </div>

                <button
                  onClick={activeTab === 'transactions' ? handleExportTransactionsCsv : handleExportTimeseriesCsv}
                  className="pb-2 text-xs font-mono text-slate-400 hover:text-amber-300 flex items-center space-x-1 cursor-pointer transition-colors"
                  title="Exporter les données en CSV RFC 4180"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>

              {/* TAB 1: CHARTS & VISUALIZATIONS */}
              {activeTab === 'charts' && (
                <div className="space-y-6">
                  {/* Visual 1: Activity Chart (Volume bars + Revenue line) */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <BarChart2 className="w-4 h-4 text-amber-400" />
                          <span>Activité &amp; Volumes (Barres d&apos;unités &amp; Courbe de CA)</span>
                        </h3>
                        <p className="text-xs text-slate-400">
                          Période : {new Date(data.timeseries.start_date).toLocaleDateString()} au {new Date(data.timeseries.end_date).toLocaleDateString()}
                        </p>
                      </div>

                      <button
                        onClick={() => setShowActivityTable(!showActivityTable)}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1.5 cursor-pointer"
                      >
                        <TableIcon className="w-3.5 h-3.5" />
                        <span>{showActivityTable ? 'Afficher le graphique' : 'Alternative tabulaire accessible'}</span>
                      </button>
                    </div>

                    {!showActivityTable ? (
                      <div className="w-full overflow-x-auto">
                        {dataPoints.length === 0 ? (
                          <div className="py-12 text-center text-slate-500 text-xs font-mono">
                            Aucune activité observée sur la période.
                          </div>
                        ) : (
                          <div className="min-w-[600px] h-[220px] relative">
                            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-full">
                              {/* Grid lines */}
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

                              {/* Bars for units sold (emerald) & units bought (blue) */}
                              {dataPoints.map((dp, i) => {
                                const availableW = chartWidth - 2 * padding;
                                const barW = Math.max(2, (availableW / dataPoints.length) * 0.4);
                                const x = padding + (i / (dataPoints.length || 1)) * availableW;

                                const soldHeight = (dp.units_sold / maxVolume) * (chartHeight - 2 * padding);
                                const boughtHeight = (dp.units_bought / maxVolume) * (chartHeight - 2 * padding);

                                return (
                                  <g key={dp.period_label} className="group cursor-pointer">
                                    {/* Bought bar */}
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
                                    {/* Sold bar */}
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

                              {/* Revenue line (amber) */}
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

                            {/* Legend */}
                            <div className="flex items-center justify-center space-x-6 text-[11px] text-slate-400 mt-2 font-mono">
                              <div className="flex items-center space-x-1.5">
                                <span className="w-3 h-3 bg-emerald-500 rounded-xs inline-block" />
                                <span>Quantité vendue</span>
                              </div>
                              <div className="flex items-center space-x-1.5">
                                <span className="w-3 h-3 bg-blue-500 rounded-xs inline-block" />
                                <span>Quantité achetée</span>
                              </div>
                              <div className="flex items-center space-x-1.5">
                                <span className="w-3 h-0.5 bg-amber-500 inline-block" />
                                <span>Chiffre d&apos;affaires</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-slate-800 rounded-lg">
                        <table className="w-full text-xs text-left" aria-label="Données brutes d'activité">
                          <thead className="bg-slate-900/90 text-slate-400 font-mono">
                            <tr>
                              <th className="p-2.5">Période</th>
                              <th className="p-2.5 text-right">Ventes (un.)</th>
                              <th className="p-2.5 text-right">Achats (un.)</th>
                              <th className="p-2.5 text-right">CA Brut ISK</th>
                              <th className="p-2.5 text-right">Dépenses ISK</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800 font-mono">
                            {dataPoints.map((dp) => (
                              <tr key={dp.period_label} className="hover:bg-slate-800/40">
                                <td className="p-2.5 text-slate-300">{dp.period_label}</td>
                                <td className="p-2.5 text-right text-emerald-400">{dp.units_sold}</td>
                                <td className="p-2.5 text-right text-blue-400">{dp.units_bought}</td>
                                <td className="p-2.5 text-right text-amber-300">{formatIskValue(dp.gross_revenue_isk, 'full')}</td>
                                <td className="p-2.5 text-right text-slate-400">{formatIskValue(dp.buy_spend_isk, 'full')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Visual 2: Cumulative Realized Profit TTC Curve */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-emerald-400" />
                          <span>Profit Net TTC Cumulé dans le Temps</span>
                        </h3>
                        <p className="text-xs text-slate-400">
                          Total cumulé : {formatIskValue(kpis.realized_profit_ttc_isk || 0, 'full')}
                        </p>
                      </div>

                      <button
                        onClick={() => setShowProfitTable(!showProfitTable)}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1.5 cursor-pointer"
                      >
                        <TableIcon className="w-3.5 h-3.5" />
                        <span>{showProfitTable ? 'Afficher le graphique' : 'Alternative tabulaire'}</span>
                      </button>
                    </div>

                    {!showProfitTable ? (
                      <div className="w-full overflow-x-auto">
                        <div className="min-w-[600px] h-[180px] relative">
                          <svg viewBox={`0 0 ${chartWidth} 160`} className="w-full h-full">
                            <defs>
                              <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                              </linearGradient>
                            </defs>

                            {/* Baseline (0 profit) */}
                            {(() => {
                              const zeroY = 160 - 20 - ((0 - minProfit) / profitRange) * (160 - 40);
                              return (
                                <line
                                  x1={padding}
                                  y1={zeroY}
                                  x2={chartWidth - padding}
                                  y2={zeroY}
                                  stroke="#475569"
                                  strokeDasharray="2 2"
                                />
                              );
                            })()}

                            {/* Polygon Area */}
                            {dataPoints.length > 1 && (
                              <polygon
                                fill="url(#profitGradient)"
                                points={`
                                  ${padding},${160 - 20}
                                  ${dataPoints
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
                                  ${chartWidth - padding},${160 - 20}
                                `}
                              />
                            )}

                            {/* Line */}
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
                        <table className="w-full text-xs text-left" aria-label="Tableau de profit cumulé">
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

                  {/* Visual 3: Inventory Age Pyramid (0-14d, 15-30d, 31-60d, 61-90d, >90d) */}
                  <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Clock className="w-4 h-4 text-cyan-400" />
                          <span>Pyramide des Âges du Stock Invendu</span>
                        </h3>
                        <p className="text-xs text-slate-400">
                          Répartition par ancienneté d&apos;acquisition (alignée sur les ordres standard de 90j)
                        </p>
                      </div>

                      <button
                        onClick={() => setShowAgeTable(!showAgeTable)}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center space-x-1.5 cursor-pointer"
                      >
                        <TableIcon className="w-3.5 h-3.5" />
                        <span>{showAgeTable ? 'Afficher la pyramide' : 'Alternative tabulaire'}</span>
                      </button>
                    </div>

                    {!showAgeTable ? (
                      <div className="space-y-2.5">
                        {data.timeseries.lot_age_distribution.map((bracket) => {
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
                            <div key={bracket.bracket} className="space-y-1">
                              <div className="flex items-center justify-between text-xs font-mono">
                                <span className="text-slate-300">{bracket.label}</span>
                                <div className="flex items-center space-x-3">
                                  <span className="text-slate-400">{bracket.quantity.toLocaleString()} un.</span>
                                  <span className="text-white font-semibold">
                                    {formatIskValue(bracket.cost_isk, preferences.iskDisplayMode)} ({bracket.percentage_of_capital}%)
                                  </span>
                                </div>
                              </div>
                              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
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
                        <table className="w-full text-xs text-left" aria-label="Pyramide des âges du stock">
                          <thead className="bg-slate-900/90 text-slate-400 font-mono">
                            <tr>
                              <th className="p-2.5">Tranche d&apos;Âge</th>
                              <th className="p-2.5 text-right">Quantité Invendue</th>
                              <th className="p-2.5 text-right">Capital Immobilisé ISK</th>
                              <th className="p-2.5 text-right">Part du Capital</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800 font-mono">
                            {data.timeseries.lot_age_distribution.map((bracket) => (
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

                  {/* Visual 4: Hub Flows Matrix */}
                  {data.timeseries.hub_flows.length > 0 && (
                    <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-4">
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <ArrowRight className="w-4 h-4 text-purple-400" />
                        <span>Matrice des Flux Commerciaux (Hub Achat &rarr; Hub Vente)</span>
                      </h3>

                      <div className="overflow-x-auto border border-slate-800 rounded-lg">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-slate-900/90 text-slate-400 font-mono">
                            <tr>
                              <th className="p-2.5">Flux Commercial</th>
                              <th className="p-2.5 text-right">Unités Allouées</th>
                              <th className="p-2.5 text-right">CA Brut ISK</th>
                              <th className="p-2.5 text-right">Profit Net TTC ISK</th>
                              <th className="p-2.5 text-right">ROI TTC (%)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800 font-mono">
                            {data.timeseries.hub_flows.map((flow) => (
                              <tr key={`${flow.source_hub_id}-${flow.dest_hub_id}`}>
                                <td className="p-2.5 text-slate-200 flex items-center gap-1.5">
                                  <span className="font-semibold text-blue-300">{flow.source_hub_name}</span>
                                  <ArrowRight className="w-3 h-3 text-slate-500" />
                                  <span className="font-semibold text-amber-300">{flow.dest_hub_name}</span>
                                </td>
                                <td className="p-2.5 text-right text-slate-300">{flow.units_allocated.toLocaleString()}</td>
                                <td className="p-2.5 text-right text-amber-300">{formatIskValue(flow.gross_revenue_isk, preferences.iskDisplayMode)}</td>
                                <td className="p-2.5 text-right text-emerald-400">{formatIskValue(flow.allocated_profit_ttc_isk, preferences.iskDisplayMode)}</td>
                                <td className="p-2.5 text-right">
                                  {flow.roi_percent_ttc !== null ? (
                                    <span className="text-emerald-400 font-bold">+{flow.roi_percent_ttc}%</span>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: STOCKS BY LOCATION */}
              {activeTab === 'stocks' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-950 text-slate-400 font-mono">
                        <tr>
                          <th className="p-3">Emplacement / Station</th>
                          <th className="p-3">Hub Associé</th>
                          <th className="p-3">Statut &amp; Classification</th>
                          <th className="p-3 text-right">Quantité</th>
                          <th className="p-3 text-right">Coût de Revient Unit.</th>
                          <th className="p-3 text-right">Valeur de Revient Total</th>
                          <th className="p-3 text-right">Valeur Vente Notionnelle</th>
                          <th className="p-3 text-right">Inactivité</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-mono">
                        {data.locations_breakdown.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-8 text-center text-slate-500">
                              Aucun stock physique présent dans les hangars.
                            </td>
                          </tr>
                        ) : (
                          data.locations_breakdown.map((loc) => {
                            let badgeStyle = 'bg-slate-800 text-slate-300';
                            let label: string = loc.classification;
                            if (loc.classification === 'COMMITTED_SELL_ORDER') {
                              badgeStyle = 'bg-blue-500/10 text-blue-300 border border-blue-500/20';
                              label = 'En Ordre de Vente';
                            } else if (loc.classification === 'FREE_HUB_STOCK') {
                              badgeStyle = 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20';
                              label = 'Stock Libre Hub';
                            } else if (loc.classification === 'REMOTE_DORMANT_STOCK') {
                              badgeStyle = 'bg-amber-500/10 text-amber-300 border border-amber-500/20';
                              label = 'Dormant Hors Hub';
                            } else if (loc.classification === 'IN_TRANSIT_STOCK') {
                              badgeStyle = 'bg-purple-500/10 text-purple-300 border border-purple-500/20';
                              label = 'En Transit';
                            }

                            return (
                              <tr key={`${loc.location_id}-${loc.classification}`} className="hover:bg-slate-800/40">
                                <td className="p-3 text-slate-200 font-sans font-medium">{loc.location_name}</td>
                                <td className="p-3 text-amber-400">{loc.hub_name}</td>
                                <td className="p-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${badgeStyle}`}>
                                    {label}
                                  </span>
                                </td>
                                <td className="p-3 text-right text-white font-bold">{loc.quantity.toLocaleString()}</td>
                                <td className="p-3 text-right text-slate-300">
                                  {loc.cost_basis_unit_isk !== null
                                    ? formatIskValue(loc.cost_basis_unit_isk, 'full')
                                    : '—'}
                                </td>
                                <td className="p-3 text-right text-amber-300 font-semibold">
                                  {loc.cost_basis_total_isk !== null
                                    ? formatIskValue(loc.cost_basis_total_isk, preferences.iskDisplayMode)
                                    : '—'}
                                </td>
                                <td className="p-3 text-right text-blue-300">
                                  {loc.notional_total_isk !== null
                                    ? formatIskValue(loc.notional_total_isk, preferences.iskDisplayMode)
                                    : '—'}
                                </td>
                                <td className="p-3 text-right text-slate-400">
                                  {loc.days_inactive !== null ? `${loc.days_inactive} j` : '—'}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: OPEN ORDERS */}
              {activeTab === 'orders' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-950 text-slate-400 font-mono">
                        <tr>
                          <th className="p-3">Type</th>
                          <th className="p-3">Station &amp; Hub</th>
                          <th className="p-3 text-right">Prix Unitaire</th>
                          <th className="p-3 text-right">Progression</th>
                          <th className="p-3 text-right">Valeur Totale</th>
                          <th className="p-3">Émis le</th>
                          <th className="p-3">Durée</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-mono">
                        {data.open_orders.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-slate-500">
                              Aucun ordre de marché actif pour cet article.
                            </td>
                          </tr>
                        ) : (
                          data.open_orders.map((order) => (
                            <tr key={order.order_id} className="hover:bg-slate-800/40">
                              <td className="p-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    order.is_buy_order
                                      ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                                      : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                                  }`}
                                >
                                  {order.is_buy_order ? 'ACHAT' : 'VENTE'}
                                </span>
                              </td>
                              <td className="p-3 text-slate-200 font-sans">
                                <div>{order.location_name}</div>
                                <div className="text-[10px] text-amber-400">{order.hub_name}</div>
                              </td>
                              <td className="p-3 text-right text-white font-bold">
                                {formatIskValue(order.price, 'full')}
                              </td>
                              <td className="p-3 text-right">
                                <div className="space-y-1">
                                  <div className="text-slate-300">
                                    {order.volume_remain.toLocaleString()} / {order.volume_total.toLocaleString()}
                                  </div>
                                  <div className="w-20 ml-auto h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-amber-400"
                                      style={{ width: `${order.progress_percent}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="p-3 text-right text-amber-300">
                                {formatIskValue(order.total_value_isk, preferences.iskDisplayMode)}
                              </td>
                              <td className="p-3 text-slate-400">
                                {new Date(order.issued_at).toLocaleDateString()}
                              </td>
                              <td className="p-3 text-slate-400">{order.duration_days} j</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: TRANSACTIONS & RECONCILIATION PROOFS */}
              {activeTab === 'transactions' && (
                <div className="space-y-4">
                  <div className="overflow-x-auto border border-slate-800 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-950 text-slate-400 font-mono">
                        <tr>
                          <th className="p-3">Date</th>
                          <th className="p-3">Type</th>
                          <th className="p-3 text-right">Quantité</th>
                          <th className="p-3 text-right">Prix Unitaire</th>
                          <th className="p-3 text-right">Total Brut ISK</th>
                          <th className="p-3">Emplacement &amp; Hub</th>
                          <th className="p-3">Statut Rapprochement</th>
                          <th className="p-3 text-right">Profit Net TTC</th>
                          <th className="p-3 text-center">Preuve</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 font-mono">
                        {data.transactions_history.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="p-8 text-center text-slate-500">
                              Aucune transaction enregistrée sur la période sélectionnée.
                            </td>
                          </tr>
                        ) : (
                          data.transactions_history.map((tx) => (
                            <tr key={tx.transaction_id} className="hover:bg-slate-800/40">
                              <td className="p-3 text-slate-300">{new Date(tx.date).toLocaleDateString()}</td>
                              <td className="p-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    tx.is_buy
                                      ? 'bg-blue-500/10 text-blue-300 border border-blue-500/20'
                                      : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                                  }`}
                                >
                                  {tx.is_buy ? 'ACHAT' : 'VENTE'}
                                </span>
                              </td>
                              <td className="p-3 text-right text-white font-bold">{tx.quantity.toLocaleString()}</td>
                              <td className="p-3 text-right text-slate-300">{formatIskValue(tx.unit_price, 'full')}</td>
                              <td className="p-3 text-right text-amber-300">{formatIskValue(tx.total_amount_isk, preferences.iskDisplayMode)}</td>
                              <td className="p-3 text-slate-300 font-sans">
                                <div>{tx.location_name}</div>
                                <div className="text-[10px] text-amber-400 font-mono">{tx.hub_name}</div>
                              </td>
                              <td className="p-3">
                                {tx.is_buy ? (
                                  <span className="text-slate-500 text-[11px]">—</span>
                                ) : (
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      tx.reconciliation_status === 'COMPLETE'
                                        ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                                        : tx.reconciliation_status === 'PARTIAL'
                                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                                  >
                                    {tx.reconciliation_status === 'COMPLETE'
                                      ? 'COMPLET'
                                      : tx.reconciliation_status === 'PARTIAL'
                                      ? 'PARTIEL'
                                      : 'NON RAPPROCHÉ'}
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-right">
                                {tx.allocated_profit_ttc_isk !== null ? (
                                  <span
                                    className={`font-bold ${
                                      tx.allocated_profit_ttc_isk >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                    }`}
                                  >
                                    {formatIskValue(tx.allocated_profit_ttc_isk, preferences.iskDisplayMode)}
                                  </span>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td className="p-3 text-center">
                                {tx.proof ? (
                                  <button
                                    onClick={() => setSelectedProofTx({ id: tx.transaction_id, proof: tx.proof })}
                                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-white transition-colors cursor-pointer"
                                    title="Inspecter la preuve de calcul TTC"
                                  >
                                    <ShieldCheck className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Proof inspection sub-modal */}
        {selectedProofTx && selectedProofTx.proof && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4">
            <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2 text-amber-400 font-bold text-sm">
                  <ShieldCheck className="w-5 h-5" />
                  <span>Preuve Mathématique TTC — Vente #{selectedProofTx.id}</span>
                </div>
                <button
                  onClick={() => setSelectedProofTx(null)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs font-mono">
                <div className="p-3 bg-slate-950 rounded-lg space-y-2 border border-slate-800">
                  <div className="flex justify-between text-slate-300">
                    <span>CA Brut Alloué :</span>
                    <span className="text-white font-bold">{selectedProofTx.proof.gross_revenue_isk.toLocaleString()} ISK</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>- Coût d&apos;Achat Matière :</span>
                    <span className="text-rose-300">-{selectedProofTx.proof.allocated_buy_cost_isk.toLocaleString()} ISK</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>- Frais Courtage Achat :</span>
                    <span className="text-rose-300">-{selectedProofTx.proof.allocated_buy_fees_isk.toLocaleString()} ISK</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>- Taxes &amp; Courtage Vente :</span>
                    <span className="text-rose-300">-{selectedProofTx.proof.allocated_sell_fees_isk.toLocaleString()} ISK</span>
                  </div>
                  <div className="border-t border-slate-800 pt-2 flex justify-between text-sm font-bold">
                    <span className="text-emerald-400">= Bénéfice Net TTC :</span>
                    <span className="text-emerald-400">
                      {selectedProofTx.proof.realized_profit_ttc_isk?.toLocaleString()} ISK
                    </span>
                  </div>
                </div>

                <div className="text-slate-400 text-[11px] leading-relaxed">
                  <span className="text-amber-400 font-semibold">Formule auditable : </span>
                  {selectedProofTx.proof.formula_expression}
                </div>
              </div>

              <div className="text-right">
                <button
                  onClick={() => setSelectedProofTx(null)}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
