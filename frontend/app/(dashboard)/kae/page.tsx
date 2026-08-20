'use client';
import { useState, useEffect } from 'react';
import { Handshake, Users, Eye, Building2, TrendingUp, Award, CheckCircle, XCircle, Shield, Trophy, Plus } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Table, Thead, Th, Tbody, Tr, Td } from '@/components/ui/Table';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';

const input: React.CSSProperties = { fontSize: 13, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none' };
const smallBtn = 'text-xs px-3 py-1.5 rounded-lg font-semibold text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed';

type KaeTab = 'owners' | 'scorecards' | 'visibility' | 'retention' | 'leaderboard';
const MONTH_NAMES = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const GRADE_COLOR: Record<string,string> = {'A+':'bg-emerald-100 text-emerald-700 font-bold','A':'bg-green-100 text-green-700 font-bold','B':'bg-blue-100 text-blue-700 font-bold','C':'bg-amber-100 text-amber-700 font-bold','D':'bg-red-100 text-red-700 font-bold'};
const LEVEL_COLOR: Record<string,string> = {L5:'bg-purple-100 text-purple-700 font-bold',L4:'bg-blue-100 text-blue-700 font-bold',L3:'bg-green-100 text-green-700 font-bold',L2:'bg-amber-100 text-amber-700',L1:'bg-gray-100 text-gray-500'};
const LEVEL_LABEL: Record<string,string> = {L5:'L5 Founder',L4:'L4 AccountMgr',L3:'L3 KAE',L2:'L2 Senior',L1:'L1 Recruiter'};
const TABS = [{key:'owners' as KaeTab,label:'Account Ownership',icon:Handshake},{key:'scorecards' as KaeTab,label:'KAE Scorecards',icon:Award},{key:'visibility' as KaeTab,label:'L1-L5 Visibility',icon:Eye},{key:'retention' as KaeTab,label:'Retention Bonuses',icon:Shield},{key:'leaderboard' as KaeTab,label:'Leaderboard',icon:Trophy}];
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
  const {data:visibility,loading:visLoading,refetch:refetchVis}=useFetch<any[]>(tab==='visibility'?'/kae/visibility':null);
  const {data:retention,loading:retLoading,refetch:refetchRet}=useFetch<any[]>(tab==='retention'?'/kae/retention':null);
  const {data:leaderboard,loading:lbLoading}=useFetch<any[]>(tab==='leaderboard'?'/kae/leaderboard':null);
  const {data:clientsRaw}=useFetch<any[]>('/clients');
  const {data:usersRaw}=useFetch<any[]>('/users?is_active=true');
  const clients=clientsRaw||[];
  const users=usersRaw||[];

  // Every write in this module (assign/remove ownership, set visibility,
  // create/approve scorecards, track retention) is a business-admin
  // action, matching the backend's own admin/manager role gate added
  // alongside these forms. getTokenPayload() reads localStorage,
  // deferred to an effect so server/client first-render match (same
  // pattern used elsewhere in this codebase, e.g. offers/recruiter-ops).
  const [canManage,setCanManage]=useState(false);
  useEffect(()=>{setCanManage(['admin','super_admin','manager'].includes(getTokenPayload()?.role||''));},[]);

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
        <div className="space-y-4">
          {canManage&&<AssignOwnerForm clients={clients} users={users} onAssigned={refetchOwners}/>}
        <Card data-testid="owners-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">Account Ownership — 3-KAE Limit per Client</h2></CardHeader>
          <CardContent className="p-0">
            {ownLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>KAE</Th><Th>Client</Th><Th>Type</Th><Th>Visibility</Th><Th>Assigned</Th><Th>Actions</Th></tr></Thead>
                <Tbody>
                  {!owners?.length?<Tr><Td colSpan={6} className="text-center text-gray-400 py-10 text-sm">No account owners assigned yet.</Td></Tr>:owners.map(o=>(
                    <Tr key={o.id}>
                      <Td><div className="font-medium text-sm">{o.full_name}</div><div className="text-xs text-gray-400">{o.email}</div></Td>
                      {/* Real name, not a truncated UUID — resolved from the
                          same /clients list the Assign form already fetches. */}
                      <Td className="text-sm text-gray-700">{clients.find(c=>c.id===o.client_id)?.name||<span className="text-xs font-mono text-gray-400">{o.client_id?.slice(0,8)}…</span>}</Td>
                      <Td><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.owner_type==='kae'?'bg-blue-100 text-blue-700':o.owner_type==='account_manager'?'bg-purple-100 text-purple-700':'bg-gray-100 text-gray-600'}`}>{o.owner_type}</span></Td>
                      <Td><span className={`text-xs px-2 py-0.5 rounded-full ${LEVEL_COLOR[o.visibility_lvl]??''}`}>{LEVEL_LABEL[o.visibility_lvl]??o.visibility_lvl}</span></Td>
                      <Td className="text-xs text-gray-400">{new Date(o.assigned_at).toLocaleDateString('en-IN')}</Td>
                      <Td>{canManage&&<button onClick={()=>removeOwner(o.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </CardContent>
        </Card>
        </div>
      )}

      {tab==='scorecards'&&(
        <div className="space-y-4">
          {canManage&&<NewKaeScorecardForm users={users} clients={clients} month={month} year={year} onCreated={refetchSc}/>}
        <Card data-testid="kae-scorecards-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">KAE KPI Scorecards — {MONTH_NAMES[month]} {year}</h2><p className="text-xs text-gray-400 mt-0.5">Revenue 40pt · Collection 25pt · Relationship 20pt · Growth 15pt</p></CardHeader>
          <CardContent className="p-0">
            {scLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>KAE</Th><Th>Score/Grade</Th><Th>Revenue</Th><Th>Collections</Th><Th>Ret.Bonus</Th><Th>Growth</Th><Th>Total Incentive</Th><Th>Status</Th><Th>Action</Th></tr></Thead>
                <Tbody>
                  {!scorecards?.length?<Tr><Td colSpan={9} className="text-center text-gray-400 py-10 text-sm">No KAE scorecards for this period yet.</Td></Tr>:scorecards.map(sc=>(
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
        </div>
      )}

      {tab==='visibility'&&(
        <div className="space-y-4">
          {canManage&&<SetVisibilityForm users={users} onSet={refetchVis}/>}
        <Card data-testid="visibility-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">L1-L5 Visibility Tiers</h2><p className="text-xs text-gray-400 mt-0.5">L1 None · L2 Own Rev · L3 Account Rev+Delivery · L4 Account P&L · L5 Company P&L</p></CardHeader>
          <CardContent className="p-0">
            {visLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>User</Th><Th>Level</Th><Th>Own Revenue</Th><Th>Account Rev</Th><Th>Delivery</Th><Th>Account P&L</Th><Th>Company P&L</Th></tr></Thead>
                <Tbody>
                  {!visibility?.length?<Tr><Td colSpan={7} className="text-center text-gray-400 py-10 text-sm">No visibility levels set yet.</Td></Tr>:visibility.map(v=>(
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
        </div>
      )}

      {tab==='retention'&&(
        <div className="space-y-4">
          {canManage&&<TrackRetentionForm users={users} clients={clients} onTracked={refetchRet}/>}
        <Card data-testid="kae-retention-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">KAE Client Retention Bonuses</h2><p className="text-xs text-gray-400 mt-0.5">6m ₹5k · 12m ₹15k · 24m ₹30k · months_served auto-increments weekly</p></CardHeader>
          <CardContent className="p-0">
            {retLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>KAE</Th><Th>Client</Th><Th>Owner Since</Th><Th>Months</Th><Th>Current Bonus</Th><Th>6m</Th><Th>12m</Th><Th>24m</Th></tr></Thead>
                <Tbody>
                  {!retention?.length?<Tr><Td colSpan={8} className="text-center text-gray-400 py-10 text-sm">No retention records yet.</Td></Tr>:retention.map(r=>(
                    <Tr key={r.id}>
                      <Td className="font-medium text-sm">{r.full_name}</Td>
                      <Td className="text-sm text-gray-700">{clients.find(c=>c.id===r.client_id)?.name||<span className="text-xs font-mono text-gray-400">{r.client_id?.slice(0,8)}…</span>}</Td>
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
        </div>
      )}

      {tab==='leaderboard'&&(
        <Card data-testid="kae-leaderboard-panel">
          <CardHeader><h2 className="font-semibold text-gray-800">KAE Leaderboard</h2><p className="text-xs text-gray-400 mt-0.5">Ranked by total revenue (v_kae_summary)</p></CardHeader>
          <CardContent className="p-0">
            {lbLoading?<div className="flex justify-center py-10"><Spinner size="lg"/></div>:(
              <Table><Thead><tr><Th>KAE</Th><Th>Scorecards</Th><Th>Avg Score</Th><Th>Accounts</Th><Th>Revenue</Th><Th>Collected</Th><Th>Incentive</Th></tr></Thead>
                <Tbody>
                  {!leaderboard?.length?<Tr><Td colSpan={7} className="text-center text-gray-400 py-10 text-sm">No KAE scorecards submitted yet.</Td></Tr>:leaderboard.map(r=>(
                    <Tr key={r.user_id}>
                      <Td className="font-medium text-sm">{r.full_name}</Td>
                      <Td>{r.scorecard_count}</Td>
                      <Td className="font-semibold">{r.avg_score}</Td>
                      <Td>{r.accounts_owned}</Td>
                      <Td className="font-semibold text-green-700">{fmt(r.total_revenue)}</Td>
                      <Td>{fmt(r.total_collected)}</Td>
                      <Td>{fmt(r.total_incentive)}</Td>
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

// ── Assign KAE Form (2026-08-20) ─────────────────────────────────────────────
// The primary gap reported: the Owners tab could only ever REMOVE an
// assignment — there was no way to create one anywhere in the app,
// despite POST /kae/owners already being real and enforcing the 3-KAE
// limit. Client-wise assignment (one client, one KAE at a time) is
// exactly how this endpoint already works — this form just exposes it.
function AssignOwnerForm({ clients, users, onAssigned }: { clients: any[]; users: any[]; onAssigned: () => void }) {
  const [clientId, setClientId] = useState('');
  const [userId, setUserId] = useState('');
  const [ownerType, setOwnerType] = useState('kae');
  const [visLvl, setVisLvl] = useState('L3');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { data: byClient } = useFetch<any>(clientId ? `/kae/owners/by-client/${clientId}` : null);
  const kaeCount = byClient?.kae_count ?? 0;
  const kaeLimitHit = ownerType === 'kae' && kaeCount >= 3;

  async function submit() {
    if (!clientId || !userId) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/kae/owners', {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, user_id: userId, owner_type: ownerType, visibility_lvl: visLvl, notes: notes || undefined }),
      });
      setClientId(''); setUserId(''); setOwnerType('kae'); setVisLvl('L3'); setNotes('');
      onAssigned();
    } catch (e: any) { setErr(e.message || 'Failed to assign'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Client</label>
          <select data-testid="assign-kae-client" value={clientId} onChange={e => setClientId(e.target.value)} style={{ ...input, minWidth: 200 }}>
            <option value="">Select client…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">User</label>
          <select data-testid="assign-kae-user" value={userId} onChange={e => setUserId(e.target.value)} style={{ ...input, minWidth: 180 }}>
            <option value="">Select user…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Owner Type</label>
          <select data-testid="assign-kae-owner-type" value={ownerType} onChange={e => setOwnerType(e.target.value)} style={{ ...input, minWidth: 140 }}>
            <option value="kae">KAE</option>
            <option value="account_manager">Account Manager</option>
            <option value="secondary">Secondary / Backup</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Visibility</label>
          <select value={visLvl} onChange={e => setVisLvl(e.target.value)} style={{ ...input, minWidth: 130 }}>
            {['L1', 'L2', 'L3', 'L4', 'L5'].map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} style={{ ...input, width: '100%' }} placeholder="e.g. backup for maternity leave" />
        </div>
        <button data-testid="assign-kae-submit" onClick={submit} disabled={!clientId || !userId || busy || kaeLimitHit} className={`${smallBtn} bg-[--color-primary]`}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Assigning…' : 'Assign'}
        </button>
      </div>
      {clientId && ownerType === 'kae' && (
        <div className={`text-xs mt-2 ${kaeLimitHit ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
          {kaeCount}/3 KAEs already assigned to this client{kaeLimitHit ? ' — remove one before assigning another' : ''}
        </div>
      )}
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}

// ── Set Visibility Form ───────────────────────────────────────────────────────
function SetVisibilityForm({ users, onSet }: { users: any[]; onSet: () => void }) {
  const [userId, setUserId] = useState('');
  const [lvl, setLvl] = useState('L3');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!userId) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/kae/visibility', { method: 'POST', body: JSON.stringify({ user_id: userId, visibility_lvl: lvl }) });
      setUserId(''); setLvl('L3');
      onSet();
    } catch (e: any) { setErr(e.message || 'Failed to set visibility'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">User</label>
          <select data-testid="set-visibility-user" value={userId} onChange={e => setUserId(e.target.value)} style={{ ...input, minWidth: 200 }}>
            <option value="">Select user…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Level</label>
          <select value={lvl} onChange={e => setLvl(e.target.value)} style={{ ...input, minWidth: 160 }}>
            {['L1', 'L2', 'L3', 'L4', 'L5'].map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
        </div>
        <button data-testid="set-visibility-submit" onClick={submit} disabled={!userId || busy} className={`${smallBtn} bg-[--color-primary]`}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Saving…' : 'Set Level'}
        </button>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}

// ── New KAE Scorecard Form ────────────────────────────────────────────────────
// Same manual points-entry shape as /incentives' own NewScorecardForm (the
// recruiter equivalent, P15) — reused for consistency rather than inventing
// a different layout for the structurally near-identical KAE version (P16).
function NewKaeScorecardForm({ users, clients, month, year, onCreated }: { users: any[]; clients: any[]; month: number; year: number; onCreated: () => void }) {
  const [userId, setUserId] = useState('');
  const [clientId, setClientId] = useState('');
  const [revTarget, setRevTarget] = useState('0');
  const [revActual, setRevActual] = useState('0');
  const [revScore, setRevScore] = useState('0');
  const [colTarget, setColTarget] = useState('0');
  const [colActual, setColActual] = useState('0');
  const [colScore, setColScore] = useState('0');
  const [satScore, setSatScore] = useState('0');
  const [growthScore, setGrowthScore] = useState('0');
  const [renewalScore, setRenewalScore] = useState('0');
  const [baseIncentive, setBaseIncentive] = useState('0');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!userId) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/kae/scorecard', {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId, period_month: month, period_year: year,
          revenue_target: parseFloat(revTarget) || 0, revenue_actual: parseFloat(revActual) || 0, revenue_score: parseFloat(revScore) || 0,
          collection_target: parseFloat(colTarget) || 0, collection_actual: parseFloat(colActual) || 0, collection_score: parseFloat(colScore) || 0,
          client_sat_score: parseFloat(satScore) || 0, new_pos_score: parseFloat(growthScore) || 0, renewal_score: parseFloat(renewalScore) || 0,
          base_incentive: parseFloat(baseIncentive) || 0, client_id: clientId || undefined,
        }),
      });
      setUserId(''); setClientId(''); setRevTarget('0'); setRevActual('0'); setRevScore('0');
      setColTarget('0'); setColActual('0'); setColScore('0'); setSatScore('0'); setGrowthScore('0'); setRenewalScore('0'); setBaseIncentive('0');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to create scorecard'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">KAE</label>
          <select data-testid="new-kae-scorecard-user" value={userId} onChange={e => setUserId(e.target.value)} style={{ ...input, minWidth: 180 }}>
            <option value="">Select…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Client (optional)</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ ...input, minWidth: 160 }}>
            <option value="">—</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <NumField label="Revenue Target" value={revTarget} onChange={setRevTarget} />
        <NumField label="Revenue Actual" value={revActual} onChange={setRevActual} />
        <NumField label="Revenue /40" value={revScore} onChange={setRevScore} />
        <NumField label="Collection Target" value={colTarget} onChange={setColTarget} />
        <NumField label="Collection Actual" value={colActual} onChange={setColActual} />
        <NumField label="Collection /25" value={colScore} onChange={setColScore} />
        <NumField label="Relationship /20" value={satScore} onChange={setSatScore} />
        <NumField label="Growth /10" value={growthScore} onChange={setGrowthScore} />
        <NumField label="Renewal /5" value={renewalScore} onChange={setRenewalScore} />
        <NumField label="Base Incentive" value={baseIncentive} onChange={setBaseIncentive} />
        <button data-testid="new-kae-scorecard-submit" onClick={submit} disabled={!userId || busy} className={`${smallBtn} bg-[--color-primary]`}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Saving…' : 'New Scorecard'}
        </button>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}

