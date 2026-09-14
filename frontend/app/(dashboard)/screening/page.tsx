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

const LANGUAGES: Record<string, string> = {
  en: 'English', hi: 'हिन्दी (Hindi)', ta: 'தமிழ் (Tamil)', te: 'తెలుగు (Telugu)',
  kn: 'ಕನ್ನಡ (Kannada)', ml: 'മലയാളം (Malayalam)', mr: 'मराठी (Marathi)', gu: 'ગુજરાતી (Gujarati)',
  pa: 'ਪੰਜਾਬੀ (Punjabi)', bn: 'বাংলা (Bengali)', or: 'ଓଡ଼ିଆ (Odia)', as: 'অসমীয়া (Assamese)',
  ur: 'اردو (Urdu)', kok: 'कोंकणी (Konkani)',
};

const FUNNEL_LABELS: Record<string, string> = {
  pending_optin: 'Pending opt-in', sent: 'Sent, awaiting reply', awaiting_screening: 'Consented',
  in_progress: 'Answering questions', awaiting_resume: 'Awaiting resume', completed: 'Completed',
  declined: 'Declined', opted_out: 'Opted out', no_response: 'No response', bad_number: 'Bad number',
};

export default function ScreeningPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data: reqs } = useFetch<any[]>(mounted ? '/requisitions?status=open' : null);
  const [requisitionId, setRequisitionId] = useState('');
  const [language, setLanguage] = useState('en');
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [testSending, setTestSending] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: preview } = useFetch<any>(requisitionId ? `/screening/questions-preview?requisition_id=${requisitionId}&language=${language}` : null);
  const previewQuestions: string[] = preview?.questions || [];

  const { data: drillIn } = useFetch<any>(expandedId ? `/screening/sessions/${expandedId}` : null);

  const { data: summary, refetch: refetchSummary } = useFetch<any>(mounted ? '/screening/summary?mine=true' : null);
  const funnel = summary?.funnel || {};
  const numberHealth: any[] = summary?.number_health || [];
  const numberHealthAlerts = numberHealth.filter((h: any) => h.quality_rating !== 'green');
  const { data: sessionsData, refetch: refetchSessions } = useFetch<any>(mounted ? '/screening/sessions?mine=true' : null);
  const sessions = sessionsData?.sessions || [];
  const [invitingId, setInvitingId] = useState<string | null>(null);

  // Gap #8 (red-number failover): reassigning STUCK (pending_optin, never-
  // yet-contacted) candidates to a healthy number is only meaningful with
  // visibility into OTHER recruiters' numbers, which /user-whatsapp/team-
  // overview deliberately restricts to admin/manager/super_admin -- a
  // plain recruiter's own account is usually their only one anyway.
  const role = mounted ? getTokenPayload()?.role : null;
  const canReassign = ['admin', 'super_admin', 'manager'].includes(role || '');
  const hasStuckRed = numberHealthAlerts.some((h: any) => h.quality_rating === 'red' && h.pending_count > 0);
  const { data: teamAccounts } = useFetch<any>(canReassign && hasStuckRed ? '/user-whatsapp/team-overview' : null);
  const reassignTargets: any[] = (teamAccounts?.accounts || []).filter((a: any) => a.status === 'working');
  const [reassignPick, setReassignPick] = useState<Record<string, string>>({});
  const [reassigning, setReassigning] = useState<string | null>(null);

  async function reassignPending(fromId: string) {
    const toId = reassignPick[fromId];
    if (!toId) { alert('Pick a number to move these candidates to first'); return; }
    setReassigning(fromId);
    try {
      const res = await apiFetch('/screening/reassign-pending', {
        method: 'POST',
        body: JSON.stringify({ from_whatsapp_account_id: fromId, to_whatsapp_account_id: toId }),
      });
      alert(`Moved ${res.moved} candidate(s) — they'll be opted in from the new number on the next dispatch cycle.`);
      refetchSummary();
    } catch (e: any) {
      alert(e.message || 'Reassign failed');
    } finally {
      setReassigning(null);
    }
  }

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
          language,
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
      const res = await apiFetch('/screening/test-send', {
        method: 'POST',
        body: JSON.stringify({ requisition_id: requisitionId, language }),
      });
      alert(res.sent
        ? `Sent to your own WhatsApp number — the opt-in message plus all ${res.question_count} question(s).`
        : 'Could not deliver — check your WhatsApp connection under Settings.');
    } catch (e: any) {
      alert(e.message || 'Test send failed');
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

      {numberHealthAlerts.map((h: any, i: number) => {
        const isRed = h.quality_rating === 'red';
        const style = isRed
          ? { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B' }
          : { background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E' };
        return (
          <div key={i} style={{ ...style, borderRadius: 8, padding: '8px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.03em', padding: '2px 8px', borderRadius: 999, background: isRed ? '#DC2626' : '#D97706', color: '#fff' }}>
              {h.quality_rating}
            </span>
            <span style={{ flex: 1 }}>
              {h.phone_number} — reply rate {Math.round((h.reply_rate || 0) * 100)}%, opt-out rate {Math.round((h.optout_rate || 0) * 100)}%.
              {isRed ? ' Automatically paused from sending new opt-ins until reviewed.' : ' Still sending, worth watching.'}
              {isRed && h.pending_count > 0 && ` ${h.pending_count} candidate(s) waiting to be contacted.`}
            </span>
            {isRed && h.pending_count > 0 && canReassign && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  style={{ ...inputSm, width: 160, fontSize: 11 }}
                  value={reassignPick[h.id] || ''}
                  onChange={e => setReassignPick(prev => ({ ...prev, [h.id]: e.target.value }))}
                >
                  <option value="">Move to number...</option>
                  {reassignTargets.filter((a: any) => a.id !== h.id).map((a: any) => (
                    <option key={a.id} value={a.id}>{a.full_name} ({a.phone_number || 'unconnected'})</option>
                  ))}
                </select>
                <button
                  style={{ ...btn, padding: '4px 10px', fontSize: 11 }}
                  disabled={reassigning === h.id}
                  onClick={() => reassignPending(h.id)}
                >
                  {reassigning === h.id ? 'Moving...' : 'Reassign'}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        {Object.keys(FUNNEL_LABELS).map(key => (
          <div key={key} style={card}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>{funnel[key] || 0}</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>{FUNNEL_LABELS[key]}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={label}>Role</label>
            <select style={inputSm} value={requisitionId} onChange={e => setRequisitionId(e.target.value)}>
              <option value="">Select an open role...</option>
              {(reqs || []).map((r: any) => (
                <option key={r.id} value={r.id}>{r.title}{r.client_name ? ` — ${r.client_name}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>Question language</label>
            <select style={inputSm} value={language} onChange={e => setLanguage(e.target.value)}>
              {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </div>
        </div>

        {requisitionId && (
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 12, background: '#F8FAFC', borderRadius: 8, padding: '8px 10px' }}>
            {previewQuestions.length ? (
              <>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Questions this role will ask (after YES):</div>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {previewQuestions.map((q, i) => <li key={i}>{q}</li>)}
                </ol>
              </>
            ) : 'No mandatory skills set on this role yet — screening would go straight to the resume request.'}
          </div>
        )}

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
                <>
                <tr key={row.id} style={{ borderTop: '1px solid #F1F5F9', cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                  <td style={{ padding: '6px 8px' }}>{row.full_name}<div style={{ color: '#94A3B8' }}>{row.phone}</div></td>
                  <td style={{ padding: '6px 8px' }}>{row.requisition_title}</td>
                  <td style={{ padding: '6px 8px' }}>{FUNNEL_LABELS[row.status] || row.status}{row.recommendation && ` — ${row.recommendation}`}</td>
                  <td style={{ padding: '6px 8px', color: '#94A3B8' }}>{new Date(row.updated_at).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px' }} onClick={e => e.stopPropagation()}>
                    {row.status === 'completed' && row.recommendation === 'shortlist' && (
                      <button style={{ ...btn, padding: '4px 10px', fontSize: 11 }} disabled={invitingId === row.id} onClick={() => sendInterviewInvite(row)}>
                        {invitingId === row.id ? 'Sending...' : 'Send interview invite'}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === row.id && (
                  <tr>
                    <td colSpan={5} style={{ padding: '10px 8px', background: '#F8FAFC' }}>
                      <div style={{ display: 'flex', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700 }}>
                          Current question: {drillIn?.session?.current_question_key || '—'}
                        </div>
                        {drillIn?.session?.csat_rating != null && (
                          <div style={{ color: '#0F172A' }}>
                            CSAT: <strong>{drillIn.session.csat_rating}/5</strong>
                          </div>
                        )}
                        {drillIn?.session?.followup_stage && drillIn.session.followup_stage !== 'done' && (
                          <div style={{ color: '#B45309' }}>
                            Follow-up in progress: {drillIn.session.followup_stage.replace('_', ' ')}
                          </div>
                        )}
                      </div>
                      {(drillIn?.answers || []).length ? (
                        <table style={{ width: '100%', fontSize: 11 }}>
                          <tbody>
                            {drillIn.answers.map((a: any, i: number) => (
                              <tr key={i}>
                                <td style={{ padding: '3px 6px', color: '#64748B', width: '40%' }}>{a.question_text}</td>
                                <td style={{ padding: '3px 6px' }}>{a.raw_answer}</td>
                                <td style={{ padding: '3px 6px', color: '#94A3B8' }}>{a.extraction_method}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <div style={{ color: '#94A3B8' }}>No answers captured yet.</div>}
                      {(drillIn?.referrals || []).length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>Referrals mentioned:</div>
                          <table style={{ width: '100%', fontSize: 11 }}>
                            <tbody>
                              {drillIn.referrals.map((r: any, i: number) => (
                                <tr key={i}>
                                  <td style={{ padding: '3px 6px', color: '#64748B', width: '30%' }}>
                                    {r.referred_name || '—'}{r.referred_phone ? ` (${r.referred_phone})` : ''}
                                  </td>
                                  <td style={{ padding: '3px 6px', color: '#94A3B8' }}>{r.raw_text}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </>
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
