import { runPinHealthSweep } from '@/lib/ipfs/health-monitor';
import { logger } from '@/lib/logger';

/**
 * Standalone IPFS pin health monitor job (#1769).
 *
 * Run once:
 *   pnpm exec tsx server/jobs/ipfs-pin-health.ts
 *
 * Or trigger periodically via POST /api/admin/cron/ipfs-health with X-Cron-Secret.
 */
export async function executePinHealthJob(): Promise<void> {
  const limit = Number(process.env.IPFS_HEALTH_SWEEP_LIMIT ?? 100);
  const targetRedundancy = Number(process.env.IPFS_MIN_PIN_PROVIDERS ?? 2);
  const timeoutMs = Number(process.env.IPFS_GATEWAY_TIMEOUT_MS ?? 8_000);

  const summary = await runPinHealthSweep({
    limit: Number.isFinite(limit) && limit > 0 ? limit : 100,
    targetRedundancy: Number.isFinite(targetRedundancy) && targetRedundancy > 0 ? targetRedundancy : 2,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8_000,
  });

  logger.info('[ipfs-pin-health] Sweep complete', {
    totalChecked: summary.totalChecked,
    healthy: summary.healthy,
    repaired: summary.repaired,
    degraded: summary.degraded,
    unreachable: summary.unreachable,
    repinnedCount: summary.repinnedCount,
  });
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('ipfs-pin-health.ts')) {
  executePinHealthJob().catch((err) => {
    logger.error('[ipfs-pin-health] Unhandled job error', { err: String(err) });
    process.exit(1);
  });
}
