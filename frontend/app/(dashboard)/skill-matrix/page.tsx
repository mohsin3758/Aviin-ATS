'use client';

import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { EditableCell } from '@/components/sourcing-tracker/EditableCell';
import { ProjectDetailsCell } from '@/components/sourcing-tracker/ProjectDetailsCell';
import { MessageCircle, Plus } from 'lucide-react';

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
// Follow-up (same day, live screenshot of the working page): make
// Name/Mobile/Total Exp editable too, add a Sl No column, let a
// recruiter add a new candidate row or a new skill column directly from
// this page (auto-saving on every entry, same as the rest of the grid),
// and surface "how recruiters are working this role" -- a recruiter
// column plus a per-role summary strip, reusing applications.
// assigned_recruiter_id (the same field/JOIN the Kanban pipeline uses
// for role-scoped attribution) rather than building a separate report
// page. A fuller, cross-role recruiter productivity view already exists
// at Recruiter Tracking (Snapshot/Trend) -- this is the role-scoped
// summary specifically for what's on screen here.
//
// Backend: GET /requisitions/{id}/skill-matrix (candidates already
// linked to the role, one years_experience number per mandatory skill,
// and the assigned recruiter's name), PATCH /candidates/{id}/skill-years
// (the one clean way to set a single skill's years, from either this
// page or screening_extraction.py), PATCH /requisitions/{id} (reused
// as-is to append a new skill to mandatory_skills), POST /candidates +
// POST /applications (reused as-is for the inline add-row form).

