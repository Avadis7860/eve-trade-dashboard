import React from 'react';
import { Percent, Info } from 'lucide-react';
import { CharacterWalletJournalEntry } from '../App';
import { formatIskValue } from '../utils/preferences';

interface JournalViewProps {
  journalEntries: CharacterWalletJournalEntry[];
  iskDisplayMode: 'full' | 'compact';
}

export const JournalView: React.FC<JournalViewProps> = ({
  journalEntries,
  iskDisplayMode,
}) => {
  const formatIsk = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return formatIskValue(val, iskDisplayMode);
  };

  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Percent className="w-4 h-4 text-rose-400" />
            Journal de Portefeuille &amp; Frais ESI
          </h3>
          <p className="text-xs text-slate-400">
            Détail des écritures du journal de portefeuille, taxes de vente SCC (transaction_tax) et commissions de courtage (brokers_fee).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 font-mono text-slate-400">
                <th className="py-3 px-4">Date (UTC)</th>
                <th className="py-3 px-4">Type de Référence</th>
                <th className="py-3 px-4 text-right">Montant</th>
                <th className="py-3 px-4 text-right">Solde Après</th>
                <th className="py-3 px-4 text-right">Taxe Associée</th>
                <th className="py-3 px-4">Description / Contexte</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {journalEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 space-y-2">
                    <Info className="w-8 h-8 text-slate-600 mx-auto" />
                    <div className="text-sm font-medium">Aucune entrée de journal disponible</div>
                    <div className="text-xs text-slate-500">
                      Synchronisez vos données pour charger les dernières écritures de portefeuille.
                    </div>
                  </td>
                </tr>
              ) : (
                journalEntries.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-800/40 transition-colors font-mono">
                    <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                      {new Date(j.date).toLocaleDateString('fr-FR')}{' '}
                      {new Date(j.date).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[11px]">
                        {j.refType}
                      </span>
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-bold ${
                        j.amount !== undefined && j.amount < 0
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {j.amount !== undefined ? formatIsk(j.amount) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400">
                      {j.balance !== undefined ? formatIsk(j.balance) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-rose-300">
                      {j.tax !== undefined && j.tax > 0 ? formatIsk(j.tax) : '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-300 max-w-xs truncate" title={j.description}>
                      {j.description || (j.contextId ? `Context #${j.contextId}` : '—')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
