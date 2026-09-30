import React from 'react';
import { X, Settings, Check } from 'lucide-react';
import { UserPreferences } from '../utils/preferences';

interface PreferencesModalProps {
  preferences: UserPreferences;
  onSave: (updated: Partial<UserPreferences>) => void;
  onClose: () => void;
}

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  preferences,
  onSave,
  onClose,
}) => {
  const [form, setForm] = React.useState<UserPreferences>({ ...preferences });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Settings className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">Préférences Utilisateur &amp; Affichage</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="text-slate-300 font-medium">Vue de Démarrage par Défaut</label>
            <select
              value={form.defaultLandingTab}
              onChange={(e) =>
                setForm({
                  ...form,
                  defaultLandingTab: e.target.value as UserPreferences['defaultLandingTab'],
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
            >
              <option value="overview">Vue d&apos;Ensemble (Tableau de Bord Central)</option>
              <option value="ledger">Grand Livre des Ventes &amp; Achats</option>
              <option value="orders">Ordres de Marché &amp; Cycle de Vie</option>
              <option value="restock">Listes de Réapprovisionnement</option>
              <option value="hubs-roi">Hubs &amp; Rentabilité ROI TTC</option>
              <option value="capital">Capital &amp; Stocks (Positions &amp; Dormant)</option>
              <option value="journal">Journal de Portefeuille &amp; Frais</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-slate-300 font-medium">Format d&apos;Affichage des Montants ISK</label>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setForm({ ...form, iskDisplayMode: 'full' })}
                className={`p-2.5 rounded-lg border text-left transition-colors ${
                  form.iskDisplayMode === 'full'
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-xs">Complet (Précis)</div>
                <div className="text-[11px] font-mono text-slate-400">1 450 000,00 ISK</div>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, iskDisplayMode: 'compact' })}
                className={`p-2.5 rounded-lg border text-left transition-colors ${
                  form.iskDisplayMode === 'compact'
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-xs">Condensé (K / M / B)</div>
                <div className="text-[11px] font-mono text-slate-400">1.45 M ISK</div>
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.hideCompletedOrders}
                onChange={(e) => setForm({ ...form, hideCompletedOrders: e.target.checked })}
                className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-0 w-4 h-4"
              />
              <span className="text-slate-300 text-xs">
                Masquer les ordres complétés et expirés dans la vue Ordres
              </span>
            </label>
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 shadow"
            >
              <Check className="w-3.5 h-3.5" /> Enregistrer les Préférences
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
