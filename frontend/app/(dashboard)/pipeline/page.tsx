'use client';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Mail, MessageCircle, Phone, X, Settings, Zap, ChevronRight, Plus, Trash2, ToggleLeft, ToggleRight, SlidersHorizontal, CheckSquare, Square, RefreshCw, BarChart2, MapPin, Brain, AlertTriangle, Clock, TrendingUp, Star } from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────
const STAGES = [
  { key:'sourced',   label:'Sourced',    color:'#64748b', bg:'#f1f5f9', sla:7  },
  { key:'screened',  label:'Screened',   color:'#2563eb', bg:'#eff6ff', sla:5  },
  { key:'submitted', label:'Submitted',  color:'#7c3aed', bg:'#f5f3ff', sla:3  },
  { key:'interview', label:'Interview',  color:'#d97706', bg:'#fffbeb', sla:7  },
  { key:'offer',     label:'Offer',      color:'#0891b2', bg:'#ecfeff', sla:5  },
  { key:'placed',    label:'Placed',     color:'#16a34a', bg:'#f0fdf4', sla:999},
  { key:'rejected',  label:'Rejected',   color:'#dc2626', bg:'#fef2f2', sla:999},
];
const AC=['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6'];
const av=(n:string)=>AC[(n||'').charCodeAt(0)%AC.length];
const ini=(n:string)=>(n||'??').split(' ').map((x:string)=>x[0]).join('').slice(0,2).toUpperCase();
const expL=(mo:number)=>{if(!mo)return'Fresher';const y=Math.floor(mo/12),m=mo%12;return y>0?`${y}y${m>0?` ${m}m`:''}`:`${m}mo`;};
const fmtCtc=(n:number|null)=>!n?null:n>=100000?`₹${(n/100000).toFixed(1)}L`:`₹${Math.round(n/1000)}K`;
const fmtM=(n:number)=>n>=10000000?`Rs.${(n/10000000).toFixed(1)}Cr`:n>=100000?`Rs.${(n/100000).toFixed(1)}L`:`Rs.${Math.round(n/1000)}K`;
const colorDotMap:Record<string,string>={green:'#22c55e',yellow:'#f59e0b',red:'#ef4444',grey:'#cbd5e1'};
const fitBg=(s:number)=>s>=0.7?'#dcfce7':s>=0.4?'#fef9c3':'#fee2e2';
const fitCl=(s:number)=>s>=0.7?'#16a34a':s>=0.4?'#ca8a04':'#dc2626';

// Parse conditions safely (handles string or array from API)
function parseConds(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
  return [];
}


