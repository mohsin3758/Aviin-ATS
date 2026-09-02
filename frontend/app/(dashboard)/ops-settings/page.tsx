'use client';
import { useState, useEffect, useRef } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { authHeaders } from '@/lib/auth';
import { Sliders, AlertTriangle, Ban, ShieldOff, Plus, Trash2, FileSpreadsheet, Copy, Power, Star, Pencil, Trophy, Mail, Clock, MessageCircle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

const TABS = [
  { key: 'scoring', label: 'Matching Weights', icon: Sliders },
  { key: 'sla', label: 'SLA Tiers', icon: AlertTriangle },
  { key: 'performance', label: 'Performance Weights', icon: Trophy },
  { key: 'blocks', label: 'Recruiter-Client Blocks', icon: Ban },
  { key: 'shift_timings', label: 'Shift Timings', icon: Clock },
  { key: 'templates', label: 'Tracking Sheet Templates', icon: FileSpreadsheet },
  { key: 'screening', label: 'Screening Notifications', icon: Mail },
  { key: 'gdpr', label: 'Data Retention (GDPR)', icon: ShieldOff },
  { key: 'whatsapp_sessions', label: 'WhatsApp Sessions', icon: MessageCircle },
  { key: 'auto_assign', label: 'Auto-Assign', icon: Power },
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

function AutoAssignConfigTab() {
  // Reported live (2026-08-31): "need option to off and on auto assign
  // features". No automatic/scheduled trigger exists anywhere in this
  // codebase - the AI capability only ever runs when a real human clicks
  // "Auto-Assign (AI)"/"Auto-Reassign (AI)" (requisition detail page,
  // Recruiter Ops' Auto-Assign tab) or picks "Auto-pick per assignment"
  // on the Assignment Dashboard's bulk-reassign modal. This tenant-wide
  // switch (per the user's own explicit choice between the two real
  // options offered) shows/hides those AI buttons - enforced server-side
  // too, not just hidden in the UI. Manual assignment/reassignment to a
  // specific, human-chosen recruiter is never affected, at any setting.
  const { data: config, refetch } = useFetch<any>('/ops-config/auto-assign');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = async () => {
    setSaving(true); setSaved(false);
    try {
      await apiFetch('/ops-config/auto-assign', { method: 'PUT', body: JSON.stringify({ enabled: !config?.enabled }) });
      await refetch();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  const enabled = config?.enabled !== false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>AI Auto-Assign</div>
        <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
          Controls the real "Auto-Assign (AI)" / "Auto-Reassign (AI)" buttons on requisitions, the Recruiter Ops Auto-Assign
          tab, and the "Auto-pick per assignment" option on the Assignment Dashboard's bulk-reassign — the AI picks the
          top-ranked recruiter by skill match + capacity (<code>assign_with_explanation()</code>). Turning this off does
          <strong> not</strong> affect manually assigning or reassigning a specific, named recruiter — that always stays
          available.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={toggle} disabled={saving} data-testid="auto-assign-toggle"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 999, border: 'none',
              cursor: saving ? 'default' : 'pointer', fontSize: 12, fontWeight: 700,
              background: enabled ? '#DCFCE7' : '#FEE2E2', color: enabled ? '#16A34A' : '#DC2626',
            }}>
            <Power size={14} /> {saving ? 'Saving…' : enabled ? 'ON — AI Auto-Assign enabled' : 'OFF — AI Auto-Assign disabled'}
          </button>
          {saved && <span style={{ color: '#16A34A', fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}

function WhatsAppSessionsTab() {
  // Real per-user WhatsApp numbers (2026-08-27) - each personal session
  // is a genuine ~2GB-RAM WAHA browser session (measured live on this
  // VPS), so this is a real, admin-tunable resource cap, not cosmetic.
  const { data: config, refetch: refetchConfig } = useFetch<any>('/user-whatsapp/config');
  const { data: overview, refetch: refetchOverview } = useFetch<any>('/user-whatsapp/team-overview');
  const [maxSessions, setMaxSessions] = useState<number>(2);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) setMaxSessions(config.max_concurrent_personal_sessions ?? 2);
  }, [config]);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await apiFetch('/user-whatsapp/config', { method: 'PUT', body: JSON.stringify({ max_concurrent_personal_sessions: maxSessions }) });
      refetchConfig();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Personal Session Limit</div>
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, fontSize: 12, color: '#92400e', marginBottom: 14 }}>
          Each recruiter/KAE who connects their own WhatsApp number runs a real, persistent browser
          session — measured at roughly <strong>2GB of RAM each</strong> on this server. Setting this too high
          can starve the database, AI matching, and other services. Currently{' '}
          <strong>{overview?.active_sessions ?? 0}</strong> of <strong>{config?.max_concurrent_personal_sessions ?? 2}</strong> slots are in use.
        </div>
        <label style={label}>Max concurrent personal sessions</label>
        <input type="number" min={0} style={input} value={maxSessions}
          onChange={e => setMaxSessions(parseInt(e.target.value, 10) || 0)} />
        <button style={btn} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        {saved && <span style={{ marginLeft: 10, color: '#16A34A', fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Team Connections</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748B' }}>
              <th style={{ padding: '6px 8px' }}>User</th>
              <th style={{ padding: '6px 8px' }}>Role</th>
              <th style={{ padding: '6px 8px' }}>Status</th>
              <th style={{ padding: '6px 8px' }}>Bot Auto-Reply</th>
            </tr>
          </thead>
          <tbody>
            {(overview?.accounts || []).map((a: any) => (
              <tr key={a.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                <td style={{ padding: '8px' }}>{a.full_name}</td>
                <td style={{ padding: '8px', color: '#64748B' }}>{a.role}</td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: a.status === 'working' ? '#DCFCE7' : a.status === 'scan_qr' || a.status === 'starting' ? '#FEF3C7' : '#F1F5F9',
                    color: a.status === 'working' ? '#16A34A' : a.status === 'scan_qr' || a.status === 'starting' ? '#92400E' : '#64748B',
                  }}>{a.status}</span>
                </td>
                <td style={{ padding: '8px', color: '#64748B' }}>{a.bot_auto_reply_enabled ? 'On' : 'Off'}</td>
              </tr>
            ))}
            {(!overview?.accounts || overview.accounts.length === 0) && (
              <tr><td colSpan={4} style={{ padding: '14px 8px', color: '#94A3B8' }}>No one has connected a personal WhatsApp number yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
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

// Shift Timing presets (2026-08-24) — tenant-configurable named
// time-range + region presets, same CRUD shape as Recruiter-Client
// Blocks above, feeding the New Client Requirement form's multi-select
// "Shift Timing (by region)" field instead of a hardcoded list.
const EMPTY_SHIFT_FORM = { label: '', region: '', start_time: '09:00', end_time: '18:00', timezone_label: 'IST' };

function ShiftTimingsTab() {
  const { data: shifts, refetch } = useFetch<any[]>('/shift-timings?include_inactive=true');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_SHIFT_FORM);
  const [err, setErr] = useState('');

  const openCreate = () => { setForm(EMPTY_SHIFT_FORM); setEditId(null); setErr(''); setShowForm(true); };
  const openEdit = (s: any) => {
    setForm({ label: s.label, region: s.region || '', start_time: (s.start_time || '').slice(0, 5), end_time: (s.end_time || '').slice(0, 5), timezone_label: s.timezone_label || 'IST' });
    setEditId(s.id); setErr(''); setShowForm(true);
  };

  const save = async () => {
    if (!form.label.trim() || !form.region.trim()) { setErr('Label and Region are required'); return; }
    try {
      if (editId) await apiFetch(`/shift-timings/${editId}`, { method: 'PUT', body: JSON.stringify(form) });
      else await apiFetch('/shift-timings', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false); setEditId(null); refetch();
    } catch (e: any) { setErr(e.message || 'Save failed'); }
  };
  const toggleActive = async (s: any) => {
    // PUT requires the full model (label/region/start_time/end_time are
    // all required fields, not partial-update) - send the row's existing
    // real values back with only is_active flipped, not a bare partial
    // body (would 422 on the required fields).
    await apiFetch(`/shift-timings/${s.id}`, { method: 'PUT', body: JSON.stringify({
      label: s.label, region: s.region, start_time: (s.start_time || '').slice(0, 5),
      end_time: (s.end_time || '').slice(0, 5), timezone_label: s.timezone_label, is_active: !s.is_active,
    }) });
    refetch();
  };
  const del = async (id: string) => { await apiFetch(`/shift-timings/${id}`, { method: 'DELETE' }); refetch(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: '#64748B' }}>
        Real, named shift-timing presets (e.g. "9am–6pm India Day Shift", "2pm–8pm UK Shift") used on the New Client
        Requirement form's multi-select Shift Timing field — one job can genuinely need multiple regions/timings at once.
      </p>
      <button onClick={openCreate} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> Add Shift Timing
      </button>
      {showForm && (
        <div style={card}>
          {err && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 8 }}>{err}</div>}
          <label style={label}>LABEL (E.G. "UK SHIFT")</label>
          <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} style={input} />
          <label style={label}>COUNTRY / REGION (E.G. UK, US, INDIA)</label>
          <input value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} style={input} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={label}>START TIME</label>
              <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} style={input} />
            </div>
            <div>
              <label style={label}>END TIME</label>
              <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} style={input} />
            </div>
          </div>
          <label style={label}>TIMEZONE LABEL (DISPLAY ONLY, E.G. IST/GMT/EST)</label>
          <input value={form.timezone_label} onChange={e => setForm({ ...form, timezone_label: e.target.value })} style={input} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={btn}>{editId ? 'Update' : 'Add'} Shift Timing</button>
            <button onClick={() => { setShowForm(false); setEditId(null); }} style={{ ...btn, background: '#fff', color: '#374151', border: '1px solid #E2E8F0' }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={card}>
        {(shifts || []).map((s: any) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12, opacity: s.is_active ? 1 : 0.5 }}>
            <span style={{ flex: 1 }}>
              <strong>{s.label}</strong> — {(s.start_time || '').slice(0, 5)}–{(s.end_time || '').slice(0, 5)} {s.timezone_label}
              <span style={{ color: '#64748B' }}> · {s.region}</span>
              {!s.is_active && <span style={{ color: '#94A3B8' }}> · inactive</span>}
            </span>
            <button onClick={() => openEdit(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }} title="Edit"><Pencil size={14} /></button>
            <button onClick={() => toggleActive(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: s.is_active ? '#16A34A' : '#94A3B8' }} title={s.is_active ? 'Deactivate' : 'Activate'}><Power size={14} /></button>
            <button onClick={() => del(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }} title="Delete"><Trash2 size={14} /></button>
          </div>
        ))}
        {!shifts?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No shift timings configured.</div>}
      </div>
    </div>
  );
}

