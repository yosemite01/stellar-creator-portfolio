'use client';

import { useState } from 'react';
import { creators } from '@/lib/services/creators-data';
import type { Creator, VerificationStatus, SpecialBadge } from '@/lib/services/creators-data';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VerificationBadge, BadgeRow } from '@/components/widgets/verification-badge';
import { BadgeCheck, Clock, UserX, CheckCircle, XCircle, Star, Zap, Award, TrendingUp } from 'lucide-react';

type LocalCreator = Creator & {
  verification: NonNullable<Creator['verification']>;
};

const SPECIAL_BADGES: { value: SpecialBadge; label: string; icon: React.ElementType }[] = [
  { value: 'top-rated', label: 'Top Rated', icon: Star },
  { value: 'responsive', label: 'Responsive', icon: Zap },
  { value: 'certified', label: 'Certified', icon: Award },
  { value: 'rising-star', label: 'Rising Star', icon: TrendingUp },
];

const statusColor: Record<VerificationStatus, string> = {
  verified: 'bg-green-500/10 text-green-600 border-green-500/20',
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  unverified: 'bg-muted text-muted-foreground border-border',
};

const statusIcon: Record<VerificationStatus, React.ElementType> = {
  verified: BadgeCheck,
  pending: Clock,
  unverified: UserX,
};

export default function AdminVerificationsPage() {
  const [creatorList, setCreatorList] = useState<LocalCreator[]>(
    creators.map((c) => ({
      ...c,
      verification: c.verification ?? { status: 'unverified' },
    }))
  );
  const [notification, setNotification] = useState<string | null>(null);

  const counts = {
    verified: creatorList.filter((c) => c.verification.status === 'verified').length,
    pending: creatorList.filter((c) => c.verification.status === 'pending').length,
    unverified: creatorList.filter((c) => c.verification.status === 'unverified').length,
  };

  function updateStatus(id: string, status: VerificationStatus) {
    setCreatorList((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              verification: {
                ...c.verification,
                status,
                verifiedAt: status === 'verified' ? new Date().toISOString() : c.verification.verifiedAt,
                verifiedBy: status === 'verified' ? 'Admin' : c.verification.verifiedBy,
              },
            }
          : c
      )
    );
    const creator = creatorList.find((c) => c.id === id);
    if (creator) {
      const msg = status === 'verified'
        ? `✓ Verification approved for ${creator.name}. Notification sent.`
        : status === 'pending'
        ? `⏳ ${creator.name} marked as pending review.`
        : `✗ Verification revoked for ${creator.name}.`;
      setNotification(msg);
      setTimeout(() => setNotification(null), 3000);
    }
  }

  function toggleBadge(id: string, badge: SpecialBadge) {
    setCreatorList((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const current = c.verification.badges ?? [];
        const updated = current.includes(badge)
          ? current.filter((b) => b !== badge)
          : [...current, badge];
        return { ...c, verification: { ...c.verification, badges: updated } };
      })
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Creator Verifications</h1>
          <p className="text-muted-foreground">Manage verification status and special badges for creators.</p>
        </div>

        {/* Notification */}
        {notification && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-primary/10 text-primary text-sm border border-primary/20">
            {notification}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {(['verified', 'pending', 'unverified'] as VerificationStatus[]).map((s) => {
            const Icon = statusIcon[s];
            return (
              <Card key={s}>
                <CardContent className="pt-4 pb-4 flex items-center gap-3">
                  <Icon size={20} className={s === 'verified' ? 'text-green-500' : s === 'pending' ? 'text-amber-500' : 'text-muted-foreground'} />
                  <div>
                    <div className="text-2xl font-bold">{counts[s]}</div>
                    <div className="text-xs text-muted-foreground capitalize">{s}</div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Verification Criteria */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base">Verification Criteria</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
            {[
              'Completed profile with portfolio samples',
              'Verified email address',
              'At least 3 completed projects',
              'Positive client references',
              'Skills assessment passed',
              'Identity verification completed',
            ].map((c) => (
              <div key={c} className="flex items-center gap-2">
                <CheckCircle size={14} className="text-primary shrink-0" />
                {c}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Creator List */}
        <div className="space-y-4">
          {creatorList.map((creator) => {
            const { status, verifiedAt, badges = [] } = creator.verification;
            return (
              <Card key={creator.id}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-semibold">{creator.name}</span>
                        <VerificationBadge status={status} verifiedAt={verifiedAt} size="sm" showLabel />
                        {badges.length > 0 && <BadgeRow badges={badges} />}
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">{creator.title} · {creator.discipline}</p>
                      {verifiedAt && status === 'verified' && (
                        <p className="text-xs text-muted-foreground">
                          Verified {new Date(verifiedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                    </div>

                    {/* Status Badge */}
                    <span className={`text-xs font-medium px-2 py-1 rounded-full border self-start ${statusColor[status]}`}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {status !== 'verified' && (
                      <Button size="sm" onClick={() => updateStatus(creator.id, 'verified')} className="gap-1">
                        <CheckCircle size={14} /> Approve
                      </Button>
                    )}
                    {status !== 'pending' && (
                      <Button size="sm" variant="outline" onClick={() => updateStatus(creator.id, 'pending')} className="gap-1">
                        <Clock size={14} /> Mark Pending
                      </Button>
                    )}
                    {status !== 'unverified' && (
                      <Button size="sm" variant="destructive" onClick={() => updateStatus(creator.id, 'unverified')} className="gap-1">
                        <XCircle size={14} /> Revoke
                      </Button>
                    )}
                  </div>

                  {/* Special Badges */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {SPECIAL_BADGES.map(({ value, label, icon: Icon }) => {
                      const active = badges.includes(value);
                      return (
                        <button
                          key={value}
                          onClick={() => toggleBadge(creator.id, value)}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                            active
                              ? 'bg-primary/10 border-primary/30 text-primary'
                              : 'bg-muted border-border text-muted-foreground hover:border-primary/30'
                          }`}
                        >
                          <Icon size={12} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
