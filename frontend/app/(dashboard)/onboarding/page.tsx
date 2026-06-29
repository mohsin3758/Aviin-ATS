'use client';
import { useState } from 'react';
import { ClipboardList, CheckCircle, Clock, Users, AlertTriangle } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';
export default function OnboardingPage() {
  const {data:stats}=useFetch<any>('/onboarding/summary/stats');
  const {data:list,loading,refetch}=useFetch<any[]>('/onboarding');
  const [selected,setSelected]=useState<any>(null);
  async function toggleTask(id:string,taskId:number,done:boolean){await apiFetch(`/onboarding/${id}/task`,{method:'PATCH',body:JSON.stringify({task_id:taskId,completed:done})});refetch();setSelected(null);}
  const ST:Record<string,string>={completed:'badge-green',in_progress:'badge-blue',not_started:'badge-gray',cancelled:'badge-red'};
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#0f766e,#14b8a6,#2dd4bf)'}}>
        <div className="relative z-10"><h1 className="text-white text-2xl font-bold mb-1">📋 Employee Onboarding</h1><p className="text-teal-200 text-sm">Post-placement checklist · Document collection · Day 1 coordination · 10-step template</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['📋','Total',stats?.total||0,'#1e40af','#eff6ff'],['✅','Completed',stats?.completed||0,'#059669','#d1fae5'],['⏳','In Progress',stats?.in_progress||0,'#92400e','#fef3c7'],['🔔','Joining Soon (7d)',stats?.joining_soon||0,'#dc2626','#fee2e2']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="card-header"><h3>Active Onboardings</h3></div>
          {loading?<div className="p-8 text-center"><Spinner/></div>:
          <table className="data-table"><thead><tr><th>Candidate</th><th>Client</th><th>Joining</th><th>Progress</th><th>Status</th></tr></thead>
            <tbody>{(list||[]).map((o:any)=>(
              <tr key={o.id} className="cursor-pointer" onClick={()=>setSelected(o)}>
                <td><div className="font-medium text-sm">{o.candidate_name}</div><div className="text-xs" style={{color:'var(--gray-400)'}}>{o.candidate_email}</div></td>
                <td className="text-sm">{o.client_name||'—'}</td>
                <td className="text-xs">{o.joining_date||'—'}</td>
                <td><div className="flex items-center gap-2"><div className="progress-bar" style={{width:'70px',height:'6px'}}><div className="progress-fill" style={{width:`${o.total_count>0?(o.completed_count/o.total_count)*100:0}%`,background:'var(--accent)'}}/></div><span className="text-xs">{o.completed_count}/{o.total_count}</span></div></td>
                <td><span className={`badge ${ST[o.status]||'badge-gray'}`}>{o.status?.replace('_',' ')}</span></td>
              </tr>))}
              {!list?.length&&<tr><td colSpan={5} className="text-center py-8" style={{color:'var(--gray-400)'}}>No onboarding records. POST /onboarding to create.</td></tr>}
            </tbody>
          </table>}
        </div>
        {selected && (
          <div className="card"><div className="card-header"><div><div className="font-semibold text-sm">{selected.candidate_name}</div><div className="text-xs mt-0.5" style={{color:'var(--gray-400)'}}>{selected.client_name}</div></div><button onClick={()=>setSelected(null)} className="btn btn-ghost btn-sm">×</button></div>
            <div className="card-body space-y-2.5 overflow-y-auto" style={{maxHeight:'400px'}}>
              {(selected.tasks||[]).map((t:any)=>(
                <div key={t.id} className="flex items-start gap-2.5 cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors" onClick={()=>toggleTask(selected.id,t.id,!t.completed)}>
                  <div className="mt-0.5">{t.completed?<CheckCircle size={16} style={{color:'var(--accent)'}}/>:<Clock size={16} style={{color:'var(--gray-300)'}}/>}</div>
                  <div><div className={`text-sm font-medium ${t.completed?'line-through text-gray-400':''}`}>{t.title}</div><div className="text-xs" style={{color:'var(--gray-400)'}}>{t.desc}</div></div>
                </div>))}
              {!selected.tasks?.length&&<div className="text-center py-4 text-sm" style={{color:'var(--gray-400)'}}>No tasks in checklist</div>}
            </div>
          </div>
        )}
        {!selected && (
          <div className="card"><div className="card-header"><h3>Checklist Template</h3></div><div className="card-body">
            <p className="text-sm mb-4" style={{color:'var(--gray-500)'}}>Standard IT Contractor onboarding includes 10 tasks:</p>
            <ol className="space-y-2">{['Collect Documents (Aadhaar, PAN, Degrees)','Send Offer Letter','Initiate BGV','PF/ESI Enrollment','Collect Bank Details','Client SPOC Introduction','Access Card/Laptop','Day 1 Check-in Call','30-Day Check-in','First Invoice Generation'].map((t,i)=>(
              <li key={i} className="flex items-center gap-2 text-xs" style={{color:'var(--gray-600)'}}><span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{background:'var(--primary-bg)',color:'var(--primary)'}}>{i+1}</span>{t}</li>
            ))}</ol>
          </div></div>
        )}
      </div>
    </div>
  );
}
