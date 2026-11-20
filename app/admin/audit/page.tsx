'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, Lock, Unlock, RefreshCw, AlertTriangle } from 'lucide-react';

// Types for real audit log data
interface AuditLogEntry {
  id: string;
  action: string;
  adminName: string;
  targetId: string;
  targetLabel: string;
  timestamp: string;
  note?: string;
  prevHash?: string | null;
  entryHash?: string;
  isTampered?: boolean;
  anchoredAt?: string | null;
}

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
  'db.backup': 'Database backup',
  'db.restore_drill': 'Restore drill test',
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
  'db.backup': 'text-teal-500',
  'db.restore_drill': 'text-indigo-500',
};

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Real API-based data fetching (replace mock when backend ready)
async function fetchAuditLogs(): Promise<AuditLogEntry[]> {
  // TODO: Replace with actual API call when backend is ready
  // const res = await fetch('/api/admin/audit/logs');
  // return res.json();
  return [];
}

async function verifyAuditChain(): Promise<{
  isValid: boolean;
  tamperedEntries: string[];
  message: string;
}> {
  const res = await fetch('/api/admin/audit/verify');
  const data = await res.json();
  return data;
}

export default function AdminAuditPage() {
  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [verification, setVerification] = useState<{
    isValid: boolean;
    tamperedEntries: string[];
    message: string;
    verifiedAt?: string;
  } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isAnchoring, setIsAnchoring] = useState(false);

  useEffect(() => {
    async function loadData() {
      const fetchedLogs = await fetchAuditLogs();
      setLogs(fetchedLogs);
      
      // Auto-verify on load
      runVerification();
    }
    loadData();
  }, []);

  async function runVerification() {
    setIsVerifying(true);
    try {
      const result = await verifyAuditChain();
      setVerification(result);
    } finally {
      setIsVerifying(false);
    }
  }

  async function anchorChain() {
    setIsAnchoring(true);
    try {
      await fetch('/api/admin/audit/anchor', { method: 'POST' });
      await runVerification();
    } finally {
      setIsAnchoring(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter((l) =>
      l.targetLabel.toLowerCase().includes(q) ||
      l.adminName.toLowerCase().includes(q) ||
      ACTION_LABELS[l.action]?.toLowerCase().includes(q)
    );
  }, [search, logs]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">Audit Log</h1>
          <p className="text-muted-foreground text-sm">
            Hash-chain verified tamper-evident audit trail
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {verification && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
              verification.isValid 
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              {verification.isValid ? <Lock size={16} /> : <AlertTriangle size={16} />}
              {verification.isValid ? 'Chain Verified' : 'Chain Compromised'}
              {!verification.isValid && verification.tamperedEntries.length > 0 && (
                <span>({verification.tamperedEntries.length} issues)</span>
              )}
            </div>
          )}
          
          <button
            onClick={runVerification}
            disabled={isVerifying}
            className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            title="Verify chain integrity"
          >
            <RefreshCw size={18} className={isVerifying ? 'animate-spin' : ''} />
          </button>
          
          <button
            onClick={anchorChain}
            disabled={isAnchoring || !verification?.isValid}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Lock size={16} />
            {isAnchoring ? 'Anchoring...' : 'Anchor on Stellar'}
          </button>
        </div>
      </div>

      {/* Verification Status Card */}
      {verification && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              {verification.isValid ? (
                <>
                  <div className="mt-1 text-green-500">
                    <Lock size={20} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-foreground">Hash Chain Verified</h3>
                    <p className="text-sm text-muted-foreground mt-1">{verification.message}</p>
                    {verification.verifiedAt && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Last verified: {new Date(verification.verifiedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="mt-1 text-red-500">
                    <AlertTriangle size={20} />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium text-foreground">Chain Integrity Compromised</h3>
                    <p className="text-sm text-muted-foreground mt-1">{verification.message}</p>
                    {verification.tamperedEntries.length > 0 && (
                      <div className="mt-3">
                        <p className="text-sm font-medium text-foreground">Tampered entries:</p>
                        <ul className="mt-1 space-y-1">
                          {verification.tamperedEntries.map((id) => (
                            <li key={id} className="text-xs font-mono text-red-600">
                              {id}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search logs..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filtered.length > 0 ? (
              filtered.map((log) => (
                <div key={log.id} className="flex items-start justify-between gap-4 px-4 py-3 hover:bg-muted/30 transition-colors group">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-medium ${ACTION_COLORS[log.action] ?? 'text-foreground'}`}>
                        {ACTION_LABELS[log.action] ?? log.action}
                      </span>
                      <span className="text-sm text-foreground">— {log.targetLabel}</span>
                      {log.isTampered && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          <AlertTriangle size={12} /> Tampered
                        </span>
                      )}
                      {!log.isTampered && log.entryHash && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          <Lock size={12} /> Verified
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      by {log.adminName}
                      {log.note && <span> · {log.note}</span>}
                      {log.entryHash && (
                        <span className="ml-2 font-mono text-[10px] opacity-70" title={log.entryHash}>
                          {log.entryHash.substring(0, 8)}...
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    {log.anchoredAt && (
                      <span className="text-xs text-blue-500 flex items-center gap-1" title={`Anchored: ${new Date(log.anchoredAt).toLocaleString()}`}>
                        <Lock size={12} />
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">No logs found</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
