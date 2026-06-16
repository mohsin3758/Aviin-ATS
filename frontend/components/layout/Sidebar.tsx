'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  BarChart3,
  Briefcase,
  FileText,
  DollarSign,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/lib/store';

const NAV_ITEMS = [
  { label: 'Dashboard',     href: '/dashboard',        icon: LayoutDashboard },
  { label: 'Pipeline',      href: '/pipeline',         icon: KanbanSquare },
  { label: 'Candidates',    href: '/candidates',       icon: Users },
  { label: 'Requisitions',  href: '/requisitions',     icon: Briefcase },
  { label: 'Analytics',     href: '/analytics',        icon: BarChart3 },
  { label: 'Finance',       href: '/finance',          icon: DollarSign },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-[--color-primary] text-white transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-white/10">
        <FileText className="shrink-0 h-6 w-6 text-[--color-accent]" />
        {!sidebarCollapsed && (
          <span className="text-sm font-bold tracking-wide truncate">FinStack Staffing</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                active
                  ? 'bg-white/15 font-semibold'
                  : 'hover:bg-white/10 text-white/80'
              )}
            >
              <Icon className="shrink-0 h-4 w-4" />
              {!sidebarCollapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-white/10 p-2">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center p-2 rounded hover:bg-white/10 transition-colors"
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
