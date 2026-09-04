'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import {
  Bell, Sun, CalendarDays, AlertTriangle, Flame, Video, FileWarning,
  BarChart3, Settings, Plus, X, CheckCircle2, RotateCcw, MessageCircle,
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
  // Real feature (2026-08-30): "Need to add candidate name also to
  // select base on client for followup received" - reported live off a
  // screenshot of this exact form showing no candidate field at all.
  // 1,865+ real candidates in this tenant rules out a plain <select> -
  // same real search-as-you-type pattern already established on
  // onboarding/page.tsx and bgv/page.tsx (debounced /candidates?search=).
  const [candQuery, setCandQuery] = useState('');
  const [candResults, setCandResults] = useState<any[]>([]);
  const [candidate, setCandidate] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function searchCandidates(q: string) {
    setCandQuery(q); setCandidate(null);
    if (q.trim().length < 2) { setCandResults([]); return; }
    try {
      const rows = await apiFetch(`/candidates?search=${encodeURIComponent(q)}&limit=8`);
      setCandResults(Array.isArray(rows) ? rows : rows?.items || []);
    } catch { setCandResults([]); }
  }

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
          candidate_id: candidate?.id || undefined,
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

  // Real bug fix (2026-09-04): reported live as "top side is hide" - this
  // modal rendered inline in the page tree (no portal), and every
  // dashboard page wraps its content in a `.anim-fade-up` div carrying a
  // real `transform` (even at its resting/identity value, that's still a
  // non-`none` transform) - per the CSS spec, any ancestor transform
  // creates a NEW containing block for `position:fixed` descendants, so
  // this "fixed, inset:0" overlay was being sized/centered against that
  // page wrapper's own full scroll height (confirmed live: 36,485px on
  // this real page) instead of the true viewport, landing the centered
  // panel far below the visible screen. Fixed by portaling straight to
  // document.body, matching the already-correct, established pattern
  // components/ui/Modal.tsx already uses for exactly this reason.
  if (typeof document === 'undefined') return null;
  return createPortal(
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
        <label style={label}>CANDIDATE</label>
        <input data-testid="followup-candidate-search" value={candidate ? candidate.full_name : candQuery} onChange={e => searchCandidates(e.target.value)}
          placeholder="Search by name or email…" style={input} />
        {candResults.length > 0 && !candidate && (
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, marginTop: -6, marginBottom: 8, maxHeight: 160, overflowY: 'auto' }}>
            {candResults.map((c: any) => (
              <div key={c.id} data-testid={`followup-candidate-option-${c.id}`} onClick={() => { setCandidate(c); setCandResults([]); }}
                style={{ padding: '8px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ fontWeight: 600 }}>{c.full_name}</div>
                <div style={{ color: '#94A3B8', fontSize: 11 }}>{c.email}</div>
              </div>
            ))}
          </div>
        )}
        {candidate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: -4, marginBottom: 8, fontSize: 11, color: '#059669' }}>
            ✓ Linked to {candidate.full_name}
            <button onClick={() => { setCandidate(null); setCandQuery(''); }} style={{ border: 'none', background: 'none', color: '#94A3B8', cursor: 'pointer', padding: 0 }}><X size={12} /></button>
          </div>
        )}
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
    </div>,
    document.body
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
          {t.candidate_name ? `${t.candidate_name} · ` : ''}{t.client_name ? `${t.client_name} · ` : ''}{t.req_title ? `${t.req_title} · ` : ''}Due {fmtDT(t.due_at)}
          {t.is_overdue && <span style={{ color: '#DC2626', fontWeight: 700 }}> · OVERDUE</span>}
          {t.reschedule_count > 0 && <span> · rescheduled ×{t.reschedule_count}</span>}
        </div>
        {/* REAL GAP FIX (2026-08-31): follow_up_reason (and description)
            were always returned by the backend but never shown anywhere
            on this row - reported live, wanted "reason and other
            details" visible without opening anything. */}
        {(t.follow_up_reason || t.description) && (
          <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2, fontStyle: 'italic' }}>
            {t.follow_up_reason && <>Reason: {t.follow_up_reason}</>}
            {t.follow_up_reason && t.description ? ' · ' : ''}
            {t.description}
          </div>
        )}
      </div>
      <PriorityBadge p={t.priority} />
      {/* REAL FEATURE ADD (2026-08-31): "add the option for followup
          message and connect with all followup dashboard" - reported
          live. Only shown when this follow-up is actually linked to a
          candidate (a client-only or general task has nobody to message).
          Opens the real Conversations composer, pre-addressed - not a
          second, parallel messaging surface. */}
      {t.candidate_id && (
        <a href={`/conversations?compose_candidate=${t.candidate_id}&compose_subject=${encodeURIComponent('Follow-up: ' + t.title)}`}
          title="Send a message about this follow-up" style={{ background: 'none', border: '1px solid #E2E8F0', borderRadius: 6, padding: 5, cursor: 'pointer', color: '#2563EB', display: 'flex' }}>
          <MessageCircle size={12} />
        </a>
      )}
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
function FollowUpsTab({ initialCandidateId }: { initialCandidateId?: string }) {
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  // Real deep-link (2026-09-01) — the pipeline drawer's own new Follow-up
  // tab links "Reminders & Reports" here with ?tab=followups&candidate=<id>
  // so it lands on that candidate's own follow-ups, not the whole team's
  // list — part of "connect with all followup features and reports".
  const [candidateFilter, setCandidateFilter] = useState(initialCandidateId || '');
  useEffect(() => { setCandidateFilter(initialCandidateId || ''); }, [initialCandidateId]);
  const { data: tasks, refetch } = useFetch<any[]>(
    `/recruiter-tasks?${status ? `status=${status}&` : ''}${priority ? `priority=${priority}&` : ''}${candidateFilter ? `candidate_id=${candidateFilter}&` : ''}${overdueOnly ? 'overdue_only=true' : ''}`
  );
  const [showForm, setShowForm] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {candidateFilter && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: '#2563EB', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '6px 10px', width: 'fit-content' }}>
          Filtered to {tasks?.[0]?.candidate_name || 'one candidate'}
          <button onClick={() => setCandidateFilter('')} style={{ border: 'none', background: 'none', color: '#2563EB', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Clear</button>
        </div>
      )}
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
function ReportsTab({ canTeamView }: { canTeamView: boolean }) {
  const [days, setDays] = useState(30);
  // REAL BUG FIX (2026-08-31): this tab had no role scoping at all —
  // reported live, a plain recruiter's Reports tab showed the WHOLE
  // team's totals and a "by Recruiter" breakdown of everyone, not just
  // themselves. Mirrors the Dashboard tab's own already-correct
  // My/Team toggle exactly (/reminders/dashboard's team_view param).
  const [teamView, setTeamView] = useState(false);
  const { data } = useFetch<any>(`/reminders/reports?days=${days}&team_view=${teamView && canTeamView}`);
  const scopeLabel = data?.scope === 'team' ? 'Team' : 'My';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ ...input, width: 160, marginBottom: 0 }}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        {canTeamView && (
          <div style={{ display: 'flex', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
            <button onClick={() => setTeamView(false)} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: !teamView ? '#2563EB' : '#fff', color: !teamView ? '#fff' : '#64748B' }}>My Reports</button>
            <button onClick={() => setTeamView(true)} style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', background: teamView ? '#2563EB' : '#fff', color: teamView ? '#fff' : '#64748B' }}>Team Reports</button>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#16A34A' }}>{data?.completion_rate_pct ?? '—'}%</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B' }}>{scopeLabel.toUpperCase()} COMPLETION RATE</div>
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
      {data?.scope === 'team' && (
        <>
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
        </>
      )}
    </div>
  );
}

