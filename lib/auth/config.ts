import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { createHash, randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { upsertOAuthUser } from '@/lib/auth/oauth-user';
import { loadPrivateKey, getKeyId, loadPublicKey } from '@/lib/auth/keys';
import { revokeToken } from '@/lib/auth/revocation';

// Legacy scheme (pre-fix): every account shared this one hardcoded salt,
// which defeats the point of salting. Kept only so accounts hashed before
// this fix can still log in; verifyPassword upgrades them to the new
// per-user random-salt format on successful login.
const LEGACY_SALT = createHash('sha256').update('stellar-salt').digest();

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const sepIndex = stored.indexOf(':');
  if (sepIndex === -1) {
    // Legacy fixed-salt hash — no embedded salt.
    const hash = scryptSync(password, LEGACY_SALT, 64);
    const storedBuf = Buffer.from(stored, 'hex');
    if (hash.length !== storedBuf.length) return false;
    return timingSafeEqual(hash, storedBuf);
  }

  const salt = Buffer.from(stored.slice(0, sepIndex), 'hex');
  const storedHash = Buffer.from(stored.slice(sepIndex + 1), 'hex');
  const hash = scryptSync(password, salt, 64);
  if (hash.length !== storedHash.length) return false;
  return timingSafeEqual(hash, storedHash);
}

// Asymmetric JWT configuration
const RSA_PRIVATE_KEY = loadPrivateKey();
const KEY_ID = getKeyId();

// Token expiration times
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/auth/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user?.password || !user.emailVerified) return null;
        if (!verifyPassword(credentials.password, user.password)) return null;

        // Transparently upgrade legacy fixed-salt hashes to the new
        // per-user random-salt format now that we know the plaintext.
        if (!user.password.includes(':')) {
          await prisma.user.update({
            where: { id: user.id },
            data: { password: hashPassword(credentials.password) },
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: user.emailVerified?.toISOString() ?? null,
          onboardingCompleted: !!user.onboardingCompletedAt,
        };
      },
    }),
    // Only registered when real credentials are configured, so a missing
    // GOOGLE_CLIENT_ID doesn't surface a "Continue with Google" button that
    // can't actually work.
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    // Google doesn't go through `authorize()` above, so it never gets our
    // internal user id/role/onboarding state. Look up (or create, on first
    // sign-in) the matching User row and graft those fields onto `user`
    // here — `jwt` below then treats both providers identically.
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;
      if (!user.email) return false;

      const dbUser = await upsertOAuthUser({
        email: user.email,
        name: user.name,
        image: user.image,
      });

      user.id = dbUser.id;
      (user as { role?: string }).role = dbUser.role;
      (user as { emailVerified?: string | null }).emailVerified =
        dbUser.emailVerified?.toISOString() ?? null;
      (user as { onboardingCompleted?: boolean }).onboardingCompleted =
        !!dbUser.onboardingCompletedAt;
      return true;
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.emailVerified = (user as { emailVerified?: string | null }).emailVerified ?? null;
        token.onboardingCompleted = (user as { onboardingCompleted?: boolean }).onboardingCompleted ?? false;
      }
      if (trigger === 'update' && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { onboardingCompletedAt: true, emailVerified: true, role: true },
        });
        if (dbUser) {
          token.onboardingCompleted = !!dbUser.onboardingCompletedAt;
          token.emailVerified = dbUser.emailVerified?.toISOString() ?? null;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? 'USER';
      }
      return session;
    },
    // Custom JWT signing callback to add JTI and use asymmetric signing
    async jwtSign({ token }) {
      // Generate unique token ID for revocation tracking
      const jti = randomUUID();
      const now = Date.now();
      
      // Create token payload
      const payload = {
        ...token,
        jti,
        iat: Math.floor(now / 1000),
        exp: Math.floor((now + ACCESS_TOKEN_TTL_MS) / 1000),
        iss: 'stellar-creator-portfolio',
        aud: 'stellar-creator-portfolio',
      };

      // Sign with RSA private key (RS256)
      const signer = crypto.createSign('sha256');
      signer.update(JSON.stringify(payload));
      const signature = signer.sign(RSA_PRIVATE_KEY);

      return {
        payload,
        signature: signature.toString('base64url'),
        keyId: KEY_ID,
      };
    },
  },
};

export { hashPassword };

// Export public key for external verification
export const AUTH_PUBLIC_KEY = loadPublicKey();
