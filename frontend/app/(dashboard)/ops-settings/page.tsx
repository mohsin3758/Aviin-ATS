'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Sliders, AlertTriangle, Ban, ShieldOff, Plus, Trash2, FileSpreadsheet, Star, Pencil, Trophy, Mail } from 'lucide-react';

const TABS = [
  { key: 'scoring', label: 'Matching Weights', icon: Sliders },
  { key: 'sla', label: 'SLA Tiers', icon: AlertTriangle },
  { key: 'performance', label: 'Performance Weights', icon: Trophy },
  { key: 'blocks', label: 'Recruiter-Client Blocks', icon: Ban },
  { key: 'templates', label: 'Tracking Sheet Templates', icon: FileSpreadsheet },
  { key: 'screening', label: 'Screening Notifications', icon: Mail },
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

const PERF_WEIGHT_KEYS = ['output_weight', 'quality_weight', 'velocity_weight', 'productivity_weight', 'sla_weight', 'interview_conv_weight'];
const PERF_WEIGHT_LABELS: Record<string, string> = {
  output_weight: 'Output (volume)', quality_weight: 'Quality (interview conversion)',
  velocity_weight: 'Velocity (response time)', productivity_weight: 'Productivity',
  sla_weight: 'SLA compliance', interview_conv_weight: 'Interview → Offer conversion',
};
const PERF_GRADE_KEYS = ['grade_a_plus_threshold', 'grade_a_threshold', 'grade_b_threshold', 'grade_c_threshold'];
const PERF_GRADE_LABELS: Record<string, string> = {
  grade_a_plus_threshold: 'A+ at or above', grade_a_threshold: 'A at or above',
  grade_b_threshold: 'B at or above', grade_c_threshold: 'C at or above (below = D)',
};

// Weights + grade thresholds for the new daily recruiter_performance_scores
// (Workforce Intelligence, 2026-08-11) — a separate, purely informational
// score from the monthly compensation-linked recruiter_kpi_scores; this
// tab's weights never touch payouts.
function PerformanceWeightsTab() {
  const { data, refetch } = useFetch<any>('/manager/score-weights');
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (!form) return null;

  const total = PERF_WEIGHT_KEYS.reduce((s, k) => s + (Number(form[k]) || 0), 0);

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const body: any = {};
      [...PERF_WEIGHT_KEYS, ...PERF_GRADE_KEYS].forEach(k => body[k] = Number(form[k]));
      await apiFetch('/manager/score-weights', { method: 'PUT', body: JSON.stringify(body) });
      refetch();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={card}>
      <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
        Weights for the daily recruiter activity/performance score shown on Recruiter Ops &gt; Activity and the Team
        Leaderboard — informational only, not linked to compensation. Must sum to ~1.0.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
        {PERF_WEIGHT_KEYS.map(k => (
          <div key={k}>
            <label style={label}>{PERF_WEIGHT_LABELS[k].toUpperCase()}</label>
            <input type="number" step="0.01" min={0} max={1} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} style={input} />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: Math.abs(total - 1) < 0.02 ? '#16A34A' : '#DC2626', margin: '10px 0' }}>
        Total: {total.toFixed(2)} {Math.abs(total - 1) < 0.02 ? '✓' : '(should be ~1.00)'}
      </div>
      <p style={{ fontSize: 11, color: '#64748B', margin: '14px 0 8px', fontWeight: 700 }}>GRADE THRESHOLDS</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10 }}>
        {PERF_GRADE_KEYS.map(k => (
          <div key={k}>
            <label style={label}>{PERF_GRADE_LABELS[k].toUpperCase()}</label>
            <input type="number" value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} style={input} />
          </div>
        ))}
      </div>
      {err && <div style={{ color: '#DC2626', fontSize: 12, margin: '8px 0' }}>{err}</div>}
      <button onClick={save} disabled={saving} style={{ ...btn, marginTop: 10 }}>{saving ? 'Saving…' : 'Save Weights'}</button>
    </div>
  );
}

