'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { ReferralWidget } from '@/components/widgets/referral-widget';
import { Users, DollarSign, Clock, TrendingUp, Gift } from 'lucide-react';
import { REWARDS } from '@/lib/services/referral-service';
import type { ReferralStats, ReferralRecord } from '@/lib/services/referral-service';

const STATUS_STYLES: Record<string, string> = {
  pending:   'bg-yellow-500/10 text-yellow-600',
  converted: 'bg-blue-500/10 text-blue-600',
  rewarded:  'bg-green-500/10 text-green-600',
  flagged:   'bg-red-500/10 text-red-600',
};

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function ReferralsPage() {
  const [code, setCode]       = useState('');
  const [url, setUrl]         = useState('');
  const [stats, setStats]     = useState<ReferralStats | null>(null);
  const [history, setHistory] = useState<ReferralRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [codeRes, statsRes, historyRes] = await Promise.all([
          fetch('/api/referrals?action=code'),
          fetch('/api/referrals?action=stats'),
          fetch('/api/referrals?action=history'),
        ]);
        if (codeRes.ok) {
          const d = await codeRes.json();
          setCode(d.code.code);
          setUrl(d.referralUrl);
        }
        if (statsRes.ok)   setStats((await statsRes.json()).stats);
        if (historyRes.ok) setHistory((await historyRes.json()).history);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const statCards = stats
    ? [
        { label: 'Total Referrals', value: stats.totalReferrals, icon: Users,       color: 'text-primary' },
        { label: 'Converted',       value: stats.converted,      icon: TrendingUp,  color: 'text-blue-500' },
        { label: 'Pending',         value: stats.pending,        icon: Clock,       color: 'text-yellow-500' },
        { label: 'Total Earned',    value: fmt(stats.totalEarned), icon: DollarSign, color: 'text-green-500' },
      ]
    : [];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-grow">
        {/* Hero */}
        <section className="border-b border-border bg-muted/30 py-12 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-3">
              <Gift size={32} className="text-primary" />
              <h1 className="text-4xl sm:text-5xl font-bold text-foreground">Referral Program</h1>
            </div>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Invite creators and clients to Stellar and earn rewards for every successful referral.
            </p>
          </div>
        </section>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {statCards.map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="bg-card border border-border rounded-lg p-5">
                  <Icon size={20} className={`${color} mb-2`} />
                  <p className="text-2xl font-bold text-foreground">{value}</p>
                  <p className="text-sm text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Pending payout banner */}
          {stats && stats.pendingPayout > 0 && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-5 py-4 flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                You have <span className="font-bold">{fmt(stats.pendingPayout)}</span> pending payout ready to claim.
              </p>
              <button className="shrink-0 px-4 py-1.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition-colors">
                Request Payout
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: share widget + reward tiers */}
            <div className="space-y-6">
              {loading ? (
                <div className="bg-card border border-border rounded-lg p-6 animate-pulse h-40" />
              ) : (
                <ReferralWidget referralUrl={url} code={code} />
              )}

              {/* Reward tiers */}
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="font-semibold text-foreground mb-4">Reward Tiers</h3>
                <ul className="space-y-3">
                  {(
                    [
                      { event: 'signup',        label: 'New user signs up' },
                      { event: 'first_project', label: 'Referred user posts first project' },
                      { event: 'first_hire',    label: 'Referred user completes first hire' },
                    ] as const
                  ).map(({ event, label }) => (
                    <li key={event} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold text-foreground">{fmt(REWARDS[event])}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Right: referral history */}
            <div className="lg:col-span-2">
              <h3 className="font-semibold text-foreground mb-4">Referral History</h3>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-card border border-border rounded-lg p-4 animate-pulse h-16" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <div className="bg-card border border-border rounded-lg p-10 text-center">
                  <Users size={32} className="text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No referrals yet. Share your link to get started!</p>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-muted/40">
                      <tr>
                        {['User', 'Event', 'Reward', 'Status', 'Date'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {history.map((r) => (
                        <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.referredUserId.slice(0, 8)}…</td>
                          <td className="px-4 py-3 capitalize">{r.event.replace('_', ' ')}</td>
                          <td className="px-4 py-3 font-semibold text-foreground">{fmt(r.rewardAmount)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[r.status]}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(r.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
