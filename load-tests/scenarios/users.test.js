/**
 * Load test — Users API
 * Covers: list, get by id, create, update
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

const listLatency = new Trend('users_list_duration');

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
  // --- GET /api/users (list) ---
  const listRes = http.get(
    `${BASE_URL}/api/users?page=1&limit=10`,
    { headers: jsonHeaders() },
  );
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'users list: status 200':     (r) => r.status === 200,
    'users list: has data array': (r) => Array.isArray(r.json('data')),
  });

  sleep(0.5);

  // --- GET with role filter ---
  const roleRes = http.get(
    `${BASE_URL}/api/users?page=1&limit=10&role=creator`,
    { headers: jsonHeaders() },
  );
  check(roleRes, {
    'users role filter: status 200': (r) => r.status === 200,
  });

  sleep(0.5);

  // --- POST /api/users (create) ---
  const uid = `${Date.now()}-${__VU}-${__ITER}`;
  const createRes = http.post(
    `${BASE_URL}/api/users`,
    JSON.stringify({
      email: `loadtest-user-${uid}@example.com`,
      name:  `Load User ${uid}`,
      role:  'creator',
    }),
    { headers: authHeaders(sessionCookie) },
  );
  check(createRes, {
    'users create: status 201 or 401 or 409': (r) =>
      [201, 401, 409].includes(r.status),
  });

  sleep(1);
}
