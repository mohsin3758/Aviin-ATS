'use client';
import { useState } from 'react';
import { Heart, RefreshCw, AlertTriangle } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';
const GRADE_COLOR:Record<string,string>={'A+':'#059669','A':'#10b981','B':'#3b82f6','C':'#f59e0b','D':'#ef4444'};
const GRADE_BG:Record<string,string>={'A+':'#d1fae5','A':'#d1fae5','B':'#dbeafe','C':'#fef3c7','D':'#fee2e2'};
const RISK_COLOR:Record<string,string>={low:'badge-green',medium:'badge-amber',high:'badge-orange',critical:'badge-red'};
export default function ClientHealthPage() {
  const {data:scores,loading,refetch}=useFetch<any[]>('/client-health');
  const [computing,setComputing]=useState(false);
  async function compute(){setComputing(true);try{await apiFetch('/client-health/compute',{method:'POST'});refetch();}finally{setComputing(false);}}
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#831843,#be185d,#ec4899)'}}>
        <div className="relative z-10 flex items-start justify-between">
          <div><h1 className="text-white text-2xl font-bold mb-1">❤️ Client Health Scores</h1><p className="text-pink-200 text-sm">AI rule engine · Revenue × Collection × Fill Rate × Growth · Zero LLM</p></div>
          <button onClick={compute} disabled={computing} className="btn btn-sm" style={{background:'rgba(255,255,255,0.9)',color:'#831843'}}>
            {computing?<Spinner size="sm"/>:<RefreshCw size={13}/>} Recompute
          </button>
        </div>
      </div>
      <div className="card overflow-hidden">
        <table className="data-table"><thead><tr><th>Client</th><th>Health Score</th><th>Grade</th><th>Risk Level</th><th>Revenue Score</th><th>Collection</th><th>Fill Rate</th><th>Insights</th></tr></thead>
          <tbody>{loading?<tr><td colSpan={8} className="text-center py-8"><Spinner /></td></tr>:
            (scores||[]).map((s:any)=>(
              <tr key={s.id}>
                <td className="font-medium">{s.client_name}</td>
                <td><div className="flex items-center gap-2"><div className="progress-bar" style={{width:'80px',height:'6px'}}><div className="progress-fill" style={{width:`${s.health_score}%`,background:GRADE_COLOR[s.health_grade]||'var(--primary)'}}/></div><span className="font-bold text-sm">{Number(s.health_score).toFixed(0)}</span></div></td>
                <td><span className="badge font-bold text-xs" style={{background:GRADE_BG[s.health_grade],color:GRADE_COLOR[s.health_grade]}}>{s.health_grade}</span></td>
                <td><span className={`badge ${RISK_COLOR[s.risk_level]||'badge-gray'}`}>{s.risk_level}</span></td>
                <td>{Number(s.revenue_score).toFixed(0)}</td>
                <td>{Number(s.collection_score).toFixed(0)}</td>
                <td>{Number(s.fill_rate_score).toFixed(0)}</td>
                <td className="text-xs" style={{maxWidth:'200px'}}>{(s.insights||[]).slice(0,2).map((ins:string,i:number)=><div key={i} className="flex items-center gap-1" style={{color:'var(--amber)'}}><AlertTriangle size={10}/>{ins}</div>)}</td>
              </tr>))}
            {!scores?.length&&!loading&&<tr><td colSpan={8} className="text-center py-8" style={{color:'var(--gray-400)'}}>Click Recompute to analyse client health</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
