import React, { useState } from 'react';
import {
  ShoppingCart,
  Sparkles,
  Plus,
  Copy,
  Download,
  CheckSquare,
  Trash2,
  PackageCheck,
} from 'lucide-react';
import { RestockItem, RestockItemStatus } from '../App';
import { formatEveMultibuy } from '../utils/eveMultibuy';
import { restockToCsv, triggerCsvDownload } from '../utils/csvExport';

interface RestockViewProps {
  restockItems: RestockItem[];
  isGenerating: boolean;
  onGenerateRestock: () => void;
  onOpenAddModal: () => void;
  onUpdateStatus: (item: RestockItem, status: RestockItemStatus) => void;
  onDeleteItem: (id: string) => void;
  onOpenProduct360?: (typeId: number) => void;
}

export const RestockView: React.FC<RestockViewProps> = ({
  restockItems,
  isGenerating,
  onGenerateRestock,
  onOpenAddModal,
  onUpdateStatus,
  onDeleteItem,
  onOpenProduct360,
}) => {
  const [copiedHub, setCopiedHub] = useState<string | null>(null);
  const [selectedHubFilter, setSelectedHubFilter] = useState<string>('ALL');

  // Distinct Target Hubs
  const distinctHubs = Array.from(
    new Set(restockItems.map((item) => item.targetBuyHubName || 'Hub Inconnu'))
  );

  const filteredItems =
    selectedHubFilter === 'ALL'
      ? restockItems
      : restockItems.filter((item) => (item.targetBuyHubName || 'Hub Inconnu') === selectedHubFilter);

  const handleCopyMultibuyAll = async () => {
    const text = formatEveMultibuy(filteredItems.filter((i) => i.status !== 'PURCHASED'));
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHub('ALL');
      setTimeout(() => setCopiedHub(null), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleExportCsv = () => {
    const csv = restockToCsv(filteredItems);
    triggerCsvDownload('eve-trade-restock-list.csv', csv);
  };

  return (
    <div className="space-y-6">
      {/* Top Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/60">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-amber-400" />
            Listes de Réapprovisionnement Locales
          </h3>
          <p className="text-xs text-slate-400">
            Préparez vos listes d&apos;achats par hub cible avant vos déplacements. Projection locale modifiable, sans mutation en jeu.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          {filteredItems.length > 0 && (
            <>
              <button
                onClick={handleCopyMultibuyAll}
                className="px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Copier les articles au format EVE Multibuy pour achat en jeu"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedHub === 'ALL' ? 'Copié !' : 'Copier Multibuy'}
              </button>
              <button
                onClick={handleExportCsv}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Exporter la liste en CSV"
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </button>
            </>
          )}
          <button
            onClick={onGenerateRestock}
            disabled={isGenerating}
            className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            {isGenerating ? 'Analyse en cours...' : 'Générer suggestions'}
          </button>
          <button
            onClick={onOpenAddModal}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow"
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter un article
          </button>
        </div>
      </div>

      {/* Hub Filter Bar */}
      {distinctHubs.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Filtrer par Hub Source :</span>
          <button
            onClick={() => setSelectedHubFilter('ALL')}
            className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
              selectedHubFilter === 'ALL'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
            }`}
          >
            Tous les Hubs ({restockItems.length})
          </button>
          {distinctHubs.map((hub) => {
            const count = restockItems.filter((i) => (i.targetBuyHubName || 'Hub Inconnu') === hub).length;
            return (
              <button
                key={hub}
                onClick={() => setSelectedHubFilter(hub)}
                className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedHubFilter === hub
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {hub.split(' - ')[0]} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Items Grid */}
      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
          <PackageCheck className="w-10 h-10 text-slate-600 mx-auto" />
          <h4 className="text-sm font-semibold text-slate-300">
            Aucun article dans la liste de réapprovisionnement
          </h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Cliquez sur « Générer suggestions » pour détecter automatiquement les articles épuisés ou en stock faible, ou ajoutez un article manuellement.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className={`p-4 rounded-xl border transition-colors space-y-3 ${
                item.status === 'PURCHASED'
                  ? 'border-emerald-800/40 bg-emerald-950/20 opacity-75'
                  : item.status === 'PLANNED'
                  ? 'border-sky-800/50 bg-sky-950/20'
                  : 'border-slate-800 bg-slate-900/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <button
                    type="button"
                    onClick={() => onOpenProduct360 && onOpenProduct360(item.typeId)}
                    className="text-xs font-bold text-slate-100 hover:text-amber-300 block text-left transition-colors cursor-pointer underline-offset-2 hover:underline"
                    title="Ouvrir la fiche Product 360"
                  >
                    {item.typeName}
                  </button>
                  <span className="text-[10px] text-slate-400 font-mono">Type ID: #{item.typeId}</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                    item.status === 'PURCHASED'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : item.status === 'PLANNED'
                      ? 'bg-sky-950 text-sky-300 border-sky-800'
                      : 'bg-amber-950 text-amber-300 border-amber-800'
                  }`}
                >
                  {item.status === 'SUGGESTED'
                    ? 'SUGGÉRÉ'
                    : item.status === 'PLANNED'
                    ? 'PLANIFIÉ'
                    : 'ACHETÉ'}
                </span>
              </div>

              <div className="space-y-1 text-xs text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-400">Hub d&apos;achat cible :</span>
                  <span
                    className="font-medium text-slate-200 truncate max-w-[160px]"
                    title={item.targetBuyHubName}
                  >
                    {item.targetBuyHubName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Station de revente :</span>
                  <span
                    className="font-medium text-slate-200 truncate max-w-[160px]"
                    title={item.sellHubName}
                  >
                    {item.sellHubName}
                  </span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-slate-400">Quantité cible :</span>
                  <span className="font-bold text-amber-300">
                    {item.targetQuantity.toLocaleString()} unités
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 italic bg-slate-950/60 p-2 rounded border border-slate-800/80">
                {item.justification}
              </div>

              {item.notes && (
                <div className="text-[11px] text-sky-300 bg-sky-950/30 p-2 rounded border border-sky-900/40">
                  Note : {item.notes}
                </div>
              )}

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {item.status !== 'PURCHASED' ? (
                    <button
                      onClick={() => onUpdateStatus(item, 'PURCHASED')}
                      className="px-2 py-1 rounded bg-emerald-950/80 hover:bg-emerald-800 text-emerald-300 text-[11px] font-medium border border-emerald-800 flex items-center gap-1 transition-colors"
                    >
                      <CheckSquare className="w-3 h-3" />
                      Marquer acheté
                    </button>
                  ) : (
                    <button
                      onClick={() => onUpdateStatus(item, 'PLANNED')}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition-colors"
                    >
                      Remettre planifié
                    </button>
                  )}
                </div>

                <button
                  onClick={() => onDeleteItem(item.id)}
                  className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                  title="Supprimer l'article de la liste"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
