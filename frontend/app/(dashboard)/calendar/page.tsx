'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { CalendarPlus, Download, Plus, Rss, Copy, RefreshCw } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

function SubscribeFeedCard() {
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const getToken = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/calendar/feed-token', { method: 'POST' });
      setFeedUrl(window.location.origin + API_BASE + r.feed_url);
    } finally { setBusy(false); }
  };
  const resetToken = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/calendar/feed-token/reset', { method: 'POST' });
      setFeedUrl(window.location.origin + API_BASE + r.feed_url);
    } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!feedUrl) return;
    await navigator.clipboard.writeText(feedUrl).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Rss size={15} color="#2563EB" />
        <div style={{ fontSize: 13, fontWeight: 700 }}>Subscribe from Google/Outlook/Apple Calendar</div>
      </div>
      <p style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
        A live feed URL of your upcoming interviews (as interviewer or the candidate's assigned recruiter) — subscribe once and it stays current, unlike a one-time .ics download.
      </p>
      {!feedUrl ? (
        <button onClick={getToken} disabled={busy} style={btn}>{busy ? '…' : 'Get My Subscribe Link'}</button>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <code style={{ fontSize: 11, background: '#F8FAFC', padding: '6px 10px', borderRadius: 6, flex: 1, minWidth: 200, wordBreak: 'break-all' }}>{feedUrl}</code>
          <button onClick={copy} style={{ ...btn, background: copied ? '#16A34A' : '#2563EB', display: 'flex', gap: 4, alignItems: 'center' }}>
            <Copy size={11} /> {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={resetToken} disabled={busy} title="Invalidate old link, get a new one" style={{ ...btn, background: '#64748B', display: 'flex', gap: 4, alignItems: 'center' }}>
            <RefreshCw size={11} /> Reset Link
          </button>
        </div>
      )}
    </div>
  );
}

export default function CalendarPage() {
  const { data: events, refetch } = useFetch<any[]>('/calendar');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', start_at: '', duration_mins: 45, location: '', meeting_link: '', description: '' });
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!form.title || !form.start_at) return;
    setSaving(true);
    try {
      await apiFetch('/calendar', { method: 'POST', body: JSON.stringify({ ...form, start_at: new Date(form.start_at).toISOString() }) });
      setShowForm(false); setForm({ title: '', start_at: '', duration_mins: 45, location: '', meeting_link: '', description: '' }); refetch();
    } finally { setSaving(false); }
  };

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Calendar</h1>
          <p style={{ fontSize: 13, color: '#64748B' }}>Interview and meeting events — each downloadable as a .ics file for any calendar app.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} style={{ ...btn, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Plus size={14} /> New Event
        </button>
      </div>
      <SubscribeFeedCard />
      {showForm && (
        <div style={card}>
          <label style={label}>TITLE</label>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={input} />
          <label style={label}>START</label>
          <input type="datetime-local" value={form.start_at} onChange={e => setForm({ ...form, start_at: e.target.value })} style={input} />
          <label style={label}>DURATION (MINS)</label>
          <input type="number" value={form.duration_mins} onChange={e => setForm({ ...form, duration_mins: +e.target.value })} style={input} />
          <label style={label}>LOCATION / MEETING LINK</label>
          <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} style={input} />
          <button onClick={create} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Create'}</button>
        </div>
      )}
      <div style={card}>
        {(events || []).map((e: any) => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <CalendarPlus size={14} color="#2563EB" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{e.title}</div>
              <div style={{ color: '#64748B' }}>{new Date(e.start_at).toLocaleString()} · {e.status}</div>
            </div>
            <a href={`${API_BASE}/calendar/${e.id}/download`} target="_blank" rel="noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#2563EB', textDecoration: 'none' }}>
              <Download size={12} /> .ics
            </a>
          </div>
        ))}
        {!events?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No events yet.</div>}
      </div>
    </div>
  );
}
