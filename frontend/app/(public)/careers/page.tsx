'use client';
import { useEffect, useState } from 'react';

const TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const PAGE_SIZE = 10;

// Gap-audit fix (2026-09-02): real filter options wired to the real
// employment_types[]/work_modes[] columns (built 2026-08-24) and a
// real experience-band filter against experience_min/experience_max -
// none of this was exposed on the public board before, despite the
// data already existing on every requisition. "Department" was in the
// original audit finding too, but no such column/taxonomy exists
// anywhere on requisitions - not fabricated here.
const EMPLOYMENT_TYPES = [
  { value: 'fulltime', label: 'Full-time' },
  { value: 'fte', label: 'FTE' },
  { value: 'contract', label: 'Contract' },
  { value: 'c2h', label: 'Contract-to-Hire' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'fl_contract', label: 'Freelance' },
];
const WORK_MODES = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
];
const EXPERIENCE_BANDS = [
  { key: '0-2', label: '0-2 yrs', min: 0, max: 2 },
  { key: '2-5', label: '2-5 yrs', min: 2, max: 5 },
  { key: '5-8', label: '5-8 yrs', min: 5, max: 8 },
  { key: '8+', label: '8+ yrs', min: 8, max: 60 },
];

function useTenantBranding() {
  const [name, setName] = useState('');
  useEffect(() => {
    fetch(`${API_BASE}/public/tenant-info?tenant_id=${TENANT_ID}`)
      .then(r => r.json())
      .then(d => setName(d.name || ''))
      .catch(() => {});
  }, []);
  return name || 'Careers';
}

