'use client';
import { useState } from 'react';
import { DollarSign, TrendingUp } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
export default function SalaryBenchmarkPage() {
  const [role,setRole]=useState('');const [exp,setExp]=useState('3');const [loc,setLoc]=useState('Bengaluru');const [suggestion,setSuggestion]=useState<any>(null);const [loading,setLoading]=useState(false);
  const {data:demand}=useFetch<any>('/salary-benchmark/market-demand');
  const {data:all}=useFetch<any[]>('/salary-benchmark');
  async function lookup(){setLoading(true);try{const r=await apiFetch(`/salary-benchmark/suggest?role=${encodeURIComponent(role)}&exp_years=${exp}&location=${encodeURIComponent(loc)}`);setSuggestion(r);}finally{setLoading(false);}}
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#064e3b,#059669,#10b981)'}}>
        <div className="relative z-10"><h1 className="text-white text-2xl font-bold mb-1">💵 Salary Benchmarking</h1><p className="text-green-200 text-sm">India IT & Staffing market data · 26 benchmarks · Zero-token rule engine</p></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card"><div className="card-header"><h3>Salary Lookup</h3></div><div className="card-body space-y-3">
          <input className="input" placeholder="Role (e.g. Python Developer)" value={role} onChange={e=>setRole(e.target.value)}/>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium mb-1 block" style={{color:'var(--gray-600)'}}>Experience (years)</label><input type="number" className="input" value={exp} onChange={e=>setExp(e.target.value)} min="0" max="30"/></div>
            <div><label className="text-xs font-medium mb-1 block" style={{color:'var(--gray-600)'}}>Location</label>
              <select className="input" value={loc} onChange={e=>setLoc(e.target.value)}>
                {['Bengaluru','Hyderabad','Pune','Mumbai','Chennai','Delhi','Noida'].map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <button onClick={lookup} disabled={!role||loading} className="btn btn-success w-full justify-center">{loading?<Spinner size="sm"/>:<DollarSign size={14}/>} Get Salary Range</button>
          {suggestion && (
            <div className="rounded-xl p-4" style={{background:'var(--primary-bg)',border:'1px solid var(--gray-200)'}}>
              <div className="text-xs font-semibold mb-3" style={{color:'var(--primary)'}}>{suggestion.role_title||role} · {loc} · {exp}yr exp</div>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[['Min',suggestion.salary_min,'var(--gray-600)'],['Median',suggestion.salary_median,'var(--accent)'],['Max',suggestion.salary_max,'var(--gray-600)']].map(([l,v,col])=>(
                  <div key={l}><div className="font-bold text-lg" style={{color:col as string}}>{fmt(v)}</div><div className="text-xs mt-0.5" style={{color:'var(--gray-400)'}}>{l}</div></div>
                ))}
              </div>
              {suggestion.note && <p className="text-xs mt-2" style={{color:'var(--amber)'}}>{suggestion.note}</p>}
            </div>
          )}
        </div></div>
        <div className="card"><div className="card-header"><h3 className="flex items-center gap-2"><TrendingUp size={15} style={{color:'var(--primary)'}}/>Top Skills in Demand</h3><span className="badge badge-gray text-xs">From open requisitions</span></div><div className="card-body space-y-2.5">
          {(demand?.top_skills||[]).slice(0,12).map((s:any)=>{const max=demand?.top_skills?.[0]?.demand_count||1;return(
            <div key={s.skill} className="flex items-center gap-3"><div className="text-xs font-medium w-32 truncate" style={{color:'var(--gray-600)'}}>{s.skill}</div><div className="flex-1 progress-bar" style={{height:'8px'}}><div className="progress-fill" style={{width:`${(s.demand_count/max)*100}%`,background:'var(--primary)'}}/></div><span className="text-xs font-semibold w-6 text-right" style={{color:'var(--primary)'}}>{s.demand_count}</span></div>
          );})}
          {!demand?.top_skills?.length && <div className="text-center py-4 text-sm" style={{color:'var(--gray-400)'}}>No demand data. Add open requisitions first.</div>}
        </div></div>
      </div>
    </div>
  );
}
