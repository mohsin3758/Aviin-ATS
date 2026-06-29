'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus, Search, Trash2 } from 'lucide-react';
const CAT_COLOR:Record<string,string>={tech:'#1e40af',language:'#7c3aed',framework:'#0f766e',database:'#92400e',cloud:'#0369a1',devops:'#be185d',ai:'#4f46e5',soft:'#059669',domain:'#ca8a04',tool:'#dc2626'};
export default function SkillsPage() {
  const [search,setSearch]=useState('');const [newSkill,setNewSkill]=useState('');const [newCat,setNewCat]=useState('tech');const [adding,setAdding]=useState(false);
  const {data:skills,loading,refetch}=useFetch<any[]>('/skills');
  const filtered=(skills||[]).filter((s:any)=>!search||s.skill_name?.toLowerCase().includes(search.toLowerCase()));
  const addSkill=async()=>{if(!newSkill.trim())return;setAdding(true);try{await apiFetch('/skills',{method:'POST',body:JSON.stringify({skill_name:newSkill.trim(),category:newCat})});setNewSkill('');refetch();}finally{setAdding(false);}};
  return(
    <div className="anim-fade-up space-y-6">
      <div><h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>Skills Taxonomy</h1><p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>{(skills||[]).length} skills · {[...new Set((skills||[]).map((s:any)=>s.category))].length} categories</p></div>
      <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
        <div style={{position:'relative',flex:1,minWidth:'240px'}}><Search size={13} style={{position:'absolute',left:'10px',top:'50%',transform:'translateY(-50%)',color:'#94a3b8'}}/><input placeholder="Search skills..." value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%',border:'1px solid #e2e8f0',borderRadius:'20px',padding:'8px 12px 8px 30px',fontSize:'13px',outline:'none',background:'#f8fafc',boxSizing:'border-box'}}/></div>
        <input placeholder="New skill name..." value={newSkill} onChange={e=>setNewSkill(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSkill()} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'8px 12px',fontSize:'13px',outline:'none',width:'180px'}}/>
        <select value={newCat} onChange={e=>setNewCat(e.target.value)} style={{border:'1px solid #e2e8f0',borderRadius:'8px',padding:'8px 12px',fontSize:'13px',outline:'none'}}>
          {['tech','language','framework','database','cloud','devops','ai','soft','domain','tool'].map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={addSkill} disabled={adding||!newSkill.trim()} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer',opacity:(!newSkill.trim()||adding)?0.6:1}}><Plus size={13}/>Add</button>
      </div>
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{['Skill Name','Category','Aliases'].map(h=><th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b'}}>{h}</th>)}</tr></thead>
          <tbody>{filtered.slice(0,60).map((s:any)=>(
            <tr key={s.id} style={{borderBottom:'1px solid #f1f5f9'}}>
              <td style={{padding:'10px 16px',fontWeight:'600',fontSize:'13px',color:'#0f172a'}}>{s.skill_name}</td>
              <td style={{padding:'10px 16px'}}><span style={{fontSize:'11px',fontWeight:'600',padding:'3px 10px',borderRadius:'10px',background:(CAT_COLOR[s.category]||'#64748b')+'18',color:CAT_COLOR[s.category]||'#64748b'}}>{s.category||'—'}</span></td>
              <td style={{padding:'10px 16px'}}><div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>{(s.aliases||[]).slice(0,3).map((a:string)=><span key={a} style={{fontSize:'10px',padding:'2px 7px',borderRadius:'4px',background:'#f1f5f9',color:'#475569'}}>{a}</span>)}</div></td>
            </tr>))}
            {!filtered.length&&<tr><td colSpan={3} style={{textAlign:'center',padding:'32px',color:'#94a3b8',fontSize:'13px'}}>No skills found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
