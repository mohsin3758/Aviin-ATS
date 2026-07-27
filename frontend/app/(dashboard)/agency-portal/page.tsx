'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Plus, Copy, UserPlus } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };

export default function AgencyPortalPage() {
  const { data: agencies } = useFetch<any[]>('/vendor-analytics/vendors');
  const { data: agencyUsers, refetch: refetchUsers } = useFetch<any[]>('/agency/users');
  const { data: submissions, refetch: refetchSubs } = useFetch<any[]>('/agency/submissions');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ agency_id: '', email: '', full_name: '' });
  const [newLink, setNewLink] = useState('');
  const [converting, setConverting] = useState<string | null>(null);
  const agencyList = agencies || [];

  const create = async () => {
    if (!form.agency_id || !form.email || !form.full_name) return;
    const r = await apiFetch('/agency/users', { method: 'POST', body: JSON.stringify(form) });
    setNewLink(r.portal_url); setShowForm(false); setForm({ agency_id: '', email: '', full_name: '' }); refetchUsers();
  };
  const convert = async (id: string) => {
    setConverting(id);
    try { await apiFetch(`/agency/submissions/${id}/convert`, { method: 'POST' }); refetchSubs(); }
    finally { setConverting(null); }
  };

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Agency Portal</h1>
          <p style={{ fontSize: 13, color: '#64748B' }}>Give empanelled vendor agencies a no-login link to submit candidates directly to your open roles.</p>
        </div>
        <button onClick={() => setShowForm(v => !v)} style={{ ...btn, display: 'flex', gap: 6, alignItems: 'center' }}><Plus size={14} /> Invite Agency User</button>
      </div>

      {newLink && (
        <div style={{ ...card, background: '#EEF2FF', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, fontSize: 12 }}>{newLink}</span>
          <button onClick={() => navigator.clipboard.writeText(newLink)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><Copy size={14} /></button>
        </div>
      )}

      {showForm && (
        <div style={card}>
          <label style={label}>AGENCY</label>
          <select value={form.agency_id} onChange={e => setForm({ ...form, agency_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {agencyList.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {!agencyList.length && <div style={{ fontSize: 11, color: '#D97706', marginBottom: 8 }}>No vendor agencies yet — add one under Vendor Analytics first.</div>}
          <label style={label}>CONTACT NAME</label>
          <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} style={input} />
          <label style={label}>EMAIL</label>
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={input} />
          <button onClick={create} style={btn}>Generate Portal Link</button>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Agency Users ({agencyUsers?.length || 0})</div>
        {(agencyUsers || []).map((u: any) => (
          <div key={u.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1 }}><strong>{u.full_name}</strong> ({u.agency_name})</span>
            <span style={{ color: '#64748B' }}>{u.email}</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: u.is_active ? '#F0FDF4' : '#F1F5F9', color: u.is_active ? '#16A34A' : '#94A3B8' }}>{u.is_active ? 'active' : 'inactive'}</span>
          </div>
        ))}
        {!agencyUsers?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No agency users invited yet.</div>}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Submitted Candidates ({submissions?.length || 0})</div>
        {(submissions || []).map((s: any) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1 }}><strong>{s.full_name}</strong> — {s.requisition_title}</span>
            <span style={{ color: '#64748B' }}>via {s.agency_name}</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: '#FFFBEB', color: '#D97706' }}>{s.status}</span>
            {s.status === 'submitted' && (
              <button onClick={() => convert(s.id)} disabled={converting === s.id}
                style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: '#2563EB', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>
                <UserPlus size={12} /> {converting === s.id ? '…' : 'Convert to Candidate'}
              </button>
            )}
          </div>
        ))}
        {!submissions?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No submissions yet.</div>}
      </div>
    </div>
  );
}