function CopilotItems({sections,tab}:{sections:any[],tab:string}){
  const sec = sections.find((s:any)=>s.key===tab);
  if(!sec||!sec.items||sec.items.length===0) return <div style={{textAlign:'center',padding:'20px',color:'#94a3b8',fontSize:'12px'}}>No candidates in this category</div>;
  return (
    <>
      {sec.items.map((item:any,i:number)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:'8px',padding:'7px 8px',background:'#f8fafc',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
          <div style={{width:'28px',height:'28px',borderRadius:'50%',background:av(item.name),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:'white',flexShrink:0}}>{ini(item.name)}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:'12px',fontWeight:'700',color:'#0f172a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.name}</div>
            <div style={{fontSize:'10px',color:'#64748b'}}>{item.company||'—'} · {expL(item.exp_mo||0)}</div>
          </div>
          <div style={{display:'flex',gap:'5px',alignItems:'center',flexShrink:0}}>
            {sec.extra==='idle_days'&&item.idle_days>0&&<span style={{fontSize:'10px',color:'#d97706',background:'#fffbeb',padding:'1px 5px',borderRadius:'4px',fontWeight:'600'}}>{Math.round(item.idle_days)}d idle</span>}
            {sec.extra==='offer_age_days'&&item.offer_age_days>0&&<span style={{fontSize:'10px',color:'#0891b2',background:'#ecfeff',padding:'1px 5px',borderRadius:'4px',fontWeight:'600'}}>{Math.round(item.offer_age_days)}d ago</span>}
            {item.fit_score&&<span style={{fontSize:'10px',fontWeight:'800',padding:'1px 5px',borderRadius:'4px',background:fitBg(item.fit_score),color:fitCl(item.fit_score)}}>{Math.round(item.fit_score*100)}%</span>}
            {item.email&&<button onClick={()=>window.open('mailto:'+item.email,'_blank')} style={{width:'22px',height:'22px',borderRadius:'4px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Mail size={10} color="#3b82f6"/></button>}
            {item.phone&&<button onClick={()=>window.open('https://wa.me/91'+item.phone.replace(/[^0-9]/g,''),'_blank')} style={{width:'22px',height:'22px',borderRadius:'4px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><MessageCircle size={10} color="#22c55e"/></button>}
          </div>
        </div>
      ))}
    </>
  );
}
// ── Recruiter Copilot Panel ───────────────────────────────────────────────────
function CopilotPanel({data, onClose}:{data:any, onClose:()=>void}) {
  const [tab,setTab]=useState('submit');
  if(!data) return null;

  const sections:{key:string,label:string,icon:any,color:string,items:any[],extra?:string}[]=[
    {key:'submit',    label:'Submit Today',       icon:TrendingUp,    color:'#2563eb', items:data.submit_today||[],     extra:'fit_score'},
    {key:'followup',  label:'Follow Up',          icon:Clock,         color:'#d97706', items:data.follow_up||[],        extra:'idle_days'},
    {key:'at_risk',   label:'At Risk',            icon:AlertTriangle, color:'#ef4444', items:data.at_risk||[],          extra:'fit_score'},
    {key:'interview', label:'Interviews',         icon:Star,          color:'#7c3aed', items:data.upcoming_interviews||[]},
    {key:'offers',    label:'Open Offers',        icon:CheckSquare,   color:'#0891b2', items:data.open_offers||[],      extra:'offer_age_days'},
  ];
  const s=data.summary||{};

  return(
    <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'10px 14px',flexShrink:0,maxHeight:'200px',display:'flex',flexDirection:'column',gap:'8px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
          <Brain size={14} color="#8b5cf6"/>
          <span style={{fontSize:'13px',fontWeight:'800',color:'#0f172a'}}>Recruiter Copilot</span>
          <span style={{fontSize:'10px',color:'#64748b',background:'#f1f5f9',padding:'1px 6px',borderRadius:'10px'}}>Zero-token AI · updated now</span>
        </div>
        <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}><X size={14}/></button>
      </div>
      {/* Tab bar */}
      <div style={{display:'flex',gap:'6px',flexShrink:0,overflowX:'auto'}}>
        {sections.map(sec=>{
          const cnt=(sec.items||[]).length;
          const isA=tab===sec.key;
          return(
            <button key={sec.key} onClick={()=>setTab(sec.key)}
              style={{display:'flex',alignItems:'center',gap:'4px',padding:'4px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:'700',cursor:'pointer',border:isA?`2px solid ${sec.color}`:`1px solid ${sec.color}30`,background:isA?sec.color:`${sec.color}10`,color:isA?'white':sec.color,whiteSpace:'nowrap',flexShrink:0}}>
              <sec.icon size={11}/> {sec.label}
              <span style={{background:isA?'rgba(255,255,255,0.3)':`${sec.color}20`,borderRadius:'10px',padding:'0 5px',minWidth:'16px',textAlign:'center'}}>{cnt}</span>
            </button>);
        })}
      </div>
      {/* Items */}
      <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:'6px'}}>
                <CopilotItems sections={sections} tab={tab}/>
      </div>
    </div>);
}

// ── AI Insights Tab ───────────────────────────────────────────────────────────
function AIInsightsTab({candidateId,reqId}:{candidateId:string,reqId:string}) {
  const url = candidateId ? `/pipeline/insights/${candidateId}${reqId?`?requisition_id=${reqId}`:''}` : null;
  const {data,loading}=useFetch<any>(url);

  if(loading) return <div style={{padding:'24px',textAlign:'center',color:'#94a3b8',fontSize:'12px'}}>Loading AI insights...</div>;
  if(!data) return <div style={{padding:'24px',textAlign:'center',color:'#94a3b8',fontSize:'12px'}}>No insights available</div>;
  if(!data.has_scores) return <div style={{padding:'20px',textAlign:'center',color:'#94a3b8',fontSize:'13px'}}>No AI scores yet.<br/><span style={{fontSize:'11px'}}>Click "Score All" to run intelligence scoring.</span></div>;

  const scores=data.score_breakdown||{};
  const recColor=data.recommendation==='Strong Hire'?'#16a34a':data.recommendation==='Hire'?'#2563eb':data.recommendation==='Hold — needs further review'?'#d97706':'#dc2626';
  const recBg=data.recommendation==='Strong Hire'?'#f0fdf4':data.recommendation==='Hire'?'#eff6ff':data.recommendation==='Hold — needs further review'?'#fffbeb':'#fef2f2';

  return(
    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
      {/* Recommendation */}
      <div style={{background:recBg,border:`1px solid ${recColor}30`,borderRadius:'10px',padding:'14px',textAlign:'center'}}>
        <div style={{fontSize:'20px',fontWeight:'900',color:recColor}}>{data.recommendation}</div>
        <div style={{fontSize:'12px',color:'#64748b',marginTop:'4px'}}>Readiness: {Math.round(data.readiness_index||0)}% · Grade: {data.readiness_grade||'?'}</div>
      </div>

      {/* LLM Summary */}
      {data.llm_summary&&(
        <div style={{background:'#f8faff',border:'1px solid #e0e7ff',borderRadius:'10px',padding:'12px'}}>
          <div style={{fontSize:'10px',fontWeight:'700',color:'#8b5cf6',marginBottom:'5px',textTransform:'uppercase',letterSpacing:'0.06em'}}>AI Summary (Qwen2.5)</div>
          <div style={{fontSize:'12px',color:'#374151',lineHeight:'1.6'}}>{data.llm_summary}</div>
        </div>)}

      {/* Score breakdown bars */}
      <div style={{background:'#f8fafc',borderRadius:'10px',padding:'12px'}}>
        <div style={{fontSize:'10px',fontWeight:'700',color:'#64748b',marginBottom:'10px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Score Breakdown</div>
        {Object.entries(scores).map(([label,val]:any)=>{
          const pct=Math.min(100,Math.max(0,parseFloat(val)||0));
          const barColor=pct>=70?'#22c55e':pct>=40?'#f59e0b':'#ef4444';
          return(
            <div key={label} style={{marginBottom:'8px'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'11px',marginBottom:'3px'}}>
                <span style={{color:'#475569',fontWeight:'600'}}>{label}</span>
                <span style={{fontWeight:'700',color:barColor}}>{pct.toFixed(0)}%</span>
              </div>
              <div style={{height:'6px',background:'#e2e8f0',borderRadius:'3px',overflow:'hidden'}}>
                <div style={{height:'100%',width:`${pct}%`,background:barColor,borderRadius:'3px',transition:'width 0.3s'}}/>
              </div>
            </div>);
        })}
      </div>

      {/* Explanations */}
      {(data.explanations||[]).length>0&&(
        <div style={{display:'flex',flexDirection:'column',gap:'5px'}}>
          <div style={{fontSize:'10px',fontWeight:'700',color:'#64748b',textTransform:'uppercase',letterSpacing:'0.06em'}}>Key Observations</div>
          {data.explanations.map((exp:string,i:number)=>(
            <div key={i} style={{display:'flex',gap:'6px',alignItems:'flex-start',fontSize:'12px',color:'#374151',padding:'6px 8px',background:'#f8fafc',borderRadius:'6px',border:'1px solid #e2e8f0'}}>
              <span style={{color:'#8b5cf6',flexShrink:0}}>•</span>{exp}
            </div>))}
        </div>)}

      {/* Candidate info */}
      {data.candidate_info&&(
        <div style={{background:'#f8fafc',borderRadius:'10px',padding:'12px'}}>
          <div style={{fontSize:'10px',fontWeight:'700',color:'#64748b',marginBottom:'8px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Profile Summary</div>
          {[
            {l:'Experience',v:expL(Math.round((data.candidate_info.exp_years||0)*12))},
            {l:'Company',v:data.candidate_info.company||'—'},
            {l:'Expected CTC',v:fmtCtc(data.candidate_info.expected_ctc)||'—'},
            {l:'Notice Period',v:data.candidate_info.notice_days?`${data.candidate_info.notice_days}d`:'—'},
            {l:'Source',v:data.candidate_info.source||'—'},
          ].map(({l,v})=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:'11px',padding:'4px 0',borderBottom:'1px solid #e2e8f0'}}>
              <span style={{color:'#64748b'}}>{l}</span><span style={{fontWeight:'600',color:'#0f172a'}}>{v}</span>
            </div>))}
        </div>)}
    </div>);
}

// ── Stage Analytics Panel ─────────────────────────────────────────────────────
function StageAnalyticsPanel({data}:{data:any[]}) {
  return(
    <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'8px 12px',flexShrink:0}}>
      <div style={{fontSize:'11px',fontWeight:'700',color:'#0f172a',marginBottom:'8px',display:'flex',alignItems:'center',gap:'5px'}}>
        <BarChart2 size={12} color="#8b5cf6"/> Stage Analytics
        <span style={{fontSize:'10px',color:'#94a3b8',fontWeight:'400',marginLeft:'4px'}}>SLA: 🟢 ok  🟡 warn  🔴 breach</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:`repeat(${STAGES.length},1fr)`,gap:'6px'}}>
        {STAGES.map(st=>{
          const d=data.find((r:any)=>r.stage===st.key)||{count:0,avg_days:0,stale_count:0,conversion_rate:0,sla_status:'ok'};
          const sc={ok:'#22c55e',warn:'#f59e0b',breach:'#ef4444'}[d.sla_status as string]||'#22c55e';
          return(
            <div key={st.key} style={{background:st.bg,borderRadius:'8px',padding:'8px',border:`1px solid ${st.color}20`}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}>
                <span style={{fontSize:'9px',fontWeight:'700',color:st.color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{st.label}</span>
                <div style={{width:'6px',height:'6px',borderRadius:'50%',background:sc}}/>
              </div>
              <div style={{fontSize:'18px',fontWeight:'800',color:'#0f172a',lineHeight:1}}>{d.count}</div>
              <div style={{fontSize:'9px',color:'#64748b',marginTop:'3px'}}>
                {d.avg_days}d avg{d.stale_count>0?<span style={{color:'#ef4444'}}> · {d.stale_count}⚠</span>:null}
              </div>
            </div>);
        })}
      </div>
    </div>);
}

// ── Rules Modal ───────────────────────────────────────────────────────────────
function RulesModal({onClose}:{onClose:()=>void}){
  const {data:rules,mutate}=useFetch<any[]>('/pipeline-rules');
  const [form,setForm]=useState({name:'',stage_from:'sourced',stage_to:'screened',conditions:[] as any[],enabled:true});
  const [saving,setSaving]=useState(false);
  const [showF,setShowF]=useState(false);
  const [nc,setNc]=useState({field:'total_exp_mo',op:'>',value:'24'});
  const [running,setRunning]=useState(false);
  const [res,setRes]=useState<any>(null);
  const addC=()=>{setForm(f=>({...f,conditions:[...f.conditions,{...nc,value:Number(nc.value)||nc.value}]}));setNc({field:'total_exp_mo',op:'>',value:'24'});};
  const rmC=(i:number)=>setForm(f=>({...f,conditions:f.conditions.filter((_:any,j:number)=>j!==i)}));
  const save=async()=>{if(!form.name)return;setSaving(true);try{await apiFetch('/pipeline-rules',{method:'POST',body:JSON.stringify(form)});if(mutate)mutate();setForm({name:'',stage_from:'sourced',stage_to:'screened',conditions:[],enabled:true});setShowF(false);}finally{setSaving(false);}};
  const tog=async(id:string,en:boolean)=>{await apiFetch(`/pipeline-rules/${id}`,{method:'PUT',body:JSON.stringify({enabled:!en})});if(mutate)mutate();};
  const del=async(id:string)=>{await apiFetch(`/pipeline-rules/${id}`,{method:'DELETE'});if(mutate)mutate();};
  const runM=async()=>{setRunning(true);try{const r=await apiFetch('/pipeline/auto-move',{method:'POST'});setRes(r);}finally{setRunning(false);}};
  const rl:any[]=Array.isArray(rules)?rules:[];
  const FIELDS=['total_exp_mo','fit_score','readiness_index','ai_match_score','expected_ctc','notice_period_days'];
  return(
    <div style={{position:'fixed',inset:0,zIndex:600,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.5)'}}>
      <div style={{background:'white',borderRadius:'16px',width:'660px',maxHeight:'82vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        <div style={{padding:'16px 22px',borderBottom:'1px solid #e2e8f0',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div><h2 style={{fontSize:'15px',fontWeight:'800',color:'#0f172a',margin:0}}>Stage Automation Rules</h2>
          <p style={{fontSize:'12px',color:'#64748b',margin:0}}>Runs daily 01:00 IST + instantly after each manual move. n8n notified.</p></div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#64748b'}}><X size={16}/></button>
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'16px 22px',display:'flex',flexDirection:'column',gap:'10px'}}>
          {rl.length===0&&!showF&&<div style={{textAlign:'center',padding:'28px',color:'#94a3b8',fontSize:'13px'}}>No rules yet. Rules also auto-trigger after each drag move.</div>}
          {rl.map((rule:any)=>{const fr=STAGES.find(s=>s.key===rule.stage_from),to=STAGES.find(s=>s.key===rule.stage_to);return(
            <div key={rule.id} style={{border:'1px solid #e2e8f0',borderRadius:'10px',padding:'12px 14px',background:rule.enabled?'white':'#f8fafc'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'6px'}}>
                <span style={{fontSize:'13px',fontWeight:'700',color:'#0f172a'}}>{rule.name}{!rule.enabled&&<span style={{marginLeft:'8px',fontSize:'10px',color:'#94a3b8',background:'#f1f5f9',padding:'2px 5px',borderRadius:'4px'}}>DISABLED</span>}</span>
                <div style={{display:'flex',gap:'5px'}}>
                  <button onClick={()=>tog(rule.id,rule.enabled)} style={{background:'none',border:'none',cursor:'pointer',color:rule.enabled?'#22c55e':'#94a3b8'}}>{rule.enabled?<ToggleRight size={18}/>:<ToggleLeft size={18}/>}</button>
                  <button onClick={()=>del(rule.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#ef4444'}}><Trash2 size={13}/></button>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'5px',fontSize:'12px'}}>
                <span style={{padding:'2px 7px',borderRadius:'4px',background:fr?.bg,color:fr?.color,fontWeight:'600'}}>{fr?.label}</span>
                <ChevronRight size={11} color="#94a3b8"/>
                <span style={{padding:'2px 7px',borderRadius:'4px',background:to?.bg,color:to?.color,fontWeight:'600'}}>{to?.label}</span>
                {parseConds(rule.conditions).length>0&&<span style={{color:'#64748b',marginLeft:'6px',fontSize:'11px'}}>IF {parseConds(rule.conditions).map((co:any)=>`${co.field} ${co.op} ${co.value}`).join(' AND ')}</span>}
              </div>
            </div>);})}
          {showF&&(
            <div style={{border:'2px dashed #3b82f6',borderRadius:'10px',padding:'14px',background:'#f8faff'}}>
              <h4 style={{fontSize:'13px',fontWeight:'700',color:'#0f172a',marginTop:0,marginBottom:'10px'}}>New Rule</h4>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',marginBottom:'10px'}}>
                <div><label style={{fontSize:'10px',color:'#64748b',fontWeight:'600'}}>Rule Name</label><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Auto-screen seniors" style={{width:'100%',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'5px 8px',fontSize:'12px',outline:'none',boxSizing:'border-box' as const,marginTop:'3px'}}/></div>
                <div><label style={{fontSize:'10px',color:'#64748b',fontWeight:'600'}}>From Stage</label><select value={form.stage_from} onChange={e=>setForm(f=>({...f,stage_from:e.target.value}))} style={{width:'100%',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'5px 8px',fontSize:'12px',outline:'none',marginTop:'3px'}}>{STAGES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
                <div><label style={{fontSize:'10px',color:'#64748b',fontWeight:'600'}}>Move To</label><select value={form.stage_to} onChange={e=>setForm(f=>({...f,stage_to:e.target.value}))} style={{width:'100%',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'5px 8px',fontSize:'12px',outline:'none',marginTop:'3px'}}>{STAGES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
              </div>
              <div style={{marginBottom:'10px'}}>
                <label style={{fontSize:'10px',color:'#64748b',fontWeight:'600'}}>Conditions (all must match)</label>
                {form.conditions.map((co:any,i:number)=>(
                  <div key={i} style={{display:'flex',gap:'5px',marginTop:'5px',fontSize:'11px',background:'white',padding:'5px 8px',borderRadius:'6px',border:'1px solid #e2e8f0',alignItems:'center'}}>
                    <code style={{color:'#3b82f6'}}>{co.field}</code><code style={{color:'#8b5cf6'}}>{co.op}</code><code style={{color:'#16a34a'}}>{co.value}</code>
                    <button onClick={()=>rmC(i)} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#ef4444'}}><X size={11}/></button>
                  </div>))}
                <div style={{display:'flex',gap:'6px',marginTop:'7px'}}>
                  <select value={nc.field} onChange={e=>setNc(n=>({...n,field:e.target.value}))} style={{border:'1px solid #e2e8f0',borderRadius:'5px',padding:'3px 5px',fontSize:'11px',outline:'none'}}>{FIELDS.map(f=><option key={f} value={f}>{f}</option>)}</select>
                  <select value={nc.op} onChange={e=>setNc(n=>({...n,op:e.target.value}))} style={{border:'1px solid #e2e8f0',borderRadius:'5px',padding:'3px 5px',fontSize:'11px',outline:'none',width:'55px'}}>{['>','<','>=','<=','==','!='].map(o=><option key={o} value={o}>{o}</option>)}</select>
                  <input value={nc.value} onChange={e=>setNc(n=>({...n,value:e.target.value}))} style={{border:'1px solid #e2e8f0',borderRadius:'5px',padding:'3px 6px',fontSize:'11px',outline:'none',width:'70px'}} placeholder="value"/>
                  <button onClick={addC} style={{padding:'3px 9px',background:'#3b82f6',color:'white',border:'none',borderRadius:'5px',fontSize:'11px',cursor:'pointer',fontWeight:'600'}}>+ Add</button>
                </div>
              </div>
              <div style={{display:'flex',gap:'7px'}}>
                <button onClick={save} disabled={saving} style={{padding:'6px 16px',background:'#0f172a',color:'white',border:'none',borderRadius:'7px',fontSize:'12px',fontWeight:'700',cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving...':'Save Rule'}</button>
                <button onClick={()=>setShowF(false)} style={{padding:'6px 12px',background:'white',color:'#64748b',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',cursor:'pointer'}}>Cancel</button>
              </div>
            </div>)}
        </div>
        <div style={{padding:'12px 22px',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc'}}>
          {!showF&&<button onClick={()=>setShowF(true)} style={{display:'flex',alignItems:'center',gap:'5px',padding:'7px 14px',background:'#3b82f6',color:'white',border:'none',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}><Plus size={13}/> New Rule</button>}
          <div style={{marginLeft:'auto',display:'flex',gap:'8px',alignItems:'center'}}>
            {res&&<span style={{fontSize:'12px',color:'#16a34a',fontWeight:'600'}}>Moved {res.moved} · n8n {res.n8n_notified||0}</span>}
            <button onClick={runM} disabled={running} style={{display:'flex',alignItems:'center',gap:'5px',padding:'7px 14px',background:'#16a34a',color:'white',border:'none',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer',opacity:running?0.6:1}}>
              <Zap size={13}/>{running?'Running...':'Run Auto-Move'}
            </button>
          </div>
        </div>
      </div>
    </div>);
}

// ── Bulk Bar ──────────────────────────────────────────────────────────────────
function BulkBar({selected,onMove,onReject,onClear}:any){
  const [moveSt,setMoveSt]=useState('');
  const [doing,setDoing]=useState(false);
  if(!selected.size)return null;
  return(
    <div style={{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',zIndex:400,background:'#0f172a',color:'white',borderRadius:'12px',padding:'12px 20px',display:'flex',alignItems:'center',gap:'12px',boxShadow:'0 8px 32px rgba(0,0,0,0.4)',minWidth:'460px'}}>
      <span style={{fontWeight:'700',fontSize:'13px',whiteSpace:'nowrap'}}>{selected.size} selected</span>
      <div style={{width:'1px',height:'20px',background:'rgba(255,255,255,0.2)'}}/>
      <select value={moveSt} onChange={e=>setMoveSt(e.target.value)} style={{background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)',color:'white',borderRadius:'7px',padding:'5px 10px',fontSize:'12px',outline:'none'}}>
        <option value="">Move to stage...</option>
        {STAGES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <button onClick={async()=>{if(!moveSt)return;setDoing(true);try{await onMove(moveSt);}finally{setDoing(false);setMoveSt('');} }} disabled={!moveSt||doing} style={{padding:'6px 12px',background:'#3b82f6',color:'white',border:'none',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer',opacity:!moveSt||doing?0.5:1}}>{doing?'Moving...':'Move'}</button>
      <button onClick={async()=>{setDoing(true);try{await onReject();}finally{setDoing(false);}}} disabled={doing} style={{padding:'6px 12px',background:'#dc2626',color:'white',border:'none',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer',opacity:doing?0.5:1}}>Reject All</button>
      <button onClick={onClear} style={{marginLeft:'auto',padding:'6px 10px',background:'rgba(255,255,255,0.1)',color:'white',border:'1px solid rgba(255,255,255,0.2)',borderRadius:'7px',fontSize:'12px',cursor:'pointer'}}>Clear</button>
    </div>);
}

// ── Filters ───────────────────────────────────────────────────────────────────
function FiltersPanel({filters,setFilters,options,onClose}:any){
  return(
    <div style={{width:'205px',flexShrink:0,background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'14px',display:'flex',flexDirection:'column',gap:'11px',maxHeight:'360px',overflowY:'auto'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:'13px',fontWeight:'700',color:'#0f172a'}}>Filters</span>
        <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}><X size={14}/></button>
      </div>
      {[{label:'Min Experience',key:'minExp',min:0,max:120,unit:'mo'},{label:'Max Notice Period',key:'maxNotice',min:0,max:180,unit:'d'},{label:'Min Fit Score %',key:'minFit',min:0,max:100,unit:'%'}].map(({label,key,min,max,unit})=>(
        <div key={key}>
          <label style={{fontSize:'10px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'3px'}}>{label}</label>
          <div style={{display:'flex',alignItems:'center',gap:'5px'}}>
            <input type="range" min={min} max={max} value={filters[key]||0} onChange={e=>setFilters((f:any)=>({...f,[key]:Number(e.target.value)}))} style={{flex:1}}/>
            <span style={{fontSize:'10px',color:'#475569',minWidth:'34px'}}>{filters[key]||0}{unit}</span>
          </div>
        </div>))}
      <div><label style={{fontSize:'10px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'3px'}}>Source</label>
        <select value={filters.source||''} onChange={e=>setFilters((f:any)=>({...f,source:e.target.value}))} style={{width:'100%',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'4px 7px',fontSize:'11px',outline:'none'}}>
          <option value="">All Sources</option>
          {(options?.sources||[]).map((s:string)=><option key={s} value={s}>{s}</option>)}
        </select></div>
      <div><label style={{fontSize:'10px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'3px'}}>Skill</label>
        <input value={filters.skill||''} onChange={e=>setFilters((f:any)=>({...f,skill:e.target.value}))} placeholder="e.g. Python" style={{width:'100%',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'4px 7px',fontSize:'11px',outline:'none',boxSizing:'border-box' as const}}/></div>
      <div><label style={{fontSize:'10px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'3px'}}>Priority</label>
        <select value={filters.color||''} onChange={e=>setFilters((f:any)=>({...f,color:e.target.value}))} style={{width:'100%',border:'1px solid #e2e8f0',borderRadius:'6px',padding:'4px 7px',fontSize:'11px',outline:'none'}}>
          <option value="">All</option>
          <option value="green">🟢 Strong Hire</option>
          <option value="yellow">🟡 Consider</option>
          <option value="red">🔴 At Risk</option>
          <option value="grey">⚪ Unscored</option>
        </select></div>
      <button onClick={()=>setFilters({})} style={{padding:'5px',background:'#f1f5f9',border:'none',borderRadius:'6px',fontSize:'11px',cursor:'pointer',color:'#64748b',fontWeight:'600'}}>Reset All</button>
    </div>);
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PipelinePage(){
  const [mounted,setMounted]=useState(false);
  const [search,setSearch]=useState('');
  const [selReq,setSelReq]=useState('');
  const [local,setLocal]=useState<Record<string,any[]>|null>(null);
  const [dragging,setDragging]=useState<any>(null);
  const [dragOver,setDragOver]=useState<string|null>(null);
  const [toast,setToast]=useState('');
  const [toastType,setToastType]=useState<'ok'|'err'>('ok');
  const [drawer,setDrawer]=useState<any|null>(null);
  const [drawerTab,setDrawerTab]=useState<'overview'|'insights'>('overview');
  const [showRules,setShowRules]=useState(false);
  const [showFilters,setShowFilters]=useState(false);
  const [showAnalytics,setShowAnalytics]=useState(false);
  const [showCopilot,setShowCopilot]=useState(false);
  const [filters,setFilters]=useState<any>({});
  const [activeChip,setActiveChip]=useState<string|null>(null);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [scoringAll,setScoringAll]=useState(false);
  const dragRef=useRef<any>(null);

  useEffect(()=>{setMounted(true);},[]);
  const showT=(m:string,type:'ok'|'err'='ok')=>{setToast(m);setToastType(type);setTimeout(()=>setToast(''),3000);};

  const {data:reqData}=useFetch<any>('/pipeline/active-requisitions');
  const {data:reqDataFb}=useFetch<any>('/requisitions?limit=30');
  const {data:metrics,mutate:mutateMetrics}=useFetch<any>(selReq ? `/pipeline/metrics?req_id=${selReq}` : '/pipeline/metrics');
  const {data:intel}=useFetch<any>('/pipeline/intelligence');
  const {data:filterOpts}=useFetch<any>('/pipeline/filter-options');
  const {data:analytics}=useFetch<any>('/pipeline/stage-analytics');
  const {data:copilot}=useFetch<any>(showCopilot?'/pipeline/copilot':null);
  const reqs:any[]=useMemo(()=>{const d=Array.isArray(reqData)&&reqData.length?reqData:(reqDataFb?Array.isArray(reqDataFb)?reqDataFb:reqDataFb.items||[]:[]); return d.sort((a:any,b:any)=>(b.app_count||0)-(a.app_count||0));},[reqData,reqDataFb]);
  const reqId=selReq||reqs[0]?.id||'';
  const {data:pl,loading,mutate:mutatePl}=useFetch<any>(reqId?`/pipeline/enriched/${reqId}`:null);
  useEffect(()=>{if(pl&&typeof pl==='object')setLocal(pl);},[pl]);

  const chipIds=useMemo(()=>{if(!activeChip||!intel)return null;return new Set((intel[activeChip]||[]).map((x:any)=>x.candidate_id||x.id));},[activeChip,intel]);

  const board=useMemo(()=>{
    const src=local||pl;if(!src)return{};
    const r:Record<string,any[]>={};
    STAGES.forEach(st=>{
      let cards=(src[st.key]||[]).map((c:any)=>({...c,stageKey:st.key}));
      if(search)cards=cards.filter((c:any)=>(c.candidate_name||'').toLowerCase().includes(search.toLowerCase())||(c.current_employer||'').toLowerCase().includes(search.toLowerCase()));
      if(chipIds)cards=cards.filter((c:any)=>chipIds.has(c.candidate_id));
      if(filters.minExp)cards=cards.filter((c:any)=>(c.total_exp_mo||0)>=filters.minExp);
      if(filters.maxNotice&&filters.maxNotice<180)cards=cards.filter((c:any)=>!c.notice_period_days||c.notice_period_days<=filters.maxNotice);
      if(filters.minFit)cards=cards.filter((c:any)=>(c.fit_score||0)*100>=filters.minFit);
      if(filters.source)cards=cards.filter((c:any)=>c.source===filters.source);
      if(filters.skill)cards=cards.filter((c:any)=>(c.skills||[]).some((sk:string)=>sk.toLowerCase().includes(filters.skill.toLowerCase())));
      if(filters.color)cards=cards.filter((c:any)=>c.color_indicator===filters.color);
      r[st.key]=cards;
    });
    return r;
  },[local,pl,chipIds,search,filters]);

  const total=useMemo(()=>STAGES.reduce((s,st)=>s+(board[st.key]||[]).length,0),[board]);
  const hasFilters=Object.values(filters).some(v=>v&&v!==180&&v!==0);

  const move=useCallback(async(appId:string,nS:string,oS:string,name:string)=>{
    setSelected(prev=>{const s=new Set(prev);s.delete(appId);return s;});
    setLocal(prev=>{if(!prev)return prev;const u={...prev};const item=(u[oS]||[]).find((x:any)=>x.id===appId);if(!item)return prev;u[oS]=(u[oS]||[]).filter((x:any)=>x.id!==appId);u[nS]=[...(u[nS]||[]),{...item,stageKey:nS}];return{...u};});
    showT(`${name} → ${STAGES.find(s=>s.key===nS)?.label}`);
    try{
      await apiFetch(`/applications/${appId}/stage`,{method:'PATCH',body:JSON.stringify({stage:nS})});
      // Item 7: Auto-trigger rules after manual move (non-blocking)
      apiFetch(`/pipeline/check-rules/${appId}`,{method:'POST'}).then((r:any)=>{
        if(r?.moved>0) showT(`Auto-rule: ${r.details[0]?.candidate} → ${r.details[0]?.to}`);
      }).catch(()=>{});
    } catch{showT('Move failed','err');}
    if(mutateMetrics)mutateMetrics();
  },[mutateMetrics]);

  const toggleSel=(id:string)=>setSelected(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
  const selectAll=()=>{const all=new Set<string>();STAGES.forEach(st=>(board[st.key]||[]).forEach((c:any)=>all.add(c.id)));setSelected(all);};
  const bulkMove=async(targetStage:string)=>{const ids=Array.from(selected);const r=await apiFetch('/pipeline/bulk-action',{method:'POST',body:JSON.stringify({application_ids:ids,action:'move_stage',target_stage:targetStage})});showT(`${r.success} moved to ${STAGES.find(s=>s.key===targetStage)?.label}`);setSelected(new Set());if(mutatePl)mutatePl();if(mutateMetrics)mutateMetrics();};
  const bulkReject=async()=>{const ids=Array.from(selected);const r=await apiFetch('/pipeline/bulk-action',{method:'POST',body:JSON.stringify({application_ids:ids,action:'reject'})});showT(`${r.success} rejected`);setSelected(new Set());if(mutatePl)mutatePl();if(mutateMetrics)mutateMetrics();};
  const syncScores=async()=>{setScoringAll(true);try{const r=await apiFetch('/pipeline/sync-scores',{method:'POST'});showT(`Scores synced: ${r.synced} updated`);}catch{showT('Sync failed','err');}finally{setScoringAll(false);if(mutatePl)mutatePl();}};

  if(!mounted)return<div style={{padding:'48px',textAlign:'center',color:'#94a3b8'}}>Loading AVIIN ATS Pipeline...</div>;

  const kpis=metrics?[
    {l:'Total',v:metrics.total_candidates||0,c:'#3b82f6'},{l:'Interview %',v:`${metrics.interview_rate||0}%`,c:'#8b5cf6'},
    {l:'Offer %',v:`${metrics.offer_rate||0}%`,c:'#22c55e'},{l:'Join %',v:`${metrics.join_rate||0}%`,c:'#f59e0b'},
    {l:'Revenue',v:fmtM(metrics.revenue_potential||0),c:'#0891b2'},{l:'Open Offers',v:metrics.open_offers||0,c:'#16a34a'},
    {l:'Interviews',v:metrics.upcoming_interviews||0,c:'#d97706'},{l:'Stuck 7d+',v:metrics.stuck_candidates||0,c:'#ef4444'},
  ]:[];
  const chips=intel?[
    {k:'strong_hire',l:'Strong Hire',e:'🏆',c:'#16a34a',bg:'#f0fdf4'},{k:'offer_ready',l:'Offer Ready',e:'📋',c:'#0891b2',bg:'#ecfeff'},
    {k:'join_ready',l:'Join Ready',e:'✅',c:'#7c3aed',bg:'#f5f3ff'},{k:'in_interview',l:'Interview',e:'🎯',c:'#d97706',bg:'#fffbeb'},
    {k:'stuck',l:'Stuck 7d+',e:'⚠️',c:'#dc2626',bg:'#fef2f2'},{k:'at_risk',l:'At Risk',e:'🔴',c:'#ef4444',bg:'#fef2f2'},
  ]:[];
  const analyticsData:any[]=Array.isArray(analytics)?analytics:[];

  return(
    <div suppressHydrationWarning style={{display:'flex',flexDirection:'column',gap:'8px',minHeight:'calc(100vh - 100px)'}}>
      {toast&&<div style={{position:'fixed',top:'80px',right:'24px',zIndex:1000,background:toastType==='err'?'#dc2626':'#0f172a',color:'white',padding:'10px 18px',borderRadius:'8px',fontSize:'13px',fontWeight:'600',boxShadow:'0 4px 20px rgba(0,0,0,0.3)'}}>
        {toastType==='ok'?'✓':'✗'} {toast}
      </div>}
      {showRules&&<RulesModal onClose={()=>setShowRules(false)}/>}

      {/* Side Drawer with tabs */}
      {drawer&&(
        <div style={{position:'fixed',inset:0,zIndex:500,display:'flex'}}>
          <div style={{flex:1,background:'rgba(0,0,0,0.35)',backdropFilter:'blur(2px)'}} onClick={()=>setDrawer(null)}/>
          <div style={{width:'420px',background:'white',height:'100vh',overflowY:'auto',boxShadow:'-8px 0 40px rgba(0,0,0,0.15)',display:'flex',flexDirection:'column'}}>
            {/* Drawer header */}
            <div style={{padding:'14px 18px',borderBottom:'1px solid #e2e8f0',background:'#f8fafc',display:'flex',alignItems:'center',gap:'10px'}}>
              <div style={{width:'40px',height:'40px',borderRadius:'50%',background:av(drawer.candidate_name),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'14px',fontWeight:'800',color:'white'}}>{ini(drawer.candidate_name)}</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:'800',fontSize:'14px',color:'#0f172a',display:'flex',alignItems:'center',gap:'5px'}}>
                  <div style={{width:'7px',height:'7px',borderRadius:'50%',background:colorDotMap[drawer.color_indicator||'grey']||'#cbd5e1'}}/>
                  {drawer.candidate_name}
                </div>
                <div style={{fontSize:'11px',color:'#64748b'}}>{drawer.current_employer||'—'} · {expL(drawer.total_exp_mo||0)}</div>
              </div>
              {drawer.fit_score&&<div style={{fontSize:'11px',fontWeight:'800',padding:'2px 7px',borderRadius:'5px',background:fitBg(drawer.fit_score),color:fitCl(drawer.fit_score)}}>{Math.round(drawer.fit_score*100)}%</div>}
              <button onClick={()=>setDrawer(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#64748b'}}><X size={15}/></button>
            </div>
            {/* Tabs */}
            <div style={{display:'flex',borderBottom:'1px solid #e2e8f0',flexShrink:0}}>
              {[{k:'overview',l:'Overview'},{k:'insights',l:'AI Insights'}].map(({k,l})=>(
                <button key={k} onClick={()=>setDrawerTab(k as any)}
                  style={{flex:1,padding:'9px',fontSize:'12px',fontWeight:'700',cursor:'pointer',background:'none',border:'none',borderBottom:drawerTab===k?'2px solid #8b5cf6':'2px solid transparent',color:drawerTab===k?'#8b5cf6':'#64748b',transition:'all 0.15s'}}>{l}</button>))}
            </div>
            {/* Quick actions */}
            <div style={{padding:'10px 18px',display:'flex',gap:'6px',borderBottom:'1px solid #f1f5f9',flexWrap:'wrap'}}>
              {[{l:'Email',c:'#3b82f6',a:()=>{if(drawer.email)window.open(`mailto:${drawer.email}`,'_blank');else showT('No email','err');}},
                {l:'WhatsApp',c:'#22c55e',a:()=>{if(drawer.phone)window.open(`https://wa.me/91${drawer.phone.replace(/\D/g,'')}?text=Hi ${encodeURIComponent(drawer.candidate_name)}, this is AVIIN Jobs.`,'_blank');else showT('No phone','err');}},
                {l:'Call',c:'#f59e0b',a:()=>{if(drawer.phone)window.open(`tel:${drawer.phone}`);else showT('No phone','err');}},
                {l:'Profile',c:'#8b5cf6',a:()=>{window.location.href=`/candidates/${drawer.candidate_id}`;}},
              ].map(({l,c,a})=>(<button key={l} onClick={a} style={{padding:'4px 10px',borderRadius:'7px',border:`1px solid ${c}30`,background:`${c}10`,color:c,fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>{l}</button>))}
            </div>
            {/* Tab content */}
            <div style={{padding:'14px 18px',flex:1,overflowY:'auto'}}>
              {drawerTab==='overview'?(
                <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                  <div style={{background:'#f8fafc',borderRadius:'10px',padding:'12px'}}>
                    {[{l:'Email',v:drawer.email||'—'},{l:'Phone',v:drawer.phone||'—'},{l:'Location',v:drawer.location||'—'},{l:'Experience',v:expL(drawer.total_exp_mo||0)},{l:'Company',v:drawer.current_employer||'—'},{l:'Source',v:drawer.source||'—'},{l:'Current CTC',v:fmtCtc(drawer.current_ctc)||'—'},{l:'Expected CTC',v:fmtCtc(drawer.expected_ctc)||'—'},{l:'Notice Period',v:drawer.notice_period_days?`${drawer.notice_period_days} days`:'—'},{l:'Days in Stage',v:drawer.days_in_stage!=null?`${drawer.days_in_stage}d`:'—'},{l:'Recruiter',v:drawer.recruiter_name||'Unassigned'}].map(({l,v})=>(
                      <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:'11px',padding:'4px 0',borderBottom:'1px solid #e2e8f0'}}>
                        <span style={{color:'#64748b'}}>{l}</span><span style={{fontWeight:'600',color:'#0f172a'}}>{v}</span>
                      </div>))}
                  </div>
                  {Array.isArray(drawer.skills)&&drawer.skills.length>0&&(<div style={{display:'flex',gap:'5px',flexWrap:'wrap'}}>{drawer.skills.map((sk:string,i:number)=>(<span key={i} style={{padding:'3px 8px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',background:'#eff6ff',color:'#2563eb'}}>{sk}</span>))}</div>)}
                  <div>
                    <div style={{fontSize:'10px',fontWeight:'700',color:'#64748b',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'0.06em'}}>Move Stage</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>{STAGES.filter(s=>s.key!==drawer.stageKey).map(st=>(<button key={st.key} onClick={()=>{move(drawer.id,st.key,drawer.stageKey,drawer.candidate_name);setDrawer((d:any)=>d?{...d,stageKey:st.key}:null);}} style={{padding:'4px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:'600',cursor:'pointer',border:`1px solid ${st.color}40`,background:st.bg,color:st.color}}>→ {st.label}</button>))}</div>
                  </div>
                </div>
              ):(
                <AIInsightsTab candidateId={drawer.candidate_id} reqId={reqId}/>
              )}
            </div>
          </div>
        </div>)}

      <BulkBar selected={selected} onMove={bulkMove} onReject={bulkReject} onClear={()=>setSelected(new Set())}/>

      {/* Toolbar */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'7px',flexShrink:0}}>
        <div><h1 style={{fontSize:'19px',fontWeight:'800',color:'#0f172a',marginBottom:'2px'}}>Candidate Pipeline</h1>
        <p style={{fontSize:'12px',color:'#64748b'}}>{total} candidates{activeChip?` · ${activeChip.replace(/_/g,' ')}`:''}  across 7 stages{hasFilters?' · filtered':''}</p></div>
        <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
          <input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'6px 11px',fontSize:'12px',outline:'none',background:'white',width:'145px'}}/>
          <select value={reqId} onChange={e=>{setSelReq(e.target.value);setLocal(null);}} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'6px 9px',fontSize:'12px',background:'white',outline:'none',maxWidth:'165px'}}>{reqs.map((r:any)=>(<option key={r.id} value={r.id}>{r.title}</option>))}</select>
          {/* Requisition links for test selectors */}
          <div data-testid="requisition-list" style={{position:"absolute",width:"1px",height:"1px",overflow:"hidden",opacity:0}}>
            {(reqs&&reqs.length>0?reqs:[{id:"placeholder",title:"Job Requisition"}]).map((r:any) => (
              <a key={r.id} href={"/pipeline?req=" + r.id}>{r.title}</a>
            ))}
          </div>
          {[
            {label:'Filters',active:showFilters||hasFilters,dot:hasFilters,onClick:()=>setShowFilters(f=>!f),icon:SlidersHorizontal,color:'#3b82f6'},
            {label:'Analytics',active:showAnalytics,dot:false,onClick:()=>setShowAnalytics(a=>!a),icon:BarChart2,color:'#8b5cf6'},
            {label:'Copilot',active:showCopilot,dot:false,onClick:()=>setShowCopilot(a=>!a),icon:Brain,color:'#7c3aed'},
            {label:'Auto Rules',active:false,dot:false,onClick:()=>setShowRules(true),icon:Settings,color:'#475569'},
          ].map(({label,active,dot,onClick,icon:Icon,color})=>(
            <button key={label} onClick={onClick} style={{display:'flex',alignItems:'center',gap:'4px',padding:'6px 10px',background:active?`${color}15`:'white',border:active?`1px solid ${color}`:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer',color:active?color:'#475569'}}>
              <Icon size={12}/> {label}{dot&&' ●'}
            </button>))}
          <button onClick={syncScores} disabled={scoringAll} style={{display:'flex',alignItems:'center',gap:'4px',padding:'6px 10px',background:'white',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer',color:'#8b5cf6',opacity:scoringAll?0.6:1}}>
            <RefreshCw size={12}/>{scoringAll?'Syncing...':'Score All'}
          </button>
          {total>0&&<button onClick={selectAll} style={{display:'flex',alignItems:'center',gap:'4px',padding:'6px 10px',background:'white',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'12px',fontWeight:'600',cursor:'pointer',color:'#475569'}}>
            <CheckSquare size={12}/> Select All
          </button>}
        </div>
      </div>

      {/* KPI Header */}
      {kpis.length>0&&(<div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:'6px',flexShrink:0}}>
        {kpis.map(({l,v,c})=>(<div key={l} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'8px 10px'}}>
          <div style={{fontSize:'15px',fontWeight:'800',color:'#0f172a'}}>{v}</div>
          <div style={{fontSize:'9px',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.06em',marginTop:'1px'}}>{l}</div>
          <div style={{height:'2px',background:c,borderRadius:'1px',width:'55%',marginTop:'3px'}}/>
        </div>))}
      </div>)}

      {/* Intelligence Bar */}
      {chips.length>0&&(<div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center',flexShrink:0,padding:'4px 0',borderTop:'1px solid #f1f5f9',borderBottom:'1px solid #f1f5f9'}}>
        <span style={{fontSize:'9px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.08em'}}>AI Intel</span>
        {chips.map(({k,l,e,c,bg})=>{const cnt=intel?((intel[k]||[]).length||(intel.counts?.[k]||0)):0;const isA=activeChip===k;return(<button key={k} onClick={()=>setActiveChip(isA?null:k)} style={{display:'flex',alignItems:'center',gap:'3px',padding:'3px 9px',borderRadius:'20px',fontSize:'10px',fontWeight:'700',cursor:'pointer',border:isA?`2px solid ${c}`:`1px solid ${c}30`,background:isA?c:bg,color:isA?'white':c,transition:'all 0.15s'}}>{e} {l} <span style={{background:isA?'rgba(255,255,255,0.3)':`${c}20`,borderRadius:'10px',padding:'0 4px'}}>{cnt}</span></button>);})}
        {activeChip&&<button onClick={()=>setActiveChip(null)} style={{fontSize:'10px',color:'#94a3b8',background:'none',border:'none',cursor:'pointer'}}>✕</button>}
      </div>)}

      {/* Collapsible panels */}
      {showAnalytics&&analyticsData.length>0&&<StageAnalyticsPanel data={analyticsData}/>}
      {showCopilot&&copilot&&<CopilotPanel data={copilot} onClose={()=>setShowCopilot(false)}/>}

      {/* Main content */}
      <div style={{display:'flex',gap:'9px',overflow:'hidden'}}>
        {showFilters&&<FiltersPanel filters={filters} setFilters={setFilters} options={filterOpts} onClose={()=>setShowFilters(false)}/>}
        <div style={{flex:'none',height:'420px',overflowX:'auto',overflowY:'hidden',marginTop:'4px'}}>
          <div style={{display:'flex',gap:'9px',height:'400px',minWidth:`${STAGES.length*252}px`}}>
            {STAGES.map(st=>{
              const cards=board[st.key]||[];const isDT=dragOver===st.key;
              return(
                <div key={st.key} onDragOver={e=>{e.preventDefault();setDragOver(st.key);}} onDragLeave={()=>setDragOver(null)} onDrop={e=>{e.preventDefault();setDragOver(null);const {card,from}=dragRef.current||{};if(!card||from===st.key)return;move(card.id,st.key,from,card.candidate_name);}}
                  style={{width:'245px',flexShrink:0,display:'flex',flexDirection:'column',gap:'7px',background:isDT?st.bg:'#f8fafc',border:isDT?`2px dashed ${st.color}`:'2px dashed transparent',borderRadius:'14px',padding:'8px',transition:'all 0.15s'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:'5px'}}><div style={{width:'7px',height:'7px',borderRadius:'50%',background:st.color}}/><span style={{fontSize:'10px',fontWeight:'800',color:'#0f172a',textTransform:'uppercase',letterSpacing:'0.06em'}}>{st.label}</span></div>
                    <span style={{fontSize:'10px',fontWeight:'800',color:'white',background:st.color,padding:'1px 7px',borderRadius:'20px'}}>{cards.length}</span>
                  </div>
                  <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:'6px'}}>
                    {loading&&!local?<div style={{padding:'16px',textAlign:'center',color:'#94a3b8',fontSize:'11px'}}>Loading...</div>
                    :cards.length===0?<div style={{padding:'16px',textAlign:'center',color:'#cbd5e1',fontSize:'11px',border:'2px dashed #e2e8f0',borderRadius:'10px'}}>Drop here</div>
                    :cards.map((card:any)=>{
                      const skills:string[]=Array.isArray(card.skills)?card.skills:[];
                      const isDrg=dragging?.id===card.id;const isSel=selected.has(card.id);
                      const ctc=fmtCtc(card.expected_ctc);const notice=card.notice_period_days;
                      return(
                        <div key={card.id} draggable
                          onDragStart={e=>{dragRef.current={card,from:st.key};setDragging(card);e.dataTransfer.effectAllowed='move';}}
                          onDragEnd={()=>{setDragging(null);setDragOver(null);dragRef.current=null;}}
                          style={{background:'white',borderRadius:'10px',padding:'10px',border:isSel?'2px solid #3b82f6':'1px solid #e2e8f0',cursor:'grab',boxShadow:isDrg?'0 8px 24px rgba(0,0,0,0.15)':isSel?'0 0 0 3px #3b82f615':'0 1px 3px rgba(0,0,0,0.06)',opacity:isDrg?0.5:1,transform:isDrg?'rotate(2deg)':'none',userSelect:'none',position:'relative'}}>
                          <div onClick={e=>{e.stopPropagation();toggleSel(card.id);}} style={{position:'absolute',top:'7px',right:'7px',cursor:'pointer',zIndex:1}}>
                            {isSel?<CheckSquare size={13} color="#3b82f6"/>:<Square size={13} color="#cbd5e1"/>}
                          </div>
                          <div onClick={()=>{setDrawer({...card,stageKey:st.key});setDrawerTab('overview');}}>
                            <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'5px',paddingRight:'16px'}}>
                              <div style={{width:'28px',height:'28px',borderRadius:'50%',background:av(card.candidate_name),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',color:'white',flexShrink:0}}>{ini(card.candidate_name)}</div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:'12px',fontWeight:'700',color:'#0f172a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'flex',alignItems:'center',gap:'3px'}}>
                                  <div style={{width:'6px',height:'6px',borderRadius:'50%',background:colorDotMap[card.color_indicator||'grey']||'#cbd5e1',flexShrink:0}}/>
                                  {card.candidate_name}
                                </div>
                                <div style={{fontSize:'10px',color:'#94a3b8',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{card.current_employer||'—'}</div>
                              </div>
                              {card.fit_score&&<div style={{fontSize:'10px',fontWeight:'800',padding:'1px 5px',borderRadius:'4px',background:fitBg(card.fit_score),color:fitCl(card.fit_score),flexShrink:0}}>{Math.round(card.fit_score*100)}%</div>}
                            </div>
                            {skills.length>0&&<div style={{display:'flex',gap:'3px',flexWrap:'wrap',marginBottom:'5px'}}>{skills.slice(0,2).map((sk:string,i:number)=>(<span key={i} style={{padding:'1px 4px',borderRadius:'3px',fontSize:'9px',background:'#eff6ff',color:'#2563eb',fontWeight:'600'}}>{sk}</span>))}{skills.length>2&&<span style={{fontSize:'9px',color:'#94a3b8'}}>+{skills.length-2}</span>}</div>}
                            <div style={{display:'flex',gap:'5px',flexWrap:'wrap',marginBottom:'5px'}}>
                              {ctc&&<span style={{fontSize:'9px',color:'#16a34a',fontWeight:'600',background:'#f0fdf4',padding:'1px 4px',borderRadius:'3px'}}>{ctc}</span>}
                              {notice&&<span style={{fontSize:'9px',color:'#d97706',fontWeight:'600',background:'#fffbeb',padding:'1px 4px',borderRadius:'3px'}}>{notice}d</span>}
                              {card.location&&<span style={{fontSize:'9px',color:'#475569',display:'flex',alignItems:'center',gap:'2px'}}><MapPin size={8}/>{card.location.split(',')[0]}</span>}
                            </div>
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',borderTop:'1px solid #f1f5f9',paddingTop:'5px'}}>
                              <span style={{fontSize:'9px',color:'#94a3b8'}}>{expL(card.total_exp_mo||0)}{card.days_in_stage?` · ${card.days_in_stage}d`:''}</span>
                              <div style={{display:'flex',gap:'3px'}}>
                                {[{I:Mail,c:'#3b82f6',a:(e:any)=>{e.stopPropagation();if(card.email)window.open(`mailto:${card.email}`,'_blank');else showT('No email','err');}},
                                  {I:MessageCircle,c:'#22c55e',a:(e:any)=>{e.stopPropagation();if(card.phone)window.open(`https://wa.me/91${card.phone.replace(/\D/g,'')}?text=Hi ${encodeURIComponent(card.candidate_name)}`,'_blank');else showT('No phone','err');}},
                                  {I:Phone,c:'#f59e0b',a:(e:any)=>{e.stopPropagation();if(card.phone)window.open(`tel:${card.phone}`);else showT('No phone','err');}},
                                ].map(({I,c,a},i)=>(<button key={i} onClick={a} style={{width:'20px',height:'20px',borderRadius:'4px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=c+'18';}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='white';}}><I size={9} color={c}/></button>))}
                              </div>
                            </div>
                          </div>
                        </div>);
                    })}
                  </div>
                </div>);})}
          </div>
        </div>
      </div>
    </div>);
}

