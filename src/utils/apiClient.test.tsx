import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useApiQuery,
  useApiMutation,
  fetchJson,
  getStoredSessionId,
  setStoredSessionId,
  SESSION_STORAGE_KEY,
} from './apiClient';

describe('QueryClient Core & Request Coalescing', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    vi.clearAllMocks();
  });

  it('stores and retrieves data with TTL and stale detection', () => {
    client.set(['ledger', 'summary'], { gross: 1000 }, 5000);
    const cached = client.get<{ gross: number }>(['ledger', 'summary']);
    expect(cached).not.toBeNull();
    expect(cached?.data.gross).toBe(1000);
    expect(cached?.isStale).toBe(false);
  });

  it('coalesces multiple concurrent identical in-flight requests into a single execution', async () => {
    const fetcher = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { id: 1, name: 'Tritanium' };
    });

    const [res1, res2, res3] = await Promise.all([
      client.fetchQuery(['items', 34], fetcher),
      client.fetchQuery(['items', 34], fetcher),
      client.fetchQuery(['items', 34], fetcher),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(res1).toEqual({ id: 1, name: 'Tritanium' });
    expect(res2).toEqual({ id: 1, name: 'Tritanium' });
    expect(res3).toEqual({ id: 1, name: 'Tritanium' });
  });

  it('invalidates queries by prefix cleanly', () => {
    client.set(['ledger', 'summary'], { val: 1 });
    client.set(['ledger', 'transactions', 1], { val: 2 });
    client.set(['orders', 'summary'], { val: 3 });

    const listener = vi.fn();
    client.subscribe(['ledger', 'summary'], listener);

    client.invalidateQueries(['ledger']);

    expect(client.get(['ledger', 'summary'])).toBeNull();
    expect(client.get(['ledger', 'transactions', 1])).toBeNull();
    expect(client.get(['orders', 'summary'])).not.toBeNull();
    expect(listener).toHaveBeenCalled();
  });
});

describe('useApiQuery Hook & AbortController Race-Conditions', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  it('fetches data and manages loading states', async () => {
    const fetcher = vi.fn().mockResolvedValue({ items: ['Jita', 'Amarr'] });

    const { result } = renderHook(() => useApiQuery(['hubs'], fetcher), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual({ items: ['Jita', 'Amarr'] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('aborts prior in-flight request when queryKey rapidly changes (anti-race condition)', async () => {
    const abortedSignals: boolean[] = [];

    const slowFetcher = (search: string) => async (signal: AbortSignal) => {
      signal.addEventListener('abort', () => {
        abortedSignals.push(signal.aborted);
      });

      const delay = search === 'Trit' ? 100 : 20;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

      return { result: `Result for ${search}` };
    };

    let search = 'Trit';
    const { result, rerender } = renderHook(
      ({ q }) => useApiQuery(['search', q], slowFetcher(q)),
      {
        wrapper,
        initialProps: { q: 'Trit' },
      }
    );

    // Rapidly change search before 'Trit' completes
    search = 'Tritanium';
    rerender({ q: search });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual({ result: 'Result for Tritanium' });
    });

    // Verify first request was aborted
    expect(abortedSignals.length).toBeGreaterThan(0);
    expect(abortedSignals[0]).toBe(true);
  });

  it('handles 3-step rapid typing sequence ("Trit" -> "Trif" -> "Tritanium") keeping only the final result', async () => {
    const executedQueries: string[] = [];

    const fetcher = (query: string) => async (signal: AbortSignal) => {
      // Simulate network lag where earlier queries take longer
      const delay = query === 'Trit' ? 80 : query === 'Trif' ? 50 : 10;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
      executedQueries.push(query);
      return { query, count: query.length };
    };

    const { result, rerender } = renderHook(
      ({ q }) => useApiQuery(['search-seq', q], fetcher(q)),
      {
        wrapper,
        initialProps: { q: 'Trit' },
      }
    );

    // Fast typing
    rerender({ q: 'Trif' });
    rerender({ q: 'Tritanium' });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual({ query: 'Tritanium', count: 9 });
    });

    // Only Tritanium successfully completed
    expect(executedQueries).toContain('Tritanium');
    expect(result.current.data?.query).toBe('Tritanium');
  });

  it('safely cancels requests on unmount without throwing unmounted state update errors', async () => {
    const fetcher = vi.fn().mockImplementation(async (signal: AbortSignal) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
      return { data: 'ok' };
    });

    const { unmount } = renderHook(() => useApiQuery(['unmount-test'], fetcher), { wrapper });

    // Unmount before query resolves
    unmount();

    // Should not throw or crash
    expect(fetcher).toHaveBeenCalled();
  });

  it('allows manual setData to update cache and notify subscribers immediately', async () => {
    const fetcher = vi.fn().mockResolvedValue({ items: ['Initial'] });
    const { result } = renderHook(() => useApiQuery(['manual-set'], fetcher), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({ items: ['Initial'] });
    });

    act(() => {
      result.current.setData({ items: ['Updated manually'] });
    });

    expect(result.current.data).toEqual({ items: ['Updated manually'] });
    expect(client.get(['manual-set'])?.data).toEqual({ items: ['Updated manually'] });
  });

  it('refetches when cache is invalidated', async () => {
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      callCount += 1;
      return { count: callCount };
    });

    const { result } = renderHook(() => useApiQuery(['orders', 'summary'], fetcher), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual({ count: 1 });
    });

    act(() => {
      client.invalidateQueries(['orders']);
    });

    await waitFor(() => {
      expect(result.current.data).toEqual({ count: 2 });
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('useApiMutation Hook', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  it('executes mutation and invalidates specified cache keys', async () => {
    client.set(['hubs', 'list'], [{ id: 'hub-jita', name: 'Jita' }]);

    const mutateFn = vi.fn().mockResolvedValue({ success: true, id: 'hub-amarr' });
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () =>
        useApiMutation(mutateFn, {
          invalidateKeys: [['hubs']],
          onSuccess,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.mutateAsync({ name: 'Amarr Prime' });
    });

    expect(mutateFn).toHaveBeenCalledWith({ name: 'Amarr Prime' });
    expect(onSuccess).toHaveBeenCalled();
    expect(client.get(['hubs', 'list'])).toBeNull();
  });
});

describe('fetchJson helper', () => {
  it('parses JSON responses and throws on HTTP error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ hello: 'world' }),
    } as Response);

    const data = await fetchJson<{ hello: string }>('/api/test');
    expect(data).toEqual({ hello: 'world' });

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'Invalid parameters provided' }),
    } as Response);

    await expect(fetchJson('/api/error')).rejects.toThrow('Invalid parameters provided');
  });

  it('manages stored session ID in localStorage and attaches Authorization: Bearer and X-Session-ID headers', async () => {
    setStoredSessionId('test_session_id_456');
    expect(getStoredSessionId()).toBe('test_session_id_456');
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe('test_session_id_456');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'authenticated' }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await fetchJson('/api/auth/session');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, fetchInit] = mockFetch.mock.calls[0];
    const headers = fetchInit?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer test_session_id_456');
    expect(headers.get('X-Session-ID')).toBe('test_session_id_456');

    setStoredSessionId(null);
    expect(getStoredSessionId()).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});
