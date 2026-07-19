'use client';
import { useState } from 'react';
import { BarChart3, TrendingUp, Users, Briefcase, Award, Target,
         Download, Filter, Calendar, ArrowUp, ArrowDown, ChevronRight,
         Clock, CheckCircle, XCircle, Activity } from 'lucide-react';
import { useFetch } from '@/lib/useFetch';
import Link from 'next/link';

function MetricCard({ label, value, icon, color, bg, trend, sub }: any) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background:bg }}>{icon}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="text-xs mt-1" style={{ color:'var(--gray-400)' }}>{sub}</div>}
      {trend !== undefined && (
        <div className="stat-trend" style={{ color:trend>=0?'#10b981':'#ef4444' }}>
          {trend >= 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          <span>{Math.abs(trend)}% vs last month</span>
        </div>
      )}
    </div>
  );
}

const STAGE_LABELS: Record<string,string> = {
  sourced:'Sourced', contacted:'Contacted', interested:'Interested',
  nda:'NDA', screened:'Screened', submitted:'Submitted',
  l1_interview:'L1 Interview', l2_interview:'L2 Interview',
  offer:'Offer', offer_accepted:'Offer Accepted', placed:'Placed',
};
const STAGE_COLORS: Record<string,string> = {
  sourced:'#6366f1', contacted:'#8b5cf6', interested:'#a78bfa',
  nda:'#c4b5fd', screened:'#3b82f6', submitted:'#0ea5e9',
  l1_interview:'#06b6d4', l2_interview:'#14b8a6',
  offer:'#f59e0b', offer_accepted:'#22c55e', placed:'#16a34a',
};
const SOURCE_COLORS = ['#6366f1','#3b82f6','#0ea5e9','#14b8a6','#22c55e','#f59e0b','#ef4444','#8b5cf6'];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('month');
  const { data: dash } = useFetch<any>('/reports/dashboard-summary');
  const { data: perf } = useFetch<any[]>('/reports/recruiter-performance?month=6&year=2026');
  const { data: funnel } = useFetch<any>('/analytics/hiring-funnel');
  const { data: sources } = useFetch<any[]>('/analytics/source-breakdown');
  const { data: tth } = useFetch<any>('/analytics/time-to-hire?days=90');
  const { data: velocity } = useFetch<any>('/analytics/stage-velocity');

  const pipeline = dash?.pipeline || {};
  const kpi = dash?.kpi || {};
  const collections = dash?.collections || {};
  const funnelData: any[] = funnel?.funnel || [];
  const maxCount = Math.max(...funnelData.map((s:any) => s.count), 1);

  return (
    <div className="anim-fade-up space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Analytics & Reporting</h1>
          <p className="text-sm mt-0.5" style={{ color:'var(--gray-500)' }}>
            Real-time insights across all recruitment activities
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor:'var(--gray-200)' }}>
            {['week','month','quarter','year'].map(p => (
              <button key={p} onClick={()=>setPeriod(p)}
                className="px-3 py-1.5 text-xs capitalize transition-colors"
                style={{ background:period===p?'var(--primary)':'', color:period===p?'white':'var(--gray-600)', borderRight:'1px solid var(--gray-200)' }}>
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const token = localStorage.getItem('ats_token') || '';
              const API = process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviinjobs.com/api';
              fetch(API + '/export/candidates', { headers: { Authorization: 'Bearer ' + token } })
                .then(r => r.blob()).then(b => {
                  const a = document.createElement('a'); a.href = URL.createObjectURL(b);
                  a.download = 'candidates_export.xlsx'; a.click();
                });
            }}
            className="btn btn-outline btn-sm" style={{cursor:'pointer'}}><Download size={13} /> Export Candidates</button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="analytics-kpi">
        <MetricCard label="Total Candidates"  value={pipeline.total_candidates?.toLocaleString()||0} icon="👤" color="#1e40af" bg="#eff6ff" />
        <MetricCard label="Open Jobs"         value={velocity?.open_requisitions||0}  icon="💼" color="#7c3aed" bg="#ede9fe" />
        <MetricCard label="Total Placements"  value={pipeline.total_placements||0}    icon="🎯" color="#059669" bg="#d1fae5" />
        <MetricCard label="Interviews Today"  value={velocity?.interviews_today||0}   icon="📅" color="#0f766e" bg="#ccfbf1" sub="Scheduled" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Avg Days to Hire" value={tth?.avg_days_to_hire ? `${tth.avg_days_to_hire}d` : '—'} icon="⏱️" color="#92400e" bg="#fef3c7" sub="Last 90 days" />
        <MetricCard label="Placed (90d)"     value={tth?.total_placed||0}          icon="✅" color="#059669" bg="#d1fae5" />
        <MetricCard label="Offers Pending"   value={velocity?.offers_pending||0}   icon="📋" color="#dc2626" bg="#fee2e2" />
        <MetricCard label="Active Pipeline"  value={funnel?.total_active||0}       icon="⚡" color="#4f46e5" bg="#ede9fe" sub="Excl. placed/rejected" />
      </div>

      {/* Hiring Funnel */}
      <div className="card" data-testid="funnel-chart">
        <div className="card-header">
          <h3 className="flex items-center gap-2">
            <Target size={16} style={{ color:'var(--primary)' }} />
            Hiring Funnel
          </h3>
          <div className="flex gap-3 text-xs" style={{ color:'var(--gray-500)' }}>
            <span>🔴 Rejected: {funnel?.rejected||0}</span>
            <span>🟡 On Hold: {funnel?.hold||0}</span>
          </div>
        </div>
        <div className="space-y-2 p-2">
          {funnelData.map((stage:any) => (
            <div key={stage.stage} className="flex items-center gap-3">
              <div className="text-xs font-medium w-28 shrink-0" style={{ color:'var(--gray-600)' }}>
                {STAGE_LABELS[stage.stage] || stage.stage}
              </div>
              <div className="flex-1 relative h-7 rounded-md overflow-hidden" style={{ background:'var(--gray-100)' }}>
                <div className="h-full rounded-md transition-all duration-500 flex items-center pl-2"
                     style={{
                       width: `${Math.max((stage.count/maxCount)*100, 2)}%`,
                       background: STAGE_COLORS[stage.stage] || '#6366f1',
                       minWidth: stage.count > 0 ? '2rem' : '0'
                     }}>
                  {stage.count > 0 && (
                    <span className="text-white text-xs font-bold">{stage.count}</span>
                  )}
                </div>
              </div>
              <div className="text-xs w-12 text-right shrink-0" style={{ color:'var(--gray-500)' }}>
                {stage.conversion_pct}%
              </div>
            </div>
          ))}
          {!funnelData.length && (
            <p className="text-center py-6 text-sm" style={{ color:'var(--gray-400)' }}>No application data yet</p>
          )}
        </div>
      </div>

      {/* Source Breakdown + Time-to-Hire side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Source Breakdown */}
        <div className="card" data-testid="skill-gap-chart">
          <div className="card-header">
            <h3 className="flex items-center gap-2">
              <BarChart3 size={16} style={{ color:'var(--primary)' }} />
              Candidate Sources
            </h3>
          </div>
          <div className="p-2 space-y-2">
            {(sources||[]).slice(0,8).map((s:any, i:number) => {
              const maxCands = Math.max(...(sources||[]).map((x:any)=>x.total_candidates), 1);
              return (
                <div key={s.source} className="flex items-center gap-2">
                  <div className="w-20 text-xs shrink-0 capitalize" style={{ color:'var(--gray-600)' }}>{s.source}</div>
                  <div className="flex-1 h-6 rounded overflow-hidden" style={{ background:'var(--gray-100)' }}>
                    <div className="h-full flex items-center px-2 text-white text-xs font-semibold rounded transition-all"
                         style={{ width:`${Math.max((s.total_candidates/maxCands)*100,4)}%`, background:SOURCE_COLORS[i%SOURCE_COLORS.length] }}>
                      {s.total_candidates}
                    </div>
                  </div>
                  <div className="text-xs w-14 text-right shrink-0" style={{ color:'var(--gray-500)' }}>
                    {s.placement_rate}% placed
                  </div>
                </div>
              );
            })}
            {!(sources||[]).length && (
              <p className="text-center py-6 text-sm" style={{ color:'var(--gray-400)' }}>No source data yet</p>
            )}
          </div>
        </div>

        {/* Time-to-Hire by Requisition */}
        <div className="card" data-testid="difficulty-panel">
          <div className="card-header">
            <h3 className="flex items-center gap-2">
              <Clock size={16} style={{ color:'var(--primary)' }} />
              Time-to-Hire by Role
            </h3>
            <span className="text-xs" style={{ color:'var(--gray-400)' }}>Last 90 days</span>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th style={{ textAlign:'right' }}>Placed</th>
                  <th style={{ textAlign:'right' }}>Avg Days</th>
                </tr>
              </thead>
              <tbody>
                {(tth?.by_requisition||[]).slice(0,8).map((r:any) => (
                  <tr key={r.title}>
                    <td className="text-sm">{r.title}</td>
                    <td className="text-right">
                      <span className="badge badge-green">{r.placed_count}</span>
                    </td>
                    <td className="text-right">
                      <span className={`text-xs font-semibold ${r.avg_days > 30 ? 'text-red-500' : r.avg_days > 15 ? 'text-yellow-600' : 'text-green-600'}`}>
                        {r.avg_days}d
                      </span>
                    </td>
                  </tr>
                ))}
                {!(tth?.by_requisition||[]).length && (
                  <tr><td colSpan={3} className="text-center py-6 text-sm" style={{ color:'var(--gray-400)' }}>
                    No placements in last 90 days
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Monthly Trend */}
      {(tth?.monthly_trend||[]).length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="flex items-center gap-2">
              <TrendingUp size={16} style={{ color:'var(--primary)' }} />
              Monthly Placements & Avg Days-to-Hire
            </h3>
          </div>
          <div className="overflow-x-auto p-2">
            <div className="flex items-end gap-2 h-28">
              {(tth?.monthly_trend||[]).map((m:any) => {
                const maxP = Math.max(...(tth?.monthly_trend||[]).map((x:any)=>x.placements), 1);
                const ht = Math.max((m.placements/maxP)*100, 4);
                return (
                  <div key={m.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                    <span className="text-xs font-semibold" style={{ color:'#1e40af' }}>{m.placements}</span>
                    <div className="w-full rounded-t transition-all" title={`${m.avg_days}d avg`}
                         style={{ height:`${ht}%`, background:`#6366f1`, opacity:0.85 }} />
                    <span className="text-xs truncate w-full text-center" style={{ color:'var(--gray-400)', fontSize:'10px' }}>
                      {m.month?.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Recruiter Performance */}
      <div className="card">
        <div className="card-header">
          <h3 className="flex items-center gap-2">
            <Users size={16} style={{ color:'var(--primary)' }} />
            Recruiter Performance
          </h3>
          <Link href="/reports" className="btn btn-ghost btn-sm">
            Full Report <ChevronRight size={13} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Recruiter</th>
                <th>Submissions</th>
                <th>Interviews</th>
                <th>Offers</th>
                <th>Placements</th>
                <th>Conversion</th>
              </tr>
            </thead>
            <tbody>
              {(perf||[]).slice(0,8).map((r:any) => (
                <tr key={r.email}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="avatar avatar-sm" style={{ background:'var(--primary)' }}>
                        {r.recruiter?.split(' ').map((n:string)=>n[0]).join('').slice(0,2)||'?'}
                      </div>
                      <div>
                        <div className="font-medium text-sm">{r.recruiter||'—'}</div>
                        <div className="text-xs" style={{ color:'var(--gray-400)' }}>{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="font-semibold">{r.total_submissions||0}</td>
                  <td>{r.interviews||0}</td>
                  <td>{r.offers||0}</td>
                  <td><span className="badge badge-green">{r.placements||0}</span></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="progress-bar flex-1" style={{ height:'5px' }}>
                        <div className="progress-fill" style={{ width:`${r.conversion_rate||0}%`, background:'var(--accent)' }} />
                      </div>
                      <span className="text-xs">{r.conversion_rate||0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {!(perf||[]).length && (
                <tr><td colSpan={6} className="text-center py-8" style={{ color:'var(--gray-400)' }}>
                  No performance data yet
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label:'Pipeline Velocity',    href:'/reports',         icon:'⚡' },
          { label:'Revenue Forecast',     href:'/revenue-forecast',icon:'📈' },
          { label:'Client Health',        href:'/client-health',   icon:'❤️' },
          { label:'Headcount Planning',   href:'/headcount',       icon:'👥' },
        ].map(item => (
          <Link key={item.label} href={item.href}
            className="card p-4 flex items-center gap-3 hover:shadow-md transition-all group cursor-pointer">
            <span className="text-2xl">{item.icon}</span>
            <span className="text-sm font-medium" style={{ color:'var(--gray-700)' }}>{item.label}</span>
            <ChevronRight size={14} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color:'var(--primary)' }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
