'use client';
import { useFetch } from '@/lib/useFetch';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const BUCKET_COLOR:Record<string,string>={current:'badge-green','1-30d':'badge-blue','31-60d':'badge-amber','61-90d':'badge-orange','90d+':'badge-red'};
const STATUS_COLOR:Record<string,string>={outstanding:'badge-gray',partial:'badge-blue',collected:'badge-green',overdue:'badge-red'};
export default function CollectionsPage() {
  const {data:summary}=useFetch<any>('/collections/summary');
  const {data:records}=useFetch<any[]>('/collections');
  return (
    <div data-testid="collections-page" className="anim-fade-up space-y-6">
      <div className="page-hero">
        <div className="relative z-10"><h1 className="text-white text-2xl font-bold mb-1">💳 Collections & Invoicing</h1><p className="text-blue-200 text-sm">Invoice tracking · Aging analysis · Collection stages</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['📄','Total Invoiced',fmt(summary?.total_invoiced),'#1e40af','#eff6ff'],['✅','Collected',fmt(summary?.total_collected),'#059669','#d1fae5'],['⏳','Outstanding',fmt(summary?.total_outstanding),'#92400e','#fef3c7'],['🚨','Overdue',fmt(summary?.overdue_amount),'#dc2626','#fee2e2']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="card-header"><h3>Collection Records</h3></div>
        <table className="data-table"><thead><tr><th>Client</th><th>Invoice Ref</th><th>Invoice Amt</th><th>Collected</th><th>Outstanding</th><th>Aging</th><th>Bucket</th><th>Status</th><th>Stage</th></tr></thead>
          <tbody>{(records||[]).map((r:any)=>(
            <tr key={r.id}>
              <td className="font-medium text-sm">{r.client_name||'—'}</td>
              <td className="text-xs font-mono" style={{color:'var(--gray-500)'}}>{r.invoice_ref||'—'}</td>
              <td className="font-medium">{fmt(r.invoice_amount)}</td>
              <td className="text-sm" style={{color:'var(--accent)'}}>{fmt(r.collected_amount)}</td>
              <td className={`font-medium text-sm ${r.outstanding_amount>0?'text-red-600':'text-gray-400'}`}>{fmt(r.outstanding_amount)}</td>
              <td><span className={`text-sm font-semibold ${r.aging_days>30?'text-red-600':r.aging_days>0?'text-amber-600':'text-green-600'}`}>{r.aging_days!=null?`${r.aging_days}d`:'—'}</span></td>
              <td>{r.aging_bucket && <span className={`badge ${BUCKET_COLOR[r.aging_bucket]||'badge-gray'}`}>{r.aging_bucket}</span>}</td>
              <td><span className={`badge ${STATUS_COLOR[r.status]||'badge-gray'}`}>{r.status}</span></td>
              <td className="text-xs">{r.collection_stage?.replace(/_/g,' ')}</td>
            </tr>))}
            {!records?.length&&<tr><td colSpan={9} className="text-center py-8" style={{color:'var(--gray-400)'}}>No collection records yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
