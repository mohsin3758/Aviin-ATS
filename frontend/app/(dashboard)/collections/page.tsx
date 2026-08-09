'use client';
import { useState, Fragment } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus } from 'lucide-react';
const fmt=(n:any)=>n!=null?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';
const BUCKET_COLOR:Record<string,string>={current:'badge-green','1-30d':'badge-blue','31-60d':'badge-amber','61-90d':'badge-orange','90d+':'badge-red'};
const STATUS_COLOR:Record<string,string>={outstanding:'badge-gray',partial:'badge-blue',collected:'badge-green',overdue:'badge-red'};
const input: React.CSSProperties = { fontSize: 13, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none' };
const smallBtn = 'text-xs px-2 py-1 rounded font-semibold text-white hover:opacity-90';
const STAGES = ['invoice_raised','reminder_sent','escalated','legal_notice','collected','written_off'];
export default function CollectionsPage() {
  const {data:summary}=useFetch<any>('/collections/summary');
  const {data:records,refetch}=useFetch<any[]>('/collections');
  const {data:clientsRaw}=useFetch<any>('/clients');
  const clients = clientsRaw?.items || clientsRaw || [];
  const [editing,setEditing]=useState<string|null>(null);
  async function saveUpdate(r:any, patch:{collected_amount:number; collected_date:string|null; collection_stage:string; notes:string|null}){
    await apiFetch(`/collections/${r.id}`,{method:'PATCH',body:JSON.stringify({
      client_id:r.client_id, invoice_amount:r.invoice_amount, ...patch,
    })});
    setEditing(null); refetch();
  }
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
      <NewCollectionForm clients={clients} onCreated={refetch} />
      <div className="card overflow-hidden">
        <div className="card-header"><h3>Collection Records</h3></div>
        <table className="data-table"><thead><tr><th>Client</th><th>Invoice Ref</th><th>Invoice Amt</th><th>Collected</th><th>Outstanding</th><th>Aging</th><th>Bucket</th><th>Status</th><th>Stage</th><th>Action</th></tr></thead>
          <tbody>{(records||[]).map((r:any)=>(
            <Fragment key={r.id}>
            <tr>
              <td className="font-medium text-sm">{r.client_name||'—'}</td>
              <td className="text-xs font-mono" style={{color:'var(--gray-500)'}}>{r.invoice_ref||'—'}</td>
              <td className="font-medium">{fmt(r.invoice_amount)}</td>
              <td className="text-sm" style={{color:'var(--accent)'}}>{fmt(r.collected_amount)}</td>
              <td className={`font-medium text-sm ${r.outstanding_amount>0?'text-red-600':'text-gray-400'}`}>{fmt(r.outstanding_amount)}</td>
              <td><span className={`text-sm font-semibold ${r.aging_days>30?'text-red-600':r.aging_days>0?'text-amber-600':'text-green-600'}`}>{r.aging_days!=null?`${r.aging_days}d`:'—'}</span></td>
              <td>{r.aging_bucket && <span className={`badge ${BUCKET_COLOR[r.aging_bucket]||'badge-gray'}`}>{r.aging_bucket}</span>}</td>
              <td><span className={`badge ${STATUS_COLOR[r.status]||'badge-gray'}`}>{r.status}</span></td>
              <td className="text-xs">{r.collection_stage?.replace(/_/g,' ')}</td>
              <td><button onClick={()=>setEditing(editing===r.id?null:r.id)} className={`${smallBtn} bg-blue-600`}>{editing===r.id?'Close':'Update'}</button></td>
            </tr>
            {editing===r.id && (
              <tr key={`${r.id}-edit`}>
                <td colSpan={10} style={{background:'#f8fafc'}}>
                  <UpdateCollectionRow record={r} onSave={saveUpdate} />
                </td>
              </tr>
            )}
            </Fragment>
          ))}
            {!records?.length&&<tr><td colSpan={10} className="text-center py-8" style={{color:'var(--gray-400)'}}>No collection records yet — add one above</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewCollectionForm({ clients, onCreated }: { clients: any[]; onCreated: () => void }) {
  const [clientId, setClientId] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!clientId || !invoiceAmount) return;
    setBusy(true); setErr('');
    try {
      await apiFetch('/collections', {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId, invoice_ref: invoiceRef || undefined, invoice_date: invoiceDate || undefined,
          invoice_amount: parseFloat(invoiceAmount) || 0, due_date: dueDate || undefined,
        }),
      });
      setClientId(''); setInvoiceRef(''); setInvoiceDate(''); setInvoiceAmount(''); setDueDate('');
      onCreated();
    } catch (e: any) { setErr(e.message || 'Failed to create record'); }
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
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Invoice Ref</label><input value={invoiceRef} onChange={e => setInvoiceRef(e.target.value)} style={{ ...input, width: 130 }} /></div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Invoice Date</label><input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} style={input} /></div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Invoice Amount</label><input type="number" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)} style={{ ...input, width: 120 }} /></div>
        <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Due Date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={input} /></div>
        <button onClick={submit} disabled={!clientId || !invoiceAmount || busy} className={`${smallBtn} bg-[--color-primary]`} style={{ padding: '7px 14px' }}>
          <Plus className="h-3 w-3 inline mr-1" /> {busy ? 'Saving…' : 'New Collection Record'}
        </button>
      </div>
      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
    </div>
  );
}

function UpdateCollectionRow({ record, onSave }: { record: any; onSave: (r: any, patch: any) => void }) {
  const [collected, setCollected] = useState(String(record.collected_amount ?? 0));
  const [collectedDate, setCollectedDate] = useState(record.collected_date ?? '');
  const [stage, setStage] = useState(record.collection_stage ?? 'invoice_raised');
  const [notes, setNotes] = useState(record.notes ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-end gap-3 p-3">
      <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Collected Amount</label><input type="number" value={collected} onChange={e => setCollected(e.target.value)} style={{ ...input, width: 120 }} /></div>
      <div><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Collected Date</label><input type="date" value={collectedDate} onChange={e => setCollectedDate(e.target.value)} style={input} /></div>
      <div>
        <label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Stage</label>
        <select value={stage} onChange={e => setStage(e.target.value)} style={{ ...input, minWidth: 150 }}>
          {STAGES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div className="flex-1 min-w-[160px]"><label className="block text-[10px] font-semibold text-gray-400 mb-1 uppercase">Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} style={{ ...input, width: '100%' }} /></div>
      <button
        onClick={async () => { setBusy(true); await onSave(record, { collected_amount: parseFloat(collected) || 0, collected_date: collectedDate || null, collection_stage: stage, notes: notes || null }); setBusy(false); }}
        disabled={busy}
        className={`${smallBtn} bg-green-600`}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
