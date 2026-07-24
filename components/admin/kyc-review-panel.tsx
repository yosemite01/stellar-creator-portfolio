'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldX } from 'lucide-react';

interface KYCSubmissionRow {
  id: string;
  userId: string;
  userEmail: string | null;
  documentType: string;
  uploadedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  name: string;
  verifiedOnChain: boolean;
  txHash: string | null;
}

const STATUS_VARIANT: Record<KYCSubmissionRow['status'], 'secondary' | 'default' | 'destructive'> = {
  PENDING: 'secondary',
  APPROVED: 'default',
  REJECTED: 'destructive',
};

/**
 * Admin KYC review panel (Issue #782). Lists submissions awaiting review;
 * only the extracted name is ever shown here — DOB/ID number remain
 * encrypted and are not exposed via this UI.
 */
export function KYCReviewPanel() {
  const [submissions, setSubmissions] = useState<KYCSubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/kyc?status=PENDING');
      if (!res.ok) throw new Error(`Failed to load KYC submissions (${res.status})`);
      const data = await res.json();
      setSubmissions(data.submissions ?? []);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Failed to load KYC submissions');
    } finally {
      setLoading(false);
    }
  }

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function review(id: string, decision: 'approve' | 'reject') {
    const reason = decision === 'reject' ? prompt('Reason for rejection:') : undefined;
    if (decision === 'reject' && !reason) return;

    try {
      const res = await fetch(`/api/admin/kyc/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Review failed');

      notify(
        decision === 'approve'
          ? data.warning ?? 'Submission approved.'
          : 'Submission rejected.',
      );
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Review action failed');
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">KYC Submissions</h2>
          <p className="text-xs text-muted-foreground">Pending identity verification review</p>
        </div>

        {toast && (
          <div className="mx-4 mt-3 px-4 py-2 rounded-lg bg-primary/10 text-primary text-sm border border-primary/20">
            {toast}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Document</th>
                <th className="px-4 py-3 text-left">Uploaded</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Loading…
                  </td>
                </tr>
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    No pending KYC submissions
                  </td>
                </tr>
              ) : (
                submissions.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.userEmail}</td>
                    <td className="px-4 py-3">{s.documentType}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(s.uploadedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={() => review(s.id, 'approve')}
                        >
                          <ShieldCheck size={12} /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive gap-1"
                          onClick={() => review(s.id, 'reject')}
                        >
                          <ShieldX size={12} /> Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
