'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useEffect, useReducer, useState } from 'react';
import { Header } from '@/components/layout/header';
import { DisputeForm } from '@/components/forms/dispute-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getDisputeSnapshot,
  listDisputesForUser,
  computeDisputeAnalytics,
  type DisputeRecord,
} from '@/lib/services/dispute-service';
import { Scale, Shield, History } from 'lucide-react';

const STATUS_LABEL: Record<DisputeRecord['status'], string> = {
  filed: 'Filed',
  evidence: 'Evidence',
  mediation: 'Mediation',
  community_vote: 'Community vote',
  resolved: 'Resolved',
  appealed: 'Appeal',
  closed: 'Closed',
};

export default function DisputesPage() {
  const { data: session, status } = useSession();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  const snapshot =
    mounted && typeof window !== 'undefined'
      ? getDisputeSnapshot()
      : { disputes: [] as DisputeRecord[] };

  const myDisputes = session?.user?.id
    ? listDisputesForUser(session.user.id)
    : [];

  const analytics = computeDisputeAnalytics(snapshot.disputes);

  if (status === 'loading' || !mounted) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div>
          <div className="flex items-start gap-3 mb-2">
            <Scale className="h-8 w-8 text-primary shrink-0" />
            <div>
              <h1 className="text-2xl font-bold mb-1">Dispute resolution</h1>
              <p className="text-muted-foreground text-sm">
                File a dispute, submit hashed evidence, and track progress. Escrow holds are
                simulated until treasury integration is live.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="h-4 w-4" /> Open pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.totalOpen}</p>
              <p className="text-xs text-muted-foreground">Across platform (demo data)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Your cases</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{myDisputes.length}</p>
              <p className="text-xs text-muted-foreground">Where you are a party</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Resolved (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.resolvedLast30d}</p>
              <p className="text-xs text-muted-foreground">Prevention signals tracked</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>File a new dispute</CardTitle>
            <CardDescription>
              Provide a clear description and reference. Optional evidence is fingerprinted
              (SHA-256) on device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DisputeForm
              userId={session.user.id}
              userName={session.user.name || session.user.email || 'User'}
              onFiled={() => bump()}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Your dispute history
            </CardTitle>
            <CardDescription>
              Only disputes you filed or are named on are listed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {myDisputes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No disputes yet.</p>
            ) : (
              myDisputes.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border border-border rounded-lg p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.id} · {new Date(d.updatedAt).toLocaleString()}
                    </p>
                    {d.escrow.held && (
                      <p className="text-xs text-amber-600 mt-1">
                        Escrow hold: ${(d.escrow.amountCents / 100).toFixed(2)} (simulated)
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline">{STATUS_LABEL[d.status]}</Badge>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href="/dashboard">Dashboard</Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
