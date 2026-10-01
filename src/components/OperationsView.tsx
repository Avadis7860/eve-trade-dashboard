import React, { useState } from 'react';
import {
  Truck,
  ShoppingCart,
  Download,
  Copy,
  Search,
  CheckCircle2,
  Clock,
  Sparkles,
  MapPin,
  Building2,
  Info,
} from 'lucide-react';
import { RestockItem } from '../App';
import { formatEveMultibuy } from '../utils/eveMultibuy';
import { restockToCsv, triggerCsvDownload } from '../utils/csvExport';
import { useApiQuery, fetchJson } from '../utils/apiClient';
import type { OperationsPlanResponse } from '../server/operations/types';

interface OperationsViewProps {
  restockItems: RestockItem[];
  formatIsk: (val: number | null | undefined) => string;
  onOpenProduct360?: (typeId: number) => void;
  activeCharacterId?: number;
  characterIds?: number[];
  initialSubTab?: 'transfers' | 'purchases';
}

export const OperationsView: React.FC<OperationsViewProps> = ({
  restockItems,
  formatIsk,
  onOpenProduct360,
  activeCharacterId,
  characterIds,
  initialSubTab = 'purchases',
}) => {
  const [subTab, setSubTab] = useState<'transfers' | 'purchases'>(initialSubTab);
  const [copiedMultibuy, setCopiedMultibuy] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [horizonDays, setHorizonDays] = useState<number>(14);

  // Fetch full operations plan including transfers
  const { data: planData } = useApiQuery<OperationsPlanResponse>(
    [
      'operations',
      'plan',
      horizonDays,
      ...(characterIds && characterIds.length > 1 ? characterIds : activeCharacterId ? [activeCharacterId] : []),
    ],
    async (signal) => {
      const params = new URLSearchParams({
        horizonDays: String(horizonDays),
      });
      if (characterIds && characterIds.length > 1) {
        params.append('character_ids', characterIds.join(','));
      } else if (activeCharacterId) {
        params.append('character_id', String(activeCharacterId));
      }
      return fetchJson<OperationsPlanResponse>(`/api/operations/plan?${params.toString()}`, { signal });
    },
    { ttl: 30_000 }
  );

  const transfers = planData?.transfers || [];
  const purchases = planData?.purchases || [];

  // Filter restock items (combines local props or fetched plan)
  const itemsToDisplay = purchases.length > 0
    ? purchases.map((p) => ({
        id: `plan-${p.typeId}-${p.sellLocationId}`,
        typeId: p.typeId,
        typeName: p.typeName,
        hubName: p.sellHubName || p.sellLocationName,
        targetBuyHubName: p.targetBuyHubName,
        suggestedQuantity: p.purchaseQuantity > 0 ? p.purchaseQuantity : p.netNeedQuantity,
        costPriceIsk: p.estimatedBuyUnitPrice,
        totalCostEstimate: p.estimatedTotalCostIsk,
        status: p.status,
        runRatePerDay: p.dailyVelocity,
        coverageDays: p.horizonDays,
        volumeM3: p.unitVolumeM3,
      }))
    : restockItems.map((r) => ({
        id: r.id,
        typeId: r.typeId,
        typeName: r.typeName,
        hubName: r.sellHubName,
        targetBuyHubName: r.targetBuyHubName,
        suggestedQuantity: r.suggestedQuantity,
        costPriceIsk: r.estimatedBuyUnitPrice || 0,
        totalCostEstimate: r.suggestedQuantity * (r.estimatedBuyUnitPrice || 0),
        status: r.status,
        runRatePerDay: 0,
        coverageDays: 14,
        volumeM3: 0.1,
      }));

  const filteredItems = itemsToDisplay.filter((item) => {
    if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const matchName = item.typeName?.toLowerCase().includes(term);
      const matchId = String(item.typeId).includes(term);
      const matchHub = item.hubName?.toLowerCase().includes(term);
      if (!matchName && !matchId && !matchHub) return false;
    }
    return true;
  });

  const handleCopyMultibuy = async () => {
    const text = formatEveMultibuy(restockItems);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMultibuy(true);
      setTimeout(() => setCopiedMultibuy(false), 2000);
    } catch (e) {
      console.error('Failed to copy multibuy', e);
    }
  };

  const handleExportCsv = () => {
    if (filteredItems.length === 0) return;
    const csv = restockToCsv(restockItems);
    triggerCsvDownload(`reassort_achats_${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const totalPurchaseBudget = filteredItems.reduce((acc, i) => acc + (i.totalCostEstimate || 0), 0);
  const totalPurchaseVolume = filteredItems.reduce(
    (acc, i) => acc + ((i.volumeM3 || 0.1) * (i.suggestedQuantity || 0)),
    0
  );

  return (
    <div className="space-y-6">
      {/* Navigation Sub-Tabs & Global Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2 bg-slate-900/60 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setSubTab('transfers')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'transfers'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            Transferts Prioritaires ({transfers.length})
          </button>
          <button
            onClick={() => setSubTab('purchases')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'purchases'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            Achats Nets de Réapprovisionnement ({filteredItems.length})
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center gap-1 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400 text-[11px]">Horizon :</span>
            <select
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              className="bg-transparent text-slate-200 font-semibold focus:outline-hidden cursor-pointer"
            >
              <option value={7}>7 jours</option>
              <option value={14}>14 jours</option>
              <option value={30}>30 jours</option>
              <option value={60}>60 jours</option>
            </select>
          </div>

          {subTab === 'purchases' && (
            <>
              <button
                onClick={handleCopyMultibuy}
                disabled={filteredItems.length === 0}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                title="Copier le format EVE Multibuy pour le coller en jeu"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedMultibuy ? 'Copié Multibuy !' : 'Copier EVE Multibuy'}
              </button>
              <button
                onClick={handleExportCsv}
                disabled={filteredItems.length === 0}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                Exporter CSV
              </button>
            </>
          )}
        </div>
      </div>

      {/* SUB-TAB 1: TRANSFERTS PRIORITAIRES */}
      {subTab === 'transfers' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-sky-500/20 bg-sky-500/5 text-xs text-slate-300 flex items-start gap-3">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sky-300">Principe des Transferts Prioritaires (Phase 11)</div>
              <div className="text-slate-400 mt-0.5">
                Avant de dépenser du capital en rachat, le système identifie les articles dont le stock est insuffisant sur votre hub de vente principal mais déjà disponible dans une autre station ou structure.
              </div>
            </div>
          </div>

          {transfers.length === 0 ? (
            <div className="p-12 text-center rounded-xl border border-slate-800 bg-slate-900/40 text-xs text-slate-400 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <div className="text-slate-200 font-semibold text-sm">Aucun transfert inter-hub requis</div>
              <p className="text-slate-500 max-w-md mx-auto">
                Vos stocks locaux suffisent à couvrir l&apos;horizon de vente sélectionné, ou aucun excédent n&apos;est disponible dans vos stations secondaires.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
                      <th className="p-3">Article</th>
                      <th className="p-3">Source (Origine)</th>
                      <th className="p-3">Destination (Hub Cible)</th>
                      <th className="p-3 text-right">Qté à Déplacer</th>
                      <th className="p-3 text-right">Volume (m³)</th>
                      <th className="p-3 text-right">Économie Achat</th>
                      <th className="p-3 text-center">Priorité</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {transfers.map((t, idx) => (
                      <tr key={`${t.typeId}-${idx}`} className="hover:bg-slate-800/40 transition-colors group">
                        <td className="p-3 font-medium text-slate-200">
                          <div className="flex items-center gap-2">
                            <img
                              src={`https://images.evetech.net/types/${t.typeId}/icon?size=32`}
                              alt=""
                              className="w-6 h-6 rounded bg-slate-950 border border-slate-800 shrink-0"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <div>
                              <div className="truncate font-semibold group-hover:text-amber-300">{t.typeName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">#{t.typeId}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-slate-300 font-mono">
                          <div className="flex items-center gap-1 text-slate-200">
                            <MapPin className="w-3.5 h-3.5 text-rose-400" />
                            {t.sourceLocationName || `Station #${t.sourceLocationId}`}
                          </div>
                          <div className="text-[10px] text-slate-500">ID: #{t.sourceLocationId}</div>
                        </td>
                        <td className="p-3 text-slate-300 font-mono">
                          <div className="flex items-center gap-1 text-emerald-300">
                            <Building2 className="w-3.5 h-3.5 text-emerald-400" />
                            {t.targetHubName || t.targetLocationName || `Station #${t.targetLocationId}`}
                          </div>
                          <div className="text-[10px] text-slate-500">{t.reason}</div>
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-amber-300">
                          {t.quantity.toLocaleString()} unités
                        </td>
                        <td className="p-3 text-right font-mono text-slate-400">
                          {t.totalVolumeM3 ? `${t.totalVolumeM3.toFixed(1)} m³` : '—'}
                        </td>
                        <td className="p-3 text-right font-mono text-emerald-400 font-semibold">
                          {formatIsk(t.estimatedTotalValueIsk)}
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              t.status === 'SUGGESTED'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : t.status === 'PLANNED'
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                : t.status === 'IN_TRANSIT'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {t.status}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {onOpenProduct360 && (
                              <button
                                onClick={() => onOpenProduct360(t.typeId)}
                                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                                title="Fiche Product 360"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
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

      {/* SUB-TAB 2: ACHATS NETS DE RÉAPPROVISIONNEMENT */}
      {subTab === 'purchases' && (
        <div className="space-y-4">
          {/* Dense Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
              <div className="text-[11px] font-mono text-slate-400">Articles à Acheter</div>
              <div className="text-xl font-bold font-mono text-slate-100">{filteredItems.length}</div>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
              <div className="text-[11px] font-mono text-slate-400">Budget Achat Estimé</div>
              <div className="text-xl font-bold font-mono text-amber-300">{formatIsk(totalPurchaseBudget)}</div>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
              <div className="text-[11px] font-mono text-slate-400">Volume Cargo Estimé</div>
              <div className="text-xl font-bold font-mono text-sky-400">{totalPurchaseVolume.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³</div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Rechercher article, hub..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-hidden focus:border-amber-500"
                >
                  <option value="ALL">Tous les statuts</option>
                  <option value="SUGGESTED">SUGGESTED (Suggérés)</option>
                  <option value="PLANNED">PLANNED (Planifiés)</option>
                  <option value="PURCHASED">PURCHASED (Achetés)</option>
                  <option value="DISMISSED">DISMISSED (Ignorés)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Dense Restock Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-mono uppercase text-[10px]">
                    <th className="p-3">Article</th>
                    <th className="p-3">Hub Cible</th>
                    <th className="p-3 text-right">Vélocité (j)</th>
                    <th className="p-3 text-right">Qté Suggérée</th>
                    <th className="p-3 text-right">Prix Unit. Estimé</th>
                    <th className="p-3 text-right">Budget Total</th>
                    <th className="p-3 text-center">Statut</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-500 italic">
                        Aucun achat de réapprovisionnement requis pour cette sélection.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40 transition-colors group">
                        <td className="p-3 font-medium text-slate-200">
                          <div className="flex items-center gap-2">
                            <img
                              src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`}
                              alt=""
                              className="w-6 h-6 rounded bg-slate-950 border border-slate-800 shrink-0"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <div>
                              <div className="truncate font-semibold group-hover:text-amber-300">{item.typeName}</div>
                              <div className="text-[10px] text-slate-500 font-mono">#{item.typeId}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-slate-300 font-mono">
                          {item.hubName || 'Hub principal'}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-400">
                          {item.runRatePerDay ? `${item.runRatePerDay.toFixed(1)} u/j` : '—'}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-amber-300">
                          {item.suggestedQuantity.toLocaleString()}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-200">
                          {formatIsk(item.costPriceIsk)}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold text-amber-400">
                          {formatIsk(item.totalCostEstimate)}
                        </td>
                        <td className="p-3 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              item.status === 'SUGGESTED'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : item.status === 'PLANNED'
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                : item.status === 'PURCHASED'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {item.status || 'SUGGESTED'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {onOpenProduct360 && (
                              <button
                                onClick={() => onOpenProduct360(item.typeId)}
                                className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                                title="Fiche Product 360"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
