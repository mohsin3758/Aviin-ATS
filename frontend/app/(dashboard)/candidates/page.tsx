'use client';
import { useState, useRef } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Modal, FormField, FormRow, FormActions, SectionDivider } from '@/components/ui/Modal';
import { Plus, Search, Upload, Download, Brain, Mail, Phone, MapPin, Briefcase, Trash2, Edit, ExternalLink, X } from 'lucide-react';

const AC = ['#1e40af','#7c3aed','#0f766e','#92400e','#be185d','#0369a1','#4f46e5'];
const gc = (n:string) => AC[(n?.charCodeAt(0)||0)%AC.length];
const gi = (n:string) => (n||'?').split(' ').map((x:string)=>x[0]).join('').slice(0,2).toUpperCase();
const gx = (mo:number) => { if(!mo)return 'Fresher'; const y=Math.floor(mo/12),m=mo%12; return y?`${y}y${m?` ${m}m`:''}`:`${mo}mo`; };
const fc = (n:number|null|undefined) => !n?null:n>=100000?`Rs.${(n/100000).toFixed(1)}L`:`Rs.${Math.round(n/1000)}K`;

const EMPTY = {
  full_name:'',email:'',phone:'',location:'',
  current_employer:'',current_designation:'',
  total_exp_mo:0,
  expected_ctc:'' as any,current_ctc:'' as any,notice_period_days:'' as any,
  linkedin_url:'',source:'linkedin',
  skills:[] as string[],resume_text:'',
};
const INP:any = {width:'100%',border:'1px solid #e2e8f0',borderRadius:'8px',padding:'9px 12px',fontSize:'13px',outline:'none',color:'#1e293b',background:'white',boxSizing:'border-box'};
const QS = ['Python','React','Java','Node.js','AWS','Docker','FastAPI','PostgreSQL','Kubernetes','DevOps','ML','Data Science','QA','Recruitment','Sales','HR','Angular','Go','Rust','Scala'];
const SRC = ['linkedin','naukri','referral','direct','indeed','walk_in','campus','self_apply','website','other'];

