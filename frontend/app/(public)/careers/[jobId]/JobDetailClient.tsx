'use client';
import { useState } from 'react';

const TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface RelatedJob {
  id: string;
  title: string;
  location: string | null;
  employment_type: string | null;
}

interface Job {
  id: string;
  title: string;
  location: string | null;
  employment_type: string | null;
  employment_types?: string[];
  work_modes?: string[];
  experience_min?: number | null;
  experience_max?: number | null;
  mandatory_skills?: string[];
  description: string | null;
  skills_required: string[];
  positions_count: number;
  created_at: string;
  company_name?: string;
  related_jobs?: RelatedJob[];
}

function ShareButtons({ job, companyName }: { job: Job; companyName: string }) {
  const jobUrl = typeof window !== 'undefined' ? window.location.href.split('?')[0] : '';
  const shareText = `Hiring: ${job.title}${job.location ? ' in ' + job.location : ''} at ${companyName} — Apply now!`;
  const [copied, setCopied] = useState(false);

  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      <button
        onClick={() => window.open('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(jobUrl), '_blank')}
        title="Share on LinkedIn"
        style={{ padding: '7px 11px', background: '#0077b5', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
        LinkedIn
      </button>
      <button
        onClick={() => window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(jobUrl), '_blank')}
        title="Share on X / Twitter"
        style={{ padding: '7px 11px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
        X
      </button>
      <button
        onClick={() => window.open('https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + jobUrl), '_blank')}
        title="Share on WhatsApp"
        style={{ padding: '7px 11px', background: '#25D366', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
        WhatsApp
      </button>
      <button
        onClick={() => { navigator.clipboard?.writeText(jobUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
        title="Copy link"
        style={{ padding: '7px 11px', background: copied ? '#16a34a' : '#f1f5f9', color: copied ? 'white' : '#475569', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
        {copied ? 'Copied!' : 'Copy Link'}
      </button>
    </div>
  );
}

function ApplyModal({ job, companyName, onClose }: { job: Job; companyName: string; onClose: () => void }) {
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', location: '', current_employer: '',
    experience_months: '', cover_letter: '',
  });
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [copiedStatus, setCopiedStatus] = useState(false);

  async function apply() {
    if (!form.full_name || !form.email) { setErr('Name and email are required'); return; }
    if (!consent) { setErr('Please confirm you consent to us storing and processing your details before submitting'); return; }
    setSaving(true); setErr('');
    try {
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const ref = params?.get('ref');
      const dsrc = params?.get('dsrc');
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
      if (dsrc) fd.append('dsrc', dsrc);
      if (resumeFile) fd.append('resume', resumeFile);
      const r = await fetch(`${API_BASE}/public/jobs/apply`, { method: 'POST', body: fd });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      const d = await r.json();
      setStatusUrl(d.status_url || null);
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
            {statusUrl && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px', marginBottom: '20px', textAlign: 'left' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#166534', marginBottom: '6px' }}>Track your application status any time</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input readOnly value={statusUrl} onFocus={e => e.target.select()}
                    style={{ flex: 1, fontSize: '11px', color: '#166534', background: 'white', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '6px 8px' }} />
                  <button onClick={() => { navigator.clipboard?.writeText(statusUrl); setCopiedStatus(true); setTimeout(() => setCopiedStatus(false), 1500); }}
                    style={{ padding: '6px 10px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {copiedStatus ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div style={{ fontSize: '11px', color: '#166534', marginTop: '6px' }}>We've also emailed this link to you — it stays valid for 30 days.</div>
              </div>
            )}
            <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: '8px', border: 'none',
              background: '#1e40af', color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', margin: 0 }}>Apply for {job.title}</h2>
                <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>{companyName}</p>
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
                I consent to {companyName} storing and processing my personal details above to consider me for this and similar roles, in line with the Digital Personal Data Protection Act, 2023.
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
  const companyName = job?.company_name || 'Careers';

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

  const expRange = (job.experience_min != null || job.experience_max != null)
    ? `${job.experience_min ?? 0}-${job.experience_max ?? '?'} yrs experience`
    : null;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,-apple-system,sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg,#1e40af,#7c3aed)', padding: '40px 24px 60px' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <a href="/careers" style={{ color: 'rgba(255,255,255,0.8)', fontSize: '13px', textDecoration: 'none' }}>← All open positions</a>
          <h1 style={{ fontSize: '26px', fontWeight: '800', color: 'white', margin: '12px 0 6px' }}>{job.title}</h1>
          <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.85)', margin: 0 }}>{companyName}</p>
        </div>
      </div>

      <div style={{ maxWidth: '720px', margin: '-32px auto 40px', padding: '0 16px' }}>
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '28px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '13px', color: '#64748b', marginBottom: '18px' }}>
            {job.location && <span>📍 {job.location}</span>}
            {job.employment_type && <span style={{ textTransform: 'capitalize' }}>💼 {job.employment_type.replace('_', ' ')}</span>}
            {(job.work_modes && job.work_modes.length > 0) && (
              <span style={{ textTransform: 'capitalize' }}>🏢 {job.work_modes.join(' / ')}</span>
            )}
            {expRange && <span>📈 {expRange}</span>}
            {job.positions_count > 0 && <span>👥 {job.positions_count} opening{job.positions_count > 1 ? 's' : ''}</span>}
          </div>

          {(job.skills_required || []).length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {job.skills_required.map(s => {
                  const isMandatory = (job.mandatory_skills || []).includes(s);
                  return (
                    <span key={s} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '500',
                      background: isMandatory ? '#fef3c7' : '#eff6ff',
                      color: isMandatory ? '#92400e' : '#1e40af',
                      border: `1px solid ${isMandatory ? '#fde68a' : '#bfdbfe'}` }}>
                      {isMandatory ? '★ ' : ''}{s}
                    </span>
                  );
                })}
              </div>
              {(job.mandatory_skills || []).length > 0 && (
                <div style={{ fontSize: '11px', color: '#92400e', marginTop: '6px' }}>★ Required skills</div>
              )}
            </div>
          )}

          {job.description && (
            <p style={{ fontSize: '14px', color: '#374151', lineHeight: '1.7', whiteSpace: 'pre-wrap', marginBottom: '24px' }}>
              {job.description}
            </p>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setApplying(true)}
              style={{ padding: '12px 28px', borderRadius: '10px', border: 'none', background: '#1e40af',
                color: 'white', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
              Apply Now
            </button>
            <ShareButtons job={job} companyName={companyName} />
          </div>
        </div>

        {(job.related_jobs && job.related_jobs.length > 0) && (
          <div style={{ marginTop: '24px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '10px' }}>Related Openings</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {job.related_jobs.map(rj => (
                <a key={rj.id} href={`/careers/${rj.id}`} style={{ display: 'block', background: 'white', border: '1px solid #e2e8f0',
                  borderRadius: '10px', padding: '14px 16px', textDecoration: 'none' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{rj.title}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                    {rj.location && <span>📍 {rj.location} </span>}
                    {rj.employment_type && <span style={{ textTransform: 'capitalize' }}>· {rj.employment_type.replace('_', ' ')}</span>}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '12px', color: '#94a3b8' }}>
          Powered by AVIIN ATS · <a href="/login" style={{ color: '#94a3b8', textDecoration: 'none' }}>Recruiter Login</a>
        </div>
      </div>

      {applying && <ApplyModal job={job} companyName={companyName} onClose={() => setApplying(false)} />}
    </div>
  );
}
