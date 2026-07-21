'use client';
import { useState, useRef, useMemo, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Modal, FormField, FormRow, FormActions, SectionDivider } from '@/components/ui/Modal';
import { API, authHeaders } from '@/lib/auth';
import {
  Plus, Search, Upload, Download, Brain, Mail, Phone, MapPin, Briefcase,
  Trash2, Edit, ExternalLink, X, Filter, ChevronLeft, ChevronRight,
  FileText, Users, GitMerge, Eye, Clock, ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle, Layers
} from 'lucide-react';

// ── helpers ──────────────────────────────────────────────────────────────────
const AC = ['#1e40af','#7c3aed','#0f766e','#92400e','#be185d','#0369a1','#4f46e5'];
const gc = (n:string) => AC[(n?.charCodeAt(0)||0)%AC.length];
const gi = (n:string) => (n||'?').split(' ').map((x:string)=>x[0]).join('').slice(0,2).toUpperCase();
const gx = (mo:number|null|undefined): string|null => {
  if (!mo || mo <= 0) return null;
  const y=Math.floor(mo/12), m=mo%12;
  return y ? y+'y'+(m?' '+m+'m':'') : mo+'mo';
};
const fc = (n:number|null|undefined) => !n?null:n>=100000?`Rs.${(n/100000).toFixed(1)}L`:`Rs.${Math.round(n/1000)}K`;
const timeAgo = (ts:string|null|undefined) => {
  if (!ts) return null;
  const diff = Date.now() - new Date(ts).getTime();
  const d=Math.floor(diff/86400000), h=Math.floor(diff/3600000), m=Math.floor(diff/60000);
  if (d>30) return Math.floor(d/30)+'mo ago';
  if (d>0) return d+'d ago';
  if (h>0) return h+'h ago';
  if (m>0) return m+'m ago';
  return 'just now';
};

// Fallback (used only until /settings/pipeline-stages loads). Also the
// live keys were wrong here before this fix (nda_pre_contract/hired don't
// match the real stage keys nda/placed, so candidates in those stages —
// and any custom stage — silently got no badge at all).
const DEFAULT_STAGE_C: Record<string,{bg:string;color:string;label:string}> = {
  sourced:          {bg:'#eff6ff',color:'#1e40af',label:'Sourced'},
  contacted:        {bg:'#f0fdf4',color:'#166534',label:'Contacted'},
  interested:       {bg:'#fef9c3',color:'#854d0e',label:'Interested'},
  nda:              {bg:'#fdf4ff',color:'#7e22ce',label:'NDA'},
  screened:         {bg:'#fff7ed',color:'#9a3412',label:'Screened'},
  submitted:        {bg:'#f0fdfa',color:'#134e4a',label:'Submitted'},
  l1_interview:     {bg:'#fee2e2',color:'#991b1b',label:'L1 Interview'},
  l2_interview:     {bg:'#fff1f2',color:'#9f1239',label:'L2 Interview'},
  offer:            {bg:'#dcfce7',color:'#14532d',label:'Offer'},
  offer_accepted:   {bg:'#d1fae5',color:'#065f46',label:'Offer Accepted'},
  placed:           {bg:'#bbf7d0',color:'#166534',label:'Placed'},
  hold:             {bg:'#f1f5f9',color:'#64748b',label:'On Hold'},
  rejected:         {bg:'#fee2e2',color:'#991b1b',label:'Rejected'},
};

const EMPTY = {
  full_name:'',email:'',phone:'',location:'',
  current_employer:'',current_designation:'',
  total_exp_mo:0,expected_ctc:'' as any,current_ctc:'' as any,
  notice_period_days:'' as any,linkedin_url:'',source:'linkedin',
  skills:[] as string[],resume_text:'',
};
const INP:any = {width:'100%',border:'1px solid #e2e8f0',borderRadius:'8px',padding:'9px 12px',fontSize:'13px',outline:'none',color:'#1e293b',background:'white',boxSizing:'border-box'};
const SRC = ['linkedin','naukri','referral','direct','indeed','walk_in','campus','self_apply','website','other'];
const PAGE_SIZE = 50;

