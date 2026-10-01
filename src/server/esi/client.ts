import { EsiCache, defaultEsiCache } from './cache.ts';
import { EsiRateLimiter, defaultEsiRateLimiter } from './rateLimiter.ts';
import type { EsiClientConfig, EsiRequestOptions, EsiResponse, EsiResponseMeta } from './types.ts';
import { defaultMetricsCollector } from '../utils/metrics.ts';

export const DEFAULT_ESI_CONFIG: EsiClientConfig = {
  baseUrl: 'https://esi.evetech.net',
  userAgent: 'EVE-Trade-Dashboard/0.1.0 (+https://github.com/Avadis7860/eve-trade-dashboard; contact: UnjeuxPourtous@gmail.com)',
  timeoutMs: 15000,
  maxRetries: 3,
  baseBackoffMs: 500,
  concurrencyLimit: 5,
};

export class EsiClient {
  private config: EsiClientConfig;
  private cache: EsiCache;
  private rateLimiter: EsiRateLimiter;
  private fetchFn: typeof fetch;

  constructor(
    config?: Partial<EsiClientConfig>,
    cache: EsiCache = defaultEsiCache,
    rateLimiter: EsiRateLimiter = defaultEsiRateLimiter,
    fetchFn: typeof fetch = globalThis.fetch
  ) {
    this.config = { ...DEFAULT_ESI_CONFIG, ...config };
    this.cache = cache;
    this.rateLimiter = rateLimiter;
    this.fetchFn = fetchFn;
  }

