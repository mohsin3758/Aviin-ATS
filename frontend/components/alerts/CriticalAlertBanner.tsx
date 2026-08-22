'use client';
// Sticky, must-be-acknowledged critical-alert banner — the piece of the
// Reminder & Follow-Up spec's "Real-Time Notifications" section that was
// explicitly deferred out of Phase 1 (the existing toast convention was
// reused as-is there). Distinct from the Topbar bell: the bell is a
// passive badge a user has to remember to check; this renders unread
// type='critical' notifications (tier-3/tier-4 task escalations,
// 7d/1d document-expiry alerts) as a persistent banner at the top of
// every dashboard page until explicitly dismissed — never auto-hides.
import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, X, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { apiFetch } from '@/lib/useFetch';

type CriticalNotif = {
  id: string; title: string; body: string;
  resource?: string; resource_id?: string;
};

function resourceHref(n: CriticalNotif): string | null {
  if (!n.resource || !n.resource_id) return null;
  if (n.resource === 'recruiter_task') return '/reminders';
  if (n.resource === 'document_expiry') return '/reminders?tab=documents';
  if (n.resource === 'interview') return '/interviews';
  return null;
}

export function CriticalAlertBanner() {
  const [mounted, setMounted] = useState(false);
  const [alerts, setAlerts] = useState<CriticalNotif[]>([]);
  const [dismissing, setDismissing] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/notifications?is_read=false&limit=30');
      const rows: any[] = Array.isArray(res) ? res : [];
      setAlerts(rows.filter(r => r.type === 'critical'));
    } catch { /* best-effort — never blocks the page on a failed poll */ }
  }, []);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [mounted, load]);

  const dismiss = async (id: string) => {
    setDismissing(d => ({ ...d, [id]: true }));
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
      setAlerts(a => a.filter(x => x.id !== id));
    } catch {
      setDismissing(d => ({ ...d, [id]: false }));
    }
  };

  const dismissAll = async () => {
    const ids = alerts.map(a => a.id);
    setAlerts([]);
    for (const id of ids) {
      try { await apiFetch(`/notifications/${id}/read`, { method: 'POST' }); } catch { /* best-effort */ }
    }
  };

  if (!mounted || alerts.length === 0) return null;

  return (
    <div data-testid="critical-alert-banner" style={{ flexShrink: 0 }}>
      {alerts.slice(0, 3).map(n => {
        const href = resourceHref(n);
        const body = (
          <>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700 }}>{n.title}</span>
              <span style={{ opacity: 0.85, marginLeft: 8 }}>{n.body}</span>
            </div>
            {href && <ChevronRight size={14} style={{ flexShrink: 0, opacity: 0.7 }} />}
          </>
        );
        return (
          <div
            key={n.id}
            data-testid={`critical-alert-${n.id}`}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '9px 20px', background: '#dc2626', color: '#fff',
              fontSize: '13px', borderBottom: '1px solid rgba(255,255,255,0.15)',
              opacity: dismissing[n.id] ? 0.4 : 1, transition: 'opacity 0.15s',
            }}
          >
            {href ? (
              <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0, color: '#fff', textDecoration: 'none' }}>
                {body}
              </Link>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>{body}</div>
            )}
            <button
              data-testid={`critical-alert-dismiss-${n.id}`}
              onClick={() => dismiss(n.id)}
              title="Acknowledge & dismiss"
              style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '6px', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', flexShrink: 0 }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      {alerts.length > 3 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 20px', background: '#991b1b', color: '#fff', fontSize: '12px' }}>
          <span>+{alerts.length - 3} more critical alert{alerts.length - 3 === 1 ? '' : 's'}</span>
          <button
            data-testid="critical-alert-dismiss-all"
            onClick={dismissAll}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '6px', padding: '2px 10px', color: '#fff', fontSize: '11px', cursor: 'pointer' }}
          >
            Dismiss All
          </button>
        </div>
      )}
    </div>
  );
}
