'use client';

import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { EditableCell } from '@/components/sourcing-tracker/EditableCell';
import { ProjectDetailsCell } from '@/components/sourcing-tracker/ProjectDetailsCell';
import { MessageCircle } from 'lucide-react';

// Skill Matrix (2026-09-19, reported live against a real manual Google
// Sheet: one column per mandatory skill on a role, showing years of
// experience per candidate -- fillable manually, or picked up
// automatically once a candidate answers the matching WhatsApp
// screening question). Explicit decisions from that conversation:
// reuses the EXISTING full screening conversation rather than adding a
// new per-skill "ask now" send mechanism (this page just displays
// whichever skill_years answers have arrived, refreshing on demand);
// lives as its own page scoped to one role rather than folding into the
// Sourcing Tracker.
//
// Backend: GET /requisitions/{id}/skill-matrix (candidates already
// linked to the role + one years_experience number per mandatory skill),
// PATCH /candidates/{id}/skill-years (the one clean way to set a single
// skill's years, from either this page or screening_extraction.py).

const selSm: React.CSSProperties = { padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, background: '#fff' };
const th: React.CSSProperties = { padding: '8px 10px', background: '#1E3A8A', color: '#fff', textAlign: 'left', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', fontSize: 12, whiteSpace: 'nowrap' };

export default function SkillMatrixPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [clientId, setClientId] = useState('');
  const [reqId, setReqId] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const { data: clients } = useFetch<any[]>(mounted ? '/clients' : null);
  const { data: reqs } = useFetch<any[]>(mounted && clientId ? `/requisitions?client_id=${clientId}&status=open` : null);
  const { data: matrix, loading, refetch } = useFetch<any>(mounted && reqId ? `/requisitions/${reqId}/skill-matrix` : null);

  const skills: string[] = matrix?.skills || [];
  const candidates: any[] = matrix?.candidates || [];

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  async function saveYears(candidateId: string, skillName: string, value: string) {
    const years = value.trim() === '' ? null : Number(value);
    if (years !== null && Number.isNaN(years)) throw new Error('Enter a number');
    await apiFetch(`/candidates/${candidateId}/skill-years`, {
      method: 'PATCH', body: JSON.stringify({ skill_name: skillName, years_experience: years }),
    });
    refetch();
  }

  async function saveField(candidateId: string, field: string, value: any) {
    try {
      await apiFetch(`/candidates/${candidateId}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
      refetch();
    } catch (e: any) {
      showToast(e?.message || `Could not save ${field}`, false);
    }
  }

  async function sendViaWhatsApp(candidateId: string) {
    setSendingId(candidateId);
    try {
      const res = await apiFetch('/screening/enroll', {
        method: 'POST',
        body: JSON.stringify({ requisition_id: reqId, enrolled_via: 'bulk_select', rows: [{ candidate_id: candidateId }] }),
      });
      if (res.enrolled > 0) showToast('Screening questions sent over WhatsApp');
      else showToast(res.results?.[0]?.detail || 'Already screening or could not send', res.enrolled > 0);
    } catch (e: any) {
      showToast(e?.message || 'Could not send — connect your WhatsApp number under Settings first', false);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>Skill Matrix</h1>
        <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
          One column per mandatory skill for the selected role — type a number to fill it manually, or send screening questions over WhatsApp and this fills in automatically once the candidate replies.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={clientId} onChange={e => { setClientId(e.target.value); setReqId(''); }} style={selSm}>
          <option value="">Select Client…</option>
          {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={reqId} onChange={e => setReqId(e.target.value)} disabled={!clientId} style={selSm}>
          <option value="">Select Role…</option>
          {(reqs || []).map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      </div>

      {!reqId && (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12, border: '1px dashed #e2e8f0', borderRadius: 10 }}>
          Pick a client and role to see its skill matrix.
        </div>
      )}

      {reqId && (
        <>
          {skills.length === 0 && !loading && (
            <div style={{ padding: 12, marginBottom: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
              This role has no mandatory skills set yet — add them under the role's Skills section to see per-skill columns here.
            </div>
          )}
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={th}>Mobile</th>
                  <th style={th}>Total Exp (mo)</th>
                  {skills.map(s => <th key={s} style={{ ...th, minWidth: 140, whiteSpace: 'normal' }}>{s}</th>)}
                  <th style={th}>Project Details</th>
                  <th style={th}>Current CTC</th>
                  <th style={th}>Expected CTC</th>
                  <th style={th}>Remarks</th>
                  <th style={th}>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => (
                  <tr key={c.id}>
                    <td style={{ ...td, fontWeight: 700 }}>{c.full_name}</td>
                    <td style={td}>{c.phone || '—'}</td>
                    <td style={td}>{c.total_exp_mo ?? '—'}</td>
                    {skills.map(s => (
                      <td key={s} style={td}>
                        <EditableCell
                          value={c.skill_years?.[s] != null ? String(c.skill_years[s]) : ''}
                          variant="number"
                          placeholder="—"
                          onSave={v => saveYears(c.id, s, v)}
                        />
                      </td>
                    ))}
                    <td style={td}><ProjectDetailsCell candidateId={c.id} candidateName={c.full_name} /></td>
                    <td style={td}>
                      <EditableCell value={c.current_ctc != null ? String(c.current_ctc) : ''} variant="number" placeholder="—"
                        onSave={v => saveField(c.id, 'current_ctc', v === '' ? null : Number(v))} />
                    </td>
                    <td style={td}>
                      <EditableCell value={c.expected_ctc != null ? String(c.expected_ctc) : ''} variant="number" placeholder="—"
                        onSave={v => saveField(c.id, 'expected_ctc', v === '' ? null : Number(v))} />
                    </td>
                    <td style={{ ...td, minWidth: 150, whiteSpace: 'normal' }}>
                      <EditableCell value={c.remarks || ''} placeholder="Add a remark" onSave={v => saveField(c.id, 'remarks', v || null)} />
                    </td>
                    <td style={td}>
                      <button onClick={() => sendViaWhatsApp(c.id)} disabled={sendingId === c.id}
                        title="Send the screening questions (including these skills) over WhatsApp"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 7, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', fontSize: 11, fontWeight: 700, cursor: sendingId === c.id ? 'default' : 'pointer' }}>
                        <MessageCircle size={12} /> {sendingId === c.id ? 'Sending…' : 'Send'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading…</div>}
            {!loading && candidates.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No candidates linked to this role yet — assign some from the Sourcing Tracker first.</div>
            )}
          </div>
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, background: toast.ok ? '#16a34a' : '#ef4444', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, boxShadow: '0 6px 20px rgba(0,0,0,.15)', zIndex: 2000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
