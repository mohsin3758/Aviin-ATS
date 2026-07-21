'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Save } from 'lucide-react';

const FALLBACK_STAGE_LABELS: Record<string, string> = {
  contacted: 'Contacted', interested: 'Interested', nda: 'NDA', screened: 'Screened',
  submitted: 'Submitted', l1_interview: 'L1 Interview', l2_interview: 'L2 Interview',
  offer: 'Offer', offer_accepted: 'Offer Accepted', placed: 'Placed', hold: 'On Hold', rejected: 'Rejected',
};
const DEFAULT_WA_MSGS: Record<string, string> = {
  contacted: 'Hi {name}, we have reviewed your profile and would like to connect about an exciting opportunity. Our team will reach out shortly.',
  interested: 'Hi {name}, thank you for your interest! We are moving forward with your application.',
  nda: 'Hi {name}, please review and sign the NDA / pre-contract agreement we have shared with you by email.',
  screened: 'Hi {name}, congratulations! Your profile has been shortlisted after screening.',
  submitted: 'Hi {name}, your profile has been submitted to our client. We will update you soon.',
  l1_interview: 'Hi {name}, congratulations! You have been selected for the L1 interview.',
  l2_interview: 'Hi {name}, great news! You have cleared L1 and are selected for the L2 interview.',
  offer: 'Hi {name}, great news! An offer is being prepared for you.',
  offer_accepted: 'Hi {name}, congratulations on accepting the offer! Welcome aboard.',
  placed: 'Hi {name}, congratulations on your placement! Wishing you great success.',
  hold: 'Hi {name}, your application is currently on hold. We will update you as soon as there is movement.',
  rejected: 'Hi {name}, thank you for your time. We are unable to move forward with your application at this time.',
};

const COMMANDS = [
  { cmd: 'STATUS', desc: 'Check application status' },
  { cmd: 'INTERVIEW', desc: 'View upcoming interview details' },
  { cmd: 'CALLBACK', desc: 'Request recruiter callback' },
  { cmd: 'ACCEPT', desc: 'Accept your offer' },
  { cmd: 'DECLINE', desc: 'Decline your offer' },
];

