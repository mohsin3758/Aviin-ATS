'use client';
import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { useFetch } from '@/lib/useFetch';
export default function SlaPage() {
  const {data:summary}=useFetch<any>('/sla/summary');
  const {data:rows}=useFetch<any[]>('/sla');
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#7f1d1d,#dc2626,#ef4444)'}}>
        <div className="relative z-10"><h1 className="text-white text-2xl font-bold mb-1">⏱️ SLA Dashboard</h1><p className="text-red-200 text-sm">Time-to-fill · SLA breach alerts · Requisition aging</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['📋','Total Requisitions',summary?.total_requisitions||0,'#1e40af','#eff6ff'],['🚨','SLA Breached',summary?.breached||0,'#dc2626','#fee2e2'],['✅','On Track',summary?.on_track||0,'#059669','#d1fae5'],['⏳','Avg Age (days)',summary?.avg_age_days||'—','#92400e','#fef3c7']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="card-header"><h3>Requisition SLA Status</h3></div>
        <table className="data-table"><thead><tr><th>Role</th><th>Client</th><th>Age</th><th>Submissions</th><th>Interviews</th><th>Hires</th><th>Time→Sub</th><th>SLA Status</th></tr></thead>
          <tbody>{(rows||[]).map((r:any)=>(
            <tr key={r.requisition_id}>
              <td className="font-medium text-sm max-w-xs truncate">{r.role_title}</td>
              <td className="text-xs" style={{color:'var(--gray-500)'}}>{r.client_name||'—'}</td>
              <td><span className={`font-bold text-sm ${r.age_days>30?'text-red-600':r.age_days>14?'text-amber-600':'text-green-600'}`}>{r.age_days}d</span></td>
              <td>{r.total_submissions}</td><td>{r.interviews}</td><td className="font-semibold" style={{color:'var(--accent)'}}>{r.hires}</td>
              <td className="text-xs" style={{color:'var(--gray-500)'}}>{r.time_to_first_sub_hrs?`${r.time_to_first_sub_hrs}h`:'—'}</td>
              <td>{r.sla_breached?<span className="badge badge-red flex items-center gap-1"><AlertTriangle size={10}/>Breached</span>:<span className="badge badge-green flex items-center gap-1"><CheckCircle size={10}/>On Track</span>}</td>
            </tr>))}
            {!rows?.length&&<tr><td colSpan={8} className="text-center py-8" style={{color:'var(--gray-400)'}}>No requisitions found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
