import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

export async function PATCH() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // TODO: Bulk update InAppNotification records in DB
  return NextResponse.json({ status: 'ok', readAt: new Date().toISOString() });
}
