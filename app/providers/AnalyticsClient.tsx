"use client";

import { useEffect, useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  trackConversion,
  trackCreatorOrBountyView,
  trackEvent,
  trackFilterUsage,
  trackHeatmapClick,
  trackJourneyStep,
  trackPageview,
  trackScrollDepth,
  trackSearch,
  trackSessionStart,
} from "../../lib/analytics";

type Props = {
  plausibleDomain: string;
};

export default function AnalyticsClient({ plausibleDomain: _ }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousPath = useRef<string | null>(null);
  const scrollBuckets = useRef<Record<number, boolean>>({});

  const fullPath = useMemo(() => {
    const query = searchParams?.toString();
    return pathname + (query ? `?${query}` : "");
  }, [pathname, searchParams]);

  useEffect(() => {
    if (!pathname) return;

    if (!previousPath.current) {
      trackSessionStart(fullPath);
    } else {
      trackJourneyStep(previousPath.current, fullPath);
    }

    trackPageview(fullPath, typeof document !== "undefined" ? document.referrer : undefined);
    maybeTrackDetailViews(pathname);
    previousPath.current = fullPath;

    // reset scroll depth buckets on route change
    scrollBuckets.current = {};
  }, [fullPath, pathname]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!pathname) return;
      const target = event.target as HTMLElement | null;

      if (shouldTrackHeatmap(pathname)) {
        trackHeatmapClick(
          pathname,
          event.clientX / window.innerWidth,
          event.clientY / window.innerHeight
        );
      }

      const conversionStep = target?.dataset?.conversionStep;
      if (conversionStep) {
        trackConversion(conversionStep as any, {
          label: target.dataset.conversionLabel,
          path: pathname,
        });
      }

      const analyticsEvent = target?.dataset?.analyticsEvent;
      if (analyticsEvent) {
        trackEvent(analyticsEvent, {
          label: target.dataset.analyticsLabel || target.textContent?.trim(),
          path: pathname,
        });
      }
    };

    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, [pathname]);

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement | null;
      if (!form) return;

      const searchInput = form.querySelector<HTMLInputElement>(
        'input[type="search"], input[name*="search"], input[data-analytics="search"]'
      );

      if (searchInput?.value) {
        const filters = collectFilters(form);
        trackSearch(searchInput.value, filters);
      }
    };

    const handleChange = (event: Event) => {
      const element = event.target as HTMLElement | null;
      if (!element) return;

      if (element.dataset?.filterName) {
        const value = (element as HTMLInputElement).value ?? "selected";
        trackFilterUsage(element.dataset.filterName, value, pathname || "unknown");
      }
    };

    document.addEventListener("submit", handleSubmit, true);
    document.addEventListener("change", handleChange, true);
    return () => {
      document.removeEventListener("submit", handleSubmit, true);
      document.removeEventListener("change", handleChange, true);
    };
  }, [pathname]);

  useEffect(() => {
    const handleScroll = () => {
      if (!pathname) return;
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight <= 0) return;
      const position = window.scrollY;
      const depth = Math.round((position / scrollHeight) * 100);
      [25, 50, 75, 90, 100].forEach((bucket) => {
        if (depth >= bucket && !scrollBuckets.current[bucket]) {
          scrollBuckets.current[bucket] = true;
          trackScrollDepth(pathname, bucket);
        }
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [pathname]);

  return null;
}

const shouldTrackHeatmap = (path: string) => {
  return ["/", "/creators", "/bounties", "/search"].some((p) => path.startsWith(p));
};

const maybeTrackDetailViews = (path: string) => {
  const creatorMatch = path.match(/\/creators?\/([^/?#]+)/i);
  if (creatorMatch?.[1]) {
    trackCreatorOrBountyView("creator", creatorMatch[1]);
    return;
  }
  const bountyMatch = path.match(/\/bounties?\/([^/?#]+)/i);
  if (bountyMatch?.[1]) {
    trackCreatorOrBountyView("bounty", bountyMatch[1]);
  }
};

const collectFilters = (form: HTMLFormElement) => {
  const filters: Record<string, string> = {};
  form.querySelectorAll<HTMLElement>("[data-filter-name]").forEach((el) => {
    const name = el.dataset.filterName;
    if (!name) return;
    const value =
      (el as HTMLInputElement).value ||
      (el as HTMLInputElement).dataset.filterValue ||
      (el as HTMLInputElement).checked?.toString();
    if (value) filters[name] = value.toString();
  });
  return filters;
};
