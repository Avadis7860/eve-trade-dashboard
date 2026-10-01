/**
 * ESI Gateway Types and Contracts
 */

export type EsiCompleteness = 'COMPLETE' | 'PARTIAL' | 'ERROR' | 'UNKNOWN' | 'ABSENT';

export interface EsiResponseMeta {
  status: number;
  fromCache: boolean;
  etag?: string;
  expires?: string;
  lastModified?: string;
  fetchedAt: number;
  errorLimitRemain?: number;
  errorLimitReset?: number;
  retryAfter?: number;
  pages?: number;
}

export interface EsiResponse<T> {
  data: T;
  meta: EsiResponseMeta;
}

export interface EsiCacheEntry<T = unknown> {
  data: T;
  etag?: string;
  lastModified?: string;
  expiresAt: number;
  cachedAt: number;
}

export interface EsiClientConfig {
  baseUrl: string;
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  concurrencyLimit: number;
}

export interface EsiRequestOptions {
  headers?: Record<string, string>;
  accessToken?: string;
  params?: Record<string, string | number | boolean | undefined>;
  skipCache?: boolean;
  /** When true, bypasses in-memory fresh cache and executes conditional validation (If-None-Match) with CCP ESI */
  forceRevalidate?: boolean;
  timeoutMs?: number;
  retryCount?: number;
  signal?: AbortSignal;
  /** Function to obtain a fresh token if 401 occurs */
  refreshTokenFn?: () => Promise<string | null>;
}

export interface XPagesPaginationOptions extends EsiRequestOptions {
  maxPages?: number;
  batchSize?: number;
  startPage?: number;
  onPageSuccess?: (page: number, items: unknown[], meta: EsiResponseMeta) => Promise<void> | void;
}

export interface FromIdPaginationOptions<T> extends EsiRequestOptions {
  fromIdParamName?: string;
  getIdFn: (item: T) => number;
  maxItems?: number;
  pageSize?: number;
  initialFromId?: number;
  onBatchSuccess?: (lastId: number, items: T[], meta: EsiResponseMeta) => Promise<void> | void;
}

export interface PaginatedResult<T> {
  data: T[];
  status: EsiCompleteness;
  totalFetched: number;
  pagesFetched: number;
  totalPagesExpected?: number;
  error?: string;
  lastSuccessfulId?: number;
  meta: EsiResponseMeta;
  hasMore?: boolean;
  reason?: 'MAX_LIMIT_REACHED' | 'NETWORK_ERROR' | 'FETCH_ERROR' | string;
}

export interface EsiRateLimitStatus {
  errorLimitRemain: number;
  errorLimitResetSeconds: number;
  isSuspended: boolean;
  suspendedUntil: number;
  activeRequests: number;
}
