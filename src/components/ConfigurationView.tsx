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
} from 'lucide-react';
import {
  CharacterSession,
  HubDefinition,
  HubLocationMapping,
  HealthStatus,
  EsiStatusResponse,
} from '../App';
import { SystemRoadmapView } from './SystemRoadmapView';

interface ConfigurationViewProps {
  session: CharacterSession | null;
  linkedCharacters: CharacterSession[];
  activeCharacterId?: number;
  onSwitchCharacter: (characterId: number) => void;
  onLogout?: () => void;
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
              <a
                href="/api/auth/login"
                className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Lier un Autre Personnage
              </a>
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
    </div>
  );
};
