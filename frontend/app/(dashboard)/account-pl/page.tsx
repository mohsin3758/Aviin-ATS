'use client';
import { useState } from 'react';
import { DollarSign, TrendingUp, ArrowRight, CheckCircle2, Plus } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const pct=(n:any)=>n!=null?`${Number(n).toFixed(1)}%`:'—';
const input: React.CSSProperties = { fontSize: 13, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none' };
const smallBtn = 'text-xs px-2 py-1 rounded font-semibold text-white hover:opacity-90';
export default function AccountPlPage() {
  const [m,setM]=useState(new Date().getMonth()+1);
  const [y,setY]=useState(new Date().getFullYear());
  const qs=`?month=${m}&year=${y}`;
  const {data:summary}=useFetch<any>(`/account-pl/summary${qs}`);
  const {data:accounts,refetch:refetchAccounts}=useFetch<any[]>(`/account-pl${qs}`);
  const {data:bu}=useFetch<any[]>('/bu-tracker');
  const {data:clientsRaw}=useFetch<any>('/clients');
  const clients = clientsRaw?.items || clientsRaw || [];
  const MONTHS=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  async function finalize(id:string){await apiFetch(`/account-pl/${id}/finalize`,{method:'PATCH'});refetchAccounts();}
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
      <NewAccountPlForm clients={clients} month={m} year={y} onCreated={refetchAccounts} />
      <div className="card overflow-hidden">
        <div className="card-header"><h3>Account P&L — {MONTHS[m]} {y}</h3><span className="badge badge-blue">CM = Revenue − Delivery − Incentives − OpCost</span></div>
        <table className="data-table"><thead><tr><th>Client</th><th>Revenue</th><th>Delivery Pool (80%)</th><th>CM</th><th>CM%</th><th>Fill Rate</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{(accounts||[]).map((a:any)=>(
            <tr key={a.id}><td className="font-medium text-sm">{a.client_name||'—'}</td><td className="font-semibold">{fmt(a.gross_revenue)}</td><td className="text-sm" style={{color:'var(--gray-600)'}}>{fmt(a.delivery_pool)}</td>
              <td><span className={`font-bold text-sm ${a.contribution_margin>=0?'text-green-700':'text-red-600'}`}>{fmt(a.contribution_margin)}</span></td>
              <td><span className={`badge ${a.cm_pct>=20?'badge-green':a.cm_pct>=10?'badge-amber':'badge-red'}`}>{pct(a.cm_pct)}</span></td>
              <td className="text-sm">{pct(a.fill_rate_pct)}</td>
              <td>{a.is_finalized?<span className="badge badge-green flex items-center gap-1"><CheckCircle2 size={10}/>Finalized</span>:<span className="badge badge-gray">Draft</span>}</td>
              <td>{!a.is_finalized&&<button onClick={()=>finalize(a.id)} className={`${smallBtn} bg-blue-600`}>Finalize</button>}</td>
            </tr>))}
            {!accounts?.length&&<tr><td colSpan={8} className="text-center py-8" style={{color:'var(--gray-400)'}}>No P&L data for this period — add a record above.</td></tr>}
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

function NewAccountPlForm({ clients, month, year, onCreated }: { clients: any[]; month: number; year: number; onCreated: () => void }) {
  const [clientId, setClientId] = useState('');
  const [revenue, setRevenue] = useState('0');
  const [deliveryCost, setDeliveryCost] = useState('0');
  const [totalIncentives, setTotalIncentives] = useState('0');
  const [operationalCost, setOperationalCost] = useState('0');
  const [activePos, setActivePos] = useState('0');
  const [filledPos, setFilledPos] = useState('0');
  const [showAdv, setShowAdv] = useState(false);
  const [adv, setAdv] = useState<Record<string, string>>({
    management_cost: '0', finance_cost: '0', ops_cost: '0',
    recruiter_incentives: '0', sourcing_cost: '0', referral_cost: '0',
    kae_incentive: '0', growth_reserve: '0', op_reserve: '0',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!clientId) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/account-pl', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId, period_month: month, period_year: year,
          gross_revenue: parseFloat(revenue) || 0, delivery_cost: parseFloat(deliveryCost) || 0,
          total_incentives: parseFloat(totalIncentives) || 0, operational_cost: parseFloat(operationalCost) || 0,
          active_positions: parseInt(activePos) || 0, filled_positions: parseInt(filledPos) || 0,
          ...Object.fromEntries(Object.entries(adv).map(([k, v]) => [k, parseFloat(v) || 0])),
        }),
      });
      setClientId(''); setRevenue('0'); setDeliveryCost('0'); setTotalIncentives('0'); setOperationalCost('0'); setActivePos('0'); setFilledPos('0');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to save P&L record'); }
    finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Client</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)} style={{ ...input, minWidth: 200 }}>
            <option value="">Select…</option>
            {clients.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Gross Revenue</label><input type="number" value={revenue} onChange={e => setRevenue(e.target.value)} style={{ ...input, width: 110 }} /></div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Delivery Cost</label><input type="number" value={deliveryCost} onChange={e => setDeliveryCost(e.target.value)} style={{ ...input, width: 110 }} /></div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Total Incentives</label><input type="number" value={totalIncentives} onChange={e => setTotalIncentives(e.target.value)} style={{ ...input, width: 110 }} /></div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Operational Cost</label><input type="number" value={operationalCost} onChange={e => setOperationalCost(e.target.value)} style={{ ...input, width: 110 }} /></div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Active Pos.</label><input type="number" value={activePos} onChange={e => setActivePos(e.target.value)} style={{ ...input, width: 70 }} /></div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Filled Pos.</label><input type="number" value={filledPos} onChange={e => setFilledPos(e.target.value)} style={{ ...input, width: 70 }} /></div>
      </div>
      <button onClick={() => setShowAdv(v => !v)} className="text-xs text-blue-600 mt-3 font-medium">{showAdv ? '− Hide' : '+ Show'} advanced breakdown (management/finance/ops cost, delivery-pool allocations)</button>
      {showAdv && (
        <div className="flex flex-wrap gap-3 mt-3 pt-3" style={{ borderTop: '1px solid #f1f5f9' }}>
          {Object.keys(adv).map(k => (
            <div key={k}>
              <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">{k.replace(/_/g, ' ')}</label>
              <input type="number" value={adv[k]} onChange={e => setAdv({ ...adv, [k]: e.target.value })} style={{ ...input, width: 100 }} />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 mt-3">
        <button onClick={submit} disabled={!clientId || busy} className={`${smallBtn} bg-[--color-primary]`} style={{ padding: '7px 14px' }}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Saving…' : 'Save P&L Record'}
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
