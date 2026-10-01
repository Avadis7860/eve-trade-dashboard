import React, { useState } from 'react';
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Percent,
  Coins,
  ClipboardList,
  AlertTriangle,
  ShoppingCart,
  Scale,
  RefreshCw,
  Copy,
  ChevronRight,
  Sparkles,
  Wallet,
  ShieldCheck,
  Package,
  Clock,
  ArrowRight,
  HelpCircle,
  Settings,
} from 'lucide-react';
import {
  RoiFinancialSummary,
  OrderSummaryMetrics,
  CharacterOrderSnapshot,
  RestockItem,
} from '../App';
import { formatIskValue, UserPreferences } from '../utils/preferences';
import { formatEveMultibuy } from '../utils/eveMultibuy';
import { useApiQuery, fetchJson } from '../utils/apiClient';
import type { CapitalBreakdownResponse } from '../server/capital/types';

interface DashboardOverviewProps {
  summary: {
    totalGrossSalesIsk: number;
    totalNetSalesIsk?: number;
    totalTaxesIsk?: number;
    totalBrokerFeesIsk?: number;
    totalBuySpendIsk: number;
    sellTransactionsCount: number;
    buyTransactionsCount: number;
    totalSellVolume: number;
    totalBuyVolume: number;
    distinctItemsCount: number;
    distinctLocationsCount: number;
  } | null;
  roiSummary: RoiFinancialSummary | null;
  orderSummary: OrderSummaryMetrics | null;
  orders: CharacterOrderSnapshot[];
  restockItems: RestockItem[];
  iskDisplayMode: 'full' | 'compact';
  preferences?: UserPreferences;
  activeCharacterId?: number;
  characterIds?: number[];
  onNavigateTab: (tab: string, subTab?: string) => void;
  onOpenProduct360?: (typeId: number) => void;
  onOpenPreferences?: () => void;
  onUpdatePreferences?: (updated: Partial<UserPreferences>) => void;
  onSync: () => void;
  isSyncing: boolean;
  onAutoReconcile: () => void;
  isReconciling: boolean;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  summary,
  roiSummary,
  orderSummary,
  orders,
  restockItems,
  iskDisplayMode,
  preferences,
  activeCharacterId,
  characterIds,
  onNavigateTab,
  onOpenProduct360,
  onOpenPreferences,
  onUpdatePreferences,
  onSync,
  isSyncing,
  onAutoReconcile,
  isReconciling,
}) => {
  const [copiedMultibuy, setCopiedMultibuy] = useState(false);
  const [showRoiProof, setShowRoiProof] = useState(false);

  // Fetch capital breakdown for the 5-state patrimonial synthesis with active liquidity preferences
  const { data: capitalData, isFetching: fetchingCapital } = useApiQuery<CapitalBreakdownResponse>(
    [
      'capital',
      'summary-cockpit',
      preferences?.walletSyncMode,
      preferences?.excludedCharacterWalletIds?.join(','),
      preferences?.includedCorporationWallets?.join(','),
      ...(characterIds && characterIds.length > 1 ? characterIds : activeCharacterId ? [activeCharacterId] : []),
    ],
    async (signal) => {
      const params = new URLSearchParams({ page: '1', pageSize: '1' });
      if (preferences?.walletSyncMode) {
        params.append('wallet_sync_mode', preferences.walletSyncMode);
      }
      if (preferences?.excludedCharacterWalletIds && preferences.excludedCharacterWalletIds.length > 0) {
        params.append('excluded_character_wallet_ids', preferences.excludedCharacterWalletIds.join(','));
      }
      if (preferences?.includedCorporationWallets && preferences.includedCorporationWallets.length > 0) {
        params.append('included_corporation_wallets', preferences.includedCorporationWallets.join(','));
      }
      if (characterIds && characterIds.length > 1) {
        params.append('character_ids', characterIds.join(','));
      } else if (activeCharacterId) {
        params.append('character_id', String(activeCharacterId));
      }
      return fetchJson<CapitalBreakdownResponse>(`/api/capital/breakdown?${params.toString()}`, { signal });
    },
    { ttl: 15_000 }
  );

  const formatIsk = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return formatIskValue(val, iskDisplayMode);
  };

  const monetary = capitalData?.summary.monetary;
  const dormant = capitalData?.summary.dormantSummary;

  const disappearedOrders = orders.filter((o) => o.state === 'DISAPPEARED_UNCONFIRMED');
  const pendingRestock = restockItems.filter((i) => i.status !== 'PURCHASED');

  // Net Cash-Flow calculation: Gross Sales - Buy Spend - Taxes/Fees
  const totalInflow = summary?.totalGrossSalesIsk ?? 0;
  const totalOutflow = summary?.totalBuySpendIsk ?? 0;
  const totalFees = (summary?.totalTaxesIsk ?? 0) + (summary?.totalBrokerFeesIsk ?? 0);
  const netCashFlow = totalInflow - totalOutflow - totalFees;

  const handleCopyMultibuy = async () => {
    const text = formatEveMultibuy(pendingRestock);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMultibuy(true);
      setTimeout(() => setCopiedMultibuy(false), 2000);
    } catch (e) {
      console.error('Failed to copy multibuy', e);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. SYNTHÈSE PATRIMONIALE CONSOLIDÉE (5 États Mutuellement Exclusifs) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Wallet className="w-4 h-4 text-amber-400" />
                Synthèse Patrimoniale Consolidée
              </h2>
              {fetchingCapital && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 font-medium animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Actualisation...
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Répartition exhaustive du capital en 5 états mutuellement exclusifs
            </p>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            {/* Quick Liquidity Switcher */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px]">
              <span className="text-[10px] text-slate-400 font-mono px-1 flex items-center gap-1">
                <Coins className="w-3 h-3 text-emerald-400" />
                Liquidités :
              </span>
              <button
                type="button"
                onClick={() => onUpdatePreferences?.({ walletSyncMode: 'BOTH' })}
                className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer text-[11px] ${
                  (preferences?.walletSyncMode || 'BOTH') === 'BOTH'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Inclure tous les portefeuilles (Personnages + Corporation)"
              >
                Tous
              </button>
              <button
                type="button"
                onClick={() => onUpdatePreferences?.({ walletSyncMode: 'CHARACTERS_ONLY' })}
                className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer text-[11px] ${
                  preferences?.walletSyncMode === 'CHARACTERS_ONLY'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Inclure uniquement les portefeuilles des personnages"
              >
                Persos
              </button>
              <button
                type="button"
                onClick={() => onUpdatePreferences?.({ walletSyncMode: 'CORPORATION_ONLY' })}
                className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer text-[11px] ${
                  preferences?.walletSyncMode === 'CORPORATION_ONLY'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Inclure uniquement les divisions de portefeuille corporation"
              >
                Corpo
              </button>
              {onOpenPreferences && (
                <button
                  type="button"
                  onClick={onOpenPreferences}
                  className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition-colors cursor-pointer ml-0.5 border border-transparent hover:border-slate-700"
                  title="Ouvrir les préférences détaillées (exclusions par personnage ou division corpo)"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-400 font-mono">Valeur Totale des Actifs :</div>
              <div className="text-lg font-bold font-mono text-amber-300">
                {monetary ? formatIsk(monetary.netRealCapitalIsk) : formatIsk((roiSummary?.tied_up_capital_isk || 0))}
              </div>
            </div>
          </div>
        </div>

        {/* 5-Pillar Capital Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Pillar 1: Liquidités ISK */}
          <div className="p-3.5 rounded-lg border border-slate-800/80 bg-slate-950/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1 text-slate-300">
                <Coins className="w-3.5 h-3.5 text-emerald-400" /> Liquidités ISK
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono border border-slate-700">
                {preferences?.walletSyncMode === 'CHARACTERS_ONLY' ? 'Persos' : preferences?.walletSyncMode === 'CORPORATION_ONLY' ? 'Corpo' : 'Tous'}
              </span>
            </div>
            <div className="text-base font-bold font-mono text-emerald-400">
              {monetary ? formatIsk(monetary.liquidWalletBalanceIsk) : '—'}
            </div>
            <div className="text-[10px] text-slate-500">Fonds disponibles immédiatement</div>
          </div>

          {/* Pillar 2: Escrow Achats */}
          <div className="p-3.5 rounded-lg border border-slate-800/80 bg-slate-950/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1 text-slate-300">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-400" /> Escrow Achats
              </span>
              <span className="text-[10px] px-1 rounded bg-slate-800 text-slate-300">Ordres</span>
            </div>
            <div className="text-base font-bold font-mono text-sky-400">
              {monetary ? formatIsk(monetary.marketBuyEscrowIsk) : '—'}
            </div>
            <div className="text-[10px] text-slate-500">Bloqué en ordres d&apos;achat</div>
          </div>

          {/* Pillar 3: Stocks en Vente */}
          <div className="p-3.5 rounded-lg border border-slate-800/80 bg-slate-950/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1 text-slate-300">
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" /> Stocks en Vente
              </span>
              <span className="text-[10px] px-1 rounded bg-slate-800 text-slate-300">Revient</span>
            </div>
            <div className="text-base font-bold font-mono text-amber-300">
              {monetary ? formatIsk(monetary.notionalMarketAskValueIsk) : '—'}
            </div>
            <div className="text-[10px] text-slate-500">Marchandises en marché actif</div>
          </div>

          {/* Pillar 4: Stocks Libres en Hub */}
          <div className="p-3.5 rounded-lg border border-slate-800/80 bg-slate-950/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1 text-slate-300">
                <Package className="w-3.5 h-3.5 text-emerald-300" /> Coût Stocks Invendus
              </span>
              <span className="text-[10px] px-1 rounded bg-slate-800 text-slate-300">Hubs</span>
            </div>
            <div className="text-base font-bold font-mono text-slate-200">
              {monetary ? formatIsk(monetary.inventoryCostValueIsk) : '—'}
            </div>
            <div className="text-[10px] text-slate-500">Capital immobilisé stocks</div>
          </div>

          {/* Pillar 5: Stocks Dormants >30j */}
          <div
            onClick={() => onNavigateTab('positions', 'inventory')}
            className={`p-3.5 rounded-lg border transition-colors cursor-pointer space-y-1 ${
              (dormant?.dormantItemsCount ?? 0) > 0
                ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                : 'border-slate-800/80 bg-slate-950/60'
            }`}
            title="Cliquer pour voir les stocks dormants"
          >
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1 text-amber-400">
                <Clock className="w-3.5 h-3.5" /> Dormant &gt;30j
              </span>
              {(dormant?.dormantItemsCount ?? 0) > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300">
                  {dormant?.dormantItemsCount} lots
                </span>
              )}
            </div>
            <div className="text-base font-bold font-mono text-amber-400">
              {dormant ? formatIsk(dormant.dormantCostValueIsk) : '0.00 ISK'}
            </div>
            <div className="text-[10px] text-slate-400">Capital immobilisé inactif</div>
          </div>
        </div>
      </div>

      {/* 2. PERFORMANCE RÉALISÉE TTC DE LA PÉRIODE (Métriques Clés & Preuve) */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Scale className="w-4 h-4 text-emerald-400" />
              Performance Réalisée TTC (Période Active)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Rentabilité auditable et preuve arithmétique déduisant les taxes SCC et frais réels
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRoiProof(!showRoiProof)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              {showRoiProof ? 'Masquer Preuve' : 'Preuve Arithmétique'}
            </button>
            <button
              onClick={onAutoReconcile}
              disabled={isReconciling}
              className="px-3 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              {isReconciling ? 'Rapprochement...' : 'Rapprochement FIFO'}
            </button>
          </div>
        </div>

        {/* Proof Accordion if toggled */}
        {showRoiProof && (
          <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs space-y-2 font-mono text-slate-300 animate-in fade-in duration-150">
            <div className="font-bold text-amber-300 flex items-center gap-1.5">
              <Scale className="w-4 h-4" /> Formule Contractuelle du ROI TTC Réalisé (docs/METRICS.md) :
            </div>
            <div className="p-2.5 bg-slate-950/80 rounded border border-slate-800">
              <div className="text-emerald-300">
                Profit_TTC = CA_brut - Coût_achat_FIFO - Taxes_vente - Frais_courtage
              </div>
              <div className="text-sky-300 mt-1">
                ROI_TTC = (Profit_TTC / Investissement_alloué_TTC) × 100
              </div>
            </div>
            <div className="text-[11px] text-slate-400">
              • Taux de couverture des coûts : <strong className="text-slate-200">{roiSummary?.coverage_percent ?? 0}%</strong> ({roiSummary?.allocated_sales_volume ?? 0} unités réconciliées avec lots d&apos;achat).
            </div>
          </div>
        )}

        {/* Performance KPI Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* CA Brut */}
          <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" /> Chiffre d&apos;Affaires Brut (CA)
              </span>
              <span className="text-slate-500">{summary?.sellTransactionsCount ?? 0} v.</span>
            </div>
            <div className="text-base font-bold font-mono text-emerald-400">
              {summary ? formatIsk(summary.totalGrossSalesIsk) : '0.00 ISK'}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {summary ? `${summary.totalSellVolume.toLocaleString()} u. vendues` : '0 u.'}
            </div>
          </div>

          {/* Investissement Alloué */}
          <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <ArrowDownRight className="w-3.5 h-3.5 text-sky-400" /> Investissement Alloué
              </span>
              <span className="text-slate-500">TTC</span>
            </div>
            <div className="text-base font-bold font-mono text-sky-300">
              {roiSummary?.total_allocated_investment_ttc !== null && roiSummary?.total_allocated_investment_ttc !== undefined
                ? formatIsk(roiSummary.total_allocated_investment_ttc)
                : 'En attente'}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">Coût de revient d&apos;achat FIFO</div>
          </div>

          {/* Taxes & Frais */}
          <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Percent className="w-3.5 h-3.5 text-rose-400" /> Taxes &amp; Frais
              </span>
              <span className="text-slate-500">SCC / Courtage</span>
            </div>
            <div className="text-base font-bold font-mono text-rose-400">
              {formatIsk(totalFees)}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              Taxes: {formatIsk(summary?.totalTaxesIsk || 0)} · Frais: {formatIsk(summary?.totalBrokerFeesIsk || 0)}
            </div>
          </div>

          {/* Bénéfice Net Réalisé TTC */}
          <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-1">
            <div className="text-[11px] font-mono text-emerald-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> Bénéfice Réalisé (TTC)
              </span>
              {roiSummary?.roi_percent_ttc !== null && roiSummary?.roi_percent_ttc !== undefined && (
                <span className="text-[10px] font-bold font-mono px-1 rounded bg-emerald-500/20 text-emerald-300">
                  +{roiSummary.roi_percent_ttc.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="text-base font-bold font-mono text-emerald-300">
              {roiSummary?.realized_profit_ttc_isk !== null && roiSummary?.realized_profit_ttc_isk !== undefined
                ? formatIsk(roiSummary.realized_profit_ttc_isk)
                : 'En attente'}
            </div>
            <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between">
              <span>Couverture: {roiSummary?.coverage_percent ?? 0}%</span>
              <button
                onClick={() => onNavigateTab('transactions', 'reconciliation')}
                className="text-amber-400 hover:text-amber-300 underline cursor-pointer"
              >
                Gérer
              </button>
            </div>
          </div>

          {/* Cash Flow Net de Trésorerie */}
          <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 space-y-1">
            <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1 text-slate-300">
                <Coins className="w-3.5 h-3.5 text-amber-400" /> Cash-Flow Net
              </span>
              <span className="text-slate-500">Trésorerie</span>
            </div>
            <div
              className={`text-base font-bold font-mono ${
                netCashFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {formatIsk(netCashFlow)}
            </div>
            <div className="text-[10px] text-slate-500 font-mono">Encaissements - Décaissements</div>
          </div>
        </div>
      </div>

      {/* 3. DEUX COLONNES DÉCISIONNELLES : Alertes Prioritaires & Réassorts / Transferts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Colonne Gauche : Alertes Opérationnelles Prioritaires */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Alertes Opérationnelles Décisionnelles
              </h3>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {disappearedOrders.length + (dormant?.dormantItemsCount ? 1 : 0) + (pendingRestock.length > 0 ? 1 : 0)} alertes
              </span>
            </div>

            {/* Alerte 1: Ordres disparus sans transaction confirmée */}
            {disappearedOrders.length > 0 ? (
              <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    {disappearedOrders.length} ordre(s) disparu(s) non confirmé(s)
                  </span>
                  <button
                    onClick={() => onNavigateTab('positions', 'orders')}
                    className="text-amber-300 hover:text-amber-200 underline text-xs cursor-pointer"
                  >
                    Vérifier
                  </button>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Absents du snapshot ESI récent sans preuve de vente complète dans le journal. Classés en DISAPPEARED_UNCONFIRMED sans inventer de vente.
                </p>
              </div>
            ) : (
              <div className="p-3 rounded-lg border border-slate-800 bg-slate-950/40 text-xs text-slate-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                Tous les ordres de marché observés sont cohérents avec les snapshots ESI.
              </div>
            )}

            {/* Alerte 2: Lots dormants > 30 jours */}
            {(dormant?.dormantItemsCount ?? 0) > 0 && (
              <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-400" />
                    {dormant?.dormantItemsCount} lot(s) dormant(s) &gt; 30 jours
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                    Capital immobilisé : <span className="text-amber-300 font-bold">{formatIsk(dormant?.dormantCostValueIsk || 0)}</span>
                  </div>
                </div>
                <button
                  onClick={() => onNavigateTab('positions', 'inventory')}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors shrink-0"
                >
                  Inspecter
                </button>
              </div>
            )}

            {/* Active Market Orders summary */}
            <div className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 space-y-2">
              <div className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5 text-sky-400" />
                  Ordres de Marché Actifs ({orderSummary?.activeOrdersCount ?? 0})
                </span>
                <button
                  onClick={() => onNavigateTab('positions', 'orders')}
                  className="text-sky-400 hover:text-sky-300 text-xs flex items-center gap-0.5"
                >
                  Voir tous <ChevronRight className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 bg-slate-900 rounded border border-slate-800/80">
                  <span className="text-slate-400 text-[10px] block">Partiellement exécutés</span>
                  <span className="text-sky-300 font-bold">{orderSummary?.partiallyFilledCount ?? 0}</span>
                </div>
                <div className="p-2 bg-slate-900 rounded border border-slate-800/80">
                  <span className="text-slate-400 text-[10px] block">Valeur engagée (Active)</span>
                  <span className="text-amber-300 font-bold">{formatIsk(orderSummary?.totalActiveIskValue)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
            <button
              onClick={() => onNavigateTab('positions')}
              className="text-xs text-slate-300 hover:text-amber-300 font-medium flex items-center gap-1 transition-colors"
            >
              Accéder à l&apos;Espace Positions <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Colonne Droite : Réapprovisionnements & Transferts Urgents */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-emerald-400" />
                Réapprovisionnement &amp; Transferts Nets
              </h3>
              {pendingRestock.length > 0 && (
                <button
                  onClick={handleCopyMultibuy}
                  className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  title="Copier le format EVE Multibuy pour achat en jeu"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedMultibuy ? 'Copié !' : 'Copier Multibuy'}
                </button>
              )}
            </div>

            {/* Restock items dense mini table */}
            {pendingRestock.length === 0 ? (
              <div className="p-6 text-center border border-slate-800/80 rounded-lg bg-slate-950/40 text-xs text-slate-400 space-y-1">
                <div className="text-emerald-400 font-semibold">Tous les stocks sont à niveau</div>
                <p className="text-slate-500">Aucun besoin d&apos;achat ou transfert urgent détecté.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>{pendingRestock.length} article(s) à réassortir :</span>
                  <span className="text-slate-500 text-[11px] font-mono">
                    Budget estimé: {formatIsk(pendingRestock.reduce((acc, i) => acc + (i.suggestedQuantity * (i.estimatedBuyUnitPrice || 0)), 0))}
                  </span>
                </div>

                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {pendingRestock.slice(0, 4).map((item) => (
                    <div
                      key={item.id}
                      onClick={() => (onOpenProduct360 ? onOpenProduct360(item.typeId) : onNavigateTab('operations'))}
                      className="p-2.5 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 flex items-center justify-between text-xs cursor-pointer transition-colors group"
                      title="Cliquer pour inspecter la fiche Product 360"
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-medium text-slate-200 group-hover:text-amber-300 truncate">
                          {item.typeName}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          Hub : {item.sellHubName?.split(' - ')[0] || item.targetBuyHubName?.split(' - ')[0] || 'Hub principal'} · Besoin : {item.suggestedQuantity.toLocaleString()} u.
                        </div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <div className="text-amber-300 font-bold">
                          {formatIsk(item.suggestedQuantity * (item.estimatedBuyUnitPrice || 0))}
                        </div>
                        <div className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 inline-block">
                          {item.status || 'SUGGESTED'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-800/60 flex items-center justify-between">
            <button
              onClick={() => onNavigateTab('operations')}
              className="text-xs text-slate-300 hover:text-amber-300 font-medium flex items-center gap-1 transition-colors"
            >
              Gérer dans l&apos;Espace Opérations <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              Actualiser ESI
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
