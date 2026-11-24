import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/storage/redis';

export type DependencyCriticality = "critical" | "optional";

export type DependencyStatus = "up" | "down";

export interface DependencyCheck {
  name: string;
  criticality: DependencyCriticality;
  check: () => Promise<boolean>;
}

export interface DependencyResult {
  name: string;
  criticality: DependencyCriticality;
  status: DependencyStatus;
}

export interface ReadinessResult {
  ready: boolean;
  degraded: boolean;
  dependencies: DependencyResult[];
}

/**
 * Classify dependencies by criticality. Critical dependencies (e.g. the
 * primary database) must be up for the service to be ready. Optional
 * dependencies (e.g. Redis cache) may be down without taking the service
 * out of rotation; instead the service reports a degraded state.
 */
export const DEPENDENCY_CRITICALITY: Record<string, DependencyCriticality> = {
  database: "critical",
  redis: "optional",
};

export function classifyDependency(name: string): DependencyCriticality {
  return DEPENDENCY_CRITICALITY[name] ?? "critical";
}

async function runCheck(dep: DependencyCheck): Promise<DependencyResult> {
  let status: DependencyStatus = "down";
  try {
    status = (await dep.check()) ? "up" : "down";
  } catch {
    status = "down";
  }
  return {
    name: dep.name,
    criticality: dep.criticality,
    status,
  };
}

/**
 * Evaluate readiness across all dependencies.
 *
 * - Any critical dependency down => ready=false.
 * - Only optional dependencies down => ready=true, degraded=true.
 * - All dependencies up => ready=true, degraded=false.
 */
export async function checkReadiness(
  dependencies: DependencyCheck[],
): Promise<ReadinessResult> {
  const results = await Promise.all(dependencies.map(runCheck));

  const criticalDown = results.some(
    (r) => r.criticality === "critical" && r.status === "down",
  );
  const optionalDown = results.some(
    (r) => r.criticality === "optional" && r.status === "down",
  );

  return {
    ready: !criticalDown,
    degraded: !criticalDown && optionalDown,
    dependencies: results,
  };
}

// ── Concrete probe for the /api/ready and /ready routes (#1599, #1812) ───────
//
// Restored after #1812 replaced this module with the generic evaluator above.
// DB is critical; Redis and Horizon are optional and only mark the result
// `degraded` when down.


export type CheckStatus = 'ok' | 'error';

export interface ProbeResult {
  status: CheckStatus;
  latencyMs: number;
  error?: string;
}

export interface ReadinessProbeResult {
  ready: boolean;
  degraded: boolean;
  db: ProbeResult;
  redis: ProbeResult;
  horizon: ProbeResult;
  timestamp: string;
}

const TIMEOUT_MS = 3_000;

async function probe(label: string, fn: () => Promise<unknown>): Promise<ProbeResult> {
  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} check timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const checkDb = () => probe('db', () => prisma.$queryRaw`SELECT 1`);

const checkRedis = () =>
  probe('redis', async () => {
    const redis = getRedisClient();
    if (!redis) throw new Error('Redis client not configured (REDIS_URL not set)');
    await redis.ping();
  });

const checkHorizon = () =>
  probe('horizon', async () => {
    const horizonUrl = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
    const res = await fetch(`${horizonUrl}/`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Horizon returned HTTP ${res.status}`);
  });

/**
 * Run the DB, Redis and Horizon checks in parallel. Not ready only when the
 * critical DB check fails; optional failures set `degraded`.
 */
export async function runReadinessChecks(): Promise<ReadinessProbeResult> {
  const [db, redis, horizon] = await Promise.all([checkDb(), checkRedis(), checkHorizon()]);
  const ready = db.status === 'ok';
  const degraded = ready && (redis.status !== 'ok' || horizon.status !== 'ok');
  return { ready, degraded, db, redis, horizon, timestamp: new Date().toISOString() };
}
