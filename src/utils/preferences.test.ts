import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPreferences,
  savePreferences,
  formatCompactIsk,
  formatIskValue,
  DEFAULT_PREFERENCES,
} from './preferences';

describe('Preferences & Formatting Utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default preferences if localStorage is empty', () => {
    const prefs = loadPreferences();
    expect(prefs).toEqual(DEFAULT_PREFERENCES);
    expect(prefs.defaultLandingTab).toBe('overview');
  });

  it('saves and merges partial preferences into localStorage', () => {
    const updated = savePreferences({ iskDisplayMode: 'compact', hideCompletedOrders: true });
    expect(updated.iskDisplayMode).toBe('compact');
    expect(updated.hideCompletedOrders).toBe(true);
    expect(updated.defaultLandingTab).toBe('overview');

    const reloaded = loadPreferences();
    expect(reloaded.iskDisplayMode).toBe('compact');
    expect(reloaded.hideCompletedOrders).toBe(true);
  });

  it('formats compact ISK values correctly', () => {
    expect(formatCompactIsk(1_500_000_000)).toBe('1.50 B ISK');
    expect(formatCompactIsk(25_400_000)).toBe('25.40 M ISK');
    expect(formatCompactIsk(12_345)).toBe('12.35 K ISK');
    expect(formatCompactIsk(500)).toBe('500.00 ISK');
    expect(formatCompactIsk(-50_000_000)).toBe('-50.00 M ISK');
  });

  it('formats full ISK values according to French locale standard', () => {
    const full = formatIskValue(1000000.5, 'full');
    expect(full).toContain('ISK');
    expect(full).toContain('1');
    expect(full).toContain('000');
    expect(full).toContain('50');
  });
});
