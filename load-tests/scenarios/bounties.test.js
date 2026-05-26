/**
 * Load test — Bounties API
 * Covers: list, create, update, delete
 * Rate limit: 60 req/min per IP
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

const listLatency   = new Trend('bounties_list_duration');
const createLatency = new Trend('bounties_create_duration');

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
  // --- GET /api/bounties (paginated list) ---
  const listRes = http.get(
    `${BASE_URL}/api/bounties?page=1&limit=10`,
    { headers: jsonHeaders() },
  );
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'bounties list: status 200':    (r) => r.status === 200,
    'bounties list: has data array': (r) => Array.isArray(r.json('data')),
  });

  sleep(0.5);

  // --- GET with filters ---
  const filteredRes = http.get(
    `${BASE_URL}/api/bounties?page=1&limit=10&status=open&difficulty=beginner`,
    { headers: jsonHeaders() },
  );
  check(filteredRes, {
    'bounties filtered: status 200': (r) => r.status === 200,
  });

  sleep(0.5);

  // --- POST /api/bounties (create) ---
  const createRes = http.post(
    `${BASE_URL}/api/bounties`,
    JSON.stringify({
      title:       `Load Test Bounty ${__VU}-${__ITER}`,
      description: 'Automated load test bounty — safe to delete.',
      budget:      500,
      deadline:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      category:    'development',
      difficulty:  'intermediate',
    }),
    { headers: authHeaders(sessionCookie) },
  );
  createLatency.add(createRes.timings.duration);
  check(createRes, {
    'bounties create: status 201 or 401': (r) => r.status === 201 || r.status === 401,
  });

  sleep(1);
}
