import { useState, useEffect, useRef, useCallback, createContext, useContext, ReactNode } from 'react';

export interface QueryOptions<T> {
  ttl?: number; // Time to live in ms (default 30_000ms = 30s)
  enabled?: boolean; // Default true
  keepPreviousData?: boolean;
  initialData?: T;
  staleTime?: number;
}

interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export type QueryKey = readonly (string | number | boolean | undefined | null)[];

function serializeKey(key: QueryKey): string {
  return JSON.stringify(key);
}

export class QueryClient {
  private cache = new Map<string, CacheItem<unknown>>();
  private inFlight = new Map<string, Promise<unknown>>();
  private listeners = new Map<string, Set<() => void>>();
  private activeAbortControllers = new Map<string, AbortController>();

  get<T>(key: QueryKey): { data: T; isStale: boolean } | null {
    const serialized = serializeKey(key);
    const item = this.cache.get(serialized) as CacheItem<T> | undefined;
    if (!item) return null;

    const age = Date.now() - item.timestamp;
    const isStale = age > item.ttl;
    return { data: item.data, isStale };
  }

  set<T>(key: QueryKey, data: T, ttl: number = 30_000): void {
    const serialized = serializeKey(key);
    this.cache.set(serialized, {
      data,
      timestamp: Date.now(),
      ttl,
    });
    this.notify(serialized);
  }

  delete(key: QueryKey): void {
    const serialized = serializeKey(key);
    this.cache.delete(serialized);
    this.notify(serialized);
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.activeAbortControllers.forEach((ctrl) => ctrl.abort());
    this.activeAbortControllers.clear();
    this.listeners.forEach((set) => set.forEach((cb) => cb()));
  }

  subscribe(key: QueryKey, callback: () => void): () => void {
    const serialized = serializeKey(key);
    if (!this.listeners.has(serialized)) {
      this.listeners.set(serialized, new Set());
    }
    const set = this.listeners.get(serialized)!;
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(serialized);
      }
    };
  }

  notify(serializedKey: string): void {
    const set = this.listeners.get(serializedKey);
    if (set) {
      set.forEach((cb) => cb());
    }
  }

  invalidateQueries(prefixKey?: QueryKey): void {
    if (!prefixKey || prefixKey.length === 0) {
      // Invalidate all
      this.cache.clear();
      this.listeners.forEach((set) => set.forEach((cb) => cb()));
      return;
    }

    const prefixSerialized = JSON.stringify(prefixKey).slice(0, -1); // e.g. '["ledger"'

    for (const [key] of this.cache) {
      if (key.startsWith(prefixSerialized) || key === serializeKey(prefixKey)) {
        this.cache.delete(key);
      }
    }

    // Notify listeners whose key starts with prefix
    for (const [key, set] of this.listeners) {
      if (key.startsWith(prefixSerialized) || key === serializeKey(prefixKey)) {
        set.forEach((cb) => cb());
      }
    }
  }

  async fetchQuery<T>(
    key: QueryKey,
    fetcher: (signal: AbortSignal) => Promise<T>,
    options?: { ttl?: number; force?: boolean }
  ): Promise<T> {
    const serialized = serializeKey(key);
    const ttl = options?.ttl ?? 30_000;

    // Check cache if not forcing
    if (!options?.force) {
      const cached = this.get<T>(key);
      if (cached && !cached.isStale) {
        return cached.data;
      }
    }

    // Check in-flight coalescing
    const existingInFlight = this.inFlight.get(serialized) as Promise<T> | undefined;
    if (existingInFlight) {
      return existingInFlight;
    }

    // Setup AbortController
    const controller = new AbortController();
    this.activeAbortControllers.set(serialized, controller);

    const promise = (async () => {
      try {
        const result = await fetcher(controller.signal);
        this.set(key, result, ttl);
        return result;
      } finally {
        this.inFlight.delete(serialized);
        this.activeAbortControllers.delete(serialized);
      }
    })();

    this.inFlight.set(serialized, promise as Promise<unknown>);
    return promise;
  }
}

// Global default QueryClient
export const defaultQueryClient = new QueryClient();

const QueryClientContext = createContext<QueryClient>(defaultQueryClient);

export function QueryClientProvider({
  client = defaultQueryClient,
  children,
}: {
  client?: QueryClient;
  children: ReactNode;
}) {
  return <QueryClientContext.Provider value={client}>{children}</QueryClientContext.Provider>;
}

export function useQueryClient(): QueryClient {
  return useContext(QueryClientContext);
}

export interface QueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  error: Error | null;
  refetch: () => Promise<T | undefined>;
  setData: (data: T | ((prev: T | undefined) => T)) => void;
}

