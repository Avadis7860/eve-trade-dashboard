import React from 'react';
import {
  Server,
  Terminal,
  Shield,
  Database,
  CheckCircle2,
  Activity,
  TrendingUp,
} from 'lucide-react';

interface SystemRoadmapViewProps {
  health: { status: string; service: string; timestamp: string; version: string } | null;
  esiStatus: {
    rateLimit: {
      errorLimitRemain: number;
      errorLimitResetSeconds: number;
      isSuspended: boolean;
      suspendedUntil: number;
      activeRequests: number;
    };
    cacheSize: number;
  } | null;
  loading: boolean;
  sessionExists: boolean;
}

export const SystemRoadmapView: React.FC<SystemRoadmapViewProps> = ({
  health,
  esiStatus,
  loading,
  sessionExists,
}) => {
  const phases = [
    { id: '00', name: 'Fondations & CI', status: 'Terminé', desc: 'React, Vite, Express, TypeScript, Vitest, CI' },
    { id: '01', name: 'EVE SSO & Identité', status: sessionExists ? 'Connecté' : 'Terminé', desc: 'OAuth 2.0 PKCE, gestion sécurisée des sessions et tokens' },
    { id: '02', name: 'Passerelle ESI Résiliente', status: 'Terminé', desc: 'Cache 304, rate limits (420/429), gestion des erreurs et pagination' },
    { id: '03', name: 'Transactions & Grand Livre', status: 'Terminé', desc: 'Sync wallet idempotente, pagination from_id, grand livre des ventes' },
    { id: '04', name: 'Ordres & Réapprovisionnement', status: 'Terminé', desc: 'Snapshots ordres de marché, cycle de vie et listes locales' },
    { id: '05', name: 'Hubs & ROI TTC', status: 'Terminé', desc: 'Taxes, frais de courtage, rentabilité réelle et allocations explicites' },
    { id: '06', name: 'Dashboard Intégré', status: 'Actif', desc: 'Vue unifiée, filtres réactifs, audit UX, export CSV & préférences' },
  ];

  return (
    <section className="space-y-6 pt-2">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <Server className="w-4 h-4 text-sky-400" />
              Backend &amp; SSO
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800 font-mono">
              Port 3000
            </span>
          </div>
          <div className="text-sm font-medium text-slate-200">
            {loading ? (
              <span className="text-slate-500">Chargement...</span>
            ) : health ? (
              <span className="text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Connecté (v{health.version})
              </span>
            ) : (
              <span className="text-rose-400">Serveur indisponible</span>
            )}
          </div>
          <div className="text-xs text-slate-500 font-mono">
            GET /api/health — {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString() : 'N/A'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-emerald-400" />
              Passerelle ESI
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
              {esiStatus?.rateLimit ? `${esiStatus.rateLimit.errorLimitRemain}/100 Budget` : 'Actif'}
            </span>
          </div>
          <div className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Cache ETag &amp; 304
          </div>
          <div className="text-xs text-slate-500">
            {esiStatus?.cacheSize !== undefined
              ? `Entrées en cache : ${esiStatus.cacheSize} · Retries bornés 5xx`
              : 'Gestion 420/429 & Retry-After'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-amber-400" />
              Sécurité Sessions
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono">
              PKCE S256
            </span>
          </div>
          <div className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Cookie HttpOnly &amp; SameSite
          </div>
          <div className="text-xs text-slate-500">
            Protection anti-CSRF par state aléatoire à usage unique
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase text-slate-400 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-purple-400" />
              Dashboard Intégré
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-purple-950 text-purple-400 border border-purple-800 font-mono">
              Phase 06
            </span>
          </div>
          <div className="text-sm font-medium text-slate-200">
            Parcours Unifié &amp; Ergonomie
          </div>
          <div className="text-xs text-slate-500">
            Export CSV, filtres consolidés &amp; zéro doublon
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-slate-100">Feuille de Route (Masterplan)</h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">Phases de développement</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {phases.map((p) => (
            <div
              key={p.id}
              className="p-4 rounded-lg border border-slate-800 bg-slate-900/30 hover:border-slate-700 transition-colors space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  Phase {p.id}
                </span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded ${
                    p.status === 'Terminé' || p.status === 'Connecté'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : p.status === 'Actif'
                      ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                      : 'bg-slate-800/50 text-slate-500 border border-slate-800'
                  }`}
                >
                  {p.status}
                </span>
              </div>
              <h3 className="font-medium text-slate-200 text-sm">{p.name}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/20 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-amber-400" />
          Règles &amp; Invariants Métier EVE
        </h3>
        <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
          <li>La disparition d&apos;un order_id d&apos;un snapshot ESI ne prouve pas une vente complète (état DISAPPEARED_UNCONFIRMED).</li>
          <li>Les listes de réapprovisionnement sont des projections locales privées sans écriture sur le marché ESI.</li>
          <li>Tokens OAuth, secrets et requêtes privées strictement gérés côté serveur.</li>
          <li>Aucun calcul implicite FIFO sans consentement ; distinction nette des états UNKNOWN, PARTIAL, ERROR, ABSENT.</li>
        </ul>
      </div>
    </section>
  );
};
