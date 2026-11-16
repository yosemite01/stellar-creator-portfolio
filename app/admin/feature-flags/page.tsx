'use client';

/**
 * Feature Flags Admin Panel — Issue #837
 *
 * Lists all flags with toggle, rollout-percent slider, and analytics.
 * Route: /admin/feature-flags
 */

import { useState, useEffect, useCallback } from 'react';
import { UserTableSkeleton } from '@/components/ui/skeleton-group';

interface FlagRow {
  id: string;
  name: string;
  enabled: boolean;
  rolloutPercent: number;
  description: string | null;
  _count: { evaluations: number };
  updatedAt: string;
}

export default function FeatureFlagsAdminPage() {
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newFlag, setNewFlag] = useState({
    name: '',
    description: '',
    rolloutPercent: 0,
  });

  const loadFlags = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/feature-flags');
      if (res.ok) setFlags(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFlags(); }, [loadFlags]);

  async function toggleFlag(name: string, enabled: boolean) {
    setSaving(name);
    try {
      await fetch(`/api/admin/feature-flags/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setFlags((prev) =>
        prev.map((f) => (f.name === name ? { ...f, enabled } : f)),
      );
    } finally {
      setSaving(null);
    }
  }

  async function updateRollout(name: string, rolloutPercent: number) {
    setSaving(name);
    try {
      await fetch(`/api/admin/feature-flags/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rolloutPercent }),
      });
      setFlags((prev) =>
        prev.map((f) => (f.name === name ? { ...f, rolloutPercent } : f)),
      );
    } finally {
      setSaving(null);
    }
  }

  async function createFlag(e: React.FormEvent) {
    e.preventDefault();
    setSaving('__new__');
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newFlag, enabled: false }),
      });
      if (res.ok) {
        setNewFlag({ name: '', description: '', rolloutPercent: 0 });
        loadFlags();
      }
    } finally {
      setSaving(null);
    }
  }

  async function deleteFlag(name: string) {
    if (!confirm(`Delete flag "${name}"?`)) return;
    setSaving(name);
    try {
      await fetch(`/api/admin/feature-flags/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      setFlags((prev) => prev.filter((f) => f.name !== name));
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-8">
          <div className="h-8 bg-muted rounded w-48 mb-2 animate-pulse" />
          <div className="h-4 bg-muted rounded w-96 animate-pulse" />
        </div>
        <UserTableSkeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Changes propagate to users within 60 seconds via Redis cache TTL.
        </p>
      </div>

      {/* ── Flag table ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Flag</th>
              <th className="text-left px-4 py-3 font-medium">Enabled</th>
              <th className="text-left px-4 py-3 font-medium">Rollout %</th>
              <th className="text-left px-4 py-3 font-medium">Evaluations</th>
              <th className="text-left px-4 py-3 font-medium">Updated</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {flags.map((flag) => (
              <tr key={flag.id} className="hover:bg-muted/20 transition-colors">
                {/* Name + description */}
                <td className="px-4 py-3">
                  <span className="font-mono font-semibold text-foreground">
                    {flag.name}
                  </span>
                  {flag.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {flag.description}
                    </p>
                  )}
                </td>

                {/* Toggle */}
                <td className="px-4 py-3">
                  <button
                    id={`flag-toggle-${flag.name}`}
                    disabled={saving === flag.name}
                    onClick={() => toggleFlag(flag.name, !flag.enabled)}
                    aria-label={`Toggle ${flag.name}`}
                    className={[
                      'relative w-10 h-6 rounded-full transition-colors focus-visible:ring-2',
                      flag.enabled ? 'bg-emerald-500' : 'bg-border',
                      saving === flag.name ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
                        flag.enabled ? 'translate-x-4' : 'translate-x-0',
                      ].join(' ')}
                    />
                  </button>
                </td>

                {/* Rollout slider */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      id={`flag-rollout-${flag.name}`}
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={flag.rolloutPercent}
                      disabled={saving === flag.name}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setFlags((prev) =>
                          prev.map((f) =>
                            f.name === flag.name
                              ? { ...f, rolloutPercent: v }
                              : f,
                          ),
                        );
                      }}
                      onMouseUp={(e) =>
                        updateRollout(
                          flag.name,
                          Number((e.target as HTMLInputElement).value),
                        )
                      }
                      onTouchEnd={(e) =>
                        updateRollout(
                          flag.name,
                          Number((e.target as HTMLInputElement).value),
                        )
                      }
                      className="w-24 accent-emerald-500"
                    />
                    <span className="w-8 text-right tabular-nums">
                      {flag.rolloutPercent}%
                    </span>
                  </div>
                </td>

                {/* Evaluations count */}
                <td className="px-4 py-3 text-muted-foreground tabular-nums" suppressHydrationWarning>
                  {flag._count.evaluations.toLocaleString()}
                </td>

                {/* Updated at */}
                <td className="px-4 py-3 text-muted-foreground text-xs" suppressHydrationWarning>
                  {new Date(flag.updatedAt).toLocaleString()}
                </td>

                {/* Delete */}
                <td className="px-4 py-3">
                  <button
                    id={`flag-delete-${flag.name}`}
                    onClick={() => deleteFlag(flag.name)}
                    disabled={saving === flag.name}
                    className="text-destructive hover:text-destructive/80 text-xs disabled:opacity-40"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Create new flag ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border p-6 space-y-4">
        <h2 className="text-lg font-semibold">Create Flag</h2>
        <form onSubmit={createFlag} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="new-flag-name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="new-flag-name"
              type="text"
              placeholder="live_streaming"
              value={newFlag.name}
              onChange={(e) => setNewFlag((p) => ({ ...p, name: e.target.value }))}
              required
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="new-flag-desc" className="text-sm font-medium">
              Description
            </label>
            <input
              id="new-flag-desc"
              type="text"
              placeholder="Short description"
              value={newFlag.description}
              onChange={(e) => setNewFlag((p) => ({ ...p, description: e.target.value }))}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="new-flag-rollout" className="text-sm font-medium">
              Rollout %
            </label>
            <input
              id="new-flag-rollout"
              type="number"
              min={0}
              max={100}
              value={newFlag.rolloutPercent}
              onChange={(e) =>
                setNewFlag((p) => ({
                  ...p,
                  rolloutPercent: Number(e.target.value),
                }))
              }
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none"
            />
          </div>

          <div className="sm:col-span-3 flex justify-end">
            <button
              id="create-flag-submit"
              type="submit"
              disabled={saving === '__new__' || !newFlag.name}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {saving === '__new__' ? 'Creating…' : 'Create Flag'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
