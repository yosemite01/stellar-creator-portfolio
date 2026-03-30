import { useEffect, useState } from 'react';

/**
 * Returns true after the component has mounted on the client.
 * Use this to safely gate client-only rendering and avoid SSR hydration mismatches.
 */
export function useIsMounted(): boolean {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return isMounted;
}
