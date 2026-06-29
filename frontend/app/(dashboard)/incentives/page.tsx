'use client';
import { useState } from 'react';
import { Award, TrendingUp, Banknote, Gift, Star, ChevronRight, Check } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';
export default function IncentivesPage() {
  const [tab, setTab] = useState('scorecards');
  const [month, setMonth] = useState(new Date().getMonth()+1);
  const [year, setYear] = useState(new Date().getFullYear());
  const qs = `?month=${month}&year=${year}`;
  const { data: summary } = useFetch<any>(`/incentives/summary${qs}`);
  const { data: scorecards } = useFetch<any[]>(`/incentives/scorecard${qs}`);
  const { data: bank } = useFetch<any[]>('/incentives/bank');
  const { data: loyalty } = useFetch<any[]>('/incentives/loyalty');
  const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const GRADE_COLOR:Record<string,string>={'A+':'#059669','A':'#10b981','B':'#3b82f6','C':'#f59e0b','D':'#ef4444'};
  const GRADE_BG:Record<string,string>={'A+':'#d1fae5','A':'#d1fae5','B':'#dbeafe','C':'#fef3c7','D':'#fee2e2'};
  const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
  return (
    <div data-testid="incentives-page" className="anim-fade-up space-y-6">
      <div className="page-hero">
        <div className="relative z-10 flex items-start justify-between">
          <div><h1 className="text-white text-2xl font-bold mb-1">💰 Incentive Engine</h1><p className="text-blue-200 text-sm">KPI 100-pt scorecard · 70/30 split · Retention bank · Loyalty milestones</p></div>
          <div className="flex gap-2">
            <select value={month} onChange={e=>setMonth(+e.target.value)} className="btn btn-sm" style={{background:'rgba(255,255,255,0.2)',color:'white',border:'1px solid rgba(255,255,255,0.3)'}}>
              {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m} style={{color:'black'}}>{MONTHS[m]}</option>)}
            </select>
            <select value={year} onChange={e=>setYear(+e.target.value)} className="btn btn-sm" style={{background:'rgba(255,255,255,0.2)',color:'white',border:'1px solid rgba(255,255,255,0.3)'}}>
              {[2025,2026,2027].map(y=><option key={y} value={y} style={{color:'black'}}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['🏆','Scorecards',summary?.total_scorecards||0,'#1e40af','#eff6ff'],['📊','Avg Score',summary?.avg_score||'—','#7c3aed','#ede9fe'],['💰','Incentive Pool',fmt(summary?.total_incentive_pool),'#059669','#d1fae5'],['🏦','Bank Held',fmt(summary?.bank_held),'#92400e','#fef3c7']].map(([icon,label,value,color,bg])=>(
          <div key={label} className="stat-card"><div className="stat-icon" style={{background:bg}}>{icon}</div><div className="stat-value" style={{color}}>{value}</div><div className="stat-label">{label}</div></div>
        ))}
      </div>
      <div className="tabs">{[['scorecards','🎯 KPI Scorecards'],['bank','🏦 Retention Bank'],['loyalty','🎁 Loyalty Milestones']].map(([k,l])=><button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>)}</div>
      {tab==='scorecards' && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3>KPI Scorecards — {MONTHS[month]} {year}</h3><span className="badge badge-blue">100-point system</span></div>
          <table className="data-table"><thead><tr><th>Recruiter</th><th>Score/Grade</th><th>Joinings</th><th>Revenue</th><th>Sat.</th><th>CM</th><th>Incentive</th><th>70% Now</th><th>30% Bank</th><th>Status</th></tr></thead>
            <tbody>{(scorecards||[]).map((s:any)=>(
              <tr key={s.id}><td><div className="font-medium text-sm">{s.full_name}</div><div className="text-xs" style={{color:'var(--gray-400)'}}>{s.email}</div></td>
                <td><div className="flex items-center gap-2"><span className="font-bold text-lg">{s.total_score}</span><span className="badge text-xs" style={{background:GRADE_BG[s.grade],color:GRADE_COLOR[s.grade]}}>{s.grade}</span></div></td>
                <td>{s.joinings_score}<span style={{color:'var(--gray-300)'}}>/35</span></td><td>{s.revenue_score}<span style={{color:'var(--gray-300)'}}>/25</span></td><td>{s.client_sat_score}<span style={{color:'var(--gray-300)'}}>/10</span></td>
                <td className="text-sm">{fmt(s.contribution_margin)}</td><td className="font-semibold">{fmt(s.calculated_incentive)}</td><td className="text-sm" style={{color:'var(--accent)'}}>{fmt(s.immediate_payout)}</td><td className="text-sm" style={{color:'var(--amber)'}}>{fmt(s.retention_bank_amount)}</td>
                <td><span className={`badge ${s.status==='approved'?'badge-green':s.status==='paid'?'badge-blue':'badge-gray'}`}>{s.status}</span></td>
              </tr>))}
              {!scorecards?.length&&<tr><td colSpan={10} className="text-center py-8" style={{color:'var(--gray-400)'}}>No scorecards for this period</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab==='bank' && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3>Retention Bank (30% Hold)</h3></div>
          <table className="data-table"><thead><tr><th>Recruiter</th><th>Amount</th><th>Period</th><th>Schedule</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>{(bank||[]).map((b:any)=>(
              <tr key={b.id}><td className="font-medium text-sm">{b.full_name}</td><td className="font-semibold" style={{color:'var(--amber)'}}>{fmt(b.amount)}</td><td className="text-xs">{MONTHS[b.accrued_month]} {b.accrued_year}</td><td className="text-xs capitalize">{b.release_schedule?.replace('_',' ')}</td><td className="text-xs">{b.release_due_date||'—'}</td><td><span className={`badge ${b.status==='held'?'badge-amber':b.status==='released'?'badge-green':'badge-red'}`}>{b.status}</span></td>
              </tr>))}
              {!bank?.length&&<tr><td colSpan={6} className="text-center py-8" style={{color:'var(--gray-400)'}}>No retention bank entries</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab==='loyalty' && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3>Loyalty Milestones</h3><span className="badge badge-green">₹15k · ₹30k · ₹50k · ₹1L</span></div>
          <table className="data-table"><thead><tr><th>Recruiter</th><th>Joining Date</th><th>Milestone</th><th>Bonus</th><th>Due Date</th><th>Status</th></tr></thead>
            <tbody>{(loyalty||[]).map((m:any)=>(
              <tr key={m.id}><td className="font-medium text-sm">{m.full_name}</td><td className="text-xs">{m.joining_date}</td><td><span className="badge badge-purple">{m.milestone_years} Year{m.milestone_years>1?'s':''}</span></td><td className="font-bold" style={{color:'var(--purple)'}}>{fmt(m.bonus_amount)}</td><td className="text-xs">{m.milestone_date}</td><td><span className={`badge ${m.status==='paid'?'badge-green':m.status==='achieved'?'badge-blue':'badge-gray'}`}>{m.status}</span></td>
              </tr>))}
              {!loyalty?.length&&<tr><td colSpan={6} className="text-center py-8" style={{color:'var(--gray-400)'}}>No loyalty milestones yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
