'use client';

import {
  Briefcase,
  BarChart2,
  Flag,
  Gavel,
  ScrollText,
  ToggleRight,
  Users,
  DollarSign,
} from 'lucide-react';
import { ResponsiveSidebar, type SidebarItem } from '@/components/layout/sidebar';
import { canAccess } from '@/lib/auth/admin-roles';

// Admin navigation items with role requirements
interface NavItem extends SidebarItem {
  minRole?: 'SUPPORT' | 'MODERATOR' | 'FINANCE' | 'SUPERADMIN';
}

// Only routes that exist under app/admin.
const navItems: NavItem[] = [
  { href: '/admin/users', label: 'Users', icon: Users, minRole: 'MODERATOR' },
  { href: '/admin/bounties', label: 'Bounties', icon: Briefcase, minRole: 'MODERATOR' },
  { href: '/admin/disputes', label: 'Disputes', icon: Gavel, minRole: 'MODERATOR' },
  { href: '/admin/reports', label: 'Reports', icon: Flag, minRole: 'SUPPORT' },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart2, minRole: 'MODERATOR' },
  { href: '/admin/payouts', label: 'Payouts', icon: DollarSign, minRole: 'FINANCE' },
  { href: '/admin/audit', label: 'Audit Log', icon: ScrollText, minRole: 'MODERATOR' },
  { href: '/admin/feature-flags', label: 'Feature Flags', icon: ToggleRight, minRole: 'SUPERADMIN' },
];

// Filter nav items based on user's role (client-side)
export function filterNavItems(navItems: NavItem[], userRole: string): SidebarItem[] {
  const role = userRole as 'SUPPORT' | 'MODERATOR' | 'FINANCE' | 'SUPERADMIN';
  return navItems
    .filter((item) => !item.minRole || canAccess(role, item.minRole))
    .map(({ minRole, ...item }) => item);
}

export function AdminSidebar({ userRole }: { userRole?: string }) {
  const items = userRole 
    ? filterNavItems(navItems, userRole)
    : navItems;

  return <ResponsiveSidebar title="Admin Panel" items={items} />;
}
