/**
 * Auth helpers — obtain and cache a session token for authenticated requests.
 */
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL } from '../config/options.js';

const TEST_EMAIL    = __ENV.TEST_EMAIL    || 'test@example.com';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'TestPassword123!';

/**
 * Returns common JSON headers, optionally with a Bearer token.
 * @param {string} [token]
 */
export function jsonHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Logs in via NextAuth credentials and returns the session cookie string.
 * Call once in setup() and pass the result into VU functions.
 */
export function getSessionCookie() {
  const csrfRes = http.get(`${BASE_URL}/api/auth/csrf`);
  const csrfToken = csrfRes.json('csrfToken');

  const loginRes = http.post(
    `${BASE_URL}/api/auth/callback/credentials`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, csrfToken }),
    { headers: { 'Content-Type': 'application/json' }, redirects: 0 },
  );

  check(loginRes, { 'login succeeded': (r) => r.status === 200 || r.status === 302 });

  // Extract Set-Cookie header for subsequent requests
  const setCookie = loginRes.headers['Set-Cookie'] || '';
  return setCookie;
}

/**
 * Returns headers with session cookie for authenticated requests.
 * @param {string} cookie
 */
export function authHeaders(cookie) {
  return {
    'Content-Type': 'application/json',
    Cookie: cookie,
  };
}
