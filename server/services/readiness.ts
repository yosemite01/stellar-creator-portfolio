/**
 * Readiness checks for DB, Redis and Horizon (#1599).
 *
 * Each check runs with an independent timeout so one slow dependency
 * cannot block the others.  Results are collected and returned as a
 * structured object so the route handler stays thin.
 */

import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/storage/redis';

export type CheckStatus = 'ok' | 'error';

export interface DependencyResult {
  status: CheckStatus;
  latencyMs: number;
  error?: string;
}

export interface ReadinessResult {
  ready: boolean;
  db: DependencyResult;
  redis: DependencyResult;
  horizon: DependencyResult;
  timestamp: string;
}

const TIMEOUT_MS = 3_000;

async function withTimeout<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T; latencyMs: number } | { ok: false; error: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} check timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    return { ok: true, value, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - start };
  }
}

async function checkDb(): Promise<DependencyResult> {
  const result = await withTimeout('db', () => prisma.$queryRaw`SELECT 1`);
  return result.ok
    ? { status: 'ok', latencyMs: result.latencyMs }
    : { status: 'error', latencyMs: result.latencyMs, error: result.error };
}

async function checkRedis(): Promise<DependencyResult> {
  const result = await withTimeout('redis', async () => {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis client not configured (REDIS_URL not set)');
    await redis.ping();
  });
  return result.ok
    ? { status: 'ok', latencyMs: result.latencyMs }
    : { status: 'error', latencyMs: result.latencyMs, error: result.error };
}

async function checkHorizon(): Promise<DependencyResult> {
  const horizonUrl = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
  const result = await withTimeout('horizon', async () => {
    const res = await fetch(`${horizonUrl}/`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Horizon returned HTTP ${res.status}`);
  });
  return result.ok
    ? { status: 'ok', latencyMs: result.latencyMs }
    : { status: 'error', latencyMs: result.latencyMs, error: result.error };
}

/**
 * Run all three dependency checks in parallel and return a combined result.
 * The pod is NOT ready when any required dependency (db) is unhealthy.
 * Redis and Horizon failures degrade gracefully but also mark the pod not-ready
 * so Kubernetes stops routing traffic until the full chain is healthy.
 */
export async function runReadinessChecks(): Promise<ReadinessResult> {
  const [db, redis, horizon] = await Promise.all([checkDb(), checkRedis(), checkHorizon()]);

  const ready = db.status === 'ok' && redis.status === 'ok' && horizon.status === 'ok';

  return {
    ready,
    db,
    redis,
    horizon,
    timestamp: new Date().toISOString(),
  };
}
