import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

export async function GET(request: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  // TODO: Replace with actual DB query against InAppNotification model
  const notifications: any[] = [];

  return NextResponse.json({
    notifications,
    total: 0,
    limit,
    offset,
  });
}
