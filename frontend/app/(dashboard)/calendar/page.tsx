'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { CalendarPlus, Download, Plus } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

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
