import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/db';

export async function PATCH() {
 const session = await getServerSession();
 if (!session?.user) {
 return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const userId = session.user.id;

 // Bulk update all unread InAppNotification records for this user.
 // Uses updateMany for efficient batch operation.
 const result = await prisma.inAppNotification.updateMany({
 where: {
 userId,
 read: false,
 },
 data: {
 read: true,
 },
 });

 return NextResponse.json({
 status: 'ok',
 readAt: new Date().toISOString(),
 updatedCount: result.count,
 });
}
