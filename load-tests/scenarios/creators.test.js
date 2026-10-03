/**
 * Load test — Creator directory (tRPC)
 * Covers: creators.list (first page, discipline filter, search),
 *         creators.featured and creators.get
 *
 * The directory is served through tRPC at /api/trpc/<procedure>; there is
 * no REST /api/creators list. Creator profiles are created through the
 * onboarding flow, not a public create endpoint, so this scenario is
 * read-only.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, averageLoadOptions, defaultThresholds } from '../config/options.js';
import { jsonHeaders } from '../helpers/auth.js';

export const options = {
  ...averageLoadOptions,
  thresholds: defaultThresholds,
};

const listLatency = new Trend('creators_list_duration');
const getLatency  = new Trend('creators_get_duration');

const DISCIPLINES = ['UI/UX Design', 'Writing', 'Development', 'Marketing'];
const SEARCH_TERMS = ['design', 'react', 'brand', 'content'];

function trpcQuery(procedure, input) {
  return http.get(
    `${BASE_URL}/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`,
    { headers: jsonHeaders() },
  );
}

export default function () {
  // --- creators.list: first page ---
  const listRes = trpcQuery('creators.list', { take: 10 });
  listLatency.add(listRes.timings.duration);
  check(listRes, {
    'creators list: status 200': (r) => r.status === 200,
    'creators list: has creators': (r) => Array.isArray(r.json('result.data.creators')),
  });

  sleep(0.5);

  // --- creators.list: discipline filter and search ---
  const discipline = DISCIPLINES[__ITER % DISCIPLINES.length];
  const filteredRes = trpcQuery('creators.list', { take: 10, discipline });
  check(filteredRes, { 'creators filtered: status 200': (r) => r.status === 200 });

  const search = SEARCH_TERMS[__ITER % SEARCH_TERMS.length];
  const searchRes = trpcQuery('creators.list', { take: 10, search });
  check(searchRes, { 'creators search: status 200': (r) => r.status === 200 });

  sleep(0.5);

  // --- creators.featured ---
  const featuredRes = trpcQuery('creators.featured', { limit: 3 });
  check(featuredRes, { 'creators featured: status 200': (r) => r.status === 200 });

  // --- creators.get for one creator from the list ---
  const creators = listRes.status === 200 ? listRes.json('result.data.creators') : [];
  if (creators && creators.length > 0) {
    const id = creators[__ITER % creators.length].id;
    const getRes = trpcQuery('creators.get', { id });
    getLatency.add(getRes.timings.duration);
    check(getRes, { 'creators get: status 200': (r) => r.status === 200 });
  }

  sleep(1);
}
