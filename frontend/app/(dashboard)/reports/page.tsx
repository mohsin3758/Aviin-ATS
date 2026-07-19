'use client';
import { useState } from 'react';
import { useFetch } from '@/lib/useFetch';
import { BarChart3, TrendingUp, Users, Briefcase, Award, Target, Clock, AlertCircle } from 'lucide-react';

const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = (n: any) => n != null ? new Intl.NumberFormat('en-IN', { style:'currency', currency:'INR', maximumFractionDigits:0 }).format(n) : '—';
const pct = (n: any) => n != null ? `${Number(n).toFixed(1)}%` : '—';

const GRADE_CFG: Record<string,{bg:string,color:string}> = {
  'A+': {bg:'#d1fae5', color:'#059669'},
  'A':  {bg:'#d1fae5', color:'#10b981'},
  'B':  {bg:'#dbeafe', color:'#3b82f6'},
  'C':  {bg:'#fef3c7', color:'#f59e0b'},
  'D':  {bg:'#fee2e2', color:'#ef4444'},
};

const STAGE_ORDER = ['applied','screening','interview','offer','hired','rejected'];
const STAGE_COLORS: Record<string,string> = {
  applied:'#6366f1', screening:'#0ea5e9', interview:'#f59e0b',
  offer:'#8b5cf6', hired:'#22c55e', rejected:'#ef4444',
};

