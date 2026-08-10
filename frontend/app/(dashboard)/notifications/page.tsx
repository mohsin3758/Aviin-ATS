'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Bell, CheckCheck, Info, AlertTriangle, User, Briefcase } from 'lucide-react';

// Notification Center (2026-08-10 audit): the topbar bell was always real
// and live, but had no page behind it at all — this is that page. Built
// minimal on purpose: filter by read/unread, mark one or all as read, and
// a link into the related resource where one exists. Uses the same
// GET/POST /notifications* endpoints fixed the same day (recipient-scope
// leak closed server-side).

const TYPE_ICON: Record<string, any> = {
  warning: AlertTriangle,
  info: Info,
};
const TYPE_COLOR: Record<string, string> = {
  warning: '#d97706',
  info: '#2563eb',
};
const RESOURCE_HREF: Record<string, (id: string) => string> = {
  candidate: (id) => `/candidates/${id}`,
  application: (id) => `/pipeline`,
  requisition: (id) => `/requisitions/${id}`,
};

export default function NotificationsPage() {
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const { data, loading, refetch } = useFetch<any[]>(
    '/notifications?limit=100' + (filter === 'unread' ? '&is_read=false' : '')
  );
  const [marking, setMarking] = useState<string | null>(null);

  async function markRead(id: string) {
    setMarking(id);
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
      refetch();
    } finally { setMarking(null); }
  }

  async function markAllRead() {
    await apiFetch('/notifications/read-all', { method: 'POST' });
    refetch();
  }

  const rows = data || [];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Bell size={20} style={{ color: '#334155' }} />
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: '#1e293b' }}>Notifications</h1>
        </div>
        <button onClick={markAllRead}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
          <CheckCheck size={14} /> Mark all read
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['unread', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} data-testid={`notif-filter-${f}`}
            style={{
              padding: '6px 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              border: filter === f ? '1px solid #1e40af' : '1px solid #e2e8f0',
              background: filter === f ? '#eff6ff' : 'white',
              color: filter === f ? '#1e40af' : '#64748b',
              textTransform: 'capitalize',
            }}>{f}</button>
        ))}
      </div>

      <div data-testid="notifications-list" style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {loading && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading...</div>}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
            <Bell size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div style={{ fontSize: 13 }}>{filter === 'unread' ? "You're all caught up." : 'No notifications yet.'}</div>
          </div>
        )}
        {rows.map((n: any) => {
          const Icon = TYPE_ICON[n.type] || Info;
          const color = TYPE_COLOR[n.type] || '#64748b';
          const href = n.resource && n.resource_id ? RESOURCE_HREF[n.resource]?.(n.resource_id) : null;
          return (
            <div key={n.id} data-testid="notification-row"
              style={{ display: 'flex', gap: 12, padding: '14px 18px', borderBottom: '1px solid #f1f5f9', background: n.is_read ? 'white' : '#f8fafc' }}>
              <Icon size={16} style={{ color, marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: n.is_read ? 500 : 700, fontSize: 13.5, color: '#1e293b' }}>{n.title}</div>
                {n.body && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>{n.body}</div>}
                <div style={{ display: 'flex', gap: 12, marginTop: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(n.created_at).toLocaleString()}</span>
                  {href && <a href={href} style={{ fontSize: 11, color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>View →</a>}
                </div>
              </div>
              {!n.is_read && (
                <button onClick={() => markRead(n.id)} disabled={marking === n.id} data-testid="notification-mark-read"
                  title="Mark as read"
                  style={{ alignSelf: 'flex-start', padding: '4px 9px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, cursor: 'pointer', color: '#64748b', flexShrink: 0 }}>
                  {marking === n.id ? '...' : 'Mark read'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
