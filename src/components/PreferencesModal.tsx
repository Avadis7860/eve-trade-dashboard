import React, { useState, useEffect } from 'react';
import { X, Settings, Check, Wallet, Building2, User, AlertTriangle } from 'lucide-react';
import { UserPreferences, formatIskValue } from '../utils/preferences';
import type { WalletBalanceSnapshot } from '../server/capital/types';
import { fetchJson } from '../utils/apiClient';

interface PreferencesModalProps {
  preferences: UserPreferences;
  characters?: Array<{ characterId: number; characterName: string }>;
  onSave: (updated: Partial<UserPreferences>) => void;
  onClose: () => void;
}

export const PreferencesModal: React.FC<PreferencesModalProps> = ({
  preferences,
  characters = [],
  onSave,
  onClose,
}) => {
  const [form, setForm] = useState<UserPreferences>({
    ...preferences,
    walletSyncMode: preferences.walletSyncMode || 'BOTH',
    excludedCharacterWalletIds: preferences.excludedCharacterWalletIds || [],
    includedCorporationWallets: preferences.includedCorporationWallets || [],
  });

  const [wallets, setWallets] = useState<WalletBalanceSnapshot[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoadingWallets(true);
    fetchJson<{ wallets: WalletBalanceSnapshot[] }>('/api/capital/wallets')
      .then((data) => {
        if (isMounted && data?.wallets) {
          setWallets(data.wallets);
        }
      })
      .catch(() => {
        // Fallback gracefully if API not ready
      })
      .finally(() => {
        if (isMounted) setLoadingWallets(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    onClose();
  };

  const handleToggleCharacter = (charId: number) => {
    const current = form.excludedCharacterWalletIds || [];
    const isExcluded = current.includes(charId);
    const updated = isExcluded
      ? current.filter((id) => id !== charId)
      : [...current, charId];
    setForm({ ...form, excludedCharacterWalletIds: updated });
  };

  const handleToggleCorpDivision = (key: string) => {
    const current = form.includedCorporationWallets || [];
    const isIncluded = current.includes(key);
    let updated: string[];

    if (current.length === 0) {
      // If currently all included by default, unchecking one means including all others except this one
      const allCorpKeys = wallets
        .filter((w) => w.type === 'CORPORATION')
        .map((w) => `${w.corporationId}:${w.division}`);
      updated = allCorpKeys.filter((k) => k !== key);
    } else {
      updated = isIncluded
        ? current.filter((k) => k !== key)
        : [...current, key];
    }

    setForm({ ...form, includedCorporationWallets: updated });
  };

  // Group wallets by character & corp
  const charWallets = wallets.filter((w) => w.type === 'CHARACTER');
  const corpWallets = wallets.filter((w) => w.type === 'CORPORATION');

  // Build complete list of characters to display
  const allCharacters = [...characters];
  for (const cw of charWallets) {
    if (cw.characterId && !allCharacters.some((c) => c.characterId === cw.characterId)) {
      allCharacters.push({ characterId: cw.characterId, characterName: cw.characterName || `Pilot #${cw.characterId}` });
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full p-6 space-y-5 shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Settings className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">Préférences Utilisateur &amp; Affichage (Portefeuilles)</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* General Preferences */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <option value="overview">Vue d&apos;Ensemble (Tableau de Bord)</option>
                <option value="ledger">Grand Livre des Ventes &amp; Achats</option>
                <option value="orders">Ordres de Marché &amp; Cycle de Vie</option>
                <option value="restock">Listes de Réapprovisionnement</option>
                <option value="hubs-roi">Hubs &amp; Rentabilité ROI TTC</option>
                <option value="capital">Capital &amp; Stocks (Positions &amp; Wallets)</option>
                <option value="journal">Journal de Portefeuille &amp; Frais</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-300 font-medium">Format d&apos;Affichage ISK</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, iskDisplayMode: 'full' })}
                  className={`p-2 rounded-lg border text-left transition-colors ${
                    form.iskDisplayMode === 'full'
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-semibold text-[11px]">Complet</div>
                  <div className="text-[10px] font-mono text-slate-400">1 450 000 ISK</div>
                </button>

                <button
                  type="button"
                  onClick={() => setForm({ ...form, iskDisplayMode: 'compact' })}
                  className={`p-2 rounded-lg border text-left transition-colors ${
                    form.iskDisplayMode === 'compact'
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="font-semibold text-[11px]">Condensé</div>
                  <div className="text-[10px] font-mono text-slate-400">1.45 M ISK</div>
                </button>
              </div>
            </div>
          </div>

          {/* Phase 10.bis: Wallet Sync & Accounting Mode */}
          <div className="pt-3 border-t border-slate-800 space-y-2">
            <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-xs">
              <Wallet className="w-4 h-4 text-emerald-400" />
              <span>Périmètre des Liquidités &amp; Synchronisation des Portefeuilles</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Choisissez quelles sources de soldes réels ESI alimentent les liquidités disponibles et le Capital Net Réel.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <label
                className={`p-2.5 rounded-lg border cursor-pointer flex flex-col justify-between transition-colors ${
                  form.walletSyncMode === 'BOTH'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="walletSyncMode"
                    value="BOTH"
                    checked={form.walletSyncMode === 'BOTH'}
                    onChange={() => setForm({ ...form, walletSyncMode: 'BOTH' })}
                    className="text-emerald-500 focus:ring-0"
                  />
                  <span className="font-semibold text-[11px]">Tous Portefeuilles</span>
                </div>
                <span className="text-[10px] text-slate-400 mt-1">Personnages &amp; Corporation</span>
              </label>

              <label
                className={`p-2.5 rounded-lg border cursor-pointer flex flex-col justify-between transition-colors ${
                  form.walletSyncMode === 'CHARACTERS_ONLY'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="walletSyncMode"
                    value="CHARACTERS_ONLY"
                    checked={form.walletSyncMode === 'CHARACTERS_ONLY'}
                    onChange={() => setForm({ ...form, walletSyncMode: 'CHARACTERS_ONLY' })}
                    className="text-emerald-500 focus:ring-0"
                  />
                  <span className="font-semibold text-[11px]">Personnages Seuls</span>
                </div>
                <span className="text-[10px] text-slate-400 mt-1">Ignore les divisions corpo</span>
              </label>

              <label
                className={`p-2.5 rounded-lg border cursor-pointer flex flex-col justify-between transition-colors ${
                  form.walletSyncMode === 'CORPORATION_ONLY'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="walletSyncMode"
                    value="CORPORATION_ONLY"
                    checked={form.walletSyncMode === 'CORPORATION_ONLY'}
                    onChange={() => setForm({ ...form, walletSyncMode: 'CORPORATION_ONLY' })}
                    className="text-emerald-500 focus:ring-0"
                  />
                  <span className="font-semibold text-[11px]">Corporation Seule</span>
                </div>
                <span className="text-[10px] text-slate-400 mt-1">Ignore les soldes persos</span>
              </label>
            </div>
          </div>

          {/* Granular Character Wallets Selection */}
          {form.walletSyncMode !== 'CORPORATION_ONLY' && (
            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-medium flex items-center gap-1.5 text-xs">
                  <User className="w-3.5 h-3.5 text-sky-400" />
                  Sélection des Portefeuilles Personnels
                </span>
                <span className="text-[10px] text-slate-500">
                  Décocher pour exclure du capital (ex. personnage endetté)
                </span>
              </div>

              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {allCharacters.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic p-2 bg-slate-950 rounded">
                    Aucun personnage connecté dans cette session.
                  </div>
                ) : (
                  allCharacters.map((char) => {
                    const snap = charWallets.find((w) => w.characterId === char.characterId);
                    const isExcluded = form.excludedCharacterWalletIds?.includes(char.characterId);
                    const isIndebted = snap && snap.balance < 0;

                    return (
                      <label
                        key={char.characterId}
                        className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                          !isExcluded
                            ? 'border-slate-800 bg-slate-950 text-slate-200'
                            : 'border-slate-900 bg-slate-950/40 text-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!isExcluded}
                            onChange={() => handleToggleCharacter(char.characterId)}
                            className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
                          />
                          <span className="font-medium text-xs">{char.characterName}</span>
                          {isIndebted && (
                            <span className="flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30">
                              <AlertTriangle className="w-2.5 h-2.5" /> Solde Négatif / Dette
                            </span>
                          )}
                        </div>

                        {snap && (
                          <span
                            className={`font-mono text-[11px] ${
                              isIndebted ? 'text-rose-400 font-semibold' : 'text-emerald-400'
                            }`}
                          >
                            {formatIskValue(snap.balance, form.iskDisplayMode)}
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Granular Corporation Divisions Selection */}
          {form.walletSyncMode !== 'CHARACTERS_ONLY' && (
            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-medium flex items-center gap-1.5 text-xs">
                  <Building2 className="w-3.5 h-3.5 text-amber-400" />
                  Divisions de Portefeuille Corporation (1 à 7)
                </span>
                <span className="text-[10px] text-slate-500">
                  Dédupliqué par corporation et division
                </span>
              </div>

              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {corpWallets.length === 0 ? (
                  <div className="text-[11px] text-slate-500 italic p-2 bg-slate-950 rounded">
                    {loadingWallets
                      ? 'Chargement des divisions de corporation...'
                      : 'Aucune division corpo synchronisée (rôles de corporation requis).'}
                  </div>
                ) : (
                  corpWallets.map((cw) => {
                    const key = `${cw.corporationId}:${cw.division}`;
                    const isIncluded =
                      form.includedCorporationWallets && form.includedCorporationWallets.length > 0
                        ? form.includedCorporationWallets.includes(key)
                        : true;

                    return (
                      <label
                        key={cw.id}
                        className={`flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-colors ${
                          isIncluded
                            ? 'border-slate-800 bg-slate-950 text-slate-200'
                            : 'border-slate-900 bg-slate-950/40 text-slate-500'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isIncluded}
                            onChange={() => handleToggleCorpDivision(key)}
                            className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
                          />
                          <div>
                            <span className="font-medium text-xs">
                              Division {cw.division} — {cw.divisionName || 'Portefeuille'}
                            </span>
                            {cw.corporationName && (
                              <span className="text-[10px] text-slate-500 ml-1.5">
                                ({cw.corporationName})
                              </span>
                            )}
                          </div>
                        </div>

                        <span className="font-mono text-[11px] text-emerald-400">
                          {formatIskValue(cw.balance, form.iskDisplayMode)}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Orders Filter */}
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

          {/* Actions */}
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
