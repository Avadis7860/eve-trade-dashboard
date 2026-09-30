import type { EsiRateLimitStatus } from './types.ts';

export class EsiRateLimiter {
  private activeRequests = 0;
  private maxConcurrent: number;
  private queue: Array<() => void> = [];
  private suspensionTimer: NodeJS.Timeout | null = null;

  // ESI Error budget (starts at 100 per minute)
  private errorLimitRemain = 100;
  private errorLimitResetTime = 0;

  // Suspension timestamp (if 420 or critical error budget hit)
  private suspendedUntil = 0;

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Schedules a drain when current suspension period expires
   */
  private scheduleSuspensionDrain(): void {
    if (this.suspensionTimer) {
      clearTimeout(this.suspensionTimer);
      this.suspensionTimer = null;
    }
    if (this.isSuspended()) {
      const delay = Math.max(50, this.suspendedUntil - Date.now() + 50);
      this.suspensionTimer = setTimeout(() => {
        this.suspensionTimer = null;
        this.drainQueue();
      }, delay);
      this.suspensionTimer.unref?.();
    }
  }

  /**
   * Drains waiting requests from queue up to maxConcurrent as long as not suspended
   */
  private drainQueue(): void {
    if (this.isSuspended()) {
      this.scheduleSuspensionDrain();
      return;
    }

    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) {
        this.activeRequests++;
        next();
      }
    }
  }

  /**
   * Acquires a concurrency slot, waiting if max concurrency or rate limit suspension is active.
   * Includes safety timeout to prevent permanent deadlocks.
   */
  public acquire(timeoutMs: number = 30000): Promise<void> {
    if (!this.isSuspended() && this.activeRequests < this.maxConcurrent && this.queue.length === 0) {
      this.activeRequests++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      const callback = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this.queue.indexOf(callback);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          reject(new Error(`ESI rate limiter acquire timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      }

      this.queue.push(callback);
      this.drainQueue();
    });
  }

  /**
   * Releases an active concurrency slot and unblocks queued requests
   */
  public release(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.drainQueue();
  }

  /**
   * Updates rate limit state from CCP ESI response headers
   */
  public updateFromHeaders(headers: Headers): void {
    const errorRemainHeader = headers.get('x-esi-error-limit-remain');
    const errorResetHeader = headers.get('x-esi-error-limit-reset');
    const retryAfterHeader = headers.get('retry-after');

    if (errorRemainHeader) {
      const remain = parseInt(errorRemainHeader, 10);
      if (!isNaN(remain)) {
        this.errorLimitRemain = remain;
      }
    }

    if (errorResetHeader) {
      const resetSeconds = parseInt(errorResetHeader, 10);
      if (!isNaN(resetSeconds)) {
        this.errorLimitResetTime = Date.now() + resetSeconds * 1000;

        // If error budget drops dangerously low (<= 5), suspend until reset to avoid 420 hard ban
        if (this.errorLimitRemain <= 5) {
          this.suspendedUntil = Math.max(this.suspendedUntil, this.errorLimitResetTime);
          this.scheduleSuspensionDrain();
        }
      }
    }

    if (retryAfterHeader) {
      const retrySeconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(retrySeconds) && retrySeconds > 0) {
        this.suspendedUntil = Math.max(this.suspendedUntil, Date.now() + retrySeconds * 1000);
        this.scheduleSuspensionDrain();
      }
    }
  }

  /**
   * Explicitly signals a 420 Error Limit Hit or 429 Rate Limit
   */
  public handleRateLimitHit(statusCode: number, retryAfterSeconds?: number): void {
    const defaultDelay = statusCode === 420 ? 60000 : 10000; // 60s for 420, 10s for 429
    const delayMs = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : defaultDelay;
    this.suspendedUntil = Date.now() + delayMs;
    this.scheduleSuspensionDrain();
  }

  /**
   * Checks if requests are currently suspended
   */
  public isSuspended(): boolean {
    return Date.now() < this.suspendedUntil;
  }

  /**
   * Returns current status for diagnostics / monitoring
   */
  public getStatus(): EsiRateLimitStatus {
    const now = Date.now();
    const remainingSeconds = this.errorLimitResetTime > now
      ? Math.ceil((this.errorLimitResetTime - now) / 1000)
      : 0;

    return {
      errorLimitRemain: this.errorLimitRemain,
      errorLimitResetSeconds: remainingSeconds,
      isSuspended: this.isSuspended(),
      suspendedUntil: this.suspendedUntil,
      activeRequests: this.activeRequests,
    };
  }

  /**
   * Resets limiter (useful in test suites)
   */
  public reset(): void {
    if (this.suspensionTimer) {
      clearTimeout(this.suspensionTimer);
      this.suspensionTimer = null;
    }
    this.activeRequests = 0;
    this.queue = [];
    this.errorLimitRemain = 100;
    this.errorLimitResetTime = 0;
    this.suspendedUntil = 0;
  }
}

export const defaultEsiRateLimiter = new EsiRateLimiter(5);
