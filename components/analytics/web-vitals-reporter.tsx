'use client';

import { useReportWebVitals } from 'next/web-vitals';
import { usePathname } from 'next/navigation';

const TRACKED = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);

/**
 * Real-user Core Web Vitals collection. Each metric is beaconed to
 * /api/analytics/vitals tagged with the current route so field data can be
 * compared against the per-route budgets in lighthouserc.json.
 */
export function WebVitalsReporter() {
  const pathname = usePathname();

  useReportWebVitals((metric) => {
    if (!TRACKED.has(metric.name)) return;
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
      route: pathname ?? '/',
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/analytics/vitals', body);
    } else {
      void fetch('/api/analytics/vitals', { method: 'POST', body, keepalive: true });
    }
  });

  return null;
}
