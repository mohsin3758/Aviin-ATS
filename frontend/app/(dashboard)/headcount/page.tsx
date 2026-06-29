'use client';
import { Users, Target, DollarSign, AlertTriangle } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const pct=(n:any)=>n!=null?`${n}%`:'—';
const PRI:Record<string,string>={critical:'badge-red',high:'badge-orange',medium:'badge-amber',low:'badge-gray'};
const ST:Record<string,string>={approved:'badge-green',in_progress:'badge-blue',planning:'badge-gray',closed:'badge-purple'};
export default function HeadcountPage() {
  const {data:sum}=useFetch<any>('/headcount/summary?fiscal_year=2026-2027');
  const {data:plans,loading,refetch}=useFetch<any[]>('/headcount?fiscal_year=2026-2027');
  async function approve(id:string){await apiFetch(`/headcount/${id}/approve`,{method:'PATCH'});refetch();}
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#1e3a5f,#1e40af,#3b82f6)'}}>
        <div className="relative z-10"><h1 className="text-white text-2xl font-bold mb-1">👥 Headcount Planning</h1><p className="text-blue-200 text-sm">FY 2026-2027 · Planned vs actual · Budget tracking · Priority management</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['🎯','Planned Hires',sum?.total_planned||0,'#1e40af','#eff6ff'],['✅','Actual Hired',sum?.total_hired||0,'#059669','#d1fae5'],['💰','Budget',fmt(sum?.total_budget),'#7c3aed','#ede9fe'],['🚨','Critical Plans',sum?.critical_count||0,'#dc2626','#fee2e2']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="card-header"><h3>FY 2026-2027 Headcount Plan</h3></div>
        <table className="data-table"><thead><tr><th>Department</th><th>Client</th><th>Q</th><th>Target</th><th>Hired</th><th>Progress</th><th>Budget</th><th>Priority</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{(plans||[]).map((p:any)=>(
            <tr key={p.id}>
              <td className="font-medium">{p.department}</td>
              <td className="text-xs" style={{color:'var(--gray-500)'}}>{p.client_name||'Internal'}</td>
              <td className="text-xs">Q{p.quarter||'—'}</td>
              <td className="font-bold">{p.planned_hires}</td>
              <td className={p.actual_hires>=p.planned_hires?'text-green-700 font-bold':'font-medium'}>{p.actual_hires}</td>
              <td><div className="flex items-center gap-2"><div className="progress-bar" style={{width:'60px',height:'6px'}}><div className="progress-fill" style={{width:`${Math.min((p.hire_pct||0),100)}%`,background:p.hire_pct>=100?'var(--accent)':p.hire_pct>=50?'var(--amber)':'var(--primary)'}}/></div><span className="text-xs">{pct(p.hire_pct)}</span></div></td>
              <td className="text-sm">{fmt(p.planned_budget)}</td>
              <td><span className={`badge ${PRI[p.priority]||'badge-gray'}`}>{p.priority}</span></td>
              <td><span className={`badge ${ST[p.status]||'badge-gray'}`}>{p.status}</span></td>
              <td>{p.status==='planning'&&<button onClick={()=>approve(p.id)} className="btn btn-success btn-sm" style={{fontSize:'11px',padding:'4px 10px'}}>Approve</button>}</td>
            </tr>))}
            {!plans?.length&&<tr><td colSpan={10} className="text-center py-8" style={{color:'var(--gray-400)'}}>No headcount plans found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
