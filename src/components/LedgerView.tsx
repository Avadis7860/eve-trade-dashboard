import React from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Percent,
  Coins,
  PackageCheck,
  Filter,
  Search,
  Download,
  FileText,
  ChevronLeft,
  ChevronRight,
  Info,
  Link2,
} from 'lucide-react';
import { CharacterTransaction } from '../App';
import { formatIskValue } from '../utils/preferences';
import { transactionsToCsv, triggerCsvDownload } from '../utils/csvExport';

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

interface LedgerViewProps {
  transactions: CharacterTransaction[];
  summary: LedgerSummary | null;
  loading: boolean;
  page: number;
  totalPages: number;
  totalCount: number;
  filterType: 'ALL' | 'SELL' | 'BUY';
  searchQuery: string;
  selectedLocation: string;
  distinctLocations: { id: number; name: string; count: number }[];
  iskDisplayMode: 'full' | 'compact';
  onFilterTypeChange: (type: 'ALL' | 'SELL' | 'BUY') => void;
  onSearchChange: (search: string) => void;
  onLocationChange: (loc: string) => void;
  onPageChange: (page: number) => void;
  onInspectTransaction: (tx: CharacterTransaction) => void;
  onQuickAllocate?: (tx: CharacterTransaction) => void;
}

export const LedgerView: React.FC<LedgerViewProps> = ({
  transactions,
  summary,
  loading,
  page,
  totalPages,
  totalCount,
  filterType,
  searchQuery,
  selectedLocation,
  distinctLocations,
  iskDisplayMode,
  onFilterTypeChange,
  onSearchChange,
  onLocationChange,
  onPageChange,
  onInspectTransaction,
  onQuickAllocate,
}) => {
  const formatIsk = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return formatIskValue(val, iskDisplayMode);
  };

  const handleExportCsv = () => {
    const csv = transactionsToCsv(transactions);
    triggerCsvDownload(`eve-trade-transactions-page${page}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      {/* Summary Metrics Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
              Chiffre d&apos;Affaires Brut
            </span>
            <div className="text-xl font-bold font-mono text-emerald-400">
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
            <div className="text-xl font-bold font-mono text-rose-400">
              {formatIsk((summary.totalTaxesIsk || 0) + (summary.totalBrokerFeesIsk || 0))}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Taxes: {formatIsk(summary.totalTaxesIsk || 0)} · Frais: {formatIsk(summary.totalBrokerFeesIsk || 0)}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-1">
            <span className="text-xs font-mono uppercase text-emerald-300 flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-emerald-300" />
              Ventes Nettes (TTC)
            </span>
            <div className="text-xl font-bold font-mono text-emerald-300">
              {formatIsk(summary.totalNetSalesIsk !== undefined ? summary.totalNetSalesIsk : summary.totalGrossSalesIsk)}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Net encaissé après déductions
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <ArrowDownLeft className="w-4 h-4 text-sky-400" />
              Dépenses d&apos;Achats
            </span>
            <div className="text-xl font-bold font-mono text-sky-400">
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
            <div className="text-xl font-bold font-mono text-slate-100">
              {summary.distinctItemsCount} types
            </div>
            <div className="text-xs text-slate-400 font-mono">
              {summary.distinctLocationsCount} stations observées
            </div>
          </div>
        </div>
      )}

      {/* Search, Filter Toolbar & Export */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => onFilterTypeChange('ALL')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filterType === 'ALL'
                  ? 'bg-slate-800 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Toutes
            </button>
            <button
              onClick={() => onFilterTypeChange('SELL')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filterType === 'SELL'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ventes
            </button>
            <button
              onClick={() => onFilterTypeChange('BUY')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                filterType === 'BUY'
                  ? 'bg-sky-950 text-sky-300 border border-sky-800 shadow'
                  : 'text-slate-400 hover:text-slate-200'
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
                onChange={(e) => onLocationChange(e.target.value)}
                className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer max-w-[180px] truncate"
              >
                <option value="" className="bg-slate-900 text-slate-200">
                  Tous les emplacements
                </option>
                {distinctLocations.map((loc) => (
                  <option key={loc.id} value={loc.id} className="bg-slate-900 text-slate-200">
                    {loc.name} ({loc.count})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher objet, station, ID..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-amber-500/50 focus:outline-none"
            />
          </div>

          <button
            onClick={handleExportCsv}
            disabled={transactions.length === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Exporter les transactions filtrées en CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CSV</span>
          </button>
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
                <th className="py-3 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-500 font-mono">
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
                      onClick={() => onInspectTransaction(tx)}
                    >
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap">
                        {new Date(tx.date).toLocaleDateString('fr-FR')}{' '}
                        {new Date(tx.date).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-semibold border ${
                            tx.isBuy
                              ? 'bg-sky-950/60 text-sky-400 border-sky-800/60'
                              : 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                          }`}
                        >
                          {tx.isBuy ? (
                            <ArrowDownLeft className="w-3 h-3" />
                          ) : (
                            <ArrowUpRight className="w-3 h-3" />
                          )}
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
                      <td
                        className="py-3 px-4 text-slate-400 truncate max-w-[200px]"
                        title={tx.locationName}
                      >
                        {tx.locationName || `Location #${tx.locationId}`}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onInspectTransaction(tx);
                            }}
                            className="p-1 rounded bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-300 transition-colors"
                            title="Inspecter preuves ESI"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                          {!tx.isBuy && onQuickAllocate && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onQuickAllocate(tx);
                              }}
                              className="p-1 rounded bg-slate-800 hover:bg-emerald-500 hover:text-slate-950 text-slate-300 transition-colors"
                              title="Allouer un coût d'achat (ROI)"
                            >
                              <Link2 className="w-3.5 h-3.5" />
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-slate-800 bg-slate-950/40 text-xs">
            <span className="text-slate-400 font-mono">
              Page {page} sur {totalPages} ({totalCount} transactions)
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded border border-slate-800 bg-slate-900 disabled:opacity-40 text-slate-300 hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
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
  );
};
