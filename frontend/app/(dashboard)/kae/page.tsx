'use client';
import { useState } from 'react';
import { Handshake, Users, Eye, Building2, TrendingUp, Award, CheckCircle, XCircle, Shield } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch, apiFetch } from '@/lib/useFetch';

type KaeTab = 'owners' | 'scorecards' | 'visibility' | 'retention';
const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const GRADE_COLOR: Record<string,string> = {'A+':'bg-emerald-100 text-emerald-700 font-bold','A':'bg-green-100 text-green-700 font-bold','B':'bg-blue-100 text-blue-700 font-bold','C':'bg-amber-100 text-amber-700 font-bold','D':'bg-red-100 text-red-700 font-bold'};
const LEVEL_COLOR: Record<string,string> = {L5:'bg-purple-100 text-purple-700 font-bold',L4:'bg-blue-100 text-blue-700 font-bold',L3:'bg-green-100 text-green-700 font-bold',L2:'bg-amber-100 text-amber-700',L1:'bg-gray-100 text-gray-500'};
const LEVEL_LABEL: Record<string,string> = {L5:'L5 Founder',L4:'L4 AccountMgr',L3:'L3 KAE',L2:'L2 Senior',L1:'L1 Recruiter'};
const TABS = [{key:'owners' as KaeTab,label:'Account Ownership',icon:Handshake},{key:'scorecards' as KaeTab,label:'KAE Scorecards',icon:Award},{key:'visibility' as KaeTab,label:'L1-L5 Visibility',icon:Eye},{key:'retention' as KaeTab,label:'Retention Bonuses',icon:Shield}];
function fmt(n:number|null|undefined){if(n==null)return'—';return new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n);}
function pct(n:number|null|undefined){return n!=null?`${Number(n).toFixed(1)}%`:'—';}
function KpiCard({icon:Icon,label,value,color,bg}:{icon:any;label:string;value:any;color:string;bg:string}){return(<Card><CardContent className="flex items-center gap-3 py-5"><div className={`p-2.5 rounded-xl ${bg} ${color} shrink-0`}><Icon className="h-5 w-5"/></div><div className="min-w-0"><p className="text-xl font-bold text-gray-900 truncate">{value===null?<Spinner size="sm"/>:value}</p><p className="text-xs text-gray-500 mt-0.5 truncate">{label}</p></div></CardContent></Card>);}

