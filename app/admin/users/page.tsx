'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Search, UserCheck, UserX, Trash2, ShieldCheck, ChevronDown,
} from 'lucide-react';
import {
  mockUsers, mockAuditLogs, addAuditLog,
  type AdminUser, type UserRole, type UserStatus, type AuditLog,
} from '@/lib/services/admin-service';

const ROLES: UserRole[] = ['ADMIN', 'CLIENT', 'CREATOR', 'USER'];
const STATUS_COLORS: Record<UserStatus, string> = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  suspended: 'bg-red-500/10 text-red-600 border-red-500/20',
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>(mockUsers);
  const [logs, setLogs] = useState<AuditLog[]>(mockAuditLogs);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function log(action: Parameters<typeof addAuditLog>[1], user: AdminUser, note?: string) {
    setLogs((prev) => addAuditLog(prev, action, user.id, user.name, note));
  }

  const filtered = useMemo(() => {
    return users.filter((u) => {
      const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase());
      const matchRole = roleFilter === 'All' || u.role === roleFilter;
      const matchStatus = statusFilter === 'All' || u.status === statusFilter;
      return matchSearch && matchRole && matchStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  function updateUser(id: string, patch: Partial<AdminUser>) {
    setUsers((prev) => prev.map((u) => u.id === id ? { ...u, ...patch } : u));
  }

  function suspendUser(user: AdminUser) {
    updateUser(user.id, { status: 'suspended' });
    log('user.suspend', user);
    notify(`${user.name} suspended.`);
  }

  function activateUser(user: AdminUser) {
    updateUser(user.id, { status: 'active' });
    log('user.activate', user);
    notify(`${user.name} activated.`);
  }

  function deleteUser(user: AdminUser) {
    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    log('user.delete', user);
    notify(`${user.name} deleted.`);
  }

  function changeRole(user: AdminUser, role: UserRole) {
    updateUser(user.id, { role });
    log('user.role_change', user, `Changed to ${role}`);
    notify(`${user.name} role updated to ${role}.`);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function bulkSuspend() {
    const targets = users.filter((u) => selected.has(u.id));
    targets.forEach((u) => { updateUser(u.id, { status: 'suspended' }); log('user.suspend', u, 'Bulk action'); });
    setSelected(new Set());
    notify(`${targets.length} users suspended.`);
  }

  function bulkDelete() {
    const targets = users.filter((u) => selected.has(u.id));
    targets.forEach((u) => log('user.delete', u, 'Bulk action'));
    setUsers((prev) => prev.filter((u) => !selected.has(u.id)));
    setSelected(new Set());
    notify(`${targets.length} users deleted.`);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">User Management</h1>
        <p className="text-muted-foreground text-sm">{users.length} total users</p>
      </div>

      {toast && (
        <div className="px-4 py-3 rounded-lg bg-primary/10 text-primary text-sm border border-primary/20">{toast}</div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search users..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
        >
          <option value="All">All Roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          className="h-9 px-3 rounded-md border border-input bg-background text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="All">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-secondary border border-border text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={bulkSuspend}>Suspend all</Button>
          <Button size="sm" variant="destructive" onClick={bulkDelete}>Delete all</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs">
                  <th className="px-4 py-3 text-left w-8">
                    <input type="checkbox" onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((u) => u.id)) : new Set())} />
                  </th>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Joined</th>
                  <th className="px-4 py-3 text-left">Bounties</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(user.id)} onChange={() => toggleSelect(user.id)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="text-xs bg-transparent border border-border rounded px-1.5 py-0.5"
                        value={user.role}
                        onChange={(e) => changeRole(user, e.target.value as UserRole)}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[user.status]}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user.joinedAt}</td>
                    <td className="px-4 py-3">{user.bounties}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {user.status === 'suspended' ? (
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => activateUser(user)}>
                            <UserCheck size={12} /> Activate
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => suspendUser(user)}>
                            <UserX size={12} /> Suspend
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => deleteUser(user)}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
