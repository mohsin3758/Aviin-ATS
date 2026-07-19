'use client';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import {
  Inbox, RefreshCw, Play, FileText, User, Mail, Phone, MapPin,
  Briefcase, Clock, CheckCircle, XCircle, AlertCircle, Star,
  ExternalLink, Download, RotateCcw, Search, Zap, Edit3,
  BookOpen, ChevronDown, Layers, Award, Plus, Minus,
  Target, AlertTriangle, TrendingUp, ArrowUpDown
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ParsedData {
  name?: string; email?: string; phone?: string; location?: string;
  current_company?: string; current_designation?: string; experience_years?: number;
  skills?: string[]; education?: string; expected_ctc?: string; notice_period?: string;
  linkedin_url?: string;
  // Enrichment fields (Phase H — new resumes)
  jd_match_score?: number; jd_match_title?: string;
  skills_gap?: string[];
  near_dup?: { candidate_id: string; name: string; similarity_pct: number };
}
interface ResumeItem {
  id: string; job_board: string; job_board_label: string; source_email: string;
  file_name: string; file_path: string; mime_type: string; file_size: number;
  parse_status: string; created_at: string; parsed_data: ParsedData;
  candidate_id?: string; full_name?: string; email?: string; phone?: string;
  skills?: string[]; total_exp_mo?: number; location?: string;
  current_employer?: string; current_designation?: string; source_label?: string;
  auto_created?: boolean; email_subject?: string; email_received_at?: string;
  requisition_id?: string; requisition_title?: string;
  // Enrichment from candidates table (Phase H backfill + new intake)
  jd_match_score?: number;
  matched_requisition_id?: string; matched_jd_title?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SOURCE_COLORS: Record<string, string> = { naukri: '#4f46e5', linkedin: '#0a66c2', indeed: '#003a9b', shine: '#f59e0b', monster: '#7c3aed', timesjobs: '#dc2626', freshersworld: '#059669', iimjobs: '#0891b2', hirist: '#7c3aed', instahyre: '#db2777', cutshort: '#ea580c', internshala: '#2563eb', apna: '#16a34a', workindia: '#9333ea', glassdoor: '#00a47c', jora: '#f97316', simplyhired: '#64748b', jobsforher: '#ec4899', quikr: '#b45309', rozgar: '#0369a1', sensehq: '#1d4ed8', direct: '#475569', referral: '#0f766e' };
const STATUS_CFG: Record<string, { color: string; Icon: any; label: string }> = { auto_accepted: { color: '#059669', Icon: CheckCircle, label: 'Auto-Accepted' }, needs_review: { color: '#f59e0b', Icon: Clock, label: 'Review Needed' }, low_confidence: { color: '#dc2626', Icon: AlertCircle, label: 'Manual Entry' }, done: { color: '#f59e0b', Icon: Clock, label: 'Pending Review' }, approved: { color: '#059669', Icon: CheckCircle, label: 'Approved' }, pending: { color: '#94a3b8', Icon: Clock, label: 'Pending' }, failed: { color: '#dc2626', Icon: XCircle, label: 'Failed' }, no_resume: { color: '#cbd5e1', Icon: AlertCircle, label: 'No Resume' }, rejected: { color: '#dc2626', Icon: XCircle, label: 'Rejected' } };
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const gx = (mo: number) => { if (!mo) return 'Fresher'; const y = Math.floor(mo / 12), m = mo % 12; return y ? `${y}y${m ? ` ${m}m` : ''}` : `${mo}mo`; };
const fdt = (s: string) => { if (!s) return '—'; return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const fsize = (b: number) => b ? `${(b / 1024).toFixed(0)} KB` : '';

/** Get colour for a JD match percentage */
function matchColor(pct: number) {
  if (pct >= 70) return '#059669';  // green
  if (pct >= 50) return '#f59e0b';  // amber
  return '#dc2626';                  // red
}

// ─── JD Match Badge ───────────────────────────────────────────────────────────
function JdMatchBadge({ score, title }: { score: number; title?: string }) {
  const color = matchColor(score);
  return (
    <span title={title ? `${score.toFixed(0)}% match vs "${title}"` : `${score.toFixed(0)}% match`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '3px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 800,
      background: color + '18', color,
      border: `1px solid ${color}40`,
      cursor: title ? 'help' : 'default',
    }}>
      <Target size={10} />
      {score.toFixed(0)}%
    </span>
  );
}

// ─── Near-Dup Indicator ───────────────────────────────────────────────────────
function NearDupBadge({ dup }: { dup: { candidate_id: string; name: string; similarity_pct: number } }) {
  return (
    <span title={`${dup.similarity_pct}% similar to ${dup.name}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 999, marginLeft: 4,
      fontSize: 10, fontWeight: 700,
      background: '#fef3c7', color: '#92400e',
      border: '1px solid #fde68a', cursor: 'pointer',
    }}>
      <AlertTriangle size={9} />
      ~dup {dup.similarity_pct}%
    </span>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
const SourceBadge = ({ source, label }: { source: string; label: string }) => { const color = SOURCE_COLORS[source] || '#64748b'; return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: color + '18', color, border: `1px solid ${color}40` }}>{label}</span>; };
const StatusBadge = ({ status }: { status: string }) => { const s = STATUS_CFG[status] || STATUS_CFG.pending; return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: s.color, fontSize: 12, fontWeight: 600 }}><s.Icon size={13} /> {s.label}</span>; };
const KpiCard = ({ label, value, color, Icon, sub }: any) => <div style={{ flex: 1, minWidth: 120, background: '#fff', borderRadius: 12, padding: '12px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderTop: `3px solid ${color}` }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><Icon size={13} color={color} /><span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{label}</span></div><div style={{ fontSize: 24, fontWeight: 800, color }}>{value ?? 0}</div>{sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}</div>;

// ─── Edit & Approve Modal ─────────────────────────────────────────────────────
function EditApproveModal({ item, onClose, onSave }: { item: ResumeItem; onClose: () => void; onSave: (data: ParsedData) => void }) {
  const pd = item.parsed_data || {};
  const [form, setForm] = useState<ParsedData>({ name: item.full_name || pd.name || '', email: item.email || pd.email || '', phone: item.phone || pd.phone || '', location: item.location || pd.location || '', current_company: item.current_employer || pd.current_company || '', current_designation: item.current_designation || pd.current_designation || '', experience_years: item.total_exp_mo ? item.total_exp_mo / 12 : (pd.experience_years || 0), skills: item.skills || pd.skills || [], education: pd.education || '', expected_ctc: pd.expected_ctc || '', notice_period: pd.notice_period || '' });
  const [skillInput, setSkillInput] = useState('');
  const set = (k: keyof ParsedData, v: any) => setForm(f => ({ ...f, [k]: v }));

  const addSkill = () => { if (skillInput.trim() && !form.skills?.includes(skillInput.trim())) { set('skills', [...(form.skills || []), skillInput.trim()]); setSkillInput(''); } };
  const removeSkill = (s: string) => set('skills', (form.skills || []).filter(x => x !== s));

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1e293b' }}>Edit & Approve Resume</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20 }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[['name', 'Full Name'], ['email', 'Email'], ['phone', 'Phone'], ['location', 'Location'], ['current_company', 'Current Company'], ['current_designation', 'Designation'], ['education', 'Education'], ['expected_ctc', 'Expected CTC'], ['notice_period', 'Notice Period']].map(([k, lbl]) => (
            <div key={k} style={k === 'name' || k === 'email' ? { gridColumn: '1/-1' } : {}}>
              <label style={labelStyle}>{lbl}</label>
              <input value={(form as any)[k] || ''} onChange={e => set(k as keyof ParsedData, e.target.value)} style={inputStyle} />
            </div>
          ))}
          <div>
            <label style={labelStyle}>Experience (years)</label>
            <input type="number" min={0} step={0.5} value={form.experience_years || 0} onChange={e => set('experience_years', parseFloat(e.target.value) || 0)} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>Skills</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {(form.skills || []).map(s => <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eff6ff', color: '#1e40af', padding: '3px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{s}<button onClick={() => removeSkill(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, lineHeight: 1 }}>×</button></span>)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSkill()} placeholder="Add skill…" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={addSkill} style={{ padding: '8px 14px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Add</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSave(form)} style={{ flex: 2, padding: '11px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>✓ Save & Approve</button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────
const PIPELINE_STAGES = [
  { key:'sourced',       label:'Sourced',       color:'#6366f1' },
  { key:'contacted',     label:'Contacted',     color:'#06b6d4' },
  { key:'interested',    label:'Interested',    color:'#3b82f6' },
  { key:'nda',           label:'NDA',           color:'#f59e0b' },
  { key:'screened',      label:'Screened',      color:'#0891b2' },
  { key:'submitted',     label:'Submitted',     color:'#64748b' },
  { key:'l1_interview',  label:'L1 Interview',  color:'#7c3aed' },
  { key:'l2_interview',  label:'L2 Interview',  color:'#9333ea' },
  { key:'offer',         label:'Offer',         color:'#ca8a04' },
  { key:'placed',        label:'Placed',        color:'#16a34a' },
  { key:'hold',          label:'Hold',          color:'#94a3b8' },
];

function DetailDrawer({ item, onClose, onApprove, onReject, onReparse, onEdit, onCheckDups }: { item: ResumeItem; onClose: () => void; onApprove: () => void; onReject: () => void; onReparse: () => void; onEdit: () => void; onCheckDups?: () => void; }) {
  const pd = item.parsed_data || {};
  const skills = item.skills || pd.skills || [];
  const matchScore = item.jd_match_score ?? pd.jd_match_score;
  const matchTitle = pd.jd_match_title || item.matched_jd_title || item.requisition_title;
  const skillsGap: string[] = pd.skills_gap || [];
  const nearDup = pd.near_dup;
  const [pipelineStatus, setPipelineStatus] = useState<'idle'|'loading'|'success'|'exists'|'error'>('idle');
  const [pipelineStage, setPipelineStage] = useState('');
  const [pipelineMsg, setPipelineMsg] = useState('');
  const reqId = item.matched_requisition_id || item.requisition_id;
  const reqTitle = matchTitle || item.matched_jd_title || item.requisition_title;

  async function handleMoveToStage(stage: string) {
    if (!item.candidate_id) return;
    if (!reqId) { setPipelineStatus('error'); setPipelineMsg('No matched job found for this resume'); return; }
    setPipelineStatus('loading'); setPipelineStage(stage);
    try {
      await apiFetch('/applications', { method: 'POST', body: JSON.stringify({ candidate_id: item.candidate_id, requisition_id: reqId, stage }) });
      setPipelineStatus('success');
      setPipelineMsg('Moved to ' + (PIPELINE_STAGES.find(s => s.key === stage)?.label || stage));
    } catch(e: any) {
      const msg = (e?.message || String(e)).toLowerCase();
      if (msg.includes('409') || msg.includes('already')) {
        setPipelineStatus('exists'); setPipelineMsg('Already in pipeline for this job');
      } else {
        setPipelineStatus('error'); setPipelineMsg(String(e?.message || 'Failed'));
      }
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ width: 480, maxWidth: '96vw', height: '100%', background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', overflowY: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <SourceBadge source={item.job_board || 'direct'} label={item.job_board_label || 'Direct'} />
            <h2 style={{ margin: '8px 0 2px', fontSize: 18, fontWeight: 800, color: '#1e293b' }}>{item.full_name || pd.name || '—'}</h2>
            <div style={{ fontSize: 12, color: '#64748b' }}>{item.current_designation || pd.current_designation || ''}{(item.current_employer || pd.current_company) ? ` @ ${item.current_employer || pd.current_company}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20 }}>✕</button>
        </div>

        {/* Status row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusBadge status={item.parse_status} />
          {matchScore != null && <JdMatchBadge score={matchScore} />}
          {nearDup && (
            <a href={`/candidates/${nearDup.candidate_id}`} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', textDecoration: 'none' }}>
              <AlertTriangle size={10} /> Near-dup: {nearDup.name} ({nearDup.similarity_pct}%)
            </a>
          )}
        </div>

        {/* JD Match Card — shown when we have a match score */}
        {matchScore != null && (
          <div style={{ background: matchScore >= 70 ? '#f0fdf4' : matchScore >= 50 ? '#fffbeb' : '#fef2f2', border: `1px solid ${matchScore >= 70 ? '#bbf7d0' : matchScore >= 50 ? '#fde68a' : '#fecaca'}`, borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#374151' }}>
                <Target size={13} color={matchColor(matchScore)} />
                JD Match Score
              </div>
              <span style={{ fontSize: 20, fontWeight: 900, color: matchColor(matchScore) }}>{matchScore.toFixed(0)}%</span>
            </div>
            {matchTitle && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                <div style={{ fontSize: 11, color: '#64748b' }}>Best match: <strong style={{ color: '#1e293b' }}>{matchTitle}</strong></div>
                {(item.matched_requisition_id || item.requisition_id) && (
                  <a
                    href={`/requisitions/${item.matched_requisition_id || item.requisition_id}`}
                    onClick={e => e.stopPropagation()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: '#0891b2', textDecoration: 'none', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap' }}
                  >
                    <ExternalLink size={9} /> View JD
                  </a>
                )}
              </div>
            )}
            {/* Match bar */}
            <div style={{ marginTop: 8, height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(matchScore, 100)}%`, background: matchColor(matchScore), borderRadius: 3, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        )}

        {/* Skills Gap — shown when we have gap data */}
        {skillsGap.length > 0 && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#9a3412', marginBottom: 8 }}>
              <TrendingUp size={12} />
              MISSING SKILLS ({skillsGap.length} gap{skillsGap.length !== 1 ? 's' : ''})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {skillsGap.map(sk => (
                <span key={sk} style={{ fontSize: 11, background: '#fff', color: '#c2410c', padding: '3px 8px', borderRadius: 6, fontWeight: 600, border: '1px solid #fed7aa' }}>{sk}</span>
              ))}
            </div>
          </div>
        )}

        {/* Contact info */}
        <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          {(item.email || pd.email) && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6 }}><Mail size={13} color="#6366f1" />{item.email || pd.email}</div>}
          {(item.phone || pd.phone) && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6 }}><Phone size={13} color="#059669" />{item.phone || pd.phone}</div>}
          {(item.location || pd.location) && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6 }}><MapPin size={13} color="#f59e0b" />{item.location || pd.location}</div>}
          {(item.total_exp_mo || pd.experience_years) && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 6 }}><Briefcase size={13} color="#0891b2" />{item.total_exp_mo ? gx(item.total_exp_mo) : `${pd.experience_years}yr`} experience</div>}
          {pd.education && <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><BookOpen size={13} color="#7c3aed" />{pd.education}</div>}
        </div>

        {/* Skills the candidate has */}
        {skills.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>CANDIDATE SKILLS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {skills.map((sk: string) => (
                <span key={sk} style={{ fontSize: 11, background: skillsGap.includes(sk) ? '#fef9c3' : '#eff6ff', color: skillsGap.includes(sk) ? '#ca8a04' : '#1e40af', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>{sk}</span>
              ))}
            </div>
          </div>
        )}

        {(pd.expected_ctc || pd.notice_period) && <div style={{ background: '#fafafa', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12 }}>{pd.expected_ctc && <div><b>Expected CTC:</b> {pd.expected_ctc}</div>}{pd.notice_period && <div style={{ marginTop: 4 }}><b>Notice Period:</b> {pd.notice_period}</div>}</div>}

        {item.file_name && <div style={{ marginBottom: 16, padding: 12, background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0' }}><div style={{ fontSize: 11, fontWeight: 700, color: '#059669', marginBottom: 6 }}>RESUME FILE</div><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151' }}><FileText size={13} color="#059669" /><span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file_name}</span><span style={{ color: '#94a3b8', flexShrink: 0 }}>{fsize(item.file_size)}</span></div>{item.file_path && <a href={`${API_URL}${item.file_path}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#059669', fontSize: 12, fontWeight: 700, textDecoration: 'none', flexShrink: 0 }}><Download size={12} /> Download</a>}</div></div>}

        {item.email_subject && <div style={{ marginBottom: 16 }}><div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>ORIGINAL EMAIL</div><div style={{ fontSize: 13, color: '#374151', fontStyle: 'italic' }}>{item.email_subject}</div><div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>From: {item.source_email} · {fdt(item.email_received_at || item.created_at)}</div></div>}

        {/* Move to Pipeline */}
        {item.candidate_id && (
          <div style={{ marginBottom: 16, padding: 14, background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                🔄 Move to Pipeline
              </div>
              {reqTitle && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 600, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reqTitle}</span>}
            </div>
            {!reqId && (
              <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No matched job. Use the job filter to associate this resume with a JD first.</div>
            )}
            {reqId && pipelineStatus === 'success' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#15803d' }}>
                ✓ {pipelineMsg}
                <a href={'/pipeline?job=' + reqId} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 11, color: '#059669', textDecoration: 'none', fontWeight: 600 }}>View Pipeline →</a>
              </div>
            )}
            {reqId && pipelineStatus === 'exists' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#92400e' }}>
                ⚠ {pipelineMsg}
                <a href={'/pipeline?job=' + reqId} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 11, color: '#b45309', textDecoration: 'none', fontWeight: 600 }}>View Pipeline →</a>
              </div>
            )}
            {reqId && pipelineStatus === 'error' && (
              <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>{pipelineMsg}</div>
            )}
            {reqId && pipelineStatus !== 'success' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PIPELINE_STAGES.map(s => (
                  <button key={s.key} onClick={() => handleMoveToStage(s.key)}
                    disabled={pipelineStatus === 'loading'}
                    style={{ fontSize: 11, fontWeight: 700, padding: '5px 11px', borderRadius: 20,
                      cursor: pipelineStatus === 'loading' ? 'wait' : 'pointer',
                      border: '1px solid ' + s.color + '50',
                      background: (pipelineStatus === 'loading' && pipelineStage === s.key) ? s.color : s.color + '15',
                      color: (pipelineStatus === 'loading' && pipelineStage === s.key) ? '#fff' : s.color,
                      opacity: (pipelineStatus === 'loading' && pipelineStage !== s.key) ? 0.5 : 1,
                      transition: 'all 0.15s' }}>
                    {(pipelineStatus === 'loading' && pipelineStage === s.key) ? '...' : s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          {item.candidate_id && <a href={`/candidates/${item.candidate_id}`} style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: '#1e40af', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none' }}><User size={13} /> View in ATS</a>}
          <button onClick={onEdit} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}><Edit3 size={13} /> Edit & Approve</button>
          <button onClick={onApprove} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}><CheckCircle size={13} /> Quick Approve</button>
          <button onClick={onReparse} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}><RotateCcw size={13} /> Re-parse</button>
          {item.candidate_id && onCheckDups && <button onClick={onCheckDups} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}><Layers size={13} /> Check Dupes</button>}
          {item.parse_status !== 'rejected' && <button onClick={onReject} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}><XCircle size={13} /> Reject</button>}
        </div>
      </div>
    </div>
  );
}


// ─── Dedup Modal ──────────────────────────────────────────────────────────────
function DedupModal({ candidateId, onClose }: { candidateId: string; onClose: () => void }) {
  const { data, isLoading } = useFetch<any>(`/resume-intake/candidates/${candidateId}/duplicates`);
  const [merging, setMerging] = useState<string|null>(null);
  const [merged, setMerged] = useState<string[]>([]);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const doMerge = async (mergeId: string) => {
    if (!confirm('Merge this duplicate into the current candidate? The duplicate record will be deleted.')) return;
    setMerging(mergeId);
    try {
      await apiFetch(`/resume-intake/candidates/${candidateId}/merge/${mergeId}`, { method: 'POST' });
      setMerged(prev => [...prev, mergeId]);
      showToast('✓ Records merged successfully');
    } catch (e: any) {
      showToast('Error: ' + e.message);
    } finally { setMerging(null); }
  };

  const hasDup = data && data.matched_candidate_id && data.decision !== 'SELF_MATCH' && data.decision !== 'UNIQUE';
  const matchId = data?.matched_candidate_id;
  const isMerged = matchId && merged.includes(matchId);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ background:'#fff', borderRadius:14, width:'100%', maxWidth:480, padding:24, maxHeight:'80vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
          <h2 style={{ margin:0, fontSize:17, fontWeight:800, color:'#1e293b' }}>Duplicate Check</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8', fontSize:20 }}>✕</button>
        </div>
        {toast && <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:13, color:'#15803d' }}>{toast}</div>}
        {isLoading && <p style={{ color:'#94a3b8', fontSize:13 }}>Checking for duplicates…</p>}
        {!isLoading && !hasDup && (
          <div style={{ textAlign:'center', padding:'32px 0' }}>
            <div style={{ fontSize:36, marginBottom:8 }}>✅</div>
            <div style={{ fontSize:14, fontWeight:700, color:'#15803d' }}>No duplicates found</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>Decision: {data?.decision || 'UNIQUE'}</div>
          </div>
        )}
        {!isLoading && hasDup && !isMerged && (
          <div>
            <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:10, padding:14, marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#92400e', marginBottom:4 }}>⚠️ POTENTIAL DUPLICATE FOUND</div>
              <div style={{ fontSize:11, color:'#78350f' }}>Decision: <strong>{data.decision}</strong> · Score: {((data.score || 0) * 100).toFixed(0)}%</div>
              {data.evidence && data.evidence.length > 0 && (
                <div style={{ marginTop:8, fontSize:11, color:'#78350f' }}>
                  Evidence: {data.evidence.join(', ')}
                </div>
              )}
            </div>
            <a href={`/candidates/${matchId}`} target="_blank" rel="noreferrer"
              style={{ display:'block', padding:'10px 14px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, marginBottom:12, textDecoration:'none', color:'#1e293b', fontSize:13 }}>
              🔗 View duplicate candidate →
            </a>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={onClose} style={{ flex:1, padding:'10px', background:'#f1f5f9', color:'#374151', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Keep Both
              </button>
              <button onClick={() => doMerge(matchId!)} disabled={merging===matchId}
                style={{ flex:2, padding:'10px', background: merging===matchId ? '#94a3b8' : '#dc2626', color:'#fff', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor: merging===matchId ? 'not-allowed' : 'pointer' }}>
                {merging===matchId ? 'Merging…' : '⚡ Merge Duplicate'}
              </button>
            </div>
          </div>
        )}
        {isMerged && (
          <div style={{ textAlign:'center', padding:'32px 0' }}>
            <div style={{ fontSize:36, marginBottom:8 }}>🎉</div>
            <div style={{ fontSize:14, fontWeight:700, color:'#15803d' }}>Duplicate merged!</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>All data consolidated into the current record.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ResumeInboxPage() {
  const router = useRouter();
  const _sp = useSearchParams();
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('');
  const [jobFilter, setJobFilter] = useState('');

  // Sync jobFilter with ?req= URL param
  useEffect(() => { const r = _sp?.get('req') || ''; if (r !== jobFilter) setJobFilter(r); }, [_sp]);
  const [search, setSearch] = useState('');
  const [processing, setProcessing] = useState(false);
  const [selected, setSelected] = useState<ResumeItem | null>(null);
  const [editItem, setEditItem] = useState<ResumeItem | null>(null);
  const [toast, setToast] = useState('');
  const [toastOk, setToastOk] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  const [dedupTarget, setDedupTarget] = useState<string|null>(null);
  const [sortByMatch, setSortByMatch] = useState(false);

  const { data: stats, mutate: reloadStats } = useFetch('/resume-intake/stats');
  const { data: reqs } = useFetch('/requisitions?limit=200&status=open');
  const { data: queueData, mutate: reloadQueue, isLoading } = useFetch(
    `/resume-intake/queue?status=${statusFilter}${sourceFilter ? `&source=${sourceFilter}` : ''}${jobFilter && jobFilter !== 'unmatched' ? `&req_id=${jobFilter}` : ''}&limit=${limit}`
  );

  const showToast = (msg: string, ok = true) => { setToast(msg); setToastOk(ok); setTimeout(() => setToast(''), 4000); };

  const runProcessing = async () => {
    setProcessing(true);
    try {
      const r = await apiFetch('/resume-intake/process-pending', { method: 'POST' });
      showToast(`✓ Processed ${r.processed} emails → ${r.candidates_created_or_updated} candidates`);
      reloadQueue(); reloadStats();
    } catch (e: any) { showToast('Error: ' + e.message, false); }
    finally { setProcessing(false); }
  };

  const doAction = async (id: string, action: string, body?: any) => {
    try {
      await apiFetch(`/resume-intake/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      showToast(`✓ ${action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Done'}`);
      reloadQueue(); setSelected(null); setEditItem(null);
    } catch (e: any) { showToast('Error: ' + e.message, false); }
  };

  const handleEditSave = async (form: ParsedData) => {
    if (!editItem) return;
    try {
      await apiFetch(`/resume-intake/${editItem.id}/update-and-approve`, { method: 'POST', body: JSON.stringify(form) });
      showToast('✓ Saved & Approved');
      reloadQueue(); setEditItem(null); setSelected(null);
    } catch (e: any) {
      await doAction(editItem.id, 'approve');
    }
  };

  const bulkAction = async (action: 'approve' | 'reject') => {
    if (!selectedIds.size) return;
    let done = 0;
    for (const id of selectedIds) {
      try { await apiFetch(`/resume-intake/${id}/${action}`, { method: 'POST' }); done++; } catch (e) {}
    }
    showToast(`✓ ${action === 'approve' ? 'Approved' : 'Rejected'} ${done} resumes`);
    setSelectedIds(new Set()); reloadQueue();
  };

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const reqList: any[] = reqs?.requisitions || reqs?.data?.requisitions || [];

  const baseItems: ResumeItem[] = ((queueData?.items || []) as ResumeItem[]).filter(r => {
    if (search) { const s = search.toLowerCase(); if (![r.full_name, r.email, r.file_name, r.email_subject, r.source_email].some(f => (f || '').toLowerCase().includes(s))) return false; }
    if (jobFilter && jobFilter !== 'unmatched') { /* server-filtered via req_id param */ }
    if (jobFilter === 'unmatched') { if (r.requisition_id || r.matched_requisition_id) return false; }
    return true;
  });

  const items = useMemo(() => {
    if (!sortByMatch) return baseItems;
    return [...baseItems].sort((a, b) => {
      const sa = a.jd_match_score ?? a.parsed_data?.jd_match_score ?? -1;
      const sb = b.jd_match_score ?? b.parsed_data?.jd_match_score ?? -1;
      return sb - sa;
    });
  }, [baseItems, sortByMatch]);

  const selectAll = () => { const all = items.map(r => r.id); setSelectedIds(prev => prev.size === all.length ? new Set() : new Set(all)); };

  const today = stats?.today || {};
  const bySrc: any[] = stats?.by_source || [];

  // Stats for enrichment KPIs
  const withMatch = baseItems.filter(r => (r.jd_match_score ?? r.parsed_data?.jd_match_score) != null).length;
  const withNearDup = baseItems.filter(r => r.parsed_data?.near_dup).length;
  const avgMatch = withMatch > 0 ? Math.round(baseItems.reduce((s, r) => s + ((r.jd_match_score ?? r.parsed_data?.jd_match_score) ?? 0), 0) / withMatch) : null;

  return (
    <div style={{ padding: '18px 22px', background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}><Inbox size={21} color="#1e40af" /> Resume Inbox</h1>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>Auto-capture from 30+ Indian job boards · AI parsing · JD match scoring · ATS sync</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => { reloadQueue(); reloadStats(); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#475569' }}><RefreshCw size={13} /> Refresh</button>
          <button onClick={runProcessing} disabled={processing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: processing ? '#94a3b8' : '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: processing ? 'not-allowed' : 'pointer' }}><Play size={13} /> {processing ? 'Processing…' : 'Process Pending'}</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <KpiCard label="Resumes Today" value={today.total_today} color="#1e40af" Icon={Inbox} />
        <KpiCard label="Candidates Created" value={today.candidates_today} color="#059669" Icon={User} />
        <KpiCard label="Review Needed" value={statusFilter === 'done' ? items.length : undefined} color="#f59e0b" Icon={Clock} sub="status=done" />
        <KpiCard label="Total Auto-Created" value={stats?.total_auto_candidates} color="#0f766e" Icon={CheckCircle} />
        <KpiCard label="Pending Processing" value={stats?.pending_emails} color="#7c3aed" Icon={Zap} />
        {avgMatch != null && <KpiCard label="Avg JD Match" value={`${avgMatch}%`} color="#0891b2" Icon={Target} sub={`${withMatch} scored`} />}
        {withNearDup > 0 && <KpiCard label="Near-Duplicates" value={withNearDup} color="#f59e0b" Icon={AlertTriangle} sub="vector similarity" />}
      </div>

      {/* Source chips */}
      {bySrc.length > 0 && (
        <div style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', marginBottom: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>SOURCES — LAST 7 DAYS</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setSourceFilter('')} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: !sourceFilter ? '#1e40af' : '#f1f5f9', color: !sourceFilter ? '#fff' : '#374151', border: '1px solid ' + (!sourceFilter ? '#1e40af' : '#e2e8f0') }}>All</button>
            {bySrc.map(s => <button key={s.job_board} onClick={() => setSourceFilter(sourceFilter === s.job_board ? '' : s.job_board)} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: sourceFilter === s.job_board ? (SOURCE_COLORS[s.job_board] || '#1e40af') : '#f1f5f9', color: sourceFilter === s.job_board ? '#fff' : '#374151', border: '1px solid ' + (sourceFilter === s.job_board ? 'transparent' : '#e2e8f0') }}><b>{s.total}</b> {s.source}</button>)}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, file, subject…" style={{ width: '100%', padding: '8px 12px 8px 30px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box' }} />
        </div>

        {['all', 'auto_accepted', 'needs_review', 'low_confidence', 'approved', 'rejected'].map(s => <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: statusFilter === s ? '#1e40af' : '#fff', color: statusFilter === s ? '#fff' : '#64748b', border: '1px solid ' + (statusFilter === s ? '#1e40af' : '#e2e8f0'), textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{s === 'auto_accepted' ? 'Auto-Accepted' : s === 'needs_review' ? 'Review Needed' : s === 'low_confidence' ? 'Manual Entry' : s}</button>)}

        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <select value={jobFilter} onChange={e => { setJobFilter(e.target.value); if (typeof window !== 'undefined') { const u = new URL(window.location.href); if (e.target.value) u.searchParams.set('req', e.target.value); else u.searchParams.delete('req'); window.history.replaceState({}, '', u.toString()); }}} style={{ padding: '8px 12px', border: `1px solid ${jobFilter ? '#7c3aed' : '#e2e8f0'}`, borderRadius: 8, fontSize: 13, background: jobFilter ? '#faf5ff' : '#fff', cursor: 'pointer', minWidth: 140, fontWeight: jobFilter ? 700 : 400, color: jobFilter ? '#7c3aed' : undefined }}>
          <option value="">All Jobs</option>
          <option value="unmatched">Unmatched</option>
          {reqList.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        {jobFilter && jobFilter !== 'unmatched' && <button onClick={() => { setJobFilter(''); if (typeof window !== 'undefined') { const u = new URL(window.location.href); u.searchParams.delete('req'); window.history.replaceState({}, '', u.toString()); }}} style={{ fontSize:11, color:'#7c3aed', background:'#f5f3ff', border:'1px solid #ddd6fe', borderRadius:6, padding:'4px 8px', cursor:'pointer', whiteSpace:'nowrap' }}>✕ Clear</button>}
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div style={{ background: '#1e40af', color: '#fff', padding: '10px 16px', borderRadius: 10, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size} selected</span>
          <button onClick={() => bulkAction('approve')} style={{ padding: '6px 14px', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ Approve All</button>
          <button onClick={() => bulkAction('reject')} style={{ padding: '6px 14px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✕ Reject All</button>
          <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12 }}>Clear</button>
        </div>
      )}

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ padding: 56, textAlign: 'center' }}><Inbox size={40} color="#cbd5e1" style={{ display: 'block', margin: '0 auto 12px' }} /><div style={{ color: '#94a3b8', fontSize: 14 }}>No resumes match your filters. Click "Process Pending" to scan your inbox.</div></div>
        ) : (
          <>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={selectedIds.size === items.length && items.length > 0} onChange={selectAll} style={{ cursor: 'pointer' }} />
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{items.length} resumes</span>
              {/* Sort by match toggle */}
              <button onClick={() => setSortByMatch(s => !s)} style={{ marginLeft: 8, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: sortByMatch ? '#eff6ff' : '#f8fafc', color: sortByMatch ? '#1e40af' : '#64748b', border: `1px solid ${sortByMatch ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <ArrowUpDown size={11} /> {sortByMatch ? 'Sorted: Match %' : 'Sort by Match %'}
              </button>
              {withNearDup > 0 && <span style={{ marginLeft: 4, fontSize: 11, color: '#92400e', background: '#fef3c7', padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}><AlertTriangle size={10} style={{ display: 'inline', marginRight: 3 }} />{withNearDup} near-dup{withNearDup !== 1 ? 's' : ''}</span>}
              {queueData?.total > limit && <button onClick={() => setLimit(l => l + 100)} style={{ marginLeft: 'auto', fontSize: 12, color: '#1e40af', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Load more ({queueData.total - limit} remaining)</button>}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ width: 32, padding: '10px 8px' }}></th>
                {['Candidate', 'Source', 'File', 'Skills', 'Exp', 'Received', 'Job Match', 'Match %', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: h === 'Match %' ? '#1e40af' : '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap', cursor: h === 'Match %' ? 'pointer' : 'default' }}
                    onClick={h === 'Match %' ? () => setSortByMatch(s => !s) : undefined}>
                    {h === 'Match %' ? <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Target size={11} />{h}{sortByMatch ? ' ↓' : ''}</span> : h}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {items.map((r, i) => {
                  const skills = r.skills || r.parsed_data?.skills || [];
                  const matchScore = r.jd_match_score ?? r.parsed_data?.jd_match_score;
                  const nearDup = r.parsed_data?.near_dup;
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: selectedIds.has(r.id) ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#fafafa' }}
                      onMouseEnter={e => { if (!selectedIds.has(r.id)) (e.currentTarget as HTMLElement).style.background = '#f0f7ff'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = selectedIds.has(r.id) ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#fafafa'; }}>
                      <td style={{ padding: '10px 8px' }} onClick={e => { e.stopPropagation(); toggleSelect(r.id); }}><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} style={{ cursor: 'pointer' }} /></td>
                      {/* Candidate cell — shows name + near-dup warning */}
                      <td style={{ padding: '10px 12px' }} onClick={() => setSelected(r)}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                          <span style={{ fontWeight: 700, color: '#1e293b', fontSize: 13 }}>{r.full_name || r.parsed_data?.name || '—'}</span>
                          {nearDup && <NearDupBadge dup={nearDup} />}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{r.email || r.source_email || '—'}</div>
                        {r.current_designation && <div style={{ fontSize: 10, color: '#94a3b8' }}>{r.current_designation}</div>}
                      </td>
                      <td style={{ padding: '10px 12px' }} onClick={() => setSelected(r)}><SourceBadge source={r.job_board || 'direct'} label={r.job_board_label || 'Direct'} /></td>
                      <td style={{ padding: '10px 12px', maxWidth: 150 }} onClick={() => setSelected(r)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#374151' }}><FileText size={12} color="#6366f1" /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{r.file_name || r.email_subject || '—'}</span></div>
                        {r.file_size > 0 && <div style={{ fontSize: 10, color: '#94a3b8' }}>{fsize(r.file_size)}</div>}
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: 160 }} onClick={() => setSelected(r)}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{skills.slice(0, 3).map((sk: string) => <span key={sk} style={{ fontSize: 10, background: '#eff6ff', color: '#1e40af', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{sk}</span>)}{skills.length > 3 && <span style={{ fontSize: 10, color: '#94a3b8' }}>+{skills.length - 3}</span>}</div>
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: '#374151', fontWeight: 600, whiteSpace: 'nowrap' }} onClick={() => setSelected(r)}>{gx(r.total_exp_mo || 0)}</td>
                      <td style={{ padding: '10px 12px', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }} onClick={() => setSelected(r)}>{fdt(r.email_received_at || r.created_at)}</td>
                      {/* Job Match column — entire cell is clickable when JD is known */}
                      <td
                        style={{ padding: '10px 12px', cursor: (r.requisition_title || r.matched_jd_title) ? 'pointer' : 'default' }}
                        onClick={e => {
                          e.stopPropagation();
                          const reqId = r.requisition_id || r.matched_requisition_id;
                          if (reqId) router.push(`/requisitions/${reqId}`);
                        }}
                      >
                        {(r.requisition_title || r.matched_jd_title) ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{
                              fontSize: 11, fontWeight: 700,
                              color: r.requisition_title ? '#1e40af' : '#166534',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120,
                            }}>
                              {r.requisition_title || r.matched_jd_title}
                            </span>
                            <span style={{ fontSize: 9, color: '#94a3b8', letterSpacing: '0.03em' }}>
                              {r.requisition_title ? 'Applied' : 'AI Match'} · View JD ↗
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>
                        )}
                      </td>
                      {/* Match % column — sortable, tooltip shows which JD */}
                      <td style={{ padding: '10px 12px', textAlign: 'center' }} onClick={() => setSelected(r)}>
                        {matchScore != null
                          ? <JdMatchBadge score={matchScore} title={r.matched_jd_title || r.requisition_title} />
                          : <span style={{ fontSize: 11, color: '#e2e8f0' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }} onClick={() => setSelected(r)}><StatusBadge status={r.parse_status || 'pending'} /></td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={e => { e.stopPropagation(); setEditItem(r); }} title="Edit & Approve" style={{ padding: '4px 8px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>Edit</button>
                          {r.candidate_id && <a href={`/candidates/${r.candidate_id}`} onClick={e => e.stopPropagation()} style={{ padding: '4px 6px', color: '#1e40af', fontSize: 11, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center' }}><ExternalLink size={11} /></a>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {selected && <DetailDrawer item={selected} onClose={() => setSelected(null)} onApprove={() => doAction(selected.id, 'approve')} onReject={() => doAction(selected.id, 'reject')} onReparse={() => doAction(selected.id, 'reparse')} onEdit={() => { setEditItem(selected); setSelected(null); }}  onCheckDups={selected.candidate_id ? () => setDedupTarget(selected.candidate_id!) : undefined} />}
      {editItem && <EditApproveModal item={editItem} onClose={() => setEditItem(null)} onSave={handleEditSave} />}
      {dedupTarget && <DedupModal candidateId={dedupTarget} onClose={() => setDedupTarget(null)} />}

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: toastOk ? '#1e293b' : '#dc2626', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>{toast}</div>}
    </div>
  );
}
