/**
 * POST /api/notifications/push        send one notification (admin or service)
 * PUT  /api/notifications/push        send a batch (admin or service)
 * GET  /api/notifications/push?action=health
 *
 * Handlers live in server/services/notifications/push-route.ts.
 */
export { POST, PUT, GET } from '@/server/services/notifications/push-route';

export const runtime = 'nodejs';
