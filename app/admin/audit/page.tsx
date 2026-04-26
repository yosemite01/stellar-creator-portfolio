'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { mockAuditLogs, type AuditLog } from '@/lib/services/admin-service';

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

const ACTION_COLORS: Record<string, string> = {
  'user.suspend': 'text-red-500',
  'user.delete': 'text-red-500',
  'bounty.delete': 'text-red-500',
  'bounty.flag': 'text-amber-500',
  'user.activate': 'text-green-500',
  'bounty.approve': 'text-green-500',
  'verification.approve': 'text-green-500',
  'report.resolve': 'text-green-500',
  'verification.revoke': 'text-amber-500',
  'report.dismiss': 'text-muted-foreground',
  'user.role_change': 'text-blue-500',
};

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminAuditPage() {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return mockAuditLogs;
    const q = search.toLowerCase();
    return mockAuditLogs.filter((l) =>
      l.targetLabel.toLowerCase().includes(q) ||
      l.adminName.toLowerCase().includes(q) ||
      ACTION_LABELS[l.action]?.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Audit Log</h1>
        <p className="text-muted-foreground text-sm">Complete trail of all admin actions.</p>
      </div>

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search logs..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filtered.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${ACTION_COLORS[log.action] ?? 'text-foreground'}`}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                    <span className="text-sm text-foreground">— {log.targetLabel}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    by {log.adminName}
                    {log.note && <span> · {log.note}</span>}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{formatTimestamp(log.timestamp)}</span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">No logs found</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
