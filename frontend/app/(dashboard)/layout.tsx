'use client';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { GlobalSearch } from '@/components/GlobalSearch';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => { if (!getToken()) router.replace('/login'); }, [router]);
  return (
    <ThemeProvider>
      <div suppressHydrationWarning style={{ display:'flex', height:'100vh', overflow:'hidden', background:'var(--gray-50,#f8fafc)' }}>
        <Sidebar />
        <div suppressHydrationWarning style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>
          <Topbar />
          <main suppressHydrationWarning style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'24px 28px', minHeight:0 }}>
            {children}
          </main>
          <GlobalSearch/>
        </div>
      </div>
    </ThemeProvider>
  );
}
