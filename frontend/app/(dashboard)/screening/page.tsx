'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import { MessageCircle, Plus, Trash2, Send, RotateCcw } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' };
const inputSm: React.CSSProperties = { padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, background: '#fff', width: '100%' };
const btn: React.CSSProperties = { padding: '7px 14px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 };
const btnGhost: React.CSSProperties = { ...btn, background: '#fff', color: '#374151', border: '1px solid #E2E8F0' };

type Row = { full_name: string; phone: string; email: string };
const emptyRow = (): Row => ({ full_name: '', phone: '', email: '' });

const FUNNEL_LABELS: Record<string, string> = {
  pending_optin: 'Pending opt-in', sent: 'Sent, awaiting reply', awaiting_screening: 'Consented',
  declined: 'Declined', opted_out: 'Opted out', no_response: 'No response', bad_number: 'Bad number',
};

export default function ScreeningPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data: reqs } = useFetch<any[]>(mounted ? '/requisitions?status=open' : null);
  const [requisitionId, setRequisitionId] = useState('');
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [testSending, setTestSending] = useState(false);

  const { data: summary, refetch: refetchSummary } = useFetch<any>(mounted ? '/screening/summary?mine=true' : null);
  const funnel = summary?.funnel || {};
  const { data: sessionsData, refetch: refetchSessions } = useFetch<any>(mounted ? '/screening/sessions?mine=true' : null);
  const sessions = sessionsData?.sessions || [];
  const [invitingId, setInvitingId] = useState<string | null>(null);

  async function sendInterviewInvite(row: any) {
    const date = window.prompt(`Interview date/time for ${row.full_name} (e.g. "Mon 15 Sep, 3 PM"):`);
    if (!date) return;
    setInvitingId(row.id);
    try {
      await apiFetch('/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: row.candidate_id, phone: row.phone, template_key: 'interview_invitation',
          lang: 'en', vars: { name: row.full_name, role: row.requisition_title, client: '', date },
        }),
      });
      alert('Interview invite sent.');
    } catch (e: any) {
      alert(e.message || 'Failed to send invite');
    } finally {
      setInvitingId(null);
    }
  }

  function updateRow(i: number, field: keyof Row, value: string) {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function addRow() { setRows(prev => [...prev, emptyRow()]); }
  function removeRow(i: number) { setRows(prev => prev.filter((_, idx) => idx !== i)); }

  async function enroll() {
    const validRows = rows.filter(r => r.full_name.trim() && r.phone.trim());
    if (!requisitionId) { alert('Pick a role first'); return; }
    if (!validRows.length) { alert('Add at least one row with a name and phone number'); return; }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await apiFetch('/screening/enroll', {
        method: 'POST',
        body: JSON.stringify({
          requisition_id: requisitionId,
          enrolled_via: 'quick_add',
          rows: validRows.map(r => ({ full_name: r.full_name, phone: r.phone, email: r.email || null })),
        }),
      });
      setResult(res);
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      refetchSummary();
      refetchSessions();
    } catch (e: any) {
      alert(e.message || 'Enroll failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function sendTestToSelf() {
    if (!requisitionId) { alert('Pick a role first'); return; }
    setTestSending(true);
    try {
      // Test-send needs a real session row to pull role/client wording
      // from — enroll the recruiter's own first valid row (if any) as a
      // one-off preview, or just explain the requirement if the grid is
      // empty. Simpler v1: ask them to enroll one real row first, then
      // use that row's own "Send test to myself" from the results list.
      alert('Enroll at least one candidate first, then use "Send test to myself" next to that row in the results below.');
    } finally {
      setTestSending(false);
    }
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <MessageCircle size={20} style={{ color: '#2563EB' }} />
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>WhatsApp Screening</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {Object.keys(FUNNEL_LABELS).map(key => (
          <div key={key} style={card}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>{funnel[key] || 0}</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>{FUNNEL_LABELS[key]}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <label style={label}>Role</label>
        <select style={{ ...inputSm, marginBottom: 12 }} value={requisitionId} onChange={e => setRequisitionId(e.target.value)}>
          <option value="">Select an open role...</option>
          {(reqs || []).map((r: any) => (
            <option key={r.id} value={r.id}>{r.title}{r.client_name ? ` — ${r.client_name}` : ''}</option>
          ))}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.5fr auto', gap: 8, marginBottom: 6 }}>
          <label style={label}>Name</label>
          <label style={label}>Mobile</label>
          <label style={label}>Email (optional)</label>
          <span />
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.5fr auto', gap: 8, marginBottom: 6 }}>
            <input style={inputSm} value={row.full_name} onChange={e => updateRow(i, 'full_name', e.target.value)} placeholder="Full name" />
            <input style={inputSm} value={row.phone} onChange={e => updateRow(i, 'phone', e.target.value)} placeholder="10-digit mobile" />
            <input style={inputSm} value={row.email} onChange={e => updateRow(i, 'email', e.target.value)} placeholder="email@example.com" />
            <button style={{ ...btnGhost, padding: 6 }} onClick={() => removeRow(i)} title="Remove row"><Trash2 size={14} /></button>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button style={btnGhost} onClick={addRow}><Plus size={14} /> Add row</button>
          <button style={btn} onClick={enroll} disabled={submitting}>
            <Send size={14} /> {submitting ? 'Enrolling...' : 'Start screening'}
          </button>
          <button style={btnGhost} onClick={sendTestToSelf} disabled={testSending}>
            <RotateCcw size={14} /> Send test to myself
          </button>
        </div>

        {result && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#374151' }}>
            {result.enrolled} enrolled, {result.skipped} skipped (already in an active session), {result.errors} error(s).
            {result.results?.filter((r: any) => r.status === 'error').map((r: any, idx: number) => (
              <div key={idx} style={{ color: '#DC2626' }}>• {r.detail}</div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#0F172A' }}>Queue</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ padding: '6px 8px' }}>Candidate</th>
                <th style={{ padding: '6px 8px' }}>Role</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Updated</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {sessions.map((row: any) => (
                <tr key={row.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '6px 8px' }}>{row.full_name}<div style={{ color: '#94A3B8' }}>{row.phone}</div></td>
                  <td style={{ padding: '6px 8px' }}>{row.requisition_title}</td>
                  <td style={{ padding: '6px 8px' }}>{FUNNEL_LABELS[row.status] || row.status}{row.recommendation && ` — ${row.recommendation}`}</td>
                  <td style={{ padding: '6px 8px', color: '#94A3B8' }}>{new Date(row.updated_at).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {row.status === 'completed' && row.recommendation === 'shortlist' && (
                      <button style={{ ...btn, padding: '4px 10px', fontSize: 11 }} disabled={invitingId === row.id} onClick={() => sendInterviewInvite(row)}>
                        {invitingId === row.id ? 'Sending...' : 'Send interview invite'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!sessions.length && (
                <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#94A3B8' }}>No screening activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#94A3B8' }}>
        Requires your own WhatsApp number connected under Settings → WhatsApp before enrolling — messages send
        from your own number, paced automatically within business hours (Mon–Sat, 9AM–7PM IST).
      </div>
    </div>
  );
}
