'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };

const STATUS_COLORS: Record<string, [string, string]> = {
  submitted: ['#EFF6FF', '#2563EB'], client_review: ['#FFFBEB', '#D97706'], shortlisted: ['#F0FDF4', '#16A34A'],
  rejected: ['#FEF2F2', '#DC2626'], withdrawn: ['#F1F5F9', '#64748B'],
};

export default function SubmittalsPage() {
  const { data: apps } = useFetch<any[]>('/applications?limit=300&stage=submitted');
  const { data: submittals, refetch } = useFetch<any[]>('/submittals');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ application_id: '', submitted_rate: '', rate_type: 'annual' });
  const appList = (apps || []).filter((a: any) => !(submittals || []).some((s: any) => s.application_id === a.id));

  const create = async () => {
    if (!form.application_id) return;
    await apiFetch('/submittals', { method: 'POST', body: JSON.stringify({ ...form, submitted_rate: form.submitted_rate ? +form.submitted_rate : null }) });
    setShowForm(false); setForm({ application_id: '', submitted_rate: '', rate_type: 'annual' }); refetch();
  };
  const update = async (id: string, patch: any) => { await apiFetch(`/submittals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); refetch(); };

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Submittals</h1>
          <p style={{ fontSize: 13, color: '#64748B' }}>Rate submitted to the client and their feedback, per application.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} style={{ ...btn, display: 'flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> Log Submittal</button>
      </div>
      {showForm && (
        <div style={card}>
          <label style={label}>APPLICATION (STAGE = SUBMITTED)</label>
          <select value={form.application_id} onChange={e => setForm({ ...form, application_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {appList.map((a: any) => <option key={a.id} value={a.id}>{a.candidate_name} — {a.job_title}</option>)}
          </select>
          <label style={label}>SUBMITTED RATE</label>
          <input type="number" value={form.submitted_rate} onChange={e => setForm({ ...form, submitted_rate: e.target.value })} style={input} />
          <label style={label}>RATE TYPE</label>
          <select value={form.rate_type} onChange={e => setForm({ ...form, rate_type: e.target.value })} style={input}>
            <option value="annual">Annual</option><option value="monthly">Monthly</option><option value="daily">Daily</option><option value="hourly">Hourly</option>
          </select>
          <button onClick={create} style={btn}>Save</button>
        </div>
      )}
      <div style={card}>
        {(submittals || []).map((s: any) => {
          const [bg, fg] = STATUS_COLORS[s.status] || STATUS_COLORS.submitted;
          return (
            <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ flex: 1, fontWeight: 700 }}>{s.candidate_name} — {s.requisition_title}</span>
                <span>{s.submitted_rate ? `${s.submitted_rate} (${s.rate_type})` : '—'}</span>
                <select value={s.status} onChange={e => update(s.id, { status: e.target.value })}
                  style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: bg, color: fg, border: 'none' }}>
                  {Object.keys(STATUS_COLORS).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <textarea placeholder="Client feedback…" defaultValue={s.client_feedback || ''} onBlur={e => e.target.value !== (s.client_feedback || '') && update(s.id, { client_feedback: e.target.value })}
                style={{ ...input, marginTop: 6, minHeight: 40, fontFamily: 'inherit' }} />
            </div>
          );
        })}
        {!submittals?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No submittals logged yet.</div>}
      </div>
    </div>
  );
}
