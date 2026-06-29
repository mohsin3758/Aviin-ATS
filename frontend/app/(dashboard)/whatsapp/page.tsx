'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';

const COMMANDS = [
  { cmd: 'STATUS', desc: 'Check application status' },
  { cmd: 'INTERVIEW', desc: 'View upcoming interview details' },
  { cmd: 'CALLBACK', desc: 'Request recruiter callback' },
  { cmd: 'ACCEPT', desc: 'Accept your offer' },
  { cmd: 'DECLINE', desc: 'Decline your offer' },
];

export default function WhatsAppPage() {
  const [activeTab, setActiveTab] = useState('session');
  const { data: status } = useFetch<any>('/whatsapp-bot/status');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  const inputStyle = {
    width: '100%',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '9px 12px',
    fontSize: '13px',
    outline: 'none',
    background: 'white',
    boxSizing: 'border-box' as const,
    marginBottom: '8px',
  };

  async function sendMsg() {
    setSending(true);
    try {
      const r = await apiFetch(
        '/whatsapp-bot/send?phone=' + encodeURIComponent(phone) + '&message=' + encodeURIComponent(msg),
        { method: 'POST' }
      );
      setResult(r.sent ? '✅ Sent' : '❌ Failed');
    } catch {
      setResult('❌ Error sending message');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="anim-fade-up space-y-6">
      <div style={{display:'flex',gap:'8px',marginBottom:'16px'}}>
        <button onClick={()=>setActiveTab('session')} data-tab="session" style={{padding:'8px 16px',background:activeTab==='session'?'#4f46e5':'#e5e7eb',color:activeTab==='session'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer'}}>Session</button>
        <button onClick={()=>setActiveTab('templates')} data-tab="templates" style={{padding:'8px 16px',background:activeTab==='templates'?'#4f46e5':'#e5e7eb',color:activeTab==='templates'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer'}}>Templates</button>
        <button onClick={()=>setActiveTab('consent')} data-tab="consent" style={{padding:'8px 16px',background:activeTab==='consent'?'#4f46e5':'#e5e7eb',color:activeTab==='consent'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer'}}>Consent</button>
      </div>

      {activeTab === 'session' && (
        <div data-testid="session-panel">
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a' }}>WhatsApp Bot</h1>
            <p style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
              Candidate self-service via WAHA — STATUS · INTERVIEW · CALLBACK
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px', marginTop: '16px' }}>
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
              <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '12px', color: '#0f172a' }}>Bot Status</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: status?.waha_connected ? '#22c55e' : '#ef4444' }}></div>
                <span style={{ fontSize: '13px', fontWeight: '600', color: status?.waha_connected ? '#059669' : '#dc2626' }}>
                  {status?.waha_connected ? 'WAHA Connected' : 'WAHA Disconnected'}
                </span>
              </div>
              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px' }}>
                <div style={{ fontWeight: '600', marginBottom: '10px', fontSize: '12px', color: '#374151' }}>Available Commands:</div>
                {COMMANDS.map(({ cmd, desc }) => (
                  <div key={cmd} style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'flex-start' }}>
                    <code style={{ background: '#e2e8f0', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace' }}>
                      {cmd}
                    </code>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
              <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '12px', color: '#0f172a' }}>Send Test Message</div>
              <input
                placeholder="+91 9876543210"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                style={inputStyle}
              />
              <textarea
                placeholder="Type your WhatsApp message..."
                value={msg}
                onChange={e => setMsg(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              <button
                onClick={sendMsg}
                disabled={!phone || !msg || sending}
                style={{
                  width: '100%', padding: '9px', background: '#22c55e', color: 'white',
                  border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                  cursor: 'pointer', opacity: (!phone || !msg || sending) ? 0.6 : 1,
                }}
              >
                {sending ? 'Sending...' : 'Send WhatsApp'}
              </button>
              {result && (
                <div style={{ marginTop: '8px', fontSize: '13px', textAlign: 'center', fontWeight: '600' }}>{result}</div>
              )}
            </div>
          </div>

          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginTop: '16px' }}>
            <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '12px', color: '#0f172a' }}>How Candidates Use the Bot</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
              {[
                { step: '1', title: 'Send WhatsApp', desc: 'Candidate texts their registered phone number to your WhatsApp number' },
                { step: '2', title: 'Type Command', desc: 'They type STATUS, INTERVIEW, CALLBACK, ACCEPT or DECLINE' },
                { step: '3', title: 'Get Instant Reply', desc: 'Bot responds with their application status, interview details, or logs a callback request' },
              ].map(s => (
                <div key={s.step} style={{ padding: '14px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#1e40af', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '13px', marginBottom: '10px' }}>{s.step}</div>
                  <div style={{ fontWeight: '600', fontSize: '13px', color: '#0f172a', marginBottom: '4px' }}>{s.title}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div data-testid="templates-panel" style={{padding:'20px',background:'white',borderRadius:'12px'}}>
          <h3>WhatsApp Message Templates</h3>
          <div><strong>Hindi:</strong> नमस्ते! आपका आवेदन प्राप्त हुआ।</div>
          <div><strong>Tamil:</strong> வணக்கம்! உங்கள் விண்ணப்பம் பெற்றப்பட்டது.</div>
          <div><strong>Telugu:</strong> నమస్కారం! మీ దరఖాస్తు అందుకోబడింది.</div>
          <div><strong>Kannada:</strong> ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಅರ್ಜಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ.</div>
        </div>
      )}

      {activeTab === 'consent' && (
        <div data-testid="consent-panel" style={{padding:'20px',background:'white',borderRadius:'12px'}}>
          <h3>Consent Management</h3>
          <p>Manage WhatsApp communication consent for candidates and employees.</p>
        </div>
      )}
    </div>
  );
}
