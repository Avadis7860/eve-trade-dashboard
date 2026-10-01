/**
 * User Preferences Management (Stored in localStorage with type safety and fallback defaults)
 */

export type WalletSyncMode = 'CHARACTERS_ONLY' | 'CORPORATION_ONLY' | 'BOTH';

export interface UserPreferences {
  defaultLandingTab: 'overview' | 'ledger' | 'orders' | 'restock' | 'hubs-roi' | 'capital' | 'journal';
  iskDisplayMode: 'full' | 'compact';
  hideCompletedOrders: boolean;
  tablePageSize: number;
  walletSyncMode?: WalletSyncMode;
  excludedCharacterWalletIds?: number[];
  includedCorporationWallets?: string[];
}

const STORAGE_KEY = 'eve_trade_dashboard_preferences';

export const DEFAULT_PREFERENCES: UserPreferences = {
  defaultLandingTab: 'overview',
  iskDisplayMode: 'full',
  hideCompletedOrders: false,
  tablePageSize: 25,
  walletSyncMode: 'BOTH',
  excludedCharacterWalletIds: [],
  includedCorporationWallets: [],
};

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(prefs: Partial<UserPreferences>): UserPreferences {
  try {
    const current = loadPreferences();
    const updated = { ...current, ...prefs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return { ...DEFAULT_PREFERENCES, ...prefs };
  }
}

export function formatCompactIsk(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000_000) {
    return `${sign}${(abs / 1_000_000_000_000).toFixed(2)} T ISK`;
  }
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(2)} B ISK`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2)} M ISK`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(2)} K ISK`;
  }
  return `${sign}${abs.toFixed(2)} ISK`;
}

export function formatIskValue(amount: number, mode: 'full' | 'compact' = 'full'): string {
  if (mode === 'compact') {
    return formatCompactIsk(amount);
  }
  return (
    new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount) + ' ISK'
  );
}
