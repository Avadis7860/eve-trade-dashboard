import React from 'react';
import {
  Activity,
  RefreshCw,
  Database,
  CheckCircle2,
  Server,
} from 'lucide-react';
import { SideDrawer } from '../SideDrawer';
import { EsiStatusResponse, HealthStatus } from '../../App';

interface EsiDiagnosticDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  esiStatus: EsiStatusResponse | null;
  healthStatus: HealthStatus | null;
  isSyncing: boolean;
  onSync: () => void;
  lastSyncTime?: number | null;
}

export const EsiDiagnosticDrawer: React.FC<EsiDiagnosticDrawerProps> = ({
  isOpen,
  onClose,
  esiStatus,
  healthStatus,
  isSyncing,
  onSync,
  lastSyncTime,
}) => {
  const errorRemain = esiStatus?.rateLimit?.errorLimitRemain ?? 100;
  const isSuspended = esiStatus?.rateLimit?.isSuspended ?? false;
  const errorResetSeconds = esiStatus?.rateLimit?.errorLimitResetSeconds ?? 0;
  const activeRequests = esiStatus?.rateLimit?.activeRequests ?? 0;
  const cacheEntries = esiStatus?.cacheSize ?? 0;

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Diagnostic Passerelle ESI & Serveur"
      subtitle="Monitoring technique temps réel, quotas CCP et cache"
      badge={
        isSuspended ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/20 text-rose-300 border border-rose-500/30">
            SUSPENDU
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            OPÉRATIONNEL
          </span>
        )
      }
      footer={
        <div className="w-full flex items-center justify-between">
          <span className="text-xs text-slate-400 font-mono">
            {lastSyncTime ? `Dernière synchro: ${new Date(lastSyncTime).toLocaleTimeString()}` : 'Non synchronisé'}
          </span>
          <button
            onClick={onSync}
            disabled={isSyncing || isSuspended}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Synchronisation...' : 'Déclencher Synchronisation'}
          </button>
        </div>
      }
    >
      {/* Rate Limit Budget */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-sky-400" />
            Budget d&apos;Erreurs ESI (CCP)
          </span>
          <span
            className={`text-xs font-mono font-bold ${
              errorRemain > 50 ? 'text-emerald-400' : errorRemain > 20 ? 'text-amber-400' : 'text-rose-400'
            }`}
          >
            {errorRemain} / 100 restants
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              errorRemain > 50 ? 'bg-emerald-500' : errorRemain > 20 ? 'bg-amber-500' : 'bg-rose-500'
            }`}
            style={{ width: `${Math.max(5, errorRemain)}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1 text-slate-400">
          <div>Reset dans : {errorResetSeconds}s</div>
          <div>Requêtes actives : {activeRequests}</div>
        </div>
      </div>

      {/* Cache & Network status */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Database className="w-4 h-4 text-amber-400" />
          Cache &amp; Optimisation HTTP 304
        </span>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
            <div className="text-slate-400">Entrées en Cache</div>
            <div className="text-base font-bold font-mono text-slate-100 mt-0.5">{cacheEntries}</div>
          </div>
          <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
            <div className="text-slate-400">Statut Passerelle</div>
            <div className="text-base font-bold font-mono text-emerald-400 mt-0.5 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Actif
            </div>
          </div>
        </div>
      </div>

      {/* Server Health Status */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Server className="w-4 h-4 text-emerald-400" />
          Santé du Serveur Backend
        </span>
        <div className="space-y-1.5 text-xs font-mono text-slate-300">
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span className="text-slate-400">Service :</span>
            <span>{healthStatus?.service || 'eve-trade-dashboard'}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span className="text-slate-400">Version :</span>
            <span>{healthStatus?.version || '0.1.0'}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-400">Timestamp serveur :</span>
            <span>{healthStatus?.timestamp ? new Date(healthStatus.timestamp).toLocaleString() : '—'}</span>
          </div>
        </div>
      </div>
    </SideDrawer>
  );
};
