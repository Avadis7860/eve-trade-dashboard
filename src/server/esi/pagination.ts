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
  const startPage = Math.max(1, options.startPage || 1);
  const allItems: T[] = [];
  let pagesFetched = 0;
  let totalPagesExpected = 1;
  let lastMeta: EsiResponseMeta = {
    status: 200,
    fromCache: false,
    fetchedAt: Date.now(),
  };

  try {
    // 1. Fetch first requested page (startPage) to inspect x-pages header
    const firstRes = await client.get<T[]>(path, {
      ...options,
      params: { ...options.params, page: startPage },
    });

    lastMeta = firstRes.meta;
    pagesFetched = 1;

    const reportedPages = firstRes.meta.pages && firstRes.meta.pages > 0 ? firstRes.meta.pages : 1;
    totalPagesExpected = reportedPages;

    if (Array.isArray(firstRes.data)) {
      allItems.push(...firstRes.data);
      if (options.onPageSuccess) {
        await options.onPageSuccess(startPage, firstRes.data, firstRes.meta);
      }
    }

    // Determine target upper bound for pagination
    const targetEndPage = Math.min(reportedPages, startPage + maxPages - 1);

    // 2. Fetch remaining pages sequentially
    for (let page = startPage + 1; page <= targetEndPage; page++) {
      const pageRes = await client.get<T[]>(path, {
        ...options,
        params: { ...options.params, page },
      });

      lastMeta = pageRes.meta;
      pagesFetched++;

      if (Array.isArray(pageRes.data)) {
        allItems.push(...pageRes.data);
        if (options.onPageSuccess) {
          await options.onPageSuccess(page, pageRes.data, pageRes.meta);
        }
      }
    }

    // Evaluate strict completeness
    const reachedEnd = targetEndPage >= reportedPages;
    const status = reachedEnd ? 'COMPLETE' : 'PARTIAL';
    const hasMore = !reachedEnd;
    const reason = !reachedEnd ? 'MAX_LIMIT_REACHED' : undefined;

    return {
      data: allItems,
      status,
      totalFetched: allItems.length,
      pagesFetched,
      totalPagesExpected,
      meta: lastMeta,
      hasMore,
      reason,
    };
  } catch (err: unknown) {
    const errorMsg = (err as Error)?.message || 'Pagination error';
    return {
      data: allItems,
      status: allItems.length > 0 ? 'PARTIAL' : 'ERROR',
      totalFetched: allItems.length,
      pagesFetched,
      totalPagesExpected,
      error: errorMsg,
      meta: lastMeta,
      hasMore: true,
      reason: 'FETCH_ERROR',
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
  let currentFromId: number | undefined = options.initialFromId;
  let lastSuccessfulId: number | undefined = options.initialFromId;
  let reachedEnd = false;
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
        reachedEnd = true;
        break; // No more items
      }

      let newItemsCount = 0;
      let lowestIdInBatch: number | undefined;
      const batchAdded: T[] = [];

      for (const item of items) {
        const id = options.getIdFn(item);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allItems.push(item);
          batchAdded.push(item);
          newItemsCount++;
        }

        if (lowestIdInBatch === undefined || id < lowestIdInBatch) {
          lowestIdInBatch = id;
        }
      }

      if (lowestIdInBatch !== undefined) {
        lastSuccessfulId = lowestIdInBatch;
      }

      if (options.onBatchSuccess && batchAdded.length > 0 && lowestIdInBatch !== undefined) {
        await options.onBatchSuccess(lowestIdInBatch, batchAdded, res.meta);
      }

      // If no new items found or received less than a full page, reached the end
      if (
        newItemsCount === 0 ||
        items.length < pageSize ||
        lowestIdInBatch === undefined ||
        lowestIdInBatch === currentFromId
      ) {
        reachedEnd = true;
        break;
      }

      currentFromId = lowestIdInBatch;
    }

    const hitMaxLimit = allItems.length >= maxItems && !reachedEnd;
    const status = reachedEnd ? 'COMPLETE' : 'PARTIAL';
    const hasMore = !reachedEnd;
    const reason = hitMaxLimit ? 'MAX_LIMIT_REACHED' : undefined;

    return {
      data: allItems,
      status,
      totalFetched: allItems.length,
      pagesFetched,
      lastSuccessfulId,
      meta: lastMeta,
      hasMore,
      reason,
    };
  } catch (err: unknown) {
    const errorMsg = (err as Error)?.message || 'from_id pagination error';
    return {
      data: allItems,
      status: allItems.length > 0 ? 'PARTIAL' : 'ERROR',
      totalFetched: allItems.length,
      pagesFetched,
      lastSuccessfulId,
      error: errorMsg,
      meta: lastMeta,
      hasMore: true,
      reason: 'FETCH_ERROR',
    };
  }
}
