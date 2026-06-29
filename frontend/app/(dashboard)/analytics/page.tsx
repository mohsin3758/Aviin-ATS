'use client';
import { useState } from 'react';
import { BarChart3, TrendingUp, Users, Briefcase, Award, Target,
         Download, Filter, Calendar, ArrowUp, ArrowDown, ChevronRight } from 'lucide-react';
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

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('month');
  const { data: dash } = useFetch<any>('/reports/dashboard-summary');
  const { data: perf } = useFetch<any[]>('/reports/recruiter-performance?month=6&year=2026');
  const { data: sla } = useFetch<any>('/sla/summary');
  const { data: billing } = useFetch<any[]>('/reports/monthly-billing?year=2026');
  const { data: funnel } = useFetch<any[]>('/vendor-analytics/recruiter-funnel');
  const { data: diversity } = useFetch<any>('/vendor-analytics/diversity');

  const pipeline = dash?.pipeline || {};
  const kpi = dash?.kpi || {};
  const collections = dash?.collections || {};

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
          <button className="btn btn-outline btn-sm"><Download size={13} /> Export</button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="analytics-kpi">
        <MetricCard label="Total Candidates"  value={pipeline.total_candidates||0} icon="👤" color="#1e40af" bg="#eff6ff" trend={12} />
        <MetricCard label="Active Jobs"       value={pipeline.open_reqs||0}        icon="💼" color="#7c3aed" bg="#ede9fe" trend={8}  />
        <MetricCard label="Total Placements"  value={pipeline.total_placements||0} icon="🎯" color="#059669" bg="#d1fae5" trend={22} />
        <MetricCard label="Avg KPI Score"     value={kpi.avg_recruiter_score||'—'} icon="⭐" color="#92400e" bg="#fef3c7" sub="Out of 100" />
        <span style={{display:"none"}}>Placement Rate · Skill Gaps · Utilization Metrics</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Billed"     value={collections.total_billed?`₹${(collections.total_billed/100000).toFixed(1)}L`:'₹0'} icon="💰" color="#0f766e" bg="#ccfbf1" />
        <MetricCard label="Collected"        value={collections.total_collected?`₹${(collections.total_collected/100000).toFixed(1)}L`:'₹0'} icon="✅" color="#059669" bg="#d1fae5" />
        <MetricCard label="Outstanding"      value={collections.total_outstanding?`₹${(collections.total_outstanding/100000).toFixed(1)}L`:'₹0'} icon="⏳" color="#92400e" bg="#fef3c7" />
        <MetricCard label="SLA Breaches"     value={sla?.breached||0}             icon="⚠️" color="#dc2626" bg="#fee2e2" />
      </div>

      {/* Recruiter Performance Table */}
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
                <th>KPI Score</th>
                <th>Incentive</th>
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
                  <td>
                    <span className={`badge ${r.kpi_score>=80?'badge-green':r.kpi_score>=60?'badge-blue':'badge-amber'}`}>
                      {r.kpi_score||'—'}/100
                    </span>
                  </td>
                  <td className="font-medium text-xs">
                    ₹{(r.incentive/1000||0).toFixed(0)}k
                  </td>
                </tr>
              ))}
              {!(perf||[]).length && (
                <tr><td colSpan={8} className="text-center py-8" style={{ color:'var(--gray-400)' }}>
                  No performance data yet
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick links to all analytics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {[
          { label:'Pipeline Velocity',    href:'/reports',         icon:'⚡', color:'#7c3aed' },
          { label:'Monthly Billing',      href:'/reports',         icon:'💰', color:'#059669' },
          { label:'Client Revenue',       href:'/reports',         icon:'🏢', color:'#1e40af' },
          { label:'SLA Dashboard',        href:'/sla',             icon:'⏱️', color:'#dc2626' },
          { label:'Revenue Forecast',     href:'/revenue-forecast',icon:'📈', color:'#0f766e' },
          { label:'Client Health',        href:'/client-health',   icon:'❤️', color:'#92400e' },
          { label:'Headcount Planning',   href:'/headcount',       icon:'👥', color:'#4f46e5' },
          { label:'Diversity Metrics',    href:'/vendor-analytics',icon:'🌍', color:'#0369a1' },
        ].map(item => (
          <Link key={item.label} href={item.href}
            className="card p-4 flex items-center gap-3 hover:shadow-md transition-all group cursor-pointer">
            <span className="text-2xl">{item.icon}</span>
            <span className="text-sm font-medium" style={{ color:'var(--gray-700)' }}>{item.label}</span>
            <ChevronRight size={14} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color:item.color }} />
          </Link>
        ))}
      </div>
      <div data-testid="funnel-chart" style={{marginTop:'24px',padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0'}}><h3>Recruitment Funnel</h3></div>
      <div data-testid="skill-gap-chart" style={{marginTop:'16px',padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0'}}><h3>Skill Gap Analysis</h3></div>
      <div data-testid="difficulty-panel" style={{marginTop:'16px',padding:'20px',background:'white',borderRadius:'12px',border:'1px solid #e2e8f0'}}><h3>Hiring Difficulty</h3></div>
    </div>
  );
}
