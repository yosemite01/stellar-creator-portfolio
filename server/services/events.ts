/**
 * Domain Event Bus — Issue #1335
 *
 * Pub-sub infrastructure for domain events that decouple side-effects
 * (emails, notifications, audit logs) from core business logic.
 *
 * Design principles:
 *  - Typed events: every event has a discriminated-union `type` field.
 *  - Non-blocking: listener errors are caught and logged; they never
 *    propagate back to the emitter or block the main request path.
 *  - Wildcard subscriptions: handlers may subscribe to '*' to receive
 *    all events (useful for logging / telemetry).
 *  - Subscription webhooks: `subscribeWebhook` registers an async HTTP
 *    callback that is invoked (fire-and-forget) on matching events.
 */

import EventEmitter from 'events';
import { prisma } from '@/lib/prisma';

// ── Typed domain events ──────────────────────────────────────────────────────

export interface BountyCreatedPayload {
  bountyId: string;
  creatorId: string;
  title: string;
  budget: number;
  category?: string | null;
}

export interface BountyUpdatedPayload {
  bountyId: string;
  creatorId: string;
  changes: Record<string, unknown>;
}

export interface ApplicationSubmittedPayload {
  applicationId: string;
  bountyId: string;
  applicantId: string;
  proposedBudget: number;
}

export interface ApplicationStatusChangedPayload {
  applicationId: string;
  bountyId: string;
  applicantId: string;
  status: 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN';
}

export interface UserRegisteredPayload {
  userId: string;
  email: string;
  name?: string | null;
}

export interface EscrowCreatedPayload {
  escrowId: string;
  bountyId: string;
  payerAddress: string;
  payeeAddress: string;
  amount: number;
}

// Discriminated union of all domain events
export type DomainEventMap = {
  BountyCreated: BountyCreatedPayload;
  BountyUpdated: BountyUpdatedPayload;
  ApplicationSubmitted: ApplicationSubmittedPayload;
  ApplicationStatusChanged: ApplicationStatusChangedPayload;
  UserRegistered: UserRegisteredPayload;
  EscrowCreated: EscrowCreatedPayload;
};

export type DomainEventType = keyof DomainEventMap;

export interface DomainEvent<T extends DomainEventType = DomainEventType> {
  type: T;
  payload: DomainEventMap[T];
  eventId: string;
  createdAt: string;
}

// ── Webhook subscription registry ────────────────────────────────────────────

export interface WebhookSubscription {
  id: string;
  /** The event type to listen for, or '*' for all events. */
  eventType: DomainEventType | '*';
  /** Full URL to POST the event payload to. */
  url: string;
  /** Optional secret added as `X-Webhook-Secret` header for signature verification. */
  secret?: string;
  createdAt: string;
}

const webhookRegistry: WebhookSubscription[] = [];

/**
 * Register an HTTP webhook that will be called (fire-and-forget) whenever
 * a matching domain event is emitted.
 */
export function subscribeWebhook(
  eventType: DomainEventType | '*',
  url: string,
  secret?: string,
): WebhookSubscription {
  const sub: WebhookSubscription = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    url,
    secret,
    createdAt: new Date().toISOString(),
  };
  webhookRegistry.push(sub);
  return sub;
}

/** Remove a previously registered webhook by its id. */
export function unsubscribeWebhook(id: string): boolean {
  const idx = webhookRegistry.findIndex((w) => w.id === id);
  if (idx === -1) return false;
  webhookRegistry.splice(idx, 1);
  return true;
}

/** @internal — exposed only for tests. */
export function _getWebhookRegistry(): Readonly<WebhookSubscription[]> {
  return webhookRegistry;
}

async function dispatchWebhooks(event: DomainEvent): Promise<void> {
  const targets = webhookRegistry.filter(
    (w) => w.eventType === '*' || w.eventType === event.type,
  );

  for (const wh of targets) {
    // Fire-and-forget — never block the event loop
    Promise.resolve().then(async () => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Event-Type': event.type,
          'X-Event-Id': event.eventId,
        };
        if (wh.secret) headers['X-Webhook-Secret'] = wh.secret;

        await fetch(wh.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        console.error(`[EventBus] Webhook dispatch failed (${wh.id} → ${wh.url}):`, err);
      }
    });
  }
}

// ── Idempotency registry ─────────────────────────────────────────────────────

/**
 * Tracks eventIds that have already been processed by a listener so that
 * side-effects (emails, notifications) are only enqueued once per event.
 * Keyed by `${listenerKey}:${eventId}`.
 */
const processedEventIds = new Set<string>();

/**
 * Atomically claim an event for a given listener. Returns `true` the first
 * time a given (listenerKey, eventId) pair is seen, `false` on replays.
 */
export function claimEvent(listenerKey: string, eventId: string): boolean {
  const key = `${listenerKey}:${eventId}`;
  if (processedEventIds.has(key)) return false;
  processedEventIds.add(key);
  return true;
}

/** Check if an event was already claimed/processed by a given listener. */
export function isEventProcessed(listenerKey: string, eventId: string): boolean {
  return processedEventIds.has(`${listenerKey}:${eventId}`);
}

