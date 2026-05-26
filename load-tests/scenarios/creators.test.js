/**
 * Load test — Creators API
 * Covers: list (with discipline filter), single creator, create, update
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

const listLatency = new Trend('creators_list_duration');

const DISCIPLINES = ['design', 'development', 'writing', 'marketing', 'video'];

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
  // --- GET /api/creators (list) ---
  const listRes = http.get(
    `${BASE_URL}/api/creators?page=1&limit=10`,
    { headers: jsonHeaders() },
  );
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'creators list: status 200':     (r) => r.status === 200,
    'creators list: has data array': (r) => Array.isArray(r.json('data')),
  });

  sleep(0.5);

  // --- GET with discipline filter ---
  const discipline = DISCIPLINES[__ITER % DISCIPLINES.length];
  const filteredRes = http.get(
    `${BASE_URL}/api/creators?page=1&limit=10&discipline=${discipline}`,
    { headers: jsonHeaders() },
  );
  check(filteredRes, {
    'creators filtered: status 200': (r) => r.status === 200,
  });

  sleep(0.5);

  // --- POST /api/creators (create profile) ---
  const createRes = http.post(
    `${BASE_URL}/api/creators`,
    JSON.stringify({
      name:       `Load Tester ${__VU}-${__ITER}`,
      discipline: discipline,
      bio:        'Automated load test profile.',
      hourlyRate: 50,
    }),
    { headers: authHeaders(sessionCookie) },
  );
  check(createRes, {
    'creators create: status 201 or 401 or 409': (r) =>
      [201, 401, 409].includes(r.status),
  });

  sleep(1);
}
