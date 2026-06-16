'use client';

import { useState } from 'react';
import { TenantProvider } from '@/components/providers/TenantProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { CommandPalette } from '@/components/layout/CommandPalette';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [cmdOpen, setCmdOpen] = useState(false);

  return (
    <TenantProvider>
      <ThemeProvider />
      <CommandPalette />
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar onOpenCmdK={() => setCmdOpen(true)} />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </TenantProvider>
  );
}
