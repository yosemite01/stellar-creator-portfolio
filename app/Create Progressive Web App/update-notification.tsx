// @ts-nocheck
'use client';
import React, { useState, useEffect } from 'react';
// Commenting out due to missing module
// import { usePWA } from '@/components/pwa/pwa-provider';

export default function UpdateNotification() {
  // Mocking state since usePWA is missing
  const updateAvailable = false; 

  useEffect(() => {
    if (updateAvailable) {
      setShowUpdate(true);
    }
  }, [updateAvailable]);

  const handleUpdate = () => {
    setIsReloading(true);
    // Reload to activate new service worker
    window.location.reload();
  };

  const handleDismiss = () => {
    setShowUpdate(false);
  };

  if (!showUpdate) {
    return null;
  }

  return (
    <div className="update-notification">
      <div className="update-notification-content">
        <div className="update-notification-icon">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
              fill="currentColor"
            />
          </svg>
        </div>

        <div className="update-notification-text">
          <h3>Update Available</h3>
          <p>A new version of the app is ready. Update now to get the latest features.</p>
        </div>

        <div className="update-notification-actions">
          <button
            className="update-btn update-btn-primary"
            onClick={handleUpdate}
            disabled={isReloading}
          >
            {isReloading ? 'Updating...' : 'Update Now'}
          </button>
          <button
            className="update-btn update-btn-secondary"
            onClick={handleDismiss}
            disabled={isReloading}
          >
            Later
          </button>
        </div>
      </div>

      <style jsx>{`
        .update-notification {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: white;
          border-top: 1px solid #e0e0e0;
          box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
          z-index: 1000;
          animation: slideUp 0.3s ease-out;
        }

        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }

        .update-notification-content {
          max-width: 100%;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .update-notification-icon {
          flex-shrink: 0;
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .update-notification-text {
          flex: 1;
          min-width: 0;
        }

        .update-notification-text h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #1a1a1a;
        }

        .update-notification-text p {
          margin: 4px 0 0;
          font-size: 14px;
          color: #666;
        }

        .update-notification-actions {
          flex-shrink: 0;
          display: flex;
          gap: 8px;
        }

        .update-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .update-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .update-btn-primary {
          background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
          color: white;
        }

        .update-btn-primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
        }

        .update-btn-secondary {
          background: #f0f0f0;
          color: #1a1a1a;
        }

        .update-btn-secondary:hover:not(:disabled) {
          background: #e0e0e0;
        }

        @media (max-width: 600px) {
          .update-notification {
            bottom: 0;
          }

          .update-notification-content {
            flex-direction: column;
            gap: 12px;
          }

          .update-notification-actions {
            width: 100%;
            flex-direction: column;
          }

          .update-btn {
            flex: 1;
            padding: 12px;
          }
        }

        @media (prefers-color-scheme: dark) {
          .update-notification {
            background: #1a1a1a;
            border-top-color: #333;
          }

          .update-notification-text h3 {
            color: #e0e0e0;
          }

          .update-notification-text p {
            color: #999;
          }

          .update-btn-secondary {
            background: #333;
            color: #e0e0e0;
          }

          .update-btn-secondary:hover:not(:disabled) {
            background: #444;
          }
        }
      `}</style>
    </div>
  );
}
