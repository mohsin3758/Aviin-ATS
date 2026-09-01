'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus, ExternalLink } from 'lucide-react';

// Real feature (2026-09-01, explicit ask): "i want followup button on
// next to notes so recruiter or KAE, and KAM can keep the followup
// message and features and connect with all followup features and
// reports" — followed by "add followup option in Resume inbox and
// candidate folder same features". Built once in pipeline/page.tsx,
// extracted here (2026-09-01) so Resume Inbox and the Candidates page's
// own drawer can reuse the exact same real component instead of a
// second, drifting copy — matching this codebase's own established
// convention for a feature needed on 3+ surfaces (see
// SkillExperienceCard.tsx / WhatsAppChatButton.tsx for the same
// precedent). Wired directly to the real, already-built Reminders &
// Follow-Ups system — same table (recruiter_tasks), same real fields
// (title/description/follow_up_reason/priority/due_at/reminder_at/
// recurrence_rule) and same POST/PATCH endpoints as the full /reminders
// page's own "New Follow-Up" form, not a second, disconnected concept.
// Any follow-up created here shows up on that page's Follow-Ups tab and
// counts toward its real Reports numbers automatically, since both read
// the same table — no separate wiring needed for "connect... with
// reports". Pre-fills candidate/application/requisition/client linkage
// from the caller's own already-loaded context when available (a bare
// candidateId, as on the Resume Inbox / Candidates drawers, still works
// fine — those extra fields are simply omitted from the created task).
const FOLLOWUP_PRIORITY_COLOR: Record<string, { bg: string; fg: string }> = {
  low: { bg: '#F1F5F9', fg: '#64748B' },
  medium: { bg: '#EFF6FF', fg: '#2563EB' },
  high: { bg: '#FFF7ED', fg: '#C2410C' },
  critical: { bg: '#FEF2F2', fg: '#DC2626' },
};
function followupFmtDT(s?: string) {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function FollowUpTab({ candidateId, candidateName, applicationId, requisitionId, clientName, showToast }: {
  candidateId?: string; candidateName?: string; applicationId?: string; requisitionId?: string; clientName?: string;
  showToast: (msg: string, ok?: boolean) => void;
}) {
  const { data: tasks, refetch } = useFetch<any[]>(candidateId ? `/recruiter-tasks?candidate_id=${candidateId}` : null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', follow_up_reason: '', priority: 'medium', due_at: '', reminder_at: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!form.title.trim()) { setErr('Title is required'); return; }
    if (!form.due_at) { setErr('Due date & time is required'); return; }
    setSaving(true); setErr('');
    try {
      await apiFetch('/recruiter-tasks', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          candidate_id: candidateId,
          application_id: applicationId || undefined,
          requisition_id: requisitionId || undefined,
          due_at: new Date(form.due_at).toISOString(),
          reminder_at: form.reminder_at ? new Date(form.reminder_at).toISOString() : undefined,
        }),
      });
      setAdding(false);
      setForm({ title: '', description: '', follow_up_reason: '', priority: 'medium', due_at: '', reminder_at: '' });
      refetch();
      showToast('Follow-up created');
    } catch (e: any) {
      setErr(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(taskId: string, status: string) {
    try {
      await apiFetch(`/recruiter-tasks/${taskId}?status=${status}`, { method: 'PATCH' });
      refetch();
      showToast(status === 'completed' ? 'Marked done' : 'Follow-up updated');
    } catch (e: any) { showToast(String(e?.message || 'Failed'), false); }
  }

  const fieldStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8, fontFamily: 'inherit' };
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };

  if (!candidateId) return null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>{tasks?.length || 0} follow-up(s) for {candidateName}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`/reminders?tab=followups&candidate=${candidateId || ''}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#2563EB', textDecoration: 'none' }}>
            <ExternalLink size={11} /> Reminders & Reports
          </a>
          <button onClick={() => setAdding(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <Plus size={12} /> New Follow-up
          </button>
        </div>
      </div>

      {adding && (
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          {err && <div style={{ background: '#FEF2F2', color: '#DC2626', padding: '6px 10px', borderRadius: 8, fontSize: 11, marginBottom: 8 }}>{err}</div>}
          <label style={labelStyle}>TITLE *</label>
          <input style={fieldStyle} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Call candidate re: offer" />
          <label style={labelStyle}>FOLLOW-UP REASON</label>
          <input style={fieldStyle} value={form.follow_up_reason} onChange={e => setForm({ ...form, follow_up_reason: e.target.value })} placeholder="Why this follow-up is needed" />
          <label style={labelStyle}>DESCRIPTION</label>
          <textarea style={{ ...fieldStyle, minHeight: 50 }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={labelStyle}>PRIORITY</label>
              <select style={fieldStyle} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="high">High</option><option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>DUE DATE & TIME *</label>
              <input type="datetime-local" style={fieldStyle} value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>REMINDER AT (optional)</label>
              <input type="datetime-local" style={fieldStyle} value={form.reminder_at} onChange={e => setForm({ ...form, reminder_at: e.target.value })} />
            </div>
          </div>
          {(requisitionId || clientName) && (
            <div style={{ fontSize: 10.5, color: '#94A3B8', marginBottom: 8 }}>
              Linked to {clientName ? `${clientName} · ` : ''}this candidate's application
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => setAdding(false)} style={{ padding: '7px 14px', background: '#fff', color: '#374151', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
            <button onClick={submit} disabled={saving} style={{ padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Create Follow-up'}</button>
          </div>
        </div>
      )}

      {!tasks?.length && !adding && <div style={{ color: '#CBD5E1', fontSize: 12, textAlign: 'center', padding: 20, fontStyle: 'italic' }}>No follow-ups yet for this candidate</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(tasks || []).map((t: any) => {
          const c = FOLLOWUP_PRIORITY_COLOR[t.priority] || FOLLOWUP_PRIORITY_COLOR.medium;
          const isDone = t.status === 'completed' || t.status === 'cancelled';
          return (
            <div key={t.id} data-testid={`followup-task-${t.id}`} style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px', background: isDone ? '#F8FAFC' : '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: isDone ? '#94A3B8' : '#1E293B', textDecoration: isDone ? 'line-through' : 'none' }}>{t.title}</div>
                <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: c.bg, color: c.fg, textTransform: 'uppercase', flexShrink: 0 }}>{t.priority}</span>
              </div>
              <div style={{ fontSize: 10.5, color: '#94A3B8', marginTop: 2 }}>
                Due {followupFmtDT(t.due_at)}
                {t.is_overdue && <span style={{ color: '#DC2626', fontWeight: 700 }}> · OVERDUE</span>}
              </div>
              {(t.follow_up_reason || t.description) && (
                <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 4, fontStyle: 'italic' }}>
                  {t.follow_up_reason && <>Reason: {t.follow_up_reason}</>}
                  {t.follow_up_reason && t.description ? ' · ' : ''}
                  {t.description}
                </div>
              )}
              {!isDone && (
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={() => setStatus(t.id, 'completed')} style={{ padding: '4px 10px', fontSize: 10.5, fontWeight: 700, border: '1px solid #A7F3D0', background: '#ECFDF5', color: '#059669', borderRadius: 6, cursor: 'pointer' }}>✓ Mark Done</button>
                  <button onClick={() => setStatus(t.id, 'cancelled')} style={{ padding: '4px 10px', fontSize: 10.5, fontWeight: 700, border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
