import crypto from 'node:crypto';
import type { ISyncRepository } from './repository.ts';
import { defaultSyncRepository } from './repository.ts';
import { logger } from '../utils/logger.ts';

export interface SyncCoordinatorStats {
  activeWorkers: number;
  maxConcurrent: number;
  queuedTasks: number;
  inFlightKeys: string[];
  totalProcessed: number;
  totalCoalesced: number;
  instanceId: string;
}

export interface InternalQueueItem {
  id: string;
  key?: string;
  fn: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutMs: number;
  enqueuedAt: number;
}

export interface DistributedLeaseOptions {
  ttlMs?: number;
  heartbeatIntervalMs?: number;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
}

export class LeaseConflictError extends Error {
  public statusCode = 409;
  constructor(public scopeKey: string, message?: string) {
    super(message || `Resource [${scopeKey}] is currently being synchronized by another instance`);
    this.name = 'LeaseConflictError';
  }
}

export class SyncCoordinator {
  private instanceId: string;
  private maxConcurrent: number;
  private activeWorkers = 0;
  private queue: Array<InternalQueueItem> = [];
  private inFlightTasks = new Map<string, Promise<unknown>>();
  private inFlightOrchestrations = new Map<string, Promise<unknown>>();
  private totalProcessed = 0;
  private totalCoalesced = 0;
  private syncRepo: ISyncRepository | null;

