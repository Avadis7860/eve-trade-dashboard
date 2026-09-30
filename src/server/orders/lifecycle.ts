import type {
  CharacterOrderSnapshot,
  RawEsiOrder,
  OrderLifecycleState,
} from './types.ts';

export interface ClassificationResult {
  state: OrderLifecycleState;
  justification: string;
  volumeFilled: number;
}

/**
 * Evaluates the lifecycle state of an order given current observation and historical context
 */
export function evaluateOrderLifecycle(
  raw: RawEsiOrder,
  existingSnapshot?: CharacterOrderSnapshot,
  isHistorical = false
): ClassificationResult {
  const volumeTotal = raw.volume_total;
  const volumeRemain = raw.volume_remain;
  const volumeFilled = Math.max(0, volumeTotal - volumeRemain);

  // 1. If coming from historical orders endpoint
  if (isHistorical || raw.state) {
    if (raw.state === 'cancelled') {
      return {
        state: 'CANCELLED_CONFIRMED',
        justification: `Ordre annulé confirmé par l'historique ESI (Restant: ${volumeRemain}/${volumeTotal})`,
        volumeFilled,
      };
    }
    if (raw.state === 'expired') {
      return {
        state: 'EXPIRED_CONFIRMED',
        justification: `Ordre expiré confirmé par l'historique ESI (Restant: ${volumeRemain}/${volumeTotal})`,
        volumeFilled,
      };
    }
    if (volumeRemain === 0) {
      return {
        state: 'COMPLETED_CONFIRMED',
        justification: `Ordre entièrement exécuté (0 restant sur ${volumeTotal})`,
        volumeFilled,
      };
    }
  }

  // 2. Active snapshot evaluations
  if (volumeRemain === 0) {
    return {
      state: 'COMPLETED_CONFIRMED',
      justification: `Volume restant tombé à 0 (Exécution totale de ${volumeTotal} unités)`,
      volumeFilled: volumeTotal,
    };
  }

  if (volumeRemain < volumeTotal) {
    const previousRemain = existingSnapshot ? existingSnapshot.volumeRemain : volumeTotal;
    const delta = previousRemain - volumeRemain;
    const deltaInfo = delta > 0 ? ` (-${delta} unités depuis le dernier snapshot)` : '';

    return {
      state: 'PARTIALLY_FILLED',
      justification: `Ordre partiellement exécuté : ${volumeFilled}/${volumeTotal} unités remplies${deltaInfo}`,
      volumeFilled,
    };
  }

  if (volumeRemain === volumeTotal) {
    return {
      state: 'ACTIVE',
      justification: `Ordre actif en marché, aucun volume exécuté (${volumeRemain}/${volumeTotal})`,
      volumeFilled: 0,
    };
  }

  return {
    state: 'UNKNOWN',
    justification: `Données d'ordre incohérentes (Total: ${volumeTotal}, Restant: ${volumeRemain})`,
    volumeFilled,
  };
}

/**
 * Calculates expiration timestamp from issued date and duration in days
 */
export function calculateExpirationIso(issuedIso: string, durationDays: number): string {
  try {
    const issuedDate = new Date(issuedIso);
    const expireTime = issuedDate.getTime() + durationDays * 24 * 60 * 60 * 1000;
    return new Date(expireTime).toISOString();
  } catch {
    return issuedIso;
  }
}
