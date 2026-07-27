'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Sliders, AlertTriangle, Ban, ShieldOff, Plus, Trash2 } from 'lucide-react';

const TABS = [
  { key: 'scoring', label: 'Matching Weights', icon: Sliders },
  { key: 'sla', label: 'SLA Tiers', icon: AlertTriangle },
  { key: 'blocks', label: 'Recruiter-Client Blocks', icon: Ban },
  { key: 'gdpr', label: 'Data Retention (GDPR)', icon: ShieldOff },
];

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };

const WEIGHT_KEYS = ['capacity', 'skill_match', 'relationship', 'performance', 'leave_status', 'location_match', 'seniority_match', 'language_match', 'tenure_stability', 'urgency_bonus'];
const WEIGHT_LABELS: Record<string, string> = {
  capacity: 'Capacity', skill_match: 'Skill Match', relationship: 'Relationship', performance: 'Performance',
  leave_status: 'Leave Status', location_match: 'Location Match', seniority_match: 'Seniority Match',
  language_match: 'Language Match', tenure_stability: 'Tenure Stability', urgency_bonus: 'Urgency Bonus',
};

function ScoringTab() {
  const { data, refetch } = useFetch<any>('/ops-config/scoring-weights');
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (!form) return null;

  const total = WEIGHT_KEYS.reduce((s, k) => s + (Number(form[k]) || 0), 0);

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const body: any = {}; WEIGHT_KEYS.forEach(k => body[k] = Number(form[k]));
      await apiFetch('/ops-config/scoring-weights', { method: 'PUT', body: JSON.stringify(body) });
      refetch();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={card}>
      <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
        Weights used by the AI recruiter-matching engine (<code>match_recruiters</code> / Auto-Assign). Must sum to ~1.0.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
        {WEIGHT_KEYS.map(k => (
          <div key={k}>
            <label style={label}>{WEIGHT_LABELS[k].toUpperCase()}</label>
            <input type="number" step="0.01" min={0} max={1} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} style={input} />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: Math.abs(total - 1) < 0.02 ? '#16A34A' : '#DC2626', marginBottom: 10 }}>
        Total: {total.toFixed(2)} {Math.abs(total - 1) < 0.02 ? '✓' : '(should be ~1.00)'}
      </div>
      {err && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save Weights'}</button>
    </div>
  );
}

function SlaTab() {
  const { data, refetch } = useFetch<any>('/ops-config/sla-tiers');
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (!form) return null;

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/ops-config/sla-tiers', {
        method: 'PUT',
        body: JSON.stringify({ low_hours: +form.low_hours, medium_hours: +form.medium_hours, high_hours: +form.high_hours, critical_hours: +form.critical_hours }),
      });
      refetch();
    } finally { setSaving(false); }
  };

  const fields = [
    { key: 'critical_hours', label: 'Critical Tier (hours)' },
    { key: 'high_hours', label: 'High Tier (hours)' },
    { key: 'medium_hours', label: 'Medium Tier (hours)' },
    { key: 'low_hours', label: 'Low Tier (hours)' },
  ];

  return (
    <div style={card}>
      <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>SLA breach thresholds by requisition priority tier, used by the SLA Dashboard and Operational Alerts.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10, marginBottom: 10 }}>
        {fields.map(f => (
          <div key={f.key}>
            <label style={label}>{f.label.toUpperCase()}</label>
            <input type="number" value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} style={input} />
          </div>
        ))}
      </div>
      <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save Thresholds'}</button>
    </div>
  );
}

function BlocksTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const { data: clients } = useFetch<any>('/clients');
  const { data: blocks, refetch } = useFetch<any[]>('/recruiter-client-blocks');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recruiter_id: '', client_id: '', reason: '' });
  const clientList = clients?.items || clients || [];

  const create = async () => {
    if (!form.recruiter_id) return;
    await apiFetch('/recruiter-client-blocks', { method: 'POST', body: JSON.stringify(form) });
    setShowForm(false); setForm({ recruiter_id: '', client_id: '', reason: '' }); refetch();
  };
  const del = async (id: string) => { await apiFetch(`/recruiter-client-blocks/${id}`, { method: 'DELETE' }); refetch(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: '#64748B' }}>Prevent a recruiter from being assigned to a specific client (conflict of interest, prior dispute, etc.)</p>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> Add Block</button>
      {showForm && (
        <div style={card}>
          <label style={label}>RECRUITER</label>
          <select value={form.recruiter_id} onChange={e => setForm({ ...form, recruiter_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <label style={label}>CLIENT (OPTIONAL — LEAVE BLANK TO BLOCK ALL)</label>
          <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} style={input}>
            <option value="">-- Any client --</option>
            {clientList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label style={label}>REASON</label>
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} style={input} />
          <button onClick={create} style={btn}>Add Block</button>
        </div>
      )}
      <div style={card}>
        {(blocks || []).map((b: any) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1 }}><strong>{b.recruiter_name}</strong> ✕ {b.client_name || 'all clients'}</span>
            <span style={{ color: '#64748B' }}>{b.reason}</span>
            <button onClick={() => del(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><Trash2 size={14} /></button>
          </div>
        ))}
        {!blocks?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No blocks configured.</div>}
      </div>
    </div>
  );
}

function GdprTab() {
  const { data: log, refetch } = useFetch<any[]>('/gdpr/log');
  const [days, setDays] = useState(90);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState('');

  const run = async () => {
    if (!confirm(`This permanently anonymizes (redacts email/phone/name/resume) every candidate with NO activity in the last ${days} days. This cannot be undone. Continue?`)) return;
    setRunning(true); setResult('');
    try {
      const r = await apiFetch(`/gdpr/archive-inactive?days_threshold=${days}`, { method: 'POST' });
      setResult(r.message); refetch();
    } finally { setRunning(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, background: '#FEF2F2', border: '1px solid #FECACA' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#991B1B', marginBottom: 6 }}>⚠ Irreversible action</div>
        <p style={{ fontSize: 12, color: '#7F1D1D', marginBottom: 10 }}>Anonymizes candidates with no application/activity for N days — permanently overwrites name, email, phone, and resume text. Admin only.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="number" value={days} onChange={e => setDays(+e.target.value)} style={{ ...input, width: 100, marginBottom: 0 }} />
          <span style={{ fontSize: 12 }}>days of inactivity</span>
          <button onClick={run} disabled={running} style={{ ...btn, background: '#DC2626' }}>{running ? 'Running…' : 'Archive Inactive Candidates'}</button>
        </div>
        {result && <div style={{ marginTop: 8, fontSize: 12, color: '#166534' }}>{result}</div>}
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Archive Log</div>
        {(log || []).map((l: any) => (
          <div key={l.id} style={{ padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            {l.action} — {l.reason} · <span style={{ color: '#94A3B8' }}>{new Date(l.archived_at).toLocaleString()}</span>
          </div>
        ))}
        {!log?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No archive actions yet.</div>}
      </div>
    </div>
  );
}

export default function OpsSettingsPage() {
  const [tab, setTab] = useState('scoring');
  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Ops Settings</h1>
        <p style={{ fontSize: 13, color: '#64748B' }}>AI matching weights, SLA thresholds, recruiter-client blocks, and data retention.</p>
      </div>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: tab === t.key ? '#2563EB' : '#64748B', borderBottom: tab === t.key ? '2px solid #2563EB' : '2px solid transparent' }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'scoring' && <ScoringTab />}
      {tab === 'sla' && <SlaTab />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'gdpr' && <GdprTab />}
    </div>
  );
}