// ── Settings tab (admin/manager only) ────────────────────────────────────
// Reminder System Phase 2 — real browser push subscribe/unsubscribe flow
// (W3C Push API + the app-wide service worker already registered in
// app/layout.tsx). Standard VAPID-key conversion boilerplate — the
// PushManager API requires the base64url public key as a raw Uint8Array,
// not the string itself.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function PushNotificationSettings() {
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [deviceCount, setDeviceCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refreshStatus = async () => {
    try {
      const s = await apiFetch('/push/status');
      setSubscribed(!!s.subscribed);
      setDeviceCount(s.device_count || 0);
    } catch { /* best-effort */ }
  };

  useEffect(() => {
    setMounted(true);
    const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission);
    refreshStatus();
  }, []);

  const enable = async () => {
    setBusy(true); setMsg('');
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') { setMsg('Permission denied — enable notifications for this site in your browser settings.'); setBusy(false); return; }
      const { public_key, configured } = await apiFetch('/push/vapid-public-key');
      if (!configured || !public_key) { setMsg('Push is not configured on the server yet.'); setBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
      });
      const json: any = sub.toJSON();
      await apiFetch('/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent }),
      });
      setMsg('Push notifications enabled on this device.');
      await refreshStatus();
    } catch (e: any) {
      setMsg(e?.message || 'Could not enable push notifications.');
    }
    setBusy(false);
  };

  const disable = async () => {
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiFetch('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setMsg('Push notifications disabled on this device.');
      await refreshStatus();
    } catch (e: any) {
      setMsg(e?.message || 'Could not disable push notifications.');
    }
    setBusy(false);
  };

  const sendTest = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await apiFetch('/push/test', { method: 'POST' });
      setMsg(`Test sent to ${r.sent}/${r.total} device(s) — check for a real notification.`);
    } catch (e: any) {
      setMsg(e?.message || 'Test send failed.');
    }
    setBusy(false);
  };

  if (!mounted) return null;
  return (
    <div style={card} data-testid="push-notification-settings">
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Browser Push Notifications</div>
      <p style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>
        Get warning/critical reminders as real desktop or mobile browser notifications, even when this tab isn't open.
      </p>
      {!supported && <div style={{ fontSize: 12, color: '#B45309' }}>Not supported in this browser.</div>}
      {supported && (
        <>
          <div style={{ fontSize: 12, color: '#334155', marginBottom: 10 }}>
            Status: {subscribed ? <b style={{ color: '#16A34A' }}>Enabled ({deviceCount} device{deviceCount === 1 ? '' : 's'})</b> : <b style={{ color: '#64748B' }}>Not enabled on this device</b>}
            {permission === 'denied' && <span style={{ color: '#DC2626' }}> — browser permission denied</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!subscribed
              ? <button data-testid="push-enable-btn" onClick={enable} disabled={busy} style={btn}>Enable Push Notifications</button>
              : <button data-testid="push-disable-btn" onClick={disable} disabled={busy} style={{ ...btn, background: '#EF4444' }}>Disable</button>}
            {subscribed && <button data-testid="push-test-btn" onClick={sendTest} disabled={busy} style={{ ...btn, background: '#0EA5E9' }}>Send Test</button>}
          </div>
          {msg && <div style={{ fontSize: 11, color: '#334155', marginTop: 8 }}>{msg}</div>}
        </>
      )}
    </div>
  );
}

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
      <PushNotificationSettings />
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
  // Real deep-link support (2026-09-01) — the pipeline drawer's own new
  // Follow-up tab opens this page with ?tab=followups&candidate=<id> so
  // "Reminders & Reports" lands on that candidate's real filtered view,
  // not a generic page. Client-only (no window during SSR), matching
  // this project's established deferred-read convention used throughout
  // this codebase for exactly this reason.
  const [deepLinkCandidateId, setDeepLinkCandidateId] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    const c = params.get('candidate');
    if (t) setTab(t);
    if (c) setDeepLinkCandidateId(c);
  }, []);
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
          <button key={t.key} data-tab={t.key} onClick={() => setTab(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: tab === t.key ? '#2563EB' : '#64748B', borderBottom: tab === t.key ? '2px solid #2563EB' : '2px solid transparent' }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'dashboard' && <DashboardTab canTeamView={isManager} />}
      {tab === 'followups' && <FollowUpsTab initialCandidateId={deepLinkCandidateId} />}
      {tab === 'documents' && <DocumentExpiryTab />}
      {tab === 'reports' && <ReportsTab canTeamView={isManager} />}
      {tab === 'settings' && isManager && <SettingsTab />}
    </div>
  );
}
