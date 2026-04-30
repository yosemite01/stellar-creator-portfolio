'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Users, Briefcase, DollarSign, Flag, TrendingUp,
  UserPlus, CheckCircle, ArrowRight, ScrollText, Gavel,
} from 'lucide-react';
import {
  mockStats, mockAuditLogs, mockReports,
  type AuditLog,
} from '@/lib/services/admin-service';

const ACTION_LABELS: Record<string, string> = {
  'user.suspend': 'Suspended user',
  'user.activate': 'Activated user',
  'user.delete': 'Deleted user',
  'user.role_change': 'Changed role',
  'bounty.approve': 'Approved bounty',
  'bounty.flag': 'Flagged bounty',
  'bounty.delete': 'Deleted bounty',
  'report.resolve': 'Resolved report',
  'report.dismiss': 'Dismissed report',
  'verification.approve': 'Approved verification',
  'verification.revoke': 'Revoked verification',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminOverviewPage() {
  const stats = mockStats;
  const recentLogs = mockAuditLogs.slice(0, 5);
  const openReports = mockReports.filter((r) => r.status === 'open');

  const statCards = [
    { label: 'Total Users', value: stats.totalUsers.toLocaleString(), sub: `+${stats.newUsersThisWeek} this week`, icon: Users, color: 'text-blue-500' },
    { label: 'Active Users', value: stats.activeUsers.toLocaleString(), sub: `${Math.round((stats.activeUsers / stats.totalUsers) * 100)}% of total`, icon: TrendingUp, color: 'text-green-500' },
    { label: 'Open Bounties', value: stats.openBounties.toString(), sub: `${stats.totalBounties} total`, icon: Briefcase, color: 'text-purple-500' },
    { label: 'Total Revenue', value: `$${(stats.totalRevenue / 1000).toFixed(1)}k`, sub: `${stats.completedBountiesThisMonth} completed this month`, icon: DollarSign, color: 'text-yellow-500' },
    { label: 'Pending Reports', value: stats.pendingReports.toString(), sub: openReports.length > 0 ? 'Needs attention' : 'All clear', icon: Flag, color: openReports.length > 0 ? 'text-red-500' : 'text-muted-foreground' },
  ];

  const quickLinks = [
    { href: '/admin/users', label: 'Manage Users', icon: Users },
    { href: '/admin/bounties', label: 'Moderate Bounties', icon: Briefcase },
    { href: '/admin/verifications', label: 'Verifications', icon: CheckCircle },
    { href: '/admin/reports', label: 'Open Reports', icon: Flag },
    { href: '/admin/disputes', label: 'Disputes', icon: Gavel },
    { href: '/admin/audit', label: 'Audit Log', icon: ScrollText },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-1">Admin Overview</h1>
        <p className="text-muted-foreground text-sm">Platform health at a glance.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {statCards.map(({ label, value, sub, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <Icon size={18} className={`mb-2 ${color}`} />
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-xs font-medium text-foreground">{label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Quick Links */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {quickLinks.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <div className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-secondary transition-colors cursor-pointer">
                  <div className="flex items-center gap-2 text-sm">
                    <Icon size={15} className="text-muted-foreground" />
                    {label}
                  </div>
                  <ArrowRight size={14} className="text-muted-foreground" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Recent Audit */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <Link href="/admin/audit">
              <Button variant="ghost" size="sm" className="text-xs h-7">View all</Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentLogs.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{ACTION_LABELS[log.action] ?? log.action}</p>
                  <p className="text-xs text-muted-foreground truncate">{log.targetLabel}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(log.timestamp)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Open Reports Alert */}
      {openReports.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Flag size={18} className="text-red-500 shrink-0" />
              <div>
                <p className="text-sm font-medium">{openReports.length} open report{openReports.length > 1 ? 's' : ''} need review</p>
                <p className="text-xs text-muted-foreground">Content moderation requires attention</p>
              </div>
            </div>
            <Link href="/admin/reports">
              <Button size="sm" variant="destructive">Review</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
