'use client';
import { useState, useEffect } from 'react';
import { Award, TrendingUp, Banknote, Gift, Star, ChevronRight, Check, Plus } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';
import { getTokenPayload } from '@/lib/auth';

const input: React.CSSProperties = { fontSize: 13, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none' };
const smallBtn = 'text-xs px-2 py-1 rounded font-semibold text-white hover:opacity-90';
const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const GRADE_COLOR:Record<string,string>={'A+':'#059669','A':'#10b981','B':'#3b82f6','C':'#f59e0b','D':'#ef4444'};
const GRADE_BG:Record<string,string>={'A+':'#d1fae5','A':'#d1fae5','B':'#dbeafe','C':'#fef3c7','D':'#fee2e2'};
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const MGMT_ROLES = ['admin','super_admin','manager','lead_recruiter'];

export default function IncentivesPage() {
  // REAL BUG FIX (2026-08-31): reported live off a real recruiter's own
  // /incentives screenshot — a plain recruiter saw EVERY other recruiter's
  // real compensation data (scorecards, retention bank, loyalty payouts)
  // plus a "Recruiter: Select..." picker and full create/approve forms
  // for anyone, on what should be their own personal view. The backend
  // (incentives.py) now force-scopes every read to the caller's own data
  // for any non-management role, and every write (create/approve/release/
  // pay) is admin/manager-only — this SSR-safe deferred role read (same
  // established pattern as RecruiterOverview.tsx) decides which page
  // actually renders: the existing tenant-wide management view for
  // admin/manager/lead_recruiter, or a genuine personal-only dashboard
  // for everyone else.
  const [role, setRole] = useState('admin');
  const [roleReady, setRoleReady] = useState(false);
  useEffect(() => { setRole(getTokenPayload()?.role || 'admin'); setRoleReady(true); }, []);
  if (roleReady && !MGMT_ROLES.includes(role)) return <MyIncentivesView />;
  return <ManagementIncentivesView />;
}

function ManagementIncentivesView() {
  const [tab, setTab] = useState('scorecards');
  const [month, setMonth] = useState(new Date().getMonth()+1);
  const [year, setYear] = useState(new Date().getFullYear());
  const qs = `?month=${month}&year=${year}`;
  const { data: summary } = useFetch<any>(`/incentives/summary${qs}`);
  const { data: scorecards, refetch: refetchSc } = useFetch<any[]>(`/incentives/scorecard${qs}`);
  const { data: bank, refetch: refetchBank } = useFetch<any[]>('/incentives/bank');
  const { data: loyalty, refetch: refetchLoyalty } = useFetch<any[]>('/incentives/loyalty');
  const { data: advKpis, refetch: refetchAdv } = useFetch<any[]>(`/incentives/advanced-kpis${qs}`);
  const { data: usersRaw } = useFetch<any[]>('/users?is_active=true');
  const users = usersRaw || [];

  async function approveScorecard(id:string,status:string){await apiFetch(`/incentives/scorecard/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});refetchSc();}
  async function resolveBank(bank_id:string,status:'released'|'forfeited',forfeited_reason?:string){
    await apiFetch(`/incentives/bank/${bank_id}`,{method:'PATCH',body:JSON.stringify({bank_id,status,forfeited_reason})});
    refetchBank();
  }
  async function payMilestone(id:string){await apiFetch(`/incentives/loyalty/${id}/pay`,{method:'PATCH'});refetchLoyalty();}

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
      <div className="tabs">{[['scorecards','🎯 KPI Scorecards'],['bank','🏦 Retention Bank'],['loyalty','🎁 Loyalty Milestones'],['advanced','📈 Advanced KPIs']].map(([k,l])=><button key={k} className={`tab ${tab===k?'active':''}`} onClick={()=>setTab(k)}>{l}</button>)}</div>
      {tab==='scorecards' && (
        <div className="space-y-4">
          <NewScorecardForm users={users} month={month} year={year} onCreated={refetchSc} />
          <div className="card overflow-hidden">
            <div className="card-header"><h3>KPI Scorecards — {MONTHS[month]} {year}</h3><span className="badge badge-blue">100-point system</span></div>
            <table className="data-table"><thead><tr><th>Recruiter</th><th>Score/Grade</th><th>Joinings</th><th>Revenue</th><th>Sat.</th><th>CM</th><th>Incentive</th><th>70% Now</th><th>30% Bank</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{(scorecards||[]).map((s:any)=>(
                <tr key={s.id}><td><div className="font-medium text-sm">{s.full_name}</div><div className="text-xs" style={{color:'var(--gray-400)'}}>{s.email}</div></td>
                  <td><div className="flex items-center gap-2"><span className="font-bold text-lg">{s.total_score}</span><span className="badge text-xs" style={{background:GRADE_BG[s.grade],color:GRADE_COLOR[s.grade]}}>{s.grade}</span></div></td>
                  <td>{s.joinings_score}<span style={{color:'var(--gray-300)'}}>/35</span></td><td>{s.revenue_score}<span style={{color:'var(--gray-300)'}}>/25</span></td><td>{s.client_sat_score}<span style={{color:'var(--gray-300)'}}>/10</span></td>
                  <td className="text-sm">{fmt(s.contribution_margin)}</td><td className="font-semibold">{fmt(s.calculated_incentive)}</td><td className="text-sm" style={{color:'var(--accent)'}}>{fmt(s.immediate_payout)}</td><td className="text-sm" style={{color:'var(--amber)'}}>{fmt(s.retention_bank_amount)}</td>
                  <td><span className={`badge ${s.status==='approved'?'badge-green':s.status==='paid'?'badge-blue':'badge-gray'}`}>{s.status}</span></td>
                  <td>
                    {s.status==='draft'&&<button onClick={()=>approveScorecard(s.id,'approved')} className={`${smallBtn} bg-blue-600`}>Approve</button>}
                    {s.status==='approved'&&<button onClick={()=>approveScorecard(s.id,'paid')} className={`${smallBtn} bg-green-600`}>Mark Paid</button>}
                  </td>
                </tr>))}
                {!scorecards?.length&&<tr><td colSpan={11} className="text-center py-8" style={{color:'var(--gray-400)'}}>No scorecards for this period — create one above</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab==='bank' && (
        <div className="card overflow-hidden">
          <div className="card-header"><h3>Retention Bank (30% Hold)</h3></div>
          <table className="data-table"><thead><tr><th>Recruiter</th><th>Amount</th><th>Period</th><th>Schedule</th><th>Due Date</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{(bank||[]).map((b:any)=>(
              <tr key={b.id}><td className="font-medium text-sm">{b.full_name}</td><td className="font-semibold" style={{color:'var(--amber)'}}>{fmt(b.amount)}</td><td className="text-xs">{MONTHS[b.accrued_month]} {b.accrued_year}</td><td className="text-xs capitalize">{b.release_schedule?.replace('_',' ')}</td><td className="text-xs">{b.release_due_date||'—'}</td><td><span className={`badge ${b.status==='held'?'badge-amber':b.status==='released'?'badge-green':'badge-red'}`}>{b.status}</span></td>
                <td>
                  {b.status==='held'&&(
                    <div className="flex gap-1">
                      <button onClick={()=>resolveBank(b.id,'released')} className={`${smallBtn} bg-green-600`}>Release</button>
                      <button onClick={()=>{const reason=prompt('Forfeit reason:'); if(reason!=null) resolveBank(b.id,'forfeited',reason);}} className={`${smallBtn} bg-red-600`}>Forfeit</button>
                    </div>
                  )}
                </td>
              </tr>))}
              {!bank?.length&&<tr><td colSpan={7} className="text-center py-8" style={{color:'var(--gray-400)'}}>No retention bank entries</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {tab==='loyalty' && (
        <div className="space-y-4">
          <NewLoyaltyForm users={users} onCreated={refetchLoyalty} />
          <div className="card overflow-hidden">
            <div className="card-header"><h3>Loyalty Milestones</h3><span className="badge badge-green">₹15k · ₹30k · ₹50k · ₹1L</span></div>
            <table className="data-table"><thead><tr><th>Recruiter</th><th>Joining Date</th><th>Milestone</th><th>Bonus</th><th>Due Date</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{(loyalty||[]).map((m:any)=>(
                <tr key={m.id}><td className="font-medium text-sm">{m.full_name}</td><td className="text-xs">{m.joining_date}</td><td><span className="badge badge-purple">{m.milestone_years} Year{m.milestone_years>1?'s':''}</span></td><td className="font-bold" style={{color:'var(--purple)'}}>{fmt(m.bonus_amount)}</td><td className="text-xs">{m.milestone_date}</td><td><span className={`badge ${m.status==='paid'?'badge-green':m.status==='achieved'?'badge-blue':'badge-gray'}`}>{m.status}</span></td>
                  <td>{m.status==='achieved'&&<button onClick={()=>payMilestone(m.id)} className={`${smallBtn} bg-green-600`}>Mark Paid</button>}</td>
                </tr>))}
                {!loyalty?.length&&<tr><td colSpan={7} className="text-center py-8" style={{color:'var(--gray-400)'}}>No loyalty milestones yet — seed one above</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab==='advanced' && (
        <div className="space-y-4">
          <NewAdvancedKpiForm users={users} month={month} year={year} onCreated={refetchAdv} />
          <div className="card overflow-hidden">
            <div className="card-header"><h3>Advanced Quality KPIs — {MONTHS[month]} {year}</h3><span className="badge badge-purple">10 quality metrics</span></div>
            <div style={{overflowX:'auto'}}>
            <table className="data-table"><thead><tr><th>Recruiter</th><th>1st Sub (hrs)</th><th>Sub. Accept %</th><th>Interview Ratio</th><th>Offer Ratio</th><th>Joining Ratio</th><th>Offer Drop %</th><th>No-Show %</th><th>Cand. Sat.</th><th>Client Sat.</th><th>90d Retention %</th></tr></thead>
              <tbody>{(advKpis||[]).map((k:any)=>(
                <tr key={k.id}>
                  <td className="font-medium text-sm">{k.full_name}</td>
                  <td className="text-sm">{k.time_to_first_sub_hrs ?? '—'}</td>
                  <td className="text-sm">{k.submission_acceptance_pct!=null?`${k.submission_acceptance_pct}%`:'—'}</td>
                  <td className="text-sm">{k.interview_ratio ?? '—'}</td>
                  <td className="text-sm">{k.offer_ratio ?? '—'}</td>
                  <td className="text-sm">{k.joining_ratio ?? '—'}</td>
                  <td className="text-sm" style={{color:k.offer_drop_rate>20?'var(--red)':undefined}}>{k.offer_drop_rate!=null?`${k.offer_drop_rate}%`:'—'}</td>
                  <td className="text-sm" style={{color:k.no_show_pct>10?'var(--red)':undefined}}>{k.no_show_pct!=null?`${k.no_show_pct}%`:'—'}</td>
                  <td className="text-sm">{k.candidate_satisfaction ?? '—'}</td>
                  <td className="text-sm">{k.client_satisfaction ?? '—'}</td>
                  <td className="text-sm">{k.retention_90day_pct!=null?`${k.retention_90day_pct}%`:'—'}</td>
                </tr>))}
                {!advKpis?.length&&<tr><td colSpan={11} className="text-center py-8" style={{color:'var(--gray-400)'}}>No advanced KPIs recorded for this period — add one above</td></tr>}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Real, genuine personal dashboard for any non-management role (recruiter/
// kae/kam/etc.) — read-only throughout, since the backend now force-scopes
// every one of these reads to the caller's own data regardless of role, and
// every write (create/approve/release/pay) is admin/manager-only. No
// recruiter-picker anywhere — there is nothing to pick, this page can only
// ever show one person's own data.
function MyIncentivesView() {
  const [month, setMonth] = useState(new Date().getMonth()+1);
  const [year, setYear] = useState(new Date().getFullYear());
  const qs = `?month=${month}&year=${year}`;
  const { data: summary, loading: sLoading } = useFetch<any>(`/incentives/summary${qs}`);
  const { data: scorecards, loading: scLoading } = useFetch<any[]>(`/incentives/scorecard${qs}`);
  const { data: bank, loading: bLoading } = useFetch<any[]>('/incentives/bank');
  const { data: loyalty, loading: lLoading } = useFetch<any[]>('/incentives/loyalty');
  const { data: advKpis, loading: aLoading } = useFetch<any[]>(`/incentives/advanced-kpis${qs}`);
  const myScorecard = (scorecards || [])[0];
  const myAdv = (advKpis || [])[0];
  const bankHeld = (bank || []).filter(b => b.status === 'held').reduce((s, b) => s + Number(b.amount || 0), 0);
  const loading = sLoading || scLoading || bLoading || lLoading || aLoading;

  return (
    <div data-testid="incentives-page" className="anim-fade-up space-y-6">
      <div className="page-hero">
        <div className="relative z-10 flex items-start justify-between">
          <div><h1 className="text-white text-2xl font-bold mb-1">💰 My Incentives</h1><p className="text-blue-200 text-sm">Your own KPI scorecard, retention bank, and loyalty milestones</p></div>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="my-incentives-cards">
        {[['🏆','My Score',myScorecard?myScorecard.total_score+' / 100':'—','#1e40af','#eff6ff'],
          ['💰','My Incentive',fmt(summary?.total_incentive_pool),'#059669','#d1fae5'],
          ['🏦','Bank Held',fmt(bankHeld),'#92400e','#fef3c7'],
          ['🎁','Pending Milestones',summary?.pending_milestones??0,'#7c3aed','#ede9fe']]
          .map(([icon,label,value,color,bg])=>(
          <div key={label as string} className="stat-card"><div className="stat-icon" style={{background:bg as string}}>{icon}</div><div className="stat-value" style={{color:color as string}}>{loading?'…':value}</div><div className="stat-label">{label}</div></div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><h3>My Scorecard — {MONTHS[month]} {year}</h3>{myScorecard && <span className="badge text-xs" style={{background:GRADE_BG[myScorecard.grade],color:GRADE_COLOR[myScorecard.grade]}}>{myScorecard.grade}</span>}</div>
        {!myScorecard ? (
          <div className="text-center py-8" style={{color:'var(--gray-400)'}}>No scorecard recorded for this period yet.</div>
        ) : (
          <div style={{padding:16}}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{marginBottom:12}}>
              {[['Joinings',myScorecard.joinings_score,35],['Revenue',myScorecard.revenue_score,25],['Interview',myScorecard.interview_score,10],['Offer',myScorecard.offer_score,10],['Client Sat',myScorecard.client_sat_score,10],['ATS',myScorecard.ats_score,10]].map(([label,val,max])=>(
                <div key={label as string} style={{background:'#f8fafc',borderRadius:8,padding:'8px 10px'}}>
                  <div style={{fontSize:10,color:'#94a3b8',fontWeight:600,textTransform:'uppercase'}}>{label as string}</div>
                  <div style={{fontSize:16,fontWeight:700}}>{val as any}<span style={{color:'#cbd5e1',fontSize:12}}>/{max as any}</span></div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>Contribution Margin: <span className="font-semibold">{fmt(myScorecard.contribution_margin)}</span></div>
              <div>Incentive: <span className="font-semibold">{fmt(myScorecard.calculated_incentive)}</span></div>
              <div>70% Now: <span className="font-semibold" style={{color:'var(--accent)'}}>{fmt(myScorecard.immediate_payout)}</span></div>
              <div>30% Bank: <span className="font-semibold" style={{color:'var(--amber)'}}>{fmt(myScorecard.retention_bank_amount)}</span></div>
              <div>Status: <span className={`badge ${myScorecard.status==='approved'?'badge-green':myScorecard.status==='paid'?'badge-blue':'badge-gray'}`}>{myScorecard.status}</span></div>
            </div>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><h3>My Retention Bank (30% Hold)</h3></div>
        <table className="data-table"><thead><tr><th>Amount</th><th>Period</th><th>Schedule</th><th>Due Date</th><th>Status</th></tr></thead>
          <tbody>{(bank||[]).map((b:any)=>(
            <tr key={b.id}><td className="font-semibold" style={{color:'var(--amber)'}}>{fmt(b.amount)}</td><td className="text-xs">{MONTHS[b.accrued_month]} {b.accrued_year}</td><td className="text-xs capitalize">{b.release_schedule?.replace('_',' ')}</td><td className="text-xs">{b.release_due_date||'—'}</td><td><span className={`badge ${b.status==='held'?'badge-amber':b.status==='released'?'badge-green':'badge-red'}`}>{b.status}</span></td></tr>))}
            {!bank?.length&&<tr><td colSpan={5} className="text-center py-8" style={{color:'var(--gray-400)'}}>No retention bank entries yet</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><h3>My Loyalty Milestones</h3><span className="badge badge-green">₹15k · ₹30k · ₹50k · ₹1L</span></div>
        <table className="data-table"><thead><tr><th>Joining Date</th><th>Milestone</th><th>Bonus</th><th>Due Date</th><th>Status</th></tr></thead>
          <tbody>{(loyalty||[]).map((m:any)=>(
            <tr key={m.id}><td className="text-xs">{m.joining_date}</td><td><span className="badge badge-purple">{m.milestone_years} Year{m.milestone_years>1?'s':''}</span></td><td className="font-bold" style={{color:'var(--purple)'}}>{fmt(m.bonus_amount)}</td><td className="text-xs">{m.milestone_date}</td><td><span className={`badge ${m.status==='paid'?'badge-green':m.status==='achieved'?'badge-blue':'badge-gray'}`}>{m.status}</span></td></tr>))}
            {!loyalty?.length&&<tr><td colSpan={5} className="text-center py-8" style={{color:'var(--gray-400)'}}>No loyalty milestones recorded yet</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card overflow-hidden">
        <div className="card-header"><h3>My Advanced KPIs — {MONTHS[month]} {year}</h3><span className="badge badge-purple">10 quality metrics</span></div>
        {!myAdv ? (
          <div className="text-center py-8" style={{color:'var(--gray-400)'}}>No advanced KPIs recorded for this period yet.</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table className="data-table"><thead><tr><th>1st Sub (hrs)</th><th>Sub. Accept %</th><th>Interview Ratio</th><th>Offer Ratio</th><th>Joining Ratio</th><th>Offer Drop %</th><th>No-Show %</th><th>Cand. Sat.</th><th>Client Sat.</th><th>90d Retention %</th></tr></thead>
              <tbody><tr>
                <td className="text-sm">{myAdv.time_to_first_sub_hrs ?? '—'}</td>
                <td className="text-sm">{myAdv.submission_acceptance_pct!=null?`${myAdv.submission_acceptance_pct}%`:'—'}</td>
                <td className="text-sm">{myAdv.interview_ratio ?? '—'}</td>
                <td className="text-sm">{myAdv.offer_ratio ?? '—'}</td>
                <td className="text-sm">{myAdv.joining_ratio ?? '—'}</td>
                <td className="text-sm" style={{color:myAdv.offer_drop_rate>20?'var(--red)':undefined}}>{myAdv.offer_drop_rate!=null?`${myAdv.offer_drop_rate}%`:'—'}</td>
                <td className="text-sm" style={{color:myAdv.no_show_pct>10?'var(--red)':undefined}}>{myAdv.no_show_pct!=null?`${myAdv.no_show_pct}%`:'—'}</td>
                <td className="text-sm">{myAdv.candidate_satisfaction ?? '—'}</td>
                <td className="text-sm">{myAdv.client_satisfaction ?? '—'}</td>
                <td className="text-sm">{myAdv.retention_90day_pct!=null?`${myAdv.retention_90day_pct}%`:'—'}</td>
              </tr></tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NewScorecardForm({ users, month, year, onCreated }: { users: any[]; month: number; year: number; onCreated: () => void }) {
  const [userId, setUserId] = useState('');
  const [joinings, setJoinings] = useState('0');
  const [revenue, setRevenue] = useState('0');
  const [interview, setInterview] = useState('0');
  const [offer, setOffer] = useState('0');
  const [sat, setSat] = useState('0');
  const [ats, setAts] = useState('0');
  const [cm, setCm] = useState('0');
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [err, setErr] = useState('');

  // Workforce Intelligence (2026-08-11): pre-fills the 6 fields below
  // from real placements/interviews/offers/feedback/activity this period
  // — recruiter_kpi_scores itself stays untouched until the manager
  // reviews these and hits "New Scorecard" below, same draft->approved
  // workflow as a fully manual entry.
  async function suggest() {
    if (!userId) return;
    setSuggesting(true); setErr('');
    try {
      const s = await apiFetch(`/incentives/scorecard/suggest?user_id=${userId}&period_month=${month}&period_year=${year}`);
      setJoinings(String(s.joinings_score)); setRevenue(String(s.revenue_score));
      setInterview(String(s.interview_score)); setOffer(String(s.offer_score));
      setSat(String(s.client_sat_score)); setAts(String(s.ats_score));
    } catch (e: any) { setErr(e.message || 'Failed to compute suggestion'); }
    finally { setSuggesting(false); }
  }

  async function submit() {
    if (!userId) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/incentives/scorecard', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId, period_month: month, period_year: year,
          joinings_score: parseFloat(joinings) || 0, revenue_score: parseFloat(revenue) || 0,
          interview_score: parseFloat(interview) || 0, offer_score: parseFloat(offer) || 0,
          client_sat_score: parseFloat(sat) || 0, ats_score: parseFloat(ats) || 0,
          contribution_margin: parseFloat(cm) || 0,
        }),
      });
      setUserId(''); setJoinings('0'); setRevenue('0'); setInterview('0'); setOffer('0'); setSat('0'); setAts('0'); setCm('0');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to create scorecard'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Recruiter</label>
          <select value={userId} onChange={e => setUserId(e.target.value)} style={{ ...input, minWidth: 200 }}>
            <option value="">Select…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <NumField label="Joinings /35" value={joinings} onChange={setJoinings} />
        <NumField label="Revenue /25" value={revenue} onChange={setRevenue} />
        <NumField label="Interview /10" value={interview} onChange={setInterview} />
        <NumField label="Offer /10" value={offer} onChange={setOffer} />
        <NumField label="Client Sat /10" value={sat} onChange={setSat} />
        <NumField label="ATS /10" value={ats} onChange={setAts} />
        <NumField label="Contribution Margin" value={cm} onChange={setCm} />
        <button onClick={suggest} disabled={!userId || suggesting} className={`${smallBtn} bg-gray-500`} style={{ padding: '7px 14px' }} title="Pre-fill the 6 fields above from real placements/interviews/offers/feedback/activity this period">
          {suggesting ? 'Computing…' : 'Suggest from real data'}
        </button>
        <button onClick={submit} disabled={!userId || busy} className={`${smallBtn} bg-[--color-primary]`} style={{ padding: '7px 14px' }}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Saving…' : 'New Scorecard'}
        </button>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">{label}</label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} style={{ ...input, width: 90 }} />
    </div>
  );
}

function NewAdvancedKpiForm({ users, month, year, onCreated }: { users: any[]; month: number; year: number; onCreated: () => void }) {
  const [userId, setUserId] = useState('');
  const [firstSub, setFirstSub] = useState('');
  const [subAccept, setSubAccept] = useState('');
  const [interviewR, setInterviewR] = useState('');
  const [offerR, setOfferR] = useState('');
  const [joiningR, setJoiningR] = useState('');
  const [offerDrop, setOfferDrop] = useState('');
  const [noShow, setNoShow] = useState('');
  const [candSat, setCandSat] = useState('');
  const [clientSat, setClientSat] = useState('');
  const [retention90, setRetention90] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const num = (v: string) => (v === '' ? null : parseFloat(v));

  async function submit() {
    if (!userId) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/incentives/advanced-kpis', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId, period_month: month, period_year: year,
          time_to_first_sub_hrs: num(firstSub), submission_acceptance_pct: num(subAccept),
          interview_ratio: num(interviewR), offer_ratio: num(offerR), joining_ratio: num(joiningR),
          offer_drop_rate: num(offerDrop), no_show_pct: num(noShow),
          candidate_satisfaction: num(candSat), client_satisfaction: num(clientSat),
          retention_90day_pct: num(retention90),
        }),
      });
      setUserId(''); setFirstSub(''); setSubAccept(''); setInterviewR(''); setOfferR(''); setJoiningR('');
      setOfferDrop(''); setNoShow(''); setCandSat(''); setClientSat(''); setRetention90('');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to save advanced KPIs'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Recruiter</label>
          <select value={userId} onChange={e => setUserId(e.target.value)} style={{ ...input, minWidth: 200 }}>
            <option value="">Select…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <NumField label="1st Sub (hrs)" value={firstSub} onChange={setFirstSub} />
        <NumField label="Sub. Accept %" value={subAccept} onChange={setSubAccept} />
        <NumField label="Interview Ratio" value={interviewR} onChange={setInterviewR} />
        <NumField label="Offer Ratio" value={offerR} onChange={setOfferR} />
        <NumField label="Joining Ratio" value={joiningR} onChange={setJoiningR} />
        <NumField label="Offer Drop %" value={offerDrop} onChange={setOfferDrop} />
        <NumField label="No-Show %" value={noShow} onChange={setNoShow} />
        <NumField label="Cand. Sat." value={candSat} onChange={setCandSat} />
        <NumField label="Client Sat." value={clientSat} onChange={setClientSat} />
        <NumField label="90d Retention %" value={retention90} onChange={setRetention90} />
        <button onClick={submit} disabled={!userId || busy} className={`${smallBtn} bg-[--color-primary]`} style={{ padding: '7px 14px' }}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Saving…' : 'Save Advanced KPIs'}
        </button>
      </div>
      <div className="text-xs mt-2" style={{color:'var(--gray-400)'}}>Leave a field blank to keep its existing value for this recruiter/period — only fields you enter are updated (upsert).</div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}

function NewLoyaltyForm({ users, onCreated }: { users: any[]; onCreated: () => void }) {
  const [userId, setUserId] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!userId || !joiningDate) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/incentives/loyalty/seed', { method: 'POST', body: JSON.stringify({ user_id: userId, joining_date: joiningDate }) });
      setUserId(''); setJoiningDate('');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to seed milestones'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Recruiter</label>
          <select value={userId} onChange={e => setUserId(e.target.value)} style={{ ...input, minWidth: 200 }}>
            <option value="">Select…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Joining Date</label>
          <input type="date" value={joiningDate} onChange={e => setJoiningDate(e.target.value)} style={input} />
        </div>
        <button onClick={submit} disabled={!userId || !joiningDate || busy} className={`${smallBtn} bg-[--color-primary]`} style={{ padding: '7px 14px' }}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Seeding…' : 'Seed Milestones'}
        </button>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}
