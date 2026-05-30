/**
 * Typed route constants for the app's file-based (Expo Router) navigation.
 *
 * These are the single source of truth for navigation targets. No route
 * strings should be hardcoded anywhere outside of this file — import `ROUTES`
 * (and the `AppRoute` type) instead so renames stay type-safe.
 */

/**
 * Map of every navigable destination in the app, grouped by route group.
 *
 * - `(auth)` — unauthenticated screens (login, onboarding)
 * - `(app)`  — authenticated screens (home, …)
 */
export const ROUTES = {
  /** Unauthenticated route group. */
  AUTH: {
    /** Login screen. */
    LOGIN: '/(auth)/login',
    /** First-run onboarding walkthrough. */
    ONBOARDING: '/(auth)/onboarding',
  },
  /** Authenticated route group. */
  APP: {
    /** Authenticated home screen. */
    HOME: '/(app)/home',
  },
} as const;

/** Top-level route-group keys exported by {@link ROUTES}. */
export type RouteGroup = keyof typeof ROUTES;

type RouteValues<T> = T[keyof T];

/**
 * Union of every concrete route string declared in {@link ROUTES}
 * (e.g. `'/(auth)/login' | '/(auth)/onboarding' | '/(app)/home'`).
 */
export type AppRoute = RouteValues<{
  [G in RouteGroup]: RouteValues<(typeof ROUTES)[G]>;
}>;
