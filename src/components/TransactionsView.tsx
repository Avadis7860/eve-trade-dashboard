import React, { useState } from 'react';
import {
  FileText,
  BookOpen,
  Scale,
  Sparkles,
} from 'lucide-react';
import { LedgerView } from './LedgerView';
import { JournalView } from './JournalView';
import { TransactionDetailDrawer } from './drawers/TransactionDetailDrawer';
import { CharacterTransaction, CharacterWalletJournalEntry } from '../App';

export interface LedgerSummaryData {
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

interface TransactionsViewProps {
  transactions: CharacterTransaction[];
  ledgerSummary: LedgerSummaryData | null;
  loadingLedger: boolean;
  ledgerPage: number;
  ledgerTotalPages: number;
  ledgerTotalCount: number;
  filterType: 'ALL' | 'SELL' | 'BUY';
  searchQuery: string;
  selectedLocation: string;
  distinctLocations: { id: number; name: string; count: number }[];
  iskDisplayMode: 'full' | 'compact';
  onFilterTypeChange: (type: 'ALL' | 'SELL' | 'BUY') => void;
  onSearchChange: (search: string) => void;
  onLocationChange: (loc: string) => void;
  onPageChange: (page: number) => void;
  onInspectTransaction?: (tx: CharacterTransaction) => void;
  onQuickAllocate?: (tx: CharacterTransaction) => void;
  onOpenProduct360?: (typeId: number) => void;
  journalEntries: CharacterWalletJournalEntry[];
  loadingJournal: boolean;
  journalPage: number;
  journalTotalPages: number;
  journalTotalCount: number;
  journalRefTypeFilter: string;
  distinctJournalRefTypes: string[];
  onJournalRefTypeChange: (refType: string) => void;
  onJournalPageChange: (page: number) => void;
  onAutoReconcile: () => void;
  isReconciling: boolean;
  formatIsk: (val: number | null | undefined) => string;
  initialSubTab?: 'ledger' | 'journal' | 'reconciliation';
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  transactions,
  ledgerSummary,
  loadingLedger,
  ledgerPage,
  ledgerTotalPages,
  ledgerTotalCount,
  filterType,
  searchQuery,
  selectedLocation,
  distinctLocations,
  iskDisplayMode,
  onFilterTypeChange,
  onSearchChange,
  onLocationChange,
  onPageChange,
  onQuickAllocate,
  onOpenProduct360,
  journalEntries,
  loadingJournal: _loadingJournal,
  journalPage: _journalPage,
  journalTotalPages: _journalTotalPages,
  journalTotalCount,
  journalRefTypeFilter: _journalRefTypeFilter,
  distinctJournalRefTypes: _distinctJournalRefTypes,
  onJournalRefTypeChange: _onJournalRefTypeChange,
  onJournalPageChange: _onJournalPageChange,
  onAutoReconcile,
  isReconciling,
  formatIsk,
  initialSubTab = 'ledger',
}) => {
  const [subTab, setSubTab] = useState<'ledger' | 'journal' | 'reconciliation'>(initialSubTab);
  const [selectedTx, setSelectedTx] = useState<CharacterTransaction | null>(null);

  return (
    <div className="space-y-6">
      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2 bg-slate-900/60 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setSubTab('ledger')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'ledger'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Grand Livre des Ventes &amp; Achats ({ledgerTotalCount})
          </button>
          <button
            onClick={() => setSubTab('journal')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'journal'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Journal de Portefeuille &amp; Frais ({journalTotalCount})
          </button>
          <button
            onClick={() => setSubTab('reconciliation')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'reconciliation'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Rapprochement &amp; Stocks d&apos;Ouverture
          </button>
        </div>

        {subTab === 'reconciliation' && (
          <button
            onClick={onAutoReconcile}
            disabled={isReconciling}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isReconciling ? 'Rapprochement en cours...' : 'Déclencher Rapprochement FIFO'}
          </button>
        )}
      </div>

      {/* SUB-TAB 1: GRAND LIVRE */}
      {subTab === 'ledger' && (
        <LedgerView
          transactions={transactions}
          summary={ledgerSummary}
          loading={loadingLedger}
          page={ledgerPage}
          totalPages={ledgerTotalPages}
          totalCount={ledgerTotalCount}
          filterType={filterType}
          searchQuery={searchQuery}
          selectedLocation={selectedLocation}
          distinctLocations={distinctLocations}
          iskDisplayMode={iskDisplayMode}
          onFilterTypeChange={onFilterTypeChange}
          onSearchChange={onSearchChange}
          onLocationChange={onLocationChange}
          onPageChange={onPageChange}
          onInspectTransaction={(tx) => setSelectedTx(tx)}
          onQuickAllocate={onQuickAllocate}
          onOpenProduct360={onOpenProduct360}
        />
      )}

      {/* SUB-TAB 2: JOURNAL DE PORTEFEUILLE */}
      {subTab === 'journal' && (
        <JournalView
          journalEntries={journalEntries}
          iskDisplayMode={iskDisplayMode}
        />
      )}

      {/* SUB-TAB 3: RAPPROCHEMENT & STOCKS D'OUVERTURE */}
      {subTab === 'reconciliation' && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Scale className="w-4 h-4 text-emerald-400" />
                  Audit du Moteur de Rapprochement Chronologique FIFO (Phase 08)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Les ventes sont réconciliées par matching FIFO strict sur les achats antérieurs et les stocks d&apos;ouverture vérifiés.
                </p>
              </div>
              <button
                onClick={onAutoReconcile}
                disabled={isReconciling}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {isReconciling ? 'Rapprochement FIFO...' : 'Exécuter Rapprochement FIFO'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="text-[11px] text-slate-400 font-mono">Principe FIFO Strict</div>
                <div className="text-xs text-slate-200 mt-1">
                  Pas de coût moyen implicite. Chaque lot vendu est adossé à son lot d&apos;acquisition exact.
                </div>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="text-[11px] text-slate-400 font-mono">TTC &amp; Frais Réels</div>
                <div className="text-xs text-slate-200 mt-1">
                  Déduction exacte des taxes SCC et frais de courtage sans double comptage.
                </div>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="text-[11px] text-slate-400 font-mono">Vérité des États</div>
                <div className="text-xs text-slate-200 mt-1">
                  Les ventes sans achat connu restent en statut UNKNOWN ou PARTIAL sans supposer un coût à 0.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contextual Side Drawer for Transaction Inspection & Proof */}
      <TransactionDetailDrawer
        isOpen={Boolean(selectedTx)}
        onClose={() => setSelectedTx(null)}
        transaction={selectedTx}
        onOpenProduct360={onOpenProduct360}
        formatIsk={formatIsk}
      />
    </div>
  );
};
