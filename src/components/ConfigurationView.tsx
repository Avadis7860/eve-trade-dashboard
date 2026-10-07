import React, { useState } from 'react';
import {
  Users,
  Building2,
  Activity,
  Compass,
  UserPlus,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  Shield,
  Download,
  Upload,
  X,
  AlertTriangle,
} from 'lucide-react';
import {
  CharacterSession,
  HubDefinition,
  HubLocationMapping,
  HealthStatus,
  EsiStatusResponse,
} from '../App';
import { fetchJson, useQueryClient } from '../utils/apiClient';
import { SystemRoadmapView } from './SystemRoadmapView';

interface ConfigurationViewProps {
  session: CharacterSession | null;
  linkedCharacters: CharacterSession[];
  activeCharacterId?: number;
  onSwitchCharacter: (characterId: number) => void;
  onLogout?: () => void;
  onLinkCharacter?: () => void;
  hubsList: HubDefinition[];
  hubsMappings: HubLocationMapping[];
  onOpenAddHubModal: () => void;
  onDeleteHub: (id: string) => void;
  onOpenAddMappingModal: () => void;
  onDeleteMapping: (locationId: number) => void;
  onAutoDiscoverHubs: () => void;
  healthStatus: HealthStatus | null;
  esiStatus: EsiStatusResponse | null;
  onSync: () => void;
  isSyncing: boolean;
  initialSubTab?: 'characters' | 'hubs' | 'backups' | 'diagnostics' | 'roadmap';
}

