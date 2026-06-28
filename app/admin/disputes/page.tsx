'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Gavel, RefreshCw } from 'lucide-react';

interface Dispute {
  id: string;
  escrowId: string;
  creatorId: string;
  clientId: string;
  status: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

type Resolution = 'release_to_freelancer' | 'refund_to_creator' | 'split_50_50';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  resolved: 'bg-green-500/10 text-green-600 border-green-500/20',
  closed: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const RESOLUTION_LABELS: Record<Resolution, string> = {
  release_to_freelancer: 'Release to Freelancer',
  refund_to_creator: 'Refund to Creator',
  split_50_50: 'Split 50/50',
};

function ageLabel(createdAt: string) {
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs > 0) return `${hrs}h ago`;
  return 'just now';
}

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/disputes?status=${statusFilter}&page=${page}&limit=${LIMIT}`
      );
      if (!res.ok) throw new Error('Failed to load disputes');
      const data = await res.json();
      setDisputes(data.disputes);
      setTotal(data.total);
    } catch (e) {
      notify('Failed to load disputes');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  const selected = disputes.find((d) => d.id === selectedId) ?? null;

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function resolve(resolution: Resolution) {
    if (!selected) return;
    setResolving(true);
    try {
      const res = await fetch(`/api/admin/disputes/${selected.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to resolve');
      }
      notify(`Resolved: ${RESOLUTION_LABELS[resolution]}`);
      setNote('');
      setSelectedId(null);
      await load();
    } catch (e: any) {
      notify(e.message ?? 'Error resolving dispute');
    } finally {
      setResolving(false);
    }
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-6">
      {/* Toast */}
      {toast && (
        <div
          aria-live="polite"
          className="fixed top-4 right-4 z-50 bg-foreground text-background px-4 py-2 rounded-lg shadow-lg text-sm"
        >
          {toast}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Admin
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2 mb-1">
          <Gavel className="h-6 w-6" /> Dispute Management
        </h1>
        <p className="text-sm text-muted-foreground">
          Review disputes and trigger on-chain resolution. All actions are logged to the audit trail.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['open', 'resolved', 'all'] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={statusFilter === s ? 'default' : 'outline'}
            onClick={() => { setStatusFilter(s); setPage(1); setSelectedId(null); }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">{total} dispute{total !== 1 ? 's' : ''}</span>
        <Button variant="ghost" size="icon" onClick={load} aria-label="Refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* List */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cases</CardTitle>
            <CardDescription>Select a dispute to review</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[500px] overflow-y-auto">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
              ))
            ) : disputes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No disputes found.</p>
            ) : (
              disputes.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { setSelectedId(d.id); setNote(''); }}
                  className={`w-full text-left rounded-lg border p-3 text-sm transition-colors ${
                    selectedId === d.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-secondary/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${STATUS_COLORS[d.status] ?? ''}`}
                    >
                      {d.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{ageLabel(d.createdAt)}</span>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground truncate">{d.id}</div>
                  <div className="text-xs mt-1 truncate">Escrow: {d.escrowId}</div>
                </button>
              ))
            )}
          </CardContent>
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 px-4 pb-4">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="self-center text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </Card>

        {/* Detail + Resolution */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Dispute Detail</CardTitle>
            <CardDescription>
              {selected ? `ID: ${selected.id}` : 'Select a dispute from the list'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selected ? (
              <p className="text-sm text-muted-foreground">No dispute selected.</p>
            ) : (
              <>
                {/* Evidence / context */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground mb-0.5">Status</dt>
                    <dd>
                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[selected.status] ?? ''}
                      >
                        {selected.status}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground mb-0.5">Age</dt>
                    <dd>{ageLabel(selected.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground mb-0.5">Escrow ID</dt>
                    <dd className="font-mono text-xs truncate">{selected.escrowId}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground mb-0.5">Creator (party A)</dt>
                    <dd className="font-mono text-xs truncate">{selected.creatorId}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground mb-0.5">Client (party B)</dt>
                    <dd className="font-mono text-xs truncate">{selected.clientId}</dd>
                  </div>
                  {selected.reason && (
                    <div className="col-span-2">
                      <dt className="text-xs text-muted-foreground mb-0.5">Reason / Resolution</dt>
                      <dd>{selected.reason}</dd>
                    </div>
                  )}
                </dl>

                {selected.status === 'open' && (
                  <>
                    <div className="border-t border-border pt-4 space-y-3">
                      <p className="text-sm font-medium">Resolution Actions</p>
                      <p className="text-xs text-muted-foreground">
                        Each action calls <code className="font-mono">resolve_dispute()</code> on-chain
                        and writes an AuditLog entry.
                      </p>
                      <Textarea
                        placeholder="Optional admin note (logged to audit trail)"
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={resolving}
                        aria-label="Admin note"
                      />
                      <div className="flex flex-wrap gap-2">
                        {(Object.entries(RESOLUTION_LABELS) as [Resolution, string][]).map(
                          ([key, label]) => (
                            <Button
                              key={key}
                              size="sm"
                              disabled={resolving}
                              variant={key === 'release_to_freelancer' ? 'default' : 'outline'}
                              onClick={() => resolve(key)}
                            >
                              {label}
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  </>
                )}

                {selected.status !== 'open' && (
                  <div className="border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground">
                      This dispute has been <strong>{selected.status}</strong>.{' '}
                      {selected.reason && `Resolution: ${selected.reason}.`}
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