// ── Track Retention Form ──────────────────────────────────────────────────────
function TrackRetentionForm({ users, clients, onTracked }: { users: any[]; clients: any[]; onTracked: () => void }) {
  const [userId, setUserId] = useState('');
  const [clientId, setClientId] = useState('');
  const [ownerSince, setOwnerSince] = useState('');
  const [monthsServed, setMonthsServed] = useState('0');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!userId || !clientId || !ownerSince) { setErr('User, client, and owner-since date are all required'); return; }
    setBusy(true); setErr('');
    try {
      await apiFetch('/kae/retention', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, client_id: clientId, owner_since: ownerSince, months_served: parseInt(monthsServed) || 0 }),
      });
      setUserId(''); setClientId(''); setOwnerSince(''); setMonthsServed('0');
      onTracked();
    } catch (e: any) { setErr(e.message || 'Failed to track retention'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">KAE</label>
          <select data-testid="track-retention-user" value={userId} onChange={e => setUserId(e.target.value)} style={{ ...input, minWidth: 180 }}>
            <option value="">Select…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Client</label>
          <select data-testid="track-retention-client" value={clientId} onChange={e => setClientId(e.target.value)} style={{ ...input, minWidth: 180 }}>
            <option value="">Select…</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Owner Since</label>
          <input type="date" value={ownerSince} onChange={e => setOwnerSince(e.target.value)} style={{ ...input, width: 150 }} />
        </div>
        <NumField label="Months Served" value={monthsServed} onChange={setMonthsServed} />
        <button data-testid="track-retention-submit" onClick={submit} disabled={!userId || !clientId || !ownerSince || busy} className={`${smallBtn} bg-[--color-primary]`}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Saving…' : 'Track'}
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
