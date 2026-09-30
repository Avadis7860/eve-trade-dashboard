import type { EsiRateLimitStatus } from './types.ts';

export class EsiRateLimiter {
  private activeRequests = 0;
  private maxConcurrent: number;
  private queue: Array<() => void> = [];

  // ESI Error budget (starts at 100 per minute)
  private errorLimitRemain = 100;
  private errorLimitResetTime = 0;

  // Suspension timestamp (if 420 or critical error budget hit)
  private suspendedUntil = 0;

  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Acquires a concurrency slot, waiting if max concurrency or rate limit suspension is active
   */
  public async acquire(): Promise<void> {
    while (this.isSuspended()) {
      const waitMs = Math.max(100, this.suspendedUntil - Date.now());
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
    }

    if (this.activeRequests < this.maxConcurrent) {
      this.activeRequests++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.activeRequests++;
        resolve();
      });
    });
  }

  /**
   * Releases an active concurrency slot and unblocks queued requests
   */
  public release(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);

    if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent && !this.isSuspended()) {
      const next = this.queue.shift();
      if (next) next();
    }
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
        }
      }
    }

    if (retryAfterHeader) {
      const retrySeconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(retrySeconds) && retrySeconds > 0) {
        this.suspendedUntil = Math.max(this.suspendedUntil, Date.now() + retrySeconds * 1000);
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
    this.activeRequests = 0;
    this.queue = [];
    this.errorLimitRemain = 100;
    this.errorLimitResetTime = 0;
    this.suspendedUntil = 0;
  }
}

export const defaultEsiRateLimiter = new EsiRateLimiter(5);
