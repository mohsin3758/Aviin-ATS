'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import {
  ArrowLeft, Mail, Phone, MessageCircle, Briefcase,
  Star, FileText, History, CheckCircle, Clock, AlertCircle,
  Database, FileSearch, Award, TrendingUp, Calendar, Building2,
  AlertTriangle, Download, Edit2, Save, X, Plus, Linkedin, Share2, Copy, CheckCheck,
  MapPin, DollarSign, Timer,
} from 'lucide-react';

const STAGE_COLORS: Record<string,{color:string,bg:string}> = {
  sourced:   {color:'#64748b',bg:'#f1f5f9'},
  screened:  {color:'#2563eb',bg:'#eff6ff'},
  submitted: {color:'#7c3aed',bg:'#f5f3ff'},
  interview: {color:'#d97706',bg:'#fffbeb'},
  offer:     {color:'#0891b2',bg:'#ecfeff'},
  placed:    {color:'#16a34a',bg:'#f0fdf4'},
  rejected:  {color:'#dc2626',bg:'#fef2f2'},
};

const ROUTING_CFG: Record<string,{label:string,color:string,bg:string,icon:any}> = {
  auto_accepted:  {label:'Auto-Accepted',  color:'#059669',bg:'#d1fae5', icon:CheckCircle},
  needs_review:   {label:'Needs Review',   color:'#d97706',bg:'#fef3c7', icon:Clock},
  low_confidence: {label:'Low Confidence', color:'#dc2626',bg:'#fee2e2', icon:AlertCircle},
  approved:       {label:'Approved',       color:'#059669',bg:'#d1fae5', icon:CheckCircle},
  rejected:       {label:'Rejected',       color:'#dc2626',bg:'#fee2e2', icon:AlertCircle},
};

const SOURCE_CFG: Record<string,{label:string,color:string,bg:string}> = {
  v2_parser:        {label:'v2 Parser',      color:'#1e40af',bg:'#eff6ff'},
  backfill_v2:      {label:'Backfill',        color:'#6b7280',bg:'#f3f4f6'},
  candidate_manual: {label:'Manual Entry',    color:'#d97706',bg:'#fef3c7'},
  intelligence:     {label:'AI Intelligence', color:'#7c3aed',bg:'#f5f3ff'},
};

