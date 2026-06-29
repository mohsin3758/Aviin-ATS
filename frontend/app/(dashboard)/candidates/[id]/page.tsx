'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { ArrowLeft, Mail, Phone, MessageCircle, Briefcase, MapPin, Star, Calendar, FileText, Award, ChevronRight } from 'lucide-react';

const STAGE_COLORS: Record<string,{color:string,bg:string}> = {
  sourced:   {color:'#64748b',bg:'#f1f5f9'},
  screened:  {color:'#2563eb',bg:'#eff6ff'},
  submitted: {color:'#7c3aed',bg:'#f5f3ff'},
  interview: {color:'#d97706',bg:'#fffbeb'},
  offer:     {color:'#0891b2',bg:'#ecfeff'},
  placed:    {color:'#16a34a',bg:'#f0fdf4'},
  rejected:  {color:'#dc2626',bg:'#fef2f2'},
};

const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
function getAvatarColor(n: string) { return AVATAR_COLORS[(n||'').charCodeAt(0) % AVATAR_COLORS.length]; }
function getInitials(n: string) { return (n||'??').split(' ').map((x:string)=>x[0]).join('').slice(0,2).toUpperCase(); }
function expLabel(mo: number) {
  if (!mo) return 'Fresher';
  const y = Math.floor(mo/12), m = mo%12;
  return y>0 ? (m>0 ? `${y}y ${m}m` : `${y} year${y>1?'s':''}`) : `${m} months`;
}

