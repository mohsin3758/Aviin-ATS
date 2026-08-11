'use client';
import { useState } from 'react';
import { ClipboardList, CheckCircle, Clock, Users, AlertTriangle, Plus, X } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';

const fld: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 10 };
const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };

// 2026-08-11 audit finding: the backend has always had a real, working
// POST /onboarding — this page's own empty state just said "POST
// /onboarding to create" because no form was ever built to call it.
function NewOnboardingModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: templates } = useFetch<any[]>('/onboarding/templates');
  const [candQuery, setCandQuery] = useState('');
  const [candResults, setCandResults] = useState<any[]>([]);
  const [candidate, setCandidate] = useState<any>(null);
  const [templateId, setTemplateId] = useState('');
  const [clientName, setClientName] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [hrSpoc, setHrSpoc] = useState('');
  const [hrPhone, setHrPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function searchCandidates(q: string) {
    setCandQuery(q); setCandidate(null);
    if (q.trim().length < 2) { setCandResults([]); return; }
    try {
      const rows = await apiFetch(`/candidates?search=${encodeURIComponent(q)}&limit=8`);
      setCandResults(Array.isArray(rows) ? rows : rows?.items || []);
    } catch { setCandResults([]); }
  }

  async function submit() {
    if (!candidate) { setErr('Pick a candidate first'); return; }
    setSaving(true); setErr('');
    try {
      await apiFetch('/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          candidate_id: candidate.id,
          template_id: templateId || null,
          client_name: clientName || null,
          joining_date: joiningDate || null,
          hr_spoc: hrSpoc || null,
          hr_phone: hrPhone || null,
          notes: notes || null,
        }),
      });
      onCreated(); onClose();
    } catch (e: any) { setErr(e?.message || 'Failed to create onboarding record'); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440, padding: 22, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>New Onboarding</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={18} /></button>
        </div>
        {err && <div style={{ background: '#FEF2F2', color: '#DC2626', fontSize: 12, padding: '8px 10px', borderRadius: 8, marginBottom: 10 }}>{err}</div>}

        <label style={lbl}>CANDIDATE *</label>
        <input value={candidate ? candidate.full_name : candQuery} onChange={e => searchCandidates(e.target.value)}
          placeholder="Search by name or email…" style={fld} />
        {candResults.length > 0 && !candidate && (
          <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, marginTop: -6, marginBottom: 10, maxHeight: 160, overflowY: 'auto' }}>
            {candResults.map((c: any) => (
              <div key={c.id} onClick={() => { setCandidate(c); setCandResults([]); }}
                style={{ padding: '8px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ fontWeight: 600 }}>{c.full_name}</div>
                <div style={{ color: '#94A3B8', fontSize: 11 }}>{c.email}</div>
              </div>
            ))}
          </div>
        )}

        <label style={lbl}>TEMPLATE</label>
        <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={fld}>
          <option value="">No template (blank checklist)</option>
          {(templates || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <label style={lbl}>CLIENT NAME</label>
        <input value={clientName} onChange={e => setClientName(e.target.value)} style={fld} />

        <label style={lbl}>JOINING DATE</label>
        <input type="date" value={joiningDate} onChange={e => setJoiningDate(e.target.value)} style={fld} />

        <label style={lbl}>HR SPOC</label>
        <input value={hrSpoc} onChange={e => setHrSpoc(e.target.value)} style={fld} />

        <label style={lbl}>HR PHONE</label>
        <input value={hrPhone} onChange={e => setHrPhone(e.target.value)} style={fld} />

        <label style={lbl}>NOTES</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...fld, resize: 'vertical' as const }} />

        <button onClick={submit} disabled={saving || !candidate}
          style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: saving || !candidate ? 'not-allowed' : 'pointer', background: saving || !candidate ? '#94A3B8' : '#0F766E', color: '#fff' }}>
          {saving ? 'Creating…' : 'Create Onboarding'}
        </button>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const {data:stats}=useFetch<any>('/onboarding/summary/stats');
  const {data:list,loading,refetch}=useFetch<any[]>('/onboarding');
  const [selected,setSelected]=useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  async function toggleTask(id:string,taskId:number,done:boolean){await apiFetch(`/onboarding/${id}/task`,{method:'PATCH',body:JSON.stringify({task_id:taskId,completed:done})});refetch();setSelected(null);}
  const ST:Record<string,string>={completed:'badge-green',in_progress:'badge-blue',not_started:'badge-gray',cancelled:'badge-red'};
  return (
    <div className="anim-fade-up space-y-6">
      <div className="page-hero" style={{background:'linear-gradient(135deg,#0f766e,#14b8a6,#2dd4bf)'}}>
        <div className="relative z-10"><h1 className="text-white text-2xl font-bold mb-1">📋 Employee Onboarding</h1><p className="text-teal-200 text-sm">Post-placement checklist · Document collection · Day 1 coordination · 10-step template</p></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['📋','Total',stats?.total||0,'#1e40af','#eff6ff'],['✅','Completed',stats?.completed||0,'#059669','#d1fae5'],['⏳','In Progress',stats?.in_progress||0,'#92400e','#fef3c7'],['🔔','Joining Soon (7d)',stats?.joining_soon||0,'#dc2626','#fee2e2']].map(([ic,l,v,col,bg])=>(
          <div key={l} className="stat-card"><div className="stat-icon" style={{background:bg}}>{ic}</div><div className="stat-value" style={{color:col}}>{v}</div><div className="stat-label">{l}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card overflow-hidden">
          <div className="card-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <h3>Active Onboardings</h3>
            <button onClick={()=>setShowNew(true)} className="btn btn-sm" style={{display:'flex',alignItems:'center',gap:4,background:'#0F766E',color:'#fff',border:'none'}}>
              <Plus size={13}/> New Onboarding
            </button>
          </div>
          {loading?<div className="p-8 text-center"><Spinner/></div>:
          <table className="data-table"><thead><tr><th>Candidate</th><th>Client</th><th>Joining</th><th>Progress</th><th>Status</th></tr></thead>
            <tbody>{(list||[]).map((o:any)=>(
              <tr key={o.id} className="cursor-pointer" onClick={()=>setSelected(o)}>
                <td><div className="font-medium text-sm">{o.candidate_name}</div><div className="text-xs" style={{color:'var(--gray-400)'}}>{o.candidate_email}</div></td>
                <td className="text-sm">{o.client_name||'—'}</td>
                <td className="text-xs">{o.joining_date||'—'}</td>
                <td><div className="flex items-center gap-2"><div className="progress-bar" style={{width:'70px',height:'6px'}}><div className="progress-fill" style={{width:`${o.total_count>0?(o.completed_count/o.total_count)*100:0}%`,background:'var(--accent)'}}/></div><span className="text-xs">{o.completed_count}/{o.total_count}</span></div></td>
                <td><span className={`badge ${ST[o.status]||'badge-gray'}`}>{o.status?.replace('_',' ')}</span></td>
              </tr>))}
              {!list?.length&&<tr><td colSpan={5} className="text-center py-8" style={{color:'var(--gray-400)'}}>No onboarding records yet — click "New Onboarding" to create one.</td></tr>}
            </tbody>
          </table>}
        </div>
        {selected && (
          <div className="card"><div className="card-header"><div><div className="font-semibold text-sm">{selected.candidate_name}</div><div className="text-xs mt-0.5" style={{color:'var(--gray-400)'}}>{selected.client_name}</div></div><button onClick={()=>setSelected(null)} className="btn btn-ghost btn-sm">×</button></div>
            <div className="card-body space-y-2.5 overflow-y-auto" style={{maxHeight:'400px'}}>
              {(selected.tasks||[]).map((t:any)=>(
                <div key={t.id} className="flex items-start gap-2.5 cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors" onClick={()=>toggleTask(selected.id,t.id,!t.completed)}>
                  <div className="mt-0.5">{t.completed?<CheckCircle size={16} style={{color:'var(--accent)'}}/>:<Clock size={16} style={{color:'var(--gray-300)'}}/>}</div>
                  <div><div className={`text-sm font-medium ${t.completed?'line-through text-gray-400':''}`}>{t.title}</div><div className="text-xs" style={{color:'var(--gray-400)'}}>{t.desc}</div></div>
                </div>))}
              {!selected.tasks?.length&&<div className="text-center py-4 text-sm" style={{color:'var(--gray-400)'}}>No tasks in checklist</div>}
            </div>
          </div>
        )}
        {!selected && (
          <div className="card"><div className="card-header"><h3>Checklist Template</h3></div><div className="card-body">
            <p className="text-sm mb-4" style={{color:'var(--gray-500)'}}>Standard IT Contractor onboarding includes 10 tasks:</p>
            <ol className="space-y-2">{['Collect Documents (Aadhaar, PAN, Degrees)','Send Offer Letter','Initiate BGV','PF/ESI Enrollment','Collect Bank Details','Client SPOC Introduction','Access Card/Laptop','Day 1 Check-in Call','30-Day Check-in','First Invoice Generation'].map((t,i)=>(
              <li key={i} className="flex items-center gap-2 text-xs" style={{color:'var(--gray-600)'}}><span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{background:'var(--primary-bg)',color:'var(--primary)'}}>{i+1}</span>{t}</li>
            ))}</ol>
          </div></div>
        )}
      </div>
      {showNew && <NewOnboardingModal onClose={()=>setShowNew(false)} onCreated={refetch}/>}
    </div>
  );
}
