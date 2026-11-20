/**
 * Periodic audit chain anchoring job.
 * Runs on a schedule (e.g., hourly) to anchor the chain head on Stellar.
 * 
 * This provides cryptographic proof that the audit log existed at specific times.
 * Based on: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0047.md
 */

import { anchorChainHeadOnStellar } from '@/server/services/audit';
import { initStellarClient } from '@/server/stellar/client';
import { getLogger } from '@/server/services/logger';

const logger = getLogger('audit-anchoring');
const ANCHOR_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Run one anchoring cycle.
 */
async function runAnchoringCycle(): Promise<void> {
  try {
    logger.info('Starting audit chain anchoring cycle');
    
    // Initialize Stellar client
    const client = await initStellarClient();
    
    // Anchor the chain head
    const txHash = await anchorChainHeadOnStellar();
    
    if (txHash) {
      logger.info(`Anchored chain head on Stellar: ${txHash}`);
    } else {
      logger.warn('No entries to anchor (empty audit log)');
    }
  } catch (err) {
    logger.error('Failed to anchor audit chain:', err);
  }
}

/**
 * Start the periodic anchoring scheduler.
 * Use this in long-running processes (e.g., cron daemon or scheduled job runner).
 */
export function startAnchoringScheduler(): void {
  logger.info(`Starting audit chain anchoring scheduler (interval: ${ANCHOR_INTERVAL_MS / 1000}s)`);
  
  // Run immediately on startup
  runAnchoringCycle();
  
  // Then run periodically
  setInterval(runAnchoringCycle, ANCHOR_INTERVAL_MS);
}

/**
 * Run once and exit (for cron-based execution).
 * Use this for one-off execution via crontab or similar.
 */
export async function runOnceAndExit(): Promise<void> {
  await runAnchoringCycle();
  process.exit(0);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await runOnceAndExit();
}