  constructor(
    maxConcurrent = 6,
    options?: {
      instanceId?: string;
      syncRepo?: ISyncRepository | null;
    }
  ) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.instanceId = options?.instanceId || process.env.APP_INSTANCE_ID || `inst_${crypto.randomUUID().slice(0, 12)}`;
    this.syncRepo = options?.syncRepo !== undefined ? options.syncRepo : defaultSyncRepository;
  }

  public getInstanceId(): string {
    return this.instanceId;
  }

  public setSyncRepository(repo: ISyncRepository | null): void {
    this.syncRepo = repo;
  }

  public getSyncRepository(): ISyncRepository | null {
    return this.syncRepo;
  }

  /**
   * Executes an asynchronous task protected by a distributed lease across application instances.
   * Ensures single-worker execution, periodic heartbeats, and guaranteed release in a finally block.
   */
  public async withDistributedLease<T>(
    scopeKey: string,
    fn: (signal: AbortSignal) => Promise<T>,
    options?: DistributedLeaseOptions & { signal?: AbortSignal }
  ): Promise<T> {
    if (!this.syncRepo || !scopeKey) {
      const abortController = new AbortController();
      if (options?.signal) {
        options.signal.addEventListener('abort', () => abortController.abort(options.signal?.reason));
      }
      return fn(abortController.signal);
    }

    const ttlMs = options?.ttlMs ?? 60000; // 60s default TTL
    const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 15000; // 15s default heartbeat
    const waitTimeoutMs = options?.waitTimeoutMs ?? 30000; // 30s wait on conflict
    const pollIntervalMs = options?.pollIntervalMs ?? 100; // 100ms polling

    const startTime = Date.now();
    let acquired = false;

    // 1. Acquire lease or poll until available or timeout
    while (!acquired) {
      if (options?.signal?.aborted) {
        throw options.signal.reason || new Error('Aborted while waiting for sync lease');
      }

      acquired = await this.syncRepo.tryAcquireLeaseAsync(scopeKey, this.instanceId, ttlMs);
      if (acquired) break;

      if (Date.now() - startTime >= waitTimeoutMs) {
        throw new LeaseConflictError(scopeKey, `Timed out waiting to acquire sync lease for [${scopeKey}] after ${waitTimeoutMs}ms`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    // 2. Setup periodic heartbeat during task execution
    let heartbeatTimer: NodeJS.Timeout | null = null;
    heartbeatTimer = setInterval(async () => {
      try {
        if (this.syncRepo) {
          const renewed = await this.syncRepo.renewLeaseAsync(scopeKey, this.instanceId, ttlMs);
          if (!renewed) {
            logger.warn(`[SyncCoordinator] Failed to renew lease for [${scopeKey}] on instance ${this.instanceId}`);
          }
        }
      } catch (err) {
        logger.warn(`[SyncCoordinator] Heartbeat error for lease [${scopeKey}]: ${(err as Error).message}`);
      }
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    // 3. Execute payload with abort signal support
    const abortController = new AbortController();
    if (options?.signal) {
      options.signal.addEventListener('abort', () => abortController.abort(options.signal?.reason));
    }

    try {
      return await fn(abortController.signal);
    } finally {
      // 4. Guaranteed lease release and heartbeat cleanup
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      try {
        await this.syncRepo.releaseLeaseAsync(scopeKey, this.instanceId);
      } catch (releaseErr) {
        logger.error(`[SyncCoordinator] Failed to release lease for [${scopeKey}]: ${(releaseErr as Error).message}`);
      }
    }
  }

  /**
   * Coalesces high-level orchestrator promises (e.g. syncAll:characterId) without
   * consuming a worker slot in the bounded leaf task queue.
   * This completely prevents nested parent/child worker deadlocks.
   */
  public coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (key && this.inFlightOrchestrations.has(key)) {
      this.totalCoalesced++;
      return this.inFlightOrchestrations.get(key) as Promise<T>;
    }

    const promise = fn();

    if (key) {
      this.inFlightOrchestrations.set(key, promise as Promise<unknown>);
      promise
        .finally(() => {
          this.inFlightOrchestrations.delete(key);
        })
        .catch(() => {});
    }

    return promise;
  }

  /**
   * Enqueues or joins an in-flight asynchronous leaf task in the bounded worker pool.
   * If a task with the same deduplication key is already running or enqueued on this instance,
   * new callers coalesce and await the identical in-flight promise.
   */
  public enqueue<T>(
    key: string,
    taskFn: (signal: AbortSignal) => Promise<T>,
    options?: {
      timeoutMs?: number;
      useDistributedLease?: boolean;
      leaseTtlMs?: number;
      heartbeatIntervalMs?: number;
      waitTimeoutMs?: number;
    }
  ): Promise<T> {
    // 1. Request Coalescing (Local Instance): If task is already in-flight, return existing Promise
    if (key && this.inFlightTasks.has(key)) {
      this.totalCoalesced++;
      return this.inFlightTasks.get(key) as Promise<T>;
    }

    const timeoutMs = options?.timeoutMs || 45000; // 45s execution safety timeout against hung HTTP sockets
    const useDistributedLease = options?.useDistributedLease !== false && this.syncRepo !== null && Boolean(key);

    const wrappedFn: (signal: AbortSignal) => Promise<T> = useDistributedLease
      ? (signal: AbortSignal) =>
          this.withDistributedLease(
            key,
            (leaseSignal) => {
              // Combine signals
              if (signal.aborted) {
                return Promise.reject(signal.reason || new Error('Task aborted'));
              }
              const combinedController = new AbortController();
              signal.addEventListener('abort', () => combinedController.abort(signal.reason));
              leaseSignal.addEventListener('abort', () => combinedController.abort(leaseSignal.reason));
              return taskFn(combinedController.signal);
            },
            {
              ttlMs: options?.leaseTtlMs,
              heartbeatIntervalMs: options?.heartbeatIntervalMs,
              waitTimeoutMs: options?.waitTimeoutMs ?? timeoutMs,
              signal,
            }
          )
      : taskFn;

    const taskPromise = new Promise<T>((resolve, reject) => {
      const item: InternalQueueItem = {
        id: `${key || 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        key,
        fn: wrappedFn as (signal: AbortSignal) => Promise<unknown>,
        resolve: (val) => resolve(val as T),
        reject,
        timeoutMs,
        enqueuedAt: Date.now(),
      };

      this.queue.push(item);
      this.drainQueue();
    });

    if (key) {
      this.inFlightTasks.set(key, taskPromise as Promise<unknown>);
      // Clean up in-flight map when task terminates (resolved or rejected)
      taskPromise
        .finally(() => {
          this.inFlightTasks.delete(key);
        })
        .catch(() => {});
    }

    return taskPromise;
  }

  /**
   * Drains the queue up to maxConcurrent workers
   */
  private drainQueue(): void {
    while (this.activeWorkers < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.activeWorkers++;
      this.runTask(item);
    }
  }

  /**
   * Executes an individual task with safety timeout active ONLY during execution
   */
  private async runTask(item: InternalQueueItem): Promise<void> {
    let timeoutTimer: NodeJS.Timeout | null = null;
    let isSettled = false;
    const abortController = new AbortController();

    if (item.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          const timeoutErr = new Error(`Sync task [${item.key || item.id}] timed out after ${item.timeoutMs}ms of execution`);
          abortController.abort(timeoutErr);
          item.reject(timeoutErr);
          this.onTaskFinished();
        }
      }, item.timeoutMs);
      timeoutTimer.unref?.();
    }

    try {
      const result = await item.fn(abortController.signal);
      if (!isSettled) {
        isSettled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        this.totalProcessed++;
        item.resolve(result);
        this.onTaskFinished();
      }
    } catch (err) {
      if (!isSettled) {
        isSettled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        abortController.abort(err instanceof Error ? err : new Error(String(err)));
        item.reject(err);
        this.onTaskFinished();
      }
    }
  }

  /**
   * Called when a worker finishes a task
   */
  private onTaskFinished(): void {
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);
    this.drainQueue();
  }

  /**
   * Returns current metrics and operational status of the coordinator
   */
  public getStats(): SyncCoordinatorStats {
    return {
      activeWorkers: this.activeWorkers,
      maxConcurrent: this.maxConcurrent,
      queuedTasks: this.queue.length,
      inFlightKeys: [
        ...Array.from(this.inFlightTasks.keys()),
        ...Array.from(this.inFlightOrchestrations.keys()),
      ],
      totalProcessed: this.totalProcessed,
      totalCoalesced: this.totalCoalesced,
      instanceId: this.instanceId,
    };
  }

  /**
   * Checks if any worker is currently running or tasks are queued
   */
  public isBusy(): boolean {
    return this.activeWorkers > 0 || this.queue.length > 0;
  }

  /**
   * Resets coordinator state (useful in test suites)
   */
  public reset(): void {
    this.queue = [];
    this.inFlightTasks.clear();
    this.inFlightOrchestrations.clear();
    this.activeWorkers = 0;
    this.totalProcessed = 0;
    this.totalCoalesced = 0;
  }
}

export const defaultSyncCoordinator = new SyncCoordinator(6);
