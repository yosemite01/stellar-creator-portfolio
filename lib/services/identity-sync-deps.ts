/**
 * Prisma + identity-contract wiring for `server/services/identity-sync.ts`
 * (#1811). Kept separate so the sync logic is testable with plain fakes.
 */
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { IdentitySyncDeps, KycRow } from '@/server/services/identity-sync';
import {
  readKycAttestation,
  revokeKycOnChain,
  verifyKycOnChain,
} from '@/server/services/identity-contract';

type Row = {
  id: string;
  status: KycRow['status'];
  verifiedOnChain: boolean;
  user: { walletAddress: string | null };
};

const select = { id: true, status: true, verifiedOnChain: true, user: { select: { walletAddress: true } } } as const;

const toRow = (r: Row): KycRow => ({
  id: r.id,
  status: r.status,
  verifiedOnChain: r.verifiedOnChain,
  walletAddress: r.user.walletAddress,
});

export const identitySyncDeps: IdentitySyncDeps = {
  async listSubmissions(cursor, take) {
    const rows = (await prisma.kYCSubmission.findMany({
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select,
    })) as Row[];
    return rows.map(toRow);
  },
  async findByWallet(walletAddress) {
    const row = (await prisma.kYCSubmission.findFirst({
      where: { user: { walletAddress } },
      select,
    })) as Row | null;
    return row ? toRow(row) : null;
  },
  async markOnChain(id, verifiedOnChain, txHash) {
    await prisma.kYCSubmission.update({
      where: { id },
      data: { verifiedOnChain, ...(txHash ? { txHash } : {}) },
    });
  },
  async isAttested(walletAddress) {
    return (await readKycAttestation(walletAddress)) !== null;
  },
  verify: (walletAddress, hash) => verifyKycOnChain(walletAddress, hash),
  revoke: (walletAddress) => revokeKycOnChain(walletAddress),
  log: (message, meta) => logger.warn(message, meta),
};
