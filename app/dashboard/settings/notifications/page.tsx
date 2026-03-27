'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  Mail,
  Smartphone,
  Clock,
  AlertCircle,
  Save,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

type CategoryId = 'application' | 'message' | 'marketing' | 'system';

interface NotificationCategory {
  id: CategoryId;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const CATEGORIES: NotificationCategory[] = [
  {
    id: 'application',
    name: 'Bounty Applications',
    description: 'Updates on your applications and status changes',
    icon: <CheckCircle2 className="text-blue-500" size={20} />,
  },
  {
    id: 'message',
    name: 'Messages',
    description: 'New messages from clients or creators',
    icon: <Mail className="text-purple-500" size={20} />,
  },
  {
    id: 'system',
    name: 'System Alerts',
    description: 'Security alerts and platform maintenance notice',
    icon: <AlertCircle className="text-amber-500" size={20} />,
  },
  {
    id: 'marketing',
    name: 'Marketing & Tips',
    description: 'Weekly newsletters and platform tips',
    icon: <ShieldCheck className="text-green-500" size={20} />,
  },
];

interface PreferenceState {
  email: boolean;
  inApp: boolean;
}

export default function NotificationSettingsPage() {
  const [preferences, setPreferences] = useState<Record<CategoryId, PreferenceState>>({
    application: { email: true, inApp: true },
    message: { email: true, inApp: true },
    system: { email: true, inApp: true },
    marketing: { email: true, inApp: true },
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function fetchPreferences() {
      try {
        const response = await fetch('/api/notifications/preferences');
        if (!response.ok) throw new Error('Failed to fetch preferences');
        const data = await response.json();
        
        if (data.preferences && data.preferences.length > 0) {
          const newState = { ...preferences };
          data.preferences.forEach((p: any) => {
            if (newState[p.category as CategoryId]) {
              newState[p.category as CategoryId] = {
                email: p.emailEnabled,
                inApp: p.inAppEnabled,
              };
            }
          });
          setPreferences(newState);
        }
      } catch (error) {
        console.error('Error fetching preferences:', error);
        toast.error('Failed to load notification settings');
      } finally {
        setIsLoading(false);
      }
    }

    fetchPreferences();
  }, []);

  const handleToggle = async (category: CategoryId, type: 'email' | 'inApp') => {
    const newVal = !preferences[category][type];
    
    // Optimistic update
    setPreferences(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [type]: newVal,
      },
    }));

    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          [type === 'email' ? 'emailEnabled' : 'inAppEnabled']: newVal,
        }),
      });

      if (!response.ok) throw new Error('Failed to update preference');
      toast.success('Preference updated');
    } catch (error) {
      console.error('Error updating preference:', error);
      toast.error('Failed to save change');
      // Rollback
      setPreferences(prev => ({
        ...prev,
        [category]: {
          ...prev[category],
          [type]: !newVal,
        },
      }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <Loader2 className="animate-spin text-blue-600" size={40} />
        <p className="text-slate-500 font-medium anim-pulse">Loading notification settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Bell className="text-blue-600" />
          Notification Preferences
        </h1>
        <p className="text-slate-600 mt-2">
          Control how and when you want to be notified across the Stellar platform.
        </p>
      </motion.div>

      <div className="grid gap-6">
        {CATEGORIES.map((category, index) => (
          <motion.div
            key={category.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="hover:shadow-md transition-shadow duration-200">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-slate-50 rounded-lg group-hover:scale-110 transition-transform">
                    {category.icon}
                  </div>
                  <div>
                    <CardTitle className="text-xl font-semibold">{category.name}</CardTitle>
                    <CardDescription>{category.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-col sm:flex-row gap-6 sm:gap-12 py-4">
                  <div className="flex items-center justify-between space-x-4 flex-1 p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex flex-col space-y-0.5">
                      <Label htmlFor={`email-${category.id}`} className="text-base font-medium flex items-center gap-2">
                        <Mail size={16} className="text-slate-400" />
                        Email Notifications
                      </Label>
                      <span className="text-xs text-slate-500">
                        Receive updates via your registered email
                      </span>
                    </div>
                    <Switch
                      id={`email-${category.id}`}
                      checked={preferences[category.id].email}
                      onCheckedChange={() => handleToggle(category.id, 'email')}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between space-x-4 flex-1 p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex flex-col space-y-0.5">
                      <Label htmlFor={`inApp-${category.id}`} className="text-base font-medium flex items-center gap-2">
                        <Bell size={16} className="text-slate-400" />
                        In-App Alerts
                      </Label>
                      <span className="text-xs text-slate-500">
                        View notifications in your dashboard center
                      </span>
                    </div>
                    <Switch
                      id={`inApp-${category.id}`}
                      checked={preferences[category.id].inApp}
                      onCheckedChange={() => handleToggle(category.id, 'inApp')}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-12 p-6 bg-blue-50 border border-blue-100 rounded-xl"
      >
        <div className="flex items-start gap-4">
          <div className="p-2 bg-blue-100 rounded-full">
            <ShieldCheck className="text-blue-700" size={24} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-blue-900">GDPR & CAN-SPAM Compliance</h3>
            <p className="text-blue-800/80 text-sm mt-1 leading-relaxed">
              We respect your privacy and provide a one-click unsubscribe mechanism in every email. 
              Disabling notifications here will immediately stop further automated communications 
              for the selected categories. Critical security alerts and essential transactional 
              activity updates will always be sent to ensure account safety.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
