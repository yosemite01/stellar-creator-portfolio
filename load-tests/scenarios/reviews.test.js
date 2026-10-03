/**
 * Load test — Reviews API (Rust service, /api/v1)
 * Covers: list a creator's reviews, list all reviews, submit a review
 * Target: RUST_API_URL (backend/services/api), not the Next.js app.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { RUST_API_URL, defaultThresholds } from '../config/options.js';
import { jsonHeaders } from '../helpers/auth.js';

export const options = {
  // Reviews have a tighter rate limit — keep VUs lower
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m',  target: 10 },
    { duration: '20s', target: 0 },
  ],
  thresholds: defaultThresholds,
};

const listLatency   = new Trend('reviews_list_duration');
const createLatency = new Trend('reviews_create_duration');

// Creator and reviewer Stellar addresses. Override with real ones via
// CREATOR_ADDRESSES (comma-separated) for representative results.
const CREATOR_ADDRESSES = (__ENV.CREATOR_ADDRESSES ||
  'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H').split(',');
const REVIEWER_ADDRESS = __ENV.REVIEWER_ADDRESS ||
  'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

export default function () {
  const creator = CREATOR_ADDRESSES[__ITER % CREATOR_ADDRESSES.length];

  // --- GET /api/v1/creators/:id/reviews ---
  const listRes = http.get(
    `${RUST_API_URL}/api/v1/creators/${creator}/reviews?sortBy=createdAt&sortOrder=desc&page=1&limit=10`,
    { headers: jsonHeaders() },
  );
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'creator reviews: status 200': (r) => r.status === 200,
  });

  // --- GET /api/v1/reviews (all reviews, filtered) ---
  const allRes = http.get(
    `${RUST_API_URL}/api/v1/reviews?minRating=3&page=1&limit=10`,
    { headers: jsonHeaders() },
  );
  check(allRes, {
    'all reviews: status 200': (r) => r.status === 200,
  });

  sleep(1);

  // --- POST /api/v1/reviews (submit) ---
  const createRes = http.post(
    `${RUST_API_URL}/api/v1/reviews`,
    JSON.stringify({
      creator_address: creator,
      reviewer_address: REVIEWER_ADDRESS,
      bounty_id: null,
      rating: 4,
      comment: 'Automated load-test review. Please disregard.',
    }),
    { headers: jsonHeaders() },
  );
  createLatency.add(createRes.timings.duration);
  check(createRes, {
    'reviews create: accepted or rate-limited': (r) =>
      [200, 201, 429].includes(r.status),
  });

  sleep(2);
}
