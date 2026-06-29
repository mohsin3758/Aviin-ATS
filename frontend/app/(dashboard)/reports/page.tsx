'use client';
import { useState } from 'react';
import { BarChart3, Download, ChevronRight } from 'lucide-react';
import { useFetch } from '@/lib/useFetch';
import Link from 'next/link';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const pct=(n:any)=>n!=null?`${Number(n).toFixed(1)}%`:'—';
const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export default function ReportsPage() {
  const [tab,setTab]=useState('recruiter');
  const [m,setM]=useState(new Date().getMonth()+1);
  const [y,setY]=useState(new Date().getFullYear());
  const {data:recruiter}=useFetch<any[]>(`/reports/recruiter-performance?month=${m}&year=${y}`);
  const {data:billing}=useFetch<any[]>(`/reports/monthly-billing?year=${y}`);
  const {data:clients}=useFetch<any[]>('/reports/client-revenue');
  const {data:pv}=useFetch<any[]>('/reports/pipeline-velocity');
  const GRADE_BG:Record<string,string>={'A+':'#d1fae5','A':'#d1fae5','B':'#dbeafe','C':'#fef3c7','D':'#fee2e2'};
  const GRADE_COL:Record<string,string>={'A+':'#059669','A':'#10b981','B':'#3b82f6','C':'#f59e0b','D':'#ef4444'};
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero">
        <div className="relative z-10 flex items-start justify-between">
          <div><h1 className="text-white text-2xl font-bold mb-1">📊 Reports & Analytics</h1><p className="text-blue-200 text-sm">Recruiter performance · Monthly billing · Pipeline velocity · Client revenue</p></div>
          <div className="flex gap-2">
            <select value={m} onChange={e=>setM(+e.target.value)} className="btn btn-sm" style={{background:'rgba(255,255,255,0.2)',color:'white',border:'1px solid rgba(255,255,255,0.3)'}}>
              {Array.from({length:12},(_,i)=>i+1).map(mn=><option key={mn} value={mn} style={{color:'black'}}>{MONTHS[mn]}</option>)}
            </select>
            <select value={y} onChange={e=>setY(+e.target.value)} className="btn btn-sm" style={{background:'rgba(255,255,255,0.2)',color:'white',border:'1px solid rgba(255,255,255,0.3)'}}>
              {[2025,2026,2027].map(yr=><option key={yr} value={yr} style={{color:'black'}}>{yr}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[{label:'CSV: Candidates',path:'/export/candidates'},{label:'CSV: Placements',path:'/export/placements'},{label:'CSV: KPI Report',path:`/export/kpi-report?month=${m}&year=${y}`},{label:'PDF: KPI Report',path:`/pdf/kpi-report?month=${m}&year=${y}`}].map(({label,path})=>(
          <a key={label} href={`http://187.127.179.128:8080${path}`} className="card p-3 flex items-center gap-2 hover:shadow-md transition-all cursor-pointer" style={{textDecoration:'none',color:'var(--gray-700)'}}>
            <Download size={14} style={{color:'var(--primary)'}}/><span className="text-sm font-medium">{label}</span>
          </a>
        ))}
      </div>
      <div className="tabs">{[['recruiter','👥 Recruiter Perf.'],['billing','💰 Monthly Billing'],['clients','🏢 Client Revenue'],['pipeline','⚡ Pipeline Velocity']].map(([k,l])=><button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>)}</div>
      {tab==='recruiter' && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3>Recruiter Performance — {MONTHS[m]} {y}</h3></div>
          <table className="data-table"><thead><tr><th>Recruiter</th><th>Submissions</th><th>Interviews</th><th>Offers</th><th>Placements</th><th>Conversion</th><th>KPI Score</th><th>Incentive</th></tr></thead>
            <tbody>{(recruiter||[]).map((r:any)=>(
              <tr key={r.email}><td><div className="flex items-center gap-2"><div className="avatar avatar-sm" style={{background:'var(--primary)'}}>{r.recruiter?.[0]||'?'}</div><div><div className="font-medium text-sm">{r.recruiter||'—'}</div><div className="text-xs" style={{color:'var(--gray-400)'}}>{r.email}</div></div></div></td>
                <td className="font-semibold">{r.total_submissions||0}</td><td>{r.interviews||0}</td><td>{r.offers||0}</td>
                <td><span className="badge badge-green">{r.placements||0}</span></td>
                <td><div className="flex items-center gap-2"><div className="progress-bar" style={{width:'60px',height:'5px'}}><div className="progress-fill" style={{width:`${r.conversion_rate||0}%`,background:'var(--accent)'}}/></div><span className="text-xs">{r.conversion_rate||0}%</span></div></td>
                <td><span className="badge text-xs" style={{background:GRADE_BG[r.grade]||'var(--gray-100)',color:GRADE_COL[r.grade]||'var(--gray-600)'}}>{r.kpi_score||'—'}/100</span></td>
                <td className="font-medium text-xs">{fmt(r.incentive)}</td>
              </tr>))}
              {!recruiter?.length&&<tr><td colSpan={8} className="text-center py-8" style={{color:'var(--gray-400)'}}>No data for this period</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab==='billing' && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3>Monthly Billing — {y}</h3></div>
          <table className="data-table"><thead><tr><th>Month</th><th>Placements</th><th>Est. Revenue</th><th>Candidates Placed</th><th>Roles Filled</th></tr></thead>
            <tbody>{(billing||[]).map((b:any)=>(
              <tr key={`${b.month}-${b.year}`}><td className="font-medium">{MONTHS[b.month]} {b.year}</td><td className="font-semibold">{b.placements}</td><td className="font-semibold" style={{color:'var(--accent)'}}>{fmt(b.estimated_revenue)}</td><td>{b.candidates_placed}</td><td>{b.roles_filled}</td>
              </tr>))}
              {!billing?.length&&<tr><td colSpan={5} className="text-center py-8" style={{color:'var(--gray-400)'}}>No billing data yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab==='clients' && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3>Client Revenue Breakdown</h3></div>
          <table className="data-table"><thead><tr><th>Client</th><th>Months Active</th><th>Total Revenue</th><th>Total CM</th><th>Avg Margin</th><th>Open Positions</th></tr></thead>
            <tbody>{(clients||[]).map((c:any)=>(
              <tr key={c.client}><td className="font-medium">{c.client}</td><td>{c.months_active}</td><td className="font-semibold" style={{color:'var(--accent)'}}>{fmt(c.total_revenue)}</td><td className={c.total_cm>=0?'text-green-700 font-semibold':'text-red-600 font-semibold'}>{fmt(c.total_cm)}</td><td><span className={`badge ${c.avg_margin>=20?'badge-green':c.avg_margin>=10?'badge-amber':'badge-red'}`}>{pct(c.avg_margin)}</span></td><td>{c.open_positions}</td>
              </tr>))}
              {!clients?.length&&<tr><td colSpan={6} className="text-center py-8" style={{color:'var(--gray-400)'}}>No client data yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab==='pipeline' && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3>Pipeline Velocity by Stage</h3></div>
          <table className="data-table"><thead><tr><th>Stage</th><th>Candidates</th><th>Avg Days in Stage</th><th>Stale (7d+)</th></tr></thead>
            <tbody>{(pv||[]).map((r:any)=>(
              <tr key={r.stage}><td className="font-medium capitalize">{r.stage}</td><td className="font-semibold">{r.count}</td>
                <td><div className="flex items-center gap-2"><div className="progress-bar" style={{width:'80px',height:'5px'}}><div className="progress-fill" style={{width:`${Math.min(r.avg_days_in_stage*3,100)}%`,background:r.avg_days_in_stage>7?'var(--red)':r.avg_days_in_stage>3?'var(--amber)':'var(--accent)'}}/></div><span className={`text-sm font-bold ${r.avg_days_in_stage>7?'text-red-600':r.avg_days_in_stage>3?'text-amber-600':'text-green-600'}`}>{r.avg_days_in_stage}d</span></div></td>
                <td><span className={`badge ${r.stale_count>0?'badge-red':'badge-gray'}`}>{r.stale_count}</span></td>
              </tr>))}
              {!pv?.length&&<tr><td colSpan={4} className="text-center py-8" style={{color:'var(--gray-400)'}}>No pipeline data yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
