import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { createHash, scryptSync, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';

function hashPassword(password: string): string {
  const salt = createHash('sha256').update('stellar-salt').digest();
  const hash = scryptSync(password, salt, 64);
  return hash.toString('hex');
}

function verifyPassword(password: string, stored: string): boolean {
  const salt = createHash('sha256').update('stellar-salt').digest();
  const hash = scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(stored, 'hex');
  if (hash.length !== storedBuf.length) return false;
  return timingSafeEqual(hash, storedBuf);
}

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
  ],
  callbacks: {
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
  },
};

export { hashPassword };
