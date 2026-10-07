import React, { useState } from 'react';
import { Upload, X, Shield, Key, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { fetchJson } from '../utils/apiClient';

interface ImportFleetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (sessionId: string, count: number) => void;
}

export const ImportFleetModal: React.FC<ImportFleetModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [importPassword, setImportPassword] = useState('');
  const [importFileData, setImportFileData] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setFeedback(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportFileData(content || '');
    };
    reader.readAsText(file);
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFileData) {
      setFeedback({
        type: 'error',
        text: 'Veuillez sélectionner un fichier .enc valide ou coller son contenu chiffré.',
      });
      return;
    }
    if (!importPassword) {
      setFeedback({
        type: 'error',
        text: 'Veuillez saisir le mot de passe de déchiffrement de votre trousseau.',
      });
      return;
    }

    setIsLoading(true);
    setFeedback(null);
    try {
      const res = await fetchJson<{
        success: boolean;
        sessionId: string;
        restoredCharacters: number;
      }>('/api/auth/fleet/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedData: importFileData.trim(),
          password: importPassword,
        }),
      });

      setImportPassword('');
      setImportFileData('');
      setImportFileName('');
      setFeedback({
        type: 'success',
        text: `Flotte restaurée avec succès ! ${res.restoredCharacters} personnage(s) validé(s) auprès de CCP EVE Online.`,
      });
      onSuccess(res.sessionId, res.restoredCharacters);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Échec de l'importation du trousseau";
      setFeedback({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5 text-amber-400 font-semibold text-base">
            <Upload className="w-5 h-5" />
            <h3>Restaurer un trousseau de flotte (.enc)</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Injectez votre fichier de secours de flotte chiffré (<code className="text-amber-300">eve-fleet-backup.enc</code>).
          Le serveur déchiffrera les refresh tokens en mémoire et vérifiera silencieusement leur validité auprès de CCP pour réactiver l&apos;ensemble de vos personnages en un clic.
        </p>

        {feedback && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
              feedback.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                : 'border-rose-500/40 bg-rose-950/30 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <form onSubmit={handleImport} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Fichier chiffré (.enc)</span>
              {importFileName && <span className="font-mono text-[11px] text-amber-400">{importFileName}</span>}
            </label>
            <input
              type="file"
              accept=".enc,text/plain"
              onChange={handleFileSelect}
              className="w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              Mot de passe du trousseau
            </label>
            <input
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              placeholder="Mot de passe utilisé lors de l'export"
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isLoading || !importFileData || !importPassword}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md hover:shadow-amber-500/20"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Restauration &amp; Validation CCP...
                </>
              ) : (
                <>
                  <Shield className="w-3.5 h-3.5" />
                  Restaurer la flotte
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
