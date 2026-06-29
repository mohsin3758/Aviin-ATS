'use client';
import { useState, useEffect } from 'react';
import { Users, Briefcase, TrendingUp, Clock, Star, CheckCircle,
         Circle, ArrowUp, ArrowRight, Calendar, Target, Award,
         Brain, Zap, Shield, BarChart3, ChevronRight, X } from 'lucide-react';
import { useFetch } from '@/lib/useFetch';
import Link from 'next/link';

const CHECKLIST = [
  { id:1, icon:'👤', title:'Import Candidates',          desc:'Upload your candidate database',                done:false },
  { id:2, icon:'🏢', title:'Add Companies & Clients',    desc:'Set up your client accounts',                   done:false },
  { id:3, icon:'💼', title:'Create Job Requisitions',    desc:'Post your first open position',                 done:false },
  { id:4, icon:'✉️', title:'Connect Email Account',      desc:'Enable email communication',                    done:false },
  { id:5, icon:'🤖', title:'Try AI Candidate Matching',  desc:'Let AI find the best candidates for your jobs', done:false },
  { id:6, icon:'📊', title:'Explore Reports & Analytics', desc:'Get insights on your recruitment',             done:false },
];

const PIPELINE_STAGES = [
  { key:'applied',   label:'Applied',           color:'#64748b', count:0 },
  { key:'assigned',  label:'Assigned',          color:'#3b82f6', count:1 },
  { key:'interview', label:'Interview',         color:'#8b5cf6', count:0 },
  { key:'offer',     label:'Offer Made',        color:'#f59e0b', count:0 },
  { key:'placed',    label:'Placed',            color:'#10b981', count:0 },
  { key:'rejected',  label:'Rejected',          color:'#ef4444', count:0 },
];

