'use client';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { apiFetch } from '@/lib/useFetch';
import { GlobalSearch } from '@/components/GlobalSearch';
import { CriticalAlertBanner } from '@/components/alerts/CriticalAlertBanner';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  useEffect(() => { if (!getToken()) router.replace('/login'); }, [router]);
  useEffect(() => {
    if (!getToken()) return;
    const ping = () => { apiFetch('/recruiter-tracking/heartbeat', { method: 'POST' }).catch(() => {}); };
    ping();
    const id = setInterval(ping, 120000);
    return () => clearInterval(id);
  }, []);
  // Real mobile-responsiveness fix (2026-09-02) — the one piece of new
  // JS state this fix needs. Everything else (the drawer's own default
  // closed position, the hamburger's visibility, etc.) is pure CSS; this
  // just tracks whether the drawer has been explicitly pulled open.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  return (
    <ThemeProvider>
      <div suppressHydrationWarning style={{ display:'flex', height:'100vh', overflow:'hidden', background:'var(--gray-50,#f8fafc)' }}>
        <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
        <div suppressHydrationWarning style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>
          <Topbar onOpenMobileMenu={() => setMobileMenuOpen(true)} />
          <CriticalAlertBanner />
          <main className="aviin-main" suppressHydrationWarning style={{ flex:1, overflowY:'auto', overflowX:'hidden', minHeight:0 }}>
            {children}
          </main>
          <GlobalSearch/>
        </div>
      </div>
      <style>{`
        .aviin-main { padding: 24px 28px; }
        @media (max-width: 767px) {
          .aviin-main { padding: 14px 16px; }
        }
      `}</style>
    </ThemeProvider>
  );
}
