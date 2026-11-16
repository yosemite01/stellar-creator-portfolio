import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { syncCreatorProfileCompletion } from '@/server/services/profile-events';

export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await syncCreatorProfileCompletion(session.user.id);
  return NextResponse.json(result);
}

export async function POST() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await syncCreatorProfileCompletion(session.user.id);
  return NextResponse.json(result);
}