const selSm: React.CSSProperties = { padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, background: '#fff' };
const th: React.CSSProperties = { padding: '8px 10px', background: '#1E3A8A', color: '#fff', textAlign: 'left', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', fontSize: 12, whiteSpace: 'nowrap' };
const inputSm: React.CSSProperties = { padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, width: '100%', boxSizing: 'border-box' };

export default function SkillMatrixPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [clientId, setClientId] = useState('');
  const [reqId, setReqId] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [savingRow, setSavingRow] = useState(false);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newSkill, setNewSkill] = useState('');
  const [savingColumn, setSavingColumn] = useState(false);

  // Table filters (2026-09-19, live request) -- the dataset behind one
  // role is small (candidates already linked to it), so these filter the
  // already-fetched rows client-side rather than adding new backend
  // query params; the summary strip below still reflects the filtered
  // set, not the unfiltered total, so it stays honest about what's on
  // screen.
  const [filterRemarks, setFilterRemarks] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterCtcMin, setFilterCtcMin] = useState('');
  const [filterCtcMax, setFilterCtcMax] = useState('');
  const [filterExpCtcMin, setFilterExpCtcMin] = useState('');
  const [filterExpCtcMax, setFilterExpCtcMax] = useState('');

  const { data: clients } = useFetch<any[]>(mounted ? '/clients' : null);
  const { data: reqs } = useFetch<any[]>(mounted && clientId ? `/requisitions?client_id=${clientId}&status=open` : null);
  const { data: matrix, loading, refetch } = useFetch<any>(mounted && reqId ? `/requisitions/${reqId}/skill-matrix` : null);

  const skills: string[] = matrix?.skills || [];
  const allCandidates: any[] = matrix?.candidates || [];
  const anyFilterActive = !!(filterRemarks || filterLocation || filterCtcMin || filterCtcMax || filterExpCtcMin || filterExpCtcMax);
  const candidates = allCandidates.filter(c => {
    if (filterRemarks && !(c.remarks || '').toLowerCase().includes(filterRemarks.toLowerCase())) return false;
    if (filterLocation && !(c.location || '').toLowerCase().includes(filterLocation.toLowerCase())) return false;
    if (filterCtcMin && !(c.current_ctc != null && c.current_ctc >= Number(filterCtcMin))) return false;
    if (filterCtcMax && !(c.current_ctc != null && c.current_ctc <= Number(filterCtcMax))) return false;
    if (filterExpCtcMin && !(c.expected_ctc != null && c.expected_ctc >= Number(filterExpCtcMin))) return false;
    if (filterExpCtcMax && !(c.expected_ctc != null && c.expected_ctc <= Number(filterExpCtcMax))) return false;
    return true;
  });

  // Role-scoped "how recruiters are working this role" summary --
  // grouped straight from the same (filtered) rows already on screen, no
  // extra fetch. Unassigned candidates group under "Unassigned" rather
  // than silently vanishing from the count.
  const byRecruiter: Record<string, number> = {};
  candidates.forEach(c => { const k = c.recruiter_name || 'Unassigned'; byRecruiter[k] = (byRecruiter[k] || 0) + 1; });

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
      throw e; // let EditableCell show its own inline error too (e.g. bad phone format)
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

  async function addRow() {
    if (!newName.trim()) { showToast('Name is required', false); return; }
    setSavingRow(true);
    try {
      const created = await apiFetch('/candidates', {
        method: 'POST',
        body: JSON.stringify({ full_name: newName.trim(), phone: newPhone.trim() || undefined, source: 'manual' }),
      });
      // Auto-link to the role already selected on this page -- unlike the
      // Sourcing Tracker's Quick Add, no client/role picker is needed
      // here, since the whole page is already scoped to one.
      try {
        await apiFetch('/applications', { method: 'POST', body: JSON.stringify({ candidate_id: created.id, requisition_id: reqId }) });
      } catch { /* 409 = already linked, harmless */ }
      setNewName(''); setNewPhone(''); setAddingRow(false);
      refetch();
      showToast('Candidate added');
    } catch (e: any) {
      showToast(e?.message || 'Could not add candidate', false);
    } finally {
      setSavingRow(false);
    }
  }

  async function addColumn() {
    const skill = newSkill.trim();
    if (!skill) return;
    if (skills.some(s => s.toLowerCase() === skill.toLowerCase())) {
      showToast('That skill column already exists', false);
      return;
    }
    setSavingColumn(true);
    try {
      // Appends to the role's real mandatory_skills -- not a display-only
      // column. That's deliberate: it's the same list WhatsApp screening
      // already reads to generate its skill questions, so a newly added
      // column is immediately askable over WhatsApp too, not just a local
      // label on this page.
      await apiFetch(`/requisitions/${reqId}`, {
        method: 'PATCH', body: JSON.stringify({ mandatory_skills: [...skills, skill] }),
      });
      setNewSkill(''); setAddingColumn(false);
      refetch();
      showToast(`Added "${skill}" as a tracked skill for this role`);
    } catch (e: any) {
      showToast(e?.message || 'Could not add skill column', false);
    } finally {
      setSavingColumn(false);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>Skill Matrix</h1>
        <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
          One column per mandatory skill for the selected role — type a number to fill it manually, or send screening questions over WhatsApp and this fills in automatically once the candidate replies. Every cell saves the moment you leave it.
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

      {reqId && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input placeholder="Filter: Remarks contains…" value={filterRemarks} onChange={e => setFilterRemarks(e.target.value)} style={{ ...selSm, width: 170 }} />
          <input placeholder="Filter: Location contains…" value={filterLocation} onChange={e => setFilterLocation(e.target.value)} style={{ ...selSm, width: 170 }} />
          <input placeholder="Current CTC min" type="number" value={filterCtcMin} onChange={e => setFilterCtcMin(e.target.value)} style={{ ...selSm, width: 120 }} />
          <input placeholder="Current CTC max" type="number" value={filterCtcMax} onChange={e => setFilterCtcMax(e.target.value)} style={{ ...selSm, width: 120 }} />
          <input placeholder="Expected CTC min" type="number" value={filterExpCtcMin} onChange={e => setFilterExpCtcMin(e.target.value)} style={{ ...selSm, width: 120 }} />
          <input placeholder="Expected CTC max" type="number" value={filterExpCtcMax} onChange={e => setFilterExpCtcMax(e.target.value)} style={{ ...selSm, width: 120 }} />
          {anyFilterActive && (
            <button onClick={() => { setFilterRemarks(''); setFilterLocation(''); setFilterCtcMin(''); setFilterCtcMax(''); setFilterExpCtcMin(''); setFilterExpCtcMax(''); }}
              style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>✕ Clear filters</button>
          )}
        </div>
      )}

      {!reqId && (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12, border: '1px dashed #e2e8f0', borderRadius: 10 }}>
          Pick a client and role to see its skill matrix.
        </div>
      )}

      {reqId && (
        <>
          {!loading && allCandidates.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12 }}>
              <b>{candidates.length} candidate{candidates.length === 1 ? '' : 's'} sourced for this role{anyFilterActive ? ` (of ${allCandidates.length} total)` : ''}</b>
              <span style={{ color: '#64748b' }}>
                {Object.entries(byRecruiter).map(([name, count], i) => (
                  <span key={name}>{i > 0 ? ' · ' : ''}{name}: {count}</span>
                ))}
              </span>
            </div>
          )}

          {skills.length === 0 && !loading && (
            <div style={{ padding: 12, marginBottom: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
              This role has no mandatory skills set yet — add one below to see its column here.
            </div>
          )}

          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 40 }}>Sl No</th>
                  <th style={th}>Name</th>
                  <th style={th}>Mobile</th>
                  <th style={th}>Total Exp (mo)</th>
                  <th style={th}>Location</th>
                  {skills.map(s => <th key={s} style={{ ...th, minWidth: 140, whiteSpace: 'normal' }}>{s}</th>)}
                  <th style={{ ...th, minWidth: 110 }}>
                    {addingColumn ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input autoFocus value={newSkill} onChange={e => setNewSkill(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') setAddingColumn(false); }}
                          placeholder="Skill name" style={{ ...inputSm, color: '#0f172a', fontWeight: 400 }} />
                        <button onClick={addColumn} disabled={savingColumn} style={{ border: 'none', background: '#16a34a', color: '#fff', borderRadius: 5, padding: '0 8px', cursor: 'pointer' }}>✓</button>
                      </div>
                    ) : (
                      <button onClick={() => setAddingColumn(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px dashed rgba(255,255,255,0.5)', background: 'transparent', color: '#fff', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                        <Plus size={11} /> Add Skill
                      </button>
                    )}
                  </th>
                  <th style={th}>Project Details</th>
                  <th style={th}>Current CTC</th>
                  <th style={th}>Expected CTC</th>
                  <th style={th}>Remarks</th>
                  <th style={th}>Recruiter</th>
                  <th style={th}>WhatsApp</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={c.id}>
                    <td style={{ ...td, color: '#94a3b8' }}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 700, minWidth: 130 }}>
                      <EditableCell value={c.full_name || ''} onSave={v => saveField(c.id, 'full_name', v)} />
                    </td>
                    <td style={{ ...td, minWidth: 120 }}>
                      <EditableCell value={c.phone || ''} placeholder="Mobile" onSave={v => saveField(c.id, 'phone', v || null)} />
                    </td>
                    <td style={{ ...td, minWidth: 90 }}>
                      <EditableCell value={c.total_exp_mo != null ? String(c.total_exp_mo) : ''} variant="number" placeholder="—"
                        onSave={v => saveField(c.id, 'total_exp_mo', v === '' ? null : Number(v))} />
                    </td>
                    <td style={{ ...td, minWidth: 110 }}>
                      <EditableCell value={c.location || ''} placeholder="Location" onSave={v => saveField(c.id, 'location', v || null)} />
                    </td>
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
                    <td style={td} />
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
                    <td style={{ ...td, color: c.recruiter_name ? '#374151' : '#cbd5e1' }}>{c.recruiter_name || 'Unassigned'}</td>
                    <td style={td}>
                      <button onClick={() => sendViaWhatsApp(c.id)} disabled={sendingId === c.id}
                        title="Send the screening questions (including these skills) over WhatsApp"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 7, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#166534', fontSize: 11, fontWeight: 700, cursor: sendingId === c.id ? 'default' : 'pointer' }}>
                        <MessageCircle size={12} /> {sendingId === c.id ? 'Sending…' : 'Send'}
                      </button>
                    </td>
                  </tr>
                ))}

                {addingRow ? (
                  <tr style={{ background: '#f8fafc' }}>
                    <td style={td}>{candidates.length + 1}</td>
                    <td style={td}>
                      <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addRow(); if (e.key === 'Escape') setAddingRow(false); }}
                        placeholder="Name" style={inputSm} />
                    </td>
                    <td style={td}>
                      <input value={newPhone} onChange={e => setNewPhone(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addRow(); if (e.key === 'Escape') setAddingRow(false); }}
                        placeholder="Mobile" style={inputSm} />
                    </td>
                    <td colSpan={skills.length + 9} style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button onClick={addRow} disabled={savingRow} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', fontSize: 11, fontWeight: 700, cursor: savingRow ? 'default' : 'pointer', marginRight: 6 }}>
                        {savingRow ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => { setAddingRow(false); setNewName(''); setNewPhone(''); }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td colSpan={skills.length + 12} style={{ padding: 8 }}>
                      <button onClick={() => setAddingRow(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px dashed #cbd5e1', background: 'transparent', color: '#2563eb', borderRadius: 7, padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                        <Plus size={13} /> Add Row
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {loading && <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading…</div>}
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
