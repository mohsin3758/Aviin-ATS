'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus, Star } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };

export default function ReferenceChecksPage() {
  const { data: candidates } = useFetch<any>('/candidates?limit=200');
  const { data: checks, refetch } = useFetch<any[]>('/refcheck');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ candidate_id: '', referee_name: '', referee_email: '', referee_phone: '', relationship: '', company: '' });
  const [saving, setSaving] = useState(false);
  const candList = candidates?.items || [];

  const create = async () => {
    if (!form.candidate_id || !form.referee_name || !form.referee_email) return;
    setSaving(true);
    try {
      await apiFetch('/refcheck', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false); setForm({ candidate_id: '', referee_name: '', referee_email: '', referee_phone: '', relationship: '', company: '' }); refetch();
    } finally { setSaving(false); }
  };

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Reference Checks</h1>
          <p style={{ fontSize: 13, color: '#64748B' }}>Request references by email; referees respond via a secure link, no login required.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} style={{ ...btn, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Plus size={14} /> Request Reference
        </button>
      </div>
      {showForm && (
        <div style={card}>
          <label style={label}>CANDIDATE</label>
          <select value={form.candidate_id} onChange={e => setForm({ ...form, candidate_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {candList.map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <label style={label}>REFEREE NAME</label>
          <input value={form.referee_name} onChange={e => setForm({ ...form, referee_name: e.target.value })} style={input} />
          <label style={label}>REFEREE EMAIL</label>
          <input value={form.referee_email} onChange={e => setForm({ ...form, referee_email: e.target.value })} style={input} />
          <label style={label}>RELATIONSHIP</label>
          <input value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })} placeholder="e.g. Former manager" style={input} />
          <label style={label}>COMPANY</label>
          <input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} style={input} />
          <button onClick={create} disabled={saving} style={btn}>{saving ? 'Sending…' : 'Send Request'}</button>
        </div>
      )}
      <div style={card}>
        {(checks || []).map((c: any) => (
          <div key={c.id} style={{ padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontWeight: 700, flex: 1 }}>{c.candidate_name} — ref by {c.referee_name}</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: c.status === 'completed' ? '#F0FDF4' : '#FFFBEB', color: c.status === 'completed' ? '#16A34A' : '#D97706' }}>{c.status}</span>
            </div>
            {c.response_submitted_at && (
              <div style={{ marginTop: 6, color: '#374151' }}>
                <div style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
                  {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={12} fill={i < (c.q7_overall_rating || 0) ? '#F59E0B' : 'none'} color="#F59E0B" />)}
                  <span style={{ marginLeft: 6, color: '#64748B' }}>Would rehire: {c.q4_rehire ? 'Yes' : 'No'}</span>
                </div>
                {c.q5_strengths && <div>Strengths: {c.q5_strengths}</div>}
                {c.q6_concerns && <div>Concerns: {c.q6_concerns}</div>}
              </div>
            )}
          </div>
        ))}
        {!checks?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No reference checks requested yet.</div>}
      </div>
    </div>
  );
}
