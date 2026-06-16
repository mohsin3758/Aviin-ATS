'use client';

import { useEffect, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, LayoutDashboard, KanbanSquare, Users, BarChart3, Briefcase, DollarSign, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

const COMMANDS = [
  { label: 'Dashboard',    href: '/dashboard',     icon: LayoutDashboard },
  { label: 'Pipeline',     href: '/pipeline',      icon: KanbanSquare },
  { label: 'Candidates',   href: '/candidates',    icon: Users },
  { label: 'Requisitions', href: '/requisitions',  icon: Briefcase },
  { label: 'Analytics',    href: '/analytics',     icon: BarChart3 },
  { label: 'Finance',      href: '/finance',       icon: DollarSign },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const router = useRouter();

  const handleOpen = useCallback(() => { setOpen(true); setQuery(''); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        handleOpen();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleOpen]);

  const filtered = COMMANDS.filter(c =>
    !query || c.label.toLowerCase().includes(query.toLowerCase())
  );

  const go = (href: string) => { router.push(href); setOpen(false); };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed top-[20vh] left-1/2 -translate-x-1/2 z-50 w-full max-w-lg',
            'bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden',
            'animate-slide-up'
          )}
        >
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <Search className="h-4 w-4 text-gray-400 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search pages, actions…"
              className="flex-1 text-sm outline-none placeholder-gray-400"
              onKeyDown={e => {
                if (e.key === 'Enter' && filtered[0]) go(filtered[0].href);
                if (e.key === 'Escape') setOpen(false);
              }}
            />
            <Dialog.Close asChild>
              <button aria-label="Close" className="p-1 rounded hover:bg-gray-100">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </Dialog.Close>
          </div>

          <ul className="py-2 max-h-72 overflow-y-auto">
            {filtered.map(cmd => (
              <li key={cmd.href}>
                <button
                  onClick={() => go(cmd.href)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors"
                >
                  <cmd.icon className="h-4 w-4 text-gray-400" />
                  <span>{cmd.label}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-6 text-sm text-center text-gray-400">No results</li>
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function useCommandPalette() {
  const [, setOpen] = useState(false);
  return { openPalette: () => setOpen(true) };
}
