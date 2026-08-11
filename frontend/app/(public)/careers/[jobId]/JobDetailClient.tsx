'use client';
import { useState } from 'react';

const TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Job {
  id: string;
  title: string;
  location: string | null;
  employment_type: string | null;
  description: string | null;
  skills_required: string[];
  positions_count: number;
  created_at: string;
}

function ApplyModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', location: '', current_employer: '',
    experience_months: '', cover_letter: '',
  });
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  async function apply() {
    if (!form.full_name || !form.email) { setErr('Name and email are required'); return; }
    if (!consent) { setErr('Please confirm you consent to us storing and processing your details before submitting'); return; }
    setSaving(true); setErr('');
    try {
      const ref = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ref') : null;
      const fd = new FormData();
      fd.append('tenant_id', TENANT_ID);
      fd.append('job_id', job.id);
      fd.append('full_name', form.full_name);
      fd.append('email', form.email);
      if (form.phone) fd.append('phone', form.phone);
      if (form.location) fd.append('location', form.location);
      if (form.current_employer) fd.append('current_employer', form.current_employer);
      fd.append('experience_months', String(Number(form.experience_months) || 0));
      fd.append('consent_given', 'true');
      if (ref) fd.append('ref', ref);
      if (resumeFile) fd.append('resume', resumeFile);
      const r = await fetch(`${API_BASE}/public/jobs/apply`, { method: 'POST', body: fd });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      setDone(true);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const iStyle = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: '8px',
    fontSize: '13px', outline: 'none', boxSizing: 'border-box' as const };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '480px',
        maxHeight: '90vh', overflowY: 'auto', padding: '28px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>Application Submitted!</h2>
            <p style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.6', marginBottom: '20px' }}>
              Thank you for applying for <strong>{job.title}</strong>. Our team will review your profile and get back to you soon.
            </p>
            <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: '8px', border: 'none',
              background: '#1e40af', color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', margin: 0 }}>Apply for {job.title}</h2>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>AVIIN Jobs Services</p>
              </div>
              <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer',
                color: '#94a3b8', fontSize: '20px', lineHeight: 1 }}>×</button>
            </div>
            {err && <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '8px',
              padding: '10px 12px', fontSize: '13px', color: '#dc2626', marginBottom: '14px' }}>{err}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {[
                { label: 'Full Name *', field: 'full_name', type: 'text', span: 2 },
                { label: 'Email *', field: 'email', type: 'email', span: 1 },
                { label: 'Phone', field: 'phone', type: 'tel', span: 1 },
                { label: 'Location', field: 'location', type: 'text', span: 1 },
                { label: 'Current Employer', field: 'current_employer', type: 'text', span: 1 },
                { label: 'Experience (months)', field: 'experience_months', type: 'number', span: 2 },
              ].map(({ label, field, type, span }) => (
                <div key={field} style={{ gridColumn: `span ${span}` }}>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '5px' }}>{label}</label>
                  <input type={type} value={(form as any)[field]}
                    onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                    style={iStyle} />
                </div>
              ))}
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '5px' }}>Cover Letter</label>
                <textarea value={form.cover_letter} onChange={e => setForm(f => ({ ...f, cover_letter: e.target.value }))}
                  rows={4} placeholder="Why are you a great fit for this role?"
                  style={{ ...iStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: '1.5' }} />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: '#374151', display: 'block', marginBottom: '5px' }}>Resume (optional)</label>
                <input type="file" accept=".pdf,.doc,.docx" onChange={e => setResumeFile(e.target.files?.[0] || null)} style={{ ...iStyle, padding: '7px 11px' }} />
                {resumeFile && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>{resumeFile.name}</div>}
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '16px', cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                style={{ marginTop: '2px', flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                I consent to AVIIN Jobs Services storing and processing my personal details above to consider me for this and similar roles, in line with the Digital Personal Data Protection Act, 2023.
              </span>
            </label>
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: '8px', border: '1px solid #e2e8f0',
                background: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: '#374151' }}>Cancel</button>
              <button onClick={apply} disabled={saving || !consent}
                style={{ padding: '9px 20px', borderRadius: '8px', border: 'none',
                  background: (saving || !consent) ? '#94a3b8' : '#1e40af',
                  color: 'white', cursor: (saving || !consent) ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '600' }}>
                {saving ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function JobDetailClient({ job }: { job: Job | null }) {
  const [applying, setApplying] = useState(false);

  if (!job) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
          <h1 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>Job Not Found</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>This position may have closed or the link is incorrect.</p>
          <a href="/careers" style={{ color: '#1e40af', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>Browse all open positions →</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#1e40af,#7c3aed)', padding: '40px 24px 60px' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <a href="/careers" style={{ color: 'rgba(255,255,255,0.8)', fontSize: '13px', textDecoration: 'none' }}>← All open positions</a>
          <h1 style={{ fontSize: '26px', fontWeight: '800', color: 'white', margin: '12px 0 6px' }}>{job.title}</h1>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.85)', margin: 0 }}>AVIIN Jobs Services</p>
        </div>
      </div>

      <div style={{ maxWidth: '720px', margin: '-32px auto 40px', padding: '0 16px' }}>
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '28px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '13px', color: '#64748b', marginBottom: '18px' }}>
            {job.location && <span>📍 {job.location}</span>}
            {job.employment_type && <span style={{ textTransform: 'capitalize' }}>💼 {job.employment_type.replace('_', ' ')}</span>}
            {job.positions_count > 0 && <span>👥 {job.positions_count} opening{job.positions_count > 1 ? 's' : ''}</span>}
          </div>

          {(job.skills_required || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px' }}>
              {job.skills_required.map(s => (
                <span key={s} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px',
                  background: '#eff6ff', color: '#1e40af', fontWeight: '500', border: '1px solid #bfdbfe' }}>{s}</span>
              ))}
            </div>
          )}

          {job.description && (
            <p style={{ fontSize: '14px', color: '#374151', lineHeight: '1.7', whiteSpace: 'pre-wrap', marginBottom: '24px' }}>
              {job.description}
            </p>
          )}

          <button onClick={() => setApplying(true)}
            style={{ padding: '12px 28px', borderRadius: '10px', border: 'none', background: '#1e40af',
              color: 'white', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
            Apply Now
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '12px', color: '#94a3b8' }}>
          Powered by AVIIN ATS · <a href="/login" style={{ color: '#94a3b8', textDecoration: 'none' }}>Recruiter Login</a>
        </div>
      </div>

      {applying && <ApplyModal job={job} onClose={() => setApplying(false)} />}
    </div>
  );
}
