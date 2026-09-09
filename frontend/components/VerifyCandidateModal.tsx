'use client';
import { useFetch } from '@/lib/useFetch';
import { X, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

// REAL FEATURE (2026-09-09, Skill Verification Panel — the roadmap at
// https://claude.ai/code/artifact/86b41cc7-ffc4-44cb-8fb1-016210c75683).
// This is the "Verify Candidate" one-click action (item 7): a single
// panel over GET /candidates/{id}/skill-verification, which already
// bundles every earlier phase (mandatory coverage, per-skill counts,
// Skills/Experience/Projects evidence, auto-computed relevant
// experience, role relevance, and the final shortlist/reject
// recommendation from services/shortlist_rules.py) into one response —
// nothing new to fetch here, just presenting it the way a recruiter
// would actually read it.

interface Props {
  candidateId: string;
  requisitionId: string;
  onClose: () => void;
}

export function VerifyCandidateModal({ candidateId, requisitionId, onClose }: Props) {
  const { data, loading } = useFetch<any>(
    `/candidates/${candidateId}/skill-verification?requisition_id=${requisitionId}`
  );

  const shortlisted = data?.shortlist?.recommendation === 'shortlist';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ width: 640, maxWidth: '95vw', maxHeight: '88vh', background: '#fff', borderRadius: 14, boxShadow: '0 24px 64px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1E293B' }}>Verify Candidate</div>
            <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 2 }}>
              {data ? <>{data.candidate_name} vs. <b style={{ color: '#475569' }}>{data.requisition_title}</b></> : 'Loading…'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94A3B8' }}><X size={14} /></button>
        </div>

        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 13, padding: 40 }}>
              <Loader2 size={18} className="animate-spin" /><div style={{ marginTop: 8 }}>Checking mandatory skills, evidence, and experience…</div>
            </div>
          )}
          {data && !loading && (
            <>
              {/* Final recommendation — the whole point of this panel */}
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 10, marginBottom: 16,
                background: shortlisted ? '#f0fdf4' : '#fef2f2', border: `1px solid ${shortlisted ? '#bbf7d0' : '#fecaca'}`,
              }}>
                {shortlisted ? <CheckCircle2 size={22} color="#16a34a" style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={22} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: shortlisted ? '#166534' : '#991b1b' }}>
                    {shortlisted ? 'Recommended for Shortlisting' : 'Not Recommended'}
                  </div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: shortlisted ? '#166534' : '#991b1b', lineHeight: 1.7 }}>
                    {(data.shortlist?.reasons || []).map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              </div>

              {/* Mandatory coverage strip */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', marginBottom: 14, fontSize: 12, fontWeight: 700, color: '#475569' }}>
                <span>Mandatory Skills: {data.mandatory_coverage.mandatory_found.length}/{data.mandatory_coverage.mandatory_total} found</span>
                <span>{data.mandatory_coverage.coverage_pct}%</span>
              </div>

              {/* Per-skill table */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {data.skills.map((s: any) => (
                  <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: '1px solid #F1F5F9', background: s.matched ? '#fff' : '#FAFAFA' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: s.is_mandatory ? '#dc2626' : '#2563eb' }} />
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    </div>
                    <div title="Occurrences in Skills / Experience / Projects sections — '—' means that resume has no distinct section to check" style={{ fontSize: 10.5, fontFamily: 'monospace', color: '#64748b', whiteSpace: 'nowrap' }}>
                      S:{s.sections.skills ?? '—'} E:{s.sections.experience ?? '—'} P:{s.sections.projects ?? '—'}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
                      {s.relevant_experience_years}y{s.min_years_required != null && <span style={{ color: s.relevant_experience_years >= s.min_years_required ? '#16a34a' : '#dc2626' }}> / {s.min_years_required}y req</span>}
                    </div>
                    <div style={{
                      minWidth: 24, textAlign: 'center', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                      background: s.matched ? (s.is_mandatory ? '#fee2e2' : '#dbeafe') : '#f1f5f9',
                      color: s.matched ? (s.is_mandatory ? '#991b1b' : '#1d4ed8') : '#94a3b8',
                    }}>{s.count}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 14 }}>
                S/E/P = occurrences in Skills / Experience / Projects sections. Years = auto-computed relevant experience for that skill (from resume dates), not total career length.
              </div>

              {/* Role relevance */}
              <div style={{ fontSize: 11.5, color: '#64748b', padding: '8px 12px', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                Role/domain relevance: {data.role_relevance.relevant
                  ? <span style={{ color: '#166534', fontWeight: 700 }}>relevant background found ({data.role_relevance.matched_tokens.join(', ')})</span>
                  : <span style={{ color: '#92400e', fontWeight: 700 }}>not clearly established — advisory only, worth a manual look</span>}
              </div>

              {/* Manual project-experience entries, if any recruiter has typed them in */}
              {data.skills.some((s: any) => s.manual_entries?.length > 0) && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                    Manually recorded project experience
                  </div>
                  {data.skills.filter((s: any) => s.manual_entries?.length > 0).map((s: any) => (
                    <div key={s.name} style={{ fontSize: 11.5, color: '#475569', marginBottom: 4 }}>
                      <b>{s.name}</b>: {s.manual_entries.map((e: any, i: number) =>
                        `${e.project_name || 'project'} (${e.duration_from || '?'}–${e.duration_to || '?'}${e.relevant_experience ? `, ${e.relevant_experience}` : ''})`
                      ).join('; ')}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
