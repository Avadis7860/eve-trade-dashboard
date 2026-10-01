import React from 'react';
import {
  MapPin,
  Clock,
  Coins,
  Sparkles,
  User,
} from 'lucide-react';
import { SideDrawer } from '../SideDrawer';
import { CharacterTransaction } from '../../App';

interface TransactionDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: CharacterTransaction | null;
  onOpenProduct360?: (typeId: number) => void;
  formatIsk: (val: number | null | undefined) => string;
}

export const TransactionDetailDrawer: React.FC<TransactionDetailDrawerProps> = ({
  isOpen,
  onClose,
  transaction,
  onOpenProduct360,
  formatIsk,
}) => {
  if (!transaction) return null;

  return (
    <SideDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={transaction.typeName || `Type #${transaction.typeId}`}
      subtitle={`Transaction ID: #${transaction.transactionId} · ${
        transaction.isBuy ? 'Achat Marché' : 'Vente Marché'
      }`}
      badge={
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
            transaction.isBuy
              ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
          }`}
        >
          {transaction.isBuy ? 'ACHAT' : 'VENTE'}
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
                onOpenProduct360(transaction.typeId);
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
      {/* Item Identity */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 flex items-center gap-3">
        <img
          src={`https://images.evetech.net/types/${transaction.typeId}/icon?size=64`}
          alt={transaction.typeName || `Type #${transaction.typeId}`}
          className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-800 p-1"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-slate-100 truncate">
            {transaction.typeName || `Type #${transaction.typeId}`}
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Type ID: #{transaction.typeId} · {transaction.quantity.toLocaleString()} unités @ {formatIsk(transaction.unitPrice)}
          </div>
        </div>
      </div>

      {/* Financial Breakdown */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
        <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Coins className="w-4 h-4 text-amber-400" />
          Régularisation Financière &amp; Montants
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs font-mono">
          <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800/80">
            <div className="text-slate-400">Montant Total Brut</div>
            <div className="text-sm font-bold text-slate-100 mt-0.5">{formatIsk(transaction.totalValue)}</div>
          </div>
          <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800/80">
            <div className="text-slate-400">Prix Unitaire</div>
            <div className="text-sm font-bold text-slate-100 mt-0.5">{formatIsk(transaction.unitPrice)}</div>
          </div>
        </div>

        {(transaction.tax !== undefined || transaction.brokerFee !== undefined) && (
          <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-1.5 text-xs font-mono text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-400">Taxe de vente SCC :</span>
              <span className="text-rose-400">{formatIsk(transaction.tax || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Frais de courtage :</span>
              <span className="text-rose-400">{formatIsk(transaction.brokerFee || 0)}</span>
            </div>
            {transaction.netValue !== undefined && (
              <div className="flex justify-between font-bold pt-1 border-t border-slate-800 text-emerald-400">
                <span>Net Encaissé / Décaissement :</span>
                <span>{formatIsk(transaction.netValue)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Counterparty & Location */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
        <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-rose-400" />
          Emplacement &amp; Contrepartie
        </div>
        <div className="space-y-2 text-xs">
          <div>
            <div className="text-slate-400 text-[11px]">Station / Structure :</div>
            <div className="font-medium text-slate-200 mt-0.5">
              {transaction.locationName || `Location #${transaction.locationId}`}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <User className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400 text-[11px]">Client / Contrepartie :</span>
            <span className="font-mono text-slate-200">
              {transaction.clientName || `Client #${transaction.clientId}`}
            </span>
          </div>
        </div>
      </div>

      {/* Proof & Audit metadata */}
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2">
        <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-sky-400" />
          Traçabilité &amp; Journal ESI
        </div>
        <div className="space-y-1.5 text-xs font-mono text-slate-400">
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span>Date de transaction :</span>
            <span className="text-slate-200">{new Date(transaction.date).toLocaleString()}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-slate-800/60">
            <span>Journal Ref ID :</span>
            <span className="text-slate-200">#{transaction.journalRefId}</span>
          </div>
          <div className="flex justify-between py-1">
            <span>Type d&apos;écriture :</span>
            <span className="text-slate-200">{transaction.isPersonal ? 'Personnel' : 'Corporation'}</span>
          </div>
        </div>
      </div>
    </SideDrawer>
  );
};
