'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus, Send, CheckCircle, XCircle } from 'lucide-react';
export default function IntegrationsPage() {
  const {data:hooks,loading,refetch}=useFetch<any[]>('/integrations/webhooks');
  const [platform,setPlatform]=useState('slack');const [name,setName]=useState('');const [url,setUrl]=useState('');const [testing,setTesting]=useState<string|null>(null);
  const inputStyle={border:'1px solid #e2e8f0',borderRadius:'8px',padding:'8px 12px',fontSize:'13px',outline:'none',background:'white',boxSizing:'border-box' as const};
  async function add(){await apiFetch('/integrations/webhooks',{method:'POST',body:JSON.stringify({platform,name,webhook_url:url,events:[]})});setName('');setUrl('');refetch();}
  async function test(id:string){setTesting(id);try{await apiFetch(`/integrations/webhooks/${id}/test`,{method:'POST'});}finally{setTesting(null);refetch();}}
  return(
    <div className="anim-fade-up space-y-6">
      <div><h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>Slack / Teams Integrations</h1><p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>Send ATS events to Slack, Microsoft Teams, Discord</p></div>
      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
        <div style={{fontWeight:'600',fontSize:'14px',color:'#0f172a',marginBottom:'14px'}}>Add Webhook</div>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr 2fr auto',gap:'10px',alignItems:'end'}}>
          <div><label style={{fontSize:'11px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Platform</label><select value={platform} onChange={e=>setPlatform(e.target.value)} style={{...inputStyle,width:'100px'}}>{['slack','teams','discord','custom'].map(p=><option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={{fontSize:'11px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="#hiring-alerts" style={{...inputStyle,width:'100%'}}/></div>
          <div><label style={{fontSize:'11px',fontWeight:'600',color:'#374151',display:'block',marginBottom:'5px'}}>Webhook URL</label><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://hooks.slack.com/..." style={{...inputStyle,width:'100%'}}/></div>
          <button onClick={add} disabled={!name||!url} style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 16px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer',opacity:(!name||!url)?0.5:1,height:'37px'}}><Plus size={13}/>Add</button>
        </div>
        <div style={{marginTop:'10px',fontSize:'11px',color:'#94a3b8'}}>Slack: Settings → Integrations → Incoming Webhooks · Teams: Channel → Connectors → Incoming Webhook</div>
      </div>
      <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',overflow:'hidden'}}>
        <div style={{padding:'14px 16px',borderBottom:'1px solid #f1f5f9',fontWeight:'600',fontSize:'14px',color:'#0f172a'}}>Active Webhooks ({(hooks||[]).length})</div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{['Platform','Name','Sends','Status','Test'].map(h=><th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b'}}>{h}</th>)}</tr></thead>
          <tbody>
            {(hooks||[]).map((h:any)=>(
              <tr key={h.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                <td style={{padding:'10px 16px'}}><span style={{fontSize:'11px',fontWeight:'600',padding:'3px 10px',borderRadius:'10px',background:h.platform==='slack'?'#ede9fe':h.platform==='teams'?'#dbeafe':'#f1f5f9',color:h.platform==='slack'?'#7c3aed':h.platform==='teams'?'#1e40af':'#374151',textTransform:'capitalize'}}>{h.platform}</span></td>
                <td style={{padding:'10px 16px',fontWeight:'600',fontSize:'13px',color:'#0f172a'}}>{h.name}</td>
                <td style={{padding:'10px 16px',fontWeight:'600',fontSize:'13px'}}>{h.send_count||0}</td>
                <td style={{padding:'10px 16px'}}>{h.is_active?<CheckCircle size={15} style={{color:'#059669'}}/>:<XCircle size={15} style={{color:'#ef4444'}}/>}</td>
                <td style={{padding:'10px 16px'}}><button onClick={()=>test(h.id)} disabled={testing===h.id} style={{padding:'5px 12px',background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe',borderRadius:'6px',fontSize:'11px',fontWeight:'600',cursor:'pointer',display:'flex',alignItems:'center',gap:'4px'}}>{testing===h.id?'...':<><Send size={11}/>Test</>}</button></td>
              </tr>
            ))}
            {!hooks?.length&&<tr><td colSpan={5} style={{textAlign:'center',padding:'32px',color:'#94a3b8',fontSize:'12px'}}>No webhooks yet. Add one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