/** @internal — exposed only for tests. */
export function _resetProcessedEvents(): void {
  processedEventIds.clear();
}

// ── Core event bus ───────────────────────────────────────────────────────────

class DomainEventBus extends EventEmitter {
  constructor() {
    super();
    // Increase default listener limit to avoid warnings in larger apps
    this.setMaxListeners(50);
  }

  /**
   * Emit a typed domain event.
   * All registered listeners (and webhooks) are invoked asynchronously and
   * non-blocking. Listener errors are caught internally.
   */
  emit<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): boolean {
    const event: DomainEvent<T> = {
      type,
      payload,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: new Date().toISOString(),
    };

    // Dispatch to Node EventEmitter listeners
    super.emit(type, event);
    // Dispatch to wildcard listeners
    super.emit('*', event);
    // Dispatch to webhook subscribers (async, fire-and-forget)
    void dispatchWebhooks(event);

    return true;
  }

  /**
   * Register a typed listener for a specific event type.
   * Errors thrown inside the listener are caught and logged.
   */
  on<T extends DomainEventType>(
    type: T,
    handler: (event: DomainEvent<T>) => void | Promise<void>,
  ): this {
    const safe = async (event: DomainEvent<T>) => {
      try {
        await handler(event);
      } catch (err) {
        console.error(`[EventBus] Listener error on "${type}":`, err);
      }
    };
    return super.on(type, safe as any);
  }

  /** Subscribe to all events (wildcard). */
  onAny(handler: (event: DomainEvent) => void | Promise<void>): this {
    const safe = async (event: DomainEvent) => {
      try {
        await handler(event);
      } catch (err) {
        console.error('[EventBus] Wildcard listener error:', err);
      }
    };
    return super.on('*', safe as any);
  }
}

// Singleton bus — imported by services and listeners
const bus = new DomainEventBus();

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Emit a typed domain event onto the global bus.
 *
 * @example
 * emitEvent('BountyCreated', { bountyId: '...', creatorId: '...', title: '...', budget: 500 });
 */
export function emitEvent<T extends DomainEventType>(
  type: T,
  payload: DomainEventMap[T],
): void {
  bus.emit(type, payload);
}

/**
 * Register a typed listener.
 *
 * @example
 * onEvent('BountyCreated', async ({ payload }) => {
 *   await sendBountyCreatedEmail(payload);
 * });
 */
export function onEvent<T extends DomainEventType>(
  type: T,
  handler: (event: DomainEvent<T>) => void | Promise<void>,
): void {
  bus.on(type, handler);
}

/** Register a listener for every event type (wildcard). */
export function onAnyEvent(
  handler: (event: DomainEvent) => void | Promise<void>,
): void {
  bus.onAny(handler);
}

// ── Outbox Relay Worker & Monitoring (#1759) ─────────────────────────────────

export interface RelayResult {
  processed: number;
  published: number;
  failed: number;
}

/**
 * Polls the outbox table for pending events and publishes them to the event bus.
 */
export async function relayOutboxEvents(batchSize: number = 20): Promise<RelayResult> {
  const result: RelayResult = { processed: 0, published: 0, failed: 0 };
  try {
    const pendingEvents = await (prisma as any).outboxEvent?.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    if (!pendingEvents || pendingEvents.length === 0) {
      return result;
    }

    for (const record of pendingEvents) {
      result.processed++;
      try {
        bus.emit(record.eventType as DomainEventType, record.payload as any);

        await (prisma as any).outboxEvent?.update({
          where: { id: record.id },
          data: {
            status: 'PUBLISHED',
            processedAt: new Date(),
          },
        });
        result.published++;
      } catch (err: any) {
        result.failed++;
        const nextRetries = (record.retryCount ?? 0) + 1;
        const maxRetries = record.maxRetries ?? 5;
        await (prisma as any).outboxEvent?.update({
          where: { id: record.id },
          data: {
            status: nextRetries >= maxRetries ? 'FAILED' : 'PENDING',
            retryCount: nextRetries,
            lastError: err?.message ?? String(err),
          },
        });
      }
    }
  } catch (err) {
    console.error('[EventBus] Relay outbox worker error:', err);
  }
  return result;
}

/**
 * Monitoring metrics for the transactional outbox queue.
 */
export async function getOutboxStats(): Promise<{
  pending: number;
  processing: number;
  published: number;
  failed: number;
  oldestPendingCreatedAt: Date | null;
}> {
  try {
    const [pending, published, failed, oldest] = await Promise.all([
      (prisma as any).outboxEvent?.count({ where: { status: 'PENDING' } }) ?? 0,
      (prisma as any).outboxEvent?.count({ where: { status: 'PUBLISHED' } }) ?? 0,
      (prisma as any).outboxEvent?.count({ where: { status: 'FAILED' } }) ?? 0,
      (prisma as any).outboxEvent?.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      pending,
      processing: 0,
      published,
      failed,
      oldestPendingCreatedAt: oldest?.createdAt ?? null,
    };
  } catch {
    return {
      pending: 0,
      processing: 0,
      published: 0,
      failed: 0,
      oldestPendingCreatedAt: null,
    };
  }
}

export default bus;
