'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle, XCircle, Flag, MessageSquare, User, Briefcase,
  AlertTriangle, ArrowUpRight, Trash2, Image,
} from 'lucide-react';
import {
  mockReports, mockAuditLogs, addAuditLog,
  type ContentReport, type ReportStatus, type AuditLog,
} from '@/lib/services/admin-service';

// ── Icon map ──────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<ContentReport['type'], React.ElementType> = {
  bounty: Briefcase,
  profile: User,
  message: MessageSquare,
  portfolio: Image,
};

// ── Status badge colours ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<ReportStatus, string> = {
  open: 'bg-red-500/10 text-red-600 border-red-500/20',
  resolved: 'bg-green-500/10 text-green-600 border-green-500/20',
  dismissed: 'bg-muted text-muted-foreground border-border',
  escalated: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  removed: 'bg-purple-500/10 text-purple-700 border-purple-500/20',
};

// ── Filter tabs ───────────────────────────────────────────────────────────────

const FILTERS = ['open', 'resolved', 'dismissed', 'escalated', 'removed', 'All'] as const;
type FilterValue = typeof FILTERS[number];

// ── Dialogs ───────────────────────────────────────────────────────────────────

interface ReasonDialogProps {
  title: string;
  label: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function ReasonDialog({ title, label, onConfirm, onCancel }: ReasonDialogProps) {
  const [value, setValue] = useState('');
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reason-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-card border border-border rounded-xl shadow-lg p-6 w-full max-w-md space-y-4">
        <h2 id="reason-dialog-title" className="text-lg font-semibold">{title}</h2>
        <div>
          <label htmlFor="reason-input" className="block text-sm font-medium mb-1">
            {label} <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="reason-input"
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-required="true"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Provide a reason…"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" disabled={!value.trim()} onClick={() => onConfirm(value.trim())}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ContentReport[]>(mockReports);
  const [logs, setLogs] = useState<AuditLog[]>(mockAuditLogs);
  const [filter, setFilter] = useState<FilterValue>('open');
  const [toast, setToast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { type: 'escalate'; reportId: string }
    | { type: 'remove'; reportId: string }
    | null
  >(null);
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30); // Default: 30 days ago
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [exporting, setExporting] = useState<string | null>(null);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function updateReport(id: string, status: ReportStatus, extra?: Partial<ContentReport>) {
    setReports((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status, ...extra } : r))
    );
  }

  function resolve(id: string) {
    const report = reports.find((r) => r.id === id);
    if (!report) return;
    updateReport(id, 'resolved');
    setLogs((prev) => addAuditLog(prev, 'report.resolve', id, report.targetTitle));
    notify('Report resolved. Content remains visible.');
  }

  function dismiss(id: string) {
    const report = reports.find((r) => r.id === id);
    if (!report) return;
    updateReport(id, 'dismissed');
    setLogs((prev) => addAuditLog(prev, 'report.dismiss', id, report.targetTitle));
    notify('Report dismissed.');
  }

  function remove(id: string, reason: string) {
    const report = reports.find((r) => r.id === id);
    if (!report) return;
    updateReport(id, 'removed', { removalReason: reason });
    setLogs((prev) =>
      addAuditLog(prev, 'report.remove', id, report.targetTitle, reason)
    );
    // In production, send in-app notification to creator here.
    notify(`Content removed. Creator notified with reason.`);
  }

  function escalate(id: string, reason: string) {
    const report = reports.find((r) => r.id === id);
    if (!report) return;
    updateReport(id, 'escalated', { escalateReason: reason });
    setLogs((prev) =>
      addAuditLog(prev, 'report.escalate', id, report.targetTitle, reason)
    );
    notify('Report escalated to the legal team.');
  }

  const filtered = useMemo(
    () => (filter === 'All' ? reports : reports.filter((r) => r.status === filter)),
    [reports, filter]
  );

  const counts: Record<string, number> = {
    open: reports.filter((r) => r.status === 'open').length,
    resolved: reports.filter((r) => r.status === 'resolved').length,
    dismissed: reports.filter((r) => r.status === 'dismissed').length,
    escalated: reports.filter((r) => r.status === 'escalated').length,
    removed: reports.filter((r) => r.status === 'removed').length,
  };

  const handleExport = async (reportType: string, format: 'csv' | 'json') => {
    try {
      setExporting(`${reportType}-${format}`);
      const params = new URLSearchParams({
        startDate,
        endDate,
        format,
      });
      const url = `/api/admin/reports/${reportType}?${params.toString()}`;

      // Trigger download
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportType}-report.${format === 'csv' ? 'csv' : 'json'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      notify(`${reportType} report exported as ${format.toUpperCase()}`);
    } catch (error) {
      console.error('Export failed:', error);
      notify(`Failed to export ${reportType} report`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Content Moderation Queue</h1>
        <p className="text-muted-foreground text-sm">
          {counts.open} open · {counts.resolved} resolved · {counts.dismissed} dismissed ·{' '}
          {counts.escalated} escalated · {counts.removed} removed
        </p>
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 py-3 rounded-lg bg-primary/10 text-primary text-sm border border-primary/20"
        >
          {toast}
        </div>
      )}

      {/* Auto-blur notice */}
      {reports.some((r) => r.isAutoBlurred && r.status === 'open') && (
        <div
          role="note"
          className="flex items-start gap-2 px-4 py-3 rounded-lg bg-amber-500/10 text-amber-700 text-sm border border-amber-500/20"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Items marked <strong>Auto-blurred</strong> have 3+ flags and are hidden from users
            pending your review.
          </span>
        </div>
      )}

      {/* Filter tabs */}
      <div role="tablist" aria-label="Filter reports by status" className="flex flex-wrap gap-2">
        {FILTERS.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={filter === s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              filter === s
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s !== 'All' && counts[s] !== undefined && (
              <span className="ml-1.5 text-xs opacity-70">{counts[s]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Date range filter and export section */}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label htmlFor="start-date" className="block text-sm font-medium mb-1">
              Start Date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="end-date" className="block text-sm font-medium mb-1">
              End Date
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Export buttons */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Export Reports</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {['users', 'bounties', 'disputes', 'revenue'].map((reportType) => (
              <div key={reportType} className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => handleExport(reportType, 'csv')}
                  disabled={!!exporting}
                  aria-label={`Export ${reportType} as CSV`}
                >
                  {exporting === `${reportType}-csv` ? 'Exporting...' : `${reportType} CSV`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => handleExport(reportType, 'json')}
                  disabled={!!exporting}
                  aria-label={`Export ${reportType} as JSON`}
                >
                  {exporting === `${reportType}-json` ? 'Exporting...' : `${reportType} JSON`}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Report cards */}
      <div className="space-y-3" role="tabpanel" aria-label={`${filter} reports`}>
        {filtered.map((report) => {
          const Icon = TYPE_ICON[report.type];
          return (
            <Card key={report.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 p-1.5 rounded-md bg-muted" aria-hidden="true">
                      <Icon size={14} className="text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* Title row */}
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-sm">{report.targetTitle}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[report.status]}`}
                        >
                          {report.status}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize">
                          {report.type}
                        </span>
                        {/* Auto-blur badge */}
                        {report.isAutoBlurred && report.status === 'open' && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/20 font-medium">
                            <AlertTriangle size={10} aria-hidden="true" />
                            Auto-blurred
                          </span>
                        )}
                        {/* Flag count */}
                        <span
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                          aria-label={`${report.flagCount} flags`}
                        >
                          <Flag size={10} aria-hidden="true" />
                          {report.flagCount}
                        </span>
                      </div>

                      {/* Reason */}
                      <p className="text-sm text-foreground mb-1">{report.reason}</p>

                      {/* Meta */}
                      <p className="text-xs text-muted-foreground">
                        Reported by <strong>{report.reportedBy}</strong> · Creator:{' '}
                        <strong>{report.creatorName}</strong> · {report.createdAt}
                      </p>

                      {/* Escalation / removal reason if set */}
                      {report.escalateReason && (
                        <p className="text-xs text-amber-700 mt-1">
                          Escalation note: {report.escalateReason}
                        </p>
                      )}
                      {report.removalReason && (
                        <p className="text-xs text-purple-700 mt-1">
                          Removal reason sent to creator: {report.removalReason}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Action buttons — only shown on open reports */}
                  {report.status === 'open' && (
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => resolve(report.id)}
                        aria-label={`Approve and keep visible: ${report.targetTitle}`}
                      >
                        <CheckCircle size={12} aria-hidden="true" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs gap-1"
                        onClick={() => setDialog({ type: 'remove', reportId: report.id })}
                        aria-label={`Remove content and notify creator: ${report.targetTitle}`}
                      >
                        <Trash2 size={12} aria-hidden="true" /> Remove
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => setDialog({ type: 'escalate', reportId: report.id })}
                        aria-label={`Escalate to legal team: ${report.targetTitle}`}
                      >
                        <ArrowUpRight size={12} aria-hidden="true" /> Escalate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1"
                        onClick={() => dismiss(report.id)}
                        aria-label={`Dismiss report: ${report.targetTitle}`}
                      >
                        <XCircle size={12} aria-hidden="true" /> Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No reports in this category
          </div>
        )}
      </div>

      {/* Reason dialogs */}
      {dialog?.type === 'remove' && (
        <ReasonDialog
          title="Remove Content"
          label="Reason (sent to creator)"
          onConfirm={(reason) => {
            remove(dialog.reportId, reason);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'escalate' && (
        <ReasonDialog
          title="Escalate to Legal Team"
          label="Escalation reason"
          onConfirm={(reason) => {
            escalate(dialog.reportId, reason);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
