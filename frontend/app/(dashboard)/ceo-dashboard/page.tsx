'use client';
import { useState } from 'react';
import { Crown, TrendingUp, DollarSign, Users, Building2, Award, BarChart3 } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const pct=(n:any)=>n!=null?`${Number(n).toFixed(1)}%`:'—';
const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export default function CeoDashboardPage() {
  const [m,setM]=useState(new Date().getMonth()+1);
  const [y,setY]=useState(new Date().getFullYear());
  const {data:ceo}=useFetch<any>(`/ceo-dashboard?month=${m}&year=${y}`);
  const {data:kpiStats}=useFetch<any>(`/incentives/summary?month=${m}&year=${y}`);
  const pl=ceo?.pl_summary||{}; const co=ceo?.collection_summary||{}; const bu=ceo?.bu_summary||{}; const kpi=ceo?.kpi_summary||{};
  return (
    <div data-testid="ceo-dashboard-page" className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#1d4ed8 100%)'}}>
        <div className="relative z-10 flex items-start justify-between">
          <div><div className="flex items-center gap-3 mb-2"><Crown size={28} className="text-yellow-300"/><h1 className="text-white text-2xl font-bold">CEO Dashboard</h1></div><p className="text-blue-200 text-sm">Full company P&L · Collections · BU status · KPI overview</p></div>
          <div className="flex gap-2">
            <select value={m} onChange={e=>setM(+e.target.value)} className="btn btn-sm" style={{background:'rgba(255,255,255,0.15)',color:'white',border:'1px solid rgba(255,255,255,0.3)'}}>
              {Array.from({length:12},(_,i)=>i+1).map(mn=><option key={mn} value={mn} style={{color:'black'}}>{MONTHS[mn]}</option>)}
            </select>
            <select value={y} onChange={e=>setY(+e.target.value)} className="btn btn-sm" style={{background:'rgba(255,255,255,0.15)',color:'white',border:'1px solid rgba(255,255,255,0.3)'}}>
              {[2025,2026,2027].map(yr=><option key={yr} value={yr} style={{color:'black'}}>{yr}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card" style={{border:'2px solid var(--primary)',background:'var(--primary-bg)'}}><div className="stat-icon" style={{background:'var(--primary)'}}>💰</div><div className="stat-value" style={{color:'var(--primary)'}}>{fmt(pl.total_revenue)}</div><div className="stat-label">Total Revenue</div><div className="text-xs mt-1" style={{color:'var(--gray-500)'}}>{pl.account_count||0} accounts · {pct(pl.avg_cm_pct)} avg CM</div></div>
        <div className="stat-card"><div className="stat-icon" style={{background:'#d1fae5'}}>📈</div><div className="stat-value" style={{color:'#059669'}}>{fmt(pl.total_cm)}</div><div className="stat-label">Contribution Margin</div></div>
        <div className="stat-card"><div className="stat-icon" style={{background:'#fef3c7'}}>⏳</div><div className="stat-value" style={{color:'#92400e'}}>{fmt(co.total_outstanding)}</div><div className="stat-label">Outstanding</div><div className="text-xs mt-1" style={{color:'var(--gray-500)'}}>{co.overdue_count||0} overdue</div></div>
        <div className="stat-card"><div className="stat-icon" style={{background:'#ede9fe'}}>⭐</div><div className="stat-value" style={{color:'#7c3aed'}}>{kpiStats?.avg_score||'—'}</div><div className="stat-label">Avg KPI Score</div><div className="text-xs mt-1" style={{color:'var(--gray-500)'}}>Pool: {fmt(kpiStats?.total_incentive_pool)}</div></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card"><div className="card-header"><h3 className="flex items-center gap-2"><Building2 size={15} style={{color:'var(--purple)'}}/>BU Status</h3></div><div className="card-body divide-y" style={{borderColor:'var(--gray-100)'}}>
          {[['Total Accounts',bu.total_accounts,'var(--gray-700)'],['Eligible for BU',bu.eligible_count,'var(--accent)'],['BUs Created',bu.bu_created_count,'var(--purple)']].map(([l,v,col])=>(
            <div key={l} className="flex justify-between items-center py-3"><span className="text-sm" style={{color:'var(--gray-500)'}}>{l}</span><span className="font-bold text-lg" style={{color:col as string}}>{v??'—'}</span></div>
          ))}
        </div></div>
        <div className="card"><div className="card-header"><h3 className="flex items-center gap-2"><Award size={15} style={{color:'var(--amber)'}}/>KPI Grades</h3></div><div className="card-body space-y-2">
          {[['A+',kpiStats?.grade_aplus,'#d1fae5','#059669'],['A',kpiStats?.grade_a,'#d1fae5','#10b981'],['B',kpiStats?.grade_b,'#dbeafe','#3b82f6'],['C',kpiStats?.grade_c,'#fef3c7','#f59e0b'],['D',kpiStats?.grade_d,'#fee2e2','#ef4444']].filter(([,v])=>v>0).map(([g,v,bg,col])=>(
            <div key={g} className="flex items-center gap-3"><span className="badge w-10 justify-center font-bold text-xs" style={{background:bg,color:col}}>{g}</span><div className="flex-1 progress-bar" style={{height:'8px'}}><div className="progress-fill" style={{width:`${(v/((kpiStats?.total_scorecards||1))*100)}%`,background:col}}/></div><span className="text-sm font-semibold w-6 text-right">{v}</span></div>
          ))}
        </div></div>
        <div className="card"><div className="card-header"><h3 className="flex items-center gap-2"><DollarSign size={15} style={{color:'var(--accent)'}}/>Incentive Pool</h3></div><div className="card-body divide-y" style={{borderColor:'var(--gray-100)'}}>
          {[['Total Pool',fmt(kpiStats?.total_incentive_pool),'var(--gray-900)'],['Immediate (70%)',fmt(kpiStats?.total_immediate),'var(--accent)'],['Bank (30%)',fmt(kpiStats?.total_banked),'var(--amber)'],['Bank Held',fmt(kpiStats?.bank_held),'var(--gray-500)'],['Milestones Due',fmt(kpiStats?.due_amount),'var(--purple)']].map(([l,v,col])=>(
            <div key={l} className="flex justify-between items-center py-2"><span className="text-xs" style={{color:'var(--gray-500)'}}>{l}</span><span className="text-sm font-semibold" style={{color:col as string}}>{v}</span></div>
          ))}
        </div></div>
      </div>
      <div className="card overflow-hidden">
        <div className="card-header"><h3>Top Accounts by Revenue — {MONTHS[m]} {y}</h3></div>
        <table className="data-table"><thead><tr><th>#</th><th>Client</th><th>Revenue</th><th>CM</th><th>CM%</th><th>Fill Rate</th></tr></thead>
          <tbody>{(ceo?.top_accounts||[]).map((a:any,i:number)=>(
            <tr key={i}><td className="text-gray-400 text-sm font-mono">#{i+1}</td><td className="font-medium">{a.client_name||'—'}</td><td className="font-semibold">{fmt(a.gross_revenue)}</td><td className={a.contribution_margin>=0?'text-green-700 font-semibold':'text-red-600 font-semibold'}>{fmt(a.contribution_margin)}</td><td><span className={`badge ${a.cm_pct>=20?'badge-green':a.cm_pct>=10?'badge-amber':'badge-red'}`}>{pct(a.cm_pct)}</span></td><td>{pct(a.fill_rate_pct)}</td>
            </tr>))}
            {!ceo?.top_accounts?.length&&<tr><td colSpan={6} className="text-center py-8" style={{color:'var(--gray-400)'}}>No P&L data for this period</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