export function useApiQuery<T>(
  queryKey: QueryKey,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: QueryOptions<T> = {}
): QueryResult<T> {
  const client = useQueryClient();
  const {
    ttl = 30_000,
    enabled = true,
    keepPreviousData = true,
    initialData,
  } = options;

  const serializedKey = serializeKey(queryKey);
  const cached = client.get<T>(queryKey);

  const [data, setDataState] = useState<T | undefined>(() => cached?.data ?? initialData);
  const [isLoading, setIsLoading] = useState<boolean>(() => enabled && !cached);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [isStale, setIsStale] = useState<boolean>(() => cached ? cached.isStale : true);
  const [error, setError] = useState<Error | null>(null);

  // Keep ref to latest fetcher and abortController
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const executeFetch = useCallback(
    async (isManualRefetch = false): Promise<T | undefined> => {
      if (!enabled && !isManualRefetch) return undefined;

      // Abort any in-progress fetch for this hook instance
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Check cache again
      const currentCached = client.get<T>(queryKey);
      if (!isManualRefetch && currentCached && !currentCached.isStale) {
        if (mountedRef.current) {
          setDataState(currentCached.data);
          setIsStale(false);
          setIsLoading(false);
          setIsFetching(false);
        }
        return currentCached.data;
      }

      if (mountedRef.current) {
        if (!keepPreviousData || !currentCached) {
          setIsLoading(true);
        }
        setIsFetching(true);
        setError(null);
      }

      try {
        const result = await client.fetchQuery<T>(
          queryKey,
          (signal) => {
            // Forward abort from either hook controller or client controller
            const mergedSignal = controller.signal;
            signal.addEventListener('abort', () => controller.abort());
            return fetcherRef.current(mergedSignal);
          },
          { ttl, force: isManualRefetch }
        );

        if (mountedRef.current && !controller.signal.aborted) {
          setDataState(result);
          setIsLoading(false);
          setIsFetching(false);
          setIsStale(false);
          setError(null);
        }
        return result;
      } catch (err: unknown) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
          // Gracefully ignore aborted fetch
          return undefined;
        }
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
          setIsFetching(false);
        }
        return undefined;
      }
    },
    [client, serializedKey, enabled, ttl, keepPreviousData]
  );

  // Subscribe to external cache updates & invalidations
  useEffect(() => {
    const unsubscribe = client.subscribe(queryKey, () => {
      const updated = client.get<T>(queryKey);
      if (updated) {
        if (mountedRef.current) {
          setDataState(updated.data);
          setIsStale(updated.isStale);
          setIsLoading(false);
        }
      } else if (enabled) {
        // Cache invalidated: re-fetch if mounted & enabled
        executeFetch(true);
      }
    });

    return unsubscribe;
  }, [client, serializedKey, enabled, executeFetch]);

  // Initial and reactive fetch on queryKey / enabled change
  useEffect(() => {
    if (enabled) {
      executeFetch(false);
    }
  }, [serializedKey, enabled, executeFetch]);

  const refetch = useCallback(() => executeFetch(true), [executeFetch]);

  const setData = useCallback(
    (updater: T | ((prev: T | undefined) => T)) => {
      setDataState((prev) => {
        const next = typeof updater === 'function' ? (updater as (p: T | undefined) => T)(prev) : updater;
        client.set(queryKey, next, ttl);
        return next;
      });
    },
    [client, serializedKey, ttl]
  );

  return {
    data,
    isLoading,
    isFetching,
    isStale,
    error,
    refetch,
    setData,
  };
}

export interface MutationOptions<TData, TVariables> {
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  onError?: (error: Error, variables: TVariables) => void;
  invalidateKeys?: QueryKey[];
}

export function useApiMutation<TData, TVariables = void>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: MutationOptions<TData, TVariables> = {}
) {
  const client = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [data, setData] = useState<TData | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(
    async (variables: TVariables): Promise<TData> => {
      setIsPending(true);
      setError(null);
      try {
        const result = await mutationFn(variables);
        setData(result);
        if (options.invalidateKeys) {
          for (const key of options.invalidateKeys) {
            client.invalidateQueries(key);
          }
        }
        if (options.onSuccess) {
          await options.onSuccess(result, variables);
        }
        return result;
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        if (options.onError) {
          options.onError(e, variables);
        }
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [mutationFn, options, client]
  );

  const mutate = useCallback(
    (variables: TVariables) => {
      mutateAsync(variables).catch(() => {
        // Handled via error state & onError
      });
    },
    [mutateAsync]
  );

  return {
    mutate,
    mutateAsync,
    isPending,
    data,
    error,
  };
}

export async function fetchJson<T>(url: string, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let errorDetail = `HTTP ${res.status} ${res.statusText}`;
    try {
      const errJson = await res.json();
      if (errJson?.error) {
        errorDetail = errJson.error;
      }
    } catch {
      // Non-JSON response error
    }
    throw new Error(errorDetail);
  }
  return res.json() as Promise<T>;
}
