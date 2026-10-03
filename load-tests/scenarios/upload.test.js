/**
 * Load test — Upload API
 * Covers: POST /api/upload (multipart, signed-in users only)
 * Note: kept at low VUs — upload is I/O heavy and writes to object storage,
 * so point BASE_URL at an environment with a disposable S3 bucket.
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

let sessionCookie;

export function setup() {
  sessionCookie = getSessionCookie();
}

export default function () {
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
    path: 'load-tests',
  };

  const uploadRes = http.post(`${BASE_URL}/api/upload`, formData, {
    headers: { Cookie: sessionCookie },
  });
  uploadLatency.add(uploadRes.timings.duration);
  check(uploadRes, {
    // 503 means object storage is not configured for this environment.
    'upload: status 200': (r) => r.status === 200,
    'upload: returns a signed url': (r) => r.status !== 200 || Boolean(r.json('signedUrl')),
  });

  sleep(2);
}
