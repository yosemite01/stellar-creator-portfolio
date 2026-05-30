"use client";

import * as React from "react";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";

/**
 * SSR-safe chart wrapper that prevents hydration mismatches
 * Recharts ResponsiveContainer measures DOM on mount, causing layout shifts
 * This wrapper defers rendering until client-side to prevent SSR/client conflicts
 */
interface ChartWrapperProps {
  id?: string;
  className?: string;
  config: ChartConfig;
  children: React.ReactNode;
}

export function ChartWrapper({
  id,
  className,
  config,
  children,
}: ChartWrapperProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Don't render chart until client-side to avoid SSR/client mismatch
  if (!mounted) {
    return (
      <div
        className={className}
        style={{ aspectRatio: "16 / 9" }}
        suppressHydrationWarning
      />
    );
  }

  return (
    <ChartContainer id={id} config={config} className={className}>
      {children}
    </ChartContainer>
  );
}