function BarChart({ rows, keyX, keyY, color = '#1e40af' }: any) {
  if (!rows?.length) return <p style={{color:'#94a3b8',fontSize:'13px',textAlign:'center',padding:'20px'}}>No data</p>;
  const max = Math.max(...rows.map((r: any) => Number(r[keyY]) || 0), 1);
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:'8px',height:'120px',padding:'0 4px'}}>
      {rows.map((r: any, i: number) => {
        const v = Number(r[keyY]) || 0;
        const h = Math.round((v / max) * 100);
        return (
          <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:'4px',minWidth:0}}>
            <span style={{fontSize:'10px',color:'#64748b',fontWeight:'600'}}>{v}</span>
            <div style={{width:'100%',background:color,borderRadius:'4px 4px 0 0',height:`${h}%`,minHeight:'4px',transition:'height 0.3s'}}/>
            <span style={{fontSize:'9px',color:'#94a3b8',textAlign:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',width:'100%'}}>
              {String(r[keyX]).slice(0,8)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color = '#1e40af' }: any) {
  return (
    <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px',display:'flex',alignItems:'center',gap:'16px'}}>
      <div style={{width:'44px',height:'44px',borderRadius:'10px',background:`${color}15`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
        <Icon size={20} style={{color}}/>
      </div>
      <div>
        <div style={{fontSize:'22px',fontWeight:'800',color:'#0f172a'}}>{value}</div>
        <div style={{fontSize:'12px',color:'#64748b',fontWeight:'500'}}>{label}</div>
        {sub && <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px'}}>{sub}</div>}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState('summary');
  const [m, setM] = useState(new Date().getMonth() + 1);
  const [y, setY] = useState(new Date().getFullYear());

  const { data: summary } = useFetch<any>('/reports/dashboard-summary');
  const { data: recruiter } = useFetch<any[]>(`/reports/recruiter-performance?month=${m}&year=${y}`);
  const { data: pv } = useFetch<any[]>('/reports/pipeline-velocity');
  const { data: clients } = useFetch<any[]>('/reports/client-revenue');

  const recs: any[] = Array.isArray(recruiter) ? recruiter : [];
  const pvRows: any[] = Array.isArray(pv) ? pv.filter((r: any) => STAGE_ORDER.includes(r.stage)) : [];
  const clientRows: any[] = Array.isArray(clients) ? clients : [];

  const TABS = [
    {key:'summary', label:'Summary'},
    {key:'recruiter', label:'Recruiter Leaderboard'},
    {key:'pipeline', label:'Pipeline Velocity'},
    {key:'clients', label:'Client Revenue'},
  ];

  return (
    <div style={{maxWidth:'960px'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'24px',flexWrap:'wrap',gap:'12px'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'800',color:'#0f172a',margin:0}}>Reports & Analytics</h1>
          <p style={{fontSize:'13px',color:'#64748b',marginTop:'4px'}}>Recruiter performance · Pipeline velocity · Client revenue</p>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <select value={m} onChange={e => setM(+e.target.value)}
            style={{padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'13px',outline:'none'}}>
            {Array.from({length:12},(_,i) => i+1).map(mn =>
              <option key={mn} value={mn}>{MONTHS[mn]}</option>)}
          </select>
          <select value={y} onChange={e => setY(+e.target.value)}
            style={{padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:'8px',fontSize:'13px',outline:'none'}}>
            {[2024,2025,2026,2027].map(yr => <option key={yr} value={yr}>{yr}</option>)}
          </select>
          <button onClick={() => {
            const token = localStorage.getItem('ats_token') || '';
            const url = (process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviinjobs.com/api') + '/export/candidates';
            fetch(url, { headers: { Authorization: 'Bearer ' + token } })
              .then(r => r.blob()).then(b => {
                const a = document.createElement('a'); a.href = URL.createObjectURL(b);
                a.download = 'candidates_export.xlsx'; a.click();
              });
          }} style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 14px',background:'#0f172a',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer',whiteSpace:'nowrap'}}>
            ⬇ Export Excel
          </button>
          <button onClick={() => {
            const token = localStorage.getItem('ats_token') || '';
            const url = (process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviinjobs.com/api') + '/export/kpi-report?month=' + m + '&year=' + y;
            fetch(url, { headers: { Authorization: 'Bearer ' + token } })
              .then(r => r.blob()).then(b => {
                const a = document.createElement('a'); a.href = URL.createObjectURL(b);
                a.download = 'kpi_report.xlsx'; a.click();
              });
          }} style={{display:'flex',alignItems:'center',gap:'5px',padding:'8px 14px',background:'#1e40af',color:'white',border:'none',borderRadius:'8px',fontSize:'13px',fontWeight:'600',cursor:'pointer',whiteSpace:'nowrap'}}>
            📊 KPI Report
          </button>
        </div>
      </div>

      {/* KPI row — always visible */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'14px',marginBottom:'24px'}}>
        <KpiCard icon={Users}     label="Total Candidates" value={summary?.total_candidates ?? '—'} color="#1e40af"/>
        <KpiCard icon={Briefcase} label="Open Requisitions" value={summary?.open_reqs ?? '—'} color="#7c3aed"/>
        <KpiCard icon={BarChart3} label="Total Applications" value={summary?.total_apps ?? '—'} color="#0891b2"/>
        <KpiCard icon={Award}     label="Placements" value={summary?.total_placements ?? '—'} color="#16a34a"/>
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'4px',borderBottom:'2px solid #e2e8f0',marginBottom:'24px'}}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{padding:'10px 18px',border:'none',background:'none',cursor:'pointer',
              fontSize:'13px',fontWeight: tab===t.key ? '700' : '500',
              color: tab===t.key ? '#1e40af' : '#64748b',
              borderBottom: tab===t.key ? '2px solid #1e40af' : '2px solid transparent',
              marginBottom:'-2px',transition:'all 0.15s'}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary tab */}
      {tab === 'summary' && (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'20px'}}>
          {/* Pipeline stage bar chart */}
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px'}}>
              <BarChart3 size={15} style={{color:'#1e40af'}}/> Pipeline by Stage
            </h3>
            {pvRows.length > 0 ? (
              <div style={{display:'flex',alignItems:'flex-end',gap:'6px',height:'120px'}}>
                {STAGE_ORDER.filter(s => pvRows.find((r:any)=>r.stage===s)).map(stage => {
                  const r = pvRows.find((row:any) => row.stage === stage);
                  if (!r) return null;
                  const maxV = Math.max(...pvRows.map((x:any) => Number(x.count)||0), 1);
                  const h = Math.round(((Number(r.count)||0)/maxV)*100);
                  return (
                    <div key={stage} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:'4px',minWidth:0}}>
                      <span style={{fontSize:'10px',color:'#64748b',fontWeight:'600'}}>{r.count}</span>
                      <div style={{width:'100%',background:STAGE_COLORS[stage]||'#6366f1',borderRadius:'4px 4px 0 0',
                        height:`${h}%`,minHeight:'4px'}}/>
                      <span style={{fontSize:'9px',color:'#94a3b8',textTransform:'capitalize',overflow:'hidden',
                        textOverflow:'ellipsis',whiteSpace:'nowrap',width:'100%',textAlign:'center'}}>
                        {stage}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{textAlign:'center',padding:'30px',color:'#94a3b8',fontSize:'13px'}}>No pipeline data</div>
            )}
          </div>

          {/* Avg days in stage */}
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'16px',display:'flex',alignItems:'center',gap:'8px'}}>
              <Clock size={15} style={{color:'#f59e0b'}}/> Avg Days per Stage
            </h3>
            {pvRows.length > 0 ? (
              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                {pvRows.slice(0,6).map((r:any) => {
                  const days = Number(r.avg_days_in_stage || 0).toFixed(1);
                  const pct = Math.min(100, Math.round((Number(days)/30)*100));
                  return (
                    <div key={r.stage}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}>
                        <span style={{fontSize:'12px',color:'#374151',fontWeight:'500',textTransform:'capitalize'}}>{r.stage}</span>
                        <span style={{fontSize:'12px',color:'#64748b'}}>{days}d
                          {Number(r.stale_count) > 0 && <span style={{color:'#ef4444',marginLeft:'6px',fontWeight:'600'}}>⚠ {r.stale_count} stale</span>}
                        </span>
                      </div>
                      <div style={{height:'6px',background:'#f1f5f9',borderRadius:'3px',overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${pct}%`,background:STAGE_COLORS[r.stage]||'#6366f1',borderRadius:'3px'}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{textAlign:'center',padding:'30px',color:'#94a3b8',fontSize:'13px'}}>No data</div>
            )}
          </div>

          {/* Top recruiters mini */}
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px',gridColumn:'1/-1'}}>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'14px',display:'flex',alignItems:'center',gap:'8px'}}>
              <Award size={15} style={{color:'#7c3aed'}}/> Top Recruiters — {MONTHS[m]} {y}
            </h3>
            {recs.length > 0 ? (
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse'}}>
                  <thead>
                    <tr style={{background:'#f8fafc'}}>
                      {['Recruiter','Submissions','Interviews','Offers','Placements','Conv %','Grade'].map(h =>
                        <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:'11px',fontWeight:'700',
                          color:'#94a3b8',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {recs.slice(0,8).map((r:any,i:number) => (
                      <tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                        <td style={{padding:'10px 12px',fontSize:'13px',fontWeight:'600',color:'#0f172a'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            <div style={{width:'28px',height:'28px',borderRadius:'50%',background:'#eff6ff',
                              display:'flex',alignItems:'center',justifyContent:'center',fontSize:'11px',
                              fontWeight:'700',color:'#1e40af',flexShrink:0}}>
                              {(r.recruiter||'?').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div>{r.recruiter}</div>
                              {r.kpi_score > 0 && <div style={{fontSize:'10px',color:'#94a3b8'}}>KPI: {r.kpi_score}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{padding:'10px 12px',fontSize:'13px',color:'#374151',fontWeight:'600'}}>{r.total_submissions}</td>
                        <td style={{padding:'10px 12px',fontSize:'13px',color:'#0891b2',fontWeight:'600'}}>{r.interviews}</td>
                        <td style={{padding:'10px 12px',fontSize:'13px',color:'#7c3aed',fontWeight:'600'}}>{r.offers}</td>
                        <td style={{padding:'10px 12px',fontSize:'13px',color:'#16a34a',fontWeight:'700'}}>{r.placements}</td>
                        <td style={{padding:'10px 12px',fontSize:'13px'}}>{pct(r.conversion_rate)}</td>
                        <td style={{padding:'10px 12px'}}>
                          {r.grade && r.grade !== '—' ? (
                            <span style={{fontSize:'12px',fontWeight:'700',padding:'3px 10px',borderRadius:'20px',
                              background:(GRADE_CFG[r.grade]||{bg:'#f1f5f9'}).bg,
                              color:(GRADE_CFG[r.grade]||{color:'#64748b'}).color}}>
                              {r.grade}
                            </span>
                          ) : <span style={{color:'#94a3b8',fontSize:'12px'}}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{textAlign:'center',padding:'30px',color:'#94a3b8',fontSize:'13px'}}>No recruiter data for this period</div>
            )}
          </div>
        </div>
      )}

      {/* Recruiter tab */}
      {tab === 'recruiter' && (
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',overflow:'hidden'}}>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#f8fafc',borderBottom:'2px solid #e2e8f0'}}>
                  {['#','Recruiter','Submissions','Interviews','Offers','Placements','Conv %','KPI Score','Grade','Incentive'].map((h,i) =>
                    <th key={i} style={{padding:'12px 14px',textAlign:'left',fontSize:'11px',fontWeight:'700',
                      color:'#64748b',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {recs.length === 0 ? (
                  <tr><td colSpan={10} style={{padding:'40px',textAlign:'center',color:'#94a3b8',fontSize:'13px'}}>
                    No recruiter data for {MONTHS[m]} {y}
                  </td></tr>
                ) : recs.map((r:any,i:number) => (
                  <tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td style={{padding:'12px 14px',fontSize:'13px',color:'#94a3b8',fontWeight:'600'}}>{i+1}</td>
                    <td style={{padding:'12px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <div style={{width:'32px',height:'32px',borderRadius:'50%',background:'#eff6ff',display:'flex',
                          alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:'700',color:'#1e40af',flexShrink:0}}>
                          {(r.recruiter||'?').charAt(0)}
                        </div>
                        <div>
                          <div style={{fontSize:'13px',fontWeight:'600',color:'#0f172a'}}>{r.recruiter}</div>
                          <div style={{fontSize:'11px',color:'#94a3b8'}}>{r.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:'12px 14px',fontSize:'14px',fontWeight:'700',color:'#374151'}}>{r.total_submissions}</td>
                    <td style={{padding:'12px 14px',fontSize:'14px',fontWeight:'700',color:'#0891b2'}}>{r.interviews}</td>
                    <td style={{padding:'12px 14px',fontSize:'14px',fontWeight:'700',color:'#7c3aed'}}>{r.offers}</td>
                    <td style={{padding:'12px 14px',fontSize:'14px',fontWeight:'700',color:'#16a34a'}}>{r.placements}</td>
                    <td style={{padding:'12px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                        <div style={{flex:1,height:'6px',background:'#f1f5f9',borderRadius:'3px',minWidth:'60px'}}>
                          <div style={{height:'100%',width:`${Math.min(100,Number(r.conversion_rate)||0)}%`,
                            background:'#16a34a',borderRadius:'3px'}}/>
                        </div>
                        <span style={{fontSize:'12px',color:'#374151',fontWeight:'600',whiteSpace:'nowrap'}}>{pct(r.conversion_rate)}</span>
                      </div>
                    </td>
                    <td style={{padding:'12px 14px',fontSize:'13px',color:'#374151',fontWeight:'600'}}>{r.kpi_score||'—'}</td>
                    <td style={{padding:'12px 14px'}}>
                      {r.grade && r.grade!=='—' ? (
                        <span style={{fontSize:'12px',fontWeight:'700',padding:'3px 10px',borderRadius:'20px',
                          background:(GRADE_CFG[r.grade]||{bg:'#f1f5f9'}).bg,
                          color:(GRADE_CFG[r.grade]||{color:'#64748b'}).color}}>
                          {r.grade}
                        </span>
                      ) : <span style={{color:'#94a3b8'}}>—</span>}
                    </td>
                    <td style={{padding:'12px 14px',fontSize:'13px',color:'#16a34a',fontWeight:'600'}}>{fmt(r.incentive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pipeline velocity tab */}
      {tab === 'pipeline' && (
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:'12px'}}>
            {pvRows.map((r:any) => (
              <div key={r.stage} style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'10px',padding:'16px',textAlign:'center'}}>
                <div style={{fontSize:'10px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',marginBottom:'8px'}}>{r.stage}</div>
                <div style={{fontSize:'24px',fontWeight:'800',color:STAGE_COLORS[r.stage]||'#1e40af',marginBottom:'4px'}}>{r.count}</div>
                <div style={{fontSize:'11px',color:'#64748b'}}>avg {Number(r.avg_days_in_stage||0).toFixed(1)}d</div>
                {Number(r.stale_count)>0 && (
                  <div style={{fontSize:'11px',color:'#ef4444',marginTop:'4px',fontWeight:'600'}}>⚠ {r.stale_count} stale</div>
                )}
              </div>
            ))}
            {pvRows.length === 0 && <div style={{gridColumn:'1/-1',textAlign:'center',padding:'40px',color:'#94a3b8',fontSize:'13px'}}>No pipeline data</div>}
          </div>
          <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',padding:'20px'}}>
            <h3 style={{fontSize:'14px',fontWeight:'700',color:'#0f172a',marginBottom:'16px'}}>Stage Volume</h3>
            <BarChart rows={pvRows} keyX="stage" keyY="count" color="#6366f1"/>
          </div>
        </div>
      )}

      {/* Client revenue tab */}
      {tab === 'clients' && (
        <div style={{background:'white',border:'1px solid #e2e8f0',borderRadius:'12px',overflow:'hidden'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'#f8fafc',borderBottom:'2px solid #e2e8f0'}}>
                {['Client','Total Revenue','Contribution Margin','Avg Margin %','Months Active'].map(h =>
                  <th key={h} style={{padding:'12px 14px',textAlign:'left',fontSize:'11px',fontWeight:'700',
                    color:'#64748b',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {clientRows.length === 0 ? (
                <tr><td colSpan={5} style={{padding:'40px',textAlign:'center',color:'#94a3b8',fontSize:'13px'}}>No client revenue data</td></tr>
              ) : clientRows.map((r:any,i:number) => (
                <tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                  <td style={{padding:'12px 14px',fontSize:'13px',fontWeight:'700',color:'#0f172a'}}>{r.client}</td>
                  <td style={{padding:'12px 14px',fontSize:'13px',color:'#16a34a',fontWeight:'700'}}>{fmt(r.total_revenue)}</td>
                  <td style={{padding:'12px 14px',fontSize:'13px',color:'#0891b2',fontWeight:'600'}}>{fmt(r.total_cm)}</td>
                  <td style={{padding:'12px 14px',fontSize:'13px',color:'#7c3aed',fontWeight:'600'}}>{pct(r.avg_margin)}</td>
                  <td style={{padding:'12px 14px',fontSize:'13px',color:'#64748b'}}>{r.months_active}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
