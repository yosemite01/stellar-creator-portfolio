import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/prisma';
import { isValidStellarAddress } from '@/lib/utils/stellar-address';

/**
 * GET /api/user/wallet-address
 *
 * Retrieves the currently linked Stellar wallet address for the authenticated user.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { walletAddress: true },
  });

  return NextResponse.json({ walletAddress: user?.walletAddress ?? null });
}

/**
 * PATCH /api/user/wallet-address
 *
 * Saves a Stellar public key the user typed/pasted in at signup, after
 * validating its format and checksum. This does NOT prove the user owns
 * the address (that still requires an actual wallet connection/signature
 * at payout time) — it just records where they intend to be paid.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const address = typeof body?.walletAddress === 'string' ? body.walletAddress.trim() : '';

  if (!address) {
    return NextResponse.json({ error: 'walletAddress is required' }, { status: 422 });
  }
  if (!isValidStellarAddress(address)) {
    return NextResponse.json(
      { error: 'That doesn’t look like a valid Stellar address (should start with G, be 56 characters, and have a valid checksum)' },
      { status: 422 }
    );
  }

  const takenByOther = await prisma.user.findFirst({
    where: { walletAddress: address, NOT: { id: session.user.id } },
    select: { id: true },
  });
  if (takenByOther) {
    return NextResponse.json({ error: 'This address is already linked to another account' }, { status: 409 });
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: { walletAddress: address },
    select: { walletAddress: true },
  });

  return NextResponse.json(updated);
}