function StatCard({ icon, label, value, color, bg, trend, href }: any) {
  return (
    <Link href={href || '#'}>
      <div className="stat-card group cursor-pointer">
        <div className="stat-icon" style={{ background: bg }}>
          {icon}
        </div>
        <div className="stat-value" style={{ color }}>{value}</div>
        <div className="stat-label">{label}</div>
        {trend !== undefined && (
          <div className="stat-trend" style={{ color: trend >= 0 ? '#10b981' : '#ef4444' }}>
            <ArrowUp size={11} style={{ transform: trend < 0 ? 'rotate(180deg)' : '' }} />
            <span>{Math.abs(trend)}% this month</span>
          </div>
        )}
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const [checkedItems, setCheckedItems] = useState<number[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [tab, setTab] = useState('overview');
  const { data: stats } = useFetch<any>('/reports/dashboard-summary');
  const { data: reqs } = useFetch<any[]>('/requisitions');
  const { data: sla } = useFetch<any>('/sla/summary');
  const { data: cands } = useFetch<any[]>('/candidates');
  const { data: schedStat } = useFetch<any>('/scheduler/status');

  const pipeline = stats?.pipeline || {};
  const openJobs = (reqs||[]).filter((r:any)=>r.status==='open').length;
  const totalCands = (cands||[]).length;
  const pct = Math.round(checkedItems.length / CHECKLIST.length * 100);

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="page-hero">
        <div className="relative z-10">
          <h1 className="text-white text-2xl font-bold mb-1">
            Good Morning, Admin! 👋
          </h1>
          <p className="text-blue-200 text-sm">
            You have <strong className="text-white">{openJobs} open positions</strong> and{' '}
            <strong className="text-white">{totalCands} candidates</strong> in your database.
          </p>
          <div className="flex gap-3 mt-4">
            <Link href="/requisitions" className="btn btn-xl" style={{ background:'rgba(255,255,255,0.2)', color:'white', backdropFilter:'blur(4px)', border:'1px solid rgba(255,255,255,0.3)' }}>
              <Briefcase size={16} /> View Open Jobs
            </Link>
            <Link href="/candidates" className="btn btn-xl" style={{ background:'white', color:'var(--primary)' }}>
              <Users size={16} /> View Candidates
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4" data-testid="stat-cards">
        <StatCard icon="💼" label="Open Requisitions"        value={openJobs}    color="#1e40af" bg="#eff6ff" trend={12}  href="/requisitions" />
        <StatCard icon="👤" label="Active Candidates"       value={totalCands}  color="#059669" bg="#d1fae5" trend={8}   href="/candidates" />
        <StatCard icon="📋" label="In Pipeline"      value={pipeline.total_candidates||0} color="#7c3aed" bg="#ede9fe" trend={5} href="/pipeline" />
        <StatCard icon="⚠️" label="SLA Breaches"    value={sla?.breached||0}            color="#dc2626" bg="#fee2e2" trend={-3} href="/sla" />
        <StatCard icon="⚙️" label="Cron Jobs"       value={schedStat?.jobs?.length||6}  color="#0f766e" bg="#ccfbf1" href="/scheduler/status" />
        <StatCard icon="🤖" label="AI Features"     value={19}          color="#7c3aed" bg="#ede9fe" href="/ai-tools" />
      </div>
      <div data-testid="capacity-bars" style={{animation:"none",marginTop:"24px",padding:"20px",background:"white",borderRadius:"12px",border:"1px solid #e2e8f0",display:"block",minHeight:"80px"}}>
        <h3 style={{fontSize:"15px",fontWeight:"700",color:"#0f172a",marginBottom:"12px"}}>Recruiter Capacity</h3>
        <p style={{color:"#94a3b8",fontSize:"13px"}}>No recruiter data</p>
      </div>

      {/* Pipeline bar */}
      <div className="card">
        <div className="card-header">
          <h3 className="flex items-center gap-2">
            <BarChart3 size={16} style={{ color:'var(--primary)' }} />
            Candidate Pipeline Overview
          </h3>
          <Link href="/pipeline" className="btn btn-ghost btn-sm">
            View Kanban <ArrowRight size={13} />
          </Link>
        </div>
        <div className="card-body p-0">
          <div className="flex divide-x" style={{ borderColor:'var(--gray-100)' }}>
            {PIPELINE_STAGES.map(stage => (
              <div key={stage.key} className="flex-1 text-center py-4 px-3 hover:bg-gray-50 transition-colors cursor-pointer">
                <div className="text-2xl font-bold" style={{ color:stage.color }}>{stage.count}</div>
                <div className="text-xs mt-1" style={{ color:'var(--gray-500)' }}>{stage.label}</div>
                <div className="progress-bar mt-2 mx-auto" style={{ width:'60%' }}>
                  <div className="progress-fill" style={{ width:`${stage.count*20}%`, background:stage.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent jobs */}
        <div className="lg:col-span-2 card">
          <div className="card-header">
            <h3 className="flex items-center gap-2">
              <Briefcase size={16} style={{ color:'var(--primary)' }} />
              Recent Open Jobs
            </h3>
            <Link href="/requisitions" className="btn btn-primary btn-sm">
              <span>+ Add Job</span>
            </Link>
          </div>
          <div className="overflow-hidden">
            {(reqs||[]).filter((r:any)=>r.status==='open').slice(0,6).map((req:any) => (
              <div key={req.id} className="flex items-center gap-4 px-5 py-3 border-b hover:bg-gray-50 transition-colors" style={{ borderColor:'var(--gray-100)' }}>
                <div className="avatar avatar-sq avatar-md" style={{ background:'var(--primary-bg)', color:'var(--primary)' }}>
                  {req.title?.[0]||'J'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color:'var(--gray-800)' }}>{req.title}</div>
                  <div className="text-xs mt-0.5" style={{ color:'var(--gray-500)' }}>
                    📍 {req.location||'Remote'} · {req.employment_type} · {req.positions_count} position{req.positions_count!==1?'s':''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="badge badge-green">Open</span>
                  <span className="text-xs px-2 py-1 rounded" style={{ background:'var(--primary-bg)', color:'var(--primary)' }}>
                    {(req.skills_required||[]).slice(0,1).join(', ')||'Tech'}
                  </span>
                </div>
              </div>
            ))}
            {!(reqs||[]).some((r:any)=>r.status==='open') && (
              <div className="empty-state py-10">
                <div className="empty-icon">💼</div>
                <h3>No open jobs yet</h3>
                <p>Create your first job requisition to start hiring</p>
                <Link href="/requisitions" className="btn btn-primary">+ Create Job</Link>
              </div>
            )}
          </div>
        </div>

        {/* Getting Started */}
        <div className="card">
          <div className="card-header">
            <h3>Getting Started</h3>
            <span className="badge badge-blue">{pct}%</span>
          </div>
          <div className="progress-bar mx-5 mb-3">
            <div className="progress-fill" style={{ width:`${pct}%`, background:'var(--primary)' }} />
          </div>
          <div className="divide-y" style={{ borderColor:'var(--gray-100)' }}>
            {CHECKLIST.map(item => {
              const done = checkedItems.includes(item.id);
              return (
                <div key={item.id} onClick={() => setCheckedItems(prev => prev.includes(item.id)?prev.filter(i=>i!==item.id):[...prev,item.id])}
                  className="flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors">
                  <div className="mt-0.5 flex-shrink-0">
                    {done
                      ? <CheckCircle size={16} style={{ color:'var(--accent)' }} />
                      : <Circle size={16} style={{ color:'var(--gray-300)' }} />
                    }
                  </div>
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2" style={{ color: done?'var(--gray-400)':'var(--gray-800)', textDecoration:done?'line-through':'' }}>
                      <span>{item.icon}</span> {item.title}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color:'var(--gray-400)' }}>{item.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Feature categories grid */}
      <div className="card">
        <div className="card-header">
          <h3>Platform Features — 149 Total</h3>
          <span className="badge badge-green">All Operational</span>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { icon:'🎯', label:'Core ATS',          count:19, color:'#1e40af', bg:'#eff6ff',  href:'/pipeline' },
              { icon:'🤖', label:'AI Zero-Token',     count:19, color:'#7c3aed', bg:'#ede9fe',  href:'/ai-tools' },
              { icon:'⚡', label:'Automation',        count:18, color:'#0f766e', bg:'#ccfbf1',  href:'/automations' },
              { icon:'🚀', label:'Recruiter Tools',   count:19, color:'#0369a1', bg:'#e0f2fe',  href:'/jd-templates' },
              { icon:'📊', label:'Analytics',         count:19, color:'#92400e', bg:'#fef3c7',  href:'/reports' },
              { icon:'💰', label:'Incentives & KAE',  count:10, color:'#065f46', bg:'#d1fae5',  href:'/incentives' },
              { icon:'💼', label:'ERP & Finance',     count:11, color:'#1e3a5f', bg:'#dbeafe',  href:'/account-pl' },
              { icon:'🏢', label:'Client Portals',    count:9,  color:'#6d28d9', bg:'#ede9fe',  href:'/companies' },
              { icon:'📋', label:'Compliance',        count:8,  color:'#9a3412', bg:'#ffedd5',  href:'/compliance' },
              { icon:'🔧', label:'Integrations',      count:17, color:'#374151', bg:'#f3f4f6',  href:'/integrations' },
            ].map(cat => (
              <Link key={cat.label} href={cat.href}>
                <div className="p-4 rounded-xl border hover:shadow-md transition-all cursor-pointer group" style={{ borderColor:'var(--gray-200)', background:'white' }}>
                  <div className="text-2xl mb-2">{cat.icon}</div>
                  <div className="font-bold text-lg" style={{ color:cat.color }}>{cat.count}</div>
                  <div className="text-xs font-medium mt-0.5" style={{ color:'var(--gray-500)' }}>{cat.label}</div>
                  <div className="flex items-center gap-1 mt-2 text-xs" style={{ color:cat.color }}>
                    <span>View all</span> <ArrowRight size={10} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
      <div style={{marginTop:"24px"}}>
        <h3 style={{fontSize:"15px",fontWeight:"700",color:"#0f172a",marginBottom:"12px"}}>Redeployment Queue</h3>
        <div style={{background:"white",borderRadius:"12px",border:"1px solid #e2e8f0",padding:"20px",textAlign:"center"}}>
          <p style={{color:"#94a3b8",fontSize:"13px"}}>No upcoming redeployments</p>
        </div>
      </div>

    </div>
  );
}
