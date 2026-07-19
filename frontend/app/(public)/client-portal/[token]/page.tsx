'use client';
import { useState, useEffect } from 'react';
import { User, Briefcase, MapPin, Star, CheckCircle, XCircle, Clock, MessageSquare } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

function fmtExp(mo: number) {
  if (!mo) return 'Fresher';
  const y = Math.floor(mo / 12), m = mo % 12;
  return y ? `${y}y${m ? ` ${m}m` : ''}` : `${mo}mo`;
}

const GRADE_COLOR: Record<string, string> = {
  A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626',
};

const DECISION_CFG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  approve: { label: 'Approved', color: '#16a34a', bg: '#f0fdf4', icon: CheckCircle },
  reject: { label: 'Rejected', color: '#dc2626', bg: '#fef2f2', icon: XCircle },
  hold: { label: 'On Hold', color: '#d97706', bg: '#fef3c7', icon: Clock },
};

interface Candidate {
  application_id: string;
  candidate_id: string;
  full_name: string;
  total_exp_mo: number;
  skills: string[];
  location: string;
  current_employer: string;
  current_designation: string;
  readiness_index: number | null;
  readiness_grade: string | null;
  client_decision: string | null;
  feedback_text: string | null;
  stage: string;
}

function FeedbackModal({
  candidate,
  token,
  onClose,
  onSaved,
}: {
  candidate: Candidate;
  token: string;
  onClose: () => void;
  onSaved: (appId: string, decision: string, text: string) => void;
}) {
  const [decision, setDecision] = useState<string>(candidate.client_decision || '');
  const [text, setText] = useState(candidate.feedback_text || '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!decision) { alert('Please select a decision'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/client-portal/feedback-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          application_id: candidate.application_id,
          candidate_id: candidate.candidate_id,
          decision,
          feedback_text: text,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved(candidate.application_id, decision, text);
      onClose();
    } catch (e: any) {
      alert('Failed: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, padding: 24 }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800, color: '#1e293b' }}>
          Feedback: {candidate.full_name}
        </h3>
        <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b' }}>
          {candidate.current_designation}{candidate.current_employer ? ` @ ${candidate.current_employer}` : ''}
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 8 }}>
            Decision *
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(DECISION_CFG).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setDecision(key)}
                style={{
                  flex: 1, padding: '9px 4px', borderRadius: 8,
                  border: decision === key ? `2px solid ${cfg.color}` : '1px solid #e2e8f0',
                  background: decision === key ? cfg.bg : '#f8fafc',
                  color: decision === key ? cfg.color : '#64748b',
                  cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}
              >
                <cfg.icon size={13} /> {cfg.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
            Comments (optional)
          </label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            placeholder="Any notes for the recruiter..."
            style={{ width: '100%', padding: '9px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: 11, background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{ flex: 2, padding: 11, background: saving ? '#94a3b8' : '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving…' : '✓ Submit Feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClientPortalPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<{ requisition: any; candidates: Candidate[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedbackTarget, setFeedbackTarget] = useState<Candidate | null>(null);
  const [localFeedback, setLocalFeedback] = useState<Record<string, { decision: string; text: string }>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/client-portal/view/${params.token}`)
      .then(r => { if (!r.ok) throw new Error('Link expired or invalid'); return r.json(); })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [params.token]);

  function handleSaved(appId: string, decision: string, text: string) {
    setLocalFeedback(prev => ({ ...prev, [appId]: { decision, text } }));
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#2563eb', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ color: '#64748b', fontSize: 14 }}>Loading shortlist…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', margin: '0 0 8px' }}>Invalid or Expired Link</h2>
          <p style={{ color: '#64748b', fontSize: 14 }}>{error}</p>
        </div>
      </div>
    );
  }

  const req = data!.requisition;
  const candidates = data!.candidates;
  const approved = candidates.filter(c => (localFeedback[c.application_id]?.decision || c.client_decision) === 'approve').length;
  const rejected = candidates.filter(c => (localFeedback[c.application_id]?.decision || c.client_decision) === 'reject').length;
  const pending = candidates.filter(c => !(localFeedback[c.application_id]?.decision || c.client_decision)).length;

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e40af 0%, #7c3aed 100%)', color: '#fff', padding: '24px 28px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.8, marginBottom: 6 }}>
            AVIIN JOBS · CANDIDATE SHORTLIST
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 6px' }}>{req.title}</h1>
          {req.client_name && (
            <div style={{ fontSize: 14, opacity: 0.85 }}>Client: {req.client_name}</div>
          )}
          <div style={{ display: 'flex', gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Total Candidates', value: candidates.length, color: '#fff' },
              { label: '✅ Approved', value: approved, color: '#86efac' },
              { label: '❌ Rejected', value: rejected, color: '#fca5a5' },
              { label: '⏳ Pending Review', value: pending, color: '#fde68a' },
            ].map(k => (
              <div key={k.label} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 18px', minWidth: 100 }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{k.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Candidate Cards */}
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px' }}>
        {candidates.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <p style={{ fontSize: 15 }}>No candidates have been shortlisted yet.</p>
          </div>
        )}

        {candidates.map((c, i) => {
          const fb = localFeedback[c.application_id];
          const dec = fb?.decision || c.client_decision;
          const decCfg = dec ? DECISION_CFG[dec] : null;

          return (
            <div
              key={c.application_id}
              style={{
                background: '#fff', borderRadius: 12, padding: '18px 20px',
                marginBottom: 14, border: decCfg ? `2px solid ${decCfg.color}40` : '1px solid #e2e8f0',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                {/* Avatar */}
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: '#eff6ff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <User size={20} color="#2563eb" />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>#{i + 1} {c.full_name}</span>
                    {c.readiness_grade && (
                      <span style={{
                        fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6,
                        background: (GRADE_COLOR[c.readiness_grade] || '#64748b') + '18',
                        color: GRADE_COLOR[c.readiness_grade] || '#64748b',
                        border: `1px solid ${(GRADE_COLOR[c.readiness_grade] || '#64748b')}40`,
                      }}>
                        Grade {c.readiness_grade} · {c.readiness_index?.toFixed(0) ?? 'N/A'}%
                      </span>
                    )}
                    {decCfg && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                        background: decCfg.bg, color: decCfg.color, border: `1px solid ${decCfg.color}40`,
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}>
                        <decCfg.icon size={11} /> {decCfg.label}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#64748b', flexWrap: 'wrap', marginBottom: 8 }}>
                    {c.current_designation && <span><Briefcase size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{c.current_designation}{c.current_employer ? ` @ ${c.current_employer}` : ''}</span>}
                    {c.location && <span><MapPin size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{c.location}</span>}
                    {c.total_exp_mo > 0 && <span>⏱ {fmtExp(c.total_exp_mo)} exp</span>}
                    <span style={{ textTransform: 'capitalize', background: '#f8fafc', padding: '1px 6px', borderRadius: 4, border: '1px solid #e2e8f0' }}>{c.stage}</span>
                  </div>

                  {(c.skills || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      {(c.skills || []).slice(0, 6).map((s: string) => (
                        <span key={s} style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>{s}</span>
                      ))}
                      {(c.skills || []).length > 6 && (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0' }}>+{c.skills.length - 6}</span>
                      )}
                    </div>
                  )}

                  {(fb?.text || c.feedback_text) && (
                    <div style={{ fontSize: 12, color: '#374151', background: '#f8fafc', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 4 }}>
                      <MessageSquare size={11} style={{ verticalAlign: 'middle', marginRight: 4, color: '#94a3b8' }} />
                      {fb?.text || c.feedback_text}
                    </div>
                  )}
                </div>

                {/* Action */}
                <div style={{ flexShrink: 0 }}>
                  <button
                    onClick={() => setFeedbackTarget(c)}
                    style={{
                      padding: '8px 14px', borderRadius: 8,
                      border: decCfg ? `1px solid ${decCfg.color}60` : '1px solid #e2e8f0',
                      background: decCfg ? decCfg.bg : '#f8fafc',
                      color: decCfg ? decCfg.color : '#374151',
                      cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <Star size={12} /> {dec ? 'Update' : 'Give Feedback'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        <div style={{ marginTop: 32, textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
          Powered by AVIIN Jobs Services · This link is confidential and intended for authorized viewing only.
        </div>
      </div>

      {feedbackTarget && (
        <FeedbackModal
          candidate={feedbackTarget}
          token={params.token}
          onClose={() => setFeedbackTarget(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
