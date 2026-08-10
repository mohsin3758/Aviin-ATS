'use client';
import { useFetch } from '@/lib/useFetch';
export default function AuditPage() {
  const {data:logs,loading}=useFetch<any[]>('/audit?limit=50');
  // BUG FIX (2026-08-10 audit): these two buttons were plain <a href> tags
  // with no Authorization header, pointed at a hardcoded raw IP over plain
  // HTTP — both downloaded a JSON 401 body, not a CSV. Same authenticated
  // fetch->blob->download pattern already used correctly on Analytics/
  // Reports; also added Requisitions (was fully orphaned — zero UI caller
  // anywhere) and switched .xlsx to .csv (the payload was always CSV).
  const downloadCsv = (path: string, filename: string) => {
    const token = localStorage.getItem('ats_token') || '';
    const API = process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviinjobs.com/api';
    fetch(API + path, { headers: { Authorization: 'Bearer ' + token } })
      .then(r => r.blob()).then(b => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(b);
        a.download = filename; a.click();
      });
  };
  const exports = [
    { path: '/export/candidates', label: 'Candidates', file: 'candidates_export.csv' },
    { path: '/export/requisitions', label: 'Requisitions', file: 'requisitions_export.csv' },
    { path: '/export/placements', label: 'Placements', file: 'placements_export.csv' },
  ];
  return(
    <div className="anim-fade-up space-y-6">
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'12px'}}>
        <div><h1 style={{fontSize:'20px',fontWeight:'700',color:'#0f172a'}}>Audit Trail</h1><p style={{fontSize:'13px',color:'#64748b',marginTop:'2px'}}>Complete activity log — who did what and when</p></div>
        <div style={{display:'flex',gap:'8px'}}>{exports.map(e=>(
          <button key={e.path} data-testid={`export-${e.label.toLowerCase()}`} onClick={()=>downloadCsv(e.path,e.file)}
            style={{padding:'7px 14px',background:'#eff6ff',color:'#1e40af',border:'1px solid #bfdbfe',borderRadius:'7px',fontSize:'12px',fontWeight:'600',cursor:'pointer'}}>
            ⬇️ {e.label}
          </button>
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
