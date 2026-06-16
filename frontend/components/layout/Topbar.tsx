'use client';

import { Search, Bell, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { clearToken } from '@/lib/auth';
import { useTenant } from '@/components/providers/TenantProvider';
import { cn } from '@/lib/cn';

interface TopbarProps {
  title?: string;
  onOpenCmdK?: () => void;
}

export function Topbar({ title, onOpenCmdK }: TopbarProps) {
  const { fullName, role } = useTenant();
  const router = useRouter();

  const handleLogout = () => {
    clearToken();
    router.replace('/login');
  };

  return (
    <header className="h-14 flex items-center gap-4 px-6 bg-[--color-surface] border-b border-gray-200 shrink-0">
      {title && <h1 className="text-base font-semibold text-gray-800 mr-auto">{title}</h1>}
      {!title && <span className="mr-auto" />}

      {/* Cmd+K trigger */}
      <button
        onClick={onOpenCmdK}
        className={cn(
          'hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md text-sm',
          'border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors'
        )}
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <kbd className="ml-2 text-xs text-gray-400">⌘K</kbd>
      </button>

      <button
        className="relative p-2 rounded-full hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4 text-gray-600" />
      </button>

      <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
        <div className="w-8 h-8 rounded-full bg-[--color-primary] text-white flex items-center justify-center text-xs font-bold uppercase">
          {fullName.slice(0, 1) || 'A'}
        </div>
        <div className="hidden md:block text-right">
          <div className="text-xs font-medium text-gray-800 leading-tight">{fullName || 'Admin'}</div>
          <div className="text-xs text-gray-400 capitalize">{role}</div>
        </div>
        <button
          onClick={handleLogout}
          className="p-1.5 rounded hover:bg-gray-100 transition-colors ml-1"
          aria-label="Log out"
        >
          <LogOut className="h-4 w-4 text-gray-500" />
        </button>
      </div>
    </header>
  );
}
