'use client';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useFetch } from '@/lib/useFetch';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export default function RevenueForecastPage() {
  const {data:fc}=useFetch<any>('/revenue-forecast?months_ahead=6');
  const hist=fc?.historical||[]; const fore=fc?.forecast||[];
  const maxVal=Math.max(...[...hist.map((h:any)=>h.revenue),...fore.map((f:any)=>f.predicted_revenue)].filter(Boolean),1);
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#0f172a,#1e3a8a,#2563eb)'}}>
        <div className="relative z-10"><h1 className="text-white text-2xl font-bold mb-1">📈 Revenue Forecast</h1><p className="text-blue-200 text-sm">Linear regression · Local ML · Zero external API · Based on placement history</p></div>
      </div>
      {fc?.message ? (
        <div className="card"><div className="empty-state"><div className="empty-icon">📊</div><h3>Insufficient Data</h3><p>{fc.message}</p></div></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="stat-card text-center"><div className="stat-icon mx-auto" style={{background:fc?.trend==='upward'?'#d1fae5':'#fee2e2'}}>{fc?.trend==='upward'?'📈':'📉'}</div><div className="stat-value" style={{color:fc?.trend==='upward'?'var(--accent)':'var(--red)'}}>{fc?.trend==='upward'?'Upward':'Downward'}</div><div className="stat-label">Revenue Trend</div></div>
            <div className="stat-card text-center"><div className="stat-icon mx-auto" style={{background:'#eff6ff'}}>{fmt(fc?.monthly_growth)}</div><div className="stat-value" style={{color:'var(--primary)'}}>{fmt(fc?.monthly_growth)}</div><div className="stat-label">Monthly Growth</div></div>
            <div className="stat-card text-center"><div className="stat-icon mx-auto" style={{background:'#ede9fe'}}>🤖</div><div className="stat-value" style={{color:'var(--purple)'}}>{fc?.model}</div><div className="stat-label">ML Model</div></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card"><div className="card-header"><h3>Historical</h3></div><div className="card-body space-y-3">
              {hist.map((h:any)=>(
                <div key={`${h.month}-${h.year}`} className="flex items-center gap-3">
                  <div className="text-xs w-20 font-medium" style={{color:'var(--gray-500)'}}>{MONTHS[h.month]} {h.year}</div>
                  <div className="flex-1 progress-bar" style={{height:'8px'}}><div className="progress-fill" style={{width:`${(h.revenue/maxVal)*100}%`,background:'var(--primary)'}}/></div>
                  <div className="text-xs font-semibold w-24 text-right" style={{color:'var(--primary)'}}>{fmt(h.revenue)}</div>
                </div>
              ))}
            </div></div>
            <div className="card"><div className="card-header"><h3>6-Month Forecast</h3><span className="badge badge-purple">ML Predicted</span></div><div className="card-body space-y-3">
              {fore.map((f:any)=>(
                <div key={`${f.month}-${f.year}`} className="flex items-center gap-3">
                  <div className="text-xs w-20 font-medium" style={{color:'var(--gray-500)'}}>{MONTHS[f.month]} {f.year}</div>
                  <div className="flex-1 progress-bar" style={{height:'8px'}}><div className="progress-fill" style={{width:`${(f.predicted_revenue/maxVal)*100}%`,background:'var(--purple)',opacity:0.7}}/></div>
                  <div className="text-xs font-semibold w-24 text-right" style={{color:'var(--purple)'}}>{fmt(f.predicted_revenue)}</div>
                  <div className="text-xs w-12" style={{color:'var(--gray-400)'}}>{f.confidence_pct}%</div>
                </div>
              ))}
            </div></div>
          </div>
        </>
      )}
    </div>
  );
}