function TalentCommunitySignup({ filters }: { filters: { search: string; location: string; employmentType: string; workMode: string } }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const hasFilters = !!(filters.search || filters.location || filters.employmentType || filters.workMode);

  const subscribe = async () => {
    if (!email) return;
    setSaving(true); setErr('');
    try {
      // Gap-audit fix (2026-09-02): previously a generic "notify me" with
      // no memory of what the visitor was actually searching for. Maps
      // the real filters in play onto the REAL, already-existing
      // talent_community columns (job_categories/preferred_location) -
      // not a fabricated new field the backend would silently ignore.
      const categories = [filters.search, filters.employmentType, filters.workMode].filter(Boolean);
      const r = await fetch(`${API_BASE}/talent-pool/subscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: TENANT_ID, email, name,
          job_categories: categories,
          preferred_location: filters.location || undefined,
        }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      setDone(true);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  if (done) return (
    <div style={{textAlign:'center',marginTop:'40px',padding:'20px',background:'#EEF2FF',borderRadius:12,fontSize:13,color:'#4338CA'}}>
      You're on the list — we'll email you when a matching role opens up.
    </div>
  );

  return (
    <div style={{textAlign:'center',marginTop:'40px',padding:'24px',background:'#f8fafc',borderRadius:12}}>
      <div style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:4}}>Don't see the right role yet?</div>
      <div style={{fontSize:12,color:'#64748b',marginBottom:12}}>
        {hasFilters ? "Join our talent community and we'll notify you when a role matches your current search." : "Join our talent community and we'll notify you when something matches."}
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Name" style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}} />
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}} />
        <button onClick={subscribe} disabled={saving} style={{padding:'8px 18px',background:'#1e40af',color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer'}}>
          {saving?'Joining…':'Notify Me'}
        </button>
      </div>
      {err && <div style={{color:'#DC2626',fontSize:12,marginTop:8}}>{err}</div>}
    </div>
  );
}

interface Job {
  id: string;
  title: string;
  location: string;
  employment_type: string;
  employment_types?: string[];
  work_modes?: string[];
  skills_required: string[];
  positions_count: number;
  description: string;
  created_at: string;
  budget_min: number | null;
  budget_max: number | null;
}

function usePublicJobs(params: {
  search: string; location: string; employmentType: string; workMode: string; expBand: string; page: number;
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    const q = new URLSearchParams({ tenant_id: TENANT_ID, offset: String(params.page * PAGE_SIZE), limit: String(PAGE_SIZE) });
    if (params.search) q.set('search', params.search);
    if (params.location) q.set('location', params.location);
    if (params.employmentType) q.set('employment_type', params.employmentType);
    if (params.workMode) q.set('work_mode', params.workMode);
    const band = EXPERIENCE_BANDS.find(b => b.key === params.expBand);
    if (band) { q.set('min_exp', String(band.min)); q.set('max_exp', String(band.max)); }
    fetch(`${API_BASE}/public/jobs?${q}`)
      .then(r => r.json())
      .then(d => {
        // Real server-driven pagination (gap-audit fix, 2026-09-02) - the
        // old response was a bare array, hard-capped at 50 with no way
        // to see a 51st job. Handles both shapes defensively during
        // rollout, since a stale cached response could still be the old
        // bare-array form.
        if (Array.isArray(d)) { setJobs(d); setTotal(d.length); }
        else { setJobs(d.jobs || []); setTotal(d.total ?? (d.jobs || []).length); }
        setLoading(false);
      })
      .catch(() => { setError('Failed to load jobs'); setLoading(false); });
  }, [params.search, params.location, params.employmentType, params.workMode, params.expBand, params.page]);

  return { jobs, total, loading, error };
}

function ShareButtons({ job, companyName }: { job: Job; companyName: string }) {
  const jobUrl = typeof window !== 'undefined' ? `${window.location.origin}/careers/${job.id}` : '';
  const shareText = `Hiring: ${job.title}${job.location ? ' in ' + job.location : ''} at ${companyName} — Apply now!`;
  const [copied, setCopied] = useState(false);

  return (
    <>
      <button
        onClick={() => window.open('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(jobUrl), '_blank')}
        title="Share on LinkedIn"
        style={{padding:'6px 10px',background:'#0077b5',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px'}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
      </button>
      <button
        onClick={() => window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(jobUrl), '_blank')}
        title="Share on X / Twitter"
        style={{padding:'6px 10px',background:'#0f172a',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
        𝕏
      </button>
      <button
        onClick={() => window.open('https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + jobUrl), '_blank')}
        title="Share on WhatsApp"
        style={{padding:'6px 10px',background:'#25D366',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39a9.87 9.87 0 0 0 4.75 1.21h.01c5.46 0 9.9-4.45 9.9-9.91S17.5 2 12.04 2m0 18.06h-.01a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3.14.82.84-3.06-.19-.31a8.19 8.19 0 0 1-1.26-4.28c0-4.53 3.69-8.22 8.24-8.22a8.19 8.19 0 0 1 8.22 8.22c0 4.54-3.69 8.15-8.22 8.15m4.51-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.25-.64.81-.78.97-.15.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.44.12-.15.16-.25.25-.42.08-.17.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43-.14-.01-.31-.01-.48-.01-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.09 0 1.23.9 2.42 1.02 2.59.12.17 1.77 2.7 4.29 3.79.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.11-.23-.17-.48-.29"/></svg>
      </button>
      <button
        onClick={() => { navigator.clipboard?.writeText(jobUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
        title="Copy link"
        style={{padding:'6px 10px',background: copied ? '#16a34a' : '#f1f5f9',color: copied ? 'white' : '#475569',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
        {copied ? '✓' : '🔗'}
      </button>
    </>
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

  const iStyle = { width:'100%', padding:'9px 11px', border:'1px solid #e2e8f0', borderRadius:'8px',
    fontSize:'13px', outline:'none', boxSizing:'border-box' as const };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:100,
      display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'100%',maxWidth:'480px',
        maxHeight:'90vh',overflowY:'auto',padding:'28px',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        {done ? (
          <div style={{textAlign:'center',padding:'20px 0'}}>
            <div style={{fontSize:'48px',marginBottom:'12px'}}>🎉</div>
            <h2 style={{fontSize:'18px',fontWeight:'800',color:'#0f172a',marginBottom:'8px'}}>Application Submitted!</h2>
            <p style={{fontSize:'13px',color:'#64748b',lineHeight:'1.6',marginBottom:'20px'}}>
              Thank you for applying for <strong>{job.title}</strong>. Our team will review your profile and get back to you soon.
            </p>
            {statusUrl && (
              <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'10px',padding:'14px',marginBottom:'20px',textAlign:'left'}}>
                <div style={{fontSize:'12px',fontWeight:'700',color:'#166534',marginBottom:'6px'}}>Track your application status any time</div>
                <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                  <input readOnly value={statusUrl} onFocus={e => e.target.select()}
                    style={{flex:1,fontSize:'11px',color:'#166534',background:'white',border:'1px solid #bbf7d0',borderRadius:'6px',padding:'6px 8px'}} />
                  <button onClick={() => { navigator.clipboard?.writeText(statusUrl); setCopiedStatus(true); setTimeout(() => setCopiedStatus(false), 1500); }}
                    style={{padding:'6px 10px',background:'#16a34a',color:'white',border:'none',borderRadius:'6px',fontSize:'11px',fontWeight:'700',cursor:'pointer',whiteSpace:'nowrap'}}>
                    {copiedStatus ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div style={{fontSize:'11px',color:'#166534',marginTop:'6px'}}>We've also emailed this link to you — it stays valid for 30 days.</div>
              </div>
            )}
            <button onClick={onClose} style={{padding:'10px 24px',borderRadius:'8px',border:'none',
              background:'#1e40af',color:'white',cursor:'pointer',fontSize:'14px',fontWeight:'600'}}>Close</button>
          </div>
        ) : (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'20px'}}>
              <div>
                <h2 style={{fontSize:'16px',fontWeight:'800',color:'#0f172a',margin:0}}>Apply for {job.title}</h2>
                <p style={{fontSize:'12px',color:'#64748b',margin:'4px 0 0'}}>{companyName}</p>
              </div>
              <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',
                color:'#94a3b8',fontSize:'20px',lineHeight:1}}>×</button>
            </div>
            {err && <div style={{background:'#fef2f2',border:'1px solid #fee2e2',borderRadius:'8px',
              padding:'10px 12px',fontSize:'13px',color:'#dc2626',marginBottom:'14px'}}>{err}</div>}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
              {[
                {label:'Full Name *', field:'full_name', type:'text', span:2},
                {label:'Email *', field:'email', type:'email', span:1},
                {label:'Phone', field:'phone', type:'tel', span:1},
                {label:'Location', field:'location', type:'text', span:1},
                {label:'Current Employer', field:'current_employer', type:'text', span:1},
                {label:'Experience (months)', field:'experience_months', type:'number', span:2},
              ].map(({label, field, type, span}) => (
                <div key={field} style={{gridColumn:`span ${span}`}}>
                  <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>{label}</label>
                  <input type={type} value={(form as any)[field]}
                    onChange={e => setForm(f => ({...f, [field]: e.target.value}))}
                    style={iStyle}/>
                </div>
              ))}
              <div style={{gridColumn:'span 2'}}>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Cover Letter</label>
                <textarea value={form.cover_letter} onChange={e => setForm(f => ({...f, cover_letter: e.target.value}))}
                  rows={4} placeholder="Why are you a great fit for this role?"
                  style={{...iStyle, resize:'vertical', fontFamily:'inherit', lineHeight:'1.5'}}/>
              </div>
              <div style={{gridColumn:'span 2'}}>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Resume (optional)</label>
                <input type="file" accept=".pdf,.doc,.docx" onChange={e => setResumeFile(e.target.files?.[0] || null)} style={{...iStyle, padding:'7px 11px'}}/>
                {resumeFile && <div style={{fontSize:'11px',color:'#64748b',marginTop:'4px'}}>{resumeFile.name}</div>}
              </div>
            </div>
            <label style={{display:'flex',alignItems:'flex-start',gap:'8px',marginTop:'16px',cursor:'pointer'}}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}
                style={{marginTop:'2px',flexShrink:0}}/>
              <span style={{fontSize:'12px',color:'#64748b',lineHeight:'1.5'}}>
                I consent to {companyName} storing and processing my personal details above to consider me for this and similar roles, in line with the Digital Personal Data Protection Act, 2023.
              </span>
            </label>
            <div style={{display:'flex',gap:'10px',marginTop:'16px',justifyContent:'flex-end'}}>
              <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',
                background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
              <button onClick={apply} disabled={saving || !consent}
                style={{padding:'9px 20px',borderRadius:'8px',border:'none',
                  background: (saving || !consent) ? '#94a3b8' : '#1e40af',
                  color:'white',cursor: (saving || !consent) ? 'not-allowed':'pointer',fontSize:'13px',fontWeight:'600'}}>
                {saving ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FilterChips({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
      <span style={{fontSize:'11px',fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.03em'}}>{label}</span>
      <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
        <button onClick={() => onChange('')}
          style={{padding:'5px 12px',borderRadius:'999px',fontSize:'12px',fontWeight:600,cursor:'pointer',
            border: value === '' ? '1px solid #1e40af' : '1px solid #e2e8f0',
            background: value === '' ? '#eff6ff' : 'white', color: value === '' ? '#1e40af' : '#64748b'}}>
          All
        </button>
        {options.map(o => (
          <button key={o.value} onClick={() => onChange(o.value === value ? '' : o.value)}
            style={{padding:'5px 12px',borderRadius:'999px',fontSize:'12px',fontWeight:600,cursor:'pointer',
              border: value === o.value ? '1px solid #1e40af' : '1px solid #e2e8f0',
              background: value === o.value ? '#eff6ff' : 'white', color: value === o.value ? '#1e40af' : '#64748b'}}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PublicJobsPage() {
  const companyName = useTenantBranding();
  const [search, setSearch] = useState('');
  const [loc, setLoc] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [locQ, setLocQ] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [workMode, setWorkMode] = useState('');
  const [expBand, setExpBand] = useState('');
  const [applying, setApplying] = useState<Job | null>(null);
  const [page, setPage] = useState(0);

  const { jobs, total, loading, error } = usePublicJobs({
    search: searchQ, location: locQ, employmentType, workMode, expBand, page,
  });

  function doSearch() { setSearchQ(search); setLocQ(loc); setPage(0); }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // schema.org JobPosting structured data - this (not any manual posting
  // step) is what makes Google for Jobs index these listings automatically
  // and for free. Covers the current page's jobs; the XML feed
  // (/api/public/jobs/feed.xml) is the complete, pagination-independent
  // source used by Indeed/Jooble/aggregator publisher programs.
  const jsonLd = (jobs || []).map(job => ({
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description || `${job.title} opportunity at ${companyName}`,
    identifier: { '@type': 'PropertyValue', name: companyName, value: job.id },
    datePosted: job.created_at,
    employmentType: (job.employment_type || 'FULL_TIME').toUpperCase().replace(/[\s-]/g, '_'),
    hiringOrganization: { '@type': 'Organization', name: companyName },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: job.location || 'Remote', addressCountry: 'IN' },
    },
    directApply: true,
    ...(job.budget_min != null && job.budget_max != null ? {
      baseSalary: {
        '@type': 'MonetaryAmount',
        currency: 'INR',
        value: { '@type': 'QuantitativeValue', minValue: job.budget_min, maxValue: job.budget_max, unitText: 'YEAR' },
      },
    } : {}),
  }));

  return (
    <div style={{minHeight:'100vh',background:'#f8fafc',fontFamily:'system-ui,-apple-system,sans-serif'}}>
      {jsonLd.map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      ))}
      {/* Header */}
      <div style={{background:'linear-gradient(135deg,#1e40af,#7c3aed)',padding:'48px 24px 32px',textAlign:'center'}}>
        <div style={{maxWidth:'600px',margin:'0 auto'}}>
          <h1 style={{fontSize:'28px',fontWeight:'800',color:'white',margin:'0 0 8px'}}>
            {companyName}
          </h1>
          <p style={{fontSize:'15px',color:'rgba(255,255,255,0.8)',margin:'0 0 28px'}}>
            {total} open position{total===1?'':'s'} · Join a team that delivers
          </p>
          <div style={{display:'flex',gap:'8px',flexWrap:'wrap',justifyContent:'center'}}>
            <input value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key==='Enter' && doSearch()}
              placeholder="Search by role or skill..."
              style={{flex:'1 1 220px',padding:'12px 16px',borderRadius:'10px',border:'none',
                fontSize:'14px',outline:'none',maxWidth:'280px'}}/>
            <input value={loc} onChange={e => setLoc(e.target.value)}
              onKeyDown={e => e.key==='Enter' && doSearch()}
              placeholder="Location..."
              style={{flex:'1 1 140px',padding:'12px 16px',borderRadius:'10px',border:'none',
                fontSize:'14px',outline:'none',maxWidth:'180px'}}/>
            <button onClick={doSearch}
              style={{padding:'12px 24px',borderRadius:'10px',border:'none',background:'white',
                color:'#1e40af',fontWeight:'700',fontSize:'14px',cursor:'pointer',whiteSpace:'nowrap'}}>
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Jobs list */}
      <div style={{maxWidth:'720px',margin:'32px auto',padding:'0 16px'}}>
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'14px',padding:'18px 20px',
          marginBottom:'20px',display:'flex',flexWrap:'wrap',gap:'18px'}}>
          <FilterChips label="Job Type" options={EMPLOYMENT_TYPES} value={employmentType}
            onChange={v => { setEmploymentType(v); setPage(0); }} />
          <FilterChips label="Work Mode" options={WORK_MODES} value={workMode}
            onChange={v => { setWorkMode(v); setPage(0); }} />
          <FilterChips label="Experience" options={EXPERIENCE_BANDS.map(b => ({value:b.key,label:b.label}))} value={expBand}
            onChange={v => { setExpBand(v); setPage(0); }} />
        </div>

        {loading && (
          <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>⏳</div>
            <p>Loading open positions...</p>
          </div>
        )}
        {error && (
          <div style={{background:'#fef2f2',border:'1px solid #fee2e2',borderRadius:'12px',padding:'20px',textAlign:'center',color:'#dc2626'}}>
            {error}
          </div>
        )}
        {!loading && !error && (jobs?.length || 0) === 0 && (
          <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>🔍</div>
            <p>No open positions found matching your search.</p>
          </div>
        )}
        <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
          {(jobs || []).map((job: Job) => (
            <div key={job.id} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'14px',padding:'24px',
              boxShadow:'0 1px 4px rgba(0,0,0,0.06)',transition:'box-shadow 0.2s'}}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow='0 4px 16px rgba(0,0,0,0.12)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow='0 1px 4px rgba(0,0,0,0.06)'}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'16px',flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:0}}>
                  <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:'0 0 6px'}}>{job.title}</h2>
                  <div style={{display:'flex',flexWrap:'wrap',gap:'12px',fontSize:'12px',color:'#64748b',marginBottom:'12px'}}>
                    {job.location && <span>📍 {job.location}</span>}
                    {job.employment_type && <span style={{textTransform:'capitalize'}}>💼 {job.employment_type.replace('_',' ')}</span>}
                    {(job.work_modes && job.work_modes.length > 0) && (
                      <span style={{textTransform:'capitalize'}}>🏢 {job.work_modes.join(' / ')}</span>
                    )}
                    {job.positions_count > 0 && <span>👥 {job.positions_count} opening{job.positions_count>1?'s':''}</span>}
                    <span>📅 {new Date(job.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span>
                  </div>
                  {(job.skills_required||[]).length > 0 && (
                    <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
                      {(job.skills_required||[]).slice(0,6).map((s:string) => (
                        <span key={s} style={{fontSize:'11px',padding:'3px 10px',borderRadius:'20px',
                          background:'#eff6ff',color:'#1e40af',fontWeight:'500',border:'1px solid #bfdbfe'}}>{s}</span>
                      ))}
                      {(job.skills_required||[]).length > 6 && (
                        <span style={{fontSize:'11px',padding:'3px 8px',borderRadius:'20px',background:'#f1f5f9',color:'#94a3b8'}}>
                          +{(job.skills_required||[]).length-6} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center'}}>
                  <ShareButtons job={job} companyName={companyName} />
                </div>
                <button onClick={() => setApplying(job)}
                  style={{padding:'10px 22px',borderRadius:'10px',border:'none',background:'#1e40af',
                    color:'white',fontWeight:'700',fontSize:'13px',cursor:'pointer',whiteSpace:'nowrap',
                    flexShrink:0,transition:'background 0.15s'}}
                  onMouseEnter={e => (e.target as HTMLElement).style.background='#1d4ed8'}
                  onMouseLeave={e => (e.target as HTMLElement).style.background='#1e40af'}>
                  Apply Now
                </button>
              </div>
              {job.description && (
                <p style={{fontSize:'13px',color:'#64748b',margin:'12px 0 0',lineHeight:'1.6',
                  overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical' as any}}>
                  {job.description}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Pagination — real, server-driven (gap-audit fix, 2026-09-02):
            reads the backend's own total count instead of slicing an
            already-capped client-side array, so a tenant with 51+ open
            jobs no longer silently loses everything past #50. */}
        {totalPages > 1 && (
          <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:'8px',marginTop:'24px',flexWrap:'wrap'}}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              style={{width:'36px',height:'36px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',
                color: page === 0 ? '#cbd5e1' : '#374151',cursor: page === 0 ? 'default' : 'pointer',fontSize:'13px'}}>‹</button>
            {Array.from({length:Math.min(totalPages, 10)},(_,i)=>i).map(p => (
              <button key={p} onClick={() => setPage(p)}
                style={{width:'36px',height:'36px',borderRadius:'8px',border:`1px solid ${p===page?'#1e40af':'#e2e8f0'}`,
                  background:p===page?'#1e40af':'white',color:p===page?'white':'#374151',
                  cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
                {p+1}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              style={{width:'36px',height:'36px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',
                color: page >= totalPages - 1 ? '#cbd5e1' : '#374151',cursor: page >= totalPages - 1 ? 'default' : 'pointer',fontSize:'13px'}}>›</button>
          </div>
        )}

        <TalentCommunitySignup filters={{ search: searchQ, location: locQ, employmentType, workMode }} />

        <div style={{textAlign:'center',marginTop:'40px',paddingBottom:'40px',fontSize:'12px',color:'#94a3b8'}}>
          Powered by AVIIN ATS · <a href="/login" style={{color:'#94a3b8',textDecoration:'none'}}>Recruiter Login</a>
        </div>
      </div>

      {applying && <ApplyModal job={applying} companyName={companyName} onClose={() => setApplying(null)}/>}
    </div>
  );
}
