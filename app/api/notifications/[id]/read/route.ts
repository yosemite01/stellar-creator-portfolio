import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/auth';
import { prisma } from '@/lib/db';

export async function PATCH(
 _request: Request,
 { params }: { params: Promise<{ id: string }> },
) {
 const session = await getServerSession();
 if (!session?.user) {
 return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
 }

 const { id } = await params;
 const userId = session.user.id;

 // Update the InAppNotification record in the database.
 // The where clause includes userId to prevent users from
 // marking other users' notifications as read (IDOR protection).
 const updated = await prisma.inAppNotification.updateMany({
 where: {
 id,
 userId,
 read: false,
 },
 data: {
 read: true,
 },
 });

 if (updated.count === 0) {
 // Either the notification doesn't exist, doesn't belong to this
 // user, or is already marked as read.
 const existing = await prisma.inAppNotification.findFirst({
 where: { id, userId },
 select: { id: true, read: true },
 });

 if (!existing) {
 return NextResponse.json(
 { error: 'Notification not found' },
 { status: 404 },
 );
 }

 // Already read — return the current state
 return NextResponse.json({
 id: existing.id,
 status: 'read',
 readAt: existing.read ? new Date().toISOString() : undefined,
 alreadyRead: true,
 });
 }

 // Fetch the updated record to return full details
 const notification = await prisma.inAppNotification.findUnique({
 where: { id },
 select: {
 id: true,
 title: true,
 body: true,
 read: true,
 applicationId: true,
 bountyId: true,
 createdAt: true,
 },
 });

 return NextResponse.json({
 id: notification!.id,
 status: 'read',
 readAt: new Date().toISOString(),
 notification,
 });
}