const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
function getAvatarColor(n: string) { return AVATAR_COLORS[(n||'').charCodeAt(0) % AVATAR_COLORS.length]; }
function getInitials(n: string) { return (n||'??').split(' ').map((x:string)=>x[0]).join('').slice(0,2).toUpperCase(); }
function expLabel(mo: number) {
  if (!mo) return 'Fresher';
  const y = Math.floor(mo/12), m = mo%12;
  return y>0 ? (m>0 ? `${y}y ${m}m` : `${y} yr`) : `${m} mo`;
}
function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'});
}
function fmtDateTime(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function fmtCtc(n: number|null|undefined) {
  if (!n) return '—';
  return n >= 100000 ? `₹${(n/100000).toFixed(1)}L` : `₹${Math.round(n/1000)}K`;
}

// ── Resume download (auth-gated) ──────────────────────────────────────────────
async function downloadResume(fileId: string, fileName: string) {
  const token = localStorage.getItem('airecruit_token');
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api';
  try {
    const resp = await fetch(`${apiBase}/resume-intake/${fileId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) { alert('Download failed: ' + resp.status); return; }
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = fileName || 'resume';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { alert('Download error: ' + String(e)); }
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({ cand, onClose, onSaved }: { cand: any; onClose: ()=>void; onSaved: (updated: any)=>void }) {
  const [form, setForm] = useState({
    full_name:           cand.full_name || '',
    email:               cand.email || '',
    phone:               cand.phone || '',
    location:            cand.location || '',
    current_employer:    cand.current_employer || '',
    current_designation: cand.current_designation || '',
    total_exp_mo:        cand.total_exp_mo ?? 0,
    expected_ctc:        cand.expected_ctc ?? '',
    current_ctc:         cand.current_ctc ?? '',
    notice_period_days:  cand.notice_period_days ?? '',
    linkedin_url:        cand.linkedin_url || '',
    source:              cand.source || '',
    skills:              (cand.skills || []).join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [skillInput, setSkillInput] = useState('');

  const set = (k: string, v: any) => setForm(f => ({...f, [k]: v}));

  async function save() {
    setSaving(true); setErr('');
    try {
      const payload: any = {
        full_name:           form.full_name.trim(),
        email:               form.email.trim() || null,
        phone:               form.phone.trim() || null,
        location:            form.location.trim() || null,
        current_employer:    form.current_employer.trim() || null,
        current_designation: form.current_designation.trim() || null,
        total_exp_mo:        Number(form.total_exp_mo) || 0,
        expected_ctc:        form.expected_ctc !== '' ? Number(form.expected_ctc) : null,
        current_ctc:         form.current_ctc !== '' ? Number(form.current_ctc) : null,
        notice_period_days:  form.notice_period_days !== '' ? Number(form.notice_period_days) : null,
        linkedin_url:        form.linkedin_url.trim() || null,
        source:              form.source.trim() || null,
        skills:              form.skills.split(',').map((s:string) => s.trim()).filter(Boolean),
      };
      const updated = await apiFetch(`/candidates/${cand.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      onSaved(updated);
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally { setSaving(false); }
  }

  const inp: React.CSSProperties = {
    width:'100%', padding:'8px 10px', borderRadius:'8px',
    border:'1px solid #e2e8f0', fontSize:'13px', outline:'none', boxSizing:'border-box',
    background:'white',
  };
  const lbl: React.CSSProperties = { fontSize:'12px', fontWeight:'600', color:'#64748b', marginBottom:'4px', display:'block' };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'100%',maxWidth:'680px',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}>
        {/* Header */}
        <div style={{padding:'20px 24px',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:'white',zIndex:1,borderRadius:'16px 16px 0 0'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <Edit2 size={16} style={{color:'#1e40af'}}/>
            <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>Edit Candidate</h2>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',padding:'4px'}}>
            <X size={20}/>
          </button>
        </div>

        <div style={{padding:'24px',display:'flex',flexDirection:'column',gap:'20px'}}>
          {/* Personal */}
          <div>
            <div style={{fontSize:'12px',fontWeight:'700',color:'#0f172a',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'12px',paddingBottom:'6px',borderBottom:'2px solid #e2e8f0'}}>
              Personal Info
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
              <div>
                <label style={lbl}>Full Name *</label>
                <input style={inp} value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Full name"/>
              </div>
              <div>
                <label style={lbl}>Email</label>
                <input style={inp} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@example.com"/>
              </div>
              <div>
                <label style={lbl}>Phone</label>
                <input style={inp} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 98765 43210"/>
              </div>
              <div>
                <label style={lbl}>Location</label>
                <input style={inp} value={form.location} onChange={e => set('location', e.target.value)} placeholder="City, State"/>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={lbl}>LinkedIn URL</label>
                <input style={inp} value={form.linkedin_url} onChange={e => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/..."/>
              </div>
            </div>
          </div>

          {/* Professional */}
          <div>
            <div style={{fontSize:'12px',fontWeight:'700',color:'#0f172a',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'12px',paddingBottom:'6px',borderBottom:'2px solid #e2e8f0'}}>
              Professional Info
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
              <div>
                <label style={lbl}>Current Employer</label>
                <input style={inp} value={form.current_employer} onChange={e => set('current_employer', e.target.value)} placeholder="Company name"/>
              </div>
              <div>
                <label style={lbl}>Current Designation</label>
                <input style={inp} value={form.current_designation} onChange={e => set('current_designation', e.target.value)} placeholder="Senior Engineer"/>
              </div>
              <div>
                <label style={lbl}>Total Experience (months)</label>
                <input style={inp} type="number" min="0" value={form.total_exp_mo} onChange={e => set('total_exp_mo', e.target.value)} placeholder="60"/>
              </div>
              <div>
                <label style={lbl}>Notice Period (days)</label>
                <input style={inp} type="number" min="0" value={form.notice_period_days} onChange={e => set('notice_period_days', e.target.value)} placeholder="30"/>
              </div>
              <div>
                <label style={lbl}>Current CTC (₹/year)</label>
                <input style={inp} type="number" min="0" value={form.current_ctc} onChange={e => set('current_ctc', e.target.value)} placeholder="1200000"/>
              </div>
              <div>
                <label style={lbl}>Expected CTC (₹/year)</label>
                <input style={inp} type="number" min="0" value={form.expected_ctc} onChange={e => set('expected_ctc', e.target.value)} placeholder="1500000"/>
              </div>
              <div>
                <label style={lbl}>Source</label>
                <select style={inp} value={form.source} onChange={e => set('source', e.target.value)}>
                  {['linkedin','naukri','indeed','referral','job_board','email','direct','other'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Skills */}
          <div>
            <div style={{fontSize:'12px',fontWeight:'700',color:'#0f172a',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'12px',paddingBottom:'6px',borderBottom:'2px solid #e2e8f0'}}>
              Skills
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'10px'}}>
              {form.skills.split(',').map((s:string) => s.trim()).filter(Boolean).map((sk:string, i:number) => (
                <span key={i} style={{display:'inline-flex',alignItems:'center',gap:'4px',padding:'4px 10px',borderRadius:'20px',
                  fontSize:'12px',fontWeight:'600',background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe'}}>
                  {sk}
                  <button onClick={() => {
                    const arr = form.skills.split(',').map((s:string)=>s.trim()).filter(Boolean);
                    arr.splice(i, 1);
                    set('skills', arr.join(', '));
                  }} style={{background:'none',border:'none',cursor:'pointer',padding:'0',color:'#93c5fd',lineHeight:1}}>
                    <X size={10}/>
                  </button>
                </span>
              ))}
            </div>
            <div style={{display:'flex',gap:'8px'}}>
              <input style={{...inp, flex:1}} value={skillInput}
                onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const sk = skillInput.trim();
                    if (sk) {
                      const existing = form.skills.split(',').map((s:string)=>s.trim()).filter(Boolean);
                      if (!existing.includes(sk)) set('skills', [...existing, sk].join(', '));
                      setSkillInput('');
                    }
                  }
                }}
                placeholder="Type a skill and press Enter"/>
              <button onClick={() => {
                const sk = skillInput.trim();
                if (sk) {
                  const existing = form.skills.split(',').map((s:string)=>s.trim()).filter(Boolean);
                  if (!existing.includes(sk)) set('skills', [...existing, sk].join(', '));
                  setSkillInput('');
                }
              }} style={{padding:'8px 14px',borderRadius:'8px',border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'13px',display:'flex',alignItems:'center',gap:'4px'}}>
                <Plus size={13}/> Add
              </button>
            </div>
          </div>

          {err && <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'8px',fontSize:'13px',color:'#dc2626'}}>{err}</div>}
        </div>

        {/* Footer */}
        <div style={{padding:'16px 24px',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'flex-end',gap:'10px',position:'sticky',bottom:0,background:'white',borderRadius:'0 0 16px 16px'}}>
          <button onClick={onClose} disabled={saving}
            style={{padding:'8px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#64748b'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !form.full_name.trim()}
            style={{padding:'8px 20px',borderRadius:'8px',border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',display:'flex',alignItems:'center',gap:'6px',opacity:saving?0.7:1}}>
            <Save size={13}/>{saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Parse History Panel ───────────────────────────────────────────────────────
function ParseHistoryPanel({ id }: { id: string }) {
  const { data: ph, loading } = useFetch<any>(`/candidates/${id}/parse-history`);

  if (loading) return (
    <div style={{padding:'40px',textAlign:'center',color:'#94a3b8',fontSize:'13px'}}>Loading parse history…</div>
  );
  if (!ph) return (
    <div style={{padding:'40px',textAlign:'center',color:'#94a3b8',fontSize:'13px'}}>No parse history available.</div>
  );

  const cpd = ph.current_parsed_data;
  const files: any[] = ph.resume_files || [];
  const sourceCfg = cpd ? (SOURCE_CFG[cpd.parse_source] || {label:cpd.parse_source,color:'#374151',bg:'#f1f5f9'}) : null;

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'16px',marginTop:'16px'}}>

      {/* Parsed snapshot */}
      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'16px'}}>
          <Database size={16} style={{color:'#1e40af'}}/>
          <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',margin:0}}>Current Parsed Data</h3>
          {cpd && sourceCfg && (
            <span style={{marginLeft:'auto',fontSize:'11px',padding:'2px 8px',borderRadius:'20px',
              background:sourceCfg.bg,color:sourceCfg.color,fontWeight:'600'}}>{sourceCfg.label}</span>
          )}
        </div>
        {cpd ? (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px'}}>
            <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
              {[
                ['Parse Version', `v${cpd.parse_version}`],
                ['Last Parsed',   fmtDateTime(cpd.parsed_at)],
                ['Experience',    cpd.total_years_exp ? `${cpd.total_years_exp}yr` : '—'],
                ['Education',     cpd.education_level || '—'],
                ['Email (parsed)',cpd.extracted_email || '—'],
                ['Phone (parsed)',cpd.extracted_phone || '—'],
              ].map(([k,v]) => (
                <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f1f5f9',fontSize:'13px'}}>
                  <span style={{color:'#64748b'}}>{k}</span>
                  <span style={{fontWeight:'600',color:'#0f172a'}}>{v}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{fontSize:'12px',fontWeight:'600',color:'#64748b',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'10px'}}>
                Extracted Skills ({(cpd.extracted_skills||[]).length})
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
                {(cpd.extracted_skills as string[] || []).map((sk,i) => (
                  <span key={i} style={{padding:'4px 10px',borderRadius:'20px',fontSize:'12px',fontWeight:'600',
                    background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe'}}>{sk}</span>
                ))}
              </div>
              {!cpd.extracted_skills?.length && <p style={{color:'#94a3b8',fontSize:'13px'}}>No skills extracted</p>}
            </div>
          </div>
        ) : (
          <p style={{color:'#94a3b8',fontSize:'13px',textAlign:'center',padding:'20px 0'}}>No structured parse data yet.</p>
        )}
      </div>

      {/* Work history */}
      {(() => {
        const wh: any[] = files.find((f:any)=>f.work_history?.length)?.work_history || [];
        if (!wh.length) return null;
        return (
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'16px'}}>
              <Building2 size={16} style={{color:'#059669'}}/>
              <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',margin:0}}>Work History ({wh.length})</h3>
            </div>
            {wh.map((job:any, i:number) => (
              <div key={i} style={{display:'flex',gap:'16px',paddingBottom:'16px',borderLeft:'2px solid #e2e8f0',marginLeft:'8px',paddingLeft:'16px',position:'relative'}}>
                <div style={{position:'absolute',left:'-5px',top:'2px',width:'10px',height:'10px',borderRadius:'50%',
                  background:i===0?'#059669':'#94a3b8',border:'2px solid white'}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:'13px',fontWeight:'700',color:'#0f172a'}}>{job.title||'—'}</div>
                  <div style={{fontSize:'12px',color:'#374151',fontWeight:'600'}}>{job.company||'—'}</div>
                  <div style={{display:'flex',gap:'8px',marginTop:'4px'}}>
                    {(job.start_date||job.end_date) && (
                      <span style={{fontSize:'11px',color:'#64748b'}}>
                        {job.start_date||'?'} – {job.end_date||'Present'}
                      </span>
                    )}
                    {job.duration_months != null && (
                      <span style={{fontSize:'11px',padding:'1px 6px',borderRadius:'4px',background:'#f1f5f9',color:'#475569',fontWeight:'600'}}>
                        {Math.floor(job.duration_months/12)>0
                          ? `${Math.floor(job.duration_months/12)}y ${job.duration_months%12}m`
                          : `${job.duration_months}m`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Certifications */}
      {(() => {
        const allCerts: any[] = [];
        files.forEach((f:any) => (f.certifications||[]).forEach((c:any) => {
          const name = typeof c==='string'?c:c.name;
          if (name && !allCerts.find((x:any)=>(typeof x==='string'?x:x.name)===name)) allCerts.push(c);
        }));
        if (!allCerts.length) return null;
        return (
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px'}}>
              <Award size={16} style={{color:'#7c3aed'}}/>
              <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',margin:0}}>Certifications ({allCerts.length})</h3>
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
              {allCerts.map((c:any,i:number) => {
                const name = typeof c==='string'?c:c.name;
                const year = typeof c==='object'?c.year:null;
                return (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:'6px',padding:'6px 12px',borderRadius:'8px',background:'#f5f3ff',border:'1px solid #ddd6fe'}}>
                    <Award size={12} style={{color:'#7c3aed'}}/>
                    <span style={{fontSize:'12px',fontWeight:'600',color:'#5b21b6'}}>{name}</span>
                    {year && <span style={{fontSize:'11px',color:'#8b5cf6'}}>({year})</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Employment gaps */}
      {(() => {
        const gaps: any[] = files.find((f:any)=>f.employment_gaps?.length)?.employment_gaps || [];
        if (!gaps.length) return null;
        return (
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px'}}>
              <AlertTriangle size={16} style={{color:'#d97706'}}/>
              <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',margin:0}}>Employment Gaps ({gaps.length})</h3>
            </div>
            {gaps.map((g:any,i:number) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:'12px',padding:'10px 14px',
                background:'#fffbeb',borderRadius:'8px',border:'1px solid #fde68a',marginBottom:'6px'}}>
                <AlertTriangle size={14} style={{color:'#d97706',flexShrink:0}}/>
                <span style={{fontSize:'12px',fontWeight:'600',color:'#92400e'}}>{g.start} – {g.end}</span>
                {g.months != null && <span style={{fontSize:'11px',color:'#b45309'}}>{g.months} month{g.months!==1?'s':''}</span>}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Field confidence */}
      {(() => {
        const bestFile = files.find((f:any)=>f.field_confidence && Object.keys(f.field_confidence).length>0);
        const fc: Record<string,number> = bestFile?.field_confidence || {};
        const keys = Object.keys(fc).filter(k=>k!=='overall');
        if (!keys.length) return null;
        return (
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'14px'}}>
              <TrendingUp size={16} style={{color:'#0891b2'}}/>
              <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',margin:0}}>Field Extraction Confidence</h3>
              {fc.overall != null && (
                <span style={{marginLeft:'auto',fontSize:'12px',fontWeight:'700',
                  color:fc.overall>=0.7?'#059669':fc.overall>=0.4?'#d97706':'#dc2626'}}>
                  Overall: {Math.round(fc.overall*100)}%
                </span>
              )}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'10px'}}>
              {keys.map(field => {
                const val = Math.round((fc[field]||0)*100);
                const color = val>=70?'#059669':val>=40?'#d97706':'#dc2626';
                const bg    = val>=70?'#dcfce7':val>=40?'#fef3c7':'#fee2e2';
                return (
                  <div key={field} style={{padding:'10px 12px',background:bg,borderRadius:'8px'}}>
                    <div style={{fontSize:'11px',fontWeight:'600',color:'#64748b',textTransform:'capitalize',marginBottom:'6px'}}>{field.replace(/_/g,' ')}</div>
                    <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                      <div style={{flex:1,height:'6px',background:'rgba(0,0,0,0.1)',borderRadius:'3px'}}>
                        <div style={{height:'100%',borderRadius:'3px',background:color,width:`${val}%`}}/>
                      </div>
                      <span style={{fontSize:'12px',fontWeight:'700',color}}>{val}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Resume file history */}
      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'16px'}}>
          <History size={16} style={{color:'#7c3aed'}}/>
          <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',margin:0}}>
            Resume File History ({files.length} file{files.length!==1?'s':''})
          </h3>
        </div>
        {files.length === 0 ? (
          <p style={{color:'#94a3b8',fontSize:'13px'}}>No resume files processed yet.</p>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
              <thead>
                <tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                  {['File','Source','Routing','Conf.','Parsed Name','Skills','Date',''].map(h => (
                    <th key={h} style={{padding:'10px 12px',textAlign:'left',fontWeight:'600',
                      color:'#64748b',fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.05em',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((f:any, i:number) => {
                  const rc = ROUTING_CFG[f.routing_decision] || {label:f.routing_decision||'Unknown',color:'#64748b',bg:'#f1f5f9',icon:Clock};
                  const RIcon = rc.icon;
                  const topSkills: string[] = (f.parsed_skills||[]).slice(0,3);
                  return (
                    <tr key={f.id} style={{borderBottom:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa'}}>
                      <td style={{padding:'10px 12px',maxWidth:'180px'}}>
                        <div style={{fontSize:'12px',fontWeight:'600',color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={f.file_name}>{f.file_name||'—'}</div>
                        <div style={{fontSize:'11px',color:'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.source_email||'—'}</div>
                      </td>
                      <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                        <span style={{padding:'2px 8px',borderRadius:'12px',fontSize:'11px',fontWeight:'600',background:'#f1f5f9',color:'#475569'}}>{f.source||'—'}</span>
                      </td>
                      <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                        <span style={{display:'inline-flex',alignItems:'center',gap:'4px',padding:'3px 10px',borderRadius:'12px',fontSize:'11px',fontWeight:'700',background:rc.bg,color:rc.color}}>
                          <RIcon size={10}/>{rc.label}
                        </span>
                      </td>
                      <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                          <div style={{width:'40px',height:'6px',background:'#e2e8f0',borderRadius:'3px',overflow:'hidden'}}>
                            <div style={{height:'100%',borderRadius:'3px',width:`${Math.round(f.parse_confidence*100)}%`,
                              background:f.parse_confidence>=0.55?'#059669':f.parse_confidence>=0.35?'#d97706':'#dc2626'}}/>
                          </div>
                          <span style={{fontSize:'12px',fontWeight:'600',color:'#374151'}}>{Math.round(f.parse_confidence*100)}%</span>
                        </div>
                      </td>
                      <td style={{padding:'10px 12px',fontSize:'12px',color:'#374151',whiteSpace:'nowrap'}}>
                        {f.parsed_name||'—'}{f.parsed_exp&&<span style={{color:'#94a3b8',marginLeft:'4px'}}>· {f.parsed_exp}yr</span>}
                      </td>
                      <td style={{padding:'10px 12px',maxWidth:'200px'}}>
                        {topSkills.length>0 ? (
                          <div style={{display:'flex',flexWrap:'wrap',gap:'3px'}}>
                            {topSkills.map((sk:string,j:number) => (
                              <span key={j} style={{padding:'1px 6px',borderRadius:'4px',fontSize:'10px',fontWeight:'600',background:'#eff6ff',color:'#2563eb',whiteSpace:'nowrap'}}>{sk}</span>
                            ))}
                          </div>
                        ) : <span style={{color:'#94a3b8'}}>—</span>}
                      </td>
                      <td style={{padding:'10px 12px',fontSize:'11px',color:'#94a3b8',whiteSpace:'nowrap'}}>{fmtDate(f.created_at)}</td>
                      <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                        {f.id && (
                          <button onClick={() => downloadResume(f.id, f.file_name)}
                            style={{display:'inline-flex',alignItems:'center',gap:'4px',padding:'4px 10px',borderRadius:'6px',
                              border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'11px',fontWeight:'600',color:'#1e40af'}}>
                            <Download size={11}/> Download
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}



// ── Email Modal ──────────────────────────────────────────────────────────────
function EmailModal({ candidate, onClose }: { candidate: any; onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    try {
      await apiFetch('/communications/send', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: candidate.id,
          channel: 'email',
          subject: subject || 'Message from AVIIN Recruiters',
          message: body.trim(),
        }),
      });
      setSent(true);
      setTimeout(onClose, 1500);
    } catch (e: any) {
      alert(e?.message || 'Failed to send email');
      setSending(false);
    }
  }

  const overlay: React.CSSProperties = {
    position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,
    display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',
  };
  const panel: React.CSSProperties = {
    background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'520px',
    boxShadow:'0 20px 60px rgba(0,0,0,0.25)',
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
          <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>Send Email</h2>
          <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8',padding:'4px'}}>
            <X size={18}/>
          </button>
        </div>
        <div style={{fontSize:'13px',color:'#64748b',marginBottom:'16px'}}>
          To: <strong style={{color:'#0f172a'}}>{candidate.full_name}</strong>
          {candidate.email && <span> &lt;{candidate.email}&gt;</span>}
        </div>
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Subject (optional)"
          style={{width:'100%',padding:'10px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',
            fontSize:'13px',marginBottom:'12px',outline:'none',boxSizing:'border-box'}}
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write your message here..."
          rows={6}
          style={{width:'100%',padding:'10px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',
            fontSize:'13px',resize:'vertical',outline:'none',boxSizing:'border-box',fontFamily:'inherit',lineHeight:'1.6'}}
        />
        <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'16px'}}>
          <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',
            background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>
            Cancel
          </button>
          <button onClick={send} disabled={sending || !body.trim() || sent}
            style={{padding:'9px 18px',borderRadius:'8px',border:'none',
              background: sent ? '#16a34a' : sending || !body.trim() ? '#94a3b8' : '#1e40af',
              color:'white',cursor: sending || !body.trim() || sent ? 'not-allowed':'pointer',
              fontSize:'13px',fontWeight:'600'}}>
            {sent ? 'Sent!' : sending ? 'Sending...' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WhatsApp Modal ───────────────────────────────────────────────────────────
function WhatsAppModal({ candidate, onClose }: { candidate: any; onClose: () => void }) {
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const TEMPLATES = [
    'Hi {name}, we have shortlisted your profile for a role. Are you available for a quick call?',
    'Hi {name}, congratulations! Your interview has been scheduled. Please check your email for details.',
    'Hi {name}, thank you for your time. We will get back to you shortly.',
  ];

  async function send() {
    if (!msg.trim()) return;
    setSending(true);
    try {
      await apiFetch('/communications/send', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: candidate.id,
          channel: 'whatsapp',
          message: msg.trim(),
        }),
      });
      setSent(true);
      setTimeout(onClose, 1500);
    } catch (e: any) {
      alert(e?.message || 'Failed to send WhatsApp');
      setSending(false);
    }
  }

  const overlay: React.CSSProperties = {
    position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,
    display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'480px',
        boxShadow:'0 20px 60px rgba(0,0,0,0.25)'}} onClick={e => e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <div style={{width:'36px',height:'36px',background:'#25d366',borderRadius:'50%',
              display:'flex',alignItems:'center',justifyContent:'center'}}>
              <MessageCircle size={18} style={{color:'white'}}/>
            </div>
            <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>WhatsApp</h2>
          </div>
          <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8'}}>
            <X size={18}/>
          </button>
        </div>
        <div style={{fontSize:'13px',color:'#64748b',marginBottom:'12px'}}>
          To: <strong style={{color:'#0f172a'}}>{candidate.full_name}</strong>
          {candidate.phone && <span> ({candidate.phone})</span>}
          {!candidate.phone && <span style={{color:'#ef4444'}}> — no phone number</span>}
        </div>
        <div style={{marginBottom:'12px'}}>
          <p style={{fontSize:'11px',color:'#94a3b8',marginBottom:'6px',fontWeight:'600',textTransform:'uppercase'}}>Quick Templates</p>
          <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
            {TEMPLATES.map((t,i) => (
              <button key={i} onClick={() => setMsg(t.replace('{name}', candidate.full_name?.split(' ')[0] || 'there'))}
                style={{fontSize:'12px',padding:'8px 10px',background:'#f8fafc',border:'1px solid #e2e8f0',
                  borderRadius:'8px',cursor:'pointer',textAlign:'left',color:'#374151',lineHeight:'1.4'}}>
                {t.replace('{name}', candidate.full_name?.split(' ')[0] || 'there').slice(0, 70)}...
              </button>
            ))}
          </div>
        </div>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Type your message..."
          rows={4} style={{width:'100%',padding:'10px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',
            fontSize:'13px',resize:'vertical',outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}/>
        <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'14px'}}>
          <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',
            background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
          <button onClick={send} disabled={sending || !msg.trim() || sent || !candidate.phone}
            style={{padding:'9px 18px',borderRadius:'8px',border:'none',
              background: sent ? '#16a34a' : !candidate.phone || !msg.trim() || sending ? '#94a3b8' : '#25d366',
              color:'white',cursor: sending || !msg.trim() || sent || !candidate.phone ? 'not-allowed':'pointer',
              fontSize:'13px',fontWeight:'600'}}>
            {sent ? 'Sent!' : sending ? 'Sending...' : 'Send WhatsApp'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Interviews Panel ─────────────────────────────────────────────────────────
function InterviewsPanel({ candidateId, candidateName }: { candidateId: string; candidateName: string }) {
  const { data: interviews, loading, refetch } = useFetch<any[]>(`/interviews?candidate_id=${candidateId}`);
  const { data: reqs } = useFetch<any>('/requisitions?limit=100');
  const [schedOpen, setSchedOpen] = useState(false);
  const [form, setForm] = useState({
    interview_type: 'technical', mode: 'video', scheduled_at: '', duration_mins: 45,
    meeting_link: '', notes: '', requisition_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [reminding, setReminding] = useState<string|null>(null);

  async function sendReminder(interviewId: string) {
    setReminding(interviewId);
    try {
      await apiFetch(`/interviews/${interviewId}/send-reminder`, { method: 'POST' });
      alert('Reminder sent successfully!');
      refetch();
    } catch (e: any) {
      alert(e?.message || 'Failed to send reminder');
    } finally { setReminding(null); }
  }

  async function schedule() {
    if (!form.scheduled_at) { alert('Please select date & time'); return; }
    setSaving(true);
    try {
      await apiFetch('/interviews', {
        method: 'POST',
        body: JSON.stringify({ ...form, candidate_id: candidateId }),
      });
      setSchedOpen(false);
      setForm({ interview_type:'technical', mode:'video', scheduled_at:'', duration_mins:45, meeting_link:'', notes:'', requisition_id:'' });
      refetch();
    } catch (e: any) {
      alert(e?.message || 'Failed to schedule');
    } finally { setSaving(false); }
  }

  async function updateStatus(id: string, status: string, feedback?: string, rating?: number) {
    await apiFetch(`/interviews/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, feedback, rating }),
    });
    refetch();
  }

  function fmtDt(iso: string) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  const ST_CFG: Record<string,{color:string,bg:string}> = {
    scheduled:  {color:'#1d4ed8', bg:'#eff6ff'},
    completed:  {color:'#16a34a', bg:'#f0fdf4'},
    cancelled:  {color:'#dc2626', bg:'#fef2f2'},
    no_show:    {color:'#d97706', bg:'#fef3c7'},
  };

  const rows: any[] = Array.isArray(interviews) ? interviews : [];
  const reqList: any[] = Array.isArray(reqs?.data) ? reqs.data : Array.isArray(reqs) ? reqs : [];

  const overlay: React.CSSProperties = {
    position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,
    display:'flex',alignItems:'center',justifyContent:'center',padding:'20px',
  };

  return (
    <div style={{marginTop:'16px',display:'flex',flexDirection:'column',gap:'16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h3 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',margin:0}}>
          Interviews ({rows.length})
        </h3>
        <button onClick={() => setSchedOpen(true)}
          style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',borderRadius:'8px',
            border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
          <Calendar size={13}/> Schedule Interview
        </button>
      </div>

      {loading && <p style={{color:'#94a3b8',fontSize:'13px'}}>Loading...</p>}

      {!loading && rows.length === 0 && (
        <div style={{textAlign:'center',padding:'40px',background:'white',borderRadius:'12px',
          border:'1px solid #e2e8f0',color:'#94a3b8'}}>
          <div style={{fontSize:'32px',marginBottom:'8px'}}>📅</div>
          <p style={{fontSize:'13px'}}>No interviews scheduled yet.</p>
        </div>
      )}

      {rows.map((iv: any) => {
        const st = ST_CFG[iv.status] || {color:'#64748b',bg:'#f1f5f9'};
        return (
          <div key={iv.id} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'12px'}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'6px'}}>
                  <span style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',textTransform:'capitalize'}}>
                    {iv.interview_type} Interview
                  </span>
                  <span style={{fontSize:'11px',fontWeight:'700',padding:'3px 10px',borderRadius:'20px',
                    background:st.bg,color:st.color,textTransform:'capitalize'}}>{iv.status}</span>
                </div>
                <div style={{fontSize:'13px',color:'#64748b',display:'flex',flexWrap:'wrap',gap:'12px'}}>
                  <span>📅 {fmtDt(iv.scheduled_at)}</span>
                  <span>⏱ {iv.duration_mins} min</span>
                  <span style={{textTransform:'capitalize'}}>🎥 {iv.mode}</span>
                  {iv.role_title && <span>💼 {iv.role_title}</span>}
                  {iv.interviewer_name && <span>👤 {iv.interviewer_name}</span>}
                </div>
                {iv.meeting_link && (
                  <a href={iv.meeting_link} target="_blank" rel="noreferrer"
                    style={{fontSize:'12px',color:'#1e40af',textDecoration:'none',display:'inline-block',marginTop:'6px'}}>
                    🔗 Join Meeting
                  </a>
                )}
              </div>
              {iv.status === 'scheduled' && (
                <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                  <button onClick={() => sendReminder(iv.id)} disabled={reminding===iv.id}
                    style={{padding:'6px 12px',borderRadius:'6px',border:'1px solid #bfdbfe',background:'#eff6ff',
                      color:'#1d4ed8',cursor:reminding===iv.id?'not-allowed':'pointer',fontSize:'12px',fontWeight:'600'}}>
                    {reminding===iv.id ? '...' : '🔔 Remind'}
                  </button>
                  <button onClick={() => updateStatus(iv.id,'completed')}
                    style={{padding:'6px 12px',borderRadius:'6px',border:'none',background:'#16a34a',
                      color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600'}}>Done</button>
                  <button onClick={() => updateStatus(iv.id,'cancelled')}
                    style={{padding:'6px 12px',borderRadius:'6px',border:'1px solid #fee2e2',background:'white',
                      color:'#dc2626',cursor:'pointer',fontSize:'12px',fontWeight:'600'}}>Cancel</button>
                </div>
              )}
            </div>
            {iv.feedback && (
              <div style={{fontSize:'13px',color:'#374151',background:'#f8fafc',padding:'10px 12px',
                borderRadius:'8px',lineHeight:'1.5'}}>{iv.feedback}</div>
            )}
            {iv.rating && (
              <div style={{marginTop:'8px',fontSize:'13px',color:'#f59e0b'}}>
                {'★'.repeat(iv.rating)}{'☆'.repeat(5-iv.rating)} Rating: {iv.rating}/5
              </div>
            )}
          </div>
        );
      })}

      {schedOpen && (
        <div style={overlay} onClick={() => setSchedOpen(false)}>
          <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'500px',
            boxShadow:'0 20px 60px rgba(0,0,0,0.25)',maxHeight:'90vh',overflowY:'auto'}}
            onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
              <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>Schedule Interview</h2>
              <button onClick={() => setSchedOpen(false)} style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8'}}>
                <X size={18}/>
              </button>
            </div>
            <p style={{fontSize:'13px',color:'#64748b',marginBottom:'16px'}}>Candidate: <strong>{candidateName}</strong></p>
            {[
              { label:'Interview Type', field:'interview_type', type:'select',
                opts:[['screening','Screening'],['technical','Technical'],['hr','HR'],['client','Client'],['final','Final Round'],['panel','Panel']] },
              { label:'Mode', field:'mode', type:'select',
                opts:[['video','Video Call'],['phone','Phone Call'],['in_person','In-Person']] },
              { label:'Date & Time', field:'scheduled_at', type:'datetime-local', opts:[] },
              { label:'Duration (minutes)', field:'duration_mins', type:'number', opts:[] },
              { label:'Meeting Link', field:'meeting_link', type:'text', opts:[] },
            ].map(({ label, field, type, opts }) => (
              <div key={field} style={{marginBottom:'14px'}}>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>{label}</label>
                {type === 'select' ? (
                  <select value={(form as any)[field]}
                    onChange={e => setForm(f => ({...f, [field]: e.target.value}))}
                    style={{width:'100%',padding:'9px 10px',borderRadius:'8px',border:'1px solid #e2e8f0',fontSize:'13px',outline:'none'}}>
                    {opts.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : (
                  <input type={type} value={(form as any)[field]}
                    onChange={e => setForm(f => ({...f, [field]: type==='number' ? +e.target.value : e.target.value}))}
                    style={{width:'100%',padding:'9px 10px',borderRadius:'8px',border:'1px solid #e2e8f0',
                      fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
                )}
              </div>
            ))}
            {reqList.length > 0 && (
              <div style={{marginBottom:'14px'}}>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Link to Requisition (optional)</label>
                <select value={form.requisition_id}
                  onChange={e => setForm(f => ({...f, requisition_id: e.target.value}))}
                  style={{width:'100%',padding:'9px 10px',borderRadius:'8px',border:'1px solid #e2e8f0',fontSize:'13px',outline:'none'}}>
                  <option value="">None</option>
                  {reqList.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>
            )}
            <div style={{marginBottom:'16px'}}>
              <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                rows={3} placeholder="Any instructions for interviewer..."
                style={{width:'100%',padding:'9px 10px',borderRadius:'8px',border:'1px solid #e2e8f0',
                  fontSize:'13px',resize:'vertical',outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}/>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px'}}>
              <button onClick={() => setSchedOpen(false)}
                style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',
                  background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
              <button onClick={schedule} disabled={saving}
                style={{padding:'9px 18px',borderRadius:'8px',border:'none',
                  background: saving ? '#94a3b8' : '#1e40af',
                  color:'white',cursor: saving ? 'not-allowed':'pointer',fontSize:'13px',fontWeight:'600'}}>
                {saving ? 'Scheduling...' : 'Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Offers Panel ─────────────────────────────────────────────────────────────
function OffersPanel({ candidateId }: { candidateId: string }) {
  const { data: offers, loading, refetch } = useFetch<any[]>(`/auto-offer/candidate/${candidateId}`);
  const { data: appsData } = useFetch<any>(`/candidates/${candidateId}/applications`);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ application_id:'', ctc_offered:'', joining_date:'', currency:'INR' });
  const [saving, setSaving] = useState(false);
  const [viewLetter, setViewLetter] = useState<any>(null);

  const apps: any[] = Array.isArray(appsData) ? appsData : (appsData?.items || []);
  const rows: any[] = Array.isArray(offers) ? offers : [];

  const STATUS_CFG: Record<string,{color:string,bg:string}> = {
    draft:            {color:'#64748b',bg:'#f1f5f9'},
    pending_approval: {color:'#d97706',bg:'#fef3c7'},
    approved:         {color:'#0891b2',bg:'#ecfeff'},
    issued:           {color:'#1d4ed8',bg:'#eff6ff'},
    accepted:         {color:'#16a34a',bg:'#f0fdf4'},
    declined:         {color:'#dc2626',bg:'#fef2f2'},
  };

  const fmtCTC = (n: number, cur = 'INR') =>
    new Intl.NumberFormat('en-IN', {style:'currency',currency:cur,maximumFractionDigits:0}).format(n||0);
  const fmtDate = (s: string) => s ? new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—';

  async function createOffer() {
    if (!form.application_id || !form.ctc_offered || !form.joining_date) {
      alert('Application, CTC and joining date are required'); return;
    }
    setSaving(true);
    try {
      await apiFetch('/auto-offer/generate', {
        method:'POST',
        body: JSON.stringify({
          application_id: form.application_id,
          ctc_offered: Number(form.ctc_offered),
          joining_date: form.joining_date,
          currency: form.currency,
          generate_letter: true,
        }),
      });
      setCreateOpen(false);
      setForm({application_id:'',ctc_offered:'',joining_date:'',currency:'INR'});
      refetch();
    } catch (e: any) { alert(e?.message || 'Failed to create offer'); }
    finally { setSaving(false); }
  }

  const overlay: React.CSSProperties = {
    position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,
    display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',
  };

  return (
    <div style={{marginTop:'16px',display:'flex',flexDirection:'column',gap:'16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h3 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',margin:0}}>
          Offers ({rows.length})
        </h3>
        {apps.length > 0 && (
          <button onClick={() => setCreateOpen(true)}
            style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',borderRadius:'8px',
              border:'none',background:'#7c3aed',color:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600'}}>
            <Plus size={13}/> Create Offer
          </button>
        )}
      </div>

      {loading && <p style={{color:'#94a3b8',fontSize:'13px'}}>Loading...</p>}

      {!loading && rows.length === 0 && (
        <div style={{textAlign:'center',padding:'40px',background:'white',borderRadius:'12px',
          border:'1px solid #e2e8f0',color:'#94a3b8'}}>
          <div style={{fontSize:'32px',marginBottom:'8px'}}>📄</div>
          <p style={{fontSize:'13px'}}>No offers yet.{apps.length > 0 ? ' Click "Create Offer" to generate one.' : ' Create an application first.'}</p>
        </div>
      )}

      {rows.map((o: any) => {
        const st = STATUS_CFG[o.status] || {color:'#64748b',bg:'#f1f5f9'};
        return (
          <div key={o.id} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
              <div>
                <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'6px'}}>
                  <span style={{fontSize:'15px',fontWeight:'700',color:'#0f172a'}}>{o.job_title || 'Offer Letter'}</span>
                  <span style={{fontSize:'11px',fontWeight:'700',padding:'3px 10px',borderRadius:'20px',
                    background:st.bg,color:st.color,textTransform:'capitalize'}}>{o.status.replace('_',' ')}</span>
                </div>
                <div style={{fontSize:'13px',color:'#64748b',display:'flex',flexWrap:'wrap',gap:'14px'}}>
                  <span>💰 {fmtCTC(o.ctc_offered, o.currency)}</span>
                  <span>📅 Joining: {fmtDate(o.joining_date)}</span>
                  <span>🕒 Created: {fmtDate(o.created_at)}</span>
                </div>
              </div>
              {o.offer_letter_text && (
                <button onClick={() => setViewLetter(o)}
                  style={{padding:'7px 14px',borderRadius:'8px',border:'1px solid #e2e8f0',
                    background:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#374151'}}>
                  📄 View Letter
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Create Offer Modal */}
      {createOpen && (
        <div style={overlay} onClick={() => setCreateOpen(false)}>
          <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'440px',
            boxShadow:'0 20px 60px rgba(0,0,0,0.25)'}} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
              <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>Create Offer</h2>
              <button onClick={() => setCreateOpen(false)} style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8'}}><X size={18}/></button>
            </div>
            {[
              {label:'Application *', field:'application_id', type:'select'},
              {label:'CTC Offered (INR) *', field:'ctc_offered', type:'number'},
              {label:'Joining Date *', field:'joining_date', type:'date'},
            ].map(({label, field, type}) => (
              <div key={field} style={{marginBottom:'14px'}}>
                <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>{label}</label>
                {type === 'select' ? (
                  <select value={(form as any)[field]} onChange={e => setForm(f => ({...f,[field]:e.target.value}))}
                    style={{width:'100%',padding:'9px 10px',borderRadius:'8px',border:'1px solid #e2e8f0',fontSize:'13px',outline:'none'}}>
                    <option value="">Select application</option>
                    {apps.map((a:any) => (
                      <option key={a.id} value={a.id}>{a.job_title || a.requisition_title || a.id.slice(0,8)} ({a.stage})</option>
                    ))}
                  </select>
                ) : (
                  <input type={type} value={(form as any)[field]}
                    onChange={e => setForm(f => ({...f,[field]:e.target.value}))}
                    style={{width:'100%',padding:'9px 10px',borderRadius:'8px',border:'1px solid #e2e8f0',
                      fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
                )}
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'4px'}}>
              <button onClick={() => setCreateOpen(false)}
                style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',
                  background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
              <button onClick={createOffer} disabled={saving}
                style={{padding:'9px 18px',borderRadius:'8px',border:'none',
                  background: saving ? '#94a3b8':'#7c3aed',
                  color:'white',cursor: saving?'not-allowed':'pointer',fontSize:'13px',fontWeight:'600'}}>
                {saving ? 'Generating...' : 'Generate Offer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Letter Modal */}
      {viewLetter && (
        <div style={overlay} onClick={() => setViewLetter(null)}>
          <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'640px',
            maxHeight:'80vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.25)'}}
            onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'16px'}}>
              <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>Offer Letter — {viewLetter.job_title}</h2>
              <div style={{display:'flex',gap:'8px'}}>
                <button onClick={() => window.print()}
                  style={{padding:'7px 14px',borderRadius:'8px',border:'1px solid #e2e8f0',
                    background:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#374151'}}>
                  🖨 Print
                </button>
                <button onClick={() => setViewLetter(null)}
                  style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8',padding:'4px'}}><X size={18}/></button>
              </div>
            </div>
            <div style={{fontFamily:'Georgia,serif',fontSize:'13px',lineHeight:'1.8',color:'#374151',
              background:'#f8fafc',padding:'20px',borderRadius:'8px',whiteSpace:'pre-wrap'}}>
              {viewLetter.offer_letter_text}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notes / Activity Panel ────────────────────────────────────────────────────
function NotesPanel({ id }: { id: string }) {
  const { data: timeline, loading, refetch } = useFetch<any[]>(`/activities/${id}`);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  async function addNote() {
    if (!noteText.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/activities/${id}/note`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Note', description: noteText.trim() }),
      });
      setNoteText('');
      refetch();
    } catch (e: any) {
      alert(e?.message || 'Failed to save note');
    } finally { setSaving(false); }
  }

  function fmtAgo(iso: string) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d < 7) return d + 'd ago';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  const TYPE_CFG: Record<string, { color: string; bg: string; label: string }> = {
    note:         { color: '#1e40af', bg: '#eff6ff', label: 'Note' },
    call:         { color: '#059669', bg: '#d1fae5', label: 'Call' },
    email:        { color: '#7c3aed', bg: '#f5f3ff', label: 'Email' },
    stage_change: { color: '#d97706', bg: '#fef3c7', label: 'Stage' },
    interview:    { color: '#0891b2', bg: '#ecfeff', label: 'Interview' },
    offer:        { color: '#16a34a', bg: '#f0fdf4', label: 'Offer' },
  };

  const entries: any[] = Array.isArray(timeline) ? timeline : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '12px' }}>
          Add Note
        </h3>
        <textarea
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          placeholder="Log a call, add context, record interview feedback..."
          rows={3}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: '8px',
            border: '1px solid #e2e8f0', fontSize: '13px', resize: 'vertical',
            outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: '1.5',
          }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote(); }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Ctrl+Enter to save</span>
          <button
            onClick={addNote}
            disabled={saving || !noteText.trim()}
            style={{
              padding: '8px 18px', borderRadius: '8px', border: 'none',
              background: (saving || !noteText.trim()) ? '#94a3b8' : '#1e40af',
              color: 'white', cursor: (saving || !noteText.trim()) ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: '600',
            }}
          >
            {saving ? 'Saving...' : 'Save Note'}
          </button>
        </div>
      </div>

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '16px' }}>
          Activity Timeline ({entries.length})
        </h3>

        {loading && (
          <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Loading...</p>
        )}

        {!loading && entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📝</div>
            <p style={{ fontSize: '13px' }}>No activity yet. Add the first note above.</p>
          </div>
        )}

        {entries.map((entry: any, i: number) => {
          const cfg = TYPE_CFG[entry.activity_type] || { color: '#64748b', bg: '#f1f5f9', label: entry.activity_type };
          return (
            <div key={entry.id || i} style={{
              paddingBottom: '18px',
              borderLeft: i < entries.length - 1 ? '2px solid #e2e8f0' : '2px solid transparent',
              marginLeft: '8px', paddingLeft: '18px', position: 'relative',
            }}>
              <div style={{
                position: 'absolute', left: '-6px', top: '2px',
                width: '12px', height: '12px', borderRadius: '50%',
                background: cfg.color, border: '2px solid white',
              }}/>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '11px', fontWeight: '700', padding: '2px 8px',
                    borderRadius: '20px', background: cfg.bg, color: cfg.color,
                  }}>{cfg.label}</span>
                  {entry.title && entry.title !== 'Note' && (
                    <span style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{entry.title}</span>
                  )}
                  <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: 'auto' }}>
                    {entry.user_name || 'System'} &middot; {fmtAgo(entry.created_at)}
                  </span>
                </div>
                {entry.description && (
                  <p style={{
                    fontSize: '13px', color: '#374151', lineHeight: '1.6',
                    margin: 0, background: '#f8fafc', padding: '10px 12px',
                    borderRadius: '8px', whiteSpace: 'pre-wrap',
                  }}>{entry.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CandidateProfilePage() {
  const { id } = useParams<{id:string}>();
  const router = useRouter();
  const { data: candRaw, loading, refetch } = useFetch<any>(id ? `/candidates/${id}` : null);
  const { data: apps } = useFetch<any>(id ? `/candidates/${id}/applications` : null);
  const [cand, setCand] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [statusLinkOpen, setStatusLinkOpen] = useState(false);
  const [statusLink, setStatusLink] = useState('');
  const [statusLinkLoading, setStatusLinkLoading] = useState(false);
  const [statusLinkCopied, setStatusLinkCopied] = useState(false);

  async function generateStatusLink() {
    if (!candidate) return;
    setStatusLinkLoading(true);
    setStatusLinkOpen(true);
    setStatusLink('');
    try {
      const r = await apiFetch(`/candidate-status/generate-link/${candidate.id}`, { method: 'POST' });
      setStatusLink(r.url || '');
    } catch (e: any) {
      alert(e?.message || 'Failed to generate link');
      setStatusLinkOpen(false);
    } finally {
      setStatusLinkLoading(false);
    }
  }

  function copyStatusLink() {
    navigator.clipboard.writeText(statusLink);
    setStatusLinkCopied(true);
    setTimeout(() => setStatusLinkCopied(false), 2000);
  }
  const [activeTab, setActiveTab] = useState<string>('profile');

  // Use fetched data unless locally overridden by an edit
  const candidate = cand ?? candRaw;

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'300px',color:'#94a3b8',fontSize:'14px'}}>
      Loading candidate profile…
    </div>
  );
  if (!candidate || candidate.error) return (
    <div style={{padding:'48px',textAlign:'center',color:'#94a3b8'}}>
      Candidate not found.
      <br/>
      <button onClick={() => router.push('/candidates')}
        style={{marginTop:'12px',padding:'8px 16px',background:'#0f172a',color:'white',border:'none',borderRadius:'8px',cursor:'pointer',fontSize:'13px'}}>
        Back to Candidates
      </button>
    </div>
  );

  const skills: string[] = Array.isArray(candidate.skills) ? candidate.skills : [];
  const applications: any[] = Array.isArray(apps) ? apps : (apps?.items || []);
  const expMo = candidate.total_exp_mo || 0;
  const avatarBg = getAvatarColor(candidate.full_name);

  const TABS = [
    {key:'profile',       label:'Profile'},
    {key:'applications',  label:`Applications (${applications.length})`},
    {key:'interviews',    label:'Interviews'},
    {key:'offers',        label:'Offers'},
    {key:'notes',         label:'Notes & Activity'},
    {key:'parse-history', label:'Parse History'},
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'20px',maxWidth:'960px'}} suppressHydrationWarning>

      {editOpen && (
        <EditModal
          cand={candidate}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => { setCand(updated); setEditOpen(false); }}
        />
      )}

      {/* Back */}
      <button onClick={() => router.push('/candidates')}
        style={{display:'flex',alignItems:'center',gap:'6px',background:'none',border:'none',cursor:'pointer',color:'#64748b',fontSize:'13px',padding:0,width:'fit-content'}}>
        <ArrowLeft size={15}/> Back to Candidates
      </button>

      {/* Header card */}
      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'16px',padding:'28px',display:'flex',gap:'24px',alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{width:'72px',height:'72px',borderRadius:'50%',background:avatarBg,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'24px',fontWeight:'800',color:'white',flexShrink:0}}>
          {getInitials(candidate.full_name)}
        </div>
        <div style={{flex:1,minWidth:'200px'}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
            <div style={{flex:1}}>
              <h1 style={{fontSize:'22px',fontWeight:'800',color:'#0f172a',marginBottom:'2px'}}>{candidate.full_name}</h1>
              {candidate.current_designation && (
                <div style={{fontSize:'14px',color:'#374151',fontWeight:'600',marginBottom:'2px'}}>{candidate.current_designation}</div>
              )}
              <div style={{fontSize:'13px',color:'#64748b',marginBottom:'12px'}}>
                {candidate.current_employer || 'No current company'}
                {candidate.location ? <span> · <MapPin size={11} style={{display:'inline',verticalAlign:'middle'}}/> {candidate.location}</span> : ''}
              </div>
            </div>
            <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
              <button onClick={() => setEmailOpen(true)}
                style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',
                  border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',whiteSpace:'nowrap'}}>
                <Mail size={13}/> Email
              </button>
              <button onClick={() => setWaOpen(true)}
                style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',
                  border:'none',background:'#25d366',color:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',whiteSpace:'nowrap'}}>
                <MessageCircle size={13}/> WhatsApp
              </button>
              <button onClick={() => setEditOpen(true)}
                style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',
                  border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151',whiteSpace:'nowrap'}}>
                <Edit2 size={13}/> Edit
              </button>
              <button onClick={generateStatusLink}
                style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',
                  border:'none',background:'#7c3aed',color:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',whiteSpace:'nowrap'}}>
                <Share2 size={13}/> Share Status
              </button>
            </div>
          </div>

          <div style={{display:'flex',gap:'12px',flexWrap:'wrap'}}>
            {candidate.email && (
              <a href={`mailto:${candidate.email}`} style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'13px',color:'#3b82f6',textDecoration:'none'}}>
                <Mail size={13}/> {candidate.email}
              </a>
            )}
            {candidate.phone && (
              <a href={`tel:${candidate.phone}`} style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'13px',color:'#f59e0b',textDecoration:'none'}}>
                <Phone size={13}/> {candidate.phone}
              </a>
            )}
            {candidate.phone && (
              <a href={`https://wa.me/91${(candidate.phone||'').replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
                style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'13px',color:'#22c55e',textDecoration:'none'}}>
                <MessageCircle size={13}/> WhatsApp
              </a>
            )}
            {candidate.linkedin_url && (
              <a href={candidate.linkedin_url} target="_blank" rel="noreferrer"
                style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'13px',color:'#0a66c2',textDecoration:'none'}}>
                <Linkedin size={13}/> LinkedIn
              </a>
            )}
          </div>
        </div>

        {/* KPI chips */}
        <div style={{display:'flex',gap:'12px',flexWrap:'wrap'}}>
          {[
            {label:'Experience', value: expLabel(expMo)},
            {label:'Applications', value: applications.length},
            {label:'Source', value: candidate.source || '—'},
          ].map(({label,value}) => (
            <div key={label} style={{textAlign:'center',padding:'14px 18px',background:'#f8fafc',borderRadius:'12px',minWidth:'90px'}}>
              <div style={{fontSize:'18px',fontWeight:'800',color:'#0f172a'}}>{value}</div>
              <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px',textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Details grid */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>

        {/* Skills */}
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
          <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>Skills ({skills.length})</h3>
          {skills.length > 0 ? (
            <div style={{display:'flex',flexWrap:'wrap',gap:'8px'}}>
              {skills.map((sk,i) => (
                <span key={i} style={{padding:'5px 12px',borderRadius:'20px',fontSize:'12px',fontWeight:'600',
                  background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe'}}>{sk}</span>
              ))}
            </div>
          ) : <p style={{color:'#94a3b8',fontSize:'13px'}}>No skills listed</p>}
        </div>

        {/* Details */}
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
          <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>Details</h3>
          <div style={{display:'flex',flexDirection:'column',gap:'0'}}>
            {[
              ['Current CTC',     fmtCtc(candidate.current_ctc)],
              ['Expected CTC',    fmtCtc(candidate.expected_ctc)],
              ['Notice Period',   candidate.notice_period_days != null ? `${candidate.notice_period_days} days` : '—'],
              ['Location',        candidate.location || '—'],
              ['Source',          candidate.source || '—'],
              ['Added',           fmtDate(candidate.created_at)],
              ['Last Updated',    fmtDate(candidate.updated_at)],
            ].map(([label,value]) => (
              <div key={label} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #f1f5f9',fontSize:'13px'}}>
                <span style={{color:'#64748b'}}>{label}</span>
                <span style={{fontWeight:'600',color:'#0f172a'}}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div style={{borderBottom:'1px solid #e2e8f0',display:'flex',gap:'4px'}}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              style={{padding:'9px 18px',fontSize:'13px',fontWeight:'600',cursor:'pointer',border:'none',
                borderBottom:activeTab===tab.key?'2px solid #1e40af':'2px solid transparent',
                background:'transparent',color:activeTab===tab.key?'#1e40af':'#64748b'}}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Profile tab */}
        {activeTab==='profile' && (
          <div style={{marginTop:'16px',display:'flex',flexDirection:'column',gap:'16px'}}>
            <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
              <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>
                Application History ({applications.length})
              </h3>
              {applications.length === 0 ? (
                <p style={{color:'#94a3b8',fontSize:'13px'}}>No applications found</p>
              ) : applications.map((app:any, i:number) => {
                const stg = app.stage || 'sourced';
                const sc = STAGE_COLORS[stg] || {color:'#64748b',bg:'#f1f5f9'};
                return (
                  <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                    padding:'12px 16px',background:'#f8fafc',borderRadius:'10px',border:'1px solid #e2e8f0',marginBottom:'8px'}}>
                    <div>
                      <div style={{fontSize:'13px',fontWeight:'600',color:'#0f172a'}}>{app.requisition_title||'Requisition'}</div>
                      <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px'}}>Applied {fmtDate(app.created_at)}</div>
                    </div>
                    <span style={{padding:'4px 12px',borderRadius:'20px',fontSize:'11px',fontWeight:'700',
                      background:sc.bg,color:sc.color,textTransform:'capitalize'}}>{stg}</span>
                  </div>
                );
              })}
            </div>

            {candidate.resume_text && (
              <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
                <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>Resume Extract</h3>
                <pre style={{fontSize:'12px',color:'#475569',lineHeight:'1.6',whiteSpace:'pre-wrap',maxHeight:'240px',overflowY:'auto',margin:0}}>
                  {candidate.resume_text}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Applications tab */}
        {activeTab==='applications' && (
          <div style={{marginTop:'16px',background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>All Applications</h3>
            {applications.length === 0 ? (
              <p style={{color:'#94a3b8',fontSize:'13px'}}>No applications</p>
            ) : applications.map((a:any, i:number) => (
              <div key={a.id||i} style={{padding:'10px 0',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:'13px',fontWeight:'600',color:'#374151'}}>{a.requisition_title||'—'}</div>
                  <div style={{fontSize:'11px',color:'#94a3b8'}}>Applied {fmtDate(a.created_at)}</div>
                </div>
                <span style={{fontSize:'11px',padding:'3px 10px',borderRadius:'20px',
                  background:(STAGE_COLORS[a.stage]||{bg:'#f1f5f9'}).bg,
                  color:(STAGE_COLORS[a.stage]||{color:'#475569'}).color,
                  fontWeight:'700',textTransform:'capitalize'}}>{a.stage}</span>
              </div>
            ))}
          </div>
        )}

        {/* Notes tab */}
        {activeTab==='interviews' && id && <InterviewsPanel candidateId={id as string}/>}
        {activeTab==='offers' && id && <OffersPanel candidateId={id as string}/>}
        {activeTab==='notes' && id && <NotesPanel id={id as string}/>}

        {/* Parse History tab */}
        {activeTab==='parse-history' && id && <ParseHistoryPanel id={id as string}/>}
      </div>

      {statusLinkOpen && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,
          display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}
          onClick={() => setStatusLinkOpen(false)}>
          <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'460px',
            boxShadow:'0 20px 60px rgba(0,0,0,0.25)'}} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <div style={{width:'36px',height:'36px',background:'#7c3aed',borderRadius:'50%',
                  display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <Share2 size={16} style={{color:'white'}}/>
                </div>
                <div>
                  <h2 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',margin:0}}>Candidate Status Link</h2>
                  <p style={{fontSize:'12px',color:'#64748b',margin:0}}>Share with {candidate?.full_name?.split(' ')[0]}</p>
                </div>
              </div>
              <button onClick={() => setStatusLinkOpen(false)}
                style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8',padding:'4px'}}>
                <X size={18}/>
              </button>
            </div>

            {statusLinkLoading ? (
              <div style={{textAlign:'center',padding:'24px 0'}}>
                <div style={{width:'32px',height:'32px',border:'3px solid #e2e8f0',borderTopColor:'#7c3aed',
                  borderRadius:'50%',margin:'0 auto 10px',animation:'spin 0.8s linear infinite'}}/>
                <p style={{color:'#64748b',fontSize:'13px'}}>Generating link…</p>
              </div>
            ) : statusLink ? (
              <div>
                <p style={{fontSize:'13px',color:'#374151',marginBottom:'12px'}}>
                  This link lets the candidate track their application status in real-time.
                  It expires in <strong>30 days</strong>.
                </p>
                <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
                  <input readOnly value={statusLink}
                    style={{flex:1,padding:'10px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',
                      fontSize:'12px',color:'#374151',background:'#f8fafc',outline:'none',
                      overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}/>
                  <button onClick={copyStatusLink}
                    style={{display:'flex',alignItems:'center',gap:'6px',padding:'10px 14px',
                      borderRadius:'8px',border:'none',background: statusLinkCopied ? '#16a34a' : '#7c3aed',
                      color:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',whiteSpace:'nowrap'}}>
                    {statusLinkCopied ? <><CheckCheck size={13}/> Copied!</> : <><Copy size={13}/> Copy</>}
                  </button>
                </div>
                <div style={{display:'flex',gap:'8px'}}>
                  {candidate?.phone && (
                    <a href={`https://wa.me/91${(candidate.phone||'').replace(/\D/g,'')}?text=${encodeURIComponent('Hi ' + (candidate.full_name?.split(' ')[0]||'') + ', here is your application status link: ' + statusLink)}`}
                      target="_blank" rel="noreferrer"
                      style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'6px',
                        padding:'9px',borderRadius:'8px',background:'#25d366',color:'white',
                        textDecoration:'none',fontSize:'13px',fontWeight:'600'}}>
                      📱 Send via WhatsApp
                    </a>
                  )}
                  {candidate?.email && (
                    <a href={`mailto:${candidate.email}?subject=Your Application Status&body=${encodeURIComponent('Hi ' + (candidate.full_name?.split(' ')[0]||'') + ',\n\nYou can track your application status here:\n' + statusLink + '\n\nBest regards,\nAVIIN Jobs')}`}
                      style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:'6px',
                        padding:'9px',borderRadius:'8px',background:'#1e40af',color:'white',
                        textDecoration:'none',fontSize:'13px',fontWeight:'600'}}>
                      ✉️ Send via Email
                    </a>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
      {emailOpen && candidate && (
        <EmailModal candidate={candidate} onClose={() => setEmailOpen(false)} />
      )}
      {waOpen && candidate && (
        <WhatsAppModal candidate={candidate} onClose={() => setWaOpen(false)} />
      )}
    </div>
  );
}