// ── Bulk Assign Modal ─────────────────────────────────────────────────────────
function BulkAssignModal({candidateIds,onClose,onDone}:{candidateIds:string[];onClose:()=>void;onDone:()=>void}) {
  const {data:reqData} = useFetch<any>('/requisitions?limit=100&status=open');
  const [reqId,setReqId] = useState('');
  const [saving,setSaving] = useState(false);
  const [result,setResult] = useState<any>(null);
  const reqs = Array.isArray(reqData?.data)?reqData.data:Array.isArray(reqData)?reqData:[];
  async function assign() {
    if (!reqId) {alert('Select a requisition');return;}
    setSaving(true);
    try {
      const r = await apiFetch('/candidates/bulk-assign',{method:'POST',body:JSON.stringify({candidate_ids:candidateIds,requisition_id:reqId})});
      setResult(r); setTimeout(()=>{onDone();onClose();},1800);
    } catch(e:any){alert(e?.message||'Failed');setSaving(false);}
  }
  const OV:any={position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'};
  return (
    <div style={OV} onClick={onClose}>
      <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'440px',boxShadow:'0 20px 60px rgba(0,0,0,0.25)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
          <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>Assign {candidateIds.length} Candidate{candidateIds.length>1?'s':''} to Requisition</h2>
          <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8',padding:'4px'}}><X size={18}/></button>
        </div>
        {result?(
          <div style={{textAlign:'center',padding:'20px 0'}}>
            <div style={{fontSize:'32px',marginBottom:'8px'}}>✅</div>
            <p style={{fontSize:'14px',fontWeight:'600',color:'#16a34a'}}>{result.created} assigned, {result.skipped} already in pipeline</p>
          </div>
        ):(
          <>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>Select Requisition</label>
            <select value={reqId} onChange={e=>setReqId(e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',fontSize:'13px',outline:'none',marginBottom:'20px'}}>
              <option value="">-- Choose a requisition --</option>
              {reqs.map((r:any)=><option key={r.id} value={r.id}>{r.title} ({r.department||'No dept'})</option>)}
            </select>
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px'}}>
              <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
              <button onClick={assign} disabled={saving||!reqId} style={{padding:'9px 18px',borderRadius:'8px',border:'none',background:saving||!reqId?'#94a3b8':'#1e40af',color:'white',cursor:saving||!reqId?'not-allowed':'pointer',fontSize:'13px',fontWeight:'600'}}>{saving?'Assigning...':'Assign to Pipeline'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Quick-View Drawer ─────────────────────────────────────────────────────────
function CandidateDrawer({candidate,onClose,onEdit,stageMap,allTags,onTagsChanged}:{candidate:any;onClose:()=>void;onEdit:(c:any)=>void;stageMap:Record<string,{bg:string;color:string;label:string}>;allTags:any[];onTagsChanged:()=>void}) {
  const {data:apps} = useFetch<any>(`/candidates/${candidate.id}/applications`);
  const {data:candTagsRaw,refetch:refetchCandTags} = useFetch<any[]>(`/candidate-tags/candidate/${candidate.id}`);
  const candTags:any[] = Array.isArray(candTagsRaw)?candTagsRaw:[];
  const [showTagPicker,setShowTagPicker] = useState(false);
  const [newTagName,setNewTagName] = useState('');
  const [tagBusy,setTagBusy] = useState(false);
  const exp = gx(candidate.total_exp_mo);
  const sc = candidate.pipeline_stage ? (stageMap[candidate.pipeline_stage]||null) : null;
  const availableTags = allTags.filter((t:any)=>!candTags.some((ct:any)=>ct.id===t.id));

  const addTag = async(tagId:string)=>{
    setTagBusy(true);
    try{
      await apiFetch(`/candidate-tags/assign?candidate_id=${candidate.id}`,{method:'POST',body:JSON.stringify([tagId])});
      refetchCandTags(); onTagsChanged();
    }catch{} finally{setTagBusy(false);}
  };
  const removeTag = async(tagId:string)=>{
    setTagBusy(true);
    try{
      await apiFetch(`/candidate-tags/remove?candidate_id=${candidate.id}&tag_id=${tagId}`,{method:'DELETE'});
      refetchCandTags(); onTagsChanged();
    }catch{} finally{setTagBusy(false);}
  };
  const createAndAddTag = async()=>{
    const name = newTagName.trim();
    if(!name) return;
    setTagBusy(true);
    try{
      const t = await apiFetch('/candidate-tags',{method:'POST',body:JSON.stringify({name})});
      await apiFetch(`/candidate-tags/assign?candidate_id=${candidate.id}`,{method:'POST',body:JSON.stringify([t.id])});
      setNewTagName(''); refetchCandTags(); onTagsChanged();
    }catch{} finally{setTagBusy(false);}
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:500,display:'flex'}}>
      <div style={{flex:1,background:'rgba(0,0,0,0.3)'}} onClick={onClose}/>
      <div style={{width:'420px',background:'white',height:'100%',overflowY:'auto',boxShadow:'-4px 0 24px rgba(0,0,0,0.15)',display:'flex',flexDirection:'column'}}>
        {/* Header */}
        <div style={{padding:'20px 22px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:'14px',background:'#f8fafc'}}>
          <div style={{width:'48px',height:'48px',borderRadius:'50%',background:gc(candidate.full_name),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px',fontWeight:'700',color:'white',flexShrink:0}}>{gi(candidate.full_name)}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:'15px',fontWeight:'700',color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{candidate.full_name}</div>
            <div style={{fontSize:'12px',color:'#64748b'}}>{candidate.current_designation||'—'}</div>
          </div>
          <div style={{display:'flex',gap:'6px',flexShrink:0}}>
            <button onClick={()=>onEdit(candidate)} style={{padding:'6px 12px',borderRadius:'7px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#374151',display:'flex',alignItems:'center',gap:'4px'}}><Edit size={12}/>Edit</button>
            <a href={'/candidates/'+candidate.id} style={{padding:'6px 12px',borderRadius:'7px',border:'1px solid #e2e8f0',background:'white',textDecoration:'none',fontSize:'12px',fontWeight:'600',color:'#374151',display:'flex',alignItems:'center',gap:'4px'}}><ExternalLink size={12}/>Full</a>
            <button onClick={onClose} style={{padding:'6px',borderRadius:'7px',border:'none',background:'none',cursor:'pointer',color:'#94a3b8'}}><X size={16}/></button>
          </div>
        </div>
        {/* Pipeline status */}
        {sc && (
          <div style={{padding:'10px 22px',background:'#fffbeb',borderBottom:'1px solid #fef3c7',display:'flex',alignItems:'center',gap:'8px'}}>
            <Layers size={13} style={{color:'#d97706'}}/>
            <span style={{fontSize:'12px',fontWeight:'600',color:'#92400e'}}>In Pipeline:</span>
            <span style={{padding:'2px 8px',borderRadius:'10px',fontSize:'11px',fontWeight:'700',background:sc.bg,color:sc.color}}>{sc.label}</span>
            {candidate.pipeline_job && <span style={{fontSize:'11px',color:'#78350f',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{candidate.pipeline_job}</span>}
          </div>
        )}
        {/* Tags */}
        <div style={{padding:'14px 22px',borderBottom:'1px solid #f1f5f9',position:'relative'}}>
          <div style={{fontSize:'11px',fontWeight:'600',color:'#64748b',marginBottom:'8px'}}>TAGS</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'6px',alignItems:'center'}}>
            {candTags.map((t:any)=>(
              <span key={t.id} style={{display:'inline-flex',alignItems:'center',gap:'4px',fontSize:'11px',fontWeight:'600',padding:'3px 8px',borderRadius:'8px',background:`${t.color}1a`,color:t.color}}>
                {t.name}
                <button onClick={()=>removeTag(t.id)} disabled={tagBusy} style={{border:'none',background:'none',cursor:'pointer',color:'inherit',padding:0,display:'flex',opacity:0.7}}><X size={10}/></button>
              </span>
            ))}
            <button onClick={()=>setShowTagPicker(v=>!v)} style={{fontSize:'11px',fontWeight:'600',padding:'3px 9px',borderRadius:'8px',border:'1px dashed #cbd5e1',background:'white',color:'#64748b',cursor:'pointer'}}>+ Add tag</button>
          </div>
          {showTagPicker && (
            <div style={{marginTop:'10px',padding:'10px',background:'#f8fafc',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
              {availableTags.length>0 && (
                <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'8px'}}>
                  {availableTags.map((t:any)=>(
                    <button key={t.id} onClick={()=>addTag(t.id)} disabled={tagBusy} style={{fontSize:'11px',fontWeight:'600',padding:'3px 8px',borderRadius:'8px',border:'none',background:`${t.color}1a`,color:t.color,cursor:'pointer'}}>{t.name}</button>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:'6px'}}>
                <input value={newTagName} onChange={e=>setNewTagName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createAndAddTag()} placeholder="New tag name..." style={{flex:1,padding:'6px 9px',border:'1px solid #e2e8f0',borderRadius:'6px',fontSize:'12px',outline:'none'}}/>
                <button onClick={createAndAddTag} disabled={tagBusy||!newTagName.trim()} style={{padding:'6px 12px',borderRadius:'6px',border:'none',background:'#1e40af',color:'white',fontSize:'11px',fontWeight:'600',cursor:'pointer'}}>Create</button>
              </div>
            </div>
          )}
        </div>
        {/* Info grid */}
        <div style={{padding:'18px 22px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
            {[
              {label:'Email',      value:candidate.email,      icon:<Mail size={11}/>},
              {label:'Phone',      value:candidate.phone,      icon:<Phone size={11}/>},
              {label:'Location',   value:candidate.location,   icon:<MapPin size={11}/>},
              {label:'Company',    value:candidate.current_employer, icon:<Briefcase size={11}/>},
              {label:'Experience', value:exp||'—',             icon:null},
              {label:'Expected',   value:fc(candidate.expected_ctc)||'—', icon:null},
              {label:'Current CTC',value:fc(candidate.current_ctc)||'—',  icon:null},
              {label:'Notice',     value:candidate.notice_period_days>0?candidate.notice_period_days+'d':'—', icon:<Clock size={11}/>},
              {label:'Source',     value:candidate.source||'—', icon:null},
              {label:'Last Active',value:timeAgo(candidate.last_activity)||timeAgo(candidate.updated_at)||'—', icon:<Clock size={11}/>},
            ].map(({label,value,icon})=>(
              <div key={label}>
                <div style={{fontSize:'10px',fontWeight:'600',color:'#94a3b8',textTransform:'uppercase',marginBottom:'2px'}}>{label}</div>
                <div style={{fontSize:'12px',color:'#1e293b',display:'flex',alignItems:'center',gap:'4px'}}>{icon}{value||'—'}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Skills */}
        {(candidate.skills||[]).length>0 && (
          <div style={{padding:'14px 22px',borderBottom:'1px solid #f1f5f9'}}>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#64748b',marginBottom:'8px'}}>SKILLS ({(candidate.skills||[]).length})</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
              {(candidate.skills||[]).map((s:string)=>(
                <span key={s} style={{fontSize:'11px',padding:'3px 8px',borderRadius:'6px',background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe'}}>{s}</span>
              ))}
            </div>
          </div>
        )}
        {/* Applications */}
        {Array.isArray(apps) && apps.length>0 && (
          <div style={{padding:'14px 22px',borderBottom:'1px solid #f1f5f9'}}>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#64748b',marginBottom:'8px'}}>PIPELINE HISTORY ({apps.length})</div>
            {apps.map((a:any)=>{
              const st = stageMap[a.stage]||{bg:'#f1f5f9',color:'#64748b',label:a.stage};
              return (
                <div key={a.id} style={{padding:'8px 0',borderBottom:'1px solid #f8fafc',display:'flex',alignItems:'center',gap:'10px'}}>
                  <span style={{padding:'2px 8px',borderRadius:'8px',fontSize:'11px',fontWeight:'600',background:st.bg,color:st.color}}>{st.label}</span>
                  <span style={{fontSize:'12px',color:'#374151',flex:1}}>{a.job_title||a.requisition_title||'—'}</span>
                </div>
              );
            })}
          </div>
        )}
        {/* Resume preview */}
        {candidate.resume_text && (
          <div style={{padding:'14px 22px',flex:1}}>
            <div style={{fontSize:'11px',fontWeight:'600',color:'#64748b',marginBottom:'8px'}}>RESUME EXTRACT</div>
            <pre style={{fontSize:'11px',color:'#374151',lineHeight:'1.5',whiteSpace:'pre-wrap',wordBreak:'break-word',maxHeight:'200px',overflowY:'auto',background:'#f8fafc',padding:'10px',borderRadius:'6px',margin:0}}>{candidate.resume_text.slice(0,800)}{candidate.resume_text.length>800?'...':''}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Duplicates Modal ─────────────────────────────────────────────────────────
function DuplicatesModal({onClose,onRefetch}:{onClose:()=>void;onRefetch:()=>void}) {
  const {data,loading,refetch:refetchDups} = useFetch<any>('/candidates/duplicates');
  const [merging,setMerging] = useState<string|null>(null);
  const groups = (data as any)?.groups||[];

  async function merge(keepId:string, discardId:string, name:string) {
    if (!confirm(`Merge duplicate "${name}"?\n\nThe older record (first listed) will be kept. The duplicate will be deactivated and its applications transferred.`)) return;
    setMerging(discardId);
    try {
      await apiFetch(`/candidates/${keepId}/merge`,{method:'POST',body:JSON.stringify({discard_id:discardId})});
      refetchDups();
      onRefetch();
    } catch(e:any){alert(e?.message||'Merge failed');}
    finally{setMerging(null);}
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:600,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
      <div style={{background:'white',borderRadius:'16px',width:'700px',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
        <div style={{padding:'22px 28px',borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'white',zIndex:1}}>
          <div>
            <h2 style={{fontSize:'17px',fontWeight:'800',color:'#0f172a',margin:0}}>Duplicate Candidates</h2>
            <p style={{fontSize:'12px',color:'#64748b',margin:'3px 0 0'}}>{groups.length} groups with matching names · Keep the most complete record</p>
          </div>
          <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8'}}><X size={20}/></button>
        </div>
        <div style={{padding:'20px 28px'}}>
          {loading && <div style={{textAlign:'center',padding:'40px',color:'#64748b'}}>Loading duplicates...</div>}
          {!loading && groups.length===0 && <div style={{textAlign:'center',padding:'40px',color:'#16a34a',fontSize:'14px'}}>✅ No duplicate names found</div>}
          {groups.map((g:any)=>(
            <div key={g.full_name} style={{marginBottom:'20px',border:'1px solid #fee2e2',borderRadius:'12px',overflow:'hidden'}}>
              <div style={{padding:'12px 16px',background:'#fef2f2',borderBottom:'1px solid #fee2e2',display:'flex',alignItems:'center',gap:'8px'}}>
                <AlertTriangle size={14} style={{color:'#ef4444'}}/>
                <span style={{fontSize:'13px',fontWeight:'700',color:'#991b1b'}}>{g.full_name}</span>
                <span style={{fontSize:'11px',color:'#ef4444',fontWeight:'600'}}>×{g.cnt} duplicates</span>
              </div>
              {(g.ids||[]).map((id:string,i:number)=>(
                <div key={id} style={{padding:'12px 16px',borderBottom:i<g.ids.length-1?'1px solid #fef2f2':'none',display:'flex',alignItems:'center',gap:'12px'}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'12px',color:'#374151'}}>{g.emails?.[i]||<span style={{color:'#94a3b8'}}>no email</span>}</div>
                    <div style={{fontSize:'11px',color:'#64748b'}}>
                      {g.phones?.[i]||'no phone'} · {g.employers?.[i]||'no company'} · {g.exps?.[i]>0?gx(g.exps[i]):'no exp'} · Added {g.dates?.[i]||'—'}
                    </div>
                  </div>
                  {i===0 && <span style={{fontSize:'11px',padding:'3px 8px',borderRadius:'6px',background:'#dcfce7',color:'#166534',fontWeight:'600',flexShrink:0}}>KEEP</span>}
                  {i>0 && (
                    <button
                      onClick={()=>merge(g.ids[0], id, g.full_name)}
                      disabled={merging===id}
                      style={{padding:'5px 12px',borderRadius:'7px',border:'none',background:merging===id?'#94a3b8':'#dc2626',color:'white',cursor:merging===id?'not-allowed':'pointer',fontSize:'11px',fontWeight:'700',display:'flex',alignItems:'center',gap:'5px',flexShrink:0}}>
                      <GitMerge size={11}/>{merging===id?'Merging...':'Merge → Keep oldest'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sort Header Cell ─────────────────────────────────────────────────────────
function SortTh({label,col,sort,onSort,style:s}:{label:string;col:string;sort:{by:string;dir:string};onSort:(c:string)=>void;style?:any}) {
  const active = sort.by===col;
  return (
    <th onClick={()=>onSort(col)} style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:active?'#1e40af':'#64748b',cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',...s}}>
      <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
        {label}
        {active ? (sort.dir==='asc'?<ArrowUp size={11}/>:<ArrowDown size={11}/>) : <ArrowUpDown size={11} style={{opacity:0.3}}/>}
      </div>
    </th>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function CandidatesPage() {
  // form/modal
  const [showModal,setShowModal] = useState(false);
  const [editId,setEditId] = useState<string|null>(null);
  const [form,setForm] = useState({...EMPTY});
  const [saving,setSaving] = useState(false);
  const [err,setErr] = useState('');
  const [dupWarning,setDupWarning] = useState<any>(null);
  const [skipDupCheck,setSkipDupCheck] = useState(false);
  const [skIn,setSkIn] = useState('');

  // filters
  const [search,setSearch] = useState('');
  const [srcFilter,setSrcFilter] = useState('');
  const [skillFilter,setSkillFilter] = useState('');
  const [employerFilter,setEmployerFilter] = useState('');
  const [locationFilter,setLocationFilter] = useState('');
  const [minExpYr,setMinExpYr] = useState('');
  const [maxExpYr,setMaxExpYr] = useState('');
  const [tagFilter,setTagFilter] = useState('');
  const [showFilters,setShowFilters] = useState(false);
  const [appliedFilters,setAppliedFilters] = useState<Record<string,string>>({});

  // sort + pagination
  const [sort,setSort] = useState({by:'created_at',dir:'desc'});
  const [page,setPage] = useState(0);

  // selection + modals
  const [selected,setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignOpen,setBulkAssignOpen] = useState(false);
  const [showDups,setShowDups] = useState(false);

  // quick-view drawer
  const [drawer,setDrawer] = useState<any>(null);

  // import/export
  const [importing,setImporting] = useState(false);
  const [importResult,setImportResult] = useState<{created:number,errors:number}|null>(null);
  const [exporting,setExporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // JD ranking
  const [showJD,setShowJD] = useState(false);
  const [jdText,setJdText] = useState('');
  const [ranking,setRanking] = useState(false);
  const [rankResult,setRankResult] = useState<any>(null);

  // status toast
  const [statusMsg,setStatusMsg] = useState('');
  const showStatus = (m:string,ms=3000)=>{setStatusMsg(m);setTimeout(()=>setStatusMsg(''),ms);};

  // reset page on filter/sort/source change
  useEffect(()=>{ setPage(0); }, [appliedFilters, sort, srcFilter, tagFilter]);

  const apiQuery = useMemo(()=>{
    const p = new URLSearchParams({limit:String(PAGE_SIZE), offset:String(page*PAGE_SIZE), sort_by:sort.by, sort_dir:sort.dir});
    if (appliedFilters.search)   p.set('search',  appliedFilters.search);
    if (appliedFilters.skill)    p.set('skill',   appliedFilters.skill);
    if (appliedFilters.location) p.set('location',appliedFilters.location);
    if (appliedFilters.employer) p.set('employer',appliedFilters.employer);
    if (appliedFilters.minExp)   p.set('min_exp', String(Number(appliedFilters.minExp)*12));
    if (appliedFilters.maxExp)   p.set('max_exp', String(Number(appliedFilters.maxExp)*12));
    if (srcFilter) p.set('source',srcFilter);
    if (tagFilter) p.set('tag_id',tagFilter);
    return `/candidates?${p.toString()}`;
  },[appliedFilters,sort,page,srcFilter,tagFilter]);

  const {data:cr,loading,refetch} = useFetch<any>(apiQuery);
  const items:any[] = (cr as any)?.items||[];
  const total:number = (cr as any)?.total||0;
  const totalPages = Math.max(1,Math.ceil(total/PAGE_SIZE));

  const {data:stageConfig} = useFetch<any[]>('/settings/pipeline-stages');
  const stageMap:Record<string,{bg:string;color:string;label:string}> = (stageConfig && stageConfig.length>0)
    ? Object.fromEntries(stageConfig.map((s:any)=>[s.stage_key,{bg:`${s.color}1a`,color:s.color,label:s.label}]))
    : DEFAULT_STAGE_C;

  const {data:allTagsRaw,refetch:refetchTags} = useFetch<any[]>('/candidate-tags');
  const allTags:any[] = Array.isArray(allTagsRaw)?allTagsRaw:[];

  const handleSort = (col:string) => {
    setSort(s => s.by===col ? {...s,dir:s.dir==='asc'?'desc':'asc'} : {by:col,dir:'desc'});
  };

  // selection helpers
  const allSelected = items.length>0 && items.every((c:any)=>selected.has(c.id));
  const toggleAll = ()=> setSelected(allSelected ? new Set() : new Set(items.map((c:any)=>c.id)));
  const toggleSel = (id:string)=>{ const s=new Set(selected); s.has(id)?s.delete(id):s.add(id); setSelected(s); };

  // handlers
  const openCreate = ()=>{setForm({...EMPTY});setEditId(null);setErr('');setDupWarning(null);setSkipDupCheck(false);setShowModal(true);};
  const openEdit   = (d:any)=>{
    setForm({full_name:d.full_name||'',email:d.email||'',phone:d.phone||'',location:d.location||'',
      current_employer:d.current_employer||'',current_designation:d.current_designation||'',
      total_exp_mo:d.total_exp_mo||0,expected_ctc:d.expected_ctc||'',current_ctc:d.current_ctc||'',
      notice_period_days:d.notice_period_days||'',linkedin_url:d.linkedin_url||'',
      source:d.source||'linkedin',skills:d.skills||[],resume_text:d.resume_text||''});
    setEditId(d.id);setErr('');setShowModal(true);
  };
  const addSk=(s:string)=>{const t=s.trim();if(t&&!form.skills.includes(t))setForm(f=>({...f,skills:[...f.skills,t]}));setSkIn('');};
  const rmSk =(s:string)=>setForm(f=>({...f,skills:f.skills.filter((x:string)=>x!==s)}));

  const handleSave = async()=>{
    if (!form.full_name.trim()){setErr('Full name required');return;}
    if (!editId && !skipDupCheck && (form.email||form.phone)) {
      const p=new URLSearchParams();
      if(form.email) p.append('email',form.email);
      if(form.phone) p.append('phone',form.phone);
      try {
        const dup = await apiFetch('/candidates/check-duplicate?'+p.toString());
        if((dup as any).has_duplicate){setDupWarning(dup);return;}
      } catch{}
    }
    setSaving(true);setErr('');setSkipDupCheck(false);
    try {
      const payload={...form,total_exp_mo:Number(form.total_exp_mo)||0,
        expected_ctc:form.expected_ctc?Number(form.expected_ctc):null,
        current_ctc:form.current_ctc?Number(form.current_ctc):null,
        notice_period_days:form.notice_period_days?Number(form.notice_period_days):null};
      if(editId) await apiFetch(`/candidates/${editId}`,{method:'PUT',body:JSON.stringify(payload)});
      else       await apiFetch('/candidates',{method:'POST',body:JSON.stringify(payload)});
      setShowModal(false);refetch();
    } catch(e:any){setErr(e.message||'Save failed');}
    finally{setSaving(false);}
  };

  const handleDel = async(id:string)=>{
    if(!confirm('Delete this candidate? They will be hidden from the list.'))return;
    try{await apiFetch(`/candidates/${id}`,{method:'DELETE'});refetch();}catch{}
  };

  const handleBulkDelete = async()=>{
    const ids = Array.from(selected);
    if(!confirm(`Delete ${ids.length} selected candidate${ids.length>1?'s':''}? They will be hidden from the list.`))return;
    try {
      await apiFetch('/candidates/bulk-delete',{method:'POST',body:JSON.stringify({ids})});
      setSelected(new Set());
      showStatus(`✅ ${ids.length} candidate${ids.length>1?'s':''} deleted`);
      refetch();
    } catch(e:any){showStatus('Delete failed: '+(e?.message||'error'));}
  };

  const handleExport = async()=>{
    setExporting(true);
    try {
      const p=new URLSearchParams();
      if(appliedFilters.search) p.set('search',appliedFilters.search);
      if(appliedFilters.skill)  p.set('skill', appliedFilters.skill);
      if(appliedFilters.location) p.set('location',appliedFilters.location);
      if(appliedFilters.employer) p.set('employer',appliedFilters.employer);
      const res=await fetch(`${API}/candidates/export?${p.toString()}`,{headers:authHeaders()});
      if(!res.ok)throw new Error('Export failed');
      const blob=await res.blob();
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=`candidates_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
    } catch(e:any){showStatus('Export failed: '+(e?.message||'unknown'));}
    finally{setExporting(false);}
  };

  const handleImportFile = async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file)return;
    setImporting(true);setImportResult(null);
    const target = e.target;
    try {
      const text=await file.text();
      const lines=text.split(/\r?\n/).filter(l=>l.trim());
      if(lines.length<2){setImporting(false);return;}
      const headerMap:Record<string,number>={};
      const rawHeaders=lines[0].split(',').map(h=>h.replace(/^"|"$/g,'').trim().toLowerCase());
      rawHeaders.forEach((h,i)=>{
        const key = h==='name'||h==='full_name'?'full_name'
          :h==='email'?'email'
          :h==='phone'||h==='mobile'?'phone'
          :h==='location'||h==='city'?'location'
          :h==='employer'||h==='company'||h==='current_employer'?'current_employer'
          :h==='designation'||h==='current_designation'?'current_designation'
          :h==='exp'||h==='experience'||h==='total_exp_mo'?'total_exp_mo'
          :h==='expected_ctc'||h==='ctc'?'expected_ctc'
          :h==='current_ctc'?'current_ctc'
          :h==='notice'||h==='notice_period_days'?'notice_period_days'
          :h==='linkedin'||h==='linkedin_url'?'linkedin_url'
          :h==='source'?'source'
          :h==='skills'?'skills'
          :null;
        if(key) headerMap[key]=i;
      });
      let created=0,errors=0;
      for(let i=1;i<lines.length;i++){
        const vals=lines[i].split(',').map(v=>v.replace(/^"|"$/g,'').trim());
        const get=(k:string)=>headerMap[k]!=null?vals[headerMap[k]]||'':'';
        const payload:any={
          full_name:get('full_name'),email:get('email'),phone:get('phone'),
          location:get('location'),current_employer:get('current_employer'),
          current_designation:get('current_designation'),
          total_exp_mo:parseInt(get('total_exp_mo'))||0,
          expected_ctc:get('expected_ctc')?parseFloat(get('expected_ctc')):null,
          current_ctc:get('current_ctc')?parseFloat(get('current_ctc')):null,
          notice_period_days:get('notice_period_days')?parseInt(get('notice_period_days')):null,
          linkedin_url:get('linkedin_url'),source:get('source')||'direct',
          skills:get('skills')?get('skills').split(';').map((s:string)=>s.trim()).filter(Boolean):[]
        };
        if(!payload.full_name)continue;
        try{await apiFetch('/candidates',{method:'POST',body:JSON.stringify(payload)});created++;}
        catch{errors++;}
      }
      setImportResult({created,errors});refetch();
    } catch(e:any){showStatus('Import error: '+(e?.message||'unknown'));}
    finally{setImporting(false);if(target)target.value='';}
  };

  const runJDRank = async()=>{
    if(!jdText.trim())return;
    setRanking(true);
    try{const r=await apiFetch('/candidates/rank',{method:'POST',body:JSON.stringify({jd_text:jdText,limit:20})});setRankResult(r);}
    catch(e:any){showStatus('Ranking failed: '+(e?.message||'error'));}
    finally{setRanking(false);}
  };

  const applyFilters=()=>{setAppliedFilters({search,skill:skillFilter,location:locationFilter,employer:employerFilter,minExp:minExpYr,maxExp:maxExpYr});};
  const clearFilters=()=>{setSearch('');setSkillFilter('');setLocationFilter('');setEmployerFilter('');setMinExpYr('');setMaxExpYr('');setSrcFilter('');setTagFilter('');setAppliedFilters({});};
  const hasActiveFilters = Boolean(Object.values(appliedFilters).some(Boolean)||srcFilter||tagFilter);

  return (
    <div style={{padding:'24px',maxWidth:'1600px'}}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'20px',flexWrap:'wrap',gap:'12px'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'800',color:'#0f172a',margin:0}}>Candidates</h1>
          <p style={{fontSize:'13px',color:'#64748b',margin:'4px 0 0'}}>{total.toLocaleString()} candidates · Page {page+1}/{totalPages}</p>
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <input ref={importRef} type="file" accept=".csv" style={{display:'none'}} onChange={handleImportFile}/>
          <button onClick={()=>importRef.current?.click()} disabled={importing} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#374151'}}><Upload size={13}/>{importing?'Importing...':'Import CSV'}</button>
          <button onClick={handleExport} disabled={exporting} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#374151'}}><Download size={13}/>{exporting?'Exporting...':'Export CSV'}</button>
          <button onClick={()=>setShowDups(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',border:'1px solid #f59e0b',background:'#fffbeb',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#92400e'}}><GitMerge size={13}/>Duplicates</button>
          <button onClick={()=>setShowJD(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',borderRadius:'8px',border:'none',background:'linear-gradient(135deg,#7c3aed,#2563eb)',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'700'}}><Brain size={13}/>JD Match</button>
          <button onClick={openCreate} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',borderRadius:'8px',border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'700'}}><Plus size={13}/>Add Candidate</button>
        </div>
      </div>

      {importResult && (
        <div style={{marginBottom:'12px',padding:'10px 16px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:'8px',fontSize:'13px',color:'#166534',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>✅ Import done: <strong>{importResult.created}</strong> added, <strong>{importResult.errors}</strong> errors</span>
          <button onClick={()=>setImportResult(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#166534'}}><X size={14}/></button>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',padding:'14px 16px',marginBottom:'16px'}}>
        <div style={{display:'flex',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
          <div style={{flex:1,minWidth:'200px',position:'relative'}}>
            <Search size={14} style={{position:'absolute',left:'10px',top:'50%',transform:'translateY(-50%)',color:'#94a3b8',pointerEvents:'none'}}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&applyFilters()} placeholder="Name, email, phone, company, skill..." style={{width:'100%',padding:'8px 10px 8px 32px',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'13px',outline:'none',boxSizing:'border-box'}}/>
          </div>
          <button onClick={()=>setShowFilters(f=>!f)} style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 12px',border:'1px solid #e2e8f0',borderRadius:'8px',background:showFilters||hasActiveFilters?'#eff6ff':'white',color:hasActiveFilters?'#1e40af':'#64748b',cursor:'pointer',fontSize:'12px',fontWeight:'600',whiteSpace:'nowrap'}}>
            <Filter size={13}/> Filters {hasActiveFilters&&<span style={{background:'#1e40af',color:'white',borderRadius:'50%',width:'16px',height:'16px',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:'700',marginLeft:'2px'}}>!</span>}
          </button>
          <button onClick={applyFilters} style={{padding:'8px 16px',borderRadius:'8px',border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'700'}}>Search</button>
          {hasActiveFilters&&<button onClick={clearFilters} style={{padding:'8px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'12px',color:'#64748b'}}>Clear</button>}
        </div>

        {showFilters && (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'10px',marginTop:'12px',paddingTop:'12px',borderTop:'1px solid #f1f5f9'}}>
            <div><label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>SKILL</label>
              <input value={skillFilter} onChange={e=>setSkillFilter(e.target.value)} placeholder="e.g. SAP ABAP" style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/></div>
            <div><label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>LOCATION</label>
              <input value={locationFilter} onChange={e=>setLocationFilter(e.target.value)} placeholder="City or state" style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/></div>
            <div><label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>COMPANY</label>
              <input value={employerFilter} onChange={e=>setEmployerFilter(e.target.value)} placeholder="e.g. Infosys" style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/></div>
            <div><label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>MIN EXP (yr)</label>
              <input type="number" value={minExpYr} onChange={e=>setMinExpYr(e.target.value)} min={0} max={40} style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/></div>
            <div><label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>MAX EXP (yr)</label>
              <input type="number" value={maxExpYr} onChange={e=>setMaxExpYr(e.target.value)} min={0} max={40} style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/></div>
            <div><label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>SOURCE</label>
              <select value={srcFilter} onChange={e=>setSrcFilter(e.target.value)} style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}>
                <option value="">All sources</option>
                {SRC.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
              </select></div>
            <div><label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>TAG</label>
              <select value={tagFilter} onChange={e=>setTagFilter(e.target.value)} style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}>
                <option value="">All tags</option>
                {allTags.map((t:any)=><option key={t.id} value={t.id}>{t.name} ({t.usage_count||0})</option>)}
              </select></div>
          </div>
        )}
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'clip'}}>
        {loading ? (
          <div style={{padding:'32px'}}>{[1,2,3,4,5].map(i=><div key={i} style={{height:'52px',borderRadius:'8px',marginBottom:'8px',background:'#f1f5f9',animation:'pulse 1.5s infinite'}}/>)}</div>
        ) : items.length===0 ? (
          <div style={{textAlign:'center',padding:'80px 20px'}}>
            <div style={{fontSize:'48px',marginBottom:'12px'}}>👤</div>
            <h3 style={{fontSize:'16px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>{hasActiveFilters?'No candidates match these filters':'No candidates yet'}</h3>
            {hasActiveFilters
              ? <button onClick={clearFilters} style={{padding:'10px 24px',background:'#f1f5f9',color:'#374151',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>Clear Filters</button>
              : <button onClick={openCreate}   style={{padding:'10px 24px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add Candidate</button>}
          </div>
        ) : (
          <>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',minWidth:'1100px',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                  <th style={{padding:'10px 14px',width:'36px'}}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{accentColor:'#1e40af',cursor:'pointer',width:'15px',height:'15px'}}/>
                  </th>
                  <SortTh label="Name"     col="full_name"    sort={sort} onSort={handleSort}/>
                  <th style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b'}}>Phone</th>
                  <SortTh label="Exp"      col="total_exp_mo" sort={sort} onSort={handleSort}/>
                  <SortTh label="Exp CTC"  col="expected_ctc" sort={sort} onSort={handleSort}/>
                  <th style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b'}}>Company</th>
                  <th style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b'}}>Skills</th>
                  <th style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b'}}>Pipeline</th>
                  <SortTh label="Activity" col="last_activity" sort={sort} onSort={handleSort}/>
                  <th style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b'}}>Source</th>
                  <th style={{padding:'10px 14px',position:'sticky',right:0,background:'#f8fafc',boxShadow:'-2px 0 4px rgba(0,0,0,0.06)',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',textAlign:'center'}}>Actions</th>
                </tr>
              </thead>
              <tbody data-testid="candidate-list">
                {items.map((d:any)=>{
                  const sc = d.pipeline_stage ? (stageMap[d.pipeline_stage]||null) : null;
                  const exp = gx(d.total_exp_mo);
                  const activity = timeAgo(d.last_activity) || timeAgo(d.updated_at);
                  const isSel = selected.has(d.id);
                  return (
                    <tr key={d.id} style={{borderBottom:'1px solid #f1f5f9',background:isSel?'#eff6ff':'white',transition:'background 0.1s'}}
                      onMouseEnter={e=>{if(!isSel)(e.currentTarget as HTMLElement).style.background='#f8faff';}}
                      onMouseLeave={e=>{if(!isSel)(e.currentTarget as HTMLElement).style.background='white';}}>
                      <td style={{padding:'10px 14px',width:'36px'}}>
                        <input type="checkbox" checked={isSel} onChange={()=>toggleSel(d.id)} style={{accentColor:'#1e40af',cursor:'pointer',width:'15px',height:'15px'}}/>
                      </td>
                      {/* Name — click opens drawer */}
                      <td style={{padding:'10px 14px',cursor:'pointer'}} onClick={()=>setDrawer(d)}>
                        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                          <div style={{width:'34px',height:'34px',borderRadius:'50%',background:gc(d.full_name),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',color:'white',flexShrink:0}}>{gi(d.full_name)}</div>
                          <div>
                            <div style={{fontSize:'13px',fontWeight:'600',color:'#1e40af',textDecoration:'underline',textDecorationStyle:'dotted'}}>{d.full_name}</div>
                            <div style={{fontSize:'11px',color:'#94a3b8',display:'flex',alignItems:'center',gap:'4px',marginTop:'1px'}}><Mail size={10}/>{d.email||'—'}</div>
                            {d.current_designation&&<div style={{fontSize:'10px',color:'#64748b',marginTop:'1px'}}>{d.current_designation}</div>}
                            {(d.tags||[]).length>0&&(
                              <div style={{display:'flex',flexWrap:'wrap',gap:'3px',marginTop:'3px'}}>
                                {d.tags.map((t:any)=><span key={t.id} style={{fontSize:'9px',fontWeight:'600',padding:'1px 6px',borderRadius:'8px',background:`${t.color}1a`,color:t.color}}>{t.name}</span>)}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{padding:'10px 14px'}}>
                        {d.phone
                          ? <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'#475569'}}><Phone size={11}/>{d.phone}</div>
                          : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                      </td>
                      {/* Exp */}
                      <td style={{padding:'10px 14px'}}>
                        {exp
                          ? <span style={{fontSize:'11px',fontWeight:'600',padding:'2px 8px',borderRadius:'10px',background:'#dbeafe',color:'#1e40af'}}>{exp}</span>
                          : <span style={{fontSize:'11px',fontWeight:'500',padding:'2px 8px',borderRadius:'10px',background:'#f8fafc',color:'#94a3b8'}}>—</span>}
                        {d.notice_period_days > 0 && <div style={{fontSize:'10px',color:'#64748b',marginTop:'2px'}}>{d.notice_period_days}d notice</div>}
                      </td>
                      {/* CTC */}
                      <td style={{padding:'10px 14px'}}>
                        {d.expected_ctc
                          ? <div style={{fontSize:'12px',color:'#059669',fontWeight:'600'}}>{fc(d.expected_ctc)}</div>
                          : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                        {d.current_ctc && <div style={{fontSize:'10px',color:'#94a3b8'}}>Curr:{fc(d.current_ctc)}</div>}
                      </td>
                      {/* Company */}
                      <td style={{padding:'10px 14px'}}>
                        {d.current_employer
                          ? <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'#475569'}}><Briefcase size={11}/>{d.current_employer}</div>
                          : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                        {d.location&&<div style={{fontSize:'10px',color:'#94a3b8',marginTop:'1px',display:'flex',alignItems:'center',gap:'3px'}}><MapPin size={9}/>{d.location}</div>}
                      </td>
                      {/* Skills */}
                      <td style={{padding:'10px 14px'}}>
                        <div style={{display:'flex',flexWrap:'wrap',gap:'3px'}}>
                          {(d.skills||[]).slice(0,2).map((s:string)=><span key={s} style={{fontSize:'10px',fontWeight:'500',padding:'2px 6px',borderRadius:'4px',background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe'}}>{s}</span>)}
                          {(d.skills||[]).length>2&&<span style={{fontSize:'10px',padding:'2px 5px',borderRadius:'4px',background:'#f8fafc',color:'#94a3b8'}}>+{d.skills.length-2}</span>}
                        </div>
                      </td>
                      {/* Pipeline status */}
                      <td style={{padding:'10px 14px'}}>
                        {sc ? (
                          <div>
                            <span style={{fontSize:'10px',fontWeight:'700',padding:'2px 7px',borderRadius:'8px',background:sc.bg,color:sc.color}}>{sc.label}</span>
                            {d.pipeline_job && <div style={{fontSize:'10px',color:'#94a3b8',marginTop:'2px',maxWidth:'120px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.pipeline_job}</div>}
                          </div>
                        ) : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                      </td>
                      {/* Last activity */}
                      <td style={{padding:'10px 14px'}}>
                        {activity
                          ? <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',color:'#64748b'}}><Clock size={10}/>{activity}</div>
                          : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                      </td>
                      {/* Source */}
                      <td style={{padding:'10px 14px'}}>
                        <span style={{fontSize:'11px',padding:'2px 8px',borderRadius:'10px',background:'#f1f5f9',color:'#475569',fontWeight:'500'}}>{d.source||'direct'}</span>
                      </td>
                      {/* Actions */}
                      <td style={{padding:'10px 14px',position:'sticky',right:0,background:isSel?'#eff6ff':'white',boxShadow:'-2px 0 4px rgba(0,0,0,0.05)'}}>
                        <div style={{display:'flex',gap:'4px',justifyContent:'center'}}>
                          <button onClick={()=>setDrawer(d)} title="Quick view" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #bfdbfe',background:'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}><Eye size={12} style={{color:'#2563eb'}}/></button>
                          <button onClick={()=>openEdit(d)} title="Edit" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}><Edit size={12} style={{color:'#64748b'}}/></button>
                          <button onClick={()=>handleDel(d.id)} title="Delete" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #fee2e2',background:'#fef2f2',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}><Trash2 size={12} style={{color:'#ef4444'}}/></button>
                          <a href={'/candidates/'+d.id} title="Open full page" style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none'}}><ExternalLink size={12} style={{color:'#64748b'}}/></a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ─────────────────────────────────────────────── */}
          <div style={{padding:'12px 16px',borderTop:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'8px'}}>
            <span style={{fontSize:'12px',color:'#64748b'}}>
              Showing {(page*PAGE_SIZE+1).toLocaleString()}–{Math.min((page+1)*PAGE_SIZE,total).toLocaleString()} of {total.toLocaleString()} candidates
            </span>
            <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
              <button onClick={()=>setPage(0)} disabled={page===0} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:page===0?'not-allowed':'pointer',color:page===0?'#94a3b8':'#374151',fontSize:'12px',fontWeight:'500'}}>«</button>
              <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:page===0?'not-allowed':'pointer',color:page===0?'#94a3b8':'#374151',fontSize:'12px',fontWeight:'500',display:'flex',alignItems:'center',gap:'3px'}}><ChevronLeft size={12}/>Prev</button>
              <span style={{fontSize:'12px',color:'#1e40af',padding:'5px 14px',borderRadius:'6px',background:'#eff6ff',fontWeight:'700'}}>Page {page+1} / {totalPages}</span>
              <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:page>=totalPages-1?'not-allowed':'pointer',color:page>=totalPages-1?'#94a3b8':'#374151',fontSize:'12px',fontWeight:'500',display:'flex',alignItems:'center',gap:'3px'}}>Next<ChevronRight size={12}/></button>
              <button onClick={()=>setPage(totalPages-1)} disabled={page>=totalPages-1} style={{padding:'5px 10px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:page>=totalPages-1?'not-allowed':'pointer',color:page>=totalPages-1?'#94a3b8':'#374151',fontSize:'12px',fontWeight:'500'}}>»</button>
            </div>
          </div>
          </>
        )}
      </div>

      {/* ── Bulk action bar ──────────────────────────────────────────────── */}
      {selected.size>0 && (
        <div style={{position:'fixed',bottom:'28px',left:'50%',transform:'translateX(-50%)',background:'#0f172a',borderRadius:'12px',padding:'12px 20px',display:'flex',alignItems:'center',gap:'16px',boxShadow:'0 8px 32px rgba(0,0,0,0.4)',zIndex:200,whiteSpace:'nowrap'}}>
          <span style={{fontSize:'13px',fontWeight:'700',color:'white'}}>{selected.size} selected</span>
          <div style={{width:'1px',height:'20px',background:'rgba(255,255,255,0.2)'}}/>
          <button onClick={()=>setBulkAssignOpen(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'7px 14px',borderRadius:'8px',border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600'}}><Users size={13}/>Add to Pipeline</button>
          <button onClick={handleBulkDelete} style={{display:'flex',alignItems:'center',gap:'6px',padding:'7px 14px',borderRadius:'8px',border:'none',background:'#dc2626',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600'}}><Trash2 size={13}/>Delete {selected.size}</button>
          <button onClick={()=>setSelected(new Set())} style={{display:'flex',alignItems:'center',gap:'4px',padding:'7px 10px',borderRadius:'8px',border:'1px solid rgba(255,255,255,0.2)',background:'transparent',color:'rgba(255,255,255,0.7)',cursor:'pointer',fontSize:'12px'}}><X size={13}/>Clear</button>
        </div>
      )}

      {/* ── Status toast ─────────────────────────────────────────────────── */}
      {statusMsg && (
        <div style={{position:'fixed',bottom:'90px',left:'50%',transform:'translateX(-50%)',background:'#0f172a',color:'white',padding:'10px 20px',borderRadius:'10px',fontSize:'13px',fontWeight:'600',zIndex:300,boxShadow:'0 4px 16px rgba(0,0,0,0.3)',whiteSpace:'nowrap'}}>{statusMsg}</div>
      )}

      {/* ── Quick-view drawer ─────────────────────────────────────────────── */}
      {drawer && <CandidateDrawer candidate={drawer} onClose={()=>setDrawer(null)} onEdit={(c)=>{setDrawer(null);openEdit(c);}} stageMap={stageMap} allTags={allTags} onTagsChanged={()=>{refetch();refetchTags();}}/>}

      {/* ── Duplicates modal ─────────────────────────────────────────────── */}
      {showDups && <DuplicatesModal onClose={()=>setShowDups(false)} onRefetch={refetch}/>}

      {/* ── Bulk Assign modal ─────────────────────────────────────────────── */}
      {bulkAssignOpen && <BulkAssignModal candidateIds={Array.from(selected)} onClose={()=>setBulkAssignOpen(false)} onDone={()=>setSelected(new Set())}/>}

      {/* ── Add / Edit modal ─────────────────────────────────────────────── */}
      <Modal open={showModal} onClose={()=>setShowModal(false)} title={editId?'Edit Candidate':'Add New Candidate'} subtitle="Fill in candidate details" size="lg"
        footer={<FormActions onClose={()=>setShowModal(false)} onSubmit={handleSave} loading={saving} submitLabel={editId?'Update Candidate':'Add Candidate'}/>}>
        {err&&<div style={{marginBottom:'16px',padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'8px',fontSize:'13px',color:'#dc2626'}}>{err}</div>}
        {dupWarning?.has_duplicate&&(
          <div style={{background:'#fffbeb',border:'2px solid #f59e0b',borderRadius:'10px',padding:'14px',marginBottom:'16px'}}>
            <b style={{color:'#92400e',display:'block',marginBottom:'8px'}}>⚠️ Possible duplicate detected!</b>
            {(dupWarning.duplicates||[]).map((d:any,i:number)=>(
              <div key={i} style={{fontSize:'13px',color:'#78350f',marginBottom:'4px'}}>
                <strong>{d.candidate.full_name}</strong> already exists with same {d.match_type}
              </div>
            ))}
            <div style={{display:'flex',gap:'8px',marginTop:'12px'}}>
              <button onClick={()=>setDupWarning(null)} style={{padding:'7px 16px',borderRadius:'7px',border:'1px solid #d97706',background:'white',color:'#92400e',cursor:'pointer',fontSize:'12px',fontWeight:'600'}}>Cancel</button>
              <button onClick={()=>{setSkipDupCheck(true);setDupWarning(null);setTimeout(handleSave,0);}} style={{padding:'7px 16px',borderRadius:'7px',border:'none',background:'#d97706',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600'}}>Add Anyway</button>
            </div>
          </div>
        )}
        <SectionDivider label="Personal Information"/>
        <FormRow><FormField label="Full Name" required><input style={INP} placeholder="e.g. Rahul Sharma" value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))}/></FormField><FormField label="Email"><input type="email" style={INP} placeholder="rahul@example.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></FormField></FormRow>
        <FormRow><FormField label="Phone"><input style={INP} placeholder="+91 9876543210" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}/></FormField><FormField label="Location"><input style={INP} placeholder="e.g. Bengaluru, Karnataka" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}/></FormField></FormRow>
        <FormRow><FormField label="LinkedIn URL"><input style={INP} placeholder="https://linkedin.com/in/..." value={form.linkedin_url} onChange={e=>setForm(f=>({...f,linkedin_url:e.target.value}))}/></FormField><FormField label="Source"><select style={INP} value={form.source} onChange={e=>setForm(f=>({...f,source:e.target.value}))}>{SRC.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></FormField></FormRow>
        <SectionDivider label="Professional Details"/>
        <FormRow><FormField label="Current Employer"><input style={INP} placeholder="e.g. Infosys" value={form.current_employer} onChange={e=>setForm(f=>({...f,current_employer:e.target.value}))}/></FormField><FormField label="Current Designation"><input style={INP} placeholder="e.g. Senior Engineer" value={form.current_designation} onChange={e=>setForm(f=>({...f,current_designation:e.target.value}))}/></FormField></FormRow>
        <FormRow cols={3}><FormField label="Experience (months)" hint={form.total_exp_mo>0?`= ${Math.floor(Number(form.total_exp_mo)/12)}y ${Number(form.total_exp_mo)%12}m`:'e.g. 48 = 4 years'}><input type="number" style={INP} min={0} max={600} value={form.total_exp_mo} onChange={e=>setForm(f=>({...f,total_exp_mo:+e.target.value}))}/></FormField><FormField label="Notice Period (days)"><input type="number" style={INP} min={0} max={365} placeholder="e.g. 30" value={form.notice_period_days} onChange={e=>setForm(f=>({...f,notice_period_days:e.target.value}))}/></FormField></FormRow>
        <FormRow><FormField label="Expected CTC" hint="Annual, e.g. 1500000 = 15 LPA"><input type="number" style={INP} placeholder="e.g. 1500000" value={form.expected_ctc} onChange={e=>setForm(f=>({...f,expected_ctc:e.target.value}))}/></FormField><FormField label="Current CTC"><input type="number" style={INP} placeholder="e.g. 1200000" value={form.current_ctc} onChange={e=>setForm(f=>({...f,current_ctc:e.target.value}))}/></FormField></FormRow>
        <SectionDivider label="Skills"/>
        <div style={{display:'flex',gap:'8px',marginBottom:'8px'}}>
          <input style={{...INP,flex:1}} placeholder="Type a skill and press Enter" value={skIn} onChange={e=>setSkIn(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addSk(skIn);}}}/>
          <button type="button" onClick={()=>addSk(skIn)} style={{padding:'9px 14px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',color:'#374151',fontWeight:'600'}}>Add</button>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'12px'}}>
          {form.skills.map((s:string)=><span key={s} style={{padding:'4px 10px',borderRadius:'20px',background:'#eff6ff',color:'#1e40af',fontSize:'12px',fontWeight:'600',display:'flex',alignItems:'center',gap:'5px'}}>{s}<button type="button" onClick={()=>rmSk(s)} style={{background:'none',border:'none',cursor:'pointer',color:'#93c5fd',padding:0,lineHeight:1,fontSize:'14px'}}>×</button></span>)}
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:'5px',marginBottom:'12px'}}>
          {['Python','React','Java','Node.js','SAP ABAP','SAP Basis','SAP FICO','AWS','Docker','PostgreSQL','DevOps','ML'].filter(s=>!form.skills.includes(s)).map(s=>(
            <button key={s} type="button" onClick={()=>addSk(s)} style={{padding:'3px 8px',borderRadius:'6px',background:'#f8fafc',color:'#64748b',border:'1px solid #e2e8f0',fontSize:'11px',cursor:'pointer'}}>{s}</button>
          ))}
        </div>
        <SectionDivider label="Resume / Notes"/>
        <textarea style={{...INP,height:'100px',resize:'vertical'}} placeholder="Paste resume text or notes..." value={form.resume_text} onChange={e=>setForm(f=>({...f,resume_text:e.target.value}))}/>
      </Modal>

      {/* ── JD Match modal ───────────────────────────────────────────────── */}
      <Modal open={showJD} onClose={()=>{setShowJD(false);setRankResult(null);}} title="JD Match — AI Ranking" subtitle="Paste a job description to rank your candidates by fit" size="lg"
        footer={<FormActions onClose={()=>{setShowJD(false);setRankResult(null);}} onSubmit={runJDRank} loading={ranking} submitLabel="Rank Candidates"/>}>
        {!rankResult ? (
          <textarea style={{...INP,height:'220px',resize:'vertical'}} placeholder="Paste the full job description here..." value={jdText} onChange={e=>setJdText(e.target.value)}/>
        ) : (
          <div>
            <div style={{padding:'10px 14px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:'8px',fontSize:'13px',color:'#166534',marginBottom:'16px'}}>✅ Ranked {(rankResult as any).ranked?.length||0} candidates by fit</div>
            <div style={{maxHeight:'400px',overflowY:'auto'}}>
              {((rankResult as any).ranked||[]).length===0&&<div style={{padding:'32px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>No candidates matched the job description skills.</div>}
              {((rankResult as any).ranked||[]).map((c:any,i:number)=>(
                <div key={c.id} style={{padding:'12px 14px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',gap:'12px'}}>
                  <span style={{fontSize:'18px',fontWeight:'800',color:'#94a3b8',width:'28px',textAlign:'center'}}>{i+1}</span>
                  <div style={{width:'36px',height:'36px',borderRadius:'50%',background:gc(c.full_name||''),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',color:'white',flexShrink:0}}>{gi(c.full_name||'')}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:'13px',fontWeight:'700',color:'#0f172a'}}>{c.full_name}</div>
                    <div style={{fontSize:'11px',color:'#64748b'}}>{c.current_designation||'—'} · {c.current_employer||'—'} · {c.total_exp_mo>0?gx(c.total_exp_mo):'—'}</div>
                    {c.matched_skills?.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:'3px',marginTop:'4px'}}>{c.matched_skills.slice(0,4).map((s:string)=><span key={s} style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#d1fae5',color:'#065f46',fontWeight:'600'}}>{s}</span>)}</div>}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:'20px',fontWeight:'800',color:c.rank_score>=70?'#16a34a':c.rank_score>=40?'#d97706':'#94a3b8'}}>{Math.round(c.rank_score||0)}%</div>
                    <div style={{fontSize:'9px',color:'#94a3b8'}}>match</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