  /**
   * Executes a GET request with cache validation, bounded retries, rate limiting, and 304 support
   */
  public async get<T>(path: string, options: EsiRequestOptions = {}): Promise<EsiResponse<T>> {
    const characterId = options.accessToken ? this.extractCharacterIdFromToken(options.accessToken) : undefined;
    const cacheKey = this.cache.generateKey(path, options.params, characterId);

    // 1. Check local fresh cache if neither skipCache nor forceRevalidate is set
    if (!options.skipCache && !options.forceRevalidate) {
      const freshCached = this.cache.getFresh<T>(cacheKey);
      if (freshCached) {
        defaultMetricsCollector.recordEsiRequest(path, 0, 304, true);
        return {
          data: freshCached.data,
          meta: {
            status: 304,
            fromCache: true,
            etag: freshCached.etag,
            lastModified: freshCached.lastModified,
            fetchedAt: freshCached.cachedAt,
          },
        };
      }
    }

    // 2. Prepare URL & headers (including conditional headers if stale cache exists)
    const url = this.buildUrl(path, options.params);
    const staleCached = !options.skipCache ? this.cache.getStale<T>(cacheKey) : null;

    let retries = 0;
    const maxRetries = options.retryCount !== undefined ? options.retryCount : this.config.maxRetries;
    let currentAccessToken = options.accessToken;
    let didRefreshToken = false;

    while (retries <= maxRetries) {
      await this.rateLimiter.acquire();
      const reqStart = performance.now();

      try {
        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'User-Agent': this.config.userAgent,
          ...options.headers,
        };

        if (currentAccessToken) {
          headers['Authorization'] = `Bearer ${currentAccessToken}`;
        }

        if (staleCached?.etag) {
          headers['If-None-Match'] = staleCached.etag;
        }
        if (staleCached?.lastModified) {
          headers['If-Modified-Since'] = staleCached.lastModified;
        }

        const timeout = options.timeoutMs || this.config.timeoutMs;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(new Error(`ESI request timed out after ${timeout}ms`)), timeout);

        const onParentAbort = () => {
          controller.abort(options.signal?.reason || new Error('Request aborted'));
        };

        if (options.signal) {
          if (options.signal.aborted) {
            clearTimeout(timeoutId);
            throw options.signal.reason || new Error('Request aborted');
          }
          options.signal.addEventListener('abort', onParentAbort, { once: true });
        }

        let response: Response;
        try {
          response = await this.fetchFn(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
          if (options.signal) {
            options.signal.removeEventListener('abort', onParentAbort);
          }
        }

        // Update rate limiter with ESI error budget headers
        this.rateLimiter.updateFromHeaders(response.headers);
        const duration = Number((performance.now() - reqStart).toFixed(2));

        const meta: EsiResponseMeta = this.extractResponseMeta(response);

        // 3. Handle 304 Not Modified
        if (response.status === 304) {
          defaultMetricsCollector.recordEsiRequest(path, duration, 304, true);
          if (staleCached) {
            this.cache.touch304(cacheKey, {
              expiresHeader: response.headers.get('expires'),
            });
            return {
              data: staleCached.data,
              meta: {
                ...meta,
                fromCache: true,
                status: 304,
              },
            };
          }
        }

        // 4. Handle 200 OK
        if (response.ok) {
          defaultMetricsCollector.recordEsiRequest(path, duration, 200, false);
          const data: T = await response.json();
          this.cache.set(cacheKey, data, {
            etag: meta.etag,
            lastModified: meta.lastModified,
            expiresHeader: response.headers.get('expires'),
          });

          return {
            data,
            meta,
          };
        }

        // Record error in metrics
        defaultMetricsCollector.recordEsiRequest(path, duration, response.status, false);

        // 5. Handle 401 Unauthorized (attempt token refresh once)
        if (response.status === 401 && options.refreshTokenFn && !didRefreshToken) {
          didRefreshToken = true;
          const freshToken = await options.refreshTokenFn();
          if (freshToken) {
            currentAccessToken = freshToken;
            retries++;
            continue;
          }
        }

        // 6. Handle 403 Forbidden (No retry)
        if (response.status === 403) {
          throw new EsiHttpError(403, 'Forbidden: insufficient scopes or access denied for this resource', meta);
        }

        // 7. Handle 420 (Error limit hit) & 429 (Rate limit)
        if (response.status === 420 || response.status === 429) {
          this.rateLimiter.handleRateLimitHit(response.status, meta.retryAfter);
          throw new EsiHttpError(
            response.status,
            `ESI Rate limit exceeded (${response.status === 420 ? 'Error limit 420' : 'Too Many Requests 429'})`,
            meta
          );
        }

        // 8. Handle 5xx Server Errors (Retry with backoff)
        if (response.status >= 500 && response.status < 600) {
          if (retries < maxRetries) {
            retries++;
            await this.waitBackoff(retries);
            continue;
          }
          throw new EsiHttpError(response.status, `ESI Server error (HTTP ${response.status})`, meta);
        }

        // Other HTTP error (e.g. 404, 400)
        const errorBody = await response.text().catch(() => '');
        throw new EsiHttpError(response.status, `ESI request failed (HTTP ${response.status}): ${errorBody}`, meta);

      } catch (err: unknown) {
        if (err instanceof EsiHttpError) {
          throw err;
        }

        if (options.signal?.aborted) {
          throw options.signal.reason || new Error('Request aborted');
        }

        // Network error / timeout
        const isAbort = (err as Error)?.name === 'AbortError';
        if (retries < maxRetries) {
          retries++;
          await this.waitBackoff(retries);
          continue;
        }

        throw new Error(isAbort ? `ESI request timed out after ${this.config.timeoutMs}ms` : `ESI network error: ${(err as Error)?.message || 'Unknown'}`);
      } finally {
        this.rateLimiter.release();
      }
    }

