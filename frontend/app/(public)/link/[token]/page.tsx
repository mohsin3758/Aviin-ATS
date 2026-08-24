'use client';
import { useState, useEffect } from 'react';
import { UploadCloud, CheckCircle, User } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface LinkInfo {
  recruiter_name: string;
  tenant_name: string;
}

export default function RecruiterPersonalLinkPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [form, setForm] = useState({ full_name: '', email: '', phone: '', location: '', current_employer: '', experience_months: '' });
  const [consent, setConsent] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_URL}/public/personal-links/${token}`);
        if (!r.ok) { setError('This link is invalid or has expired.'); setLoading(false); return; }
        setInfo(await r.json());
      } catch { setError('Could not load this link. Check your connection.'); }
      setLoading(false);
    })();
  }, [token]);

  async function submit() {
    if (!form.full_name || !form.email) { setError('Name and email are required'); return; }
    if (!consent) { setError('Please confirm you consent to us storing and processing your details before submitting'); return; }
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      fd.append('full_name', form.full_name);
      fd.append('email', form.email);
      if (form.phone) fd.append('phone', form.phone);
      if (form.location) fd.append('location', form.location);
      if (form.current_employer) fd.append('current_employer', form.current_employer);
      fd.append('experience_months', String(Number(form.experience_months) || 0));
      fd.append('consent_given', 'true');
      if (resumeFile) fd.append('resume', resumeFile);
      const r = await fetch(`${API_URL}/public/personal-links/${token}/apply`, { method: 'POST', body: fd });
      if (!r.ok) { const d = await r.json(); throw new Error(d.detail || 'Failed'); }
      setDone(true);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: '-apple-system,Segoe UI,sans-serif' };
  const card: React.CSSProperties = { background: 'white', borderRadius: '20px', padding: '32px 28px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' };
  const input: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, marginBottom: 12, boxSizing: 'border-box' };
  const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4, display: 'block' };

  if (loading) return <div style={wrap}><div style={{ color: 'white', fontSize: 14 }}>Loading…</div></div>;

  if (error && !info) {
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <CheckCircle size={48} color="#16a34a" style={{ marginBottom: 12 }} />
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Thank you!</h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
            Your resume has been sent to {info?.recruiter_name}. They'll reach out if there's a fit.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <User size={18} color="#1e40af" />
          <h2 style={{ margin: 0, fontSize: 18 }}>Send your resume to {info?.recruiter_name}</h2>
        </div>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 20px' }}>{info?.tenant_name}</p>

        <label style={label}>Full Name *</label>
        <input style={input} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />

        <label style={label}>Email *</label>
        <input style={input} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />

        <label style={label}>Phone</label>
        <input style={input} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />

        <label style={label}>Location</label>
        <input style={input} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} />

        <label style={label}>Current Employer</label>
        <input style={input} value={form.current_employer} onChange={e => setForm({ ...form, current_employer: e.target.value })} />

        <label style={label}>Total Experience (months)</label>
        <input style={input} type="number" value={form.experience_months} onChange={e => setForm({ ...form, experience_months: e.target.value })} />

        <label style={label}>Resume (optional)</label>
        <div style={{ ...input, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <UploadCloud size={16} color="#64748b" />
          <input type="file" accept=".pdf,.doc,.docx" onChange={e => setResumeFile(e.target.files?.[0] || null)} style={{ border: 'none', fontSize: 13 }} />
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#475569', margin: '8px 0 16px', cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
          I consent to my details and resume being stored and processed for recruitment purposes, in line with applicable data protection law.
        </label>

        {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <button
          onClick={submit}
          disabled={saving || !consent}
          style={{
            width: '100%', padding: '12px', background: (saving || !consent) ? '#94a3b8' : '#1e40af',
            color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700,
            cursor: (saving || !consent) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Submitting…' : 'Submit Resume'}
        </button>
      </div>
    </div>
  );
}
