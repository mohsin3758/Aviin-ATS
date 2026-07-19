'use client';
import { useState } from 'react';

const TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface Job {
  id: string;
  title: string;
  location: string;
  employment_type: string;
  skills_required: string[];
  positions_count: number;
  description: string;
  created_at: string;
}

function usePublicJobs(search: string, location: string) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [fetched, setFetched] = useState(false);
  if (!fetched) {
    setFetched(true);
    setLoading(true);
    const params = new URLSearchParams({ tenant_id: TENANT_ID });
    if (search) params.set('search', search);
    if (location) params.set('location', location);
    fetch(`${API_BASE}/public/jobs?${params}`)
      .then(r => r.json())
      .then(d => { setJobs(Array.isArray(d) ? d : d.jobs || []); setLoading(false); })
      .catch(() => { setError('Failed to load jobs'); setLoading(false); });
  }
  return { jobs, loading, error };
}

function ApplyModal({ job, onClose }: { job: Job; onClose: () => void }) {
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', location: '', current_employer: '',
    experience_months: '', cover_letter: '',
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  async function apply() {
    if (!form.full_name || !form.email) { setErr('Name and email are required'); return; }
    setSaving(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/public/jobs/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, experience_months: Number(form.experience_months)||0, job_id: job.id, tenant_id: TENANT_ID }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
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
            <button onClick={onClose} style={{padding:'10px 24px',borderRadius:'8px',border:'none',
              background:'#1e40af',color:'white',cursor:'pointer',fontSize:'14px',fontWeight:'600'}}>Close</button>
          </div>
        ) : (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'20px'}}>
              <div>
                <h2 style={{fontSize:'16px',fontWeight:'800',color:'#0f172a',margin:0}}>Apply for {job.title}</h2>
                <p style={{fontSize:'12px',color:'#64748b',margin:'4px 0 0'}}>AVIIN Jobs Services</p>
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
            </div>
            <div style={{display:'flex',gap:'10px',marginTop:'20px',justifyContent:'flex-end'}}>
              <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',
                background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
              <button onClick={apply} disabled={saving}
                style={{padding:'9px 20px',borderRadius:'8px',border:'none',
                  background: saving ? '#94a3b8' : '#1e40af',
                  color:'white',cursor: saving ? 'not-allowed':'pointer',fontSize:'13px',fontWeight:'600'}}>
                {saving ? 'Submitting...' : 'Submit Application'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function PublicJobsPage() {
  const [search, setSearch] = useState('');
  const [loc, setLoc] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [locQ, setLocQ] = useState('');
  const [applying, setApplying] = useState<Job | null>(null);
  const [page, setPage] = useState(0);

  const { jobs, loading, error } = usePublicJobs(searchQ, locQ);

  function doSearch() { setSearchQ(search); setLocQ(loc); setPage(0); }

  const filtered = (jobs || []).slice(page * 10, page * 10 + 10);
  const totalPages = Math.ceil((jobs?.length || 0) / 10);

  return (
    <div style={{minHeight:'100vh',background:'#f8fafc',fontFamily:'system-ui,-apple-system,sans-serif'}}>
      {/* Header */}
      <div style={{background:'linear-gradient(135deg,#1e40af,#7c3aed)',padding:'48px 24px 32px',textAlign:'center'}}>
        <div style={{maxWidth:'600px',margin:'0 auto'}}>
          <h1 style={{fontSize:'28px',fontWeight:'800',color:'white',margin:'0 0 8px'}}>
            AVIIN Jobs Services
          </h1>
          <p style={{fontSize:'15px',color:'rgba(255,255,255,0.8)',margin:'0 0 28px'}}>
            {jobs?.length || 0} open positions · Join a team that delivers
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
        {!loading && !error && jobs?.length === 0 && (
          <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>
            <div style={{fontSize:'32px',marginBottom:'12px'}}>🔍</div>
            <p>No open positions found matching your search.</p>
          </div>
        )}
        <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
          {filtered.map((job: Job) => (
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
                  <button
                    onClick={() => window.open('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(window.location.href + '?job=' + job.id), '_blank')}
                    style={{padding:'6px 12px',background:'#0077b5',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px'}}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    LinkedIn
                  </button>
                  <button
                    onClick={() => window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent('Hiring: ' + job.title + ' at ' + job.company_name + ' - Apply now!') + '&url=' + encodeURIComponent(window.location.href), '_blank')}
                    style={{padding:'6px 12px',background:'#1da1f2',color:'white',border:'none',borderRadius:'6px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
                    Share
                  </button>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{display:'flex',justifyContent:'center',gap:'8px',marginTop:'24px'}}>
            {Array.from({length:totalPages},(_,i)=>i).map(p => (
              <button key={p} onClick={() => setPage(p)}
                style={{width:'36px',height:'36px',borderRadius:'8px',border:`1px solid ${p===page?'#1e40af':'#e2e8f0'}`,
                  background:p===page?'#1e40af':'white',color:p===page?'white':'#374151',
                  cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
                {p+1}
              </button>
            ))}
          </div>
        )}

        <div style={{textAlign:'center',marginTop:'40px',paddingBottom:'40px',fontSize:'12px',color:'#94a3b8'}}>
          Powered by AVIIN ATS · <a href="/login" style={{color:'#94a3b8',textDecoration:'none'}}>Recruiter Login</a>
        </div>
      </div>

      {applying && <ApplyModal job={applying} onClose={() => setApplying(null)}/>}
    </div>
  );
}