function WhatsAppPageInner() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams?.get('tab') || 'session');
  const { data: status } = useFetch<any>('/whatsapp-bot/status');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  // ── Stage Notifications ──
  const { data: waSettings, refetch: refetchWaSettings } = useFetch<any>('/settings/whatsapp');
  const { data: stageConfig } = useFetch<any[]>('/settings/pipeline-stages');
  const [notifMode, setNotifMode] = useState<'auto' | 'manual'>('manual');
  const [stageMsgs, setStageMsgs] = useState<Record<string, string>>({});
  const [activeStageKey, setActiveStageKey] = useState('nda');
  const [savingStage, setSavingStage] = useState(false);
  const [stageSaveMsg, setStageSaveMsg] = useState('');

  useEffect(() => {
    if (waSettings) {
      if (waSettings.notification_mode) setNotifMode(waSettings.notification_mode);
      if (waSettings.stage_templates) {
        const flat: Record<string, string> = {};
        Object.entries(waSettings.stage_templates).forEach(([k, v]: [string, any]) => { flat[k] = v?.message || ''; });
        setStageMsgs(flat);
      }
    }
  }, [waSettings]);

  const stageOptions = (stageConfig || [])
    .filter((s: any) => s.stage_key !== 'sourced')
    .sort((a: any, b: any) => a.display_order - b.display_order)
    .map((s: any) => ({ key: s.stage_key, label: s.label }));
  const stageList = stageOptions.length > 0
    ? stageOptions
    : Object.entries(FALLBACK_STAGE_LABELS).map(([key, label]) => ({ key, label }));

  async function saveStageTemplates() {
    setSavingStage(true); setStageSaveMsg('');
    try {
      const stage_templates: Record<string, { message: string }> = {};
      Object.entries(stageMsgs).forEach(([k, v]) => { if (v?.trim()) stage_templates[k] = { message: v }; });
      await apiFetch('/settings/whatsapp', { method: 'PUT', body: JSON.stringify({ notification_mode: notifMode, stage_templates }) });
      setStageSaveMsg('Saved!');
      refetchWaSettings();
    } catch (e: any) {
      setStageSaveMsg('Save failed: ' + (e?.message || ''));
    } finally { setSavingStage(false); }
  }

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
        <button onClick={()=>setActiveTab('stage-notifications')} data-tab="stage-notifications" style={{padding:'8px 16px',background:activeTab==='stage-notifications'?'#4f46e5':'#e5e7eb',color:activeTab==='stage-notifications'?'white':'black',border:'none',borderRadius:'6px',cursor:'pointer'}}>Stage Notifications</button>
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

      {activeTab === 'stage-notifications' && (
        <div data-testid="stage-notifications-panel" style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1e293b' }}>WhatsApp Stage Notifications</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                Sent only to candidates with WhatsApp consent on file (HARD RULE #7 — DPDP 2023). Uses {'{name}'} as a placeholder.
              </p>
            </div>
            <button onClick={saveStageTemplates} disabled={savingStage}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: savingStage ? '#94a3b8' : '#1e40af', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: savingStage ? 'not-allowed' : 'pointer' }}>
              <Save size={14} /> {savingStage ? 'Saving…' : 'Save Templates'}
            </button>
          </div>

          {stageSaveMsg && <div style={{ marginBottom: 14, fontSize: 12, color: stageSaveMsg.startsWith('Saved') ? '#16a34a' : '#dc2626' }}>{stageSaveMsg}</div>}

          <div style={{ marginBottom: 20, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Send Mode</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setNotifMode('auto')} style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: `2px solid ${notifMode === 'auto' ? '#1e40af' : '#e2e8f0'}`, background: notifMode === 'auto' ? '#eff6ff' : 'white', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: notifMode === 'auto' ? '#1e40af' : '#374151' }}>Automatic</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Sends instantly on every stage change (consent permitting)</div>
              </button>
              <button onClick={() => setNotifMode('manual')} style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: `2px solid ${notifMode === 'manual' ? '#1e40af' : '#e2e8f0'}`, background: notifMode === 'manual' ? '#eff6ff' : 'white', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: notifMode === 'manual' ? '#1e40af' : '#374151' }}>Manual</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Recruiter confirms before each send</div>
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ width: 160, flexShrink: 0, borderRight: '1px solid #e2e8f0', background: '#f8fafc' }}>
              {stageList.map((st: any) => {
                const hasCustom = !!stageMsgs[st.key]?.trim();
                return (
                  <button key={st.key} onClick={() => setActiveStageKey(st.key)}
                    style={{ width: '100%', padding: '10px 12px', textAlign: 'left', border: 'none', borderBottom: '1px solid #e2e8f0', background: activeStageKey === st.key ? 'white' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: activeStageKey === st.key ? 700 : 500, color: activeStageKey === st.key ? '#1e40af' : '#374151' }}>{st.label}</span>
                    {hasCustom && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1, padding: 16 }}>
              {stageList.filter((s: any) => s.key === activeStageKey).map((st: any) => (
                <div key={st.key}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>{st.label} — WhatsApp Message</div>
                  <textarea rows={5} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
                    value={stageMsgs[st.key] || ''} placeholder={DEFAULT_WA_MSGS[st.key] || 'Message…'}
                    onChange={e => setStageMsgs(m => ({ ...m, [st.key]: e.target.value }))} />
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>Leave blank to use the built-in default message</div>
                  <button onClick={() => setStageMsgs(m => { const n = { ...m }; delete n[st.key]; return n; })}
                    style={{ marginTop: 10, padding: '6px 12px', border: '1px solid #fee2e2', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}>
                    Reset to Default
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WhatsAppPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#64748b', fontSize: 13 }}>
        Loading…
      </div>
    }>
      <WhatsAppPageInner />
    </Suspense>
  );
}
