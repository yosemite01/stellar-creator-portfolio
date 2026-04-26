// @ts-nocheck
'use client';

import React, { ReactNode, useEffect, useState } from 'react';
import { pwa } from '@/lib/pwa-utils';

interface PWAContextType {
  isOnline: boolean;
  isInstallable: boolean;
  isRunningAsApp: boolean;
  updateAvailable: boolean;
  promptInstall: () => Promise<boolean>;
  requestNotifications: () => Promise<boolean>;
  sendNotification: (title: string, options?: NotificationOptions) => Promise<void>;
}

export const PWAContext = React.createContext<PWAContextType | undefined>(undefined);

interface PWAProviderProps {
  children: ReactNode;
}

export default function PWAProvider({ children }: PWAProviderProps) {
  const [isOnline, setIsOnline] = useState(true);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isRunningAsApp, setIsRunningAsApp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    // Check initial state
    setIsOnline(pwa.isOnline());
    setIsInstallable(pwa.isInstallPromptAvailable());
    setIsRunningAsApp(pwa.isRunningAsApp());

    // Listen for network changes
    const handleNetworkStatus = (e: CustomEvent) => {
      setIsOnline(e.detail.isOnline);
    };

    // Listen for install prompt availability
    const handleInstallPrompt = () => {
      setIsInstallable(pwa.isInstallPromptAvailable());
    };

    // Listen for updates
    const handleUpdate = () => {
      setUpdateAvailable(true);
    };

    window.addEventListener('pwa-network-status', handleNetworkStatus as EventListener);
    window.addEventListener('pwa-install-prompt-available', handleInstallPrompt);
    window.addEventListener('pwa-update-available', handleUpdate);

    return () => {
      window.removeEventListener('pwa-network-status', handleNetworkStatus as EventListener);
      window.removeEventListener('pwa-install-prompt-available', handleInstallPrompt);
      window.removeEventListener('pwa-update-available', handleUpdate);
    };
  }, []);

  const contextValue: PWAContextType = {
    isOnline,
    isInstallable,
    isRunningAsApp,
    updateAvailable,
    promptInstall: () => pwa.promptInstall(),
    requestNotifications: () => pwa.requestNotificationPermission(),
    sendNotification: (title, options) => pwa.sendNotification(title, options),
  };

  return (
    <PWAContext.Provider value={contextValue}>
      {children}
    </PWAContext.Provider>
  );
}

/**
 * Hook to use PWA context
 */
export function usePWA(): PWAContextType {
  const context = React.useContext(PWAContext);
  if (context === undefined) {
    throw new Error('usePWA must be used within a PWAProvider');
  }
  return context;
}
