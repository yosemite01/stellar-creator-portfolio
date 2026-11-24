import type { RevokedToken } from '@/lib/generated/prisma/client';
import { prisma } from '@/lib/prisma';

export type { RevokedToken };

/**
 * Check if a token has been revoked
 * @param jti - Token ID to check
 * @returns boolean - true if token is revoked
 */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  const revoked = await prisma.revokedToken.findUnique({
    where: { jti },
  });

  if (!revoked) {
    return false;
  }

  // Check if revocation has expired (cleanup old entries)
  if (revoked.exp < new Date()) {
    await prisma.revokedToken.delete({ where: { jti } });
    return false;
  }

  return true;
}

/**
 * Mark a token as revoked
 * @param jti - Token ID
 * @param exp - Token expiration timestamp (seconds)
 */
export async function revokeToken(jti: string, exp: number): Promise<void> {
  const expiresAt = new Date(exp * 1000);
  await prisma.revokedToken.upsert({
    where: { jti },
    update: { exp: expiresAt },
    create: { jti, exp: expiresAt },
  });
}

/**
 * Clean up expired revocation entries
 * @returns number - Number of entries cleaned up
 */
export async function cleanupRevokedTokens(): Promise<number> {
  const result = await prisma.revokedToken.deleteMany({
    where: { exp: { lt: new Date() } },
  });

  return result.count;
}

/**
 * Get list of all revoked tokens
 * @returns RevokedToken[]
 */
export async function getRevokedTokens(): Promise<RevokedToken[]> {
  return prisma.revokedToken.findMany({
    orderBy: { createdAt: 'desc' },
  });
}
