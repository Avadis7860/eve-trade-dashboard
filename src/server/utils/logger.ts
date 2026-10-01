import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Sanitized and contextual structured logging utility for EVE Trade Dashboard
 * Automatically redacts Authorization headers, OAuth tokens, client secrets, and cookies from log outputs.
 * Correlates log entries via RequestId / CorrelationId across async flows.
 */

export interface LogContext {
  requestId?: string;
  characterId?: number;
  operation?: string;
  startTime?: number;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  requestId?: string;
  durationMs?: number;
  context?: Record<string, unknown>;
}

export const logContextStorage = new AsyncLocalStorage<LogContext>();

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

export function formatLogOutput(
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
  message: string,
  extraMeta?: Record<string, unknown>
): string {
  const context = logContextStorage.getStore();
  const requestId = context?.requestId;

  if (process.env.LOG_FORMAT === 'json') {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId,
      context: { ...context, ...extraMeta },
    };
    if (context?.startTime) {
      entry.durationMs = Number((performance.now() - context.startTime).toFixed(2));
    }
    return JSON.stringify(entry);
  }

  const reqTag = requestId ? ` [${requestId}]` : '';
  return `[${level}]${reqTag} ${message}`;
}

export const logger = {
  runWithContext: <T>(context: LogContext, fn: () => T): T => {
    return logContextStorage.run(context, fn);
  },

  getRequestId: (): string | undefined => {
    return logContextStorage.getStore()?.requestId;
  },

  getContext: (): LogContext | undefined => {
    return logContextStorage.getStore();
  },

  info: (...args: unknown[]) => {
    const sanitized = args.map(sanitizeLogMessage).join(' ');
    console.log(formatLogOutput('INFO', sanitized));
  },

  warn: (...args: unknown[]) => {
    const sanitized = args.map(sanitizeLogMessage).join(' ');
    console.warn(formatLogOutput('WARN', sanitized));
  },

  error: (...args: unknown[]) => {
    const sanitized = args.map(sanitizeLogMessage).join(' ');
    console.error(formatLogOutput('ERROR', sanitized));
  },

  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      const sanitized = args.map(sanitizeLogMessage).join(' ');
      console.log(formatLogOutput('DEBUG', sanitized));
    }
  },

  logStructured: (
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG',
    message: string,
    meta?: Record<string, unknown>
  ) => {
    const sanitized = sanitizeLogMessage(message);
    const output = formatLogOutput(level, sanitized, meta);
    if (level === 'ERROR') {
      console.error(output);
    } else if (level === 'WARN') {
      console.warn(output);
    } else {
      console.log(output);
    }
  },
};
