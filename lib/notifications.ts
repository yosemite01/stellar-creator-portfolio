/**
 * Unified Notification Dispatcher (#1758)
 *
 * Exposes notification persistence and multi-channel dispatch honoring
 * preferences (email, push, SMS, and in-app).
 *
 * Web Push hygiene (#1820):
 * - Subscriptions that the push service reports as gone (404/410) are pruned.
 * - VAPID keys can be rotated; clients re-subscribe via the current public key.
 * - Delivery outcomes and key rotations emit metrics.
 */
import { prisma } from '@/lib/prisma';
export {
  dispatchNotification,
  notificationDispatcher,
  type DispatchNotificationRequest,
  type DispatchNotificationResult,
  type DispatchChannel,
} from '@/server/services/notifications/dispatcher';

export interface InAppNotificationInput {
  id: string;
  userId: string;
  title: string;
  body: string;
  read: boolean;
  applicationId?: string;
  bountyId?: string;
  createdAt: string;
}

/**
 * Persist a fire-and-forget copy of an in-app notification to the
 * InAppNotification table. Never throws.
 */
export async function persistInAppNotification(
  record: InAppNotificationInput,
): Promise<void> {
  try {
    await prisma.inAppNotification.create({
      data: {
        id: record.id,
        userId: record.userId,
        title: record.title,
        body: record.body,
        read: record.read,
        applicationId: record.applicationId ?? null,
        bountyId: record.bountyId ?? null,
        createdAt: new Date(record.createdAt),
      },
    });
  } catch (error) {
    console.error('[persistInAppNotification] failed to persist notification:', error);
  }
}

// ---------------------------------------------------------------------------
// Web Push: VAPID key rotation + subscription hygiene (#1820)
// ---------------------------------------------------------------------------

export type PushDeliveryOutcome = 'success' | 'pruned' | 'failure';

export interface PushMetrics {
  success: number;
  pruned: number;
  failure: number;
  keyRotations: number;
}

const pushMetrics: PushMetrics = {
  success: 0,
  pruned: 0,
  failure: 0,
  keyRotations: 0,
};

/** Snapshot of push delivery / rotation counters (for metrics endpoints). */
export function getPushMetrics(): PushMetrics {
  return { ...pushMetrics };
}

/** Reset counters — used by tests. */
export function resetPushMetrics(): void {
  pushMetrics.success = 0;
  pushMetrics.pruned = 0;
  pushMetrics.failure = 0;
  pushMetrics.keyRotations = 0;
}

function recordPushOutcome(outcome: PushDeliveryOutcome): void {
  pushMetrics[outcome] += 1;
}

/**
 * A push service reports a subscription as gone via 404 (Not Found) or
 * 410 (Gone). Both mean the endpoint is permanently invalid.
 */
export function isGoneStatus(status: number | undefined | null): boolean {
  return status === 404 || status === 410;
}

/**
 * Prune a single push subscription by endpoint. Returns true when a row was
 * removed. Never throws — pruning is best-effort hygiene.
 */
export async function prunePushSubscription(endpoint: string): Promise<boolean> {
  try {
    const result = await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    return result.count > 0;
  } catch (error) {
    console.error('[prunePushSubscription] failed to prune subscription:', error);
    return false;
  }
}

/**
 * Handle the result of a push send. On 404/410 the subscription is pruned and
 * the outcome is recorded as `pruned`; otherwise success/failure is recorded.
 * Returns the outcome so callers can branch on it.
 */
export async function handlePushDeliveryResult(
  endpoint: string,
  status: number | undefined | null,
): Promise<PushDeliveryOutcome> {
  if (isGoneStatus(status)) {
    await prunePushSubscription(endpoint);
    recordPushOutcome('pruned');
    return 'pruned';
  }
  const outcome: PushDeliveryOutcome =
    status !== undefined && status !== null && status >= 200 && status < 300
      ? 'success'
      : 'failure';
  recordPushOutcome(outcome);
  return outcome;
}

/**
 * Rotate the VAPID key pair. The new public key is returned so clients can
 * re-subscribe; existing subscriptions are invalidated (they were bound to the
 * old key) and must be re-registered by the client.
 *
 * The caller supplies the new key material (generated out of band) so this
 * module never invents secrets.
 */
export async function rotateVapidKeys(newPublicKey: string): Promise<{
  publicKey: string;
  invalidated: number;
}> {
  if (!newPublicKey) {
    throw new Error('rotateVapidKeys requires a non-empty public key');
  }
  let invalidated = 0;
  try {
    const result = await prisma.pushSubscription.deleteMany({});
    invalidated = result.count;
  } catch (error) {
    console.error('[rotateVapidKeys] failed to invalidate subscriptions:', error);
  }
  pushMetrics.keyRotations += 1;
  return { publicKey: newPublicKey, invalidated };
}

/**
 * Re-subscription flow: a client that detects a rotated key fetches the current
 * public key and re-registers its subscription endpoint.
 */
export async function getVapidPublicKey(): Promise<string | null> {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
}

export async function resubscribePush(
  userId: string,
  endpoint: string,
  keys: { p256dh: string; auth: string },
): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
}
