'use client';

import { useEffect, useRef } from 'react';

type BountyStatus = 'open' | 'in-progress' | 'completed' | 'cancelled' | 'disputed';

interface BountyUpdateMessage {
  type: 'bounty_update';
  bountyId: string;
  status: BountyStatus;
  updatedAt: string;
}

interface BountyRealtimeClientProps {
  bountyId: string;
  onUpdate?: (msg: BountyUpdateMessage) => void;
}

function isBountyUpdateMessage(data: unknown): data is BountyUpdateMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).type === 'bounty_update'
  );
}

export function BountyRealtimeClient({ bountyId, onUpdate }: BountyRealtimeClientProps) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'ws://localhost:3001';
    const ws = new WebSocket(`${wsUrl}?channel=bounty:${bountyId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as unknown;
        if (isBountyUpdateMessage(data) && data.bountyId === bountyId) {
          onUpdate?.(data);
          showBountyToast();
        }
      } catch {
        // ignore malformed messages
      }
    };

    return () => {
      ws.close();
    };
  }, [bountyId, onUpdate]);

  return null;
}

function showBountyToast() {
  if (typeof window === 'undefined') return;
  const existing = document.getElementById('bounty-update-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'bounty-update-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.style.cssText = [
    'position:fixed',
    'bottom:1.5rem',
    'right:1.5rem',
    'z-index:9999',
    'padding:0.75rem 1.25rem',
    'border-radius:0.5rem',
    'background:hsl(var(--foreground))',
    'color:hsl(var(--background))',
    'font-size:0.875rem',
    'font-weight:500',
    'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
    'transition:opacity 0.3s ease',
  ].join(';');
  toast.textContent = 'This bounty has been updated';

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
