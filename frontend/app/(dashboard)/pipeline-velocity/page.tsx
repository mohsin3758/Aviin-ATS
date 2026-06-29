'use client';
import { useState } from 'react';
import { useFetch } from '@/lib/useFetch';
import { TrendingUp, Clock, ArrowRight, AlertTriangle, CheckCircle, Activity } from 'lucide-react';

const STAGES = [
  { key:'sourced',   label:'Sourced',    color:'#64748b', bg:'#f1f5f9' },
  { key:'screened',  label:'Screened',   color:'#2563eb', bg:'#eff6ff' },
  { key:'submitted', label:'Submitted',  color:'#7c3aed', bg:'#f5f3ff' },
  { key:'interview', label:'Interview',  color:'#d97706', bg:'#fffbeb' },
  { key:'offer',     label:'Offer',      color:'#0891b2', bg:'#ecfeff' },
  { key:'placed',    label:'Placed',     color:'#16a34a', bg:'#f0fdf4' },
  { key:'rejected',  label:'Rejected',   color:'#dc2626', bg:'#fef2f2' },
];

const SLA_DAYS:Record<string,number> = {
  sourced:7, screened:5, submitted:3, interview:7, offer:5, placed:999, rejected:999
};

export default function PipelineVelocityPage() {
  const { data: analytics, loading } = useFetch<any[]>('/pipeline/stage-analytics');
  const { data: metrics } = useFetch<any>('/pipeline/metrics');
  const { data: audit } = useFetch<any[]>('/pipeline/audit');
  const rows: any[] = Array.isArray(analytics) ? analytics : [];
  const moves: any[] = Array.isArray(audit) ? audit : [];

  const totalCands = metrics?.total_candidates || 0;
  const totalMoves = moves.length;
  const autoMoves = moves.filter((m:any) => m.by === 'rule_engine' || m.by === 'scheduler').length;
  const manualMoves = totalMoves - autoMoves;

  return (
    <div className="anim-fade-up" style={{display:'flex',flexDirection:'column',gap:'24px'}}>
      <div>
        <h1 style={{fontSize:'20px',fontWeight:'800',color:'#0f172a',marginBottom:'2px'}}>Pipeline Velocity</h1>
        <p style={{fontSize:'13px',color:'#64748b'}}>Time candidates spend in each stage · SLA health · Automation stats</p>
      </div>

      {/* Summary KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'14px'}}>
        {[
          {l:'Total Candidates',v:totalCands,c:'#3b82f6',i:Activity},
          {l:'Stage Moves (audit)',v:totalMoves,c:'#8b5cf6',i:ArrowRight},
          {l:'Auto-Moved',v:autoMoves,c:'#22c55e',i:CheckCircle},
          {l:'Manual Moves',v:manualMoves,c:'#f59e0b',i:TrendingUp},
        ].map(({l,v,c,i:Icon})=>(
          <div key={l} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'18px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
              <div style={{width:'36px',height:'36px',borderRadius:'8px',background:`${c}15`,display:'flex',alignItems:'center',justifyContent:'center'}}>
                <Icon size={16} color={c}/>
              </div>
              <div style={{fontSize:'11px',fontWeight:'600',color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em'}}>{l}</div>
            </div>
            <div style={{fontSize:'28px',fontWeight:'800',color:'#0f172a'}}>{v}</div>
          </div>))}
      </div>

      {/* Stage velocity grid */}
      <div>
        <h2 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>Stage Performance</h2>
        {loading?<div style={{textAlign:'center',padding:'48px',color:'#94a3b8'}}>Loading...</div>:(
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'12px'}}>
            {STAGES.map(st=>{
              const d=rows.find((r:any)=>r.stage===st.key)||{count:0,avg_days:0,stale_count:0,conversion_rate:0,sla_status:'ok'};
              const sla=SLA_DAYS[st.key]||7;
              const slaOk=d.avg_days<=sla;
              const slaWarn=!slaOk&&d.avg_days<=sla*1.5;
              const slaBreach=!slaOk&&!slaWarn;
              const slaColor=slaOk?'#22c55e':slaWarn?'#f59e0b':'#ef4444';
              const slaLabel=slaOk?'On Track':slaWarn?'Slow':'Breach';
              return(
                <div key={st.key} style={{background:'white',border:`1px solid ${st.color}20`,borderRadius:'12px',padding:'16px',borderTop:`3px solid ${st.color}`}}>
                  <div style={{fontSize:'11px',fontWeight:'800',color:st.color,textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'14px'}}>{st.label}</div>
                  <div style={{fontSize:'28px',fontWeight:'800',color:'#0f172a',marginBottom:'4px'}}>{d.count}</div>
                  <div style={{fontSize:'11px',color:'#64748b',marginBottom:'12px'}}>candidates</div>
                  <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                    <div style={{background:'#f8fafc',borderRadius:'7px',padding:'8px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',marginBottom:'4px'}}>
                        <span style={{color:'#64748b'}}>Avg Time</span>
                        <span style={{fontWeight:'700',color:'#0f172a'}}>{d.avg_days || 0}d</span>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',marginBottom:'4px'}}>
                        <span style={{color:'#64748b'}}>SLA Limit</span>
                        <span style={{fontWeight:'600',color:'#475569'}}>{sla === 999 ? '—' : `${sla}d`}</span>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',marginBottom:'4px'}}>
                        <span style={{color:'#64748b'}}>Conversion</span>
                        <span style={{fontWeight:'700',color:'#0f172a'}}>{d.conversion_rate || 0}%</span>
                      </div>
                      {d.stale_count>0&&(
                        <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'10px',color:'#ef4444',marginTop:'4px'}}>
                          <AlertTriangle size={10}/> {d.stale_count} stale (7d+)
                        </div>)}
                    </div>
                    {sla !== 999 && (
                      <div style={{display:'flex',alignItems:'center',gap:'5px',padding:'5px 8px',borderRadius:'6px',background:`${slaColor}15`,border:`1px solid ${slaColor}30`}}>
                        <div style={{width:'6px',height:'6px',borderRadius:'50%',background:slaColor,flexShrink:0}}/>
                        <span style={{fontSize:'10px',fontWeight:'700',color:slaColor}}>{slaLabel}</span>
                      </div>)}
                  </div>
                </div>);})}
          </div>)}
      </div>

      {/* Funnel visualization */}
      <div>
        <h2 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>Pipeline Funnel</h2>
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
          {STAGES.slice(0,6).map((st,i)=>{
            const d=rows.find((r:any)=>r.stage===st.key)||{count:0};
            const maxCount=Math.max(...rows.map((r:any)=>r.count||0),1);
            const pct=Math.round((d.count/maxCount)*100);
            return(
              <div key={st.key} style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'10px'}}>
                <div style={{width:'90px',fontSize:'12px',fontWeight:'600',color:'#475569',textAlign:'right',flexShrink:0}}>{st.label}</div>
                <div style={{flex:1,height:'28px',background:'#f1f5f9',borderRadius:'6px',overflow:'hidden',position:'relative'}}>
                  <div style={{height:'100%',width:`${pct}%`,background:`linear-gradient(90deg, ${st.color}cc, ${st.color})`,borderRadius:'6px',transition:'width 0.5s ease',display:'flex',alignItems:'center',justifyContent:'flex-end',paddingRight:'8px'}}>
                    {pct>15&&<span style={{fontSize:'11px',fontWeight:'700',color:'white'}}>{d.count}</span>}
                  </div>
                  {pct<=15&&<span style={{position:'absolute',left:`${pct}%`,top:'50%',transform:'translateY(-50%)',paddingLeft:'6px',fontSize:'11px',fontWeight:'700',color:'#475569'}}>{d.count}</span>}
                </div>
                <div style={{width:'50px',fontSize:'11px',color:'#64748b',flexShrink:0,textAlign:'right'}}>{d.avg_days||0}d avg</div>
              </div>);})}
        </div>
      </div>

      {/* Audit log */}
      <div>
        <h2 style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',marginBottom:'14px'}}>Recent Stage Movements</h2>
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',overflow:'hidden'}}>
          {moves.length===0?<div style={{padding:'32px',textAlign:'center',color:'#94a3b8',fontSize:'13px'}}>No movements recorded yet. Stage moves will appear here.</div>:(
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                {['CANDIDATE','FROM','TO','MOVED BY','TIME'].map(h=>(<th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'700',color:'#64748b',letterSpacing:'0.06em'}}>{h}</th>))}
              </tr></thead>
              <tbody>
                {moves.slice(0,20).map((m:any,i:number)=>{
                  const fr=STAGES.find(s=>s.key===m.from);const to=STAGES.find(s=>s.key===m.to);
                  const isAuto=m.by==='rule_engine'||m.by==='scheduler'||m.reason==='auto_rule'||m.reason==='scheduled_auto_move';
                  return(
                    <tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}
                      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8fafc'}
                      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='white'}>
                      <td style={{padding:'10px 14px',fontSize:'13px',fontWeight:'600',color:'#0f172a'}}>{m.candidate}</td>
                      <td style={{padding:'10px 14px'}}><span style={{padding:'2px 7px',borderRadius:'4px',fontSize:'11px',background:fr?.bg,color:fr?.color,fontWeight:'600'}}>{fr?.label||m.from}</span></td>
                      <td style={{padding:'10px 14px'}}><span style={{padding:'2px 7px',borderRadius:'4px',fontSize:'11px',background:to?.bg,color:to?.color,fontWeight:'600'}}>{to?.label||m.to}</span></td>
                      <td style={{padding:'10px 14px'}}><span style={{fontSize:'11px',fontWeight:'600',color:isAuto?'#22c55e':'#64748b',background:isAuto?'#f0fdf4':'#f1f5f9',padding:'2px 7px',borderRadius:'4px'}}>{isAuto?'🤖 Auto':'👤 Manual'}</span></td>
                      <td style={{padding:'10px 14px',fontSize:'11px',color:'#94a3b8'}}>{m.at?new Date(m.at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—'}</td>
                    </tr>);})}
              </tbody>
            </table>)}
        </div>
      </div>
    </div>
  );
}
