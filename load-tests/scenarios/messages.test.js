/**
 * Load test — Messages API (HTTP)
 * Note: WebSocket load testing requires k6 websockets module.
 * This file covers the HTTP GET/POST endpoints.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, averageLoadOptions, defaultThresholds } from '../config/options.js';
import { jsonHeaders, getSessionCookie, authHeaders } from '../helpers/auth.js';

export const options = {
  ...averageLoadOptions,
  thresholds: defaultThresholds,
};

const sendLatency = new Trend('messages_send_duration');
const getLatency  = new Trend('messages_get_duration');

const THREAD_IDS = ['thread-1', 'thread-2', 'thread-3'];

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
  const threadId = THREAD_IDS[__ITER % THREAD_IDS.length];

  // --- GET /api/messages?threadId= ---
  const getRes = http.get(
    `${BASE_URL}/api/messages?threadId=${threadId}`,
    { headers: authHeaders(sessionCookie) },
  );
  getLatency.add(getRes.timings.duration);
  check(getRes, {
    'messages get: status 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  sleep(0.5);

  // --- POST /api/messages (send) ---
  const sendRes = http.post(
    `${BASE_URL}/api/messages`,
    JSON.stringify({
      threadId:    threadId,
      recipientId: 'user-2',
      ciphertext:  btoa(`load-test-message-${__VU}-${__ITER}`),
      iv:          btoa('test-iv-16bytes!!'),
    }),
    { headers: authHeaders(sessionCookie) },
  );
  sendLatency.add(sendRes.timings.duration);
  check(sendRes, {
    'messages send: status 201 or 401': (r) => r.status === 201 || r.status === 401,
  });

  sleep(1);
}
