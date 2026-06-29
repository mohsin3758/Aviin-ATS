'use client';
import { useFetch } from '@/lib/useFetch';
export default function AuditPage() {
  const {data:logs,loading}=useFetch<any[]>('/audit?limit=50');
  return(
    <div className="anim-fade-up space-y-6">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'12px'}}>
        <div><h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>Audit Trail</h1><p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>Complete activity log — who did what and when</p></div>
        <div style={{display:'flex',gap:'8px'}}>{['/export/candidates','/export/placements'].map(p=>(
          <a key={p} href={`http://187.127.179.128:8080${p}`} style={{padding:'7px 14px',background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe',borderRadius:'7px',fontSize:'12px',fontWeight:'600',textDecoration:'none'}}>⬇️ {p.split('/').pop()}</a>
        ))}</div>
      </div>
      <div style={{background:'white',borderRadius:'12px',border:'1px solid #e2e8f0',overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:'#f8fafc',borderBottom:'1px solid #e2e8f0'}}>{['Time','User','Action','Resource','ID'].map(h=><th key={h} style={{padding:'10px 16px',textAlign:'left',fontSize:'11px',fontWeight:'600',textTransform:'uppercase',letterSpacing:'0.05em',color:'#64748b'}}>{h}</th>)}</tr></thead>
          <tbody>
            {(logs||[]).map((l:any)=>(
              <tr key={l.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                <td style={{padding:'10px 16px',fontSize:'12px',color:'#64748b'}}>{new Date(l.created_at).toLocaleString('en-IN')}</td>
                <td style={{padding:'10px 16px'}}><div style={{fontSize:'12px',fontWeight:'600',color:'#0f172a'}}>{l.user_name||'System'}</div><div style={{fontSize:'11px',color:'#94a3b8'}}>{l.user_email}</div></td>
                <td style={{padding:'10px 16px'}}><span style={{fontSize:'11px',fontWeight:'600',padding:'2px 9px',borderRadius:'6px',background:'#eff6ff',color:'#1e40af'}}>{l.action}</span></td>
                <td style={{padding:'10px 16px',fontSize:'12px',color:'#475569',textTransform:'capitalize'}}>{l.resource}</td>
                <td style={{padding:'10px 16px',fontSize:'11px',fontFamily:'monospace',color:'#94a3b8'}}>{l.resource_id?.slice(0,8)||'—'}</td>
              </tr>
            ))}
            {!logs?.length&&!loading&&<tr><td colSpan={5} style={{textAlign:'center',padding:'40px',color:'#94a3b8',fontSize:'13px'}}>No audit entries yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
