/**
 * Notification Settings Page
 * Allows users to configure notification preferences, quiet hours, and delivery channels
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Bell,
  Mail,
  Smartphone,
  Chrome,
  Clock,
  Moon,
  ToggleLeft,
  ToggleRight,
  Save,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';

type NotificationChannel = 'firebase' | 'onesignal' | 'browser' | 'email';

interface UserPreferences {
  channels: Record<NotificationChannel, boolean>;
  quietHours?: {
    start: number;
    end: number;
  };
  doNotDisturb: boolean;
  dndSchedule?: {
    enabled: boolean;
    start: string;
    end: string;
  };
  blockedCategories: string[];
  language: string;
  timezone: string;
}

interface NotificationCategory {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
}

export default function NotificationSettingsPage() {
  const [preferences, setPreferences] = useState<UserPreferences>({
    channels: {
      firebase: true,
      onesignal: true,
      browser: true,
      email: true,
    },
    doNotDisturb: false,
    blockedCategories: [],
    language: 'en',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const [categories, setCategories] = useState<NotificationCategory[]>([
    {
      id: 'messages',
      name: 'Messages',
      description: 'New messages and chats',
      icon: <Mail size={20} />,
      enabled: true,
    },
    {
      id: 'updates',
      name: 'System Updates',
      description: 'Application updates and maintenance',
      icon: <Smartphone size={20} />,
      enabled: true,
    },
    {
      id: 'reminders',
      name: 'Reminders',
      description: 'Task and meeting reminders',
      icon: <Clock size={20} />,
      enabled: true,
    },
    {
      id: 'alerts',
      name: 'Alerts',
      description: 'Security alerts and warnings',
      icon: <AlertCircle size={20} />,
      enabled: true,
    },
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [dndTime, setDndTime] = useState({
    start: preferences.quietHours?.start || 22,
    end: preferences.quietHours?.end || 7,
  });

  const handleChannelToggle = (channel: NotificationChannel) => {
    setPreferences(prev => ({
      ...prev,
      channels: {
        ...prev.channels,
        [channel]: !prev.channels[channel],
      },
    }));
  };

  const handleCategoryToggle = (id: string) => {
    setCategories(prev =>
      prev.map(cat =>
        cat.id === id ? { ...cat, enabled: !cat.enabled } : cat
      )
    );

    setPreferences(prev => ({
      ...prev,
      blockedCategories: preferences.blockedCategories.includes(id)
        ? prev.blockedCategories.filter(c => c !== id)
        : [...prev.blockedCategories, id],
    }));
  };

  const handleDndToggle = () => {
    setPreferences(prev => ({
      ...prev,
      doNotDisturb: !prev.doNotDisturb,
    }));
  };

  const handleDndTimeChange = (type: 'start' | 'end', value: number) => {
    setDndTime(prev => ({
      ...prev,
      [type]: value,
    }));

    setPreferences(prev => ({
      ...prev,
      quietHours: {
        start: type === 'start' ? value : dndTime.start,
        end: type === 'end' ? value : dndTime.end,
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    try {
      // Make API call to save preferences
      const response = await fetch('/api/notifications/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) throw new Error('Failed to save preferences');

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    // Reset to default preferences
    setPreferences({
      channels: {
        firebase: true,
        onesignal: true,
        browser: true,
        email: true,
      },
      doNotDisturb: false,
      blockedCategories: [],
      language: 'en',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  };

  const enabledChannelCount = Object.values(preferences.channels).filter(Boolean).length;
  const enabledCategoryCount = categories.filter(c => c.enabled).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <Bell className="text-blue-600" size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Notification Settings
              </h1>
              <p className="text-slate-600 mt-1">
                Manage how you receive notifications across all channels
              </p>
            </div>
          </div>
        </motion.div>

        {/* Status Message */}
        <AnimatePresence>
          {saveStatus !== 'idle' && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                saveStatus === 'success'
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center ${
                  saveStatus === 'success' ? 'bg-green-500' : 'bg-red-500'
                }`}
              >
                <span className="text-white text-xs">✓</span>
              </div>
              <span
                className={saveStatus === 'success' ? 'text-green-700' : 'text-red-700'}
              >
                {saveStatus === 'success'
                  ? 'Preferences saved successfully'
                  : 'Failed to save preferences'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Notification Channels */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6"
        >
          <h2 className="text-xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Smartphone size={20} />
            Notification Channels
          </h2>

          <p className="text-slate-600 text-sm mb-4">
            Choose how you want to receive notifications
          </p>

          <div className="space-y-3">
            {[
              {
                id: 'firebase',
                name: 'Firebase Cloud Messaging',
                description: 'Mobile app notifications',
                icon: <Smartphone size={18} />,
              },
              {
                id: 'browser',
                name: 'Browser Push',
                description: 'Desktop browser notifications',
                icon: <Chrome size={18} />,
              },
              {
                id: 'email',
                name: 'Email',
                description: 'Email notifications',
                icon: <Mail size={18} />,
              },
            ].map(channel => (
              <button
                key={channel.id}
                onClick={() => handleChannelToggle(channel.id as NotificationChannel)}
                className="w-full p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between group"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="text-slate-600">{channel.icon}</div>
                  <div>
                    <h3 className="font-medium text-slate-900">{channel.name}</h3>
                    <p className="text-sm text-slate-500">{channel.description}</p>
                  </div>
                </div>
                {preferences.channels[channel.id as NotificationChannel] ? (
                  <ToggleRight className="text-blue-600" size={24} />
                ) : (
                  <ToggleLeft className="text-slate-400" size={24} />
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700">
              <strong>{enabledChannelCount}</strong> channel{enabledChannelCount !== 1 ? 's' : ''} enabled
            </p>
          </div>
        </motion.section>

        {/* Notification Categories */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6"
        >
          <h2 className="text-xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Bell size={20} />
            Notification Categories
          </h2>

          <p className="text-slate-600 text-sm mb-4">
            Enable or disable notifications by category
          </p>

          <div className="space-y-3">
            {categories.map(category => (
              <button
                key={category.id}
                onClick={() => handleCategoryToggle(category.id)}
                className="w-full p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between group"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="text-slate-600">{category.icon}</div>
                  <div>
                    <h3 className="font-medium text-slate-900">{category.name}</h3>
                    <p className="text-sm text-slate-500">{category.description}</p>
                  </div>
                </div>
                {category.enabled ? (
                  <ToggleRight className="text-blue-600" size={24} />
                ) : (
                  <ToggleLeft className="text-slate-400" size={24} />
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700">
              <strong>{enabledCategoryCount}</strong> categor{enabledCategoryCount !== 1 ? 'ies' : 'y'} enabled
            </p>
          </div>
        </motion.section>

        {/* Quiet Hours & Do Not Disturb */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6"
        >
          <h2 className="text-xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Moon size={20} />
            Quiet Hours
          </h2>

          <div className="space-y-4">
            <button
              onClick={handleDndToggle}
              className="w-full p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between group"
            >
              <div className="text-left">
                <h3 className="font-medium text-slate-900">Do Not Disturb</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Temporarily pause all notifications
                </p>
              </div>
              {preferences.doNotDisturb ? (
                <ToggleRight className="text-blue-600" size={24} />
              ) : (
                <ToggleLeft className="text-slate-400" size={24} />
              )}
            </button>

            {preferences.doNotDisturb && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4"
              >
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-2">
                    Start Time (Quiet Hours)
                  </label>
                  <select
                    value={dndTime.start}
                    onChange={(e) => handleDndTimeChange('start', parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {String(i).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-2">
                    End Time
                  </label>
                  <select
                    value={dndTime.end}
                    onChange={(e) => handleDndTimeChange('end', parseInt(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-900"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {String(i).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </div>

                <p className="text-sm text-slate-600 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  Notifications will be silenced from {String(dndTime.start).padStart(2, '0')}:00 to{' '}
                  {String(dndTime.end).padStart(2, '0')}:00 in your timezone
                </p>
              </motion.div>
            )}
          </div>
        </motion.section>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex gap-3"
        >
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Save size={18} />
            {isSaving ? 'Saving...' : 'Save Preferences'}
          </button>
          <button
            onClick={handleReset}
            className="flex-1 px-6 py-3 bg-slate-200 text-slate-900 rounded-lg font-medium hover:bg-slate-300 transition-colors flex items-center justify-center gap-2"
          >
            <RotateCcw size={18} />
            Reset to Default
          </button>
        </motion.div>
      </div>
    </div>
  );
}

import { AnimatePresence } from 'framer-motion';
