import React, { useState } from 'react';
import {
  Scale,
  Sparkles,
  Link2,
  Building2,
  MapPin,
  Plus,
  Trash2,
  Coins,
  Percent,
  Download,
} from 'lucide-react';
import {
  RoiFinancialSummary,
  ExplicitCostAllocation,
  UnsoldInventoryItem,
  HubDefinition,
  HubLocationMapping,
  HubPairPerformance,
} from '../App';
import { formatIskValue } from '../utils/preferences';
import { allocationsToCsv, triggerCsvDownload } from '../utils/csvExport';

interface HubsRoiViewProps {
  roiSummary: RoiFinancialSummary | null;
  allocations: ExplicitCostAllocation[];
  unsoldInventory: UnsoldInventoryItem[];
  hubsList: HubDefinition[];
  hubsMappings: HubLocationMapping[];
  iskDisplayMode: 'full' | 'compact';
  isReconciling: boolean;
  reconcileMessage: string | null;
  onAutoReconcile: () => void;
  onOpenAddAllocationModal: () => void;
  onDeleteAllocation: (id: string) => void;
  onOpenAddHubModal: () => void;
  onDeleteHub: (id: string) => void;
  onOpenAddMappingModal: () => void;
  onDeleteMapping: (locationId: number) => void;
  onAutoDiscoverHubs: () => void;
}

