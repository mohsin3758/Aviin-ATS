'use client';
import { useState } from 'react';
import { DollarSign, TrendingUp, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const pct=(n:any)=>n!=null?`${Number(n).toFixed(1)}%`:'—';
export default function AccountPlPage() {
  const [m,setM]=useState(new Date().getMonth()+1);
  const [y,setY]=useState(new Date().getFullYear());
  const qs=`?month=${m}&year=${y}`;
  const {data:summary}=useFetch<any>(`/account-pl/summary${qs}`);
  const {data:accounts}=useFetch<any[]>(`/account-pl${qs}`);
  const {data:bu}=useFetch<any[]>('/bu-tracker');
  const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return (
    <div data-testid="account-pl-page" className="anim-fade-up space-y-6">
      <div className="page-hero">
        <div className="relative z-10 flex items-start justify-between">
          <div><h1 className="text-white text-2xl font-bold mb-1">💼 Account P&L</h1><p className="text-blue-200 text-sm">Revenue · 80% Delivery Pool · Contribution Margin engine · BU eligibility</p></div>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['🏢','Accounts',summary?.account_count||0,'#1e40af','#eff6ff'],['💰','Total Revenue',fmt(summary?.total_revenue),'#059669','#d1fae5'],['📊','Total CM',fmt(summary?.total_cm),'#7c3aed','#ede9fe'],['⚠️','Loss Making',summary?.loss_making_accounts||0,'#dc2626','#fee2e2']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="card-header"><h3>Account P&L — {MONTHS[m]} {y}</h3><span className="badge badge-blue">CM = Revenue − Delivery − Incentives − OpCost</span></div>
        <table className="data-table"><thead><tr><th>Client</th><th>Revenue</th><th>Delivery Pool (80%)</th><th>CM</th><th>CM%</th><th>Fill Rate</th><th>Status</th></tr></thead>
          <tbody>{(accounts||[]).map((a:any)=>(
            <tr key={a.id}><td className="font-medium text-sm">{a.client_name||'—'}</td><td className="font-semibold">{fmt(a.gross_revenue)}</td><td className="text-sm" style={{color:'var(--gray-600)'}}>{fmt(a.delivery_pool)}</td>
              <td><span className={`font-bold text-sm ${a.contribution_margin>=0?'text-green-700':'text-red-600'}`}>{fmt(a.contribution_margin)}</span></td>
              <td><span className={`badge ${a.cm_pct>=20?'badge-green':a.cm_pct>=10?'badge-amber':'badge-red'}`}>{pct(a.cm_pct)}</span></td>
              <td className="text-sm">{pct(a.fill_rate_pct)}</td>
              <td>{a.is_finalized?<span className="badge badge-green flex items-center gap-1"><CheckCircle2 size={10}/>Finalized</span>:<span className="badge badge-gray">Draft</span>}</td>
            </tr>))}
            {!accounts?.length&&<tr><td colSpan={7} className="text-center py-8" style={{color:'var(--gray-400)'}}>No P&L data. Add account records above.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card overflow-hidden">
        <div className="card-header"><h3>BU Eligibility Tracker</h3></div>
        <table className="data-table"><thead><tr><th>Client</th><th>Min Monthly Rev</th><th>Min CM%</th><th>Months Active</th><th>Eligible</th><th>BU Created</th></tr></thead>
          <tbody>{(bu||[]).map((b:any)=>(
            <tr key={b.id}><td className="font-medium text-sm">{b.client_name}</td><td>{fmt(b.min_monthly_revenue)}</td><td>{b.min_cm_pct}%</td><td>{b.months_active}</td>
              <td>{b.is_eligible?<span className="badge badge-green">✓ Eligible</span>:<span className="badge badge-gray">Not yet</span>}</td>
              <td>{b.bu_created?<span className="badge badge-purple">✓ Created</span>:<span className="badge badge-gray">Pending</span>}</td>
            </tr>))}
            {!bu?.length&&<tr><td colSpan={6} className="text-center py-8" style={{color:'var(--gray-400)'}}>No BU tracker data</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
