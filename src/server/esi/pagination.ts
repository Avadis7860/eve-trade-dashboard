import type { EsiClient } from './client.ts';
import type {
  PaginatedResult,
  XPagesPaginationOptions,
  FromIdPaginationOptions,
  EsiResponseMeta,
} from './types.ts';

/**
 * Fetches all pages using CCP X-Pages pagination standard
 */
export async function fetchXPages<T>(
  client: EsiClient,
  path: string,
  options: XPagesPaginationOptions = {}
): Promise<PaginatedResult<T>> {
  const maxPages = options.maxPages || 100;
  const allItems: T[] = [];
  let pagesFetched = 0;
  let totalPages = 1;
  let lastMeta: EsiResponseMeta = {
    status: 200,
    fromCache: false,
    fetchedAt: Date.now(),
  };

  try {
    // 1. Fetch Page 1 to inspect x-pages header
    const page1Res = await client.get<T[]>(path, {
      ...options,
      params: { ...options.params, page: 1 },
    });

    lastMeta = page1Res.meta;
    pagesFetched = 1;

    if (Array.isArray(page1Res.data)) {
      allItems.push(...page1Res.data);
    }

    if (page1Res.meta.pages && page1Res.meta.pages > 1) {
      totalPages = Math.min(page1Res.meta.pages, maxPages);
    }

    // 2. Fetch remaining pages sequentially or in small batches
    for (let page = 2; page <= totalPages; page++) {
      const pageRes = await client.get<T[]>(path, {
        ...options,
        params: { ...options.params, page },
      });

      lastMeta = pageRes.meta;
      pagesFetched++;

      if (Array.isArray(pageRes.data)) {
        allItems.push(...pageRes.data);
      }
    }

    return {
      data: allItems,
      status: 'COMPLETE',
      totalFetched: allItems.length,
      pagesFetched,
      totalPagesExpected: totalPages,
      meta: lastMeta,
    };
  } catch (err: unknown) {
    const errorMsg = (err as Error)?.message || 'Pagination error';
    return {
      data: allItems,
      status: allItems.length > 0 ? 'PARTIAL' : 'ERROR',
      totalFetched: allItems.length,
      pagesFetched,
      totalPagesExpected: totalPages,
      error: errorMsg,
      meta: lastMeta,
    };
  }
}

/**
 * Fetches historical lists using CCP from_id cursor pagination standard (e.g. Wallet Transactions)
 */
export async function fetchFromId<T>(
  client: EsiClient,
  path: string,
  options: FromIdPaginationOptions<T>
): Promise<PaginatedResult<T>> {
  const maxItems = options.maxItems || 5000;
  const pageSize = options.pageSize || 2500;
  const fromIdParamName = options.fromIdParamName || 'from_id';
  const seenIds = new Set<number>();
  const allItems: T[] = [];
  let pagesFetched = 0;
  let currentFromId: number | undefined;
  let lastMeta: EsiResponseMeta = {
    status: 200,
    fromCache: false,
    fetchedAt: Date.now(),
  };

  try {
    while (allItems.length < maxItems) {
      const params: Record<string, string | number | boolean | undefined> = {
        ...options.params,
      };

      if (currentFromId !== undefined) {
        params[fromIdParamName] = currentFromId;
      }

      const res = await client.get<T[]>(path, {
        ...options,
        params,
      });

      lastMeta = res.meta;
      pagesFetched++;

      const items = res.data;
      if (!Array.isArray(items) || items.length === 0) {
        break; // No more items
      }

      let newItemsCount = 0;
      let lowestIdInBatch: number | undefined;

      for (const item of items) {
        const id = options.getIdFn(item);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allItems.push(item);
          newItemsCount++;
        }

        if (lowestIdInBatch === undefined || id < lowestIdInBatch) {
          lowestIdInBatch = id;
        }
      }

      // If no new items found or received less than a full page, reached the end
      if (newItemsCount === 0 || items.length < pageSize || lowestIdInBatch === undefined || lowestIdInBatch === currentFromId) {
        break;
      }

      currentFromId = lowestIdInBatch;
    }

    return {
      data: allItems,
      status: 'COMPLETE',
      totalFetched: allItems.length,
      pagesFetched,
      lastSuccessfulId: currentFromId,
      meta: lastMeta,
    };
  } catch (err: unknown) {
    const errorMsg = (err as Error)?.message || 'from_id pagination error';
    return {
      data: allItems,
      status: allItems.length > 0 ? 'PARTIAL' : 'ERROR',
      totalFetched: allItems.length,
      pagesFetched,
      lastSuccessfulId: currentFromId,
      error: errorMsg,
      meta: lastMeta,
    };
  }
}
