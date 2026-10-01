import React, { useState } from 'react';
import {
  ShoppingCart,
  Truck,
  Sparkles,
  Plus,
  Copy,
  Download,
  CheckSquare,
  ArrowRight,
  Package,
  Layers,
  Info,
  Calendar,
} from 'lucide-react';
import { RestockItem, RestockItemStatus } from '../App';
import { formatEveMultibuy } from '../utils/eveMultibuy';
import { transfersToCsv, restockPurchasesToCsv, triggerCsvDownload } from '../utils/csvExport';
import { formatIskValue } from '../utils/preferences';
import { useApiQuery, useQueryClient } from '../utils/apiClient';

export interface TransferSuggestion {
  id: string;
  characterId: number;
  typeId: number;
  typeName: string;
  quantity: number;
  unitVolumeM3: number;
  totalVolumeM3: number;
  sourceLocationId: number;
  sourceLocationName: string;
  sourceHubId?: string;
  sourceHubName?: string;
  targetLocationId: number;
  targetLocationName: string;
  targetHubId?: string;
  targetHubName?: string;
  estimatedUnitValueIsk: number;
  estimatedTotalValueIsk: number;
  status: 'SUGGESTED' | 'PLANNED' | 'IN_TRANSIT' | 'COMPLETED' | 'DISMISSED';
  reason: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RestockPurchaseSuggestion {
  id: string;
  characterId: number;
  typeId: number;
  typeName: string;
  targetBuyHubId: number;
  targetBuyHubName: string;
  sellLocationId: number;
  sellLocationName: string;
  sellHubId?: string;
  sellHubName?: string;
  dailyVelocity: number;
  velocityWindowDays: number;
  horizonDays: number;
  safetyStock: number;
  targetQuantity: number;
  existingHubStock: number;
  existingSellOrders: number;
  existingBuyEscrow: number;
  existingQuantity: number;
  netNeedQuantity: number;
  transferredQuantity: number;
  purchaseQuantity: number;
  unitVolumeM3: number;
  totalVolumeM3: number;
  estimatedBuyUnitPrice: number;
  estimatedTotalCostIsk: number;
  status: 'SUGGESTED' | 'PLANNED' | 'IN_TRANSIT' | 'COMPLETED' | 'DISMISSED';
  justification: string;
  linkedOrderId?: number;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CargoCapacityBenchmark {
  vesselClass: string;
  name: string;
  capacityM3: number;
  tripsNeeded: number;
}

export interface OperationsPlanResponse {
  summary: {
    asOf: string;
    horizonDays: number;
    velocityWindowDays: number;
    totalTransfersCount: number;
    totalTransferQuantity: number;
    totalTransferVolumeM3: number;
    totalTransferValueIsk: number;
    totalPurchasesCount: number;
    totalPurchaseQuantity: number;
    totalPurchaseVolumeM3: number;
    totalPurchaseCostIsk: number;
    itemsCoveredByTransfer: number;
    itemsRequiringPurchase: number;
    transferVesselBenchmarks: CargoCapacityBenchmark[];
    purchaseVesselBenchmarks: CargoCapacityBenchmark[];
  };
  transfers: TransferSuggestion[];
  purchases: RestockPurchaseSuggestion[];
}

interface RestockViewProps {
  restockItems: RestockItem[];
  isGenerating: boolean;
  onGenerateRestock: () => void;
  onOpenAddModal: () => void;
  onUpdateStatus?: (item: RestockItem, status: RestockItemStatus) => void;
  onDeleteItem: (id: string) => void;
  onOpenProduct360?: (typeId: number) => void;
  iskDisplayMode?: 'compact' | 'full';
  characterIds?: number[];
}

export const RestockView: React.FC<RestockViewProps> = ({
  restockItems,
  isGenerating,
  onGenerateRestock,
  onOpenAddModal,
  onUpdateStatus: _onUpdateStatus,
  onDeleteItem,
  onOpenProduct360,
  iskDisplayMode = 'compact',
  characterIds,
}) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'transfers' | 'purchases' | 'legacy'>('transfers');
  const [copiedHub, setCopiedHub] = useState<string | null>(null);
  const [selectedHubFilter, setSelectedHubFilter] = useState<string>('ALL');
  const [horizonDays, setHorizonDays] = useState<number>(14);
  const [velocityWindowDays, setVelocityWindowDays] = useState<number>(90);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);

