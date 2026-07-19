'use client';
import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviinjobs.com/api';

interface OfferData {
  already_signed: boolean;
  candidate_name?: string;
  job_title?: string;
  company_name?: string;
  ctc_offered?: string;
  joining_date?: string;
  letter_text?: string;
}

function fmt_inr(s: string) {
  const n = Number(s);
  if (!n) return s;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export default function SignOfferPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [offer, setOffer] = useState<OfferData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/offer-sign/public?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (data.detail) { setError(data.detail); }
        else { setOffer(data); if (data.already_signed) setSigned(true); }
      })
      .catch(() => setError('Unable to load offer. Please try again.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function sign() {
    if (!name.trim()) { alert('Please enter your full name.'); return; }
    if (!agreed) { alert('Please check the agreement box to proceed.'); return; }
    setSigning(true);
    try {
      const r = await fetch(`${API_BASE}/offer-sign/sign?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatory_name: name.trim(), agreed }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.detail || 'Signing failed. Please try again.'); return; }
      setSigned(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSigning(false);
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>⏳</div>
        <p>Loading offer…</p>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', padding: '20px' }}>
      <div style={{ maxWidth: '440px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔗</div>
        <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>Invalid or Expired Link</h2>
        <p style={{ fontSize: '14px', color: '#64748b' }}>{error}</p>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '16px' }}>Please contact your recruiter for a new link.</p>
      </div>
    </div>
  );

  if (signed) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0fdf4', fontFamily: 'system-ui,sans-serif', padding: '20px' }}>
      <div style={{ maxWidth: '480px', textAlign: 'center', background: 'white', borderRadius: '16px', padding: '48px 40px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
        <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#14532d', marginBottom: '8px' }}>Offer Accepted!</h2>
        <p style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6' }}>
          {offer?.candidate_name ? `Dear ${offer.candidate_name},` : 'Dear Candidate,'}<br />
          Your e-signature has been recorded. You will receive a confirmation shortly from the hiring team.
        </p>
        <div style={{ marginTop: '24px', padding: '16px', background: '#f0fdf4', borderRadius: '10px', fontSize: '13px', color: '#16a34a' }}>
          ✓ Digitally signed via AVIIN ATS secure signing
        </div>
      </div>
    </div>
  );

  if (!offer) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', padding: '20px' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e40af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '6px' }}>
            AVIIN ATS · Offer E-Signature
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', margin: 0 }}>
            Your Offer Letter
          </h1>
        </div>

        {/* Offer summary card */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '24px', marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Candidate</div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{offer.candidate_name}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Position</div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{offer.job_title}</div>
            </div>
            {offer.ctc_offered && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>CTC Offered</div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#16a34a' }}>{fmt_inr(offer.ctc_offered)}</div>
              </div>
            )}
            {offer.joining_date && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Joining Date</div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{new Date(offer.joining_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
              </div>
            )}
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b' }}>from {offer.company_name}</div>
        </div>

        {/* Offer letter body */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '28px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Offer Letter</h3>
          <div style={{ fontSize: '14px', lineHeight: '1.8', color: '#374151', whiteSpace: 'pre-wrap', fontFamily: 'Georgia,serif' }}>
            {offer.letter_text}
          </div>
        </div>

        {/* Signature section */}
        <div style={{ background: 'white', borderRadius: '12px', border: '2px solid #1e40af', padding: '28px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>E-Signature</h3>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: '1.5' }}>
            By signing below, you confirm that you have read and accept the terms of this offer letter.
          </p>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#374151', marginBottom: '6px' }}>
              Full Name (as signature) <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Type your full legal name"
              style={{
                width: '100%', padding: '12px 14px', border: '1px solid #cbd5e1',
                borderRadius: '8px', fontSize: '14px', outline: 'none',
                fontFamily: 'Georgia,cursive', boxSizing: 'border-box',
                background: '#f8fafc',
              }}
            />
            {name && (
              <div style={{ marginTop: '8px', padding: '10px 14px', background: '#f0f4ff', borderRadius: '6px', fontFamily: 'Georgia,cursive', fontSize: '18px', color: '#1e40af', letterSpacing: '0.02em' }}>
                {name}
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '20px' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              style={{ marginTop: '2px', accentColor: '#1e40af', width: '16px', height: '16px' }}
            />
            <span style={{ fontSize: '13px', color: '#374151', lineHeight: '1.5' }}>
              I confirm I have read this offer letter and accept the terms. I understand this constitutes a legally binding e-signature.
            </span>
          </label>

          <button
            onClick={sign}
            disabled={signing || !name.trim() || !agreed}
            style={{
              width: '100%', padding: '14px', background: signing || !name.trim() || !agreed ? '#94a3b8' : '#1e40af',
              color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px',
              fontWeight: '700', cursor: signing || !name.trim() || !agreed ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {signing ? '⏳ Recording Signature…' : '✍️ Sign & Accept Offer'}
          </button>

          <p style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', marginTop: '12px' }}>
            Secured by AVIIN ATS · Your IP and timestamp will be recorded
          </p>
        </div>
      </div>
    </div>
  );
}
