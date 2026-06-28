'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Search, UserCheck, UserX, Trash2, ShieldCheck, ChevronDown,
} from 'lucide-react';
import {
  changeUserRole,
  suspendUser,
  unsuspendUser,
  deleteUser,
  getUsersSummary,
} from '@/app/admin/actions';
import { Role } from '@prisma/client';

const ROLES: Role[] = ['ADMIN', 'CLIENT', 'CREATOR', 'USER'];
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  suspended: 'bg-red-500/10 text-red-600 border-red-500/20',
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string;
  bounties: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, [search, roleFilter, statusFilter]);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await getUsersSummary(
        search || undefined,
        roleFilter,
        statusFilter,
      );
      setUsers(data as AdminUser[]);
    } catch (error) {
      console.error('Failed to load users:', error);
      notify('Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const filtered = useMemo(() => users, [users]);

  async function handleSuspendUser(user: AdminUser) {
    try {
      const reason = prompt('Enter suspension reason:');
      if (!reason) return;
      await suspendUser(user.id, reason);
      notify(`${user.name} suspended.`);
      await loadUsers();
    } catch (error) {
      notify(`Error: ${error instanceof Error ? error.message : 'Failed to suspend user'}`);
    }
  }

  async function handleUnsuspendUser(user: AdminUser) {
    try {
      await unsuspendUser(user.id);
      notify(`${user.name} activated.`);
      await loadUsers();
    } catch (error) {
      notify(`Error: ${error instanceof Error ? error.message : 'Failed to activate user'}`);
    }
  }

  async function handleDeleteUser(user: AdminUser) {
    if (!confirm(`Delete ${user.name}? This cannot be undone.`)) return;
    try {
      await deleteUser(user.id);
      notify(`${user.name} deleted.`);
      await loadUsers();
    } catch (error) {
      notify(`Error: ${error instanceof Error ? error.message : 'Failed to delete user'}`);
    }
  }

  async function handleChangeRole(user: AdminUser, role: Role) {
    try {
      if (role === 'ADMIN') {
        const confirm_msg = `Promote ${user.name} to ADMIN? This requires careful consideration.`;
        if (!confirm(confirm_msg)) return;
      }
      await changeUserRole(user.id, role);
      notify(`${user.name} role updated to ${role}.`);
      await loadUsers();
    } catch (error) {
      notify(`Error: ${error instanceof Error ? error.message : 'Failed to change role'}`);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulkSuspend() {
    const reason = prompt('Enter suspension reason for all selected users:');
    if (!reason) return;

    try {
      const targets = users.filter((u) => selected.has(u.id));
      for (const user of targets) {
        await suspendUser(user.id, reason);
      }
      setSelected(new Set());
      notify(`${targets.length} users suspended.`);
      await loadUsers();
    } catch (error) {
      notify(`Error: ${error instanceof Error ? error.message : 'Bulk suspend failed'}`);
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} users? This cannot be undone.`)) return;

    try {
      const targets = users.filter((u) => selected.has(u.id));
      for (const user of targets) {
        await deleteUser(user.id);
      }
      setSelected(new Set());
      notify(`${targets.length} users deleted.`);
      await loadUsers();
    } catch (error) {
      notify(`Error: ${error instanceof Error ? error.message : 'Bulk delete failed'}`);
    }
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
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-muted rounded animate-pulse" style={{ width: j === 1 ? '80%' : '60%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No users found</td></tr>
                ) : filtered.map((user) => (
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
                        onChange={(e) => handleChangeRole(user, e.target.value as Role)}
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
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleUnsuspendUser(user)}>
                            <UserCheck size={12} /> Activate
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => handleSuspendUser(user)}>
                            <UserX size={12} /> Suspend
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDeleteUser(user)}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
