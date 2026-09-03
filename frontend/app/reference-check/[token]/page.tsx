'use client';
import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviintech.com/api';

interface RefData {
  id: string;
  candidate_name: string;
  referee_name: string;
  relationship: string;
  company: string;
  status: string;
}

export default function ReferenceCheckPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<RefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    q1_known_duration: '', q2_work_quality: 4, q3_reliability: 4,
    q4_rehire: true, q5_strengths: '', q6_concerns: '', q7_overall_rating: 4,
  });

  useEffect(() => {
    fetch(`${API_BASE}/ref-public?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => { if (d.detail) setError(d.detail); else { setData(d); if (d.status === 'completed') setDone(true); } })
      .catch(() => setError('Unable to load this reference request.'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/ref-public/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...form }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      setDone(true);
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  if (loading) return <Center>Loading…</Center>;
  if (error) return <Center><p style={{ color: '#DC2626' }}>{error}</p></Center>;
  if (done) return <Center><h2>Thank you!</h2><p>Your reference has been submitted.</p></Center>;

  const stars = (val: number, onChange: (v: number) => void) => (
    <div style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} onClick={() => onChange(n)} style={{ cursor: 'pointer', fontSize: 24, color: n <= val ? '#F59E0B' : '#E2E8F0' }}>★</span>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800 }}>Reference for {data?.candidate_name}</h1>
      <p style={{ color: '#64748B', fontSize: 13, marginBottom: 24 }}>You're listed as a reference by {data?.candidate_name}. Please share your honest feedback — it takes about 2 minutes.</p>

      <Field label="How long have you known them, and in what capacity?">
        <textarea value={form.q1_known_duration} onChange={e => setForm({ ...form, q1_known_duration: e.target.value })} style={ta} />
      </Field>
      <Field label="Quality of work">{stars(form.q2_work_quality, v => setForm({ ...form, q2_work_quality: v }))}</Field>
      <Field label="Reliability">{stars(form.q3_reliability, v => setForm({ ...form, q3_reliability: v }))}</Field>
      <Field label="Overall rating">{stars(form.q7_overall_rating, v => setForm({ ...form, q7_overall_rating: v }))}</Field>
      <Field label="Would you rehire them?">
        <select value={form.q4_rehire ? 'yes' : 'no'} onChange={e => setForm({ ...form, q4_rehire: e.target.value === 'yes' })} style={inp}>
          <option value="yes">Yes</option><option value="no">No</option>
        </select>
      </Field>
      <Field label="Key strengths">
        <textarea value={form.q5_strengths} onChange={e => setForm({ ...form, q5_strengths: e.target.value })} style={ta} />
      </Field>
      <Field label="Any concerns? (optional)">
        <textarea value={form.q6_concerns} onChange={e => setForm({ ...form, q6_concerns: e.target.value })} style={ta} />
      </Field>
      {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}
      <button onClick={submit} disabled={submitting} style={{ padding: '10px 24px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
        {submitting ? 'Submitting…' : 'Submit Reference'}
      </button>
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13 };
const ta: React.CSSProperties = { ...inp, minHeight: 70, fontFamily: 'inherit' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', fontFamily: 'system-ui' }}>{children}</div>;
}
