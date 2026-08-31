'use client';
import { useState, useEffect } from 'react';
import { UploadCloud, CheckCircle, User } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const ROLE_TYPES = ['Implementation', 'Support', 'Enhancement', 'Rollout'];
const EMPTY_SKILL_EXP = { skill_name: '', project_name: '', duration_from: '', duration_to: '', role_types: [] as string[], relevant_experience: '', last_used: '' };

interface LinkInfo {
  recruiter_name: string;
  tenant_name: string;
}

export default function RecruiterPersonalLinkPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', location: '', current_employer: '', experience_months: '',
    // 2026-08-30 — real fields reported live: Role Position / Current CTC /
    // Expected CTC / Notice Period / Preferred Location / LinkedIn Profile
    role_position: '', current_ctc: '', expected_ctc: '', notice_period_days: '',
    preferred_location: '', linkedin_url: '',
  });
  const [consent, setConsent] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  // 2026-08-31 — reported live: supporting documents beyond just the
  // resume (previous company offer letter, relieving letter, notice
  // period screenshot, salary slips, or anything else) — same generic
  // multi-file "other" bucket the internal Add Candidate form already
  // uses, not separate named slots per document type.
  const [otherDocs, setOtherDocs] = useState<File[]>([]);

  // Expert / Intermediate skills — same chip-add UX as the internal Add
  // Candidate form's Skills section.
  const [expertSkills, setExpertSkills] = useState<string[]>([]);
  const [expertIn, setExpertIn] = useState('');
  const [intermediateSkills, setIntermediateSkills] = useState<string[]>([]);
  const [intermediateIn, setIntermediateIn] = useState('');
  const addExpert = (v: string) => { const s = v.trim(); if (s && !expertSkills.includes(s)) setExpertSkills(a => [...a, s]); setExpertIn(''); };
  const rmExpert = (s: string) => setExpertSkills(a => a.filter(x => x !== s));
  const addIntermediate = (v: string) => { const s = v.trim(); if (s && !intermediateSkills.includes(s)) setIntermediateSkills(a => [...a, s]); setIntermediateIn(''); };
  const rmIntermediate = (s: string) => setIntermediateSkills(a => a.filter(x => x !== s));

  // Skill / Project Experience (optional) — same real table/shape as the
  // internal Add Candidate form (candidates.py's PUT /{id}/skill-experience).
  const [skillExpForm, setSkillExpForm] = useState({ ...EMPTY_SKILL_EXP });
  const [skillExpRows, setSkillExpRows] = useState<any[]>([]);
  const toggleSkillExpRole = (r: string) => setSkillExpForm(f => ({ ...f, role_types: f.role_types.includes(r) ? f.role_types.filter(x => x !== r) : [...f.role_types, r] }));
  const addSkillExpRow = () => { if (!skillExpForm.skill_name.trim()) return; setSkillExpRows(rows => [...rows, { ...skillExpForm }]); setSkillExpForm({ ...EMPTY_SKILL_EXP }); };
  const removeSkillExpRow = (i: number) => setSkillExpRows(rows => rows.filter((_, idx) => idx !== i));

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/public/personal-links/${token}`);
        if (!r.ok) { setError('This link is invalid or has expired.'); setLoading(false); return; }
        setInfo(await r.json());
      } catch { setError('Could not load this link. Check your connection.'); }
      setLoading(false);
    })();
  }, [token]);

  const phoneDigits = form.phone.replace(/\D/g, '').length;
  const phoneValid = phoneDigits >= 10 && phoneDigits <= 12;

  async function submit() {
    if (!form.full_name || !form.email) { setError('Name and email are required'); return; }
    if (!phoneValid) { setError('A valid mobile number (minimum 10 digits) is required'); return; }
    if (!consent) { setError('Please confirm you consent to us storing and processing your details before submitting'); return; }
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      fd.append('full_name', form.full_name);
      fd.append('email', form.email);
      fd.append('phone', form.phone);
      if (form.location) fd.append('location', form.location);
      if (form.current_employer) fd.append('current_employer', form.current_employer);
      fd.append('experience_months', String(Number(form.experience_months) || 0));
      fd.append('consent_given', 'true');
      if (resumeFile) fd.append('resume', resumeFile);
      if (form.role_position) fd.append('role_position', form.role_position);
      if (form.current_ctc) fd.append('current_ctc', form.current_ctc);
      if (form.expected_ctc) fd.append('expected_ctc', form.expected_ctc);
      if (form.notice_period_days) fd.append('notice_period_days', form.notice_period_days);
      if (form.preferred_location) fd.append('preferred_location', form.preferred_location);
      if (form.linkedin_url) fd.append('linkedin_url', form.linkedin_url);
      if (expertSkills.length) fd.append('expert_skills', expertSkills.join(','));
      if (intermediateSkills.length) fd.append('intermediate_skills', intermediateSkills.join(','));
      if (skillExpRows.length) fd.append('skill_experience', JSON.stringify(skillExpRows));
      otherDocs.forEach(f => fd.append('other_documents', f));
      const r = await fetch(`${API_URL}/public/personal-links/${token}/apply`, { method: 'POST', body: fd });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      setDone(true);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: '-apple-system,Segoe UI,sans-serif' };
  const card: React.CSSProperties = { background: 'white', borderRadius: '20px', padding: '32px 28px', maxWidth: '480px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' };
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4, display: 'block' };
  const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '18px 0 8px' };
  const rowGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };

  if (loading) return <div style={wrap}><div style={{ color: 'white', fontSize: 14 }}>Loading…</div></div>;

  if (error && !info) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <CheckCircle size={48} color="#16a34a" style={{ marginBottom: 12 }} />
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Thank you!</h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
            Your resume has been sent to {info?.recruiter_name}. They'll reach out if there's a fit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <User size={18} color="#1e40af" />
          <h2 style={{ margin: 0, fontSize: 18 }}>Send your resume to {info?.recruiter_name}</h2>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>{info?.tenant_name}</p>

        <label style={label}>Full Name *</label>
        <input style={input} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />

        <label style={label}>Email *</label>
        <input style={input} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />

        <label style={label}>Phone *</label>
        <input style={input} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile number" />
        {form.phone.length > 0 && !phoneValid && (
          <div style={{ fontSize: 11, color: '#dc2626', marginTop: -8, marginBottom: 12 }}>
            {phoneDigits} digit{phoneDigits === 1 ? '' : 's'} — needs at least 10 (or 12 with the 91 country code)
          </div>
        )}

        <div style={rowGrid}>
          <div>
            <label style={label}>Current Location</label>
            <input style={input} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />
          </div>
          <div>
            <label style={label}>Preferred Location</label>
            <input style={input} value={form.preferred_location} onChange={e => setForm({ ...form, preferred_location: e.target.value })} />
          </div>
        </div>

        <label style={label}>Current Employer</label>
        <input style={input} value={form.current_employer} onChange={e => setForm({ ...form, current_employer: e.target.value })} />

        <label style={label}>Role / Position Applying For</label>
        <input style={input} placeholder="e.g. SAP FICO Consultant" value={form.role_position} onChange={e => setForm({ ...form, role_position: e.target.value })} />

        <label style={label}>LinkedIn Profile</label>
        <input style={input} placeholder="https://linkedin.com/in/..." value={form.linkedin_url} onChange={e => setForm({ ...form, linkedin_url: e.target.value })} />

        <div style={rowGrid}>
          <div>
            <label style={label}>Total Experience (months)</label>
            <input style={input} type="number" value={form.experience_months} onChange={e => setForm({ ...form, experience_months: e.target.value })} />
          </div>
          <div>
            <label style={label}>Notice Period (days)</label>
            <input style={input} type="number" min={0} max={365} value={form.notice_period_days} onChange={e => setForm({ ...form, notice_period_days: e.target.value })} />
          </div>
        </div>

        <div style={rowGrid}>
          <div>
            <label style={label}>Current CTC</label>
            <input style={input} type="number" placeholder="e.g. 1200000" value={form.current_ctc} onChange={e => setForm({ ...form, current_ctc: e.target.value })} />
          </div>
          <div>
            <label style={label}>Expected CTC</label>
            <input style={input} type="number" placeholder="e.g. 1600000" value={form.expected_ctc} onChange={e => setForm({ ...form, expected_ctc: e.target.value })} />
          </div>
        </div>

        <div style={sectionLabel}>Expert Skills</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input style={{ ...input, flex: 1, marginBottom: 0 }} placeholder="Type a skill and press Enter" value={expertIn}
            onChange={e => setExpertIn(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExpert(expertIn); } }} />
          <button type="button" onClick={() => addExpert(expertIn)} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 600 }}>Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {expertSkills.map(s => (
            <span key={s} style={{ padding: '4px 10px', borderRadius: 20, background: '#eff6ff', color: '#1e40af', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
              {s}<button type="button" onClick={() => rmExpert(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#93c5fd', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
            </span>
          ))}
        </div>

        <div style={sectionLabel}>Intermediate Skills</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input style={{ ...input, flex: 1, marginBottom: 0 }} placeholder="Type a skill and press Enter" value={intermediateIn}
            onChange={e => setIntermediateIn(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addIntermediate(intermediateIn); } }} />
          <button type="button" onClick={() => addIntermediate(intermediateIn)} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: 13, color: '#374151', fontWeight: 600 }}>Add</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {intermediateSkills.map(s => (
            <span key={s} style={{ padding: '4px 10px', borderRadius: 20, background: '#f0fdf4', color: '#166534', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
              {s}<button type="button" onClick={() => rmIntermediate(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#86efac', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
            </span>
          ))}
        </div>

        <div style={sectionLabel}>Skill / Project Experience (optional)</div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 12, background: '#f8fafc' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <input style={{ ...input, marginBottom: 0 }} placeholder="Skill / Technology (e.g. SAP FICO)" value={skillExpForm.skill_name} onChange={e => setSkillExpForm(f => ({ ...f, skill_name: e.target.value }))} />
            <input style={{ ...input, marginBottom: 0 }} placeholder="Project Name" value={skillExpForm.project_name} onChange={e => setSkillExpForm(f => ({ ...f, project_name: e.target.value }))} />
            <input style={{ ...input, marginBottom: 0 }} placeholder="Duration From (e.g. Jan 2024)" value={skillExpForm.duration_from} onChange={e => setSkillExpForm(f => ({ ...f, duration_from: e.target.value }))} />
            <input style={{ ...input, marginBottom: 0 }} placeholder="Duration To (e.g. Current)" value={skillExpForm.duration_to} onChange={e => setSkillExpForm(f => ({ ...f, duration_to: e.target.value }))} />
            <input style={{ ...input, marginBottom: 0 }} placeholder="Relevant Experience (e.g. 3 Years)" value={skillExpForm.relevant_experience} onChange={e => setSkillExpForm(f => ({ ...f, relevant_experience: e.target.value }))} />
            <input style={{ ...input, marginBottom: 0 }} placeholder="Last Used (e.g. Current / 2023)" value={skillExpForm.last_used} onChange={e => setSkillExpForm(f => ({ ...f, last_used: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Role:</span>
            {ROLE_TYPES.map(r => (
              <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={skillExpForm.role_types.includes(r)} onChange={() => toggleSkillExpRole(r)} />{r}
              </label>
            ))}
          </div>
          <button type="button" onClick={addSkillExpRow} disabled={!skillExpForm.skill_name.trim()}
            style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: skillExpForm.skill_name.trim() ? '#1e40af' : '#94a3b8', color: 'white', cursor: skillExpForm.skill_name.trim() ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700 }}>
            + Add Row
          </button>
        </div>
        {skillExpRows.length > 0 && (
          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Sl.No</th>
                  <th style={{ padding: '6px 8px' }}>Skill / Technology</th>
                  <th style={{ padding: '6px 8px' }}>Project Name</th>
                  <th style={{ padding: '6px 8px' }}>Duration</th>
                  <th style={{ padding: '6px 8px' }}>Role</th>
                  <th style={{ padding: '6px 8px' }}>Rel. Exp.</th>
                  <th style={{ padding: '6px 8px' }}>Last Used</th>
                  <th style={{ padding: '6px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {skillExpRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 700, color: '#1e40af' }}>{r.skill_name}</td>
                    <td style={{ padding: '6px 8px' }}>{r.project_name || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{[r.duration_from, r.duration_to].filter(Boolean).join(' – ') || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{(r.role_types || []).join(' & ') || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{r.relevant_experience || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{r.last_used || '—'}</td>
                    <td style={{ padding: '6px 8px' }}><button type="button" onClick={() => removeSkillExpRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={sectionLabel}>Resume</div>
        <div style={{ ...input, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <UploadCloud size={16} color="#64748b" />
          <input type="file" accept=".pdf,.doc,.docx" onChange={e => setResumeFile(e.target.files?.[0] || null)} style={{ border: 'none', fontSize: 13 }} />
        </div>

        <div style={sectionLabel}>Additional Documents (optional)</div>
        <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 8px' }}>
          e.g. previous company offer letter, relieving letter, notice period screenshot, salary slips, or anything else relevant. Multiple files allowed.
        </p>
        <div style={{ ...input, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <UploadCloud size={16} color="#64748b" />
          <input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            onChange={e => setOtherDocs(Array.from(e.target.files || []))}
            style={{ border: 'none', fontSize: 13 }} />
        </div>
        {otherDocs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {otherDocs.map((f, i) => (
              <span key={i} style={{ padding: '4px 10px', borderRadius: 20, background: '#f1f5f9', color: '#334155', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                {f.name}
                <button type="button" onClick={() => setOtherDocs(docs => docs.filter((_, x) => x !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
              </span>
            ))}
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#475569', margin: '8px 0 16px', cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
          I consent to my details and resume being stored and processed for recruitment purposes, in line with applicable data protection law.
        </label>

        {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <button
          onClick={submit}
          disabled={saving || !consent || !phoneValid}
          style={{
            width: '100%', padding: '12px', background: (saving || !consent || !phoneValid) ? '#94a3b8' : '#1e40af',
            color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
            cursor: (saving || !consent || !phoneValid) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Submitting…' : 'Submit Resume'}
        </button>
      </div>
    </div>
  );
}
