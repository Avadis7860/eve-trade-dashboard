export interface SyncCoordinatorStats {
  activeWorkers: number;
  maxConcurrent: number;
  queuedTasks: number;
  inFlightKeys: string[];
  totalProcessed: number;
  totalCoalesced: number;
}

export interface InternalQueueItem {
  id: string;
  key?: string;
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutMs: number;
  enqueuedAt: number;
}

export class SyncCoordinator {
  private maxConcurrent: number;
  private activeWorkers = 0;
  private queue: Array<InternalQueueItem> = [];
  private inFlightTasks = new Map<string, Promise<unknown>>();
  private inFlightOrchestrations = new Map<string, Promise<unknown>>();
  private totalProcessed = 0;
  private totalCoalesced = 0;

  constructor(maxConcurrent = 6) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
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
   * If a task with the same deduplication key is already running or enqueued,
   * new callers coalesce and await the identical in-flight promise.
   */
  public enqueue<T>(
    key: string,
    taskFn: () => Promise<T>,
    options?: { timeoutMs?: number }
  ): Promise<T> {
    // 1. Request Coalescing: If task is already in-flight, return existing Promise
    if (key && this.inFlightTasks.has(key)) {
      this.totalCoalesced++;
      return this.inFlightTasks.get(key) as Promise<T>;
    }

    const timeoutMs = options?.timeoutMs || 45000; // 45s execution safety timeout against hung HTTP sockets

    const taskPromise = new Promise<T>((resolve, reject) => {
      const item: InternalQueueItem = {
        id: `${key || 'anon'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        key,
        fn: taskFn as () => Promise<unknown>,
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

    if (item.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          item.reject(new Error(`Sync task [${item.key || item.id}] timed out after ${item.timeoutMs}ms of execution`));
          this.onTaskFinished();
        }
      }, item.timeoutMs);
      timeoutTimer.unref?.();
    }

    try {
      const result = await item.fn();
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

