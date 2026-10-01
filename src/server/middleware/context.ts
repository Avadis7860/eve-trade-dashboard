import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.ts';

/**
 * Request context & correlation middleware.
 * Assigns or forwards X-Request-ID and tracks request lifecycle in AsyncLocalStorage.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = (req.headers['x-request-id'] as string) || (req.headers['x-correlation-id'] as string);
  const requestId = incomingId && /^[a-zA-Z0-9\-_:]{4,64}$/.test(incomingId)
    ? incomingId
    : `req_${crypto.randomUUID().slice(0, 8)}`;

  res.setHeader('X-Request-ID', requestId);

  const startTime = performance.now();

  logger.runWithContext(
    {
      requestId,
      startTime,
      path: req.path,
      method: req.method,
    },
    () => {
      next();
    }
  );
}
