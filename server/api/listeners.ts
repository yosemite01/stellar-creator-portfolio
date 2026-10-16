/**
 * Domain Event Listeners — Issue #1335
 *
 * All application-level side-effects wired to domain events.
 * This file is imported once at application startup (e.g. in next.config or
 * a server entry point) to register all handlers.
 *
 * Listeners:
 *  - Never block the main request path (async, errors are caught internally).
 *  - Are responsible for email queuing, notification dispatch, etc.
 *  - Should delegate heavy work to queues/workers rather than doing it inline.
 */

import { onEvent, onAnyEvent } from '@/server/services/events';
import { logger } from '@/lib/logger';

// ── BountyCreated ─────────────────────────────────────────────────────────────

/**
 * When a bounty is created:
 *  1. Trigger a confirmation email to the creator (queued, non-blocking).
 *  2. Notify matched creators about the new opportunity.
 */
onEvent('BountyCreated', async ({ payload, eventId, createdAt }) => {
  // TODO: replace with actual email service call
  // e.g. await emailQueue.enqueue('bounty-created', { bountyId: payload.bountyId, ... })
  logger.info('BountyCreated', {
    eventId,
    createdAt,
    bountyId: payload.bountyId,
    creatorId: payload.creatorId,
    title: payload.title,
    budget: payload.budget,
  });
  // Non-blocking: push email job to queue
  // await notificationService.notifyMatchedCreators(payload.bountyId);
});

// ── BountyUpdated ─────────────────────────────────────────────────────────────

/**
 * When a bounty is updated, notify active applicants of the changes.
 */
onEvent('BountyUpdated', async ({ payload }) => {
  logger.info('BountyUpdated', {
    bountyId: payload.bountyId,
    changes: Object.keys(payload.changes).join(','),
  });
  // await notificationService.notifyApplicantsOfBountyUpdate(payload.bountyId, payload.changes);
});

// ── ApplicationSubmitted ──────────────────────────────────────────────────────

/**
 * When an application is submitted:
 *  1. Send receipt email to applicant.
 *  2. Notify bounty creator of new application.
 */
onEvent('ApplicationSubmitted', async ({ payload }) => {
  logger.info('ApplicationSubmitted', {
    applicationId: payload.applicationId,
    bountyId: payload.bountyId,
    applicantId: payload.applicantId,
  });
  // await emailQueue.enqueue('application-received', payload);
  // await emailQueue.enqueue('new-applicant-alert', { bountyId: payload.bountyId, ... });
});

// ── ApplicationStatusChanged ──────────────────────────────────────────────────

/**
 * When an application status changes, email the applicant with the outcome.
 */
onEvent('ApplicationStatusChanged', async ({ payload }) => {
  logger.info('ApplicationStatusChanged', {
    applicationId: payload.applicationId,
    status: payload.status,
    applicantId: payload.applicantId,
  });
  // await emailQueue.enqueue('application-status-update', payload);
});

// ── UserRegistered ────────────────────────────────────────────────────────────

/**
 * Send a welcome email on new user registration.
 */
onEvent('UserRegistered', async ({ payload }) => {
  logger.info('UserRegistered', {
    userId: payload.userId,
    email: payload.email,
  });
  // await emailQueue.enqueue('welcome', { to: payload.email, name: payload.name });
});

// ── EscrowCreated ─────────────────────────────────────────────────────────────

/**
 * Notify both parties when an escrow is created.
 */
onEvent('EscrowCreated', async ({ payload }) => {
  logger.info('EscrowCreated', {
    escrowId: payload.escrowId,
    bountyId: payload.bountyId,
    amount: payload.amount,
  });
  // await notificationService.notifyEscrowCreated(payload);
});

// ── Wildcard telemetry listener ───────────────────────────────────────────────

/**
 * Wildcard hook — receives every event.
 * Useful for analytics, dead-letter queues, and telemetry.
 */
onAnyEvent(async ({ type, eventId, createdAt }) => {
  // Structured telemetry log — replace with OpenTelemetry span if needed
  if (process.env.NODE_ENV !== 'test') {
    logger.debug('EventBus:telemetry', { type, eventId, createdAt: String(createdAt) });
  }
});

export {};
