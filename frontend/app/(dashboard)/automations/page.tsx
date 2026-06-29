'use client';
import { useState } from 'react';
import { Zap, Play, Pause, CheckCircle } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';
export default function AutomationsPage() {
  const {data:summary}=useFetch<any>('/automations/summary');
  const {data:workflows,loading,refetch}=useFetch<any[]>('/automations');
  const [testing,setTesting]=useState<string|null>(null);
  async function toggle(id:string){await apiFetch(`/automations/${id}/toggle`,{method:'PATCH'});refetch();}
  async function test(path:string,id:string){setTesting(id);try{await apiFetch(`/automations/trigger/${path}`,{method:'POST',body:JSON.stringify({test:true})});}finally{setTesting(null);}}
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#4c1d95,#7c3aed,#a78bfa)'}}>
        <div className="relative z-10"><h1 className="text-white text-2xl font-bold mb-1">⚡ n8n Automation Workflows</h1><p className="text-purple-200 text-sm">10 recruiting automation triggers · Configure in n8n UI · Zero-token execution</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['⚡','Total Workflows',summary?.total||0,'#7c3aed','#ede9fe'],['✅','Active',summary?.active||0,'#059669','#d1fae5'],['🔥','Total Fires',summary?.total_fires||0,'#dc2626','#fee2e2'],['🕐','Last Fired',summary?.last_fired?new Date(summary.last_fired).toLocaleDateString('en-IN'):'Never','#92400e','#fef3c7']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col,fontSize:'16px'}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="card p-4 rounded-xl" style={{background:'#fef3c7',border:'1px solid #fde68a'}}>
        <div className="text-sm font-semibold mb-1" style={{color:'#92400e'}}>⚙️ n8n Setup Required</div>
        <p className="text-xs" style={{color:'#92400e'}}>To activate workflows, go to <strong>http://187.127.179.128:5678</strong> → Create workflows with the webhook paths below → Activate them. AVIIN ATS will automatically trigger them on events.</p>
      </div>
      <div className="card overflow-hidden">
        <div className="card-header"><h3>Automation Workflows</h3></div>
        <table className="data-table"><thead><tr><th>Workflow</th><th>Trigger</th><th>Webhook Path</th><th>Fires</th><th>Last Fired</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{loading?<tr><td colSpan={7} className="text-center py-8"><Spinner/></td></tr>:
            (workflows||[]).map((w:any)=>(
              <tr key={w.id}>
                <td><div className="font-medium text-sm">{w.name}</div><div className="text-xs" style={{color:'var(--gray-400)'}}>{w.description}</div></td>
                <td><span className="badge badge-gray capitalize">{w.trigger_type?.replace(/_/g,' ')}</span></td>
                <td><code className="text-xs px-2 py-0.5 rounded" style={{background:'var(--gray-100)',color:'var(--primary)'}}>/webhook/{w.webhook_path}</code></td>
                <td className="font-semibold">{w.fire_count||0}</td>
                <td className="text-xs" style={{color:'var(--gray-400)'}}>{w.last_fired_at?new Date(w.last_fired_at).toLocaleDateString('en-IN'):'Never'}</td>
                <td><span className={`badge ${w.is_active?'badge-green':'badge-gray'}`}>{w.is_active?'Active':'Paused'}</span></td>
                <td><div className="flex gap-1.5">
                  <button onClick={()=>toggle(w.id)} className={`btn btn-sm ${w.is_active?'btn-outline':'btn-success'}`} style={{padding:'4px 10px',fontSize:'11px'}}>
                    {w.is_active?<Pause size={12}/>:<Play size={12}/>}
                  </button>
                  <button onClick={()=>test(w.webhook_path,w.id)} disabled={testing===w.id} className="btn btn-outline btn-sm" style={{padding:'4px 10px',fontSize:'11px'}}>
                    {testing===w.id?<Spinner size="sm"/>:'Test'}
                  </button>
                </div></td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
