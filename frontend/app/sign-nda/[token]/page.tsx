'use client';
import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://ats.aviinjobs.com/api';

interface NdaData {
  already_signed: boolean;
  candidate_name?: string;
  job_title?: string;
  company_name?: string;
  letter_text?: string;
  otp_required?: boolean;
  has_attached_file?: boolean;
  attached_file_name?: string;
}

export default function SignNdaPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [nda, setNda] = useState<NdaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/nda-sign/public?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (data.detail) { setError(data.detail); }
        else { setNda(data); if (data.already_signed) setSigned(true); }
      })
      .catch(() => setError('Unable to load NDA. Please try again.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function sendOtp() {
    setSendingOtp(true);
    try {
      const r = await fetch(`${API_BASE}/nda-sign/request-otp?token=${encodeURIComponent(token)}`, { method: 'POST' });
      if (!r.ok) { setError('Could not send verification code. Please try again.'); return; }
      setOtpSent(true);
    } catch {
      setError('Network error sending verification code.');
    } finally {
      setSendingOtp(false);
    }
  }

  async function sign() {
    if (!name.trim()) { alert('Please enter your full name.'); return; }
    if (!agreed) { alert('Please check the agreement box to proceed.'); return; }
    if (nda?.otp_required && !otpCode.trim()) { alert('Please enter the verification code sent to your email.'); return; }
    setSigning(true);
    try {
      const r = await fetch(`${API_BASE}/nda-sign/sign?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatory_name: name.trim(), otp_code: nda?.otp_required ? otpCode.trim() : undefined }),
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
        <p>Loading NDA…</p>
      </div>
    </div>
  );

  if (error && !nda) return (
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
        <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#14532d', marginBottom: '8px' }}>NDA Signed!</h2>
        <p style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6' }}>
          {nda?.candidate_name ? `Dear ${nda.candidate_name},` : 'Dear Candidate,'}<br />
          Your e-signature has been recorded. Our team will now move forward with the internal screening step.
        </p>
        <div style={{ marginTop: '24px', padding: '16px', background: '#f0fdf4', borderRadius: '10px', fontSize: '13px', color: '#16a34a' }}>
          ✓ Digitally signed via AVIIN ATS secure signing
        </div>
      </div>
    </div>
  );

  if (!nda) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', padding: '20px' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e40af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '6px' }}>
            AVIIN ATS · NDA E-Signature
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', margin: 0 }}>
            Non-Disclosure / Pre-Contract Agreement
          </h1>
        </div>

        {/* Summary card */}
        <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '24px', marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Candidate</div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{nda.candidate_name}</div>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Position</div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{nda.job_title}</div>
            </div>
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b' }}>from {nda.company_name}</div>
        </div>

        {/* NDA body */}
        {nda.has_attached_file ? (
          <div style={{ background: 'white', borderRadius: '12px', border: '2px solid #1e40af', padding: '28px', marginBottom: '20px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Document to Review</h3>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
              Please download and read the full document before signing below.
            </p>
            <a href={`${API_BASE}/nda-sign/attached-file?token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '12px 24px', background: '#1e40af', color: 'white', borderRadius: '10px', textDecoration: 'none', fontSize: '14px', fontWeight: '700' }}>
              📄 Download {nda.attached_file_name || 'Document'}
            </a>
          </div>
        ) : (
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '28px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#374151', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Agreement Text</h3>
            <div style={{ fontSize: '14px', lineHeight: '1.8', color: '#374151', whiteSpace: 'pre-wrap', fontFamily: 'Georgia,serif' }}>
              {nda.letter_text}
            </div>
          </div>
        )}

        {/* Signature section */}
        <div style={{ background: 'white', borderRadius: '12px', border: '2px solid #1e40af', padding: '28px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>E-Signature</h3>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: '1.5' }}>
            By signing below, you confirm that you have read and accept the terms of this agreement.
          </p>

          {error && (
            <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px', color: '#dc2626' }}>
              {error}
            </div>
          )}

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

          {nda.otp_required && (
            <div style={{ marginBottom: '16px', padding: '14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#374151', marginBottom: '8px' }}>
                Email Verification <span style={{ color: '#ef4444' }}>*</span>
              </label>
              {!otpSent ? (
                <button onClick={sendOtp} disabled={sendingOtp}
                  style={{ padding: '9px 16px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: sendingOtp ? 'not-allowed' : 'pointer' }}>
                  {sendingOtp ? 'Sending…' : '📧 Send Verification Code'}
                </button>
              ) : (
                <>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit code from your email"
                    maxLength={6}
                    style={{ width: '100%', padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '18px', letterSpacing: '0.3em', textAlign: 'center', outline: 'none', boxSizing: 'border-box' }}
                  />
                  <button onClick={sendOtp} disabled={sendingOtp} style={{ marginTop: '8px', background: 'none', border: 'none', color: '#1e40af', fontSize: '12px', fontWeight: '600', cursor: 'pointer', padding: 0 }}>
                    {sendingOtp ? 'Resending…' : 'Resend code'}
                  </button>
                </>
              )}
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '20px' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              style={{ marginTop: '2px', accentColor: '#1e40af', width: '16px', height: '16px' }}
            />
            <span style={{ fontSize: '13px', color: '#374151', lineHeight: '1.5' }}>
              I confirm I have read this agreement and accept its terms. I understand this constitutes a legally binding e-signature.
            </span>
          </label>

          <button
            onClick={sign}
            disabled={signing || !name.trim() || !agreed || (nda.otp_required && !otpCode.trim())}
            style={{
              width: '100%', padding: '14px',
              background: (signing || !name.trim() || !agreed || (nda.otp_required && !otpCode.trim())) ? '#94a3b8' : '#1e40af',
              color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px',
              fontWeight: '700', cursor: (signing || !name.trim() || !agreed) ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {signing ? '⏳ Recording Signature…' : '✍️ Sign NDA'}
          </button>

          <p style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', marginTop: '12px' }}>
            Secured by AVIIN ATS · Your IP and timestamp will be recorded
          </p>
        </div>
      </div>
    </div>
  );
}
