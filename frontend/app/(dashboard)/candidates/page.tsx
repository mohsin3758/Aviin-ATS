'use client';
import { useState, useRef, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Modal, FormField, FormRow, FormActions, SectionDivider } from '@/components/ui/Modal';
import { API, authHeaders, getTokenPayload } from '@/lib/auth';
import {
  Plus, Search, Upload, Download, Brain, Mail, Phone, MapPin, Briefcase,
  Trash2, Edit, ExternalLink, X, Filter, ChevronLeft, ChevronRight,
  FileText, Users, GitMerge, Eye, Clock, ArrowUp, ArrowDown, ArrowUpDown, AlertTriangle, Layers,
  Bookmark, Sparkles, ArrowLeft, Check, Linkedin,
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

// Resume download — no download option existed anywhere reachable from
// the Candidates list (only buried in the detail page's Parse History
// tab), even though the backend endpoint has worked the whole time.
async function downloadResume(fileId: string, fileName: string) {
  try {
    const resp = await fetch(`${API}/resume-intake/${fileId}/download`, { headers: authHeaders() });
    if (!resp.ok) { alert('Download failed: ' + resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName || 'resume';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { alert('Download error: ' + String(e)); }
}

// Multipart upload for the new document types (resume/LWD confirmation/
// other) added to Add Candidate — apiFetch hardcodes Content-Type:
// application/json so can't carry FormData, uses a raw fetch instead,
// same authHeaders() pattern as downloadResume above (never manually set
// Content-Type on a multipart body — the browser needs to generate its
// own boundary string).
async function uploadCandidateDocument(candidateId: string, documentType: 'resume'|'lwd_confirmation'|'other', file: File, notes?: string) {
  const fd = new FormData();
  fd.append('document_type', documentType);
  fd.append('file', file);
  if (notes) fd.append('notes', notes);
  const resp = await fetch(`${API}/candidates/${candidateId}/upload-document`, { method: 'POST', headers: authHeaders(), body: fd });
  if (!resp.ok) { const t = await resp.json().catch(()=>({})); throw new Error(t?.detail || 'Upload failed: ' + resp.status); }
  return resp.json();
}

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

// Ordered fallback list for the drawer's "Move to Pipeline" stage pills
// (2026-08-25) — mirrors resume-inbox/page.tsx's own PIPELINE_STAGES
// fallback/live-config pattern exactly, so this page's drawer offers the
// same real, working action the Resume Inbox drawer already has instead
// of only ever showing a passive status badge.
const PIPELINE_STAGES_FALLBACK = [
  { key:'sourced',       label:'Sourced',       color:'#6366f1' },
  { key:'contacted',     label:'Contacted',     color:'#06b6d4' },
  { key:'interested',    label:'Interested',    color:'#3b82f6' },
  { key:'nda',           label:'NDA',           color:'#f59e0b' },
  { key:'screened',      label:'Screened',      color:'#0891b2' },
  { key:'submitted',     label:'Submitted',     color:'#64748b' },
  { key:'l1_interview',  label:'L1 Interview',  color:'#7c3aed' },
  { key:'l2_interview',  label:'L2 Interview',  color:'#9333ea' },
  { key:'offer',         label:'Offer',         color:'#ca8a04' },
  { key:'placed',        label:'Placed',        color:'#16a34a' },
  { key:'hold',          label:'Hold',          color:'#94a3b8' },
];

const EMPTY = {
  full_name:'',email:'',phone:'',location:'',desired_location:'',
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
  const {data:stageConfig} = useFetch<any[]>('/settings/pipeline-stages');
  const [reqId,setReqId] = useState('');
  // REAL BUG FIX (2026-08-31): this modal never surfaced a stage choice at
  // all - every "Add to Pipeline" click silently used the backend's own
  // tenant-configured default (e.g. "Interested"). Reported live: 1,333
  // real applications had piled into "Interested" across 3 real open jobs
  // over ~10 days, largely from repeated real use of exactly this flow
  // (the JD-Match/Candidates-page "Add N to Pipeline" action). Now a real,
  // required choice, same convention as the sibling AI-match modals.
  const [stage,setStage] = useState('');
  const [saving,setSaving] = useState(false);
  const [result,setResult] = useState<any>(null);
  const reqs = Array.isArray(reqData?.data)?reqData.data:Array.isArray(reqData)?reqData:[];
  const visibleStages = (stageConfig||[]).filter((s:any)=>s.is_visible).sort((a:any,b:any)=>a.display_order-b.display_order);
  async function assign() {
    if (!reqId) {alert('Select a requisition');return;}
    if (!stage) {alert('Choose a stage');return;}
    setSaving(true);
    try {
      const r = await apiFetch('/candidates/bulk-assign',{method:'POST',body:JSON.stringify({candidate_ids:candidateIds,requisition_id:reqId,stage})});
      setResult(r); setTimeout(()=>{onDone();onClose();},1800);
    } catch(e:any){alert(e?.message||'Failed');setSaving(false);}
  }
  // zIndex must clear the shared Modal component's 9999/10000 (Modal.tsx)
  // since this can be opened ON TOP of it (e.g. from the JD Match modal's
  // "Add to Pipeline") - at 1000 it used to render BELOW that modal's
  // content, which silently intercepted every click meant for this one.
  const OV:any={position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:10500,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'};
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
            <select value={reqId} onChange={e=>setReqId(e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',fontSize:'13px',outline:'none',marginBottom:'14px'}}>
              <option value="">-- Choose a requisition --</option>
              {reqs.map((r:any)=><option key={r.id} value={r.id}>{r.title} ({r.department||'No dept'})</option>)}
            </select>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>Add into stage</label>
            <select value={stage} onChange={e=>setStage(e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:'8px',border:`1px solid ${stage?'#e2e8f0':'#fca5a5'}`,fontSize:'13px',outline:'none',marginBottom:'20px',color:stage?'#374151':'#94a3b8'}}>
              <option value="">-- Choose a stage --</option>
              {visibleStages.map((s:any)=><option key={s.stage_key} value={s.stage_key}>{s.label}</option>)}
            </select>
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px'}}>
              <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
              <button onClick={assign} disabled={saving||!reqId||!stage} style={{padding:'9px 18px',borderRadius:'8px',border:'none',background:saving||!reqId||!stage?'#94a3b8':'#1e40af',color:'white',cursor:saving||!reqId||!stage?'not-allowed':'pointer',fontSize:'13px',fontWeight:'600'}}>{saving?'Assigning...':'Assign to Pipeline'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// REAL GAP FIX (2026-08-12 audit): Resume Generator was single-candidate
// only. Deliberately scoped tight — one template applied to the whole
// batch, no per-candidate live preview (that would mean N preview calls
// and a much bigger UI), matching what the audit finding actually named.
function BulkResumeGenModal({candidateIds,onClose}:{candidateIds:string[];onClose:()=>void}) {
  const {data:templates} = useFetch<any[]>('/resume-generator/templates');
  const {data:visualThemes} = useFetch<any[]>('/resume-generator/visual-themes');
  const {data:logoPositionOptions} = useFetch<any[]>('/resume-generator/logo-position-options');
  const [templateId,setTemplateId] = useState('');
  const [visualTheme,setVisualTheme] = useState<'classic'|'modern_sidebar'|'minimal_ats'|'executive_header'|'two_tone_header'|'timeline'|'compact_grid'|'elegant_serif'>('classic');
  const [logoPosition,setLogoPosition] = useState<'top_left'|'top_right'|'none'>('top_right');
  const [outputFormat,setOutputFormat] = useState<'pdf'|'docx'>('pdf');
  const [generating,setGenerating] = useState(false);
  const [result,setResult] = useState<any>(null);

  async function run() {
    if (!templateId) { alert('Select a resume format'); return; }
    setGenerating(true);
    try {
      const r = await apiFetch('/resume-generator/bulk-generate', {
        method:'POST', body:JSON.stringify({ candidate_ids:candidateIds, template_id:templateId, visual_theme:visualTheme, logo_position:logoPosition, output_format:outputFormat }),
      });
      setResult(r);
    } catch(e:any) { alert(e?.message||'Bulk generation failed'); }
    finally { setGenerating(false); }
  }

  async function download(genId:string, ext:string) {
    const resp = await fetch(`${API}/resume-generator/${genId}/download`, { headers: authHeaders() });
    if (!resp.ok) { alert('Download failed: '+resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    // Real feature (2026-08-26): use the server's real "Candidate Name_
    // Position_TotalExp.ext" filename (Content-Disposition) instead of a
    // generic 'resume.pdf' — same-origin request, so the header is
    // readable without any Access-Control-Expose-Headers config.
    const cd = resp.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="([^"]+)"/);
    const a = document.createElement('a'); a.href=url; a.download=m?m[1]:`resume.${ext}`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }

  // Same z-index fix as BulkAssignModal above - must clear Modal.tsx's 9999/10000.
  const OV:any={position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:10500,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'};
  return (
    <div style={OV} onClick={onClose}>
      <div style={{background:'white',borderRadius:'16px',padding:'28px',width:'100%',maxWidth:'480px',maxHeight:'85vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.25)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}}>
          <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>Generate Resumes for {candidateIds.length} Candidate{candidateIds.length>1?'s':''}</h2>
          <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8',padding:'4px'}}><X size={18}/></button>
        </div>
        {result ? (
          <div>
            <div style={{textAlign:'center',padding:'12px 0 20px'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>{result.failed===0?'✅':'⚠️'}</div>
              <p style={{fontSize:'14px',fontWeight:'600',color:result.failed===0?'#16a34a':'#d97706'}}>{result.succeeded} generated, {result.failed} failed</p>
            </div>
            <div style={{maxHeight:'260px',overflowY:'auto',border:'1px solid #e2e8f0',borderRadius:'8px'}}>
              {result.results.map((r:any,i:number)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderBottom:i<result.results.length-1?'1px solid #f1f5f9':'none',fontSize:'12px'}}>
                  <span style={{color:r.status==='completed'?'#374151':'#dc2626'}}>{r.status==='completed'?'Generated':`Failed: ${r.error||'unknown'}`}</span>
                  {r.status==='completed' && (
                    <button onClick={()=>download(r.generated_resume_id, outputFormat)} style={{border:'none',background:'none',color:'#1e40af',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',fontWeight:'600'}}><Download size={12}/>Download</button>
                  )}
                </div>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',marginTop:'16px'}}>
              <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Close</button>
            </div>
          </div>
        ) : (
          <>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>Resume Format</label>
            <select value={templateId} onChange={e=>setTemplateId(e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',fontSize:'13px',outline:'none',marginBottom:'14px'}}>
              <option value="">-- Choose a format --</option>
              {(templates||[]).map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>Visual Layout</label>
            <div style={{display:'flex',gap:'8px',marginBottom:'14px',flexWrap:'wrap'}}>
              {(visualThemes||[]).map((vt:any)=>(
                <button key={vt.id} type="button" title={vt.description} onClick={()=>setVisualTheme(vt.id)} style={{padding:'6px 12px',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:visualTheme===vt.id?'1.5px solid #1e40af':'1px solid #e2e8f0',background:visualTheme===vt.id?'#eff6ff':'white',color:visualTheme===vt.id?'#1e40af':'#475569'}}>{vt.label}</button>
              ))}
            </div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>Logo Position</label>
            <div style={{display:'flex',gap:'8px',marginBottom:'14px',flexWrap:'wrap'}}>
              {(logoPositionOptions||[]).map((lp:any)=>(
                <button key={lp.id} type="button" title={lp.description} onClick={()=>setLogoPosition(lp.id)} style={{padding:'6px 12px',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:logoPosition===lp.id?'1.5px solid #1e40af':'1px solid #e2e8f0',background:logoPosition===lp.id?'#eff6ff':'white',color:logoPosition===lp.id?'#1e40af':'#475569'}}>{lp.label}</button>
              ))}
            </div>
            <label style={{fontSize:'12px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'6px'}}>Output</label>
            <div style={{display:'flex',gap:'8px',marginBottom:'20px'}}>
              {(['pdf','docx'] as const).map(f=>(
                <button key={f} onClick={()=>setOutputFormat(f)} style={{padding:'6px 14px',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer',border:outputFormat===f?'1.5px solid #1e40af':'1px solid #e2e8f0',background:outputFormat===f?'#eff6ff':'white',color:outputFormat===f?'#1e40af':'#475569'}}>{f.toUpperCase()}</button>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px'}}>
              <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
              <button onClick={run} disabled={generating||!templateId} style={{padding:'9px 18px',borderRadius:'8px',border:'none',background:generating||!templateId?'#94a3b8':'#7c3aed',color:'white',cursor:generating||!templateId?'not-allowed':'pointer',fontSize:'13px',fontWeight:'600'}}>{generating?'Generating...':`Generate ${candidateIds.length} Resume${candidateIds.length>1?'s':''}`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Quick-View Drawer ─────────────────────────────────────────────────────────
function CandidateDrawer({candidate,onClose,onEdit,stageMap,allTags,onTagsChanged}:{candidate:any;onClose:()=>void;onEdit:(c:any)=>void;stageMap:Record<string,{bg:string;color:string;label:string}>;allTags:any[];onTagsChanged:()=>void}) {
  const {data:apps,refetch:refetchApps} = useFetch<any>(`/candidates/${candidate.id}/applications`);
  // List rows don't carry latest_resume_file_id (only the single-candidate
  // GET does) - fetched separately here rather than widening the list
  // query, same pattern this drawer already uses for /applications.
  const {data:fullCand} = useFetch<any>(`/candidates/${candidate.id}`);
  const {data:candTagsRaw,refetch:refetchCandTags} = useFetch<any[]>(`/candidate-tags/candidate/${candidate.id}`);
  const candTags:any[] = Array.isArray(candTagsRaw)?candTagsRaw:[];
  const [showTagPicker,setShowTagPicker] = useState(false);
  const [newTagName,setNewTagName] = useState('');
  const [tagBusy,setTagBusy] = useState(false);
  const [tagErr,setTagErr] = useState('');
  const exp = gx(candidate.total_exp_mo);
  const sc = candidate.pipeline_stage ? (stageMap[candidate.pipeline_stage]||null) : null;

  // Move to Pipeline (2026-08-25) — the Candidates drawer only ever showed
  // a PASSIVE "In Pipeline: X" badge (above); Resume Inbox's own drawer
  // has a real action panel (job selector + clickable stage pills) that
  // this one never had. Reused endpoint/shape exactly
  // (POST /applications with candidate_id/requisition_id/stage), no
  // "auto-matched job" step here since a plain candidate record has no
  // matched_requisition_id the way a resume-inbox queue item does — just
  // a direct requisition picker, same as BulkAssignModal's own proven
  // /requisitions?limit=100&status=open pattern above.
  const {data:pipelineStageConfig} = useFetch<any[]>('/settings/pipeline-stages');
  const PIPELINE_STAGES_LIVE = (() => {
    const live = (pipelineStageConfig||[])
      .filter((s:any)=>s.is_visible && !['rejected','hold'].includes(s.stage_key))
      .sort((a:any,b:any)=>a.display_order-b.display_order)
      .map((s:any)=>({key:s.stage_key,label:s.label,color:s.color}));
    return live.length>0 ? live : PIPELINE_STAGES_FALLBACK;
  })();
  const {data:openReqs} = useFetch<any>('/requisitions?limit=100&status=open');
  const openReqList:any[] = Array.isArray((openReqs as any)?.data)?(openReqs as any).data:Array.isArray(openReqs)?(openReqs as any):[];
  const [pipelineReqId,setPipelineReqId] = useState('');
  const [pipelineStatus,setPipelineStatus] = useState<'idle'|'loading'|'success'|'exists'|'error'>('idle');
  const [pipelineStage,setPipelineStage] = useState('');
  const [pipelineMsg,setPipelineMsg] = useState('');
  async function handleMoveToStage(stage:string) {
    if (!pipelineReqId) { setPipelineStatus('error'); setPipelineMsg('Select a requisition first'); return; }
    setPipelineStatus('loading'); setPipelineStage(stage);
    try {
      await apiFetch('/applications',{method:'POST',body:JSON.stringify({candidate_id:candidate.id,requisition_id:pipelineReqId,stage})});
      setPipelineStatus('success');
      setPipelineMsg('Moved to '+(PIPELINE_STAGES_LIVE.find((s:any)=>s.key===stage)?.label||stage));
      refetchApps(); onTagsChanged();
    } catch(e:any) {
      const msg = (e?.message||String(e)).toLowerCase();
      if (msg.includes('409')||msg.includes('already')) { setPipelineStatus('exists'); setPipelineMsg('Already in pipeline for this job'); }
      else { setPipelineStatus('error'); setPipelineMsg(String(e?.message||'Failed')); }
    }
  }

  // Skill / Project Experience table (2026-08-25) — read-only display of
  // the structured per-skill project history captured on the Add/Edit
  // Candidate form (GET /candidates/{id}/skill-experience), mirrored here
  // so a recruiter reviewing a candidate can see it without opening Edit.
  const {data:skillExpData} = useFetch<any>(`/candidates/${candidate.id}/skill-experience`);
  const skillExpRows:any[] = (skillExpData as any)?.rows||[];
  const availableTags = allTags.filter((t:any)=>!candTags.some((ct:any)=>ct.id===t.id));

  const addTag = async(tagId:string)=>{
    setTagBusy(true);setTagErr('');
    try{
      await apiFetch(`/candidate-tags/assign?candidate_id=${candidate.id}`,{method:'POST',body:JSON.stringify([tagId])});
      refetchCandTags(); onTagsChanged();
    }catch(e:any){setTagErr(e?.message||'Failed to add tag');} finally{setTagBusy(false);}
  };
  const removeTag = async(tagId:string)=>{
    setTagBusy(true);setTagErr('');
    try{
      await apiFetch(`/candidate-tags/remove?candidate_id=${candidate.id}&tag_id=${tagId}`,{method:'DELETE'});
      refetchCandTags(); onTagsChanged();
    }catch(e:any){setTagErr(e?.message||'Failed to remove tag');} finally{setTagBusy(false);}
  };
  const createAndAddTag = async()=>{
    const name = newTagName.trim();
    if(!name) return;
    setTagBusy(true);setTagErr('');
    try{
      const t = await apiFetch('/candidate-tags',{method:'POST',body:JSON.stringify({name})});
      await apiFetch(`/candidate-tags/assign?candidate_id=${candidate.id}`,{method:'POST',body:JSON.stringify([t.id])});
      setNewTagName(''); refetchCandTags(); onTagsChanged();
    }catch(e:any){setTagErr(e?.message||'Failed to create tag');} finally{setTagBusy(false);}
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
          {tagErr && <div style={{fontSize:'11px',color:'#dc2626',marginTop:'6px'}}>{tagErr}</div>}
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
        {/* Skill / Project Experience table — read-only mirror of what's
            captured on the Add/Edit Candidate form (2026-08-25).
            Real bug fix, same day: this used to be hidden entirely when
            skillExpRows was empty (matching the Skills-chips/Applications
            sections' own established convention above) — but since this
            is a brand-new field, every pre-existing candidate genuinely
            has zero rows, making the whole section indistinguishable
            from "not working" (reported live against a real candidate,
            confirmed via direct API: {"rows":[]}). Now always renders,
            with an honest empty state + a direct path to fill it in,
            instead of silently disappearing. */}
        <div style={{padding:'14px 22px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{fontSize:'11px',fontWeight:'600',color:'#64748b',marginBottom:'8px'}}>SKILL / PROJECT EXPERIENCE {skillExpRows.length>0?`(${skillExpRows.length})`:''}</div>
          {skillExpRows.length===0 ? (
            <div style={{fontSize:'11px',color:'#94a3b8',fontStyle:'italic',display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px'}}>
              <span>No skill / project experience recorded yet.</span>
              <button onClick={()=>onEdit(candidate)} style={{fontSize:'11px',fontWeight:'700',color:'#1e40af',background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}}>+ Add via Edit</button>
            </div>
          ) : (
            <div style={{overflowX:'auto',border:'1px solid #e2e8f0',borderRadius:'8px'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px',minWidth:'520px'}}>
                <thead>
                  <tr style={{background:'#f8fafc'}}>
                    {['#','Skill','Project','Duration','Role','Rel. Exp','Last Used'].map(h=>(
                      <th key={h} style={{textAlign:'left',padding:'6px 8px',fontWeight:'700',color:'#64748b',borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {skillExpRows.map((r:any,i:number)=>(
                    <tr key={r.id||i} style={{borderBottom:i<skillExpRows.length-1?'1px solid #f1f5f9':'none'}}>
                      <td style={{padding:'6px 8px',color:'#94a3b8'}}>{i+1}</td>
                      <td style={{padding:'6px 8px',fontWeight:'600',color:'#1e293b'}}>{r.skill_name||'—'}</td>
                      <td style={{padding:'6px 8px',color:'#374151'}}>{r.project_name||'—'}</td>
                      <td style={{padding:'6px 8px',color:'#374151',whiteSpace:'nowrap'}}>{r.duration_from||'—'}{r.duration_to?` – ${r.duration_to}`:''}</td>
                      <td style={{padding:'6px 8px',color:'#374151'}}>{(r.role_types||[]).join(', ')||'—'}</td>
                      <td style={{padding:'6px 8px',color:'#374151'}}>{r.relevant_experience||'—'}</td>
                      <td style={{padding:'6px 8px',color:'#374151'}}>{r.last_used||'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {/* Move to Pipeline — real action panel (job picker + clickable
            stage pills), matching Resume Inbox's own drawer (2026-08-25) —
            this drawer previously only ever showed the passive "In
            Pipeline" badge above, with no way to act. */}
        <div style={{padding:'14px 22px',borderBottom:'1px solid #f1f5f9'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'10px',gap:'8px'}}>
            <div style={{fontSize:'11px',fontWeight:'800',color:'#374151',letterSpacing:'0.06em',textTransform:'uppercase'}}>🔄 Move to Pipeline</div>
          </div>
          <select data-testid="drawer-pipeline-req-select" value={pipelineReqId} onChange={e=>{setPipelineReqId(e.target.value);setPipelineStatus('idle');setPipelineMsg('');}}
            style={{width:'100%',padding:'7px 9px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',marginBottom:'10px',color:'#1e293b'}}>
            <option value="">-- Select requisition --</option>
            {openReqList.map((r:any)=><option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          {!pipelineReqId && (
            <div style={{fontSize:'11px',color:'#94a3b8',fontStyle:'italic'}}>Select a requisition above to move this candidate into its pipeline.</div>
          )}
          {pipelineReqId && pipelineStatus==='success' && (
            <div style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px',fontSize:'12px',fontWeight:'700',color:'#15803d'}}>
              ✓ {pipelineMsg}
              <a href={'/pipeline?job='+pipelineReqId} target="_blank" rel="noreferrer" style={{marginLeft:'auto',fontSize:'11px',color:'#059669',textDecoration:'none',fontWeight:'600'}}>View Pipeline →</a>
            </div>
          )}
          {pipelineReqId && pipelineStatus==='exists' && (
            <div style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 12px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:'8px',fontSize:'12px',fontWeight:'700',color:'#92400e'}}>
              ⚠ {pipelineMsg}
              <a href={'/pipeline?job='+pipelineReqId} target="_blank" rel="noreferrer" style={{marginLeft:'auto',fontSize:'11px',color:'#b45309',textDecoration:'none',fontWeight:'600'}}>View Pipeline →</a>
            </div>
          )}
          {pipelineReqId && pipelineStatus==='error' && (
            <div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'8px',fontSize:'12px',color:'#dc2626'}}>{pipelineMsg}</div>
          )}
          {pipelineReqId && pipelineStatus!=='success' && (
            <div style={{display:'flex',flexWrap:'wrap',gap:'6px'}}>
              {PIPELINE_STAGES_LIVE.map((s:any)=>{
                const isCurrent = candidate.pipeline_stage===s.key;
                return (
                  <button key={s.key} data-testid={`drawer-pipeline-stage-${s.key}`} onClick={()=>handleMoveToStage(s.key)}
                    disabled={pipelineStatus==='loading'}
                    title={isCurrent?'Candidate is currently at this stage':undefined}
                    style={{fontSize:'11px',fontWeight:'700',padding:'5px 11px',borderRadius:'20px',
                      cursor:pipelineStatus==='loading'?'wait':'pointer',
                      display:'inline-flex',alignItems:'center',gap:'4px',
                      border:isCurrent?`2px solid ${s.color}`:'1px solid '+s.color+'50',
                      background:(pipelineStatus==='loading'&&pipelineStage===s.key)?s.color:(isCurrent?s.color+'33':s.color+'15'),
                      color:(pipelineStatus==='loading'&&pipelineStage===s.key)?'#fff':s.color,
                      opacity:(pipelineStatus==='loading'&&pipelineStage!==s.key)?0.5:1,
                      transition:'all 0.15s'}}>
                    {isCurrent && <span style={{fontSize:'9px'}}>●</span>}
                    {(pipelineStatus==='loading'&&pipelineStage===s.key)?'...':s.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
              <div style={{fontSize:'11px',fontWeight:'600',color:'#64748b'}}>RESUME EXTRACT</div>
              {fullCand?.latest_resume_file_id && (
                <button onClick={()=>downloadResume(fullCand.latest_resume_file_id, fullCand.latest_resume_file_name)}
                  style={{display:'flex',alignItems:'center',gap:'4px',padding:'3px 9px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'11px',fontWeight:'600',color:'#1e40af'}}>
                  <Download size={11}/>Download
                </button>
              )}
            </div>
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

// ── Bulk CV Upload Modal (P23: AI-parsed multi-resume upload) ─────────────────
function BulkCVModal({onClose,onDone}:{onClose:()=>void;onDone:()=>void}) {
  const [files,setFiles] = useState<File[]>([]);
  const [parsing,setParsing] = useState(false);
  const [results,setResults] = useState<any[]|null>(null);
  const [selected,setSelected] = useState<Set<number>>(new Set());
  const [creating,setCreating] = useState(false);
  const [createSummary,setCreateSummary] = useState<{created:number;errors:number}|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFiles = (e:React.ChangeEvent<HTMLInputElement>) => {
    const f = Array.from(e.target.files||[]);
    setFiles(f); setResults(null); setCreateSummary(null);
  };

  const parse = async () => {
    if (files.length===0) return;
    setParsing(true);
    try {
      const fd = new FormData();
      files.forEach(f=>fd.append('files', f));
      const res = await fetch(`${API}/bulk-cv/parse`, {method:'POST', headers:authHeaders(), body:fd});
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data?.detail || 'Parse failed');
      const rows: any[] = data.results||[];
      setResults(rows);
      setSelected(new Set(rows.map((r:any,i:number)=>i).filter(i=>rows[i].status==='parsed')));
    } catch(e:any) { alert(e?.message||'Failed to parse resumes'); }
    finally { setParsing(false); }
  };

  const toggle = (i:number) => setSelected(prev => { const n=new Set(prev); n.has(i)?n.delete(i):n.add(i); return n; });

  const createSelected = async () => {
    if (!results || selected.size===0) return;
    setCreating(true);
    let created=0, errors=0;
    for (const i of Array.from(selected)) {
      const r = results[i];
      try {
        await apiFetch('/candidates', {method:'POST', body:JSON.stringify({
          full_name: r.name || r.file, email: r.email||'', phone: r.phone||'',
          skills: r.skills||[], total_exp_mo: Math.round((r.exp_years||0)*12),
          source: 'bulk_cv_upload',
        })});
        created++;
      } catch { errors++; }
    }
    setCreateSummary({created,errors});
    setCreating(false);
  };

  const STATUS_CFG: Record<string,{label:string;bg:string;color:string}> = {
    parsed:    {label:'Parsed',    bg:'#f0fdf4', color:'#166534'},
    duplicate: {label:'Duplicate', bg:'#fffbeb', color:'#92400e'},
    failed:    {label:'Failed',    bg:'#fef2f2', color:'#991b1b'},
  };

  const OV:any={position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'};
  return (
    <div style={OV} onClick={onClose}>
      <div style={{background:'white',borderRadius:'16px',width:'720px',maxWidth:'100%',maxHeight:'85vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 28px',borderBottom:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between',alignItems:'center',position:'sticky',top:0,background:'white',zIndex:1}}>
          <div>
            <h2 style={{fontSize:'16px',fontWeight:'700',color:'#0f172a',margin:0}}>Bulk CV Upload</h2>
            <p style={{fontSize:'11px',color:'#94a3b8',margin:'2px 0 0'}}>Upload multiple resumes — parsed with zero-token regex NER, duplicate-checked by email</p>
          </div>
          <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',color:'#94a3b8'}}><X size={18}/></button>
        </div>
        <div style={{padding:'20px 28px'}}>
          {!results && (
            <>
              <input ref={fileRef} type="file" multiple accept=".txt,.pdf,.doc,.docx" style={{display:'none'}} onChange={pickFiles}/>
              <button onClick={()=>fileRef.current?.click()} style={{width:'100%',padding:'28px',border:'2px dashed #cbd5e1',borderRadius:'10px',background:'#f8fafc',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#64748b'}}>
                {files.length>0 ? `${files.length} file${files.length>1?'s':''} selected` : 'Click to select resume files'}
              </button>
              {files.length>0 && (
                <button onClick={parse} disabled={parsing} style={{marginTop:'14px',width:'100%',padding:'10px',borderRadius:'8px',border:'none',background:parsing?'#94a3b8':'#7c3aed',color:'white',cursor:parsing?'not-allowed':'pointer',fontSize:'13px',fontWeight:'700'}}>
                  {parsing?'Parsing…':`Parse ${files.length} Resume${files.length>1?'s':''}`}
                </button>
              )}
            </>
          )}
          {results && !createSummary && (
            <>
              <div style={{display:'flex',gap:'8px',marginBottom:'14px',fontSize:'12px'}}>
                <span style={{color:'#166534'}}>{results.filter(r=>r.status==='parsed').length} parsed</span>
                <span style={{color:'#92400e'}}>· {results.filter(r=>r.status==='duplicate').length} duplicates</span>
                <span style={{color:'#991b1b'}}>· {results.filter(r=>r.status==='failed').length} failed</span>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'8px',maxHeight:'400px',overflowY:'auto'}}>
                {results.map((r:any,i:number)=>{
                  const cfg = STATUS_CFG[r.status]||STATUS_CFG.failed;
                  const canSelect = r.status==='parsed';
                  return (
                    <div key={i} style={{display:'flex',alignItems:'center',gap:'10px',padding:'10px 12px',border:'1px solid #f1f5f9',borderRadius:'8px',opacity:canSelect?1:0.7}}>
                      <input type="checkbox" checked={selected.has(i)} disabled={!canSelect} onChange={()=>toggle(i)} style={{accentColor:'#7c3aed'}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:'12px',fontWeight:'700',color:'#0f172a'}}>{r.name||r.file}</div>
                        <div style={{fontSize:'11px',color:'#64748b'}}>{r.email||'no email'} · {r.exp_years||0}y exp · {(r.skills||[]).slice(0,4).join(', ')||'no skills detected'}</div>
                      </div>
                      <span style={{fontSize:'10px',fontWeight:'700',padding:'3px 8px',borderRadius:'6px',background:cfg.bg,color:cfg.color,flexShrink:0}}>{cfg.label}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'16px'}}>
                <button onClick={onClose} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Cancel</button>
                <button onClick={createSelected} disabled={selected.size===0||creating} style={{padding:'9px 18px',borderRadius:'8px',border:'none',background:selected.size===0||creating?'#94a3b8':'#1e40af',color:'white',cursor:selected.size===0||creating?'not-allowed':'pointer',fontSize:'13px',fontWeight:'700'}}>
                  {creating?'Adding…':`Add ${selected.size} Candidate${selected.size!==1?'s':''}`}
                </button>
              </div>
            </>
          )}
          {createSummary && (
            <div style={{textAlign:'center',padding:'20px 0'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>✅</div>
              <p style={{fontSize:'14px',fontWeight:'600',color:'#16a34a',marginBottom:'16px'}}>{createSummary.created} candidate{createSummary.created!==1?'s':''} added{createSummary.errors>0?`, ${createSummary.errors} failed`:''}</p>
              <button onClick={onDone} style={{padding:'9px 20px',borderRadius:'8px',border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'13px',fontWeight:'700'}}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sort Header Cell ─────────────────────────────────────────────────────────
function SortTh({label,col,sort,onSort,style:s}:{label:string;col:string;sort:{by:string;dir:string};onSort:(c:string)=>void;style?:any}) {
  const active = sort.by===col;
  return (
    <th onClick={()=>onSort(col)} style={{padding:'8px 10px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:active?'#1e40af':'#64748b',cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',...s}}>
      <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
        {label}
        {active ? (sort.dir==='asc'?<ArrowUp size={11}/>:<ArrowDown size={11}/>) : <ArrowUpDown size={11} style={{opacity:0.3}}/>}
      </div>
    </th>
  );
}

// Highlights required-skill terms directly inside a resume extract so a
// recruiter can visually confirm whether a term genuinely appears
// without resorting to the browser's own Ctrl+F (reported live — the
// browser's native find searches the WHOLE page, not just this panel,
// and returns unrelated matches from every other candidate row still
// rendered behind the modal). Same `<mark>`-wrapping-as-React-nodes
// pattern already proven on the dedicated full-resume-view page
// (candidates/[id]/resume/page.tsx) — no dangerouslySetInnerHTML.
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlightSkillTerms(text: string, matched: string[], related: string[]): React.ReactNode {
  if (!text) return text;
  const m = new Set((matched || []).filter(t => t && t.trim().length > 1).map(t => t.toLowerCase()));
  const r = new Set((related || []).filter(t => t && t.trim().length > 1 && !m.has(t.toLowerCase())).map(t => t.toLowerCase()));
  const allTerms = [...new Set([...matched, ...related])].filter(t => t && t.trim().length > 1);
  if (allTerms.length === 0) return text;
  const sorted = allTerms.sort((a, b) => b.length - a.length);
  const re = new RegExp('(' + sorted.map(escapeRe).join('|') + ')', 'gi');
  const parts = text.split(re);
  return parts.map((part, i) => {
    const low = part.toLowerCase();
    if (m.has(low)) {
      return <mark key={i} style={{ background: '#bbf7d0', color: '#166534', padding: '0 2px', borderRadius: 3, fontWeight: 700 }}>{part}</mark>;
    }
    if (r.has(low)) {
      return <mark key={i} style={{ background: '#fef3c7', color: '#92400e', padding: '0 2px', borderRadius: 3, fontWeight: 700 }}>{part}</mark>;
    }
    return <span key={i}>{part}</span>;
  });
}

// Inline candidate preview inside the JD Match modal — fetched on demand
// only when a recruiter actually clicks "View Profile" for one candidate,
// not eagerly for every ranked match. Deliberately does NOT navigate to
// /candidates/{id} at all: that was the original implementation (a plain
// <a target="_blank"> around the whole row) and the direct cause of the
// reported "Back button returns to the plain Candidates list, not the AI
// Matching Results" bug — a brand-new tab has no history entry for the
// results page to go back TO. Same fix already proven on the
// Requisitions page's own AiMatchModal (2026-08-21) — staying inside
// this same modal means there is nothing to "go back" from.
function JdCandidatePreviewPanel({ candidateId, isSelected, onToggle, onBack, matchedSkills, relatedSkills, jdText }: {
  candidateId: string; isSelected: boolean; onToggle: () => void; onBack: () => void;
  matchedSkills: string[]; relatedSkills: string[]; jdText: string;
}) {
  const router = useRouter();
  const { data: c, loading } = useFetch<any>(`/candidates/${candidateId}`);
  if (loading || !c) {
    return <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>Loading profile…</div>;
  }
  const skills: string[] = Array.isArray(c.skills) ? c.skills : [];
  // REAL BUG FIX (2026-08-23): "Open Full Profile" originally opened the
  // real Candidate 360 page in a NEW TAB by design (keeps this modal's
  // ranked results intact without needing any return mechanism at all).
  // Reported live, twice: (1) there was no way back to these specific
  // results from that new tab (fixed earlier the same day with a
  // localStorage-backed "Back to AI Match Results" link), and (2) even
  // with that fix, opening a fresh tab on every single click across a
  // real multi-candidate review session left many duplicate tabs open
  // and reads as "opening a new window every time" - confirmed live via
  // a screenshot showing 8 stacked tabs from one session. Switched to
  // same-tab navigation (router.push) instead of removing the return
  // mechanism - the "Back to AI Match Results" link built earlier the
  // same day is what makes this now safe: the ranked results are no
  // longer preserved by leaving them in a separate tab, they're
  // preserved by a real, working way back.
  function goToFullProfile() {
    try {
      localStorage.setItem('aiMatchReturnCtx', JSON.stringify({ jdText, ts: Date.now() }));
    } catch {}
    router.push(`/candidates/${candidateId}`);
  }
  return (
    <div style={{ maxHeight: 460, overflowY: 'auto', padding: '2px 2px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontWeight: 600, padding: 0 }}>
          <ArrowLeft size={13} /> Back to list
        </button>
        <button onClick={goToFullProfile}
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Open Full Profile <ExternalLink size={11} />
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: gc(c.full_name || ''), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
          {gi(c.full_name || '')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>{c.full_name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {[c.current_designation, c.current_employer].filter(Boolean).join(' @ ') || '—'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 11, color: '#64748b' }}>
            {c.total_exp_mo > 0 && <span>{gx(c.total_exp_mo)} experience</span>}
            {c.location && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={11} /> {c.location}</span>}
            {c.email && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Mail size={11} /> {c.email}</span>}
            {c.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Phone size={11} /> {c.phone}</span>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: isSelected ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#1e40af' }}>
          <input type="checkbox" checked={isSelected} onChange={onToggle} />
          {isSelected ? 'Selected for pipeline' : 'Select for pipeline'}
        </label>
        {c.latest_resume_file_id && (
          <button onClick={() => downloadResume(c.latest_resume_file_id, c.latest_resume_file_name)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}>
            <Download size={12} /> Download Resume
          </button>
        )}
      </div>
      {skills.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Skills</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {skills.map((sk: string) => (
              <span key={sk} style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>{sk}</span>
            ))}
          </div>
        </div>
      )}
      {c.resume_text && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Resume Extract</div>
            {(matchedSkills.length > 0 || relatedSkills.length > 0) && (
              <div style={{ display: 'flex', gap: 8, fontSize: 9, color: '#94a3b8' }}>
                <span><span style={{ background: '#bbf7d0', padding: '0 4px', borderRadius: 2 }}>&nbsp;</span> matched</span>
                <span><span style={{ background: '#fef3c7', padding: '0 4px', borderRadius: 2 }}>&nbsp;</span> related</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 8, padding: 10 }}>
            {highlightSkillTerms(c.resume_text.slice(0, 3000), matchedSkills, relatedSkills)}{c.resume_text.length > 3000 ? '…' : ''}
          </div>
        </div>
      )}
    </div>
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
  // Real-time ("as you type") duplicate check — separate from the
  // existing pre-submit dupWarning gate above, which still fires and
  // still blocks Save; this is a fast, non-blocking inline signal so a
  // recruiter sees "already in database" within a second of typing,
  // not only after clicking Add Candidate.
  const [liveDup,setLiveDup] = useState<any>(null);
  const [liveDupChecking,setLiveDupChecking] = useState(false);
  // Skill / Project Experience table (2026-08-25) — built up locally in
  // the modal, saved as a whole set on submit (real DELETE+INSERT,
  // matching PUT /candidates/{id}/skill-experience).
  const [skillExpRows,setSkillExpRows] = useState<any[]>([]);
  const EMPTY_SKILL_EXP = {skill_name:'',project_name:'',duration_from:'',duration_to:'',role_types:[] as string[],relevant_experience:'',last_used:''};
  const [skillExpForm,setSkillExpForm] = useState({...EMPTY_SKILL_EXP});
  const ROLE_TYPES = ['Implementation','Support','Enhancement','Rollout'];
  const liveDupTimer = useRef<any>(null);
  const [resumeFile,setResumeFile] = useState<File|null>(null);
  const [lwdFile,setLwdFile] = useState<File|null>(null);
  const [otherFiles,setOtherFiles] = useState<File[]>([]);
  const [uploadingDocs,setUploadingDocs] = useState(false);

  // filters
  const [search,setSearch] = useState('');
  const [srcFilter,setSrcFilter] = useState('');
  const [skillFilter,setSkillFilter] = useState('');
  const [employerFilter,setEmployerFilter] = useState('');
  const [locationFilter,setLocationFilter] = useState('');
  const [minExpYr,setMinExpYr] = useState('');
  const [maxExpYr,setMaxExpYr] = useState('');
  const [tagFilter,setTagFilter] = useState('');
  const [ownedFilter,setOwnedFilter] = useState(''); // '' | 'unowned' | 'active' — 2026-08-11 ownership filter
  // REAL BUG FIX (2026-08-31): this page never read any URL query param on
  // load - "Total Resumes Owned"/"On Notice Period" (RecruiterOverview.tsx)
  // link here with ?owned=mine, but landed on the unfiltered "All
  // Candidates" view every time, reported live as "directing to all
  // candidates." A client-only effect (not useSearchParams — this page is
  // one large component with no existing Suspense boundary, and adding one
  // just for this would be a much bigger, riskier restructure than the fix
  // itself needs) picks up ?owned=mine/unowned/active on first paint.
  useEffect(()=>{
    const owned = new URLSearchParams(window.location.search).get('owned');
    if (owned) setOwnedFilter(owned);
  },[]);
  const [showFilters,setShowFilters] = useState(false);
  // SSR-safe deferred localStorage read (established pattern elsewhere in
  // this app) — avoids a hydration mismatch between the server's first
  // paint and the client's real role.
  const [mounted,setMounted] = useState(false);
  useEffect(()=>{ setMounted(true); },[]);
  const canManageOwnership = mounted && ['admin','super_admin','manager'].includes(getTokenPayload()?.role||'');
  const [claimingId,setClaimingId] = useState('');
  async function claimCandidate(id:string){
    setClaimingId(id);
    try{ await apiFetch(`/candidates/${id}/ownership/claim`,{method:'POST'}); refetch(); }
    catch(e:any){ showStatus(e?.message||'Claim failed'); }
    finally{ setClaimingId(''); }
  }
  const [appliedFilters,setAppliedFilters] = useState<Record<string,string>>({});
  const {data:savedFilters,refetch:refetchSavedFilters} = useFetch<any[]>('/saved-filters');
  const [selectedSavedFilter,setSelectedSavedFilter] = useState('');

  // sort + pagination
  const [sort,setSort] = useState({by:'created_at',dir:'desc'});
  const [page,setPage] = useState(0);

  // selection + modals
  const [selected,setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignOpen,setBulkAssignOpen] = useState(false);
  const [bulkResumeGenOpen,setBulkResumeGenOpen] = useState(false);
  const [showDups,setShowDups] = useState(false);
  const [showBulkCV,setShowBulkCV] = useState(false);

  // quick-view drawer
  const [drawer,setDrawer] = useState<any>(null);

  // import/export
  const [importing,setImporting] = useState(false);
  const [importResult,setImportResult] = useState<{created:number,errors:number,skippedOwned:number}|null>(null);
  const [exporting,setExporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // JD ranking
  const [showJD,setShowJD] = useState(false);
  const [jdText,setJdText] = useState('');
  const [ranking,setRanking] = useState(false);
  const [rankResult,setRankResult] = useState<any>(null);
  // Select-and-add-to-pipeline straight from the ranked list (2026-08-11 —
  // the list previously had no way to open a candidate or act on the
  // ranking at all, reported live). Own Set, kept separate from the main
  // table's `selected` so the two selection mechanisms never cross-pollute.
  const [jdSelected,setJdSelected] = useState<Set<string>>(new Set());
  const [jdBulkAssignOpen,setJdBulkAssignOpen] = useState(false);
  // REAL BUG FIX (2026-08-23): "View Profile" used to be a plain
  // <a target="_blank"> wrapping the whole row - the ranked list stayed
  // intact in the original tab by design, but the new tab's own "Back"
  // button had nowhere real to return to and fell back to the plain
  // Candidates list, reported live as "redirects to the general
  // Candidate Page instead of returning to the AI Matching Results
  // page." Same root fix already proven on the Requisitions page's own
  // AI Match modal (2026-08-21): view the candidate INLINE inside this
  // same modal instead of navigating anywhere - nothing to "come back"
  // from, since nothing ever left this page. An "Open Full Profile" link
  // still opens the real page in a new tab for anyone who wants it.
  const [jdPreviewId,setJdPreviewId] = useState<string|null>(null);

  // status toast
  const [statusMsg,setStatusMsg] = useState('');
  const showStatus = (m:string,ms=3000)=>{setStatusMsg(m);setTimeout(()=>setStatusMsg(''),ms);};

  // reset page on filter/sort/source change
  useEffect(()=>{ setPage(0); }, [appliedFilters, sort, srcFilter, tagFilter, ownedFilter]);

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
    if (ownedFilter) p.set('owned',ownedFilter);
    return `/candidates?${p.toString()}`;
  },[appliedFilters,sort,page,srcFilter,tagFilter,ownedFilter]);

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
  const resetDocState = ()=>{setResumeFile(null);setLwdFile(null);setOtherFiles([]);setLiveDup(null);setLiveDupChecking(false);setSkillExpRows([]);setSkillExpForm({...EMPTY_SKILL_EXP});};
  const addSkillExpRow = ()=>{
    if (!skillExpForm.skill_name.trim()) return;
    setSkillExpRows(rows=>[...rows,{...skillExpForm}]);
    setSkillExpForm({...EMPTY_SKILL_EXP});
  };
  const removeSkillExpRow = (i:number)=>setSkillExpRows(rows=>rows.filter((_,idx)=>idx!==i));
  const toggleSkillExpRole = (r:string)=>setSkillExpForm(f=>({...f,role_types:f.role_types.includes(r)?f.role_types.filter(x=>x!==r):[...f.role_types,r]}));
  const openCreate = ()=>{setForm({...EMPTY});setEditId(null);setErr('');setDupWarning(null);setSkipDupCheck(false);resetDocState();setShowModal(true);};
  const openEdit   = async(d:any)=>{
    setForm({full_name:d.full_name||'',email:d.email||'',phone:d.phone||'',location:d.location||'',
      desired_location:d.desired_location||'',
      current_employer:d.current_employer||'',current_designation:d.current_designation||'',
      total_exp_mo:d.total_exp_mo||0,expected_ctc:d.expected_ctc||'',current_ctc:d.current_ctc||'',
      notice_period_days:d.notice_period_days||'',linkedin_url:d.linkedin_url||'',
      source:d.source||'linkedin',skills:d.skills||[],resume_text:d.resume_text||''});
    setEditId(d.id);setErr('');resetDocState();setShowModal(true);
    try { const res:any = await apiFetch(`/candidates/${d.id}/skill-experience`); setSkillExpRows(res.rows||[]); } catch { /* non-blocking */ }
  };
  const addSk=(s:string)=>{const t=s.trim();if(t&&!form.skills.includes(t))setForm(f=>({...f,skills:[...f.skills,t]}));setSkIn('');};
  const rmSk =(s:string)=>setForm(f=>({...f,skills:f.skills.filter((x:string)=>x!==s)}));

  // Real-time duplicate check ("fast and quick search to save time" —
  // as soon as a phone/email is typed, not only on Save click). Debounced
  // 500ms, only while adding (not editing) a candidate — the existing
  // check-duplicate endpoint is already correctly is_active-scoped and
  // 7-digit-minimum-anchored (fixed 2026-08-10), reused as-is here.
  useEffect(()=>{
    if (!showModal || editId) return;
    if (liveDupTimer.current) clearTimeout(liveDupTimer.current);
    const email = form.email.trim(), phone = form.phone.trim();
    if (!email && phone.replace(/\D/g,'').length < 7) { setLiveDup(null); setLiveDupChecking(false); return; }
    setLiveDupChecking(true);
    liveDupTimer.current = setTimeout(async ()=>{
      const p = new URLSearchParams();
      if (email) p.append('email', email);
      if (phone) p.append('phone', phone);
      try { const dup = await apiFetch('/candidates/check-duplicate?'+p.toString()); setLiveDup(dup); }
      catch { /* non-blocking — silently skip a failed live check */ }
      finally { setLiveDupChecking(false); }
    }, 500);
    return ()=>{ if (liveDupTimer.current) clearTimeout(liveDupTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[form.email,form.phone,showModal,editId]);

  const handleSave = async()=>{
    if (!form.full_name.trim()){setErr('Full name required');return;}
    if (!form.location.trim()){setErr('Current Location is required');return;}
    if (form.phone.trim()) {
      const phoneDigits = form.phone.replace(/\D/g,'').length;
      if (phoneDigits<10||phoneDigits>12){setErr(`Phone must have 10 digits (or 12 with the 91 country code) — got ${phoneDigits} digit(s)`);return;}
    }
    if (!editId && !resumeFile){setErr('A resume file (PDF, Word or image) is required');return;}
    if (!editId && Number(form.notice_period_days)>0 && !lwdFile){setErr('LWD Confirmation upload is required when a Notice Period is given');return;}
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
      let candId = editId;
      if(editId) await apiFetch(`/candidates/${editId}`,{method:'PUT',body:JSON.stringify(payload)});
      else       { const created:any = await apiFetch('/candidates',{method:'POST',body:JSON.stringify(payload)}); candId = created.id; }
      if (candId && (resumeFile||lwdFile||otherFiles.length)) {
        setUploadingDocs(true);
        try {
          if (resumeFile) await uploadCandidateDocument(candId, 'resume', resumeFile);
          if (lwdFile) await uploadCandidateDocument(candId, 'lwd_confirmation', lwdFile);
          for (const f of otherFiles) await uploadCandidateDocument(candId, 'other', f);
        } catch (upErr:any) {
          // Candidate record itself already saved successfully — a
          // document-upload failure shouldn't look like the whole Add
          // failed, just surface it and let the recruiter retry the
          // upload from the candidate's own profile.
          alert('Candidate saved, but a document upload failed: '+(upErr?.message||'unknown error'));
        } finally { setUploadingDocs(false); }
      }
      if (candId) {
        try { await apiFetch(`/candidates/${candId}/skill-experience`,{method:'PUT',body:JSON.stringify(skillExpRows)}); }
        catch (skErr:any) { alert('Candidate saved, but skill/project experience could not be saved: '+(skErr?.message||'unknown error')); }
      }
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
      const isExcel = /\.xlsx?$/i.test(file.name);
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}${isExcel?'/import/candidates/excel':'/import/candidates'}`, {
        method:'POST', headers: authHeaders(), body: fd,
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data?.detail || 'Import failed');
      setImportResult({created:(data.created||0)+(data.updated||0), errors:data.errors||0, skippedOwned:data.skipped_owned||0});
      refetch();
    } catch(e:any){showStatus('Import error: '+(e?.message||'unknown'));}
    finally{setImporting(false);if(target)target.value='';}
  };

  const downloadImportTemplate = async(kind:'csv'|'excel')=>{
    const res = await fetch(`${API}/import/template/${kind==='excel'?'excel':'candidates'}`, {headers:authHeaders()});
    if(!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = kind==='excel'?'candidates_template.xlsx':'template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const runJDRank = async(overrideText?:string)=>{
    // Defensive: this is also passed as a bare onSubmit handler
    // elsewhere, which invokes it with a React SyntheticEvent as the
    // first argument, not a string — a real bug caught before shipping
    // (that event object has no .trim(), throwing "t.trim is not a
    // function" on every normal "Rank Candidates" click). Only trust a
    // genuine string override.
    const text = typeof overrideText==='string' ? overrideText : jdText;
    if(!text.trim())return;
    setRanking(true);
    try{const r=await apiFetch('/candidates/rank',{method:'POST',body:JSON.stringify({jd_text:text,limit:20})});setRankResult(r);}
    catch(e:any){showStatus('Ranking failed: '+(e?.message||'error'));}
    finally{setRanking(false);}
  };

  // REAL BUG FIX (2026-08-23): "Open Full Profile" inside the JD Match
  // modal opens the real Candidate 360 page in a new tab, and that page
  // now offers a real "Back to AI Match Results" link — this is the
  // landing side of that flow: on arrival via ?reopenJdMatch=1, read the
  // exact jd_text that was saved to sessionStorage right before
  // navigating away, and re-run the identical search automatically
  // rather than dropping the recruiter on an empty modal they'd have to
  // re-paste their JD into.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('reopenJdMatch') !== '1') return;
    try {
      const raw = localStorage.getItem('aiMatchReturnCtx');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.jdText) {
          setJdText(parsed.jdText);
          setShowJD(true);
          runJDRank(parsed.jdText);
        }
        localStorage.removeItem('aiMatchReturnCtx'); // one-shot - consumed
      }
    } catch {}
    window.history.replaceState(null, '', '/candidates');
  }, []);

  const applyFilters=()=>{setAppliedFilters({search,skill:skillFilter,location:locationFilter,employer:employerFilter,minExp:minExpYr,maxExp:maxExpYr});};
  const clearFilters=()=>{setSearch('');setSkillFilter('');setLocationFilter('');setEmployerFilter('');setMinExpYr('');setMaxExpYr('');setSrcFilter('');setTagFilter('');setOwnedFilter('');setAppliedFilters({});setSelectedSavedFilter('');};
  const saveCurrentFilter=async()=>{
    const name=prompt('Name this filter:');
    if(!name)return;
    const filters={search,skill:skillFilter,location:locationFilter,employer:employerFilter,minExp:minExpYr,maxExp:maxExpYr,source:srcFilter,tag:tagFilter};
    await apiFetch('/saved-filters',{method:'POST',body:JSON.stringify({name,filters})});
    refetchSavedFilters();
  };
  const loadSavedFilter=(id:string)=>{
    setSelectedSavedFilter(id);
    const f=(savedFilters||[]).find((sf:any)=>sf.id===id);
    if(!f)return;
    const filters=f.filters||{};
    setSearch(filters.search||'');setSkillFilter(filters.skill||'');setLocationFilter(filters.location||'');
    setEmployerFilter(filters.employer||'');setMinExpYr(filters.minExp||'');setMaxExpYr(filters.maxExp||'');
    setSrcFilter(filters.source||'');setTagFilter(filters.tag||'');
    setAppliedFilters({search:filters.search||'',skill:filters.skill||'',location:filters.location||'',employer:filters.employer||'',minExp:filters.minExp||'',maxExp:filters.maxExp||''});
  };
  const deleteSavedFilter=async(id:string)=>{await apiFetch(`/saved-filters/${id}`,{method:'DELETE'});if(selectedSavedFilter===id)setSelectedSavedFilter('');refetchSavedFilters();};
  const hasActiveFilters = Boolean(Object.values(appliedFilters).some(Boolean)||srcFilter||tagFilter||ownedFilter);

  return (
    <div style={{padding:'24px',maxWidth:'1600px'}}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'20px',flexWrap:'wrap',gap:'12px'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'800',color:'#0f172a',margin:0}}>Candidates</h1>
          <p style={{fontSize:'13px',color:'#64748b',margin:'4px 0 0'}}>{total.toLocaleString()} candidates · Page {page+1}/{totalPages}</p>
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}}>
          <input ref={importRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}} onChange={handleImportFile}/>
          <button onClick={()=>importRef.current?.click()} disabled={importing} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#374151'}}><Upload size={13}/>{importing?'Importing...':'Import CSV/Excel'}</button>
          <button onClick={()=>downloadImportTemplate('csv')} title="Download CSV template" style={{padding:'8px 9px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'11px',fontWeight:'600',color:'#94a3b8'}}>Template</button>
          <button onClick={()=>setShowBulkCV(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',border:'1px solid #ddd6fe',background:'#faf5ff',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#7c3aed'}}><FileText size={13}/>Bulk CV Upload</button>
          <button onClick={handleExport} disabled={exporting} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#374151'}}><Download size={13}/>{exporting?'Exporting...':'Export CSV'}</button>
          <button onClick={()=>setShowDups(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 14px',borderRadius:'8px',border:'1px solid #f59e0b',background:'#fffbeb',cursor:'pointer',fontSize:'12px',fontWeight:'600',color:'#92400e'}}><GitMerge size={13}/>Duplicates</button>
          <button onClick={()=>setShowJD(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',borderRadius:'8px',border:'none',background:'linear-gradient(135deg,#7c3aed,#2563eb)',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'700'}}><Brain size={13}/>JD Match</button>
          <button onClick={openCreate} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',borderRadius:'8px',border:'none',background:'#1e40af',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'700'}}><Plus size={13}/>Add Candidate</button>
        </div>
      </div>

      {/* Real feature (2026-08-30): "candidate database should be 2
          options — one is full database all resume show and one is only
          individual recruiter candidates database show" (reported live).
          The underlying "owned" filter already existed (built 2026-08-11)
          but only ever answered "owned by ANYONE" via a dropdown buried
          inside Filters — never "owned by ME" specifically, and never a
          clearly visible, one-click switch. This reuses the exact same
          real ownedFilter state/query param the dropdown option (added
          alongside this) also sets — a prominent toggle, not a second
          data source. */}
      <div style={{display:'inline-flex',background:'#f1f5f9',borderRadius:'8px',padding:'3px',marginBottom:'16px',gap:'2px'}}>
        {/* REAL BUG FIX (2026-08-31): mine_or_assigned (the broader scope
            RecruiterOverview's KPI links use) previously matched NEITHER
            toggle's active-highlight check, so a card click landed on the
            correct, filtered candidate list but the toggle misleadingly
            showed "All Candidates" as selected. Both checks now treat it
            as a "mine"-family scope, matching the real applied filter. */}
        <button data-testid="candidates-scope-all" onClick={()=>setOwnedFilter('')}
          style={{padding:'7px 16px',borderRadius:'6px',border:'none',cursor:'pointer',fontSize:'12px',fontWeight:'700',background:!ownedFilter.startsWith('mine')?'white':'transparent',color:!ownedFilter.startsWith('mine')?'#1e40af':'#64748b',boxShadow:!ownedFilter.startsWith('mine')?'0 1px 2px rgba(0,0,0,0.08)':'none'}}>
          All Candidates
        </button>
        <button data-testid="candidates-scope-mine" onClick={()=>setOwnedFilter('mine')}
          style={{padding:'7px 16px',borderRadius:'6px',border:'none',cursor:'pointer',fontSize:'12px',fontWeight:'700',background:ownedFilter.startsWith('mine')?'white':'transparent',color:ownedFilter.startsWith('mine')?'#1e40af':'#64748b',boxShadow:ownedFilter.startsWith('mine')?'0 1px 2px rgba(0,0,0,0.08)':'none'}}>
          My Candidates
        </button>
      </div>

      {importResult && (
        <div style={{marginBottom:'12px',padding:'10px 16px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:'8px',fontSize:'13px',color:'#166534',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>✅ Import done: <strong>{importResult.created}</strong> added, <strong>{importResult.errors}</strong> errors{importResult.skippedOwned > 0 && <> , <strong>{importResult.skippedOwned}</strong> skipped (owned by another recruiter)</>}</span>
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
          {!!(savedFilters||[]).length && (
            <select value={selectedSavedFilter} onChange={e=>e.target.value?loadSavedFilter(e.target.value):setSelectedSavedFilter('')}
              style={{padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'12px',color:'#374151',background:'white'}}>
              <option value="">Saved filters…</option>
              {(savedFilters||[]).map((f:any)=><option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          {selectedSavedFilter && (
            <button onClick={()=>deleteSavedFilter(selectedSavedFilter)} title="Delete saved filter" style={{padding:'8px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',color:'#94a3b8'}}><Trash2 size={13}/></button>
          )}
          {hasActiveFilters&&<button onClick={saveCurrentFilter} title="Save current filters" style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 12px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'12px',color:'#64748b',fontWeight:'600'}}><Bookmark size={13}/> Save</button>}
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
            <div><label style={{fontSize:'11px',fontWeight:'600',color:'#64748b',display:'block',marginBottom:'4px'}}>OWNERSHIP</label>
              <select data-testid="owned-filter" value={ownedFilter} onChange={e=>setOwnedFilter(e.target.value)} style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}>
                <option value="">All candidates</option>
                <option value="mine">My Candidates (owned by me)</option>
                <option value="mine_active">My Active Candidates (owned or assigned, excl. placed/rejected)</option>
                <option value="mine_placed">My Placed Candidates</option>
                <option value="mine_notice">My Candidates on Notice Period</option>
                <option value="unowned">Unowned</option>
                <option value="active">Actively owned (by anyone)</option>
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
          <div data-testid="candidates-table-scroll" style={{overflowX:'auto'}}>
            {/* Real bug fix (2026-08-30): this table used table-layout:auto
                with no explicit column widths, so the browser sized every
                column purely from whichever candidates happened to be
                rendered — sorting by Exp/Activity surfaces a different set
                of rows with different-length names/companies/skill values,
                which measurably shifted every column's width and shoved the
                Owner/Actions columns further off-screen (or back on-screen)
                depending on what the current sort/page happened to contain.
                Reproduced and measured directly: default view needed 64px of
                scroll to reach Actions, Activity-sort needed 127px (nearly
                double) — same real viewport, same browser, only the sort
                changed. table-layout:fixed + an explicit width per column
                makes every column's position STABLE regardless of sort or
                which data is currently visible — some horizontal scroll can
                still be needed at genuinely narrow widths (already an
                accepted, documented tradeoff for this app's data-dense
                tables), but it's now predictable, not sort-dependent. */}
            <table style={{width:'100%',minWidth:'1268px',borderCollapse:'collapse',tableLayout:'fixed'}}>
              <thead>
                <tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>
                  <th style={{padding:'8px 10px',width:'36px'}}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{accentColor:'#1e40af',cursor:'pointer',width:'15px',height:'15px'}}/>
                  </th>
                  <SortTh label="Name"     col="full_name"    sort={sort} onSort={handleSort} style={{width:'240px'}}/>
                  <th style={{padding:'8px 10px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',width:'100px'}}>Phone</th>
                  <SortTh label="Exp"      col="total_exp_mo" sort={sort} onSort={handleSort} style={{width:'62px'}}/>
                  <SortTh label="Exp CTC"  col="expected_ctc" sort={sort} onSort={handleSort} style={{width:'85px'}}/>
                  <th style={{padding:'8px 10px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',width:'100px'}}>Company</th>
                  <th style={{padding:'8px 10px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',width:'130px'}}>Skills</th>
                  <th style={{padding:'8px 10px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',width:'130px'}}>Pipeline</th>
                  <SortTh label="Activity" col="last_activity" sort={sort} onSort={handleSort} style={{width:'85px'}}/>
                  <th style={{padding:'8px 10px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',width:'70px'}}>Source</th>
                  <th style={{padding:'8px 10px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',width:'75px'}}>Owner</th>
                  {/* Real bug fix (2026-08-20): position:sticky here visually
                      overlapped the Owner column entirely (and the tail end of
                      Source) at every real viewport width tested — sticky's
                      "stuck" paint position is pulled left onto whatever
                      content naturally sits there, not just onto empty space,
                      the same sticky-column-overlap class already found and
                      reverted twice on Resume Inbox earlier the same day.
                      Plain scroll instead — no overlap risk, matches that
                      established fix. */}
                  <th style={{padding:'8px 10px',background:'#f8fafc',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',textAlign:'center',width:'148px'}}>Actions</th>
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
                      <td style={{padding:'8px 10px',width:'36px'}}>
                        <input type="checkbox" checked={isSel} onChange={()=>toggleSel(d.id)} style={{accentColor:'#1e40af',cursor:'pointer',width:'15px',height:'15px'}}/>
                      </td>
                      {/* Name — click opens drawer. Real bug fix (2026-08-30):
                          email/designation had no width cap, so a long real
                          email or job title forced the Name column (and the
                          whole table) wider — the exact width-instability
                          this table now fixes with table-layout:fixed. Each
                          line truncates with an ellipsis to a real, fixed
                          220px text area (260px column - 34px avatar - 10px
                          gap - 16px cell padding) instead of forcing layout;
                          the full value is still visible via the row's own
                          Quick View / full-page link. */}
                      <td style={{padding:'8px 10px',cursor:'pointer',overflow:'hidden'}} onClick={()=>setDrawer(d)}>
                        <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                          <div style={{width:'34px',height:'34px',borderRadius:'50%',background:gc(d.full_name),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',color:'white',flexShrink:0}}>{gi(d.full_name)}</div>
                          <div style={{minWidth:0,maxWidth:'220px'}}>
                            <div style={{fontSize:'13px',fontWeight:'600',color:'#1e40af',textDecoration:'underline',textDecorationStyle:'dotted',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={d.full_name}>{d.full_name}</div>
                            <div style={{fontSize:'11px',color:'#94a3b8',display:'flex',alignItems:'center',gap:'4px',marginTop:'1px',overflow:'hidden'}} title={d.email||''}><Mail size={10} style={{flexShrink:0}}/><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.email||'—'}</span></div>
                            {d.current_designation&&<div style={{fontSize:'10px',color:'#64748b',marginTop:'1px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={d.current_designation}>{d.current_designation}</div>}
                            {(d.tags||[]).length>0&&(
                              <div style={{display:'flex',flexWrap:'wrap',gap:'3px',marginTop:'3px'}}>
                                {d.tags.map((t:any)=><span key={t.id} style={{fontSize:'9px',fontWeight:'600',padding:'1px 6px',borderRadius:'8px',background:`${t.color}1a`,color:t.color}}>{t.name}</span>)}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{padding:'8px 10px'}}>
                        {d.phone
                          ? <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'#475569'}}><Phone size={11}/>{d.phone}</div>
                          : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                      </td>
                      {/* Exp */}
                      <td style={{padding:'8px 10px'}}>
                        {exp
                          ? <span style={{fontSize:'11px',fontWeight:'600',padding:'2px 8px',borderRadius:'10px',background:'#dbeafe',color:'#1e40af'}}>{exp}</span>
                          : <span style={{fontSize:'11px',fontWeight:'500',padding:'2px 8px',borderRadius:'10px',background:'#f8fafc',color:'#94a3b8'}}>—</span>}
                        {d.notice_period_days > 0 && <div style={{fontSize:'10px',color:'#64748b',marginTop:'2px'}}>{d.notice_period_days}d notice</div>}
                      </td>
                      {/* CTC */}
                      <td style={{padding:'8px 10px'}}>
                        {d.expected_ctc
                          ? <div style={{fontSize:'12px',color:'#059669',fontWeight:'600'}}>{fc(d.expected_ctc)}</div>
                          : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                        {d.current_ctc && <div style={{fontSize:'10px',color:'#94a3b8'}}>Curr:{fc(d.current_ctc)}</div>}
                      </td>
                      {/* Company */}
                      <td style={{padding:'8px 10px',overflow:'hidden'}}>
                        {d.current_employer
                          ? <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'#475569',overflow:'hidden'}} title={d.current_employer}><Briefcase size={11} style={{flexShrink:0}}/><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.current_employer}</span></div>
                          : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                        {d.location&&<div style={{fontSize:'10px',color:'#94a3b8',marginTop:'1px',display:'flex',alignItems:'center',gap:'3px',overflow:'hidden'}} title={d.location}><MapPin size={9} style={{flexShrink:0}}/><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.location}</span></div>}
                      </td>
                      {/* Skills — real bug fix (2026-08-30): a resume-parsed
                          "skill" value is sometimes a long, sentence-like
                          fragment rather than a short tag (a separate,
                          pre-existing extraction-quality issue, not fixed
                          here). With no per-item width cap and no cell
                          max-height, a row with 1-2 such long values wrapped
                          across many lines and the whole row ballooned to
                          match (reproduced live: 264px vs a normal 84px row)
                          — every OTHER cell in that row is `vertical-align:
                          middle` by default, so short content (name, phone,
                          company) ends up floating in the middle of a huge
                          empty row instead of sitting near its neighbors,
                          reading as "misaligned" exactly as reported. Each
                          skill span now truncates on its own (maxWidth +
                          ellipsis) and the whole cell is capped to ~2 lines
                          (maxHeight + overflow:hidden) — a candidate with
                          long or many skill values can no longer inflate the
                          row height at all; full skill text remains visible
                          via the row's Quick View drawer. */}
                      <td style={{padding:'8px 10px',overflow:'hidden'}}>
                        <div style={{display:'flex',flexWrap:'wrap',gap:'3px',maxHeight:'42px',overflow:'hidden'}}>
                          {(d.skills||[]).slice(0,2).map((s:string)=><span key={s} title={s} style={{fontSize:'10px',fontWeight:'500',padding:'2px 6px',borderRadius:'4px',background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe',maxWidth:'110px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'inline-block'}}>{s}</span>)}
                          {(d.skills||[]).length>2&&<span style={{fontSize:'10px',padding:'2px 5px',borderRadius:'4px',background:'#f8fafc',color:'#94a3b8'}}>+{d.skills.length-2}</span>}
                        </div>
                      </td>
                      {/* Pipeline status */}
                      <td style={{padding:'8px 10px',overflow:'hidden'}}>
                        {sc ? (
                          <div>
                            <span style={{fontSize:'10px',fontWeight:'700',padding:'2px 7px',borderRadius:'8px',background:sc.bg,color:sc.color}}>{sc.label}</span>
                            {d.pipeline_job && <div title={d.pipeline_job} style={{fontSize:'10px',color:'#94a3b8',marginTop:'2px',maxWidth:'110px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.pipeline_job}</div>}
                          </div>
                        ) : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                        {d.top_match && (
                          <div title={`AI JD match score vs ${d.top_match.requisition_title||'a scored requisition'}`}
                            style={{marginTop:'4px',display:'flex',alignItems:'center',gap:'3px',fontSize:'10px',fontWeight:'700',
                              color:d.top_match.readiness_index>=70?'#16a34a':d.top_match.readiness_index>=50?'#0891b2':'#d97706'}}>
                            <Sparkles size={10}/>{Math.round(d.top_match.readiness_index||0)}% match
                          </div>
                        )}
                      </td>
                      {/* Last activity */}
                      <td style={{padding:'8px 10px'}}>
                        {activity
                          ? <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',color:'#64748b'}}><Clock size={10}/>{activity}</div>
                          : <span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}
                      </td>
                      {/* Source */}
                      <td style={{padding:'8px 10px'}}>
                        <span style={{fontSize:'11px',padding:'2px 8px',borderRadius:'10px',background:'#f1f5f9',color:'#475569',fontWeight:'500'}}>{d.source||'direct'}</span>
                      </td>
                      {/* Owner (2026-08-11: 30-day individual recruiter ownership) */}
                      <td style={{padding:'8px 10px',overflow:'hidden'}}>
                        {d.owner && d.owner.status==='active' && new Date(d.owner.expires_at) > new Date() ? (
                          <div>
                            <div title={d.owner.recruiter_name} style={{fontSize:'11px',fontWeight:'600',color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.owner.recruiter_name}</div>
                            <div style={{fontSize:'10px',color:Math.ceil((new Date(d.owner.expires_at).getTime()-Date.now())/86400000)<=5?'#d97706':'#94a3b8'}}>
                              {Math.max(0,Math.ceil((new Date(d.owner.expires_at).getTime()-Date.now())/86400000))}d left
                            </div>
                          </div>
                        ) : canManageOwnership ? (
                          <button onClick={()=>claimCandidate(d.id)} disabled={claimingId===d.id}
                            style={{fontSize:'10px',fontWeight:'700',padding:'3px 9px',borderRadius:'6px',border:'1px solid #bbf7d0',background:'#f0fdf4',color:'#166534',cursor:claimingId===d.id?'not-allowed':'pointer'}}>
                            {claimingId===d.id?'…':'Claim'}
                          </button>
                        ) : (
                          <span style={{fontSize:'11px',color:'#cbd5e1'}}>Unowned</span>
                        )}
                      </td>
                      {/* Actions */}
                      <td style={{padding:'8px 10px'}}>
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
          <button onClick={()=>setBulkResumeGenOpen(true)} style={{display:'flex',alignItems:'center',gap:'6px',padding:'7px 14px',borderRadius:'8px',border:'none',background:'#7c3aed',color:'white',cursor:'pointer',fontSize:'12px',fontWeight:'600'}}><FileText size={13}/>Generate Resumes</button>
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
      {showBulkCV && <BulkCVModal onClose={()=>setShowBulkCV(false)} onDone={()=>{setShowBulkCV(false);refetch();}}/>}

      {/* ── Bulk Assign modal ─────────────────────────────────────────────── */}
      {bulkAssignOpen && <BulkAssignModal candidateIds={Array.from(selected)} onClose={()=>setBulkAssignOpen(false)} onDone={()=>setSelected(new Set())}/>}
      {bulkResumeGenOpen && <BulkResumeGenModal candidateIds={Array.from(selected)} onClose={()=>setBulkResumeGenOpen(false)}/>}

      {/* ── Add / Edit modal ─────────────────────────────────────────────── */}
      <Modal open={showModal} onClose={()=>setShowModal(false)} title={editId?'Edit Candidate':'Add New Candidate'} subtitle="Fill in candidate details" size="lg" closeOnBackdropClick={false}
        footer={<FormActions onClose={()=>setShowModal(false)} onSubmit={handleSave} loading={saving||uploadingDocs} submitLabel={editId?'Update Candidate':(uploadingDocs?'Uploading…':'Add Candidate')}/>}>
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
        {!editId&&(
          <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'14px',padding:'6px 12px',background:'#eff6ff',borderRadius:'7px',fontSize:'12px',color:'#1e40af',fontWeight:'600'}}>
            <Users size={13}/> Adding as: {getTokenPayload()?.full_name || 'You'} — this candidate will be claimed under your name
          </div>
        )}
        <SectionDivider label="Personal Information"/>
        <FormRow><FormField label="Full Name" required><input style={INP} placeholder="e.g. Rahul Sharma" value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))}/></FormField><FormField label="Email"><input type="email" style={INP} placeholder="rahul@example.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></FormField></FormRow>
        <FormRow>
          <FormField label="Phone" hint={form.phone.trim()?(()=>{const d=form.phone.replace(/\D/g,'').length;return d<10||d>12?`⚠ ${d} digit${d===1?'':'s'} — needs 10 (or 12 with country code)`:`✓ ${d} digits`;})():'10 digits, or 12 with the 91 country code'}>
            <input style={INP} placeholder="+91 9876543210" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}/>
          </FormField>
          <FormField label="Current Location" required><input style={INP} placeholder="e.g. Bengaluru, Karnataka" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}/></FormField>
        </FormRow>
        {!editId&&liveDupChecking&&!liveDup?.has_duplicate&&(form.email||form.phone.replace(/\D/g,'').length>=7)&&(
          <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'-8px',marginBottom:'12px',fontSize:'11px',color:'#94a3b8'}}>
            <Search size={11}/> Checking database for duplicates…
          </div>
        )}
        {!editId&&liveDup?.has_duplicate&&(
          <div style={{marginTop:'-8px',marginBottom:'12px',padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'7px',fontSize:'11px',color:'#dc2626'}}>
            <div style={{display:'flex',alignItems:'center',gap:'6px',fontWeight:'700',marginBottom:'6px'}}>
              <AlertTriangle size={12}/> {(liveDup.duplicates||[]).length} duplicate candidate{(liveDup.duplicates||[]).length>1?'s':''} found in the database
            </div>
            {(liveDup.duplicates||[]).map((d:any,i:number)=>(
              <div key={i} style={{marginLeft:'18px',marginBottom:i<(liveDup.duplicates||[]).length-1?'8px':0,paddingBottom:i<(liveDup.duplicates||[]).length-1?'8px':0,borderBottom:i<(liveDup.duplicates||[]).length-1?'1px solid #fecaca':'none'}}>
                <div style={{fontWeight:'700'}}>{d.candidate.full_name} — matches on {d.match_type}</div>
                {d.resume_file_name&&<div style={{color:'#991b1b'}}>📄 Resume on file: {d.resume_file_name}</div>}
                {d.owner&&<div style={{color:'#991b1b'}}>🔒 Owned by {d.owner.recruiter_name} — {d.owner.days_left} day{d.owner.days_left===1?'':'s'} left on claim</div>}
                {d.pipeline&&<div style={{color:'#991b1b'}}>📍 Currently in pipeline: {d.pipeline.stage} ({d.pipeline.requisition_title})</div>}
                {!d.resume_file_name&&!d.owner&&!d.pipeline&&<div style={{color:'#b91c1c'}}>No resume, ownership claim, or active pipeline on file</div>}
              </div>
            ))}
          </div>
        )}
        {!editId&&liveDup&&liveDup.has_duplicate===false&&(
          <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'-8px',marginBottom:'12px',padding:'6px 12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'7px',fontSize:'11px',color:'#166534',fontWeight:'600'}}>
            <Check size={12}/> No duplicates found — this phone/email is not already in the database
          </div>
        )}
        <FormRow><FormField label="Desired Location" hint="Where the candidate wants to work — leave blank if same as current"><input style={INP} placeholder="e.g. Hyderabad, Telangana" value={form.desired_location} onChange={e=>setForm(f=>({...f,desired_location:e.target.value}))}/></FormField>
          <FormField label="LinkedIn URL">
            <div style={{display:'flex',gap:'6px'}}>
              <input style={{...INP,flex:1}} placeholder="https://linkedin.com/in/..." value={form.linkedin_url} onChange={e=>setForm(f=>({...f,linkedin_url:e.target.value}))}/>
              <button type="button"
                onClick={()=>window.open(form.linkedin_url.trim(),'_blank','noopener,noreferrer')}
                disabled={!form.linkedin_url.trim()} title="Open this link in LinkedIn"
                style={{display:'flex',alignItems:'center',gap:'5px',padding:'0 12px',borderRadius:'8px',border:'1px solid #e2e8f0',
                  background:form.linkedin_url.trim()?'#0a66c2':'#f1f5f9',cursor:form.linkedin_url.trim()?'pointer':'not-allowed',
                  fontSize:'11px',fontWeight:'700',color:form.linkedin_url.trim()?'white':'#94a3b8',whiteSpace:'nowrap'}}>
                <Linkedin size={13}/> Open
              </button>
            </div>
            {/* Real, live reachability checks (tried before building this) turned out
               to be structurally unreliable from this server — LinkedIn blocks the
               VPS's IP outright, confirmed with even a real headless browser, on both
               a fake profile AND a genuinely real one. A live network probe here would
               show a false "could not verify" for almost every real link, so this stays
               a plain, instant, client-side format check with no network call at all —
               honest about what it actually knows, never wrongly alarming. */}
            {form.linkedin_url.trim()&&(
              /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+\/?$/i.test(form.linkedin_url.trim())
                ? <div style={{display:'flex',alignItems:'center',gap:'4px',marginTop:'5px',fontSize:'11px',fontWeight:'600',color:'#166534'}}><Check size={12}/> Looks like a valid LinkedIn profile URL</div>
                : <div style={{display:'flex',alignItems:'center',gap:'4px',marginTop:'5px',fontSize:'11px',fontWeight:'600',color:'#dc2626'}}><X size={12}/> Doesn't look like a LinkedIn profile URL (expected linkedin.com/in/username)</div>
            )}
          </FormField>
        </FormRow>
        <FormRow><FormField label="Source"><select style={INP} value={form.source} onChange={e=>setForm(f=>({...f,source:e.target.value}))}>{SRC.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></FormField><div/></FormRow>
        <SectionDivider label="Professional Details"/>
        <FormRow><FormField label="Current Employer"><input style={INP} placeholder="e.g. Infosys" value={form.current_employer} onChange={e=>setForm(f=>({...f,current_employer:e.target.value}))}/></FormField><FormField label="Current Designation"><input style={INP} placeholder="e.g. Senior Engineer" value={form.current_designation} onChange={e=>setForm(f=>({...f,current_designation:e.target.value}))}/></FormField></FormRow>
        <FormRow cols={3}><FormField label="Years Experience" hint={form.total_exp_mo>0?`= ${Math.floor(Number(form.total_exp_mo)/12)}y ${Number(form.total_exp_mo)%12}m`:'e.g. 4 = 4 years'}><input type="number" style={INP} min={0} max={50} step={0.5} placeholder="e.g. 4" value={form.total_exp_mo?+(Number(form.total_exp_mo)/12).toFixed(1):''} onChange={e=>setForm(f=>({...f,total_exp_mo:Math.round(Number(e.target.value||0)*12)}))}/></FormField><FormField label="Notice Period (days)"><input type="number" style={INP} min={0} max={365} placeholder="e.g. 30" value={form.notice_period_days} onChange={e=>setForm(f=>({...f,notice_period_days:e.target.value}))}/></FormField></FormRow>
        {!editId&&(
          <FormField label="LWD Confirmation" required={Number(form.notice_period_days)>0} hint={Number(form.notice_period_days)>0?'Required — upload the Last Working Day confirmation':'Only required if a Notice Period is entered above'}>
            <input type="file" accept=".pdf,.doc,.docx,image/*" style={INP} onChange={e=>setLwdFile(e.target.files?.[0]||null)}/>
            {lwdFile&&<div style={{fontSize:'11px',color:'#166534',marginTop:'4px'}}>✓ {lwdFile.name}</div>}
          </FormField>
        )}
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

        <SectionDivider label="Skill / Project Experience (optional)"/>
        <div style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'10px',marginBottom:'12px',background:'#f8fafc'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'8px'}}>
            <input style={INP} placeholder="Skill / Technology (e.g. SAP FICO)" value={skillExpForm.skill_name} onChange={e=>setSkillExpForm(f=>({...f,skill_name:e.target.value}))}/>
            <input style={INP} placeholder="Project Name" value={skillExpForm.project_name} onChange={e=>setSkillExpForm(f=>({...f,project_name:e.target.value}))}/>
            <input style={INP} placeholder="Duration From (e.g. Jan 2024)" value={skillExpForm.duration_from} onChange={e=>setSkillExpForm(f=>({...f,duration_from:e.target.value}))}/>
            <input style={INP} placeholder="Duration To (e.g. Current)" value={skillExpForm.duration_to} onChange={e=>setSkillExpForm(f=>({...f,duration_to:e.target.value}))}/>
            <input style={INP} placeholder="Relevant Experience (e.g. 8 Years)" value={skillExpForm.relevant_experience} onChange={e=>setSkillExpForm(f=>({...f,relevant_experience:e.target.value}))}/>
            <input style={INP} placeholder="Last Used (e.g. Current / 2023)" value={skillExpForm.last_used} onChange={e=>setSkillExpForm(f=>({...f,last_used:e.target.value}))}/>
          </div>
          <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:'10px',marginBottom:'8px'}}>
            <span style={{fontSize:'11px',fontWeight:'700',color:'#64748b'}}>Role:</span>
            {ROLE_TYPES.map(r=>(
              <label key={r} style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'11px',color:'#374151',cursor:'pointer'}}>
                <input type="checkbox" checked={skillExpForm.role_types.includes(r)} onChange={()=>toggleSkillExpRole(r)}/>{r}
              </label>
            ))}
          </div>
          <button type="button" onClick={addSkillExpRow} disabled={!skillExpForm.skill_name.trim()}
            style={{padding:'7px 14px',borderRadius:'7px',border:'none',background:skillExpForm.skill_name.trim()?'#1e40af':'#94a3b8',color:'white',cursor:skillExpForm.skill_name.trim()?'pointer':'not-allowed',fontSize:'12px',fontWeight:'700'}}>
            + Add Row
          </button>
        </div>
        {skillExpRows.length>0&&(
          <div style={{overflowX:'auto',marginBottom:'12px'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:'11px'}}>
              <thead>
                <tr style={{background:'#f1f5f9',textAlign:'left'}}>
                  <th style={{padding:'6px 8px'}}>Sl.No</th>
                  <th style={{padding:'6px 8px'}}>Skill / Technology</th>
                  <th style={{padding:'6px 8px'}}>Project Name</th>
                  <th style={{padding:'6px 8px'}}>Duration (From–To)</th>
                  <th style={{padding:'6px 8px'}}>Role</th>
                  <th style={{padding:'6px 8px'}}>Relevant Exp.</th>
                  <th style={{padding:'6px 8px'}}>Last Used</th>
                  <th style={{padding:'6px 8px'}}></th>
                </tr>
              </thead>
              <tbody>
                {skillExpRows.map((r:any,i:number)=>(
                  <tr key={i} style={{borderTop:'1px solid #e2e8f0'}}>
                    <td style={{padding:'6px 8px',color:'#64748b'}}>{i+1}</td>
                    <td style={{padding:'6px 8px',fontWeight:'700',color:'#1e40af'}}>{r.skill_name}</td>
                    <td style={{padding:'6px 8px'}}>{r.project_name||'—'}</td>
                    <td style={{padding:'6px 8px'}}>{[r.duration_from,r.duration_to].filter(Boolean).join(' – ')||'—'}</td>
                    <td style={{padding:'6px 8px'}}>{(r.role_types||[]).join(' & ')||'—'}</td>
                    <td style={{padding:'6px 8px'}}>{r.relevant_experience||'—'}</td>
                    <td style={{padding:'6px 8px'}}>{r.last_used||'—'}</td>
                    <td style={{padding:'6px 8px'}}><button type="button" onClick={()=>removeSkillExpRow(i)} style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontWeight:'700'}}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <SectionDivider label="Resume / Notes"/>
        {!editId&&(
          <FormField label="Resume Upload" required hint="PDF, Word or image — auto-extracted skills/experience gap-fill any blank fields you haven't already typed">
            <input type="file" accept=".pdf,.doc,.docx,image/*" style={INP} onChange={e=>setResumeFile(e.target.files?.[0]||null)}/>
            {resumeFile&&<div style={{fontSize:'11px',color:'#166534',marginTop:'4px'}}>✓ {resumeFile.name}</div>}
          </FormField>
        )}
        <textarea style={{...INP,height:'100px',resize:'vertical'}} placeholder="Paste resume text or notes..." value={form.resume_text} onChange={e=>setForm(f=>({...f,resume_text:e.target.value}))}/>
        {!editId&&(
          <FormField label="Other Documents" hint="Optional — Aadhaar, PAN, offer letters, or anything else relevant. Multiple files allowed.">
            <input type="file" multiple accept=".pdf,.doc,.docx,image/*" style={INP} onChange={e=>setOtherFiles(Array.from(e.target.files||[]))}/>
            {otherFiles.length>0&&<div style={{fontSize:'11px',color:'#166534',marginTop:'4px'}}>✓ {otherFiles.map(f=>f.name).join(', ')}</div>}
          </FormField>
        )}
        {uploadingDocs&&<div style={{fontSize:'12px',color:'#64748b',marginTop:'8px'}}>Uploading documents…</div>}
      </Modal>

      {/* ── JD Match modal ───────────────────────────────────────────────── */}
      <Modal open={showJD} onClose={()=>{setShowJD(false);setRankResult(null);setJdSelected(new Set());setJdPreviewId(null);}} title="JD Match — AI Ranking" subtitle="Paste a job description to rank your candidates by fit" size="lg"
        footer={!rankResult
          ? <FormActions onClose={()=>{setShowJD(false);setRankResult(null);setJdSelected(new Set());setJdPreviewId(null);}} onSubmit={()=>runJDRank()} loading={ranking} submitLabel="Rank Candidates"/>
          : <div style={{display:'flex',justifyContent:'flex-end',gap:'10px'}}>
              <button onClick={()=>{setShowJD(false);setRankResult(null);setJdSelected(new Set());setJdPreviewId(null);}} style={{padding:'9px 18px',borderRadius:'8px',border:'1px solid #e2e8f0',background:'white',cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#374151'}}>Close</button>
              <button onClick={()=>setJdBulkAssignOpen(true)} disabled={jdSelected.size===0}
                style={{display:'flex',alignItems:'center',gap:'6px',padding:'9px 18px',borderRadius:'8px',border:'none',background:jdSelected.size===0?'#94a3b8':'#1e40af',color:'white',cursor:jdSelected.size===0?'not-allowed':'pointer',fontSize:'13px',fontWeight:'700'}}>
                <Users size={13}/>Add {jdSelected.size>0?jdSelected.size:''} to Pipeline
              </button>
            </div>}>
        {!rankResult ? (
          <textarea style={{...INP,height:'220px',resize:'vertical'}} placeholder="Paste the full job description here..." value={jdText} onChange={e=>setJdText(e.target.value)}/>
        ) : jdPreviewId ? (
          <JdCandidatePreviewPanel candidateId={jdPreviewId} isSelected={jdSelected.has(jdPreviewId)}
            onToggle={()=>setJdSelected(prev=>{const n=new Set(prev); n.has(jdPreviewId)?n.delete(jdPreviewId):n.add(jdPreviewId); return n;})}
            onBack={()=>setJdPreviewId(null)}
            matchedSkills={((rankResult as any).ranked||[]).find((r:any)=>r.id===jdPreviewId)?.matched_skills||[]}
            relatedSkills={((rankResult as any).ranked||[]).find((r:any)=>r.id===jdPreviewId)?.related_skills||[]}
            jdText={jdText}/>
        ) : (
          <div>
            <div style={{padding:'10px 14px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:'8px',fontSize:'13px',color:'#166534',marginBottom:'8px'}}>✅ Ranked {(rankResult as any).ranked?.length||0} candidates by fit — click "View Profile" to preview before adding, or select candidates to add them straight to a requisition's pipeline.</div>
            {Array.isArray((rankResult as any).required_skills)&&(rankResult as any).required_skills.length>0&&(
              <div data-testid="jd-detected-requirements" style={{fontSize:'11px',color:'#64748b',marginBottom:'16px'}}>
                Detected requirements: {(rankResult as any).required_skills.map((s:string,i:number)=>(
                  <span key={s}>{i>0&&', '}<b style={{color:'#374151'}}>{s}</b></span>
                ))}
              </div>
            )}
            <div data-testid="jd-rank-results" style={{maxHeight:'400px',overflowY:'auto'}}>
              {((rankResult as any).ranked||[]).length===0&&<div style={{padding:'32px',textAlign:'center',color:'#64748b',fontSize:'13px'}}>No candidates matched the job description skills.</div>}
              {((rankResult as any).ranked||[]).map((c:any,i:number)=>{
                const isSelected = jdSelected.has(c.id);
                return (
                  // REAL FIX (2026-08-23): row is now click-to-select (matching
                  // the Requisitions page's already-proven AiMatchModal row
                  // pattern), not a <label>/<a> wrapping everything — so a
                  // "View Profile" trigger can sit inside without also
                  // toggling the checkbox or navigating away.
                  <div key={c.id} onClick={()=>{setJdSelected(prev=>{const n=new Set(prev); n.has(c.id)?n.delete(c.id):n.add(c.id); return n;});}}
                    style={{padding:'12px 14px',borderBottom:'1px solid #f1f5f9',borderRadius:'8px',display:'flex',alignItems:'center',gap:'12px',cursor:'pointer',background:isSelected?'#eff6ff':'transparent'}}>
                    <input type="checkbox" checked={isSelected} onClick={e=>e.stopPropagation()} onChange={e=>{
                      setJdSelected(prev=>{const n=new Set(prev); e.target.checked?n.add(c.id):n.delete(c.id); return n;});
                    }} style={{width:'15px',height:'15px',cursor:'pointer',flexShrink:0}}/>
                    <span style={{fontSize:'18px',fontWeight:'800',color:'#94a3b8',width:'28px',textAlign:'center',flexShrink:0}}>{i+1}</span>
                    <div style={{width:'36px',height:'36px',borderRadius:'50%',background:gc(c.full_name||''),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',color:'white',flexShrink:0}}>{gi(c.full_name||'')}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                        <span style={{fontSize:'13px',fontWeight:'700',color:'#1e293b'}}>{c.full_name}</span>
                        <button onClick={e=>{e.stopPropagation();setJdPreviewId(c.id);}} title="Preview full profile & resume before adding — stays on this list"
                          style={{display:'flex',alignItems:'center',gap:'3px',fontSize:'9px',fontWeight:'700',color:'#2563eb',cursor:'pointer',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:'999px',padding:'1px 7px'}}>
                          <Eye size={9}/> View Profile
                        </button>
                      </div>
                      <div style={{fontSize:'11px',color:'#64748b'}}>{c.current_designation||'—'} · {c.current_employer||'—'} · {c.total_exp_mo>0?gx(c.total_exp_mo):'—'}</div>
                      {(c.matched_skills?.length>0||c.related_skills?.length>0||c.missing_skills?.length>0)&&<div style={{display:'flex',flexWrap:'wrap',gap:'3px',marginTop:'4px'}}>
                        {c.matched_skills?.slice(0,4).map((s:string)=><span key={'m-'+s} title="Exact match — found in the candidate's profile or resume" style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#d1fae5',color:'#065f46',fontWeight:'600'}}>✓ {s}</span>)}
                        {c.related_skills?.slice(0,4).map((s:string)=><span key={'r-'+s} title="Related — some overlap found, not an exact match" style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#fef3c7',color:'#92400e',fontWeight:'600'}}>~ {s}</span>)}
                        {c.missing_skills?.slice(0,4).map((s:string)=><span key={'x-'+s} title="No evidence found in this candidate's profile or resume" style={{fontSize:'9px',padding:'1px 5px',borderRadius:'3px',background:'#fee2e2',color:'#991b1b',fontWeight:'600'}}>✕ {s}</span>)}
                      </div>}
                    </div>
                    <button onClick={e=>{e.stopPropagation();setJdSelected(new Set([c.id]));setJdBulkAssignOpen(true);}} title="Add to pipeline"
                      style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
                      <Users size={13} style={{color:'#64748b'}}/>
                    </button>
                    <div style={{textAlign:'right',flexShrink:0,width:'48px'}} title={`${c.matched_skills?.length||0} of ${(rankResult as any).required_skills?.length||0} required skills matched`}>
                      <div style={{fontSize:'20px',fontWeight:'800',color:c.rank_score>=70?'#16a34a':c.rank_score>=40?'#d97706':'#94a3b8'}}>{Math.round(c.rank_score||0)}%</div>
                      <div style={{fontSize:'9px',color:'#94a3b8'}}>match</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
      {jdBulkAssignOpen && <BulkAssignModal candidateIds={Array.from(jdSelected)} onClose={()=>setJdBulkAssignOpen(false)} onDone={()=>{setJdSelected(new Set());showStatus(`✅ Added to pipeline`);}}/>}
    </div>
  );
}
