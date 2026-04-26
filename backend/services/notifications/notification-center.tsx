'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell,
  X,
  Check,
  Archive,
  Trash2,
  Settings,
  Filter,
  Clock,
  AlertCircle,
  Info,
  CheckCircle,
  Clock3,
} from 'lucide-react';

type NotificationType = 'message' | 'update' | 'reminder' | 'alert' | 'info';
type NotificationStatus = 'unread' | 'read' | 'archived' | 'deleted';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: NotificationType;
  status: NotificationStatus;
  timestamp: Date;
  actionUrl?: string;
  priority: 'high' | 'normal' | 'low';
  channels: string[];
  metadata?: Record<string, any>;
}

interface NotificationFilter {
  type?: NotificationType;
  status?: NotificationStatus;
  priority?: 'high' | 'normal' | 'low';
  dateRange?: { start: Date; end: Date };
}

const typeIcons: Record<NotificationType, React.ReactNode> = {
  message: <Bell size={16} />,
  update: <AlertCircle size={16} />,
  reminder: <Clock3 size={16} />,
  alert: <AlertCircle size={16} />,
  info: <Info size={16} />,
};

const typeColors: Record<NotificationType, string> = {
  message: 'from-blue-50 to-blue-100 border-blue-200',
  update: 'from-purple-50 to-purple-100 border-purple-200',
  reminder: 'from-amber-50 to-amber-100 border-amber-200',
  alert: 'from-red-50 to-red-100 border-red-200',
  info: 'from-green-50 to-green-100 border-green-200',
};

const typeTextColors: Record<NotificationType, string> = {
  message: 'text-blue-900',
  update: 'text-purple-900',
  reminder: 'text-amber-900',
  alert: 'text-red-900',
  info: 'text-green-900',
};

const typeBadgeColors: Record<NotificationType, string> = {
  message: 'bg-blue-100 text-blue-800',
  update: 'bg-purple-100 text-purple-800',
  reminder: 'bg-amber-100 text-amber-800',
  alert: 'bg-red-100 text-red-800',
  info: 'bg-green-100 text-green-800',
};

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>({});
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'priority'>('newest');
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mockNotifications: Notification[] = [
      {
        id: '1',
        title: 'New Message',
        body: 'You have a new message from Sarah',
        type: 'message',
        status: 'unread',
        timestamp: new Date(),
        priority: 'high',
        channels: ['firebase', 'browser'],
      },
    ];
    setNotifications(mockNotifications);
  }, []);

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

  const filteredNotifications = useCallback(() => {
    let filtered = notifications;
    if (sortBy === 'newest') {
      filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
    return filtered;
  }, [notifications, sortBy]);

  const unreadCount = notifications.filter(n => n.status === 'unread').length;
  const displayed = filteredNotifications();

  const handleMarkAsRead = (id: string) => {
    setNotifications(prevs =>
      prevs.map(n => (n.id === id ? { ...n, status: 'read' as const } : n))
    );
  };

  const handleDelete = (id: string) => {
    setNotifications(prevs => prevs.filter(n => n.id !== id));
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full flex items-center justify-center animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute right-0 mt-2 w-96 max-h-96 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50"
          >
            <div className="sticky top-0 bg-slate-50 border-b border-slate-200 p-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
              <button onClick={() => setIsOpen(false)} className="p-1">
                <X size={18} />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {displayed.length === 0 ? (
                <div className="px-4 py-12 text-center text-slate-500">
                  <p className="text-sm">No notifications</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {displayed.map((notification) => (
                    <div key={notification.id} className="p-4 hover:bg-slate-50 group">
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-slate-900">
                            {notification.title}
                          </h3>
                          <p className="text-sm text-slate-600 mt-1">{notification.body}</p>
                        </div>
                        <div className="flex gap-1">
                          {notification.status === 'unread' && (
                            <button
                              onClick={() => handleMarkAsRead(notification.id)}
                              className="p-1 text-slate-400 hover:text-blue-600"
                            >
                              <Check size={16} />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(notification.id)}
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
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