export const ConfigurationView: React.FC<ConfigurationViewProps> = ({
  session,
  linkedCharacters,
  activeCharacterId,
  onSwitchCharacter,
  onLinkCharacter,
  hubsList,
  hubsMappings,
  onOpenAddHubModal,
  onDeleteHub,
  onOpenAddMappingModal,
  onDeleteMapping,
  onAutoDiscoverHubs,
  healthStatus,
  esiStatus,
  onSync,
  isSyncing,
  initialSubTab = 'characters',
}) => {
  const [subTab, setSubTab] = useState<'characters' | 'hubs' | 'backups' | 'diagnostics' | 'roadmap'>(initialSubTab);

  const queryClient = useQueryClient();
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportConfirmPassword, setExportConfirmPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importFileData, setImportFileData] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [keychainFeedback, setKeychainFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isKeychainLoading, setIsKeychainLoading] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  const handleLinkClick = async () => {
    if (onLinkCharacter) {
      onLinkCharacter();
      return;
    }
    if (isLinking) return;
    setIsLinking(true);
    try {
      const data = await fetchJson<{ url: string }>('/api/auth/login?format=json');
      if (data?.url) {
        const width = 640;
        const height = 760;
        const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
        const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
        const popup = window.open(
          data.url,
          'eve_sso_popup',
          `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no`
        );
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          window.open(data.url, '_blank', 'noopener,noreferrer');
        }
      }
    } catch (err) {
      console.error('Failed to start EVE login:', err);
    } finally {
      setIsLinking(false);
    }
  };

  const handleExportFleet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportPassword || exportPassword.length < 4) {
      setKeychainFeedback({ type: 'error', text: 'Le mot de passe doit comporter au moins 4 caractères.' });
      return;
    }
    if (exportPassword !== exportConfirmPassword) {
      setKeychainFeedback({ type: 'error', text: 'Les deux mots de passe ne correspondent pas.' });
      return;
    }

    setIsKeychainLoading(true);
    setKeychainFeedback(null);
    try {
      const res = await fetchJson<{ success: boolean; filename: string; encryptedData: string; fleetCount: number }>(
        '/api/auth/fleet/export',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: exportPassword }),
        }
      );

      const blob = new Blob([res.encryptedData], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || 'eve-fleet-backup.enc';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportPassword('');
      setExportConfirmPassword('');
      setShowExportModal(false);
      setKeychainFeedback({
        type: 'success',
        text: `Trousseau de flotte exporté avec succès (${res.fleetCount} personnage(s)). Conservez ce fichier et votre mot de passe en lieu sûr !`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur lors de l'export du trousseau";
      setKeychainFeedback({ type: 'error', text: msg });
    } finally {
      setIsKeychainLoading(false);
    }
  };

  const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setImportFileData(content || '');
    };
    reader.readAsText(file);
  };

  const handleImportFleet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFileData) {
      setKeychainFeedback({ type: 'error', text: 'Veuillez sélectionner un fichier .enc valide ou coller son contenu chiffré.' });
      return;
    }
    if (!importPassword) {
      setKeychainFeedback({ type: 'error', text: 'Veuillez saisir le mot de passe de déchiffrement.' });
      return;
    }

    setIsKeychainLoading(true);
    setKeychainFeedback(null);
    try {
      const res = await fetchJson<{ success: boolean; restoredCharacters: number }>(
        '/api/auth/fleet/import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            encryptedData: importFileData.trim(),
            password: importPassword,
          }),
        }
      );

      setImportPassword('');
      setImportFileData('');
      setImportFileName('');
      setShowImportModal(false);
      setKeychainFeedback({
        type: 'success',
        text: `Flotte restaurée avec succès ! ${res.restoredCharacters} personnage(s) validé(s) auprès de CCP.`,
      });
      queryClient.invalidateQueries(['auth']);
      queryClient.invalidateQueries(['ledger']);
      queryClient.invalidateQueries(['orders']);
      queryClient.invalidateQueries(['capital']);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Échec de l'import du trousseau";
      setKeychainFeedback({ type: 'error', text: msg });
    } finally {
      setIsKeychainLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2 bg-slate-900/60 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSubTab('characters')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'characters'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Personnages SSO ({linkedCharacters.length})
          </button>
          <button
            onClick={() => setSubTab('hubs')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'hubs'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Hubs &amp; Mappings ({hubsList.length})
          </button>
          <button
            onClick={() => setSubTab('diagnostics')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'diagnostics'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Diagnostic ESI &amp; Serveur
          </button>
          <button
            onClick={() => setSubTab('roadmap')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              subTab === 'roadmap'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            Système &amp; Masterplan
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: PERSONNAGES SSO */}
      {subTab === 'characters' && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Users className="w-4 h-4 text-amber-400" />
                  Écosystème Multi-Personnages EVE Online (SSO)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Gérez vos comptes et personnages liés. Les jetons OAuth et tokens d&apos;accès restent côté serveur.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLinkClick}
                disabled={isLinking}
                className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {isLinking ? 'Connexion en cours...' : 'Lier un Autre Personnage'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
              {linkedCharacters.map((char) => {
                const isActive = char.characterId === (activeCharacterId || session?.characterId);
                return (
                  <div
                    key={char.characterId}
                    className={`p-4 rounded-xl border transition-all ${
                      isActive
                        ? 'border-amber-500/50 bg-amber-500/5 shadow-xs'
                        : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={char.portraitUrl}
                        alt={char.characterName}
                        className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-700 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-100 truncate text-sm">
                          {char.characterName}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          ID: #{char.characterId}
                        </div>
                        {isActive && (
                          <span className="inline-block px-2 py-0.5 mt-1 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            PERSONNAGE ACTIF
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-mono">
                        {char.scopes?.length || 0} scopes ESI
                      </span>
                      {!isActive && (
                        <button
                          onClick={() => onSwitchCharacter(char.characterId)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                        >
                          Basculer vers ce perso
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FLEET KEYCHAIN BACKUP & RESTORE */}
            <div className="mt-6 p-5 rounded-xl border border-slate-800 bg-slate-950/80 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Trousseau de Flotte Sécurisé (Procédure de Secours &amp; Export Chiffré)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Sauvegardez l&apos;intégralité de vos {linkedCharacters.length} personnages et jetons d&apos;accès dans un fichier chiffré AES-256-GCM (PBKDF2). En cas de redéploiement ou changement d&apos;environnement, restaurez votre flotte en 1 clic.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setKeychainFeedback(null); setShowExportModal(true); }}
                    disabled={linkedCharacters.length === 0}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Exporter le Trousseau (.enc)
                  </button>
                  <button
                    onClick={() => { setKeychainFeedback(null); setShowImportModal(true); }}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow border border-slate-700"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Importer un Trousseau
                  </button>
                </div>
              </div>

              {keychainFeedback && (
                <div
                  className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                    keychainFeedback.type === 'success'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  }`}
                >
                  {keychainFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span>{keychainFeedback.text}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: HUBS COMMERCIAUX & MAPPINGS */}
      {subTab === 'hubs' && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-400" />
                  Hubs Commerciaux Définis
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Hubs d&apos;approvisionnement et de vente configurés pour le regroupement géographique.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onAutoDiscoverHubs}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Auto-Découvrir Hubs
                </button>
                <button
                  onClick={onOpenAddHubModal}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter un Hub
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {hubsList.map((hub) => (
                <div
                  key={hub.id}
                  className="p-3.5 rounded-lg border border-slate-800 bg-slate-950/60 flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-slate-200 text-xs">{hub.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      Type: {hub.is_system_default ? 'Standard CCP' : 'Personnalisé'}
                    </div>
                  </div>
                  {!hub.is_system_default && (
                    <button
                      onClick={() => onDeleteHub(hub.id)}
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition-colors cursor-pointer"
                      title="Supprimer ce hub"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Mappings Table */}
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-sky-400" />
                  Mappings Emplacements $\to$ Hubs ({hubsMappings.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Règles d&apos;affectation des stations PNJ et structures citadelles vers les hubs de reporting.
                </p>
              </div>
              <button
                onClick={onOpenAddMappingModal}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Associer un Emplacement
              </button>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950 font-mono text-[10px] text-slate-400 uppercase">
                    <th className="p-2.5">ID Emplacement</th>
                    <th className="p-2.5">Nom de Station / Structure</th>
                    <th className="p-2.5">Hub Assigné</th>
                    <th className="p-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {hubsMappings.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-slate-500 italic">
                        Aucun mapping configuré. Utilisez &quot;Auto-Découvrir Hubs&quot; pour les créer automatiquement.
                      </td>
                    </tr>
                  ) : (
                    hubsMappings.map((m) => (
                      <tr key={m.location_id} className="hover:bg-slate-900/40">
                        <td className="p-2.5 text-slate-400">#{m.location_id}</td>
                        <td className="p-2.5 text-slate-200 font-sans">{m.location_name || `Location #${m.location_id}`}</td>
                        <td className="p-2.5 text-emerald-300 font-semibold">{m.hub_id}</td>
                        <td className="p-2.5 text-right font-sans">
                          <button
                            onClick={() => onDeleteMapping(m.location_id)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                            title="Supprimer cette association"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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

      {/* SUB-TAB 3: DIAGNOSTIC ESI & SERVEUR */}
      {subTab === 'diagnostics' && (
        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-sky-400" />
                Passerelle ESI &amp; Résilience Réseau
              </h3>
              <button
                onClick={onSync}
                disabled={isSyncing}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Synchro...' : 'Actualiser Statut'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[11px] font-mono text-slate-400">Budget d&apos;erreurs ESI (CCP)</div>
                <div className="text-xl font-bold font-mono text-emerald-400">
                  {esiStatus?.rateLimit.errorLimitRemain ?? 100} / 100
                </div>
                <div className="text-[10px] text-slate-500">Reset: {esiStatus?.rateLimit.errorLimitResetSeconds ?? 0}s</div>
              </div>

              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[11px] font-mono text-slate-400">Entrées de Cache HTTP 304</div>
                <div className="text-xl font-bold font-mono text-amber-300">
                  {esiStatus?.cacheSize ?? 0} clés
                </div>
                <div className="text-[10px] text-slate-500">Optimisation bande passante ESI</div>
              </div>

              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="text-[11px] font-mono text-slate-400">Santé Serveur Backend</div>
                <div className="text-xl font-bold font-mono text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> OK
                </div>
                <div className="text-[10px] text-slate-500">v{healthStatus?.version || '0.1.0'}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: SYSTÈME & MASTERPLAN */}
      {subTab === 'roadmap' && (
        <SystemRoadmapView
          health={healthStatus}
          esiStatus={esiStatus}
          loading={false}
          sessionExists={Boolean(session)}
        />
      )}

      {/* EXPORT FLEET KEYCHAIN MODAL */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Exporter le Trousseau de Flotte</h3>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              L&apos;archive sera chiffrée avec votre mot de passe (AES-256-GCM avec PBKDF2 100 000 itérations). Vous devrez saisir ce même mot de passe pour restaurer vos personnages.
            </p>

            <form onSubmit={handleExportFleet} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Mot de passe de chiffrement :</label>
                <input
                  type="password"
                  required
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  placeholder="Mot de passe robuste (min. 4 car.)..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Confirmer le mot de passe :</label>
                <input
                  type="password"
                  required
                  value={exportConfirmPassword}
                  onChange={(e) => setExportConfirmPassword(e.target.value)}
                  placeholder="Confirmez le mot de passe..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isKeychainLoading}
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  {isKeychainLoading ? 'Chiffrement...' : 'Télécharger (.enc)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* IMPORT FLEET KEYCHAIN MODAL */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-sky-400" />
                <h3 className="text-base font-bold text-white">Importer un Trousseau de Flotte</h3>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Sélectionnez votre fichier <code className="text-amber-400 font-mono">.enc</code> préalablement exporté. Chaque token de personnage sera immédiatement validé auprès de CCP EVE Online.
            </p>

            <form onSubmit={handleImportFleet} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Fichier de trousseau (.enc) :</label>
                <input
                  type="file"
                  accept=".enc,text/plain"
                  onChange={handleImportFileSelect}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-300 text-xs file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:bg-slate-800 file:text-slate-200 cursor-pointer"
                />
                {importFileName && (
                  <div className="text-[10px] text-emerald-400 font-mono">Fichier chargé : {importFileName}</div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-slate-300 font-medium">Mot de passe de déchiffrement :</label>
                <input
                  type="password"
                  required
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder="Saisissez le mot de passe de sauvegarde..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isKeychainLoading || !importFileData}
                  className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {isKeychainLoading ? 'Validation CCP...' : 'Déchiffrer & Restaurer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
