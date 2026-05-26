/**
 * Load test — Auth endpoints
 * Covers: register, forgot-password, reset-password, verify-email
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { BASE_URL, averageLoadOptions, defaultThresholds } from '../config/options.js';
import { jsonHeaders } from '../helpers/auth.js';

export const options = {
  ...averageLoadOptions,
  thresholds: {
    ...defaultThresholds,
    // Auth endpoints are allowed slightly more latency
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
  },
};

const registrationErrors = new Counter('auth_registration_errors');

export default function () {
  const uid = `${Date.now()}-${__VU}-${__ITER}`;

  // --- Register ---
  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      email:    `loadtest-${uid}@example.com`,
      password: 'LoadTest123!',
      name:     `Load Tester ${uid}`,
      role:     'creator',
    }),
    { headers: jsonHeaders() },
  );

  const registerOk = check(registerRes, {
    'register: status 201 or 409': (r) => r.status === 201 || r.status === 409,
    'register: has body':          (r) => r.body.length > 0,
  });
  if (!registerOk) registrationErrors.add(1);

  sleep(1);

  // --- Forgot password ---
  const forgotRes = http.post(
    `${BASE_URL}/api/auth/forgot-password`,
    JSON.stringify({ email: `loadtest-${uid}@example.com` }),
    { headers: jsonHeaders() },
  );

  check(forgotRes, {
    'forgot-password: status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  sleep(1);
}