export default function KaePage() {
  const [tab,setTab]=useState<KaeTab>('owners');
  const now=new Date();
  const [month,setMonth]=useState(now.getMonth()+1);
  const [year,setYear]=useState(now.getFullYear());
  const qs=`?month=${month}&year=${year}`;
  const {data:summary,loading:sumLoading}=useFetch<any>(`/kae/summary${qs}`);
  const {data:owners,loading:ownLoading,refetch:refetchOwners}=useFetch<any[]>('/kae/owners');
  const {data:scorecards,loading:scLoading,refetch:refetchSc}=useFetch<any[]>(tab==='scorecards'?`/kae/scorecard${qs}`:null);
  const {data:visibility,loading:visLoading}=useFetch<any[]>(tab==='visibility'?'/kae/visibility':null);
  const {data:retention,loading:retLoading}=useFetch<any[]>(tab==='retention'?'/kae/retention':null);

  async function removeOwner(id:string){await apiFetch(`/kae/owners/${id}`,{method:'DELETE'});refetchOwners();}
  async function approveScore(id:string,status:string){await apiFetch(`/kae/scorecard/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});refetchSc();}

  return (
    <div className="space-y-6" data-testid="kae-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[--color-primary]/10"><Handshake className="h-5 w-5 text-[--color-primary]"/></div>
          <div><h1 className="text-2xl font-bold text-gray-900">P16 KAE Module</h1><p className="text-sm text-gray-500">Account ownership · 3-owner rule · L1-L5 visibility</p></div>
        </div>
        <div className="flex gap-2">
          <select value={month} onChange={e=>setMonth(+e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm">
            {Array.from({length:12},(_,i)=>i+1).map(m=><option key={m} value={m}>{MONTH_NAMES[m]}</option>)}
          </select>
          <select value={year} onChange={e=>setYear(+e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm">
            {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" data-testid="kae-kpis">
        <KpiCard icon={Building2} label="Clients with KAE" color="text-blue-600" bg="bg-blue-50" value={sumLoading?null:summary?.total_clients_with_kae}/>
        <KpiCard icon={Users} label="KAE Assignments" color="text-purple-600" bg="bg-purple-50" value={sumLoading?null:summary?.total_kae_assignments}/>
        <KpiCard icon={TrendingUp} label="Total Revenue" color="text-green-600" bg="bg-green-50" value={sumLoading?null:fmt(summary?.total_revenue)}/>
        <KpiCard icon={Award} label="Incentive Pool" color="text-amber-600" bg="bg-amber-50" value={sumLoading?null:fmt(summary?.total_incentive)}/>
      </div>
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} data-tab={t.key} className={['flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2',tab===t.key?'border-[--color-primary] text-[--color-primary]':'border-transparent text-gray-500 hover:text-gray-700'].join(' ')}>
            <t.icon className="h-3.5 w-3.5"/>{t.label}
          </button>
        ))}
      </div>

      {tab==='owners'&&(
        <Card data-testid="owners-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">Account Ownership — 3-KAE Limit per Client</h2></CardHeader>
          <CardContent className="p-0">
            {ownLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>KAE</Th><Th>Client ID</Th><Th>Type</Th><Th>Visibility</Th><Th>Assigned</Th><Th>Actions</Th></tr></Thead>
                <Tbody>
                  {!owners?.length?<Tr><Td colSpan={6} className="text-center text-gray-400 py-10 text-sm">No account owners assigned yet.</Td></Tr>:owners.map(o=>(
                    <Tr key={o.id}>
                      <Td><div className="font-medium text-sm">{o.full_name}</div><div className="text-xs text-gray-400">{o.email}</div></Td>
                      <Td className="text-xs font-mono text-gray-500">{o.client_id?.slice(0,8)}…</Td>
                      <Td><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.owner_type==='kae'?'bg-blue-100 text-blue-700':o.owner_type==='account_manager'?'bg-purple-100 text-purple-700':'bg-gray-100 text-gray-600'}`}>{o.owner_type}</span></Td>
                      <Td><span className={`text-xs px-2 py-0.5 rounded-full ${LEVEL_COLOR[o.visibility_lvl]??''}`}>{LEVEL_LABEL[o.visibility_lvl]??o.visibility_lvl}</span></Td>
                      <Td className="text-xs text-gray-400">{new Date(o.assigned_at).toLocaleDateString('en-IN')}</Td>
                      <Td><button onClick={()=>removeOwner(o.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button></Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab==='scorecards'&&(
        <Card data-testid="kae-scorecards-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">KAE KPI Scorecards — {MONTH_NAMES[month]} {year}</h2><p className="text-xs text-gray-400 mt-0.5">Revenue 40pt · Collection 25pt · Relationship 20pt · Growth 15pt</p></CardHeader>
          <CardContent className="p-0">
            {scLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>KAE</Th><Th>Score/Grade</Th><Th>Revenue</Th><Th>Collections</Th><Th>Ret.Bonus</Th><Th>Growth</Th><Th>Total Incentive</Th><Th>Status</Th><Th>Action</Th></tr></Thead>
                <Tbody>
                  {!scorecards?.length?<Tr><Td colSpan={9} className="text-center text-gray-400 py-10 text-sm">No KAE scorecards. POST /kae/scorecard to add.</Td></Tr>:scorecards.map(sc=>(
                    <Tr key={sc.id}>
                      <Td className="font-medium text-sm">{sc.full_name}</Td>
                      <Td><div className="flex items-center gap-2"><span className="text-lg font-bold">{sc.total_score}</span><span className={`text-xs px-2 py-0.5 rounded-full ${GRADE_COLOR[sc.grade]??''}`}>{sc.grade}</span></div></Td>
                      <Td><div className="text-sm font-medium">{fmt(sc.revenue_actual)}</div><div className="text-xs text-gray-400">{pct(sc.revenue_pct)} of target</div></Td>
                      <Td><div className="text-sm font-medium">{fmt(sc.collection_actual)}</div><div className="text-xs text-gray-400">{pct(sc.collection_pct)} of target</div></Td>
                      <Td className="text-sm text-green-700 font-medium">{fmt(sc.retention_bonus)}</Td>
                      <Td className="text-sm text-blue-700 font-medium">{fmt(sc.growth_bonus)}</Td>
                      <Td className="text-sm font-bold">{fmt(sc.total_incentive)}</Td>
                      <Td><span className={`text-xs px-2 py-0.5 rounded-full ${sc.status==='paid'?'bg-green-100 text-green-700':sc.status==='approved'?'bg-blue-100 text-blue-700':'bg-gray-100 text-gray-500'}`}>{sc.status}</span></Td>
                      <Td>{sc.status==='draft'&&<button onClick={()=>approveScore(sc.id,'approved')} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">Approve</button>}{sc.status==='approved'&&<button onClick={()=>approveScore(sc.id,'paid')} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">Mark Paid</button>}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab==='visibility'&&(
        <Card data-testid="visibility-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">L1-L5 Visibility Tiers</h2><p className="text-xs text-gray-400 mt-0.5">L1 None · L2 Own Rev · L3 Account Rev+Delivery · L4 Account P&L · L5 Company P&L</p></CardHeader>
          <CardContent className="p-0">
            {visLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>User</Th><Th>Level</Th><Th>Own Revenue</Th><Th>Account Rev</Th><Th>Delivery</Th><Th>Account P&L</Th><Th>Company P&L</Th></tr></Thead>
                <Tbody>
                  {!visibility?.length?<Tr><Td colSpan={7} className="text-center text-gray-400 py-10 text-sm">No visibility rows. POST /kae/visibility to set levels.</Td></Tr>:visibility.map(v=>(
                    <Tr key={v.id}>
                      <Td><div className="font-medium text-sm">{v.full_name}</div><div className="text-xs text-gray-400">{v.email}</div></Td>
                      <Td><span className={`text-xs px-2 py-0.5 rounded-full ${LEVEL_COLOR[v.visibility_lvl]??''}`}>{LEVEL_LABEL[v.visibility_lvl]??v.visibility_lvl}</span></Td>
                      {[v.can_see_own_revenue,v.can_see_account_revenue,v.can_see_delivery_data,v.can_see_account_pl,v.can_see_company_pl].map((can,i)=>(
                        <Td key={i}>{can?<CheckCircle className="h-4 w-4 text-green-500"/>:<XCircle className="h-4 w-4 text-gray-300"/>}</Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {tab==='retention'&&(
        <Card data-testid="kae-retention-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">KAE Client Retention Bonuses</h2><p className="text-xs text-gray-400 mt-0.5">6m ₹5k · 12m ₹15k · 24m ₹30k</p></CardHeader>
          <CardContent className="p-0">
            {retLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>KAE</Th><Th>Client ID</Th><Th>Owner Since</Th><Th>Months</Th><Th>Current Bonus</Th><Th>6m</Th><Th>12m</Th><Th>24m</Th></tr></Thead>
                <Tbody>
                  {!retention?.length?<Tr><Td colSpan={8} className="text-center text-gray-400 py-10 text-sm">No retention records. POST /kae/retention to track.</Td></Tr>:retention.map(r=>(
                    <Tr key={r.id}>
                      <Td className="font-medium text-sm">{r.full_name}</Td>
                      <Td className="text-xs font-mono text-gray-500">{r.client_id?.slice(0,8)}…</Td>
                      <Td className="text-xs text-gray-500">{r.owner_since}</Td>
                      <Td><span className="font-bold">{r.months_served}</span></Td>
                      <Td className="font-semibold text-green-700">{fmt(r.current_bonus)}</Td>
                      {[r.retention_6m_paid,r.retention_12m_paid,r.retention_24m_paid].map((paid,i)=>(
                        <Td key={i}>{paid?<CheckCircle className="h-4 w-4 text-green-500"/>:<XCircle className="h-4 w-4 text-gray-300"/>}</Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