  // Load Operations Plan from /api/operations/plan
  const { data: operationsPlanData, isLoading: isLoadingPlan } = useApiQuery<OperationsPlanResponse>(
    ['operations', 'plan', horizonDays, velocityWindowDays, ...(characterIds || [])],
    (signal) => {
      const params = new URLSearchParams({
        horizonDays: String(horizonDays),
        velocityWindowDays: String(velocityWindowDays),
      });
      if (characterIds && characterIds.length > 0) {
        params.set('characterId', String(characterIds[0]));
      }
      return fetch(`/api/operations/plan?${params.toString()}`, { signal }).then((res) => {
        if (!res.ok) throw new Error('Failed to fetch operations plan');
        return res.json();
      });
    },
    { ttl: 15_000 }
  );

  const plan = operationsPlanData || null;
  const transfers = plan?.transfers || [];
  const purchases = plan?.purchases || [];
  const summary = plan?.summary || null;

  // Filtered purchases
  const distinctPurchaseHubs = Array.from(
    new Set(purchases.map((p) => p.targetBuyHubName || 'Hub Inconnu'))
  );

  const filteredPurchases =
    selectedHubFilter === 'ALL'
      ? purchases
      : purchases.filter((p) => (p.targetBuyHubName || 'Hub Inconnu') === selectedHubFilter);