export const HubsRoiView: React.FC<HubsRoiViewProps> = ({
  roiSummary,
  allocations,
  unsoldInventory,
  hubsList,
  hubsMappings,
  iskDisplayMode,
  isReconciling,
  reconcileMessage,
  onAutoReconcile,
  onOpenAddAllocationModal,
  onDeleteAllocation,
  onOpenAddHubModal,
  onDeleteHub,
  onOpenAddMappingModal,
  onDeleteMapping,
  onAutoDiscoverHubs,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'pairs' | 'unsold' | 'allocations' | 'hubs-config'>('pairs');

  const formatIsk = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return formatIskValue(val, iskDisplayMode);
  };

  const handleExportAllocationsCsv = () => {
    const csv = allocationsToCsv(allocations);
    triggerCsvDownload('eve-trade-cost-allocations.csv', csv);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner with FIFO reconciliation */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Scale className="w-4 h-4 text-emerald-400" />
            Rentabilité Réelle TTC &amp; Hubs Commerciaux
          </h3>
          <p className="text-xs text-slate-400">
            Calcul du ROI TTC avec déduction exacte des taxes SCC, commissions de courtage et allocations explicites d&apos;achats.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <button
            onClick={onAutoReconcile}
            disabled={isReconciling}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            {isReconciling ? 'Rapprochement en cours...' : 'Rapprochement Automatique (FIFO)'}
          </button>
          <button
            onClick={onOpenAddAllocationModal}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow"
          >
            <Plus className="w-3.5 h-3.5" />
            Allouer Manuellement
          </button>
        </div>
      </div>

      {reconcileMessage && (
        <div className="p-3 rounded-lg border border-emerald-800/60 bg-emerald-950/40 text-emerald-200 text-xs flex items-center justify-between">
          <span>{reconcileMessage}</span>
        </div>
      )}

      {/* Global Financial Metrics Cards */}
      {roiSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-1">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-emerald-400" />
              Chiffre d&apos;Affaires Brut
            </span>
            <div className="text-xl font-bold font-mono text-emerald-400">
              {formatIsk(roiSummary.gross_revenue_isk)}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Volume alloué : {roiSummary.allocated_sales_volume.toLocaleString()} / {roiSummary.total_sales_volume.toLocaleString()} un.
            </div>
          </div>

          <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 space-y-1">
            <span className="text-xs font-mono uppercase text-emerald-300 flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-emerald-400" />
              Bénéfice Réalisé TTC
            </span>
            <div className="text-xl font-bold font-mono text-emerald-300">
              {roiSummary.realized_profit_ttc_isk !== null
                ? formatIsk(roiSummary.realized_profit_ttc_isk)
                : 'En attente d\'allocation'}
            </div>
            <div className="text-xs text-emerald-400 font-mono font-semibold">
              {roiSummary.roi_percent_ttc !== null ? `ROI Global : +${roiSummary.roi_percent_ttc.toFixed(2)}% TTC` : 'ROI non calculable (0%)'}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 space-y-1">
            <span className="text-xs font-mono uppercase text-rose-400 flex items-center gap-1.5">
              <Percent className="w-4 h-4 text-rose-400" />
              Frais &amp; Taxes Déduits
            </span>
            <div className="text-xl font-bold font-mono text-rose-400">
              {formatIsk(roiSummary.allocated_buy_fees_isk + roiSummary.attributable_sell_fees_isk)}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Achats : {formatIsk(roiSummary.allocated_buy_fees_isk)} · Ventes : {formatIsk(roiSummary.attributable_sell_fees_isk)}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 space-y-1">
            <span className="text-xs font-mono uppercase text-amber-400 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-amber-400" />
              Capital Immobilisé (Stocks)
            </span>
            <div className="text-xl font-bold font-mono text-amber-300">
              {formatIsk(roiSummary.tied_up_capital_isk)}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              {roiSummary.unsold_items_count} lots invendus en stock
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tabs Navigation */}
      <div className="flex items-center space-x-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
        <button
          onClick={() => setActiveSubTab('pairs')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeSubTab === 'pairs'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Paires de Hubs ({roiSummary?.hub_pairs?.length ?? 0})
        </button>
        <button
          onClick={() => setActiveSubTab('unsold')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeSubTab === 'unsold'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Stocks Invendus ({unsoldInventory.length})
        </button>
        <button
          onClick={() => setActiveSubTab('allocations')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeSubTab === 'allocations'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Rapprochements ({allocations.length})
        </button>
        <button
          onClick={() => setActiveSubTab('hubs-config')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            activeSubTab === 'hubs-config'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Configuration Hubs ({hubsList.length})
        </button>
      </div>

      {/* SUBTAB 1: HUB PAIRS */}
      {activeSubTab === 'pairs' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden space-y-4 p-4">
          <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Scale className="w-4 h-4 text-amber-400" />
            Performance des Flux Commerciaux (Achat → Vente)
          </h4>

          {roiSummary?.hub_pairs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">
              Aucune paire de hubs enregistrée. Associez vos stations dans l&apos;onglet Configuration Hubs.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {roiSummary?.hub_pairs.map((pair: HubPairPerformance) => (
                <div
                  key={`${pair.buy_hub_id}:${pair.sell_hub_id}`}
                  className="p-4 rounded-xl border border-slate-800 bg-slate-950/80 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200 truncate">
                      {pair.buy_hub_name} → {pair.sell_hub_name}
                    </span>
                    <span
                      className={`font-mono text-[10px] px-2 py-0.5 rounded border ${
                        pair.coverage_status === 'COMPLETE'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : pair.coverage_status === 'PARTIAL'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {pair.coverage_percent}% alloc
                    </span>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-300 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Chiffre d&apos;Affaires Brut :</span>
                      <span className="text-slate-200 font-semibold">{formatIsk(pair.gross_revenue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Coût d&apos;Achat Alloué :</span>
                      <span className="text-sky-400">{formatIsk(pair.allocated_buy_cost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Frais &amp; Taxes TTC :</span>
                      <span className="text-rose-400">
                        {formatIsk(pair.allocated_buy_fees + pair.attributable_sell_fees)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 flex justify-between">
                      <span className="text-emerald-300 font-bold">Bénéfice Net Réalisé :</span>
                      <span className="text-emerald-300 font-bold">
                        {pair.realized_profit_ttc !== null ? formatIsk(pair.realized_profit_ttc) : 'Incomplet'}
                      </span>
                    </div>
                    {pair.roi_percent_ttc !== null && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">ROI TTC :</span>
                        <span className="text-emerald-400 font-bold">+{pair.roi_percent_ttc.toFixed(2)}%</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: UNSOLD INVENTORY */}
      {activeSubTab === 'unsold' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-400" />
                Stocks d&apos;Achats Invendus (Capital Immobilisé)
              </h4>
              <p className="text-xs text-slate-400">
                Unités achetées n&apos;ayant pas encore fait l&apos;objet d&apos;une vente et d&apos;un rapprochement.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 font-mono text-slate-400">
                  <th className="py-3 px-4">Date d&apos;Achat</th>
                  <th className="py-3 px-4">Article</th>
                  <th className="py-3 px-4">Hub d&apos;Achat</th>
                  <th className="py-3 px-4 text-right">Quantité Restante</th>
                  <th className="py-3 px-4 text-right">Prix Unitaire</th>
                  <th className="py-3 px-4 text-right">Capital Immobilisé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {unsoldInventory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-mono">
                      Aucun stock invendu.
                    </td>
                  </tr>
                ) : (
                  unsoldInventory.map((item) => (
                    <tr key={item.buy_transaction_id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {new Date(item.buy_date).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-200">{item.type_name}</td>
                      <td className="py-3 px-4 text-slate-300">{item.hub_name}</td>
                      <td className="py-3 px-4 text-right font-mono text-amber-300 font-bold">
                        {item.remaining_quantity.toLocaleString()} / {item.original_quantity.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-400">
                        {formatIsk(item.unit_buy_price)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-slate-200 font-bold">
                        {formatIsk(item.tied_capital_isk)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 3: ALLOCATIONS */}
      {activeSubTab === 'allocations' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Link2 className="w-4 h-4 text-amber-400" />
                Rapprochements &amp; Allocations Explicites Enregistrées
              </h4>
              <p className="text-xs text-slate-400">
                Chaque allocation lie formellement une vente à un achat avec preuve sans FIFO/coût moyen implicite.
              </p>
            </div>
            {allocations.length > 0 && (
              <button
                onClick={handleExportAllocationsCsv}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Exporter les allocations en CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Exporter CSV
              </button>
            )}
          </div>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {allocations.length === 0 ? (
              <div className="p-6 text-center text-slate-500 font-mono text-xs">
                Aucun rapprochement enregistré. Cliquez sur « Allouer Manuellement » ou « Rapprochement Automatique (FIFO) ».
              </div>
            ) : (
              allocations.map((a) => (
                <div
                  key={a.id}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-200">
                      {a.type_name} — {a.quantity_allocated.toLocaleString()} unités
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Vente #{a.sell_transaction_id} ({a.sell_hub_name}) ← Achat #{a.buy_transaction_id} ({a.buy_hub_name} @ {formatIsk(a.unit_buy_price)})
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Coût: {formatIsk(a.allocated_buy_cost)} | Frais Achat: {formatIsk(a.allocated_buy_fees)} | Frais Vente: {formatIsk(a.allocated_sell_fees)}
                    </div>
                  </div>
                  <button
                    onClick={() => onDeleteAllocation(a.id)}
                    className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800"
                    title="Supprimer le rapprochement"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 4: HUBS CONFIG */}
      {activeSubTab === 'hubs-config' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Hubs Definitions */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-400" />
                Hubs Définis
              </h4>
              <button
                onClick={onOpenAddHubModal}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Nouveau Hub
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {hubsList.map((h) => (
                <div
                  key={h.id}
                  className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between"
                >
                  <div>
                    <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                      {h.name}
                      {h.is_system_default && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 bg-slate-800 text-slate-400 rounded">
                          Système
                        </span>
                      )}
                    </div>
                    {h.system_name && (
                      <div className="text-[11px] text-slate-500 font-mono">Système : {h.system_name}</div>
                    )}
                  </div>
                  {!h.is_system_default && (
                    <button
                      onClick={() => onDeleteHub(h.id)}
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                      title="Supprimer ce hub"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Location to Hub Mappings */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-amber-400" />
                Associations Stations / Structures ({hubsMappings.length})
              </h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={onAutoDiscoverHubs}
                  className="px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
                  title="Auto-détecter les stations des transactions"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" /> Auto-découvrir
                </button>
                <button
                  onClick={onOpenAddMappingModal}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Associer
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {hubsMappings.map((m) => {
                const hub = hubsList.find((h) => h.id === m.hub_id);
                return (
                  <div
                    key={m.location_id}
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between"
                  >
                    <div className="max-w-[80%]">
                      <div className="text-xs font-medium text-slate-200 truncate" title={m.location_name}>
                        {m.location_name}
                      </div>
                      <div className="text-[11px] text-sky-400 font-mono">
                        ID {m.location_id} → {hub?.name || m.hub_id}
                      </div>
                    </div>
                    <button
                      onClick={() => onDeleteMapping(m.location_id)}
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                      title="Supprimer l'association"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
