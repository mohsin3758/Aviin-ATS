'use client';
import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviintech.com/api';

interface Req { id: string; title: string; location: string; employment_type: string; }
interface AgencyInfo { full_name: string; agency_name: string; }

export default function AgencySubmitPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [agency, setAgency] = useState<AgencyInfo | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    requisition_id: '', full_name: '', email: '', phone: '', total_exp_mo: '',
    current_employer: '', current_designation: '', expected_ctc: '', notes: '',
  });

  useEffect(() => {
    fetch(`${API_BASE}/agency-public/public?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (d.detail) setError(d.detail); else { setAgency(d.agency_user); setReqs(d.open_requisitions); } })
      .catch(() => setError('Unable to load this portal link.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (!form.requisition_id || !form.full_name) return;
    setSubmitting(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/agency-public/public/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...form, total_exp_mo: Number(form.total_exp_mo) || 0, expected_ctc: form.expected_ctc ? Number(form.expected_ctc) : null }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      setDone(true);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  if (loading) return <Center>Loading…</Center>;
  if (error && !agency) return <Center><p style={{ color: '#DC2626' }}>{error}</p></Center>;

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Welcome, {agency?.full_name}</h1>
      <p style={{ color: '#64748B', fontSize: 13, marginBottom: 20 }}>Submitting on behalf of <strong>{agency?.agency_name}</strong>. Select an open role and submit a candidate.</p>

      {done ? (
        <div style={{ padding: 20, background: '#F0FDF4', borderRadius: 12, color: '#166534', textAlign: 'center' }}>
          Candidate submitted — thank you!
          <div><button onClick={() => { setDone(false); setForm({ ...form, full_name: '', email: '', phone: '', notes: '' }); }}
            style={{ marginTop: 10, padding: '8px 16px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Submit Another</button></div>
        </div>
      ) : (
        <>
          <Field label="Open Role">
            <select value={form.requisition_id} onChange={e => setForm({ ...form, requisition_id: e.target.value })} style={inp}>
              <option value="">-- Select --</option>
              {reqs.map(r => <option key={r.id} value={r.id}>{r.title} {r.location ? `(${r.location})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Candidate Name"><input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} style={inp} /></Field>
          <Field label="Email"><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inp} /></Field>
          <Field label="Phone"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} style={inp} /></Field>
          <Field label="Total Experience (months)"><input type="number" value={form.total_exp_mo} onChange={e => setForm({ ...form, total_exp_mo: e.target.value })} style={inp} /></Field>
          <Field label="Current Employer"><input value={form.current_employer} onChange={e => setForm({ ...form, current_employer: e.target.value })} style={inp} /></Field>
          <Field label="Current Designation"><input value={form.current_designation} onChange={e => setForm({ ...form, current_designation: e.target.value })} style={inp} /></Field>
          <Field label="Expected CTC"><input type="number" value={form.expected_ctc} onChange={e => setForm({ ...form, expected_ctc: e.target.value })} style={inp} /></Field>
          <Field label="Notes"><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ ...inp, minHeight: 60 }} /></Field>
          {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}
          <button onClick={submit} disabled={submitting} style={{ padding: '10px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
            {submitting ? 'Submitting…' : 'Submit Candidate'}
          </button>
        </>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', fontFamily: 'system-ui' }}>{children}</div>;
}
