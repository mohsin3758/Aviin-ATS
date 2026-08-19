'use client';
import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { API } from '@/lib/auth';
import { ArrowLeft, Download, FileText, ChevronDown, TrendingUp } from 'lucide-react';

// Real gap fix (2026-08-20): the candidate profile's "Resume Extract" panel
// was hard-truncated to 240px with no way to review a full resume manually
// alongside a JD match. This page shows the complete, untruncated resume
// text with matched-skill highlighting against whichever requisition score
// is selected, and the missing-skill list right next to it - a manual
// review surface, not a new parsing/matching engine (reuses the exact
// matched_skills/missing_skills already computed by GET /candidates/{id}).

async function downloadResume(fileId: string, fileName: string) {
  const token = localStorage.getItem('airecruit_token');
  try {
    const resp = await fetch(`${API}/resume-intake/${fileId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) { alert('Download failed: ' + resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName || 'resume';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e: any) {
    alert(e?.message || 'Download failed');
  }
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function highlightMatched(text: string, matched: string[]): React.ReactNode {
  if (!text) return text;
  const terms = (matched || []).filter(t => t && t.trim().length > 1);
  if (terms.length === 0) return text;
  const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const re = new RegExp('(' + sorted.map(escapeRe).join('|') + ')', 'gi');
  const lowerSet = new Set(sorted.map(s => s.toLowerCase()));
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (lowerSet.has(part.toLowerCase())) {
      return (
        <mark key={i} style={{ background: '#bbf7d0', color: '#166534', padding: '0 2px', borderRadius: '3px', fontWeight: 700 }}>
          {part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function CandidateResumeFullPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: candidate, loading } = useFetch<any>(id ? `/candidates/${id}` : null);
  const [scoreIdx, setScoreIdx] = useState(0);
  const [matching, setMatching] = useState(false);
  const [matchNote, setMatchNote] = useState('');

  const scores: any[] = Array.isArray(candidate?.ai_scores) ? candidate.ai_scores : [];
  const active = scores[scoreIdx] || null;

  async function matchOpenJobs() {
    if (!id) return;
    setMatching(true);
    setMatchNote('');
    try {
      const r = await apiFetch(`/candidates/${id}/match-open-jobs`, { method: 'POST' });
      setMatchNote(r.matched > 0 ? `Matched ${r.matched} open requisition${r.matched > 1 ? 's' : ''} — reload to see updated scores.` : 'No open requisitions to match against right now.');
    } catch (e: any) {
      alert(e?.message || 'Job matching failed');
    } finally {
      setMatching(false);
    }
  }

  const highlighted = useMemo(
    () => highlightMatched(candidate?.resume_text || '', active?.matched_skills || []),
    [candidate?.resume_text, active]
  );

  if (loading) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>Loading resume…</div>
  );
  if (!candidate || candidate.error) return (
    <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>Candidate not found.</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1100px' }}>
      <button onClick={() => router.push(`/candidates/${id}`)}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '13px', padding: 0, width: 'fit-content' }}>
        <ArrowLeft size={15} /> Back to {candidate.full_name}'s Profile
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0 }}>{candidate.full_name} — Full Resume</h1>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '2px 0 0' }}>
            Manual review view — complete extracted text, matched skills highlighted below.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {candidate.latest_resume_file_id && (
            <button onClick={() => downloadResume(candidate.latest_resume_file_id, candidate.latest_resume_file_name)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: '#1e40af' }}>
              <Download size={13} /> Download Original
            </button>
          )}
          <button onClick={matchOpenJobs} disabled={matching}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', border: 'none', background: matching ? '#94a3b8' : '#0891b2', color: 'white', cursor: matching ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '600' }}>
            <TrendingUp size={13} /> {matching ? 'Matching…' : 'Match Against Open Jobs'}
          </button>
        </div>
      </div>

      {matchNote && (
        <div style={{ fontSize: '12px', color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '8px', padding: '10px 14px' }}>
          {matchNote}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: scores.length > 0 ? '1fr 300px' : '1fr', gap: '16px', alignItems: 'flex-start' }}>
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px' }}>
          {candidate.resume_text ? (
            <pre data-testid="full-resume-text" style={{ fontSize: '13px', color: '#374151', lineHeight: '1.75', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
              {highlighted}
            </pre>
          ) : (
            <p style={{ color: '#94a3b8', fontSize: '13px' }}>No extracted resume text on file for this candidate.</p>
          )}
        </div>

        {scores.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'sticky', top: '16px' }}>
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                Comparing Against
              </div>
              {scores.length > 1 ? (
                <div style={{ position: 'relative' }}>
                  <select value={scoreIdx} onChange={e => setScoreIdx(Number(e.target.value))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', appearance: 'none', cursor: 'pointer' }}>
                    {scores.map((s, i) => (
                      <option key={i} value={i}>{s.requisition_title || 'Standalone score'} ({Math.round(s.readiness_index || 0)}%)</option>
                    ))}
                  </select>
                  <ChevronDown size={13} style={{ position: 'absolute', right: '10px', top: '10px', color: '#94a3b8', pointerEvents: 'none' }} />
                </div>
              ) : (
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{active?.requisition_title || 'Standalone score'}</div>
              )}
            </div>

            {active && (
              <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px' }}>
                <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                  <div style={{ fontSize: '32px', fontWeight: '900', color: active.readiness_index >= 80 ? '#16a34a' : active.readiness_index >= 60 ? '#0891b2' : active.readiness_index >= 40 ? '#d97706' : '#dc2626' }}>
                    {Math.round(active.readiness_index || 0)}%
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700' }}>Grade {active.readiness_grade || '—'}</div>
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                  <div>Skills {Math.round(active.skill_match_score || 0)}%</div>
                  <div>Experience {Math.round(active.experience_score || 0)}%</div>
                  <div>Stability {Math.round(active.stability_score || 0)}%</div>
                  <div>Education {Math.round(active.education_score || 0)}%</div>
                </div>
                {active.matched_skills?.length > 0 && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontSize: '10px', fontWeight: '700', color: '#166534', marginBottom: '4px' }}>MATCHED ({active.matched_skills.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {active.matched_skills.map((sk: string) => (
                        <span key={sk} style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: '#dcfce7', color: '#166534', fontWeight: '600' }}>✓ {sk}</span>
                      ))}
                    </div>
                  </div>
                )}
                {active.missing_skills?.length > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', fontWeight: '700', color: '#991b1b', marginBottom: '4px' }}>MISSING ({active.missing_skills.length})</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {active.missing_skills.map((sk: string) => (
                        <span key={sk} style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: '#fee2e2', color: '#991b1b', fontWeight: '600' }}>✕ {sk}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
