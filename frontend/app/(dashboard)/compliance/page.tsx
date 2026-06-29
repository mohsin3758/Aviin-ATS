'use client';
import { useState } from 'react';
import { FileCheck, Calculator, Users } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
export default function CompliancePage() {
  const [gross,setGross]=useState('50000');
  const [calcResult,setCalcResult]=useState<any>(null);
  const [m,setM]=useState(new Date().getMonth()+1);
  const [y,setY]=useState(new Date().getFullYear());
  const [computing,setComputing]=useState(false);
  const {data:summary}=useFetch<any>(`/compliance/summary?month=${m}&year=${y}`);
  const {data:records}=useFetch<any[]>(`/compliance?month=${m}&year=${y}`);
  const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  async function calc(){const r=await apiFetch(`/compliance/calculate?gross_salary=${gross}&basic_pct=0.4`,{method:'GET'});setCalcResult(r);}
  async function computeAll(){setComputing(true);try{await apiFetch(`/compliance/bulk-compute?month=${m}&year=${y}`,{method:'POST'});}finally{setComputing(false);}}
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#065f46,#059669,#10b981)'}}>
        <div className="relative z-10 flex items-start justify-between">
          <div><h1 className="text-white text-2xl font-bold mb-1">📋 PF/ESI/TDS Compliance</h1><p className="text-green-200 text-sm">Indian statutory compliance · Zero-token rules engine · Instant calculations</p></div>
          <div className="flex gap-2">
            <select value={m} onChange={e=>setM(+e.target.value)} className="btn btn-sm" style={{background:'rgba(255,255,255,0.2)',color:'white',border:'1px solid rgba(255,255,255,0.3)'}}>
              {Array.from({length:12},(_,i)=>i+1).map(mn=><option key={mn} value={mn} style={{color:'black'}}>{MONTHS[mn]}</option>)}
            </select>
            <button onClick={computeAll} disabled={computing} className="btn btn-sm" style={{background:'rgba(255,255,255,0.9)',color:'#065f46'}}>
              {computing?<Spinner size="sm"/>:<Users size={13}/>} Compute All
            </button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['👥','Employees',summary?.employees||0,'#1e40af','#eff6ff'],['🏦','Total PF',fmt(summary?.total_pf),'#7c3aed','#ede9fe'],['🏥','Total ESI',fmt(summary?.total_esi),'#0f766e','#ccfbf1'],['📊','Total TDS',fmt(summary?.total_tds),'#92400e','#fef3c7']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card"><div className="card-header"><h3 className="flex items-center gap-2"><Calculator size={15}/>Quick Calculator</h3></div><div className="card-body space-y-3">
          <div><label className="text-xs font-medium mb-1 block" style={{color:'var(--gray-600)'}}>Gross Monthly Salary (₹)</label><input type="number" value={gross} onChange={e=>setGross(e.target.value)} className="input"/></div>
          <button onClick={calc} className="btn btn-success w-full justify-center">Calculate</button>
          {calcResult && (
            <div className="space-y-2 pt-2">
              {[['Gross',calcResult.gross_salary,'var(--gray-900)','font-bold'],['Basic (40%)',calcResult.basic_salary,'var(--gray-700)',''],['PF Employee (12%)',calcResult.pf_employee,'var(--red)',''],['PF Employer (12%)',calcResult.pf_employer,'var(--orange)',''],['ESI Employee (0.75%)',calcResult.esi_employee,'var(--red)',''],['ESI Employer (3.25%)',calcResult.esi_employer,'var(--orange)',''],['Professional Tax',calcResult.professional_tax,'var(--red)',''],['TDS (10%)',calcResult.tds_amount,'var(--red)',''],['Net Take-Home',calcResult.net_take_home,'var(--accent)','font-bold text-base'],['CTC (Total)',calcResult.total_cost_to_company,'var(--primary)','font-semibold']].map(([l,v,col,cls])=>(
                <div key={l} className="flex justify-between items-center py-1.5 border-b" style={{borderColor:'var(--gray-100)'}}>
                  <span className="text-xs" style={{color:'var(--gray-500)'}}>{l}</span>
                  <span className={`text-sm ${cls}`} style={{color:col as string}}>{fmt(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div></div>
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="card-header"><h3>Monthly Records — {MONTHS[m]} {y}</h3></div>
          <table className="data-table"><thead><tr><th>Candidate</th><th>Gross</th><th>PF (Ee)</th><th>ESI (Ee)</th><th>TDS</th><th>Net</th><th>CTC</th></tr></thead>
            <tbody>{(records||[]).map((r:any)=>(
              <tr key={r.id}><td className="font-medium text-sm">{r.candidate_name}</td><td>{fmt(r.gross_salary)}</td><td className="text-red-600">{fmt(r.pf_employee)}</td><td className="text-red-600">{fmt(r.esi_employee)}</td><td className="text-red-600">{fmt(r.tds_amount)}</td><td className="font-semibold" style={{color:'var(--accent)'}}>{fmt(r.net_take_home)}</td><td className="text-sm" style={{color:'var(--primary)'}}>{fmt(r.total_cost_to_company)}</td>
              </tr>))}
              {!records?.length&&<tr><td colSpan={7} className="text-center py-8" style={{color:'var(--gray-400)'}}>Click "Compute All" to generate records</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
