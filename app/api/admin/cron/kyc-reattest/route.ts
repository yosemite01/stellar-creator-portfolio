import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyKycOnChain } from '@/server/services/identity-contract';
import { readKycAttestationOnChain, reattestExpiringKyc } from '@/server/services/kyc-reattest';

/**
 * POST /api/admin/cron/kyc-reattest
 *
 * Re-issues on-chain KYC attestations before they expire or after they were
 * invalidated by an issuer key rotation (Issue #1717). Trigger daily.
 * Authorization: valid cron secret in the X-Cron-Secret header.
 */
function authorized(req: NextRequest): boolean {
  const provided = req.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized: Invalid or missing cron secret' }, { status: 401 });
  }
  try {
    const result = await reattestExpiringKyc({
      listCandidates: async () => {
        const rows = await prisma.kYCSubmission.findMany({
          where: { status: 'APPROVED', verifiedOnChain: true, user: { walletAddress: { not: null } } },
          select: { id: true, user: { select: { walletAddress: true } } },
        });
        return rows
          .filter((r) => r.user.walletAddress)
          .map((r) => ({ id: r.id, walletAddress: r.user.walletAddress as string }));
      },
      readAttestation: readKycAttestationOnChain,
      reattest: verifyKycOnChain,
    });
    logger.info('KYC re-attestation complete', { ...result });
    return NextResponse.json({ success: result.failed === 0, ...result });
  } catch (error) {
    logger.error('KYC re-attestation cron failed', { err: String(error) });
    return NextResponse.json({ error: 'KYC re-attestation failed' }, { status: 500 });
  }
}
