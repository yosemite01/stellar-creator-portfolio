import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // TODO: Update InAppNotification record in DB
  return NextResponse.json({ id, status: 'read', readAt: new Date().toISOString() });
}