export default function CandidateProfilePage() {
  const { id } = useParams<{id:string}>();
  const [activeTab, setActiveTab] = useState<string>('profile');
  const router = useRouter();
  const { data: cand, loading } = useFetch<any>(id ? `/candidates/${id}` : null);
  const { data: apps } = useFetch<any>(id ? `/candidates/${id}/applications` : null);

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'300px', color:'#94a3b8', fontSize:'14px' }}>
      Loading candidate profile...
    </div>
  );

  if (!cand || cand.error) return (
    <div style={{ padding:'48px', textAlign:'center', color:'#94a3b8' }}>
      Candidate not found.
      <br/>
      <button onClick={()=>router.push('/candidates')} style={{ marginTop:'12px', padding:'8px 16px', background:'#0f172a', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontSize:'13px' }}>
        Back to Candidates
      </button>
    </div>
  );

  const skills: string[] = Array.isArray(cand.skills) ? cand.skills : [];
  const applications: any[] = Array.isArray(apps) ? apps : (apps?.items || []);
  const expMo = cand.total_exp_mo || 0;
  const avatarBg = getAvatarColor(cand.full_name);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'20px', maxWidth:'960px' }} suppressHydrationWarning>
      {/* Back button */}
      <button onClick={()=>router.push('/pipeline')} style={{ display:'flex', alignItems:'center', gap:'6px', background:'none', border:'none', cursor:'pointer', color:'#64748b', fontSize:'13px', padding:0, width:'fit-content' }}>
        <ArrowLeft size={15}/> Back to Pipeline
      </button>

      {/* Header card */}
      <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'16px', padding:'28px', display:'flex', gap:'24px', alignItems:'flex-start', flexWrap:'wrap' }}>
        {/* Avatar */}
        <div style={{ width:'72px', height:'72px', borderRadius:'50%', background:avatarBg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'24px', fontWeight:'800', color:'white', flexShrink:0 }}>
          {getInitials(cand.full_name)}
        </div>
        {/* Info */}
        <div style={{ flex:1, minWidth:'200px' }}>
          <h1 style={{ fontSize:'22px', fontWeight:'800', color:'#0f172a', marginBottom:'4px' }}>{cand.full_name}</h1>
          <div style={{ fontSize:'14px', color:'#64748b', marginBottom:'12px' }}>
            {cand.current_employer || 'No current company'}{cand.location ? ` · ${cand.location}` : ''}
          </div>
          <div style={{ display:'flex', gap:'12px', flexWrap:'wrap' }}>
            {cand.email && (
              <a href={`mailto:${cand.email}`} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'#3b82f6', textDecoration:'none' }}>
                <Mail size={13}/> {cand.email}
              </a>
            )}
            {cand.phone && (
              <a href={`tel:${cand.phone}`} style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'#f59e0b', textDecoration:'none' }}>
                <Phone size={13}/> {cand.phone}
              </a>
            )}
            {cand.phone && (
              <a href={`https://wa.me/91${(cand.phone||'').replace(/\D/g,'')}`} target="_blank" style={{ display:'flex', alignItems:'center', gap:'5px', fontSize:'13px', color:'#22c55e', textDecoration:'none' }}>
                <MessageCircle size={13}/> WhatsApp
              </a>
            )}
          </div>
        </div>
        {/* Stats */}
        <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' }}>
          {[
            { label:'Experience', value: expLabel(expMo), icon: Briefcase },
            { label:'Source', value: cand.source || '—', icon: Star },
            { label:'Applications', value: applications.length, icon: FileText },
          ].map(({label, value, icon: Icon}) => (
            <div key={label} style={{ textAlign:'center', padding:'14px 18px', background:'#f8fafc', borderRadius:'12px', minWidth:'90px' }}>
              <div style={{ fontSize:'18px', fontWeight:'800', color:'#0f172a' }}>{value}</div>
              <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'2px', textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
        {/* Skills */}
        <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'12px', padding:'20px' }}>
          <h3 style={{ fontSize:'14px', fontWeight:'700', color:'#0f172a', marginBottom:'14px' }}>Skills</h3>
          {skills.length > 0 ? (
            <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
              {skills.map((sk:string, i:number) => (
                <span key={i} style={{ padding:'5px 12px', borderRadius:'20px', fontSize:'12px', fontWeight:'600', background:'#eff6ff', color:'#2563eb', border:'1px solid #bfdbfe' }}>{sk}</span>
              ))}
            </div>
          ) : <p style={{ color:'#94a3b8', fontSize:'13px' }}>No skills listed</p>}
        </div>

        {/* Source & Meta */}
        <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'12px', padding:'20px' }}>
          <h3 style={{ fontSize:'14px', fontWeight:'700', color:'#0f172a', marginBottom:'14px' }}>Details</h3>
          {[
            { label:'Current Company', value: cand.current_employer || '—' },
            { label:'Location', value: cand.location || '—' },
            { label:'Source', value: cand.source || '—' },
            { label:'Added', value: cand.created_at ? new Date(cand.created_at).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) : '—' },
          ].map(({label, value}) => (
            <div key={label} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #f1f5f9', fontSize:'13px' }}>
              <span style={{ color:'#64748b' }}>{label}</span>
              <span style={{ fontWeight:'600', color:'#0f172a' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Applications / Pipeline history */}
        <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'12px', padding:'20px', gridColumn:'1/-1' }}>
          <h3 style={{ fontSize:'14px', fontWeight:'700', color:'#0f172a', marginBottom:'14px' }}>Application History ({applications.length})</h3>
          {applications.length === 0 ? (
            <p style={{ color:'#94a3b8', fontSize:'13px' }}>No applications found</p>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {applications.map((app:any, i:number) => {
                const stg = app.stage || 'sourced';
                const sc = STAGE_COLORS[stg] || {color:'#64748b',bg:'#f1f5f9'};
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', background:'#f8fafc', borderRadius:'10px', border:'1px solid #e2e8f0' }}>
                    <div>
                      <div style={{ fontSize:'13px', fontWeight:'600', color:'#0f172a' }}>{app.requisition_title || app.requisition_id || 'Requisition'}</div>
                      <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'2px' }}>
                        Applied {app.created_at ? new Date(app.created_at).toLocaleDateString('en-IN') : '—'}
                      </div>
                    </div>
                    <span style={{ padding:'4px 12px', borderRadius:'20px', fontSize:'11px', fontWeight:'700', background:sc.bg, color:sc.color, textTransform:'capitalize' }}>
                      {stg}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Resume */}
        {cand.resume_text && (
          <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:'12px', padding:'20px', gridColumn:'1/-1' }}>
            <h3 style={{ fontSize:'14px', fontWeight:'700', color:'#0f172a', marginBottom:'14px' }}>Resume Extract</h3>
            <pre style={{ fontSize:'12px', color:'#475569', lineHeight:'1.6', whiteSpace:'pre-wrap', maxHeight:'200px', overflowY:'auto' }}>{cand.resume_text}</pre>
          </div>
        )}
      </div>

      <div style={{marginTop:'24px',borderBottom:'1px solid #e2e8f0',display:'flex',gap:'4px'}}>
        {(['profile','applications','assessment']).map((tab:string)=>(<button key={tab} data-tab={tab} onClick={()=>setActiveTab(tab)} style={{padding:'9px 18px',fontSize:'13px',fontWeight:'600',cursor:'pointer',border:'none',borderBottom:activeTab===tab?'2px solid #1e40af':'2px solid transparent',background:'transparent',color:activeTab===tab?'#1e40af':'#64748b'}}>{tab.charAt(0).toUpperCase()+tab.slice(1)}</button>))}
      </div>
      {activeTab==='profile'&&(<div data-testid="profile-panel" style={{marginTop:'16px',padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0'}}><h3 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',marginBottom:'12px'}}>Profile</h3><p style={{fontSize:'13px',color:'#374151'}}>{cand?.full_name||'Loading...'}</p></div>)}
      {activeTab==='applications'&&(<div data-testid="applications-panel" style={{marginTop:'16px',padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0'}}><h3 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',marginBottom:'12px'}}>Applications</h3>{(apps||[]).length===0?<p style={{color:'#94a3b8',fontSize:'13px'}}>No applications</p>:(apps||[]).map((a:any)=>(<div key={a.id} style={{padding:'8px 0',borderBottom:'1px solid #f1f5f9'}}><span style={{fontSize:'13px'}}>{a.requisition_title||'—'}</span> <span style={{fontSize:'11px',padding:'2px 8px',borderRadius:'8px',background:'#eff6ff',color:'#1e40af'}}>{a.stage}</span></div>))}</div>)}
      {activeTab==='assessment'&&(<div data-testid="assessment-panel" style={{marginTop:'16px',padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0'}}><h3 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',marginBottom:'12px'}}>Assessment</h3><p style={{color:'#94a3b8',fontSize:'13px'}}>No assessments</p></div>)}
    </div>
  );
}
