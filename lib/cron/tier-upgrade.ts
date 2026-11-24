/**
 * Nightly Tier Upgrade Cron Job — Issue #832
 *
 * Criteria:
 *  - VERIFIED  → KYC approved (verified = true)          ✓ Blue checkmark
 *  - TRUSTED   → 10+ completed bounties, avg rating ≥ 4.0 ⭐ Gold star
 *  - ELITE     → 50+ bounties, avg rating ≥ 4.5, > 1 year active 💎 Diamond
 *
 * Run via:  node -e "require('./lib/cron/tier-upgrade').runTierUpgrade()"
 * Or schedule in your cron runner (e.g. pg_cron, Inngest, GitHub Actions nightly)
 */

import { prisma } from '@/lib/prisma';
import { VerificationTier } from '@/lib/generated/prisma/client';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Compute the tier a creator *should* have based on current stats.
 */
function computeEligibleTier(profile: {
  verified: boolean;
  completedProjects: number;
  rating: number;
  firstActiveAt: Date | null;
}): VerificationTier {
  const { verified, completedProjects, rating, firstActiveAt } = profile;

  const oneYearAgo = new Date(Date.now() - ONE_YEAR_MS);
  const isOneYearActive =
    firstActiveAt != null && firstActiveAt <= oneYearAgo;

  // Elite: 50+ bounties, rating ≥ 4.5, > 1 year active
  if (
    verified &&
    completedProjects >= 50 &&
    rating >= 4.5 &&
    isOneYearActive
  ) {
    return 'ELITE';
  }

  // Trusted: 10+ bounties, rating ≥ 4.0
  if (verified && completedProjects >= 10 && rating >= 4.0) {
    return 'TRUSTED';
  }

  // Verified: KYC approved
  if (verified) {
    return 'VERIFIED';
  }

  return 'NONE';
}

/**
 * Process a single creator: upgrade tier if needed, record history.
 */
async function processCreator(profile: {
  id: string;
  verified: boolean;
  completedProjects: number;
  rating: number;
  verificationTier: VerificationTier;
  firstActiveAt: Date | null;
}): Promise<{ changed: boolean; previousTier: VerificationTier; newTier: VerificationTier }> {
  const eligibleTier = computeEligibleTier(profile);
  const previousTier = profile.verificationTier;

  if (eligibleTier === previousTier) {
    return { changed: false, previousTier, newTier: eligibleTier };
  }

  const reason = buildReason(profile, eligibleTier);

  // Update profile and write audit history atomically
  await prisma.$transaction([
    prisma.creatorProfile.update({
      where: { id: profile.id },
      data: {
        verificationTier: eligibleTier,
        // Stamp firstActiveAt on first time they become VERIFIED+
        ...(profile.firstActiveAt == null &&
          eligibleTier !== 'NONE' && { firstActiveAt: new Date() }),
      },
    }),
    prisma.tierHistory.create({
      data: {
        creatorProfileId: profile.id,
        previousTier,
        newTier: eligibleTier,
        reason,
        triggeredBy: 'system',
      },
    }),
  ]);

  return { changed: true, previousTier, newTier: eligibleTier };
}

function buildReason(
  profile: { completedProjects: number; rating: number; firstActiveAt: Date | null },
  newTier: VerificationTier,
): string {
  const { completedProjects, rating, firstActiveAt } = profile;
  const yearsActive = firstActiveAt
    ? ((Date.now() - firstActiveAt.getTime()) / (1000 * 60 * 60 * 24 * 365)).toFixed(1)
    : '0';
  return `nightly_cron: tier=${newTier}, bounties=${completedProjects}, rating=${rating.toFixed(2)}, yearsActive=${yearsActive}`;
}

export interface TierUpgradeReport {
  total: number;
  changed: number;
  byNewTier: Record<VerificationTier, number>;
  errors: number;
  durationMs: number;
}

/**
 * Main entry-point: runs tier upgrade for all creators in batches.
 */
export async function runTierUpgrade(
  batchSize = 200,
): Promise<TierUpgradeReport> {
  const startMs = Date.now();
  const report: TierUpgradeReport = {
    total: 0,
    changed: 0,
    byNewTier: { NONE: 0, VERIFIED: 0, TRUSTED: 0, ELITE: 0 },
    errors: 0,
    durationMs: 0,
  };

  let cursor: string | undefined;

  // Paginate through all creators
  while (true) {
    const profiles = await prisma.creatorProfile.findMany({
      take: batchSize,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        verified: true,
        completedProjects: true,
        rating: true,
        verificationTier: true,
        firstActiveAt: true,
      },
    });

    if (profiles.length === 0) break;

    for (const profile of profiles) {
      try {
        const result = await processCreator(profile);
        report.total++;
        if (result.changed) {
          report.changed++;
          report.byNewTier[result.newTier]++;
        }
      } catch (error) {
        report.errors++;
        console.error(
          `[tier-upgrade] Error processing creator ${profile.id}:`,
          error,
        );
      }
    }

    cursor = profiles[profiles.length - 1]?.id;
    if (profiles.length < batchSize) break;
  }

  report.durationMs = Date.now() - startMs;

  console.info(
    `[tier-upgrade] Done: total=${report.total}, changed=${report.changed}, errors=${report.errors}, duration=${report.durationMs}ms`,
  );
  console.info('[tier-upgrade] Breakdown:', report.byNewTier);

  return report;
}

// Allow direct execution: `npx tsx lib/cron/tier-upgrade.ts`
if (require.main === module) {
  runTierUpgrade()
    .then((r) => {
      console.log(r);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
