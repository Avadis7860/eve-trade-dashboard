import type { Request, Response, NextFunction } from 'express';
import type { UserSession } from '../auth/types.ts';

/**
 * Security headers middleware
 * Configures CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy and disables X-Powered-By.
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Remove Express fingerprint
  res.removeHeader('X-Powered-By');

  // Content-Type sniffing protection
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // Content Security Policy - allow framing from AI Studio and run.app domains
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://images.evetech.net",
    "connect-src 'self' https://esi.evetech.net https://login.eveonline.com",
    "frame-ancestors 'self' https://*.google.com https://*.googleusercontent.com https://*.run.app",
    "base-uri 'self'",
    "form-action 'self' https://login.eveonline.com",
  ];
  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // HSTS when over HTTPS
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (isSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

/**
 * CSRF protection middleware for state-changing HTTP methods (POST, PUT, DELETE, PATCH).
 * Rejects requests from untrusted origins or lacking CSRF token / custom request header.
 */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const mutatingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (!mutatingMethods.includes(req.method)) {
    return next();
  }

  // Exempt public callback or webhook routes if any
  if (req.path === '/api/auth/callback') {
    return next();
  }

  // Check Origin or Referer header against Host header if present
  const origin = req.headers.origin || req.headers.referer;
  const host = req.headers.host;
  const customHeader = req.headers['x-requested-with'] || req.headers['x-csrf-token'];

  // In standard browser API fetch from SPA, custom headers (or same-origin) protect against simple CSRF
  if (origin && host) {
    try {
      const originUrl = new URL(origin);
      const isAllowedOrigin =
        originUrl.host === host ||
        originUrl.host.includes('run.app') ||
        originUrl.host.includes('localhost') ||
        originUrl.host.includes('127.0.0.1');

      if (!isAllowedOrigin && !customHeader) {
        res.status(403).json({ error: 'CSRF validation failed: Origin mismatch' });
        return;
      }
    } catch {
      // Invalid origin URL format
      if (!customHeader) {
        res.status(403).json({ error: 'CSRF validation failed: Invalid origin format' });
        return;
      }
    }
  }

  next();
}

/**
 * Strict character authorization validator
 * Verifies that a character ID or list of character IDs belong to the active user session.
 */
export function validateCharacterSessionAccess(
  session: UserSession,
  requestedCharIds?: number | number[]
): { allowed: boolean; unauthorizedIds: number[] } {
  if (requestedCharIds === undefined || requestedCharIds === null) {
    return { allowed: true, unauthorizedIds: [] };
  }

  const idsToCheck = Array.isArray(requestedCharIds) ? requestedCharIds : [requestedCharIds];
  if (idsToCheck.length === 0) {
    return { allowed: true, unauthorizedIds: [] };
  }

  const authorizedIds = new Set<number>();
  if (session.characterId) authorizedIds.add(session.characterId);
  if (session.activeCharacterId) authorizedIds.add(session.activeCharacterId);
  if (session.characters) {
    for (const charIdStr of Object.keys(session.characters)) {
      authorizedIds.add(Number(charIdStr));
    }
  }

  const unauthorizedIds = idsToCheck.filter((id) => !authorizedIds.has(id));
  return {
    allowed: unauthorizedIds.length === 0,
    unauthorizedIds,
  };
}
