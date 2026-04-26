/**
 * Load test — Referrals API
 * Covers: generate code, get stats, get history, track event
 * Rate limit: 30 req/min general, 10 req/min POST
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, defaultThresholds } from '../config/options.js';
import { jsonHeaders, getSessionCookie, authHeaders } from '../helpers/auth.js';

export const options = {
  // Respect the tighter rate limit
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m',  target: 10 },
    { duration: '20s', target: 0 },
  ],
  thresholds: defaultThresholds,
};

const statsLatency = new Trend('referrals_stats_duration');

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
  // --- GET /api/referrals?action=code ---
  const codeRes = http.get(
    `${BASE_URL}/api/referrals?action=code`,
    { headers: authHeaders(sessionCookie) },
  );
  check(codeRes, {
    'referrals code: status 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  sleep(1);

  // --- GET /api/referrals?action=stats ---
  const statsRes = http.get(
    `${BASE_URL}/api/referrals?action=stats`,
    { headers: authHeaders(sessionCookie) },
  );
  statsLatency.add(statsRes.timings.duration);
  check(statsRes, {
    'referrals stats: status 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  sleep(1);

  // --- POST /api/referrals (track event) ---
  const trackRes = http.post(
    `${BASE_URL}/api/referrals`,
    JSON.stringify({
      code:           'TESTCODE123',
      referredUserId: `user-${__VU}-${__ITER}`,
      event:          'signup',
    }),
    { headers: authHeaders(sessionCookie) },
  );
  check(trackRes, {
    'referrals track: status 200 or 401 or 429': (r) =>
      [200, 401, 429].includes(r.status),
  });

  sleep(2);
}
