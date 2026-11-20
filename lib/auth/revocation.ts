import { prisma } from '@/lib/prisma';

/**
 * Revoked token entry in database
 */
export interface RevokedToken {
  jti: string;
  exp: number;
  createdAt: Date;
}

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
  const now = Date.now();
  if (revoked.exp < now / 1000) {
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
  await prisma.revokedToken.upsert({
    where: { jti },
    update: { exp },
    create: { jti, exp },
  });
}

/**
 * Clean up expired revocation entries
 * @returns number - Number of entries cleaned up
 */
export async function cleanupRevokedTokens(): Promise<number> {
  const now = Date.now();
  const result = await prisma.revokedToken.deleteMany({
    where: { exp: { lt: now / 1000 } },
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
