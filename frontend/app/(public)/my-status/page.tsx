'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, XCircle, Calendar, Video, Phone, MapPin, ChevronRight, RefreshCw } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

const STAGES = [
  'sourced','contacted','interested','nda','screened','submitted',
  'l1_interview','l2_interview','offer','offer_accepted','placed',
];
const STAGE_LABEL: Record<string,string> = {
  sourced:'Profile Sourced', contacted:'Contacted', interested:'Showed Interest',
  nda:'NDA / Pre-Contract', screened:'Screened', submitted:'Submitted to Client',
  l1_interview:'L1 Interview', l2_interview:'L2 Interview',
  offer:'Offer Released', offer_accepted:'Offer Accepted', placed:'Placed 🎉',
  rejected:'Not Moving Forward', hold:'On Hold',
};
const STAGE_COLOR: Record<string,{bg:string,text:string,ring:string}> = {
  placed:       {bg:'#d1fae5',text:'#065f46',ring:'#10b981'},
  offer_accepted:{bg:'#dbeafe',text:'#1e40af',ring:'#3b82f6'},
  offer:        {bg:'#ede9fe',text:'#5b21b6',ring:'#8b5cf6'},
  l2_interview: {bg:'#fef3c7',text:'#92400e',ring:'#f59e0b'},
  l1_interview: {bg:'#fef9c3',text:'#713f12',ring:'#eab308'},
  submitted:    {bg:'#f0fdf4',text:'#166534',ring:'#22c55e'},
  screened:     {bg:'#eff6ff',text:'#1e40af',ring:'#3b82f6'},
  hold:         {bg:'#fef3c7',text:'#92400e',ring:'#f59e0b'},
  rejected:     {bg:'#fee2e2',text:'#991b1b',ring:'#ef4444'},
};

function stageIdx(s: string) { return STAGES.indexOf(s); }

function MyStatusPageInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load(showRefresh = false) {
    if (!token) { setError('No status link provided.'); setLoading(false); return; }
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/candidate-status/public?token=${encodeURIComponent(token)}`);
      if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.detail||'Link expired or invalid'); }
      setData(await r.json());
      setError('');
    } catch (e: any) {
      setError(e.message || 'Unable to load status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [token]);

  if (loading) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc'}}>
      <div style={{textAlign:'center'}}>
        <div style={{width:'44px',height:'44px',border:'3px solid #e2e8f0',borderTopColor:'#3b82f6',
          borderRadius:'50%',margin:'0 auto 14px',animation:'spin 0.8s linear infinite'}}/>
        <p style={{color:'#64748b',fontSize:'14px'}}>Loading your application status…</p>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );

  if (error) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',padding:'20px'}}>
      <div style={{background:'white',borderRadius:'20px',padding:'40px 32px',maxWidth:'420px',width:'100%',
        textAlign:'center',boxShadow:'0 4px 32px rgba(0,0,0,0.08)'}}>
        <div style={{fontSize:'48px',marginBottom:'16px'}}>🔗</div>
        <h2 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a',marginBottom:'8px'}}>Link Unavailable</h2>
        <p style={{color:'#64748b',fontSize:'14px',lineHeight:'1.6'}}>{error}</p>
        <p style={{color:'#94a3b8',fontSize:'12px',marginTop:'16px'}}>
          Please contact your recruiter for an updated status link.
        </p>
      </div>
    </div>
  );

  const candidate = data?.candidate || {};
  const apps: any[] = data?.applications || [];
  const interviews: any[] = data?.upcoming_interviews || [];
  const msg = data?.message || '';

  const primaryApp = apps[0];
  const currentStage = primaryApp?.stage || '';
  const idx = stageIdx(currentStage);
  const isTerminal = currentStage === 'placed' || currentStage === 'rejected';
  const sc = STAGE_COLOR[currentStage] || {bg:'#f1f5f9',text:'#374151',ring:'#94a3b8'};

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#1e3a5f 0%,#1e40af 40%,#3730a3 100%)',
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-start',padding:'32px 16px 48px'}}>

      {/* Header */}
      <div style={{textAlign:'center',marginBottom:'28px',color:'white'}}>
        <div style={{fontSize:'32px',marginBottom:'8px'}}>🏢</div>
        <div style={{fontWeight:'800',fontSize:'22px',letterSpacing:'-0.5px'}}>AVIIN JOBS</div>
        <div style={{fontSize:'13px',opacity:0.75,marginTop:'2px'}}>Application Status Portal</div>
      </div>

      <div style={{width:'100%',maxWidth:'560px',display:'flex',flexDirection:'column',gap:'16px'}}>

        {/* Candidate card */}
        <div style={{background:'white',borderRadius:'20px',padding:'24px',
          boxShadow:'0 8px 32px rgba(0,0,0,0.12)'}}>
          <div style={{display:'flex',alignItems:'center',gap:'14px',marginBottom:'16px'}}>
            <div style={{width:'52px',height:'52px',borderRadius:'50%',
              background:'linear-gradient(135deg,#1e40af,#3730a3)',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:'22px',fontWeight:'700',color:'white',flexShrink:0}}>
              {(candidate.name||'?')[0].toUpperCase()}
            </div>
            <div>
              <div style={{fontWeight:'700',fontSize:'18px',color:'#0f172a'}}>{candidate.name || 'Candidate'}</div>
              {candidate.email && (
                <div style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>{candidate.email}</div>
              )}
            </div>
            <button onClick={() => load(true)}
              style={{marginLeft:'auto',background:'#f1f5f9',border:'none',borderRadius:'50%',
                width:'36px',height:'36px',display:'flex',alignItems:'center',justifyContent:'center',
                cursor:'pointer',flexShrink:0}} title="Refresh">
              <RefreshCw size={14} style={{color:'#64748b',animation:refreshing?'spin 0.8s linear infinite':undefined}}/>
            </button>
          </div>

          {/* Current status badge */}
          {primaryApp && (
            <div style={{padding:'12px 16px',borderRadius:'12px',background:sc.bg,border:`1px solid ${sc.ring}`,
              display:'flex',alignItems:'center',gap:'10px'}}>
              {currentStage === 'placed' ? <CheckCircle2 size={18} style={{color:sc.ring,flexShrink:0}}/>
               : currentStage === 'rejected' ? <XCircle size={18} style={{color:sc.ring,flexShrink:0}}/>
               : <Clock size={18} style={{color:sc.ring,flexShrink:0}}/>}
              <div>
                <div style={{fontSize:'12px',fontWeight:'600',color:sc.text,textTransform:'uppercase',letterSpacing:'0.5px'}}>
                  Current Status
                </div>
                <div style={{fontSize:'15px',fontWeight:'700',color:sc.text,marginTop:'2px'}}>
                  {STAGE_LABEL[currentStage] || currentStage}
                </div>
                {primaryApp.role && (
                  <div style={{fontSize:'12px',color:sc.text,opacity:0.8,marginTop:'2px'}}>
                    {primaryApp.role}
                  </div>
                )}
              </div>
              {primaryApp.updated && (
                <div style={{marginLeft:'auto',fontSize:'11px',color:sc.text,opacity:0.7,whiteSpace:'nowrap'}}>
                  {primaryApp.updated}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Stage progress (for non-terminal stages) */}
        {primaryApp && !isTerminal && idx >= 0 && (
          <div style={{background:'white',borderRadius:'20px',padding:'24px',
            boxShadow:'0 4px 16px rgba(0,0,0,0.08)'}}>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'16px',
              display:'flex',alignItems:'center',gap:'8px'}}>
              <span>📋</span> Your Journey
            </h3>
            <div style={{position:'relative'}}>
              {/* Progress line */}
              <div style={{position:'absolute',left:'15px',top:'8px',bottom:'8px',width:'2px',
                background:'#e2e8f0',zIndex:0}}/>
              <div style={{position:'absolute',left:'15px',top:'8px',
                height:`${Math.min(100, ((idx) / (STAGES.length - 1)) * 100)}%`,
                width:'2px',background:'#3b82f6',zIndex:1,transition:'height 0.6s ease'}}/>
              <div style={{display:'flex',flexDirection:'column',gap:'0'}}>
                {STAGES.filter(s => {
                  // Show stages up to 2 ahead and all completed ones
                  const si = stageIdx(s);
                  return si <= idx + 2;
                }).map((s, i) => {
                  const si = stageIdx(s);
                  const done = si < idx;
                  const current = si === idx;
                  const upcoming = si > idx;
                  return (
                    <div key={s} style={{display:'flex',alignItems:'center',gap:'12px',
                      padding:'8px 0',position:'relative',zIndex:2}}>
                      <div style={{width:'30px',height:'30px',borderRadius:'50%',flexShrink:0,
                        background: done ? '#3b82f6' : current ? '#1e40af' : '#f1f5f9',
                        border: current ? '3px solid #93c5fd' : done ? '2px solid #3b82f6' : '2px solid #e2e8f0',
                        display:'flex',alignItems:'center',justifyContent:'center',
                        boxShadow: current ? '0 0 0 4px rgba(59,130,246,0.2)' : undefined}}>
                        {done ? <CheckCircle2 size={14} style={{color:'white'}}/>
                               : current ? <div style={{width:'8px',height:'8px',borderRadius:'50%',background:'white'}}/>
                               : <div style={{width:'6px',height:'6px',borderRadius:'50%',background:'#cbd5e1'}}/>}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:'13px',fontWeight: current ? '700' : done ? '500' : '400',
                          color: current ? '#0f172a' : done ? '#374151' : '#94a3b8'}}>
                          {STAGE_LABEL[s] || s}
                        </div>
                        {current && (
                          <div style={{fontSize:'11px',color:'#3b82f6',fontWeight:'600',marginTop:'1px'}}>
                            ← You are here
                          </div>
                        )}
                      </div>
                      {done && <CheckCircle2 size={14} style={{color:'#3b82f6',flexShrink:0}}/>}
                      {upcoming && <ChevronRight size={14} style={{color:'#cbd5e1',flexShrink:0}}/>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Upcoming Interviews */}
        {interviews.length > 0 && (
          <div style={{background:'white',borderRadius:'20px',padding:'24px',
            boxShadow:'0 4px 16px rgba(0,0,0,0.08)'}}>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'16px',
              display:'flex',alignItems:'center',gap:'8px'}}>
              <Calendar size={16} style={{color:'#3b82f6'}}/> Upcoming Interviews
            </h3>
            <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
              {interviews.map((iv: any, i: number) => (
                <div key={i} style={{padding:'14px 16px',borderRadius:'12px',
                  background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'6px'}}>
                    {iv.mode === 'video' ? <Video size={14} style={{color:'#6366f1'}}/>
                                         : <Phone size={14} style={{color:'#22c55e'}}/>}
                    <span style={{fontSize:'13px',fontWeight:'600',color:'#0f172a',textTransform:'capitalize'}}>
                      {iv.type || 'Technical'} Interview
                    </span>
                    <span style={{marginLeft:'auto',fontSize:'11px',padding:'2px 8px',borderRadius:'12px',
                      background: iv.mode === 'video' ? '#ede9fe' : '#d1fae5',
                      color: iv.mode === 'video' ? '#5b21b6' : '#065f46',fontWeight:'600',textTransform:'capitalize'}}>
                      {iv.mode || 'video'}
                    </span>
                  </div>
                  <div style={{fontSize:'13px',color:'#374151',display:'flex',alignItems:'center',gap:'6px'}}>
                    <Clock size={12} style={{color:'#64748b'}}/> {iv.when || '—'}
                  </div>
                  {iv.link && (
                    <a href={iv.link} target="_blank" rel="noreferrer"
                      style={{display:'inline-flex',alignItems:'center',gap:'5px',marginTop:'8px',
                        padding:'6px 12px',borderRadius:'8px',background:'#6366f1',color:'white',
                        textDecoration:'none',fontSize:'12px',fontWeight:'600'}}>
                      Join Meeting
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Multiple applications */}
        {apps.length > 1 && (
          <div style={{background:'white',borderRadius:'20px',padding:'24px',
            boxShadow:'0 4px 16px rgba(0,0,0,0.08)'}}>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'16px'}}>
              All Applications ({apps.length})
            </h3>
            <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
              {apps.map((app: any, i: number) => {
                const c = STAGE_COLOR[app.stage] || {bg:'#f1f5f9',text:'#374151',ring:'#e2e8f0'};
                return (
                  <div key={i} style={{display:'flex',alignItems:'center',gap:'12px',
                    padding:'12px 14px',borderRadius:'10px',background:c.bg,border:`1px solid ${c.ring}`}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:'13px',fontWeight:'600',color:c.text}}>{app.role || 'Role'}</div>
                      <div style={{fontSize:'11px',color:c.text,opacity:0.8,marginTop:'2px'}}>
                        {STAGE_LABEL[app.stage] || app.stage}
                      </div>
                    </div>
                    <div style={{fontSize:'11px',color:c.text,opacity:0.7,whiteSpace:'nowrap'}}>
                      {app.updated}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Message */}
        {msg && (
          <div style={{background:'rgba(255,255,255,0.12)',backdropFilter:'blur(10px)',
            borderRadius:'14px',padding:'16px 20px',border:'1px solid rgba(255,255,255,0.2)'}}>
            <p style={{color:'rgba(255,255,255,0.9)',fontSize:'13px',lineHeight:'1.6',margin:0,textAlign:'center'}}>
              💬 {msg}
            </p>
          </div>
        )}

        {/* Footer */}
        <div style={{textAlign:'center',color:'rgba(255,255,255,0.5)',fontSize:'11px'}}>
          Powered by AVIIN ATS · This link expires in 30 days
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export default function MyStatusPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
      <MyStatusPageInner />
    </Suspense>
  );
}
