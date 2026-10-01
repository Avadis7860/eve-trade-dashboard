/**
 * Sanitized logging utility for EVE Trade Dashboard
 * Automatically redacts Authorization headers, OAuth tokens, client secrets, and cookies from log outputs.
 */

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /access_token["']?\s*[:=]\s*["']?[A-Za-z0-9\-_.]+["']?/gi,
  /refresh_token["']?\s*[:=]\s*["']?[A-Za-z0-9\-_.]+["']?/gi,
  /code_verifier["']?\s*[:=]\s*["']?[A-Za-z0-9\-_.]+["']?/gi,
  /code_challenge["']?\s*[:=]\s*["']?[A-Za-z0-9\-_.]+["']?/gi,
  /client_secret["']?\s*[:=]\s*["']?[A-Za-z0-9\-_.]+["']?/gi,
  /eve_session_id=[A-Za-z0-9\-_.]+/gi,
  /csrf[-_]?token["']?\s*[:=]\s*["']?[A-Za-z0-9\-_.]+["']?/gi,
  /[?&](access_token|refresh_token|code_verifier|code|client_secret)=[^&\s]+/gi,
  /["']?authorization["']?\s*[:=]\s*["'][^"']+["']/gi,
];

export function sanitizeLogMessage(message: unknown): string {
  if (message instanceof Error) {
    message = message.stack || `${message.name}: ${message.message}`;
  } else if (typeof message !== 'string') {
    try {
      message = JSON.stringify(message);
    } catch {
      message = String(message);
    }
  }

  let sanitized = String(message);
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

export const logger = {
  info: (...args: unknown[]) => {
    const sanitized = args.map(sanitizeLogMessage).join(' ');
    console.log(`[INFO] ${sanitized}`);
  },
  warn: (...args: unknown[]) => {
    const sanitized = args.map(sanitizeLogMessage).join(' ');
    console.warn(`[WARN] ${sanitized}`);
  },
  error: (...args: unknown[]) => {
    const sanitized = args.map(sanitizeLogMessage).join(' ');
    console.error(`[ERROR] ${sanitized}`);
  },
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      const sanitized = args.map(sanitizeLogMessage).join(' ');
      console.log(`[DEBUG] ${sanitized}`);
    }
  },
};
