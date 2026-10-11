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

// ==========================================
// Raw ESI OpenAPI Types (Phase P01)
// ==========================================

export interface RawEsiPlanet {
  last_update: string;
  num_pins: number;
  owner_id: number;
  planet_id: number;
  planet_type: 'temperate' | 'barren' | 'oceanic' | 'ice' | 'gas' | 'lava' | 'storm' | 'plasma' | string;
  solar_system_id: number;
  upgrade_level: number;
}

export interface RawEsiPlanetPinHead {
  head_id: number;
  latitude: number;
  longitude: number;
}

export interface RawEsiPlanetPinExtractorDetails {
  cycle_time?: number;
  head_radius?: number;
  heads?: RawEsiPlanetPinHead[];
  product_type_id?: number;
  qty_per_cycle?: number;
}

export interface RawEsiPlanetPinFactoryDetails {
  schematic_id: number;
}

export interface RawEsiPlanetPinContent {
  amount: number;
  type_id: number;
}

export interface RawEsiPlanetPin {
  contents?: RawEsiPlanetPinContent[];
  expiry_time?: string;
  extractor_details?: RawEsiPlanetPinExtractorDetails;
  factory_details?: RawEsiPlanetPinFactoryDetails;
  install_time?: string;
  last_cycle_start?: string;
  latitude: number;
  longitude: number;
  pin_id: number;
  schematic_id?: number;
  type_id: number;
}

export interface RawEsiPlanetLink {
  destination_pin_id: number;
  link_level: number;
  source_pin_id: number;
}

export interface RawEsiPlanetRoute {
  content_type_id: number;
  destination_pin_id: number;
  quantity: number;
  route_id: number;
  source_pin_id: number;
  waypoints?: number[];
}

export interface RawEsiPlanetDetail {
  links: RawEsiPlanetLink[];
  pins: RawEsiPlanetPin[];
  routes: RawEsiPlanetRoute[];
}

export interface RawEsiCustomsOffice {
  alliance_tax_rate?: number;
  allow_access_with_standings: boolean;
  allow_alliance_access: boolean;
  corporation_tax_rate?: number;
  excellent_standing_tax_rate?: number;
  good_standing_tax_rate?: number;
  neutral_standing_tax_rate?: number;
  office_id: number;
  reinforce_exit_end: number;
  reinforce_exit_start: number;
  solar_system_id: number;
  standing_level?: 'bad' | 'excellent' | 'good' | 'neutral' | 'terrible';
  terrible_standing_tax_rate?: number;
}

export interface RawEsiIndustryJob {
  activity_id: number;
  blueprint_id: number;
  blueprint_location_id: number;
  blueprint_type_id: number;
  completed_character_id?: number;
  completed_date?: string;
  cost?: number;
  duration: number;
  end_date: string;
  facility_id: number;
  installer_id: number;
  job_id: number;
  licensed_runs?: number;
  output_location_id: number;
  pause_date?: string;
  probability?: number;
  product_type_id?: number;
  runs: number;
  start_date: string;
  station_id: number;
  status: 'active' | 'cancelled' | 'delivered' | 'paused' | 'ready' | 'reverted' | string;
  successful_runs?: number;
}

export interface RawEsiMiningEntry {
  date: string;
  quantity: number;
  solar_system_id: number;
  type_id: number;
}
