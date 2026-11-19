/**
 * Secret used to sign and verify API bearer tokens.
 * 
 * @deprecated Use getSecretValue('JWT_SECRET') from @/server/services/secrets instead
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}