function ScreeningTab() {
  // Real feature (2026-08-19): who gets the automatic "candidate
  // shortlisted" email (To:) once a recruiter moves an application to
  // "screened" -- the internal screening team, with every active KAE on
  // the client cc'd automatically (backend-resolved, not configured
  // here). Same "first save establishes the default, PUT any time to
  // change it" pattern as every other tab on this page -- nothing here
  // is a one-time-only lock.
  const { data, refetch } = useFetch<any>('/screening-settings');
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) { setEmails(data.to_emails || []); setEnabled(data.is_enabled !== false); }
  }, [data]);

  const addEmail = () => {
    const e = newEmail.trim();
    if (!e || emails.includes(e)) return;
    setEmails([...emails, e]);
    setNewEmail('');
  };
  const removeEmail = (e: string) => setEmails(emails.filter(x => x !== e));

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false);
    try {
      await apiFetch('/screening-settings', { method: 'PUT', body: JSON.stringify({ to_emails: emails, is_enabled: enabled }) });
      refetch();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={card}>
      <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
        When a recruiter moves a candidate to <strong>Screened</strong>, the resume and full tracking sheet (with the
        real AI JD match score already filled in) are emailed automatically — <strong>To:</strong> the addresses below,
        <strong> CC:</strong> every KAE currently assigned to that client (resolved automatically, nothing to configure here).
        Turn it off any time without losing the saved addresses.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: '#1E293B', marginBottom: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Auto-send enabled
      </label>
      <label style={label}>SCREENING TEAM EMAIL ADDRESSES</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {emails.map(e => (
          <span key={e} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600 }}>
            {e}
            <button onClick={() => removeEmail(e)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#1D4ED8', display: 'flex' }}><Trash2 size={12} /></button>
          </span>
        ))}
        {!emails.length && <span style={{ fontSize: 12, color: '#94A3B8' }}>No screening-team email set yet — auto-send will be skipped until at least one is added.</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEmail()}
          placeholder="screening.team@aviintech.com" style={{ ...input, marginBottom: 0, flex: 1 }} />
        <button onClick={addEmail} style={{ ...btn, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Add</button>
      </div>
      {err && <div style={{ color: '#DC2626', fontSize: 12, margin: '8px 0' }}>{err}</div>}
      {saved && <div style={{ color: '#16A34A', fontSize: 12, margin: '8px 0', fontWeight: 700 }}>Saved ✓</div>}
      <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save Screening Settings'}</button>
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

function TemplateForm({ initial, columnsReg, clients, onSave, onCancel }: any) {
  const [name, setName] = useState(initial?.name || '');
  const [clientId, setClientId] = useState(initial?.client_id || '');
  const [isDefault, setIsDefault] = useState(initial?.is_default || false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    initial?.columns ? initial.columns.map((c: any) => c.key) : (columnsReg || []).map((c: any) => c.key)
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const toggleKey = (key: string) => {
    setSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    if (selectedKeys.length === 0) { setErr('Select at least one column'); return; }
    setSaving(true); setErr('');
    try {
      const columns = (columnsReg || [])
        .filter((c: any) => selectedKeys.includes(c.key))
        .map((c: any) => ({ key: c.key, label: c.label }));
      await onSave({ name, client_id: clientId || null, columns, is_default: isDefault });
    } catch (e: any) {
      setErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={card}>
      <label style={label}>TEMPLATE NAME</label>
      <input value={name} onChange={e => setName(e.target.value)} style={input} placeholder="e.g. Acme Corp Tracking Sheet" />

      <label style={label}>CLIENT (LEAVE BLANK FOR A GLOBAL TEMPLATE)</label>
      <select value={clientId} onChange={e => setClientId(e.target.value)} style={input}>
        <option value="">-- Global (any client) --</option>
        {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
        Use as the default fallback template (when a client has no template of its own)
      </label>

      <label style={label}>COLUMNS ({selectedKeys.length} selected)</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 6, marginBottom: 12 }}>
        {(columnsReg || []).map((c: any) => (
          <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '5px 8px', borderRadius: 6, background: selectedKeys.includes(c.key) ? '#EFF6FF' : '#F8FAFC', border: `1px solid ${selectedKeys.includes(c.key) ? '#BFDBFE' : '#E2E8F0'}`, cursor: 'pointer' }}>
            <input type="checkbox" checked={selectedKeys.includes(c.key)} onChange={() => toggleKey(c.key)} />
            {c.label}
            {!c.auto && <span style={{ fontSize: 9, color: '#94A3B8' }}>(manual)</span>}
          </label>
        ))}
      </div>

      {err && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save Template'}</button>
        <button onClick={onCancel} style={{ ...btn, background: '#F1F5F9', color: '#475569' }}>Cancel</button>
      </div>
    </div>
  );
}

function TemplatesTab() {
  const { data: templates, refetch } = useFetch<any[]>('/submission-templates');
  const { data: columnsReg } = useFetch<any[]>('/submission-templates/columns');
  const { data: clientsRaw } = useFetch<any>('/clients');
  const clients = clientsRaw?.items || clientsRaw || [];
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [err, setErr] = useState('');

  const openNew = () => { setEditing(null); setShowForm(true); setErr(''); };
  const openEdit = (t: any) => { setEditing(t); setShowForm(true); setErr(''); };

  const save = async (body: any) => {
    if (editing) {
      await apiFetch(`/submission-templates/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await apiFetch('/submission-templates', { method: 'POST', body: JSON.stringify(body) });
    }
    setShowForm(false); setEditing(null); refetch();
  };

  const del = async (t: any) => {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    setErr('');
    try {
      await apiFetch(`/submission-templates/${t.id}`, { method: 'DELETE' });
      refetch();
    } catch (e: any) {
      setErr(e.message || 'Delete failed');
    }
  };

  return (
    <div data-testid="templates-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: '#64748B' }}>
        Column sets used when a recruiter submits a candidate profile + tracking sheet to a KAE. Leave a template's
        client blank to make it the global default; pin one to a specific client for a fully separate sheet, or just
        uncheck a few columns to reuse the default with fewer fields — same mechanism either way.
      </p>
      <button onClick={openNew} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> New Template</button>

      {err && <div style={{ color: '#DC2626', fontSize: 12 }}>{err}</div>}
      {showForm && (
        <TemplateForm initial={editing} columnsReg={columnsReg} clients={clients} onSave={save} onCancel={() => setShowForm(false)} />
      )}

      <div style={card}>
        {(templates || []).map((t: any) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <strong>{t.name}</strong>
                {t.is_default && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 999, background: '#FFFBEB', color: '#CA8A04', border: '1px solid #FDE68A' }}>
                    <Star size={9} fill="#CA8A04" /> DEFAULT
                  </span>
                )}
              </div>
              <div style={{ color: '#64748B', fontSize: 11 }}>{t.client_name ? `Client: ${t.client_name}` : 'Global (any client)'} · {t.columns?.length || 0} columns</div>
            </div>
            <button onClick={() => openEdit(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><Pencil size={14} /></button>
            <button data-testid={`del-template-${t.id}`} onClick={() => del(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><Trash2 size={14} /></button>
          </div>
        ))}
        {!templates?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No templates yet.</div>}
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
        <p style={{ fontSize: 13, color: '#64748B' }}>AI matching weights, SLA thresholds, recruiter-client blocks, KAE tracking-sheet templates, and data retention.</p>
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
      {tab === 'performance' && <PerformanceWeightsTab />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'screening' && <ScreeningTab />}
      {tab === 'gdpr' && <GdprTab />}
    </div>
  );
}
