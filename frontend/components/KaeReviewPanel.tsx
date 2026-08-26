'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

// KAE Review Queue (2026-08-26) — when 2+ recruiters each submit their own
// candidate for the SAME requisition, this is the one in-app place a KAE
// compares them: ranked by the real, already-computed AI JD Match Score
// (candidate_scores, scoped to this exact candidate+requisition pair — the
// same source the emailed tracking sheet's ai_jd_score column already
// used, no second scoring engine). Shortlisted/Not Selected is a soft
// marker only — it never blocks or auto-rejects the other candidates,
// since a role genuinely having 2+ real finalists is normal. Shared by
// both real surfaces: the requisition detail page's per-role home, and
// the /kae page's cross-role Review Queue tab.

function scoreBadgeStyle(score: number | null): React.CSSProperties {
  if (score == null) return { background: '#f1f5f9', color: '#94a3b8' };
  if (score >= 70) return { background: '#dcfce7', color: '#16a34a' };
  if (score >= 45) return { background: '#fef3c7', color: '#b45309' };
  return { background: '#fee2e2', color: '#dc2626' };
}

function SkillChips({ skills, kind }: { skills: string[]; kind: 'match' | 'miss' }) {
  if (!skills || skills.length === 0) return <span style={{ color: '#cbd5e1', fontSize: 11 }}>—</span>;
  const style: React.CSSProperties = kind === 'match'
    ? { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }
    : { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {skills.slice(0, 5).map((s, i) => (
        <span key={i} style={{ ...style, fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999 }}>
          {kind === 'match' ? '✓' : '✕'} {s}
        </span>
      ))}
      {skills.length > 5 && <span style={{ fontSize: 10, color: '#94a3b8' }}>+{skills.length - 5}</span>}
    </div>
  );
}

export default function KaeReviewPanel({ requisitionId, compact }: { requisitionId: string; compact?: boolean }) {
  const { data, loading, refetch } = useFetch<any>(`/kae/review-queue/${requisitionId}`);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setDecision(submissionId: string, decision: string | null) {
    setBusyId(submissionId);
    try {
      await apiFetch(`/candidate-submissions/${submissionId}/decision`, { method: 'PATCH', body: JSON.stringify({ decision }) });
      await refetch();
    } catch (e: any) { alert(e?.message || 'Failed to update decision'); }
    finally { setBusyId(null); }
  }

  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}><Loader2 size={14} className="animate-spin" style={{ display: 'inline' }} /> Loading submitted candidates…</div>;
  const candidates: any[] = data?.candidates || [];
  // Nothing submitted for this role yet — don't clutter the page with an
  // empty panel; this section only makes sense once there's something to
  // actually compare.
  if (candidates.length === 0) return null;

  return (
    <div data-testid="kae-review-panel" style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: 'white' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Submitted Candidates — KAE Review ({candidates.length})</div>
          {!compact && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Ranked by AI JD Match Score, best first — pick a Shortlist to record your decision (doesn't block the others).</div>}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#fafafa', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Candidate</th>
              <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Submitted By</th>
              <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>AI Match</th>
              {!compact && <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Matched Skills</th>}
              {!compact && <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Missing Skills</th>}
              <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Stage</th>
              <th style={{ padding: '8px 12px', color: '#64748b', fontWeight: 600 }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => (
              <tr key={c.submission_id} style={{
                borderTop: '1px solid #f1f5f9',
                background: c.kae_decision === 'shortlisted' ? '#f0fdf4' : c.kae_decision === 'not_selected' ? '#fef2f2' : (i === 0 ? '#fffbeb' : 'white'),
              }}>
                <td style={{ padding: '8px 12px', fontWeight: 600, color: '#0f172a' }}>
                  <a href={`/candidates/${c.candidate_id}`} target="_blank" rel="noreferrer" style={{ color: '#0f172a', textDecoration: 'none' }}>{c.candidate_name}</a>
                  {i === 0 && !c.kae_decision && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#b45309' }}>TOP MATCH</span>}
                </td>
                <td style={{ padding: '8px 12px', color: '#475569' }}>{c.submitted_by_name || '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ ...scoreBadgeStyle(c.readiness_index), fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>
                    {c.readiness_index != null ? `${Math.round(c.readiness_index)}% (${c.readiness_grade || '—'})` : 'Not scored yet'}
                  </span>
                </td>
                {!compact && <td style={{ padding: '8px 12px', maxWidth: 220 }}><SkillChips skills={c.matched_skills} kind="match" /></td>}
                {!compact && <td style={{ padding: '8px 12px', maxWidth: 220 }}><SkillChips skills={c.missing_skills} kind="miss" /></td>}
                <td style={{ padding: '8px 12px', color: '#475569' }}>{c.current_stage ? c.current_stage.replace(/_/g, ' ') : '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      disabled={busyId === c.submission_id}
                      onClick={() => setDecision(c.submission_id, c.kae_decision === 'shortlisted' ? null : 'shortlisted')}
                      title="Shortlisted is a soft marker — it never blocks the other candidates"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 6, cursor: busyId === c.submission_id ? 'not-allowed' : 'pointer',
                        border: c.kae_decision === 'shortlisted' ? '1px solid #16a34a' : '1px solid #e2e8f0',
                        background: c.kae_decision === 'shortlisted' ? '#16a34a' : 'white',
                        color: c.kae_decision === 'shortlisted' ? 'white' : '#374151',
                      }}>
                      <CheckCircle2 size={12} /> {c.kae_decision === 'shortlisted' ? 'Shortlisted' : 'Shortlist'}
                    </button>
                    <button
                      disabled={busyId === c.submission_id}
                      onClick={() => setDecision(c.submission_id, c.kae_decision === 'not_selected' ? null : 'not_selected')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 6, cursor: busyId === c.submission_id ? 'not-allowed' : 'pointer',
                        border: c.kae_decision === 'not_selected' ? '1px solid #dc2626' : '1px solid #e2e8f0',
                        background: c.kae_decision === 'not_selected' ? '#dc2626' : 'white',
                        color: c.kae_decision === 'not_selected' ? 'white' : '#374151',
                      }}>
                      <XCircle size={12} /> {c.kae_decision === 'not_selected' ? 'Not Selected' : 'Pass'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