  // Copy Multibuy: ONLY PURCHASES (transfers are strictly excluded)
  const handleCopyMultibuyPurchases = async () => {
    const multibuyItems = filteredPurchases
      .filter((i) => i.status !== 'COMPLETED' && i.status !== 'DISMISSED')
      .map((p) => ({
        typeName: p.typeName,
        suggestedQuantity: p.purchaseQuantity,
        targetQuantity: p.purchaseQuantity,
        status: p.status as RestockItemStatus,
      }));

    const text = formatEveMultibuy(multibuyItems as unknown as RestockItem[]);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedHub('PURCHASES');
      setTimeout(() => setCopiedHub(null), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleExportTransfersCsv = () => {
    const csv = transfersToCsv(transfers);
    triggerCsvDownload('eve-trade-logistics-transfers.csv', csv);
  };

  const handleExportPurchasesCsv = () => {
    const csv = restockPurchasesToCsv(filteredPurchases);
    triggerCsvDownload('eve-trade-market-purchases.csv', csv);
  };

  const handleUpdateTransferStatus = async (id: string, newStatus: TransferSuggestion['status']) => {
    setIsUpdatingStatus(id);
    try {
      const res = await fetch(`/api/operations/transfers/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        queryClient.invalidateQueries(['operations']);
      }
    } catch (err) {
      console.error('Failed to update transfer status:', err);
    } finally {
      setIsUpdatingStatus(null);
    }
  };

  const handleUpdatePurchaseStatus = async (id: string, newStatus: RestockPurchaseSuggestion['status']) => {
    setIsUpdatingStatus(id);
    try {
      const res = await fetch(`/api/operations/restock/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        queryClient.invalidateQueries(['operations']);
      }
    } catch (err) {
      console.error('Failed to update purchase status:', err);
    } finally {
      setIsUpdatingStatus(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-mono font-semibold">
              PHASE 11
            </span>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-amber-400" />
              Listes de Réapprovisionnement Locales &amp; Transferts Prioritaires
            </h2>
          </div>
          <p className="text-xs text-slate-400 max-w-2xl">
            Arbitrage logistique automatique : réaffecte en priorité les stocks libres dormants identifiés dans d&apos;autres stations avant de suggérer des achats de marché calculés sur votre vélocité réelle.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={onGenerateRestock}
            disabled={isGenerating || isLoadingPlan}
            className="px-3.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="Recalculer les propositions opérationnelles"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            {isGenerating ? 'Analyse en cours...' : 'Générer suggestions'}
          </button>
          <button
            onClick={onOpenAddModal}
            className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow"
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter un article
          </button>
        </div>
      </div>

      {/* Summary KPI Strip */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl border border-sky-800/40 bg-sky-950/20 space-y-1">
            <div className="text-[11px] font-mono text-sky-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Truck className="w-3.5 h-3.5" />
                Transferts Prioritaires
              </span>
              <span className="font-bold">{summary.totalTransfersCount}</span>
            </div>
            <div className="text-lg font-bold text-white font-mono">
              {summary.totalTransferVolumeM3.toLocaleString()} <span className="text-xs font-normal text-slate-400">m³</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              Valeur: {formatIskValue(summary.totalTransferValueIsk, iskDisplayMode)}
            </div>
          </div>

          <div className="p-3.5 rounded-xl border border-amber-800/40 bg-amber-950/20 space-y-1">
            <div className="text-[11px] font-mono text-amber-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <ShoppingCart className="w-3.5 h-3.5" />
                Achats de Marché
              </span>
              <span className="font-bold">{summary.totalPurchasesCount}</span>
            </div>
            <div className="text-lg font-bold text-white font-mono">
              {formatIskValue(summary.totalPurchaseCostIsk, iskDisplayMode)}
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              Volume: {summary.totalPurchaseVolumeM3.toLocaleString()} m³ ({summary.totalPurchaseQuantity.toLocaleString()} u.)
            </div>
          </div>

          <div className="p-3.5 rounded-xl border border-emerald-800/40 bg-emerald-950/20 space-y-1">
            <div className="text-[11px] font-mono text-emerald-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Package className="w-3.5 h-3.5" />
                Capital Économisé (Transferts)
              </span>
              <span className="font-bold font-mono">
                {summary.totalTransferQuantity > 0 ? `${summary.totalTransferQuantity.toLocaleString()} u.` : '0 u.'}
              </span>
            </div>
            <div className="text-lg font-bold text-emerald-400 font-mono">
              {formatIskValue(summary.totalTransferValueIsk, iskDisplayMode)}
            </div>
            <div className="text-[11px] text-slate-400">
              Évite le rachat inutile de stock déjà possédé
            </div>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-300" />
              Horizon &amp; Vélocité Cible
            </div>
            <div className="text-lg font-bold text-slate-200 font-mono">
              {horizonDays} jours <span className="text-xs font-normal text-slate-400">(V_{velocityWindowDays}j)</span>
            </div>
            <div className="text-[11px] text-slate-400">
              Couverture paramétrable
            </div>
          </div>
        </div>
      )}

      {/* Tabs Navigation & Horizon Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('transfers')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'transfers'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
            }`}
          >
            <Truck className="w-4 h-4 text-sky-400" />
            1. Transferts Logistiques Prioritaires
            <span className="px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 text-[10px] font-mono border border-sky-800">
              {transfers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('purchases')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer ${
              activeTab === 'purchases'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
            }`}
          >
            <ShoppingCart className="w-4 h-4 text-amber-400" />
            2. Achats de Marché Raisonnés
            <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 text-[10px] font-mono border border-amber-800">
              {purchases.length}
            </span>
          </button>

          {restockItems.length > 0 && (
            <button
              onClick={() => setActiveTab('legacy')}
              className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'legacy'
                  ? 'bg-slate-800 text-slate-200 border border-slate-700'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Liste locale manuelle ({restockItems.length})
            </button>
          )}
        </div>

        {/* Horizon and Velocity Controls */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-400 text-[11px]">Horizon :</span>
            <select
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-amber-300 focus:outline-none"
            >
              <option value={7}>7 jours</option>
              <option value={14}>14 jours (défaut)</option>
              <option value={30}>30 jours</option>
              <option value={60}>60 jours</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-400 text-[11px]">Vitesse :</span>
            <select
              value={velocityWindowDays}
              onChange={(e) => setVelocityWindowDays(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-sky-300 focus:outline-none"
            >
              <option value={14}>14 jours</option>
              <option value={30}>30 jours</option>
              <option value={60}>60 jours</option>
              <option value={90}>90 jours (cycle complet)</option>
            </select>
          </div>
        </div>
      </div>

      {/* TAB 1: LOGISTICS TRANSFERS */}
      {activeTab === 'transfers' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-sky-950/20 border border-sky-900/30 p-3.5 rounded-xl">
            <div className="flex items-center gap-2 text-xs text-sky-200">
              <Info className="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                Ces articles sont déjà en votre possession dans d&apos;autres stations. Transférez-les pour éviter d&apos;immobiliser du capital supplémentaire.
              </span>
            </div>
            {transfers.length > 0 && (
              <button
                onClick={handleExportTransfersCsv}
                className="px-3 py-1.5 rounded-lg bg-sky-900/40 hover:bg-sky-900/60 text-sky-300 border border-sky-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Exporter CSV Transferts
              </button>
            )}
          </div>

          {/* Cargo Vessel Class Benchmarks */}
          {summary && summary.totalTransferVolumeM3 > 0 && (
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 space-y-2">
              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-sky-400" />
                Estimation de capacité cargo pour le fret total ({summary.totalTransferVolumeM3.toLocaleString()} m³) :
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 pt-1">
                {summary.transferVesselBenchmarks.map((bench) => (
                  <div
                    key={bench.vesselClass}
                    className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                      bench.tripsNeeded <= 1
                        ? 'border-emerald-800/40 bg-emerald-950/20 text-emerald-300'
                        : 'border-slate-800 bg-slate-950/40 text-slate-300'
                    }`}
                  >
                    <div className="font-semibold text-slate-200 truncate" title={bench.name}>
                      {bench.name.split(' (')[0]}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>Capacité: {(bench.capacityM3 / 1000).toLocaleString()}k m³</span>
                      <span className={`font-bold ${bench.tripsNeeded <= 1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {bench.tripsNeeded} voyage{bench.tripsNeeded > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Transfers List */}
          {transfers.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
              <Truck className="w-10 h-10 text-slate-600 mx-auto" />
              <h4 className="text-sm font-semibold text-slate-300">
                Aucun transfert logistique requis
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Tous vos besoins de réapprovisionnement sont soit déjà couverts sur place, soit nécessitent des achats de marché (aucun stock libre distant disponible).
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {transfers.map((item) => (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-colors space-y-3 ${
                    item.status === 'COMPLETED'
                      ? 'border-emerald-800/40 bg-emerald-950/20 opacity-75'
                      : item.status === 'IN_TRANSIT'
                      ? 'border-amber-800/50 bg-amber-950/20'
                      : item.status === 'PLANNED'
                      ? 'border-sky-800/50 bg-sky-950/20'
                      : 'border-slate-800 bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={() => onOpenProduct360 && onOpenProduct360(item.typeId)}
                        className="text-xs font-bold text-slate-100 hover:text-sky-300 block text-left transition-colors cursor-pointer underline-offset-2 hover:underline"
                        title="Ouvrir la fiche Product 360"
                      >
                        {item.typeName}
                      </button>
                      <span className="text-[10px] text-slate-400 font-mono">Type ID: #{item.typeId}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                        item.status === 'COMPLETED'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : item.status === 'IN_TRANSIT'
                          ? 'bg-amber-950 text-amber-300 border-amber-800'
                          : item.status === 'PLANNED'
                          ? 'bg-sky-950 text-sky-300 border-sky-800'
                          : 'bg-slate-900 text-slate-300 border-slate-700'
                      }`}
                    >
                      {item.status === 'SUGGESTED'
                        ? 'SUGGÉRÉ'
                        : item.status === 'PLANNED'
                        ? 'PLANIFIÉ'
                        : item.status === 'IN_TRANSIT'
                        ? 'EN TRANSIT'
                        : 'LIVRÉ'}
                    </span>
                  </div>

                  {/* Route: Origin -> Destination */}
                  <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex items-start gap-1.5 text-slate-300">
                      <span className="text-[10px] font-mono text-slate-500 uppercase shrink-0 mt-0.5">Origine:</span>
                      <span className="font-medium text-sky-300 truncate" title={item.sourceLocationName}>
                        {item.sourceLocationName}
                      </span>
                    </div>
                    <div className="flex items-center justify-center text-slate-600">
                      <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    </div>
                    <div className="flex items-start gap-1.5 text-slate-300">
                      <span className="text-[10px] font-mono text-slate-500 uppercase shrink-0 mt-0.5">Cible:</span>
                      <span className="font-medium text-amber-300 truncate" title={item.targetLocationName}>
                        {item.targetLocationName}
                      </span>
                    </div>
                  </div>

                  {/* Quantity & Cargo Volume */}
                  <div className="space-y-1 text-xs text-slate-300">
                    <div className="flex justify-between font-mono">
                      <span className="text-slate-400">Quantité à transférer :</span>
                      <span className="font-bold text-sky-300">
                        {item.quantity.toLocaleString()} unités
                      </span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span className="text-slate-400">Volume Cargo :</span>
                      <span className="font-semibold text-slate-200">
                        {item.totalVolumeM3.toLocaleString()} m³ ({item.unitVolumeM3} m³/u.)
                      </span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span className="text-slate-400">Valeur estimée :</span>
                      <span className="text-slate-300">
                        {formatIskValue(item.estimatedTotalValueIsk, iskDisplayMode)}
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] text-sky-300 bg-sky-950/40 p-2 rounded border border-sky-900/40">
                    {item.reason}
                  </div>

                  {/* Operational Status Actions */}
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {item.status !== 'PLANNED' && item.status !== 'IN_TRANSIT' && item.status !== 'COMPLETED' && (
                        <button
                          onClick={() => handleUpdateTransferStatus(item.id, 'PLANNED')}
                          disabled={isUpdatingStatus === item.id}
                          className="px-2 py-1 rounded bg-sky-950 hover:bg-sky-900 text-sky-300 text-[11px] font-medium border border-sky-800 transition-colors"
                        >
                          Planifier
                        </button>
                      )}
                      {item.status === 'PLANNED' && (
                        <button
                          onClick={() => handleUpdateTransferStatus(item.id, 'IN_TRANSIT')}
                          disabled={isUpdatingStatus === item.id}
                          className="px-2 py-1 rounded bg-amber-950 hover:bg-amber-900 text-amber-300 text-[11px] font-medium border border-amber-800 transition-colors"
                        >
                          Marquer en transit
                        </button>
                      )}
                      {item.status === 'IN_TRANSIT' && (
                        <button
                          onClick={() => handleUpdateTransferStatus(item.id, 'COMPLETED')}
                          disabled={isUpdatingStatus === item.id}
                          className="px-2 py-1 rounded bg-emerald-950 hover:bg-emerald-900 text-emerald-300 text-[11px] font-medium border border-emerald-800 transition-colors"
                        >
                          Marquer livré
                        </button>
                      )}
                      {item.status === 'COMPLETED' && (
                        <button
                          onClick={() => handleUpdateTransferStatus(item.id, 'SUGGESTED')}
                          disabled={isUpdatingStatus === item.id}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition-colors"
                        >
                          Réinitialiser
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => handleUpdateTransferStatus(item.id, 'DISMISSED')}
                      disabled={isUpdatingStatus === item.id}
                      className="px-2 py-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 text-[11px] transition-colors"
                    >
                      Ignorer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MARKET PURCHASES */}
      {activeTab === 'purchases' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-amber-950/20 border border-amber-900/30 p-3.5 rounded-xl">
            <div className="flex items-center gap-2 text-xs text-amber-200">
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Ces achats sont strictement calculés après déduction intégrale des stocks transférables. La copie Multibuy n&apos;achète que le besoin net résiduel.
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {filteredPurchases.length > 0 && (
                <>
                  <button
                    onClick={handleCopyMultibuyPurchases}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Copier les quantités à acheter au format EVE Multibuy"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedHub === 'PURCHASES' ? 'Copié !' : 'Copier Multibuy'}
                  </button>
                  <button
                    onClick={handleExportPurchasesCsv}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Exporter les achats en CSV"
                  >
                    <Download className="w-3.5 h-3.5" />
                    CSV
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Hub Filter */}
          {distinctPurchaseHubs.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Filtrer par Hub d&apos;achat :</span>
              <button
                onClick={() => setSelectedHubFilter('ALL')}
                className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedHubFilter === 'ALL'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                Tous les Hubs ({purchases.length})
              </button>
              {distinctPurchaseHubs.map((hub) => {
                const count = purchases.filter((p) => (p.targetBuyHubName || 'Hub Inconnu') === hub).length;
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

          {/* Purchases Grid */}
          {filteredPurchases.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
              <ShoppingCart className="w-10 h-10 text-slate-600 mx-auto" />
              <h4 className="text-sm font-semibold text-slate-300">
                Aucun achat de marché nécessaire
              </h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Tous vos besoins de stock pour l&apos;horizon de {horizonDays} jours sont entièrement couverts par vos stocks locaux ou vos transferts logistiques prioritaires !
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPurchases.map((item) => (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl border transition-colors space-y-3 ${
                    item.status === 'COMPLETED'
                      ? 'border-emerald-800/40 bg-emerald-950/20 opacity-75'
                      : item.status === 'PLANNED'
                      ? 'border-sky-800/50 bg-sky-950/20'
                      : 'border-slate-800 bg-slate-900/50'
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
                        item.status === 'COMPLETED'
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
                      <span className="font-medium text-slate-200 truncate max-w-[170px]" title={item.targetBuyHubName}>
                        {item.targetBuyHubName}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Station de revente :</span>
                      <span className="font-medium text-slate-200 truncate max-w-[170px]" title={item.sellLocationName}>
                        {item.sellLocationName}
                      </span>
                    </div>
                    <div className="flex justify-between font-mono">
                      <span className="text-slate-400">Quantité à acheter :</span>
                      <span className="font-bold text-amber-300">
                        {item.purchaseQuantity.toLocaleString()} unités
                      </span>
                    </div>
                    {item.transferredQuantity > 0 && (
                      <div className="flex justify-between font-mono text-[11px] text-sky-400">
                        <span>Déjà couvert par transfert :</span>
                        <span>+{item.transferredQuantity.toLocaleString()} u.</span>
                      </div>
                    )}
                    <div className="flex justify-between font-mono">
                      <span className="text-slate-400">Coût estimé :</span>
                      <span className="font-semibold text-slate-200">
                        {formatIskValue(item.estimatedTotalCostIsk, iskDisplayMode)}
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-300 bg-slate-950/70 p-2.5 rounded border border-slate-800 font-mono">
                    <div className="text-slate-400 text-[10px] uppercase pb-1 border-b border-slate-800 mb-1 flex items-center justify-between">
                      <span>Formule de dimensionnement</span>
                      <span>V_{item.velocityWindowDays}j = {item.dailyVelocity} u/j</span>
                    </div>
                    {item.justification}
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {item.status !== 'COMPLETED' ? (
                        <button
                          onClick={() => handleUpdatePurchaseStatus(item.id, 'COMPLETED')}
                          disabled={isUpdatingStatus === item.id}
                          className="px-2 py-1 rounded bg-emerald-950/80 hover:bg-emerald-800 text-emerald-300 text-[11px] font-medium border border-emerald-800 flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <CheckSquare className="w-3 h-3" />
                          Marquer acheté
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUpdatePurchaseStatus(item.id, 'PLANNED')}
                          disabled={isUpdatingStatus === item.id}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition-colors cursor-pointer"
                        >
                          Remettre planifié
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => handleUpdatePurchaseStatus(item.id, 'DISMISSED')}
                      disabled={isUpdatingStatus === item.id}
                      className="px-2 py-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 text-[11px] transition-colors"
                    >
                      Ignorer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: LEGACY / MANUAL LIST */}
      {activeTab === 'legacy' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h4 className="text-xs font-bold text-slate-300 mb-2">Articles ajoutés manuellement :</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {restockItems.map((item) => (
                <div key={item.id} className="p-3 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2 text-xs">
                  <div className="flex items-start justify-between">
                    <span className="font-semibold text-slate-200">{item.typeName}</span>
                    <span className="text-amber-400 font-mono font-bold">{item.targetQuantity} u.</span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Hub : {item.targetBuyHubName} &rarr; {item.sellHubName}
                  </div>
                  <div className="flex justify-end gap-2 pt-1 border-t border-slate-800/80">
                    <button
                      onClick={() => onDeleteItem(item.id)}
                      className="text-rose-400 hover:text-rose-300 text-[11px]"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
