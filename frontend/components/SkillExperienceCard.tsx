'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';

// Real gap fix (2026-08-30): Skill/Project Experience (built 2026-08-25 for
// the Add/Edit Candidate modal and the Candidates-list drawer) was never
// shown on either the Pipeline board's candidate drawer or the Resume
// Inbox drawer — two real, reported "not showing" complaints, both the
// identical root cause: the section simply didn't exist on those two
// surfaces. One shared component now covers both, plus a real "Paste &
// Parse" tool (recruiters often already have rich skill/experience detail
// typed as free text somewhere — a KAE-submission tracking sheet's own
// manual field, or literally copied from an email) — parses it into
// proposed rows for review before anything is saved, never a silent
// write, matching this project's established discipline.

interface Row {
  id?: string;
  skill_name: string;
  project_name?: string | null;
  duration_from?: string | null;
  duration_to?: string | null;
  role_types?: string[];
  relevant_experience?: string | null;
  last_used?: string | null;
  looks_like_experience?: boolean;
}

export default function SkillExperienceCard({ candidateId, canEdit = false }: { candidateId?: string; canEdit?: boolean }) {
  const { data, refetch } = useFetch<{ rows: Row[] }>(candidateId ? `/candidates/${candidateId}/skill-experience` : null);
  const rows: Row[] = data?.rows || [];

  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [proposed, setProposed] = useState<Row[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  if (!candidateId) return null;

  async function parseText() {
    if (!pasteText.trim()) return;
    setParsing(true); setMsg('');
    try {
      const res = await apiFetch('/candidates/skill-experience/parse-preview', {
        method: 'POST', body: JSON.stringify({ text: pasteText }),
      });
      setProposed((res.rows || []).map((r: Row) => ({ ...r })));
    } catch (e: any) { setMsg(String(e?.message || 'Parse failed')); }
    setParsing(false);
  }

  function removeProposed(i: number) {
    setProposed(rows => (rows || []).filter((_, idx) => idx !== i));
  }

  async function saveProposed() {
    if (!proposed || proposed.length === 0) return;
    setSaving(true); setMsg('');
    try {
      const body = proposed.map(r => ({
        skill_name: r.skill_name, relevant_experience: r.relevant_experience || null,
        project_name: null, duration_from: null, duration_to: null, role_types: [], last_used: null,
      }));
      await apiFetch(`/candidates/${candidateId}/skill-experience/append`, { method: 'POST', body: JSON.stringify(body) });
      setMsg(`✓ Added ${body.length} row(s)`);
      setProposed(null); setPasteText(''); setShowPaste(false);
      refetch();
    } catch (e: any) { setMsg(String(e?.message || 'Save failed')); }
    setSaving(false);
  }

  return (
    <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: rows.length ? 8 : 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Skill / Project Experience {rows.length > 0 ? `(${rows.length})` : ''}
        </div>
        {canEdit && (
          <button onClick={() => setShowPaste(s => !s)}
            style={{ fontSize: 10, fontWeight: 700, color: '#1E40AF', background: 'none', border: 'none', cursor: 'pointer' }}>
            {showPaste ? 'Cancel' : '+ Paste & Parse'}
          </button>
        )}
      </div>

      {rows.length === 0 && !showPaste && (
        <div style={{ fontSize: 11, color: '#94A3B8' }}>No skill / project experience recorded yet.</div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                <th style={{ padding: '5px 7px' }}>Skill</th>
                <th style={{ padding: '5px 7px' }}>Project</th>
                <th style={{ padding: '5px 7px' }}>Duration</th>
                <th style={{ padding: '5px 7px' }}>Role</th>
                <th style={{ padding: '5px 7px' }}>Rel. Exp.</th>
                <th style={{ padding: '5px 7px' }}>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id || i} style={{ borderTop: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '5px 7px', fontWeight: 700, color: '#1E40AF' }}>{r.skill_name}</td>
                  <td style={{ padding: '5px 7px' }}>{r.project_name || '—'}</td>
                  <td style={{ padding: '5px 7px' }}>{[r.duration_from, r.duration_to].filter(Boolean).join(' – ') || '—'}</td>
                  <td style={{ padding: '5px 7px' }}>{(r.role_types || []).join(' & ') || '—'}</td>
                  <td style={{ padding: '5px 7px' }}>{r.relevant_experience || '—'}</td>
                  <td style={{ padding: '5px 7px' }}>{r.last_used || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && showPaste && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #E2E8F0' }}>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 6 }}>
            Paste a tracking-sheet cell, an email, or any "Skill: N Yrs" style text — each line becomes a proposed row below for you to review before saving.
          </div>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5}
            placeholder={'Fico Exp: 7.6 Yrs\nHana: 6 Yrs\nECC: 6 Yrs'}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', marginBottom: 8 }} />
          <button onClick={parseText} disabled={parsing || !pasteText.trim()}
            style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: pasteText.trim() ? '#1E40AF' : '#94A3B8', color: '#fff', fontSize: 11, fontWeight: 700, cursor: pasteText.trim() ? 'pointer' : 'not-allowed' }}>
            {parsing ? 'Parsing…' : 'Parse'}
          </button>

          {proposed && (
            <div style={{ marginTop: 10 }}>
              {proposed.length === 0 ? (
                <div style={{ fontSize: 11, color: '#94A3B8' }}>No "Label: Value" lines found in that text.</div>
              ) : (
                <>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>
                    Proposed rows — remove any that aren't real skills:
                  </div>
                  {proposed.map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, background: r.looks_like_experience ? '#F0FDF4' : '#FFFBEB', marginBottom: 4 }}>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: '#1E293B' }}>{r.skill_name}</span>
                      <span style={{ fontSize: 11, color: '#64748B' }}>{r.relevant_experience}</span>
                      {!r.looks_like_experience && <span style={{ fontSize: 9, color: '#B45309' }}>not a Yrs value — check</span>}
                      <button onClick={() => removeProposed(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontWeight: 700, fontSize: 13 }}>×</button>
                    </div>
                  ))}
                  <button onClick={saveProposed} disabled={saving || proposed.length === 0}
                    style={{ marginTop: 6, padding: '6px 12px', borderRadius: 7, border: 'none', background: '#16A34A', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    {saving ? 'Saving…' : `Add ${proposed.length} row(s)`}
                  </button>
                </>
              )}
            </div>
          )}
          {msg && <div style={{ fontSize: 11, color: msg.startsWith('✓') ? '#16A34A' : '#DC2626', marginTop: 6 }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