function slugifyColumnKey(title: string): string {
  return 'custom_' + title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'custom_field';
}

function TemplateForm({ initial, direction, columnsReg, clients, onSave, onCancel }: any) {
  const [name, setName] = useState(initial?.name || '');
  const [clientId, setClientId] = useState(initial?.client_id || '');
  // REAL FEATURE (2026-09-02, reported live: "make default for the
  // selected client and spoc or project wise") — a template can now be
  // pinned narrower than the whole client: one specific SPOC, or one
  // specific requisition/project. Both stay blank (client-wide, the
  // original behavior) unless the admin explicitly picks one, and both
  // only make sense once a client is actually selected.
  const [clientContactId, setClientContactId] = useState(initial?.client_contact_id || '');
  const [requisitionId, setRequisitionId] = useState(initial?.requisition_id || '');
  const { data: clientContacts } = useFetch<any[]>(clientId ? `/clients/${clientId}/contacts` : null);
  const { data: clientReqsRaw } = useFetch<any>(clientId ? `/requisitions?client_id=${clientId}&include_inactive=false` : null);
  const clientReqs = clientReqsRaw?.items || clientReqsRaw || [];
  const [isDefault, setIsDefault] = useState(initial?.is_default || false);
  // Real column model: registry keys are toggled on/off as before, but a
  // recruiter/KAE can now also type an arbitrary title and add it as a
  // genuinely custom column — not just a subset of the fixed 27, a real
  // free-form add/remove/rename table builder as asked. Custom columns
  // have no auto-value source (nothing in the schema could compute one),
  // so they always render as manual free-text fields at submit time.
  const registryKeys = new Set((columnsReg || []).map((c: any) => c.key));
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    initial?.columns ? initial.columns.map((c: any) => c.key) : (columnsReg || []).map((c: any) => c.key)
  );
  const [customColumns, setCustomColumns] = useState<{ key: string; label: string }[]>(
    initial?.columns ? initial.columns.filter((c: any) => !registryKeys.has(c.key)) : []
  );
  const [newColTitle, setNewColTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const toggleKey = (key: string) => {
    setSelectedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const addCustomColumn = () => {
    if (!newColTitle.trim()) return;
    const key = slugifyColumnKey(newColTitle) + '_' + Math.random().toString(36).slice(2, 6);
    setCustomColumns(prev => [...prev, { key, label: newColTitle.trim() }]);
    setNewColTitle('');
  };
  const removeCustomColumn = (key: string) => setCustomColumns(prev => prev.filter(c => c.key !== key));
  const renameCustomColumn = (key: string, label: string) =>
    setCustomColumns(prev => prev.map(c => c.key === key ? { ...c, label } : c));

  // Switching clients invalidates whatever SPOC/project was previously
  // picked (it belonged to the old client) — reset rather than silently
  // carry over a mismatched pin the backend would reject anyway.
  const handleClientChange = (v: string) => {
    setClientId(v);
    setClientContactId('');
    setRequisitionId('');
  };

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    if (selectedKeys.length === 0 && customColumns.length === 0) { setErr('Add at least one column'); return; }
    setSaving(true); setErr('');
    try {
      const columns = [
        ...(columnsReg || []).filter((c: any) => selectedKeys.includes(c.key)).map((c: any) => ({ key: c.key, label: c.label })),
        ...customColumns,
      ];
      await onSave({
        name, client_id: clientId || null,
        client_contact_id: clientContactId || null, requisition_id: requisitionId || null,
        columns, is_default: isDefault, direction,
      });
    } catch (e: any) {
      setErr(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const defaultScopeLabel = requisitionId
    ? 'this project/requisition'
    : clientContactId
    ? 'this SPOC'
    : clientId
    ? 'this client (every SPOC/project)'
    : 'the tenant (global fallback)';

  return (
    <div style={card}>
      <label style={label}>TEMPLATE NAME</label>
      <input value={name} onChange={e => setName(e.target.value)} style={input} placeholder="e.g. Acme Corp Tracking Sheet" />

      <label style={label}>CLIENT (LEAVE BLANK FOR A GLOBAL TEMPLATE)</label>
      <select value={clientId} onChange={e => handleClientChange(e.target.value)} style={input}>
        <option value="">-- Global (any client) --</option>
        {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>

      {clientId && (
        <>
          <label style={label}>SPOC (OPTIONAL — NARROWS THE DEFAULT TO ONE CONTACT AT THIS CLIENT)</label>
          <select value={clientContactId} onChange={e => { setClientContactId(e.target.value); if (e.target.value) setRequisitionId(''); }} style={input}>
            <option value="">-- Any SPOC at this client --</option>
            {(clientContacts || []).map((c: any) => <option key={c.id} value={c.id}>{c.contact_name}{c.role_label ? ` (${c.role_label})` : ''}</option>)}
          </select>

          <label style={label}>PROJECT / REQUISITION (OPTIONAL — NARROWS THE DEFAULT TO ONE ROLE AT THIS CLIENT)</label>
          <select value={requisitionId} onChange={e => { setRequisitionId(e.target.value); if (e.target.value) setClientContactId(''); }} style={input}>
            <option value="">-- Any project at this client --</option>
            {clientReqs.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <p style={{ fontSize: 10.5, color: '#94A3B8', marginTop: -6, marginBottom: 10 }}>
            SPOC and project are two independent, mutually-exclusive ways to narrow a client-level default — picking
            one clears the other. Leave both blank for a template that applies to the whole client.
          </p>
        </>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
        Use as the default template for {defaultScopeLabel} ({direction === 'kae_to_client' ? 'KAE → Client' : 'Recruiter → KAE'})
      </label>

      <label style={label}>COLUMNS ({selectedKeys.length + customColumns.length} selected)</label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 6, marginBottom: 10 }}>
        {(columnsReg || []).map((c: any) => (
          <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '5px 8px', borderRadius: 6, background: selectedKeys.includes(c.key) ? '#EFF6FF' : '#F8FAFC', border: `1px solid ${selectedKeys.includes(c.key) ? '#BFDBFE' : '#E2E8F0'}`, cursor: 'pointer' }}>
            <input type="checkbox" checked={selectedKeys.includes(c.key)} onChange={() => toggleKey(c.key)} />
            {c.label}
            {!c.auto && <span style={{ fontSize: 9, color: '#94A3B8' }}>(manual)</span>}
          </label>
        ))}
      </div>

      <label style={label}>CUSTOM COLUMNS (your own title, always manual)</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {customColumns.map(c => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input value={c.label} onChange={e => renameCustomColumn(c.key, e.target.value)}
              style={{ ...input, marginBottom: 0, flex: 1 }} />
            <button onClick={() => removeCustomColumn(c.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><Trash2 size={14} /></button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={newColTitle} onChange={e => setNewColTitle(e.target.value)} placeholder="e.g. Internal Reference No."
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomColumn(); } }}
            style={{ ...input, marginBottom: 0, flex: 1 }} />
          <button onClick={addCustomColumn} type="button" style={{ ...btn, padding: '7px 12px' }}>+ Add</button>
        </div>
      </div>

      {err && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Save Template'}</button>
        <button onClick={onCancel} style={{ ...btn, background: '#F1F5F9', color: '#475569' }}>Cancel</button>
      </div>
    </div>
  );
}

function TemplateFileUpload({ template, onChanged }: any) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true); setErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_URL}/submission-templates/${template.id}/upload-file`, {
        method: 'POST', headers: authHeaders(), body: form,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || 'Upload failed'); }
      onChanged();
    } catch (e: any) { setErr(e.message || 'Upload failed'); }
    finally { setUploading(false); }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      {template.template_type === 'file' && template.file_name ? (
        <span style={{ fontSize: 10.5, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
          <FileSpreadsheet size={11} /> {template.file_name}
        </span>
      ) : (
        <span style={{ fontSize: 10.5, color: '#94A3B8' }}>Table Builder (no file uploaded)</span>
      )}
      <input ref={inputRef} type="file" accept=".xlsx,.docx,.pdf" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); if (inputRef.current) inputRef.current.value = ''; }} />
      <button onClick={() => inputRef.current?.click()} disabled={uploading}
        style={{ fontSize: 10, fontWeight: 700, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer' }}>
        {uploading ? 'Uploading…' : (template.template_type === 'file' ? 'Replace File' : 'Upload .xlsx/.docx/.pdf as this template')}
      </button>
      {err && <span style={{ fontSize: 10, color: '#DC2626' }}>{err}</span>}
    </div>
  );
}

const DIRECTIONS = [
  { key: 'recruiter_to_kae', label: 'Recruiter → KAE' },
  { key: 'kae_to_client', label: 'KAE → Client' },
];

function TemplatesTab() {
  const [direction, setDirection] = useState('recruiter_to_kae');
  const { data: templates, refetch } = useFetch<any[]>(`/submission-templates?direction=${direction}&include_inactive=true`);
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

  const duplicate = async (t: any) => {
    setErr('');
    try {
      await apiFetch(`/submission-templates/${t.id}/duplicate`, { method: 'POST' });
      refetch();
    } catch (e: any) { setErr(e.message || 'Duplicate failed'); }
  };

  const toggleActive = async (t: any) => {
    setErr('');
    try {
      await apiFetch(`/submission-templates/${t.id}/toggle-active`, { method: 'PATCH' });
      refetch();
    } catch (e: any) { setErr(e.message || 'Failed to change active state'); }
  };

  return (
    <div data-testid="templates-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: '#64748B' }}>
        Column sets used for the two tracking-sheet hops: a recruiter submitting to the client-owning KAE, and the KAE
        approving &amp; sending on to the actual client/KAM. Each direction has its own independent default. Leave a
        template's client blank for a global fallback, pin one to a specific client for a fully separate sheet, add
        your own custom columns, or upload a real .xlsx/.docx as the template — the same values get merged into it.
      </p>

      <div style={{ display: 'flex', gap: 6 }}>
        {DIRECTIONS.map(d => (
          <button key={d.key} data-testid={`tmpl-dir-${d.key}`} onClick={() => setDirection(d.key)}
            style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${direction === d.key ? '#2563EB' : '#E2E8F0'}`,
              background: direction === d.key ? '#2563EB' : '#fff', color: direction === d.key ? '#fff' : '#475569' }}>
            {d.label}
          </button>
        ))}
      </div>

      <button onClick={openNew} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> New Template</button>

      {err && <div style={{ color: '#DC2626', fontSize: 12 }}>{err}</div>}
      {showForm && (
        <TemplateForm initial={editing} direction={direction} columnsReg={columnsReg} clients={clients} onSave={save} onCancel={() => setShowForm(false)} />
      )}

      <div style={card}>
        {(templates || []).map((t: any) => (
          <div key={t.id} style={{ padding: '10px 0', borderBottom: '1px solid #F1F5F9', opacity: t.is_active === false ? 0.55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong>{t.name}</strong>
                  {t.is_default && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 999, background: '#FFFBEB', color: '#CA8A04', border: '1px solid #FDE68A' }}>
                      <Star size={9} fill="#CA8A04" /> DEFAULT
                    </span>
                  )}
                  {t.is_active === false && (
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 999, background: '#F1F5F9', color: '#64748B' }}>INACTIVE</span>
                  )}
                  {t.template_type === 'file' && (
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 999, background: '#EEF2FF', color: '#4338CA' }}>FILE TEMPLATE</span>
                  )}
                </div>
                <div style={{ color: '#64748B', fontSize: 11 }}>
                  {t.client_name ? `Client: ${t.client_name}` : 'Global (any client)'}
                  {t.spoc_name && ` → SPOC: ${t.spoc_name}`}
                  {t.requisition_title && ` → Project: ${t.requisition_title}`}
                  {' · '}{t.columns?.length || 0} columns
                </div>
              </div>
              <button onClick={() => duplicate(t)} title="Duplicate" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><Copy size={14} /></button>
              <button onClick={() => toggleActive(t)} title={t.is_active === false ? 'Reactivate' : 'Deactivate'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.is_active === false ? '#16A34A' : '#64748B' }}><Power size={14} /></button>
              <button onClick={() => openEdit(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}><Pencil size={14} /></button>
              <button data-testid={`del-template-${t.id}`} onClick={() => del(t)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><Trash2 size={14} /></button>
            </div>
            <TemplateFileUpload template={t} onChanged={refetch} />
          </div>
        ))}
        {!templates?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No templates yet for this direction.</div>}
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
  // REAL FEATURE (2026-09-02): a real ?tab= deep link (e.g. from the
  // Submit-to-Client modal's "Manage Templates →" link) — client-only
  // (window isn't available during SSR), matching the same deferred-
  // read pattern already established elsewhere in this app (Companies'
  // own ?client= deep link).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && TABS.some(x => x.key === t)) setTab(t);
  }, []);
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
      {tab === 'whatsapp_sessions' && <WhatsAppSessionsTab />}
      {tab === 'performance' && <PerformanceWeightsTab />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'shift_timings' && <ShiftTimingsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'screening' && <ScreeningTab />}
      {tab === 'gdpr' && <GdprTab />}
      {tab === 'auto_assign' && <AutoAssignConfigTab />}
    </div>
  );
}
