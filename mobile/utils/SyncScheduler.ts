import { useEffect, useState } from 'react';
import { synchronizeDatabase } from '@/mobile/src/database/db';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

interface SyncSchedulerOptions {
  apiBaseUrl: string;
  accessToken: string;
  syncIntervalMs?: number; // Default: 30000 (30 seconds)
}

/**
 * Manages periodic synchronization with network status awareness.
 * Syncs every 30 seconds when online, pauses when offline.
 */
export function useSyncScheduler(options: SyncSchedulerOptions): SyncStatus {
  const {
    apiBaseUrl,
    accessToken,
    syncIntervalMs = 30000,
  } = options;

  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [isOnline, setIsOnline] = useState(true);

  // Handle online/offline events
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    if (typeof window !== 'undefined' && 'navigator' in window) {
      setIsOnline(navigator.onLine);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Update sync status based on online state
  useEffect(() => {
    if (!isOnline) {
      setSyncStatus('offline');
    } else if (syncStatus === 'offline') {
      setSyncStatus('idle');
    }
  }, [isOnline]);

  // Periodic sync
  useEffect(() => {
    if (!isOnline) {
      return;
    }

    let intervalId: NodeJS.Timeout;

    const performSync = async () => {
      setSyncStatus('syncing');
      try {
        const result = await synchronizeDatabase(apiBaseUrl, accessToken);
        if (result.success) {
          setSyncStatus('idle');
        } else {
          setSyncStatus('error');
          console.error('Sync error:', result.error);
        }
      } catch (error) {
        setSyncStatus('error');
        console.error('Sync failed:', error);
      }
    };

    performSync();
    intervalId = setInterval(performSync, syncIntervalMs);

    return () => clearInterval(intervalId);
  }, [isOnline, apiBaseUrl, accessToken, syncIntervalMs]);

  return syncStatus;
}
