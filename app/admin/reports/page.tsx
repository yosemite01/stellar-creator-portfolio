'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Flag, MessageSquare, User, Briefcase } from 'lucide-react';
import {
  mockReports, mockAuditLogs, addAuditLog,
  type ContentReport, type ReportStatus, type AuditLog,
} from '@/lib/services/admin-service';

const TYPE_ICON: Record<ContentReport['type'], React.ElementType> = {
  bounty: Briefcase,
  profile: User,
  message: MessageSquare,
};

const STATUS_COLORS: Record<ReportStatus, string> = {
  open: 'bg-red-500/10 text-red-600 border-red-500/20',
  resolved: 'bg-green-500/10 text-green-600 border-green-500/20',
  dismissed: 'bg-muted text-muted-foreground border-border',
};

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ContentReport[]>(mockReports);
  const [logs, setLogs] = useState<AuditLog[]>(mockAuditLogs);
  const [filter, setFilter] = useState<string>('open');
  const [toast, setToast] = useState<string | null>(null);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function updateReport(id: string, status: ReportStatus) {
    setReports((prev) => prev.map((r) => r.id === id ? { ...r, status } : r));
    const report = reports.find((r) => r.id === id);
    if (report) {
      const action = status === 'resolved' ? 'report.resolve' : 'report.dismiss';
      setLogs((prev) => addAuditLog(prev, action, report.id, report.targetTitle));
      notify(status === 'resolved' ? `Report resolved.` : `Report dismissed.`);
    }
  }

  const filtered = useMemo(() =>
    filter === 'All' ? reports : reports.filter((r) => r.status === filter),
    [reports, filter]
  );

  const counts = {
    open: reports.filter((r) => r.status === 'open').length,
    resolved: reports.filter((r) => r.status === 'resolved').length,
    dismissed: reports.filter((r) => r.status === 'dismissed').length,
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Content Reports</h1>
        <p className="text-muted-foreground text-sm">{counts.open} open · {counts.resolved} resolved · {counts.dismissed} dismissed</p>
      </div>

      {toast && (
        <div className="px-4 py-3 rounded-lg bg-primary/10 text-primary text-sm border border-primary/20">{toast}</div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {['open', 'resolved', 'dismissed', 'All'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === s ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s !== 'All' && <span className="ml-1.5 text-xs opacity-70">{counts[s as ReportStatus]}</span>}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((report) => {
          const Icon = TYPE_ICON[report.type];
          return (
            <Card key={report.id}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 p-1.5 rounded-md bg-muted">
                      <Icon size={14} className="text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-medium text-sm">{report.targetTitle}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[report.status]}`}>
                          {report.status}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize">{report.type}</span>
                      </div>
                      <p className="text-sm text-foreground mb-1">{report.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        Reported by {report.reportedBy} · {report.createdAt}
                      </p>
                    </div>
                  </div>

                  {report.status === 'open' && (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => updateReport(report.id, 'resolved')}>
                        <CheckCircle size={12} /> Resolve
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => updateReport(report.id, 'dismissed')}>
                        <XCircle size={12} /> Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">No reports in this category</div>
        )}
      </div>
    </div>
  );
}
