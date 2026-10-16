/**
 * Structured logger — wraps console with levelled, JSON-friendly output.
 *
 * Why not pino directly? pino is not installed in this project.  This shim
 * gives the same call-sites (`logger.info`, `logger.warn`, etc.) without
 * adding a new dependency, and is a drop-in swap for pino later: just swap
 * the implementation below without changing any import.
 *
 * Server code (app/api/, server/) MUST use this module instead of
 * console.log so logs carry a structured level, timestamp, and — when set —
 * the current request ID (see lib/request-context.ts).
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('KYC cleanup complete', { deleted: count });
 *   logger.error('Failed to index creator', { creatorId, err });
 */

import { getRequestId } from '@/lib/request-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Honour LOG_LEVEL env-var; default to 'info' in production, 'debug' elsewhere. */
function resolveMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  if (env && env in LEVEL_RANK) return env;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const MIN_LEVEL = resolveMinLevel();

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

  const requestId = getRequestId();
  const entry = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(requestId ? { requestId } : {}),
    ...(meta ?? {}),
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case 'debug':
    case 'info':
      console.info(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info:  (msg: string, meta?: Record<string, unknown>) => emit('info',  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => emit('warn',  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};
