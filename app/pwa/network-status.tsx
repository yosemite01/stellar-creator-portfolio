// @ts-nocheck
'use client';

import React, { useEffect, useState } from 'react';
import { usePWA } from '@/components/pwa/pwa-provider';

/**
 * Network Status Component
 * Shows connection status indicator and offline mode notification
 */
export default function NetworkStatus() {
  const { isOnline } = usePWA();
  const [showNotification, setShowNotification] = useState(false);
  const [wasOnline, setWasOnline] = useState(true);

  useEffect(() => {
    if (isOnline !== wasOnline) {
      setShowNotification(true);
      setWasOnline(isOnline);

      // Auto-hide notification after 4 seconds
      const timer = setTimeout(() => {
        setShowNotification(false);
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOnline]);

  if (!showNotification) {
    return null;
  }

  return (
    <div className={`network-status ${isOnline ? 'online' : 'offline'}`}>
      <div className="network-status-content">
        <span className="network-status-icon">
          {isOnline ? '✓' : '✕'}
        </span>
        <span className="network-status-text">
          {isOnline
            ? 'You are back online'
            : 'You are offline - some features may be limited'}
        </span>
      </div>

      <style jsx>{`
        .network-status {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          padding: 12px 16px;
          background: #4caf50;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999;
          animation: slideDown 0.3s ease-out;
          font-size: 14px;
          font-weight: 500;
        }

        .network-status.offline {
          background: #f44336;
        }

        .network-status-content {
          display: flex;
          align-items: center;
          gap: 8px;
          max-width: 600px;
        }

        .network-status-icon {
          font-weight: bold;
          font-size: 16px;
        }

        .network-status-text {
          flex: 1;
        }

        @keyframes slideDown {
          from {
            transform: translateY(-100%);
          }
          to {
            transform: translateY(0);
          }
        }

        @media (max-width: 600px) {
          .network-status {
            padding: 10px 12px;
            font-size: 13px;
          }
        }
      `}</style>
    </div>
  );
}
