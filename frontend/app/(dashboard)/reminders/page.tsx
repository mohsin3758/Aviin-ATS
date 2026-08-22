'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import {
  Bell, Sun, CalendarDays, AlertTriangle, Flame, Video, FileWarning,
  BarChart3, Settings, Plus, X, CheckCircle2, RotateCcw,
} from 'lucide-react';

// Same style-constant + hand-rolled-CSS-bar-chart conventions already
// established on recruiter-ops/page.tsx and reports/page.tsx — kept as
// local copies rather than a shared import, matching this codebase's own
// existing per-page self-contained convention.
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };

const PRIORITY_COLOR: Record<string, { bg: string; fg: string }> = {
  low: { bg: '#F1F5F9', fg: '#64748B' },
  medium: { bg: '#EFF6FF', fg: '#2563EB' },
  high: { bg: '#FFF7ED', fg: '#C2410C' },
  critical: { bg: '#FEF2F2', fg: '#DC2626' },
};

function PriorityBadge({ p }: { p: string }) {
  const c = PRIORITY_COLOR[p] || PRIORITY_COLOR.medium;
  return <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: c.bg, color: c.fg, textTransform: 'uppercase' }}>{p}</span>;
}

function BarChart({ rows, keyX, keyY, color = '#2563EB' }: any) {
  if (!rows?.length) return <p style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: 20 }}>No data yet</p>;
  const max = Math.max(...rows.map((r: any) => Number(r[keyY]) || 0), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100, padding: '0 4px', overflowX: 'auto' }}>
      {rows.map((r: any, i: number) => {
        const v = Number(r[keyY]) || 0;
        const h = Math.round((v / max) * 100);
        return (
          <div key={i} style={{ flex: '0 0 auto', minWidth: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>{v}</span>
            <div style={{ width: 24, background: color, borderRadius: '4px 4px 0 0', height: `${h}%`, minHeight: 4, transition: 'height 0.3s' }} />
            <span style={{ fontSize: 9, color: '#94A3B8', maxWidth: 50, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[keyX]}</span>
          </div>
        );
      })}
    </div>
  );
}

function fmtDT(s?: string) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── New Follow-Up form (create/edit shared) ─────────────────────────────
function FollowUpForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: users } = useFetch<any[]>('/users?is_active=true&role=recruiter');
  const { data: clients } = useFetch<any[]>('/clients');
  const { data: reqs } = useFetch<any>('/requisitions');
  const reqList = Array.isArray(reqs) ? reqs : (reqs?.data || []);
  const [form, setForm] = useState({
    recruiter_id: '', title: '', description: '', follow_up_reason: '',
    priority: 'medium', due_at: '', reminder_at: '',
    client_id: '', requisition_id: '', recurrence_rule: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!form.title.trim()) { setErr('Title is required'); return; }
    if (!form.due_at) { setErr('Due date & time is required'); return; }
    setSaving(true); setErr('');
    try {
      await apiFetch('/recruiter-tasks', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          due_at: new Date(form.due_at).toISOString(),
          reminder_at: form.reminder_at ? new Date(form.reminder_at).toISOString() : undefined,
          recruiter_id: form.recruiter_id || undefined,
          client_id: form.client_id || undefined,
          requisition_id: form.requisition_id || undefined,
          recurrence_rule: form.recurrence_rule || undefined,
        }),
      });
      onSaved();
    } catch (e: any) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: 520, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1E293B' }}>+ New Follow-Up</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
        </div>
        {err && <div style={{ background: '#FEF2F2', color: '#DC2626', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <label style={label}>TITLE *</label>
        <input style={input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Call client for feedback" />
        <label style={label}>DESCRIPTION</label>
        <textarea style={{ ...input, minHeight: 60 }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        <label style={label}>FOLLOW-UP REASON</label>
        <input style={input} value={form.follow_up_reason} onChange={e => setForm({ ...form, follow_up_reason: e.target.value })} placeholder="Why this follow-up is needed" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={label}>PRIORITY</label>
            <select style={input} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label style={label}>ASSIGNED USER</label>
            <select style={input} value={form.recruiter_id} onChange={e => setForm({ ...form, recruiter_id: e.target.value })}>
              <option value="">— Auto-assign (least loaded) —</option>
              {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>DUE DATE & TIME *</label>
            <input type="datetime-local" style={input} value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} />
          </div>
          <div>
            <label style={label}>REMINDER AT</label>
            <input type="datetime-local" style={input} value={form.reminder_at} onChange={e => setForm({ ...form, reminder_at: e.target.value })} />
          </div>
          <div>
            <label style={label}>RELATED CLIENT</label>
            <select style={input} value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
              <option value="">— None —</option>
              {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={label}>RELATED JOB</label>
            <select style={input} value={form.requisition_id} onChange={e => setForm({ ...form, requisition_id: e.target.value })}>
              <option value="">— None —</option>
              {reqList.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </div>
        </div>
        <label style={label}>RECURRENCE</label>
        <select style={input} value={form.recurrence_rule} onChange={e => setForm({ ...form, recurrence_rule: e.target.value })}>
          <option value="">One-time (no recurrence)</option>
          <option value="daily">Daily</option><option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </select>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onClose} style={{ ...btn, background: '#F8FAFC', color: '#374151', border: '1px solid #E2E8F0' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...btn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create Follow-Up'}</button>
        </div>
      </div>
    </div>
  );
}

function RescheduleModal({ task, onClose, onSaved }: { task: any; onClose: () => void; onSaved: () => void }) {
  const [dueAt, setDueAt] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!dueAt) return;
    setSaving(true);
    try {
      await apiFetch(`/recruiter-tasks/${task.id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify({ due_at: new Date(dueAt).toISOString(), reason: reason || undefined }),
      });
      onSaved();
    } finally { setSaving(false); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1150, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: 380, background: '#fff', borderRadius: 14, padding: 20 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Reschedule: {task.title}</div>
        <label style={label}>NEW DUE DATE & TIME</label>
        <input type="datetime-local" style={input} value={dueAt} onChange={e => setDueAt(e.target.value)} />
        <label style={label}>REASON (optional)</label>
        <input style={input} value={reason} onChange={e => setReason(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ ...btn, background: '#F8FAFC', color: '#374151', border: '1px solid #E2E8F0' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Reschedule'}</button>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ t, onChanged }: { t: any; onChanged: () => void }) {
  const [rescheduling, setRescheduling] = useState(false);
  const setStatus = async (status: string) => {
    await apiFetch(`/recruiter-tasks/${t.id}?status=${status}`, { method: 'PATCH' });
    onChanged();
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
      {t.ai_suggested && <span title="AI-suggested" style={{ fontSize: 13 }}>✨</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: t.status === 'completed' ? '#94A3B8' : '#1E293B', textDecoration: t.status === 'completed' ? 'line-through' : 'none' }}>{t.title}</div>
        <div style={{ fontSize: 10.5, color: '#94A3B8' }}>
          {t.client_name ? `${t.client_name} · ` : ''}{t.req_title ? `${t.req_title} · ` : ''}Due {fmtDT(t.due_at)}
          {t.is_overdue && <span style={{ color: '#DC2626', fontWeight: 700 }}> · OVERDUE</span>}
          {t.reschedule_count > 0 && <span> · rescheduled ×{t.reschedule_count}</span>}
        </div>
      </div>
      <PriorityBadge p={t.priority} />
      <select value={t.status} onChange={e => setStatus(e.target.value)} style={{ fontSize: 11, padding: '4px 6px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
        <option value="pending">Pending</option><option value="in_progress">In Progress</option>
        <option value="completed">Completed</option><option value="rescheduled">Rescheduled</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <button onClick={() => setRescheduling(true)} title="Reschedule" style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, padding: 5, cursor: 'pointer', color: '#64748B' }}>
        <RotateCcw size={12} />
      </button>
      {rescheduling && <RescheduleModal task={t} onClose={() => setRescheduling(false)} onSaved={() => { setRescheduling(false); onChanged(); }} />}
    </div>
  );
}

// ── Dashboard tab ────────────────────────────────────────────────────────
function DashboardTab({ canTeamView }: { canTeamView: boolean }) {
  const [teamView, setTeamView] = useState(false);
  const { data, refetch } = useFetch<any>(`/reminders/dashboard?team_view=${teamView}`);
  const [showForm, setShowForm] = useState(false);

  const sections = [
    { key: 'overdue', label: 'Overdue', icon: AlertTriangle, color: '#DC2626' },
    { key: 'due_today', label: 'Due Today', icon: Sun, color: '#CA8A04' },
    { key: 'critical', label: 'Critical Follow-Ups', icon: Flame, color: '#DC2626' },
    { key: 'due_this_week', label: 'Due This Week', icon: CalendarDays, color: '#2563EB' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {canTeamView && (
            <div style={{ display: 'flex', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
              <button onClick={() => setTeamView(false)} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: !teamView ? '#2563EB' : '#fff', color: !teamView ? '#fff' : '#64748B' }}>My Reminders</button>
              <button onClick={() => setTeamView(true)} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: teamView ? '#2563EB' : '#fff', color: teamView ? '#fff' : '#64748B' }}>Team Reminders</button>
            </div>
          )}
        </div>
        <button onClick={() => setShowForm(true)} style={{ ...btn, display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> New Follow-Up</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        {sections.map(s => (
          <div key={s.key} style={{ ...card, padding: 14, textAlign: 'center' }}>
            <s.icon size={16} style={{ color: s.color, marginBottom: 4 }} />
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{data?.counts?.[s.key] ?? '—'}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>{s.label}</div>
          </div>
        ))}
        <div style={{ ...card, padding: 14, textAlign: 'center' }}>
          <Video size={16} style={{ color: '#7C3AED', marginBottom: 4 }} />
          <div style={{ fontSize: 22, fontWeight: 800, color: '#7C3AED' }}>{data?.counts?.upcoming_interviews ?? '—'}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Interviews (48h)</div>
        </div>
        <div style={{ ...card, padding: 14, textAlign: 'center' }}>
          <FileWarning size={16} style={{ color: '#C2410C', marginBottom: 4 }} />
          <div style={{ fontSize: 22, fontWeight: 800, color: '#C2410C' }}>{data?.counts?.expiring_documents ?? '—'}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Docs Expiring (30d)</div>
        </div>
      </div>

      {sections.map(s => (data?.[s.key]?.length > 0) && (
        <div key={s.key} style={card}>
          <div style={{ fontSize: 12, fontWeight: 800, color: s.color, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <s.icon size={13} /> {s.label} ({data[s.key].length})
          </div>
          {data[s.key].map((t: any) => <TaskRow key={t.id} t={t} onChanged={refetch} />)}
        </div>
      ))}

      {data?.upcoming_interviews?.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#7C3AED', marginBottom: 6 }}>Upcoming Interviews (next 48h)</div>
          {data.upcoming_interviews.map((i: any) => (
            <div key={i.id} style={{ display: 'flex', gap: 10, padding: '7px 4px', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
              <span style={{ flex: 1 }}>{i.candidate_name || 'Candidate'} — {i.interview_type}</span>
              <span style={{ color: '#64748B' }}>{fmtDT(i.scheduled_at)}</span>
            </div>
          ))}
        </div>
      )}

      {data?.expiring_documents?.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#C2410C', marginBottom: 6 }}>Expiring Documents (next 30 days)</div>
          {data.expiring_documents.map((d: any) => (
            <div key={d.id} style={{ display: 'flex', gap: 10, padding: '7px 4px', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
              <span style={{ flex: 1 }}>{d.document_type.toUpperCase()} — {d.candidate_name || d.document_name}</span>
              <span style={{ color: d.days_left <= 7 ? '#DC2626' : '#64748B', fontWeight: 700 }}>{d.days_left}d left</span>
            </div>
          ))}
        </div>
      )}

      {data && !Object.values(data.counts || {}).some((v: any) => v > 0) && (
        <div style={{ ...card, textAlign: 'center', color: '#94A3B8' }}>Nothing needs your attention right now.</div>
      )}

      {showForm && <FollowUpForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} />}
    </div>
  );
}

// ── Follow-Ups list tab (full list with filters) ─────────────────────────
function FollowUpsTab() {
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const { data: tasks, refetch } = useFetch<any[]>(
    `/recruiter-tasks?${status ? `status=${status}&` : ''}${priority ? `priority=${priority}&` : ''}${overdueOnly ? 'overdue_only=true' : ''}`
  );
  const [showForm, setShowForm] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...input, width: 140, marginBottom: 0 }}>
          <option value="">All Status</option>
          <option value="pending">Pending</option><option value="in_progress">In Progress</option>
          <option value="completed">Completed</option><option value="rescheduled">Rescheduled</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)} style={{ ...input, width: 140, marginBottom: 0 }}>
          <option value="">All Priority</option>
          <option value="low">Low</option><option value="medium">Medium</option>
          <option value="high">High</option><option value="critical">Critical</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151' }}>
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} /> Overdue only
        </label>
        <button onClick={() => setShowForm(true)} style={{ ...btn, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> New Follow-Up</button>
      </div>
      <div style={card}>
        {(tasks || []).map((t: any) => <TaskRow key={t.id} t={t} onChanged={refetch} />)}
        {!tasks?.length && <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 12 }}>No follow-ups match these filters.</div>}
      </div>
      {showForm && <FollowUpForm onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); refetch(); }} />}
    </div>
  );
}

// ── Document Expiry tab ──────────────────────────────────────────────────
const DOC_TYPES = ['nda', 'contract', 'visa', 'certification', 'offer_letter', 'kyc'];

function DocumentExpiryTab() {
  const { data: docs, refetch } = useFetch<any[]>('/document-expiry');
  const { data: candidates } = useFetch<any>('/candidates?limit=200');
  const candList = Array.isArray(candidates) ? candidates : (candidates?.data || candidates?.items || []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ candidate_id: '', document_type: 'nda', document_name: '', expires_at: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!form.document_name || !form.expires_at) return;
    setSaving(true);
    try {
      await apiFetch('/document-expiry', {
        method: 'POST',
        body: JSON.stringify({ ...form, candidate_id: form.candidate_id || undefined }),
      });
      setShowForm(false);
      setForm({ candidate_id: '', document_type: 'nda', document_name: '', expires_at: '', notes: '' });
      refetch();
    } finally { setSaving(false); }
  };
  const setDocStatus = async (id: string, status: string) => {
    await apiFetch(`/document-expiry/${id}?status=${status}`, { method: 'PATCH' });
    refetch();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> Track Document Expiry
      </button>
      {showForm && (
        <div style={card}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={label}>DOCUMENT TYPE</label>
              <select style={input} value={form.document_type} onChange={e => setForm({ ...form, document_type: e.target.value })}>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>CANDIDATE (optional)</label>
              <select style={input} value={form.candidate_id} onChange={e => setForm({ ...form, candidate_id: e.target.value })}>
                <option value="">— None —</option>
                {candList.map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>
          </div>
          <label style={label}>DOCUMENT NAME</label>
          <input style={input} value={form.document_name} onChange={e => setForm({ ...form, document_name: e.target.value })} placeholder="e.g. Master Service Agreement" />
          <label style={label}>EXPIRES ON</label>
          <input type="date" style={input} value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} />
          <label style={label}>NOTES</label>
          <input style={input} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <button onClick={create} disabled={saving} style={btn}>{saving ? 'Saving…' : 'Track'}</button>
        </div>
      )}
      <div style={card}>
        {(docs || []).map((d: any) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: '#F1F5F9', color: '#475569' }}>{d.document_type.toUpperCase()}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: '#1E293B' }}>{d.candidate_name || d.document_name}</div>
              <div style={{ fontSize: 10.5, color: '#94A3B8' }}>{d.document_name} · expires {d.expires_at}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: d.status !== 'active' ? '#94A3B8' : (d.days_left <= 7 ? '#DC2626' : d.days_left <= 30 ? '#CA8A04' : '#16A34A') }}>
              {d.status === 'active' ? `${d.days_left}d left` : d.status}
            </span>
            <select value={d.status} onChange={e => setDocStatus(d.id, e.target.value)} style={{ fontSize: 11, padding: '4px 6px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
              <option value="active">Active</option><option value="renewed">Renewed</option>
              <option value="expired">Expired</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
        ))}
        {!docs?.length && <div style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 12 }}>No documents tracked yet.</div>}
      </div>
    </div>
  );
}

// ── Reports tab ───────────────────────────────────────────────────────────
function ReportsTab() {
  const [days, setDays] = useState(30);
  const { data } = useFetch<any>(`/reminders/reports?days=${days}`);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ ...input, width: 160, marginBottom: 0 }}>
        <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#16A34A' }}>{data?.completion_rate_pct ?? '—'}%</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B' }}>COMPLETION RATE</div>
        </div>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#1E293B' }}>{data?.total_tasks ?? '—'}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B' }}>TOTAL FOLLOW-UPS</div>
        </div>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#DC2626' }}>{data?.overdue ?? '—'}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B' }}>OVERDUE (CREATED IN PERIOD)</div>
        </div>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#2563EB' }}>{data?.avg_response_hours != null ? `${data.avg_response_hours}h` : '—'}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B' }}>AVG RESPONSE TIME</div>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 10 }}>Team Productivity — Follow-Ups by Recruiter</div>
        <BarChart rows={data?.by_recruiter || []} keyX="full_name" keyY="total" />
      </div>
      <div style={card}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E2E8F0', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px' }}>Recruiter</th><th style={{ padding: '6px 8px' }}>Total</th>
              <th style={{ padding: '6px 8px' }}>Completed</th><th style={{ padding: '6px 8px' }}>Overdue</th>
            </tr>
          </thead>
          <tbody>
            {(data?.by_recruiter || []).map((r: any) => (
              <tr key={r.recruiter_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                <td style={{ padding: '6px 8px' }}>{r.full_name}</td>
                <td style={{ padding: '6px 8px' }}>{r.total}</td>
                <td style={{ padding: '6px 8px', color: '#16A34A' }}>{r.completed}</td>
                <td style={{ padding: '6px 8px', color: r.overdue > 0 ? '#DC2626' : '#64748B' }}>{r.overdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Settings tab (admin/manager only) ────────────────────────────────────
function SettingsTab() {
  const { data: esc, refetch: refetchEsc } = useFetch<any>('/escalation-config');
  const { data: ivr, refetch: refetchIvr } = useFetch<any>('/interview-reminder-config');
  const [escForm, setEscForm] = useState<any>(null);
  const [leadTimes, setLeadTimes] = useState<string>('');
  const [saved, setSaved] = useState('');

  useEffect(() => { if (esc && !escForm) setEscForm(esc); }, [esc, escForm]);
  useEffect(() => { if (ivr && !leadTimes) setLeadTimes((ivr.lead_times_hours || []).join(', ')); }, [ivr, leadTimes]);

  const saveEsc = async () => {
    await apiFetch('/escalation-config', {
      method: 'PUT',
      body: JSON.stringify({
        tier1_grace_hours: Number(escForm.tier1_grace_hours),
        tier2_grace_hours: Number(escForm.tier2_grace_hours),
        tier3_grace_hours: Number(escForm.tier3_grace_hours),
        tier4_grace_hours: Number(escForm.tier4_grace_hours),
        critical_multiplier: Number(escForm.critical_multiplier),
      }),
    });
    setSaved('Escalation settings saved'); refetchEsc(); setTimeout(() => setSaved(''), 2000);
  };
  const saveIvr = async () => {
    const hours = leadTimes.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (!hours.length) return;
    await apiFetch('/interview-reminder-config', { method: 'PUT', body: JSON.stringify({ lead_times_hours: hours }) });
    setSaved('Interview reminder timing saved'); refetchIvr(); setTimeout(() => setSaved(''), 2000);
  };

  if (!escForm) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 }}>
      {saved && <div style={{ background: '#F0FDF4', color: '#16A34A', padding: '8px 12px', borderRadius: 8, fontSize: 12 }}>{saved}</div>}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Escalation Timing</div>
        <p style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>How many hours a follow-up must be overdue before escalating to the next level. Critical-priority follow-ups escalate faster by the multiplier below.</p>
        <label style={label}>TIER 1 — Notify Assigned User (hours overdue)</label>
        <input type="number" style={input} value={escForm.tier1_grace_hours} onChange={e => setEscForm({ ...escForm, tier1_grace_hours: e.target.value })} />
        <label style={label}>TIER 2 — Notify Reporting Manager (hours overdue)</label>
        <input type="number" style={input} value={escForm.tier2_grace_hours} onChange={e => setEscForm({ ...escForm, tier2_grace_hours: e.target.value })} />
        <label style={label}>TIER 3 — Notify Client's KAE/KAM (hours overdue)</label>
        <input type="number" style={input} value={escForm.tier3_grace_hours} onChange={e => setEscForm({ ...escForm, tier3_grace_hours: e.target.value })} />
        <label style={label}>TIER 4 — Notify Admin (hours overdue)</label>
        <input type="number" style={input} value={escForm.tier4_grace_hours} onChange={e => setEscForm({ ...escForm, tier4_grace_hours: e.target.value })} />
        <label style={label}>CRITICAL PRIORITY SPEED MULTIPLIER (0.5 = twice as fast)</label>
        <input type="number" step="0.1" style={input} value={escForm.critical_multiplier} onChange={e => setEscForm({ ...escForm, critical_multiplier: e.target.value })} />
        <button onClick={saveEsc} style={btn}>Save Escalation Settings</button>
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Interview Reminder Timing</div>
        <p style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>Lead times (in hours) before a scheduled interview when a reminder fires. Comma-separated — e.g. 24, 2, 0.5 for 24h/2h/30min before.</p>
        <label style={label}>LEAD TIMES (HOURS, COMMA-SEPARATED)</label>
        <input style={input} value={leadTimes} onChange={e => setLeadTimes(e.target.value)} placeholder="24, 2, 0.5" />
        <button onClick={saveIvr} style={btn}>Save Reminder Timing</button>
      </div>
    </div>
  );
}

// ── Page shell ────────────────────────────────────────────────────────────
const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: Bell },
  { key: 'followups', label: 'Follow-Ups', icon: CheckCircle2 },
  { key: 'documents', label: 'Document Expiry', icon: FileWarning },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export default function RemindersPage() {
  const [tab, setTab] = useState('dashboard');
  // SSR-safe deferred role read — same pattern as recruiter-ops/device-
  // monitoring pages (localStorage doesn't exist during server render).
  const [role, setRole] = useState('');
  useEffect(() => { setRole(getTokenPayload()?.role || ''); }, []);
  const isManager = role === '' || ['admin', 'manager', 'kae', 'kam', 'sales_manager', 'hr_manager'].includes(role);
  const visibleTabs = TABS.filter(t => t.key !== 'settings' || isManager);

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Reminders & Follow-Ups</h1>
        <p style={{ fontSize: 13, color: '#64748B' }}>Never miss a critical action, deadline, interview, or client follow-up — one place for reminders, escalations, and document expiry across the whole ATS.</p>
      </div>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: tab === t.key ? '#2563EB' : '#64748B', borderBottom: tab === t.key ? '2px solid #2563EB' : '2px solid transparent' }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'dashboard' && <DashboardTab canTeamView={isManager} />}
      {tab === 'followups' && <FollowUpsTab />}
      {tab === 'documents' && <DocumentExpiryTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'settings' && isManager && <SettingsTab />}
    </div>
  );
}