export default function CandidatesPage() {
  const [showModal,setShowModal] = useState(false);
  const [editId,setEditId] = useState<string|null>(null);
  const [form,setForm] = useState({...EMPTY});
  const [saving,setSaving] = useState(false);
  const [err,setErr] = useState('');
  const [search,setSearch] = useState('');
  const [srcFilter,setSrcFilter] = useState('');
  const [skIn,setSkIn] = useState('');
  const [importing,setImporting] = useState(false);
  const [importResult,setImportResult] = useState<{created:number,errors:number}|null>(null);
  const [scoring,setScoring] = useState(false);
  const [scoreMsg,setScoreMsg] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const {data:cr,loading,refetch} = useFetch<any>('/candidates?limit=200');
  const all:any[] = Array.isArray(cr)?cr:(cr?.items||[]);
  const filtered = all.filter(c=>
    (!search||c.full_name?.toLowerCase().includes(search.toLowerCase())||c.email?.toLowerCase().includes(search.toLowerCase())||c.current_employer?.toLowerCase().includes(search.toLowerCase())||(c.skills||[]).some((s:string)=>s.toLowerCase().includes(search.toLowerCase())))&&
    (!srcFilter||c.source===srcFilter)
  );
  const openCreate = () => {setForm({...EMPTY});setEditId(null);setErr('');setShowModal(true);};
  const openEdit = (d:any) => {setForm({full_name:d.full_name||'',email:d.email||'',phone:d.phone||'',location:d.location||'',current_employer:d.current_employer||'',current_designation:d.current_designation||'',total_exp_mo:d.total_exp_mo||0,expected_ctc:d.expected_ctc||'',current_ctc:d.current_ctc||'',notice_period_days:d.notice_period_days||'',linkedin_url:d.linkedin_url||'',source:d.source||'linkedin',skills:d.skills||[],resume_text:d.resume_text||''});setEditId(d.id);setErr('');setShowModal(true);};
  const addSk = (s:string) => {const t=s.trim();if(t&&!form.skills.includes(t))setForm(f=>({...f,skills:[...f.skills,t]}));setSkIn('');};
  const rmSk = (s:string) => setForm(f=>({...f,skills:f.skills.filter((x:string)=>x!==s)}));
  const handleSave = async () => {
    if(!form.full_name.trim()){setErr('Full name required');return;}
    setSaving(true);setErr('');
    try {
      const p={...form,total_exp_mo:Number(form.total_exp_mo)||0,expected_ctc:form.expected_ctc?Number(form.expected_ctc):null,current_ctc:form.current_ctc?Number(form.current_ctc):null,notice_period_days:form.notice_period_days?Number(form.notice_period_days):null};
      if(editId) await apiFetch(`/candidates/${editId}`,{method:'PUT',body:JSON.stringify(p)});
      else       await apiFetch('/candidates',{method:'POST',body:JSON.stringify(p)});
      setShowModal(false);refetch();
    } catch(e:any){setErr(e.message||'Save failed');}
    finally{setSaving(false);}
  };
  const handleDel = async (id:string) => {if(!confirm('Delete this candidate?'))return;try{await apiFetch(`/candidates/${id}`,{method:'DELETE'});refetch();}catch{}};
  const srcs = [...new Set(all.map((c:any)=>c.source).filter(Boolean))];

  const handleExport = () => {
    const cols = ['full_name','email','phone','location','current_employer','current_designation','total_exp_mo','expected_ctc','current_ctc','notice_period_days','linkedin_url','source','skills'];
    const esc = (v:any) => {
      const s = v==null?'':Array.isArray(v)?v.join(';'):String(v);
      return s.includes(',')||s.includes('"')||s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const rows = [cols.join(','), ...all.map(c=>cols.map(k=>esc(c[k])).join(','))];
    const blob = new Blob([rows.join('\n')], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `candidates_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e:React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if(!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l=>l.trim());
      if(lines.length<2){setImporting(false);return;}
      const headerMap:Record<string,string> = {};
      const rawHeaders = lines[0].split(',').map(h=>h.replace(/^"|"$/g,'').trim().toLowerCase());
      rawHeaders.forEach((h,i)=>{
        const key =
          h==='name'||h==='full_name' ? 'full_name' :
          h==='email' ? 'email' :
          h==='phone'||h==='mobile' ? 'phone' :
          h==='location'||h==='city' ? 'location' :
          h==='employer'||h==='company'||h==='current_employer' ? 'current_employer' :
          h==='designation'||h==='current_designation' ? 'current_designation' :
          h==='exp'||h==='experience'||h==='total_exp_mo' ? 'total_exp_mo' :
          h==='expected_ctc'||h==='ctc' ? 'expected_ctc' :
          h==='current_ctc' ? 'current_ctc' :
          h==='notice'||h==='notice_period_days' ? 'notice_period_days' :
          h==='linkedin'||h==='linkedin_url' ? 'linkedin_url' :
          h==='source' ? 'source' :
          h==='skills' ? 'skills' : null;
        if(key) headerMap[key] = String(i);
      });
      let created=0, errors=0;
      for(let i=1;i<lines.length;i++){
        const vals = lines[i].split(',').map(v=>v.replace(/^"|"$/g,'').trim());
        const get = (k:string) => headerMap[k]!=null ? vals[Number(headerMap[k])]||'' : '';
        const payload:any = {
          full_name: get('full_name'),
          email: get('email'),
          phone: get('phone'),
          location: get('location'),
          current_employer: get('current_employer'),
          current_designation: get('current_designation'),
          total_exp_mo: parseInt(get('total_exp_mo'))||0,
          expected_ctc: get('expected_ctc') ? parseFloat(get('expected_ctc')) : null,
          current_ctc: get('current_ctc') ? parseFloat(get('current_ctc')) : null,
          notice_period_days: get('notice_period_days') ? parseInt(get('notice_period_days')) : null,
          linkedin_url: get('linkedin_url'),
          source: get('source')||'direct',
          skills: get('skills') ? get('skills').split(';').map((s:string)=>s.trim()).filter(Boolean) : [],
        };
        if(!payload.full_name) continue;
        try {
          await apiFetch('/candidates',{method:'POST',body:JSON.stringify(payload)});
          created++;
        } catch { errors++; }
      }
      refetch();
      setImportResult({created,errors});
    } catch { }
    finally {
      setImporting(false);
      if(importRef.current) importRef.current.value='';
    }
  };

  const handleScoreAll = async () => {
    if(all.length===0) return;
    setScoring(true);
    setScoreMsg(`Scoring ${all.length} candidates...`);
    try {
      const reqs = await apiFetch('/pipeline/active-requisitions');
      const reqList = Array.isArray(reqs) ? reqs : (reqs?.items||reqs?.data||[]);
      if(!reqList.length){setScoreMsg('No active requisitions found.');setTimeout(()=>setScoreMsg(''),2500);setScoring(false);return;}
      const reqId = reqList[0].id;
      const ids = all.map((c:any)=>c.id);
      const res = await apiFetch('/intelligence/score/bulk',{method:'POST',body:JSON.stringify({requisition_id:reqId,candidate_ids:ids,limit:200})});
      await apiFetch('/pipeline/sync-scores',{method:'POST',body:'{}'});
      const scored = res?.scored ?? res?.count ?? ids.length;
      setScoreMsg(`Done! Scored ${scored} candidates.`);
      refetch();
      setTimeout(()=>setScoreMsg(''),2500);
    } catch(e:any){
      setScoreMsg('Scoring failed: '+(e?.message||'unknown error'));
      setTimeout(()=>setScoreMsg(''),2500);
    }
    finally{setScoring(false);}
  };

  return (
    <div className="anim-fade-up">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'20px',flexWrap:'wrap',gap:'12px'}}>
        <div>
          <h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>Candidates</h1>
          <p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>{loading?'...':`${all.length} candidates in your database`}</p>
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <input ref={importRef} type="file" accept=".csv" style={{display:'none'}} onChange={handleImportFile}/>
          <button onClick={()=>importRef.current?.click()} disabled={importing} style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 14px',border:'1px solid #e2e8f0',background:'white',borderRadius:'8px',fontSize:'12px',color:'#374151',cursor:importing?'not-allowed':'pointer',opacity:importing?0.7:1}}><Upload size={13}/>{importing?'Importing...':'Import CSV'}</button>
          <button onClick={handleExport} style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 14px',border:'1px solid #e2e8f0',background:'white',borderRadius:'8px',fontSize:'12px',color:'#374151',cursor:'pointer'}}><Download size={13}/> Export</button>
          <button onClick={handleScoreAll} disabled={scoring} style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 14px',border:'1px solid #7c3aed',background:'#f5f3ff',borderRadius:'8px',fontSize:'12px',fontWeight:'600',color:'#7c3aed',cursor:scoring?'not-allowed':'pointer',opacity:scoring?0.7:1}}><Brain size={13}/>{scoring?'Scoring...':'AI Score All'}</button>
          <button onClick={openCreate} style={{display:'flex',alignItems:'center',gap:'6px',padding:'9px 18px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}><Plus size={14}/> Add Candidate</button>
        </div>
      </div>
      {scoreMsg&&<div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'14px',padding:'10px 16px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:'8px',fontSize:'13px',color:'#166534'}}><Brain size={14}/>{scoreMsg}</div>}
      {importResult&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px',padding:'10px 16px',background:importResult.errors>0?'#fffbeb':'#f0fdf4',border:`1px solid ${importResult.errors>0?'#fde68a':'#bbf7d0'}`,borderRadius:'8px',fontSize:'13px',color:importResult.errors>0?'#92400e':'#166534'}}><span>Imported {importResult.created} candidates{importResult.errors>0?` (${importResult.errors} skipped)`:''}</span><button onClick={()=>setImportResult(null)} style={{background:'none',border:'none',cursor:'pointer',padding:'2px',display:'flex',alignItems:'center'}}><X size={14}/></button></div>}
      <div style={{display:'flex',gap:'10px',marginBottom:'20px',flexWrap:'wrap',alignItems:'center'}}>
        <div style={{position:'relative',flex:1,minWidth:'280px',maxWidth:'440px'}}>
          <Search size={13} style={{position:'absolute',left:'12px',top:'50%',transform:'translateY(-50%)',color:'#94a3b8'}}/>
          <input placeholder="Search name, email, company, skill..." value={search} onChange={e=>setSearch(e.target.value)} style={{...INP,paddingLeft:'34px',borderRadius:'20px',background:'#f8fafc'}}/>
        </div>
        <div style={{display:'flex',gap:'5px',flexWrap:'wrap'}}>
          {['All',...srcs].map(s=>{const a=(s==='All'&&!srcFilter)||(srcFilter===s);return(<button key={s} onClick={()=>setSrcFilter(s==='All'?'':s)} style={{padding:'5px 12px',borderRadius:'20px',fontSize:'11px',fontWeight:'500',cursor:'pointer',background:a?'#1e40af':'white',color:a?'white':'#374151',border:`1px solid ${a?'#1e40af':'#e2e8f0'}`}}>{s}</button>);})}
        </div>
      </div>
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
        {loading?(<div style={{padding:'32px'}}>{[1,2,3,4,5].map(i=><div key={i} className="skeleton" style={{height:'52px',borderRadius:'8px',marginBottom:'8px'}}/>)}</div>)
        :filtered.length===0?(<div style={{textAlign:'center',padding:'80px 20px'}}><div style={{fontSize:'48px',marginBottom:'12px'}}>👤</div><h3 style={{fontSize:'16px',fontWeight:'600',color:'#374151',marginBottom:'8px'}}>{search?`No results for "${search}"`:'No candidates yet'}</h3><button onClick={openCreate} style={{padding:'10px 24px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer'}}>+ Add Candidate</button></div>)
        :(<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{['','Name','Phone','Exp','CTC','Company','Location','Skills','Source','Actions'].map((h,i)=><th key={i} style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
            <tbody data-testid="candidate-list">{filtered.map((d:any)=>(<tr key={d.id} style={{borderBottom:'1px solid #f1f5f9'}} onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#f8faff'} onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=''}>
              <td style={{padding:'10px 14px',width:'36px'}}><input type="checkbox" style={{accentColor:'#1e40af'}}/></td>
              <td style={{padding:'10px 14px'}}><div style={{display:'flex',alignItems:'center',gap:'10px'}}><div style={{width:'34px',height:'34px',borderRadius:'50%',background:gc(d.full_name),display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',color:'white',flexShrink:0}}>{gi(d.full_name)}</div><div><div style={{fontSize:'13px',fontWeight:'600',color:'#0f172a'}}>{d.full_name}</div><div style={{fontSize:'11px',color:'#94a3b8',display:'flex',alignItems:'center',gap:'4px',marginTop:'1px'}}><Mail size={10}/>{d.email||'—'}</div>{d.current_designation&&<div style={{fontSize:'10px',color:'#64748b',marginTop:'1px'}}>{d.current_designation}</div>}</div></div></td>
              <td style={{padding:'10px 14px'}}>{d.phone?<div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'#475569'}}><Phone size={11}/>{d.phone}</div>:<span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}</td>
              <td style={{padding:'10px 14px'}}><span style={{fontSize:'11px',fontWeight:'600',padding:'2px 8px',borderRadius:'10px',background:'#dbeafe',color:'#1e40af'}}>{gx(d.total_exp_mo||0)}</span>{d.notice_period_days&&<div style={{fontSize:'10px',color:'#64748b',marginTop:'2px'}}>{d.notice_period_days}d notice</div>}</td>
              <td style={{padding:'10px 14px'}}>{d.expected_ctc?<div style={{fontSize:'12px',color:'#059669',fontWeight:'600'}}>{fc(d.expected_ctc)}</div>:<span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}{d.current_ctc&&<div style={{fontSize:'10px',color:'#94a3b8'}}>Curr:{fc(d.current_ctc)}</div>}</td>
              <td style={{padding:'10px 14px'}}>{d.current_employer?<div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'#475569'}}><Briefcase size={11}/>{d.current_employer}</div>:<span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}</td>
              <td style={{padding:'10px 14px'}}>{d.location?<div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'#475569'}}><MapPin size={11}/>{d.location}</div>:<span style={{color:'#cbd5e1',fontSize:'12px'}}>—</span>}</td>
              <td style={{padding:'10px 14px'}}><div style={{display:'flex',flexWrap:'wrap',gap:'3px'}}>{(d.skills||[]).slice(0,2).map((s:string)=><span key={s} style={{fontSize:'10px',fontWeight:'500',padding:'2px 6px',borderRadius:'4px',background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe'}}>{s}</span>)}{(d.skills||[]).length>2&&<span style={{fontSize:'10px',padding:'2px 5px',borderRadius:'4px',background:'#f8fafc',color:'#94a3b8'}}>+{d.skills.length-2}</span>}</div></td>
              <td style={{padding:'10px 14px'}}><span style={{fontSize:'11px',padding:'2px 8px',borderRadius:'10px',background:'#f1f5f9',color:'#475569',fontWeight:'500'}}>{d.source||'direct'}</span></td>
              <td style={{padding:'10px 14px'}}><div style={{display:'flex',gap:'4px'}}><button onClick={()=>openEdit(d)} style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}><Edit size={12} style={{color:'#64748b'}}/></button><button onClick={()=>handleDel(d.id)} style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #fee2e2',background:'#fef2f2',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}><Trash2 size={12} style={{color:'#ef4444'}}/></button><a href={`/candidates/${d.id}`} style={{width:'28px',height:'28px',borderRadius:'6px',border:'1px solid #e2e8f0',background:'white',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none'}}><ExternalLink size={12} style={{color:'#64748b'}}/></a></div></td>
            </tr>))}</tbody>
          </table>
          <div style={{padding:'12px 16px',borderTop:'1px solid #f1f5f9'}}><span style={{fontSize:'12px',color:'#64748b'}}>Showing {filtered.length} of {all.length} candidates</span></div>
        </div>)}
      </div>

      <Modal open={showModal} onClose={()=>setShowModal(false)} title={editId?'Edit Candidate':'Add New Candidate'} subtitle="Fill in candidate details" size="lg"
        footer={<FormActions onClose={()=>setShowModal(false)} onSubmit={handleSave} loading={saving} submitLabel={editId?'Update Candidate':'Add Candidate'}/>}>
        {err&&<div style={{marginBottom:'16px',padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:'8px',fontSize:'13px',color:'#dc2626'}}>{err}</div>}
        <SectionDivider label="Personal Information"/>
        <FormRow>
          <FormField label="Full Name" required><input style={INP} placeholder="e.g. Rahul Sharma" value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))}/></FormField>
          <FormField label="Email"><input type="email" style={INP} placeholder="rahul@example.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></FormField>
        </FormRow>
        <FormRow>
          <FormField label="Phone"><input style={INP} placeholder="+91 9876543210" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}/></FormField>
          <FormField label="Location"><input style={INP} placeholder="e.g. Bengaluru, Karnataka" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}/></FormField>
        </FormRow>
        <FormRow>
          <FormField label="LinkedIn URL"><input style={INP} placeholder="https://linkedin.com/in/..." value={form.linkedin_url} onChange={e=>setForm(f=>({...f,linkedin_url:e.target.value}))}/></FormField>
          <FormField label="Source"><select style={INP} value={form.source} onChange={e=>setForm(f=>({...f,source:e.target.value}))}>{SRC.map(s=><option key={s} value={s}>{s.replace('_',' ')}</option>)}</select></FormField>
        </FormRow>
        <SectionDivider label="Professional Details"/>
        <FormRow>
          <FormField label="Current Employer"><input style={INP} placeholder="e.g. Infosys" value={form.current_employer} onChange={e=>setForm(f=>({...f,current_employer:e.target.value}))}/></FormField>
          <FormField label="Current Designation"><input style={INP} placeholder="e.g. Senior Engineer" value={form.current_designation} onChange={e=>setForm(f=>({...f,current_designation:e.target.value}))}/></FormField>
        </FormRow>
        <FormRow cols={3}>
          <FormField label="Experience (months)" hint="48 = 4 years"><input type="number" style={INP} min={0} max={600} value={form.total_exp_mo} onChange={e=>setForm(f=>({...f,total_exp_mo:+e.target.value}))}/></FormField>
          <FormField label="Notice Period (days)"><input type="number" style={INP} min={0} max={365} placeholder="e.g. 30" value={form.notice_period_days} onChange={e=>setForm(f=>({...f,notice_period_days:e.target.value}))}/></FormField>
        </FormRow>
        <SectionDivider label="Compensation (Annual in Rupees)"/>
        <FormRow>
          <FormField label="Expected CTC" hint="e.g. 1500000 = 15 LPA"><input type="number" style={INP} placeholder="e.g. 1500000" value={form.expected_ctc} onChange={e=>setForm(f=>({...f,expected_ctc:e.target.value}))}/></FormField>
          <FormField label="Current CTC"><input type="number" style={INP} placeholder="e.g. 1200000" value={form.current_ctc} onChange={e=>setForm(f=>({...f,current_ctc:e.target.value}))}/></FormField>
        </FormRow>
        <SectionDivider label="Skills"/>
        <FormField label="">
          {form.skills.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:'5px',marginBottom:'8px'}}>{form.skills.map((s:string)=><span key={s} style={{display:'inline-flex',alignItems:'center',gap:'4px',padding:'3px 10px',background:'#eff6ff',color:'#2563eb',borderRadius:'6px',fontSize:'12px',fontWeight:'500',border:'1px solid #bfdbfe'}}>{s}<span onClick={()=>rmSk(s)} style={{cursor:'pointer',color:'#93c5fd',fontWeight:'800',fontSize:'13px',lineHeight:'1'}}>x</span></span>)}</div>}
          <div style={{display:'flex',gap:'8px'}}><input style={{...INP,flex:1}} placeholder="Type skill and press Enter..." value={skIn} onChange={e=>setSkIn(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addSk(skIn);}}}/><button onClick={()=>addSk(skIn)} style={{padding:'9px 16px',background:'#eff6ff',color:'#2563eb',border:'1px solid #bfdbfe',borderRadius:'8px',cursor:'pointer',fontSize:'12px',fontWeight:'600',whiteSpace:'nowrap'}}>+ Add</button></div>
          <div style={{display:'flex',flexWrap:'wrap',gap:'4px',marginTop:'10px'}}>{QS.map(s=><button key={s} onClick={()=>addSk(s)} disabled={form.skills.includes(s)} style={{padding:'3px 9px',borderRadius:'5px',fontSize:'11px',cursor:form.skills.includes(s)?'default':'pointer',background:form.skills.includes(s)?'#dcfce7':'#f8fafc',color:form.skills.includes(s)?'#16a34a':'#64748b',border:`1px solid ${form.skills.includes(s)?'#bbf7d0':'#e2e8f0'}`,fontWeight:'500'}}>{s}</button>)}</div>
        </FormField>
        <SectionDivider label="Resume / Notes"/>
        <FormField label=""><textarea style={{...INP,minHeight:'90px',resize:'vertical',lineHeight:'1.6'}} placeholder="Paste resume text or notes about this candidate..." value={form.resume_text} onChange={e=>setForm(f=>({...f,resume_text:e.target.value}))}/></FormField>
      </Modal>
    </div>
  );
}
