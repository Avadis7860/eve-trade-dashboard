import React from 'react';
import {
  MapPin,
  Clock,
  Sparkles,
  Package,
} from 'lucide-react';
import { SideDrawer } from '../SideDrawer';
import { CharacterOrderSnapshot } from '../../App';

interface OrderDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  order: CharacterOrderSnapshot | null;
  onOpenProduct360?: (typeId: number) => void;
  formatIsk: (val: number | null | undefined) => string;
}

export const OrderDetailDrawer: React.FC<OrderDetailDrawerProps> = ({
  isOpen,
  onClose,
  order,
  onOpenProduct360,
  formatIsk,
}) => {
  if (!order) return null;

  const progressPercent =
    order.volumeTotal > 0
      ? Math.round(((order.volumeTotal - order.volumeRemain) / order.volumeTotal) * 100)
      : 0;

  const engagedValue = order.isBuyOrder
    ? (order.escrow ?? order.price * order.volumeRemain)
    : order.price * order.volumeRemain;

  const stateColor =
    order.state === 'ACTIVE'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
      : order.state === 'PARTIALLY_FILLED'
      ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
      : order.state === 'DISAPPEARED_UNCONFIRMED'
      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
      : 'bg-slate-800 text-slate-400 border-slate-700';

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={order.typeName || `Type #${order.typeId}`}
      subtitle={`Order ID: #${order.orderId} · ${order.isBuyOrder ? "Ordre d'Achat" : 'Ordre de Vente'}`}
      badge={
        <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${stateColor}`}>
          {order.state || (order.isActiveInCurrentSnapshot ? 'ACTIVE' : 'HISTORIQUE')}
        </span>
      }
      footer={
        <div className="w-full flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            Fermer
          </button>
          {onOpenProduct360 && (
            <button
              onClick={() => {
                onClose();
                onOpenProduct360(order.typeId);
              }}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-slate-950" />
              Ouvrir Fiche Product 360
            </button>
          )}
        </div>
      }
    >
      {/* Item Icon & Identity */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center gap-3">
        <img
          src={`https://images.evetech.net/types/${order.typeId}/icon?size=64`}
          alt={order.typeName || `Type #${order.typeId}`}
          className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-800 p-1"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-100 truncate">
            {order.typeName || `Type #${order.typeId}`}
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Type ID: #{order.typeId} · {order.isBuyOrder ? 'Sens: ACHAT' : 'Sens: VENTE'}
          </div>
        </div>
      </div>

      {/* Financial & Volume Execution */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
        <div className="text-xs font-semibold text-slate-300">Exécution &amp; Volume</div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-slate-400">Progression :</span>
            <span className="text-amber-300 font-bold">
              {order.volumeFilled ?? order.volumeTotal - order.volumeRemain} / {order.volumeTotal} ({progressPercent}%)
            </span>
          </div>
          <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-linear-to-r from-amber-500 to-emerald-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 text-xs font-mono">
          <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800/80">
            <div className="text-slate-400">Prix Unitaire</div>
            <div className="text-sm font-bold text-slate-100 mt-0.5">{formatIsk(order.price)}</div>
          </div>
          <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800/80">
            <div className="text-slate-400">Valeur Engagée</div>
            <div className="text-sm font-bold text-amber-300 mt-0.5">{formatIsk(engagedValue)}</div>
          </div>
        </div>
      </div>

      {/* Station & Physical Stock */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
        <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-rose-400" />
          Emplacement &amp; Stock Physique
        </div>
        <div className="text-xs text-slate-300 space-y-1">
          <div className="font-medium text-slate-200">{order.locationName || `Station #${order.locationId}`}</div>
          <div className="text-slate-500 font-mono text-[11px]">ID Emplacement: #{order.locationId}</div>
        </div>

        {order.inStockQuantity !== undefined && (
          <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-emerald-400" />
              Stock physique libre en station :
            </span>
            <span className="font-mono font-bold text-emerald-400">
              {order.inStockQuantity.toLocaleString()} unités
            </span>
          </div>
        )}
      </div>

      {/* Timing Details */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
        <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-sky-400" />
          Chronologie de l&apos;Ordre
        </div>
        <div className="space-y-1.5 text-xs font-mono text-slate-400">
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span>Émis le :</span>
            <span className="text-slate-200">{new Date(order.issued).toLocaleString()}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span>Durée configurée :</span>
            <span className="text-slate-200">{order.duration} jours</span>
          </div>
          <div className="flex justify-between py-1">
            <span>Dernière observation :</span>
            <span className="text-slate-200">
              {order.lastObservedAt ? new Date(order.lastObservedAt).toLocaleTimeString() : '—'}
            </span>
          </div>
        </div>
      </div>
    </SideDrawer>
  );
};
