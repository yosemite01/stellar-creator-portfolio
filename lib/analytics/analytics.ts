"use client";

type EventProps = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    plausible?: (
      eventName: string,
      options?: { props?: EventProps; u?: string }
    ) => void;
  }
}

const noop = () => undefined;

const invokePlausible = (
  eventName: string,
  props?: EventProps,
  urlOverride?: string
) => {
  if (typeof window === "undefined") return;
  const plausible = window.plausible || noop;
  plausible(eventName, { props, u: urlOverride });
};

export const trackPageview = (url?: string, referrer?: string) => {
  invokePlausible("pageview", { url, referrer });
};

export const trackJourneyStep = (from: string, to: string) => {
  invokePlausible("journey-step", { from, to });
};

export const trackConversion = (
  stage:
    | "view"
    | "start_application"
    | "complete_application"
    | "cta_click"
    | "signup",
  extra?: EventProps
) => {
  invokePlausible("conversion", { stage, ...extra });
};

export const trackEvent = (name: string, props?: EventProps) => {
  invokePlausible(name, props);
};

export const trackFeatureUse = (feature: string, props?: EventProps) => {
  invokePlausible("feature-used", { feature, ...props });
};

export const trackSearch = (
  query: string,
  filters?: { [key: string]: string | number | boolean }
) => {
  invokePlausible("search", { query, ...(filters || {}) });
};

export const trackFilterUsage = (
  filterName: string,
  value: string | number | boolean,
  location?: string
) => {
  invokePlausible("filter", { filterName, value, location });
};

export const trackHeatmapClick = (
  path: string,
  xRatio: number,
  yRatio: number
) => {
  invokePlausible("heatmap-click", {
    path,
    x: Number(xRatio.toFixed(3)),
    y: Number(yRatio.toFixed(3)),
  });
};

export const trackScrollDepth = (path: string, depth: number) => {
  invokePlausible("scroll-depth", {
    path,
    depth: Math.min(100, Math.max(0, Math.round(depth))),
  });
};

export const trackCreatorOrBountyView = (
  type: "creator" | "bounty",
  slug: string
) => {
  invokePlausible(`${type}-view`, { slug });
};

export const trackSessionStart = (path: string) => {
  invokePlausible("session-start", { path });
};

export const trackError = (message: string, path?: string) => {
  invokePlausible("client-error", { message, path });
};

export const withSafeTracking = <T extends (...args: any[]) => void>(
  fn: T
): T => {
  return ((...args: Parameters<T>) => {
    try {
      fn(...args);
    } catch {
      // ignore tracking errors to preserve UX
    }
  }) as T;
};
