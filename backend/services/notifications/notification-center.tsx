'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  X,
  Check,
  CheckCheck,
  Trash2,
  MessageSquare,
  AlertCircle,
  Clock3,
  Info,
  Gift,
  ExternalLink,
} from 'lucide-react';
import { useWebSocket } from '@/hooks/useWebSocket';

type NotificationType = 'message' | 'update' | 'reminder' | 'alert' | 'info' | 'bounty' | 'application';
type NotificationStatus = 'unread' | 'read' | 'archived';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  status: NotificationStatus;
  timestamp: Date;
  actionUrl?: string;
  priority: 'high' | 'normal' | 'low';
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

const typeIcons: Record<NotificationType, React.ReactNode> = {
  message: <MessageSquare size={16} className="text-blue-500" />,
  update: <AlertCircle size={16} className="text-purple-500" />,
  reminder: <Clock3 size={16} className="text-amber-500" />,
  alert: <AlertCircle size={16} className="text-red-500" />,
  info: <Info size={16} className="text-green-500" />,
  bounty: <Gift size={16} className="text-indigo-500" />,
  application: <Check size={16} className="text-teal-500" />,
};

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

async function fetchNotifications(): Promise<Notification[]> {
  const res = await fetch(`${API_BASE}/api/notifications`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.notifications ?? data ?? []).map((n: any) => ({
    ...n,
    timestamp: new Date(n.timestamp),
  }));
}

async function markAsRead(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/notifications/${id}/read`, { method: 'PATCH' });
}

async function markAllAsRead(): Promise<void> {
  await fetch(`${API_BASE}/api/notifications/read-all`, { method: 'PATCH' });
}

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchNotifications().then(setNotifications);
    // Compute WebSocket URL client-side only (window is not available during SSR)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    setWsUrl(`${protocol}//${window.location.host}/api/ws`);
  }, []);

  const { isConnected } = useWebSocket({
    url: wsUrl ?? '',
    onMessage: (message) => {
      if (message.type === 'notification:created') {
        const n = message.data as any;
        setNotifications((prev) => [
          {
            ...n,
            timestamp: new Date(n.timestamp),
            status: 'unread',
          },
          ...prev,
        ]);
      }
    },
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const unreadCount = notifications.filter((n) => n.status === 'unread').length;
  const displayed = notifications
    .slice()
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 20);

  const handleMarkAsRead = useCallback(async (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, status: 'read' as const } : n)),
    );
    await markAsRead(id);
  }, []);

  const handleMarkAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, status: 'read' as const })));
    await markAllAsRead();
  }, []);

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      if (notification.status === 'unread') {
        handleMarkAsRead(notification.id);
      }
      if (notification.actionUrl) {
        window.location.href = notification.actionUrl;
      }
    },
    [handleMarkAsRead],
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-secondary/40 rounded-lg transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] text-[10px] font-bold text-white bg-red-500 rounded-full flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-[380px] max-h-[480px] bg-background rounded-xl shadow-xl border border-border overflow-hidden z-50"
          >
            {/* Header */}
            <div className="sticky top-0 bg-background border-b border-border p-3 flex items-center justify-between z-10">
              <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllAsRead}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-secondary/40 transition-colors"
                    aria-label="Mark all as read"
                  >
                    <CheckCheck size={14} className="inline mr-1" />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/40 transition-colors"
                  aria-label="Close notifications"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[420px] overflow-y-auto">
              {displayed.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <Bell size={32} className="mx-auto mb-2 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {displayed.map((notification) => (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={`w-full text-left p-3 hover:bg-secondary/30 transition-colors group ${notification.status === 'unread' ? 'bg-primary/5' : ''
                        }`}
                    >
                      <div className="flex gap-3">
                        <div className="mt-0.5 shrink-0">
                          {typeIcons[notification.type] ?? <Bell size={16} className="text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3
                              className={`text-sm leading-tight truncate ${notification.status === 'unread'
                                  ? 'font-semibold text-foreground'
                                  : 'font-medium text-muted-foreground'
                                }`}
                            >
                              {notification.title}
                            </h3>
                            {notification.status === 'unread' && (
                              <span className="shrink-0 w-2 h-2 mt-1.5 rounded-full bg-primary" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {notification.body}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-muted-foreground/70">
                              {formatRelativeTime(notification.timestamp)}
                            </span>
                            {notification.actionUrl && (
                              <ExternalLink
                                size={10}
                                className="text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity"
                              />
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-start gap-1">
                          {notification.status === 'unread' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsRead(notification.id);
                              }}
                              className="p-1 text-muted-foreground hover:text-primary rounded"
                              aria-label="Mark as read"
                            >
                              <Check size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
