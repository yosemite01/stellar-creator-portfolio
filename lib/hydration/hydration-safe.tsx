"use client";

import React, { useEffect, useState } from "react";

/**
 * Wrapper component that prevents hydration mismatches
 * Renders a placeholder on server, actual content on client
 */
interface HydrationSafeProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  suppressWarning?: boolean;
}

export function HydrationSafe({
  children,
  fallback = null,
  suppressWarning = false,
}: HydrationSafeProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div suppressHydrationWarning={suppressWarning}>{fallback}</div>;
  }

  return <>{children}</>;
}

/**
 * Hook to safely access browser APIs
 * Returns null/undefined on server, actual value on client
 */
export function useBrowserOnly<T>(getValue: () => T, defaultValue: T): T {
  const [value, setValue] = useState<T>(defaultValue);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setValue(getValue());
    } catch (error) {
      console.error("Error getting browser value:", error);
    }
  }, [getValue]);

  return mounted ? value : defaultValue;
}

/**
 * Hook to defer rendering until client-side
 * Useful for components that depend on browser APIs
 */
export function useClientOnly(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}

/**
 * Hook to safely access window object
 * Returns null on server, window on client
 */
export function useWindow(): typeof window | null {
  const [window_, setWindow] = useState<typeof window | null>(null);

  useEffect(() => {
    setWindow(typeof window !== "undefined" ? window : null);
  }, []);

  return window_;
}

/**
 * Hook to safely access document object
 * Returns null on server, document on client
 */
export function useDocument(): typeof document | null {
  const [document_, setDocument] = useState<typeof document | null>(null);

  useEffect(() => {
    setDocument(typeof document !== "undefined" ? document : null);
  }, []);

  return document_;
}

/**
 * Hook to safely access localStorage
 * Returns null on server, localStorage on client
 */
export function useLocalStorage(): Storage | null {
  const [storage, setStorage] = useState<Storage | null>(null);

  useEffect(() => {
    setStorage(typeof localStorage !== "undefined" ? localStorage : null);
  }, []);

  return storage;
}

/**
 * Hook to safely access sessionStorage
 * Returns null on server, sessionStorage on client
 */
export function useSessionStorage(): Storage | null {
  const [storage, setStorage] = useState<Storage | null>(null);

  useEffect(() => {
    setStorage(typeof sessionStorage !== "undefined" ? sessionStorage : null);
  }, []);

  return storage;
}

/**
 * Hook to safely detect mobile viewport
 * Returns false on server, actual value on client
 */
export function useIsMobileViewport(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < breakpoint);
    return () => mql.removeEventListener("change", onChange);
  }, [breakpoint]);

  return mounted ? isMobile : false;
}

/**
 * Hook to safely detect dark mode preference
 * Returns false on server, actual value on client
 */
export function usePrefersDarkMode(): boolean {
  const [prefersDark, setPrefersDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      setPrefersDark(mql.matches);
    };
    mql.addEventListener("change", onChange);
    setPrefersDark(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return mounted ? prefersDark : false;
}

/**
 * Hook to safely detect reduced motion preference
 * Returns false on server, actual value on client
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setPrefersReduced(mql.matches);
    };
    mql.addEventListener("change", onChange);
    setPrefersReduced(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return mounted ? prefersReduced : false;
}
