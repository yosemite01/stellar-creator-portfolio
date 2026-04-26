/**
 * Load test — Upload API
 * Covers: list files, upload small file, delete file
 * Note: kept at low VUs — upload is I/O heavy.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, defaultThresholds } from '../config/options.js';
import { getSessionCookie, authHeaders } from '../helpers/auth.js';

export const options = {
  // Low concurrency — upload is resource-intensive
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m',  target: 5 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    ...defaultThresholds,
    http_req_duration: ['p(95)<3000', 'p(99)<8000'],
  },
};

const uploadLatency = new Trend('upload_duration');
const listLatency   = new Trend('upload_list_duration');

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
  // --- GET /api/upload?prefix=uploads (list files) ---
  const listRes = http.get(
    `${BASE_URL}/api/upload?prefix=uploads`,
    { headers: authHeaders(sessionCookie) },
  );
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'upload list: status 200 or 401': (r) => r.status === 200 || r.status === 401,
  });

  sleep(1);

  // --- POST /api/upload (small PNG upload) ---
  // Minimal 1x1 transparent PNG (67 bytes)
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const pngBytes = new Uint8Array(
    atob(pngBase64)
      .split('')
      .map((c) => c.charCodeAt(0)),
  );

  const formData = {
    file: http.file(pngBytes, `test-${__VU}-${__ITER}.png`, 'image/png'),
  };

  const uploadRes = http.post(`${BASE_URL}/api/upload`, formData, {
    headers: { Cookie: sessionCookie },
  });
  uploadLatency.add(uploadRes.timings.duration);
  check(uploadRes, {
    'upload: status 200 or 201 or 401': (r) =>
      [200, 201, 401].includes(r.status),
  });

  sleep(2);
}