    throw new Error('ESI request failed after exceeding maximum retries');
  }

  /**
   * Executes a POST request with rate limiting and error tracking (e.g. /universe/names/)
   */
  public async post<T>(path: string, body: unknown, options: EsiRequestOptions = {}): Promise<EsiResponse<T>> {
    const url = this.buildUrl(path, options.params);
    let retries = 0;
    const maxRetries = options.retryCount !== undefined ? options.retryCount : this.config.maxRetries;
    const currentAccessToken = options.accessToken;

    while (retries <= maxRetries) {
      await this.rateLimiter.acquire();
      const reqStart = performance.now();

      try {
        const headers: Record<string, string> = {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': this.config.userAgent,
          ...options.headers,
        };

        if (currentAccessToken) {
          headers['Authorization'] = `Bearer ${currentAccessToken}`;
        }

        const timeout = options.timeoutMs || this.config.timeoutMs;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(new Error(`ESI request timed out after ${timeout}ms`)), timeout);

        const onParentAbort = () => {
          controller.abort(options.signal?.reason || new Error('Request aborted'));
        };

        if (options.signal) {
          if (options.signal.aborted) {
            clearTimeout(timeoutId);
            throw options.signal.reason || new Error('Request aborted');
          }
          options.signal.addEventListener('abort', onParentAbort, { once: true });
        }

        let response: Response;
        try {
          response = await this.fetchFn(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
          if (options.signal) {
            options.signal.removeEventListener('abort', onParentAbort);
          }
        }

        this.rateLimiter.updateFromHeaders(response.headers);
        const duration = Number((performance.now() - reqStart).toFixed(2));
        const meta: EsiResponseMeta = this.extractResponseMeta(response);

        if (response.ok) {
          defaultMetricsCollector.recordEsiRequest(path, duration, response.status, false);
          const data: T = await response.json();
          return { data, meta };
        }

        defaultMetricsCollector.recordEsiRequest(path, duration, response.status, false);

        if (response.status === 420 || response.status === 429) {
          this.rateLimiter.handleRateLimitHit(response.status, meta.retryAfter);
          throw new EsiHttpError(
            response.status,
            `ESI Rate limit exceeded (${response.status === 420 ? 'Error limit 420' : 'Too Many Requests 429'})`,
            meta
          );
        }

        if (response.status >= 500 && response.status < 600) {
          if (retries < maxRetries) {
            retries++;
            await this.waitBackoff(retries);
            continue;
          }
          throw new EsiHttpError(response.status, `ESI Server error (HTTP ${response.status})`, meta);
        }

        const errorBody = await response.text().catch(() => '');
        throw new EsiHttpError(response.status, `ESI POST failed (HTTP ${response.status}): ${errorBody}`, meta);
      } catch (err: unknown) {
        if (err instanceof EsiHttpError) {
          throw err;
        }

        if (options.signal?.aborted) {
          throw options.signal.reason || new Error('Request aborted');
        }

        const isAbort = (err as Error)?.name === 'AbortError';
        if (retries < maxRetries) {
          retries++;
          await this.waitBackoff(retries);
          continue;
        }

        throw new Error(isAbort ? `ESI request timed out after ${this.config.timeoutMs}ms` : `ESI network error: ${(err as Error)?.message || 'Unknown'}`);
      } finally {
        this.rateLimiter.release();
      }
    }

    throw new Error('ESI POST request failed after exceeding maximum retries');
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.config.baseUrl}${cleanPath}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private extractResponseMeta(response: Response): EsiResponseMeta {
    const pagesHeader = response.headers.get('x-pages');
    const retryAfterHeader = response.headers.get('retry-after');
    const errorRemainHeader = response.headers.get('x-esi-error-limit-remain');
    const errorResetHeader = response.headers.get('x-esi-error-limit-reset');

    return {
      status: response.status,
      fromCache: false,
      etag: response.headers.get('etag') || undefined,
      expires: response.headers.get('expires') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      fetchedAt: Date.now(),
      pages: pagesHeader ? parseInt(pagesHeader, 10) : undefined,
      retryAfter: retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined,
      errorLimitRemain: errorRemainHeader ? parseInt(errorRemainHeader, 10) : undefined,
      errorLimitReset: errorResetHeader ? parseInt(errorResetHeader, 10) : undefined,
    };
  }

  private async waitBackoff(retryAttempt: number): Promise<void> {
    const jitter = Math.random() * 200;
    const delay = Math.pow(2, retryAttempt - 1) * this.config.baseBackoffMs + jitter;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private extractCharacterIdFromToken(token: string): number | undefined {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
        const payload = JSON.parse(payloadJson);
        if (payload.sub && payload.sub.startsWith('CHARACTER:EVE:')) {
          return parseInt(payload.sub.replace('CHARACTER:EVE:', ''), 10);
        }
      }
    } catch {
      // Ignore token decode errors
    }
    return undefined;
  }
}

export class EsiHttpError extends Error {
  public statusCode: number;
  public meta: EsiResponseMeta;

  constructor(statusCode: number, message: string, meta: EsiResponseMeta) {
    super(message);
    this.name = 'EsiHttpError';
    this.statusCode = statusCode;
    this.meta = meta;
  }
}

export const defaultEsiClient = new EsiClient();
