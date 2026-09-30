import type { EsiCacheEntry } from './types.ts';

export class EsiCache {
  private entries = new Map<string, EsiCacheEntry>();

  /**
   * Generates a stable cache key based on route path, query params, and character context
   */
  public generateKey(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    characterId?: number
  ): string {
    const sortedParams = params
      ? Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';

    const prefix = characterId ? `char:${characterId}:` : 'pub:';
    return `${prefix}${path}${sortedParams ? `?${sortedParams}` : ''}`;
  }

  /**
   * Gets a cached entry if it exists and has not expired
   */
  public getFresh<T>(key: string): EsiCacheEntry<T> | null {
    const entry = this.entries.get(key) as EsiCacheEntry<T> | undefined;
    if (!entry) return null;

    // Check expiration timestamp
    if (Date.now() < entry.expiresAt) {
      return entry;
    }

    return null;
  }

  /**
   * Gets a cached entry even if expired, for conditional 304 validation
   */
  public getStale<T>(key: string): EsiCacheEntry<T> | null {
    const entry = this.entries.get(key) as EsiCacheEntry<T> | undefined;
    return entry || null;
  }

  /**
   * Stores or updates a cache entry
   */
  public set<T>(
    key: string,
    data: T,
    options: {
      etag?: string | null;
      lastModified?: string | null;
      expiresHeader?: string | null;
      defaultTtlMs?: number;
    }
  ): EsiCacheEntry<T> {
    const now = Date.now();
    let expiresAt = now + (options.defaultTtlMs || 60000); // default 60s

    if (options.expiresHeader) {
      const parsedExpires = Date.parse(options.expiresHeader);
      if (!isNaN(parsedExpires)) {
        expiresAt = parsedExpires;
      }
    }

    const entry: EsiCacheEntry<T> = {
      data,
      etag: options.etag || undefined,
      lastModified: options.lastModified || undefined,
      expiresAt,
      cachedAt: now,
    };

    this.entries.set(key, entry);
    return entry;
  }

  /**
   * Updates expiration metadata of an existing entry (e.g. after receiving a 304 Not Modified)
   */
  public touch304<T>(
    key: string,
    options: {
      expiresHeader?: string | null;
      defaultTtlMs?: number;
    }
  ): EsiCacheEntry<T> | null {
    const entry = this.entries.get(key) as EsiCacheEntry<T> | undefined;
    if (!entry) return null;

    const now = Date.now();
    let expiresAt = now + (options.defaultTtlMs || 60000);

    if (options.expiresHeader) {
      const parsedExpires = Date.parse(options.expiresHeader);
      if (!isNaN(parsedExpires)) {
        expiresAt = parsedExpires;
      }
    }

    entry.expiresAt = expiresAt;
    entry.cachedAt = now;
    return entry;
  }

  /**
   * Clears specific or all cache entries
   */
  public delete(key: string): boolean {
    return this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}

export const defaultEsiCache = new EsiCache();
