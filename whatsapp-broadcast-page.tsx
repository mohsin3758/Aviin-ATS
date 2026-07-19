'use client';
import { useState, useMemo } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Send, MessageSquare, Users, Eye, CheckCircle2, XCircle, AlertCircle, Wifi, WifiOff, ChevronDown } from 'lucide-react';

const COMMANDS = [
  { cmd: 'STATUS', desc: 'Check application status' },
  { cmd: 'INTERVIEW', desc: 'View upcoming interview details' },
  { cmd: 'CALLBACK', desc: 'Request recruiter callback' },
  { cmd: 'ACCEPT', desc: 'Accept your offer' },
  { cmd: 'DECLINE', desc: 'Decline your offer' },
];

const STAGE_OPTIONS = [
  { value: '', label: 'All Stages' },
  { value: 'sourced', label: 'Sourced' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'nda', label: 'NDA' },
  { value: 'screened', label: 'Screened' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'l1_interview', label: 'L1 Interview' },
  { value: 'l2_interview', label: 'L2 Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'offer_accepted', label: 'Offer Accepted' },
  { value: 'placed', label: 'Placed' },
];

const LANG_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu',
  kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', gu: 'Gujarati',
  pa: 'Punjabi', bn: 'Bengali', or: 'Odia', as: 'Assamese',
  ur: 'Urdu', kok: 'Konkani',
};

function extractVars(sample: string): string[] {
  const matches = sample.match(/\{(\w+)\}/g) || [];
  return [...new Set(matches.map(m => m.slice(1, -1)).filter(v => v !== 'name'))];
}

function renderPreview(sample: string, vars: Record<string, string>, name = 'Candidate') {
  return sample
    .replace('{name}', name || 'Candidate')
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] || `{${k}}`);
}

export default function WhatsAppPage() {
  const [activeTab, setActiveTab] = useState('broadcast');

  // Session tab state
  const { data: status } = useFetch<any>('/whatsapp/session/status');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState('');

  // Broadcast tab state
  const { data: templates } = useFetch<any[]>('/whatsapp/templates');
  const { data: candidatesRaw } = useFetch<any>('/candidates?limit=300&page=1');
  const [selectedTemplate, setSelectedTemplate] = useState('job_opportunity');
  const [selectedLang, setSelectedLang] = useState('en');
  const [vars, setVars] = useState<Record<string, string>>({ role: '', client: '', date: '', status: '' });
  const [stageFilter, setStageFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<any>(null);

  const candidates: any[] = useMemo(() => {
    const raw = candidatesRaw?.items || candidatesRaw?.data || candidatesRaw || [];
    if (!Array.isArray(raw)) return [];
    if (stageFilter) return raw.filter((c: any) => c.current_stage === stageFilter);
    return raw;
  }, [candidatesRaw, stageFilter]);

  const tmpl = templates?.find((t: any) => t.template_key === selectedTemplate);
  const sample = tmpl?.sample_en || '';
  const tmplVars = extractVars(sample);
  const langList: string[] = tmpl?.languages || ['en'];

  const selectedCandidates = candidates.filter(c => selectedIds.has(c.id));

  function toggleAll() {
    if (selectedIds.size === candidates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(candidates.map((c: any) => c.id)));
    }
  }

  function toggleOne(id: string) {
    const s = new Set(selectedIds);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelectedIds(s);
  }

  async function sendBroadcast() {
    if (!selectedIds.size) return alert('Select at least one candidate.');
    if (tmplVars.some(v => !vars[v])) return alert('Please fill all template variables.');
    setBroadcastLoading(true);
    setBroadcastResult(null);
    try {
      const recipients = selectedCandidates.map(c => ({
        candidate_id: c.id,
        phone: c.phone || '',
      }));
      const sharedVars: Record<string, string> = {};
      tmplVars.forEach(v => { sharedVars[v] = vars[v]; });
      const r = await apiFetch('/whatsapp/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_key: selectedTemplate,
          language: selectedLang,
          recipients,
          variables: sharedVars,
        }),
      });
      setBroadcastResult(r);
    } catch (e: any) {
      alert(e?.message || 'Broadcast failed');
    } finally {
      setBroadcastLoading(false);
    }
  }

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

  const isConnected = status?.status === 'WORKING' || status?.info?.status === 'WORKING';

  const tabStyle = (t: string) => ({
    padding: '8px 16px',
    background: activeTab === t ? '#1e40af' : 'transparent',
    color: activeTab === t ? 'white' : '#64748b',
    border: activeTab === t ? 'none' : '1px solid #e2e8f0',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600' as const,
  });

  return (
    <div className="anim-fade-up" style={{ maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0 }}>WhatsApp</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>Broadcast templates · Bot commands · Consent</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px',
          borderRadius: '20px', background: isConnected ? '#d1fae5' : '#fee2e2',
          border: `1px solid ${isConnected ? '#10b981' : '#ef4444'}` }}>
          {isConnected ? <Wifi size={13} style={{ color: '#059669' }} /> : <WifiOff size={13} style={{ color: '#dc2626' }} />}
          <span style={{ fontSize: '12px', fontWeight: '700', color: isConnected ? '#065f46' : '#991b1b' }}>
            {isConnected ? 'WAHA Connected' : 'Not Connected'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <button onClick={() => setActiveTab('broadcast')} style={tabStyle('broadcast')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Send size={13} /> Broadcast
          </span>
        </button>
        <button onClick={() => setActiveTab('session')} style={tabStyle('session')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <MessageSquare size={13} /> Bot / Session
          </span>
        </button>
        <button onClick={() => setActiveTab('templates')} style={tabStyle('templates')}>Templates</button>
        <button onClick={() => setActiveTab('consent')} style={tabStyle('consent')}>Consent</button>
      </div>

      {/* ═══════════════════════ BROADCAST TAB ═══════════════════════ */}
      {activeTab === 'broadcast' && (
        <div data-testid="broadcast-panel" style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '16px', alignItems: 'start' }}>

          {/* Left: config */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Template picker */}
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a', marginBottom: '10px' }}>
                1. Choose Template
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(templates || []).map((t: any) => (
                  <label key={t.template_key} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start',
                    padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                    background: selectedTemplate === t.template_key ? '#eff6ff' : '#f8fafc',
                    border: `1px solid ${selectedTemplate === t.template_key ? '#3b82f6' : '#e2e8f0'}` }}>
                    <input type="radio" name="tmpl" value={t.template_key}
                      checked={selectedTemplate === t.template_key}
                      onChange={() => { setSelectedTemplate(t.template_key); setBroadcastResult(null); }}
                      style={{ marginTop: '2px', accentColor: '#3b82f6' }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', textTransform: 'capitalize' }}>
                        {t.template_key.replace(/_/g, ' ')}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', lineHeight: '1.5' }}>
                        {t.sample_en?.slice(0, 80)}…
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Language */}
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a', marginBottom: '10px' }}>
                2. Language
              </div>
              <div style={{ position: 'relative' }}>
                <select value={selectedLang} onChange={e => setSelectedLang(e.target.value)}
                  style={{ width: '100%', padding: '9px 32px 9px 12px', borderRadius: '8px',
                    border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none',
                    background: 'white', appearance: 'none', cursor: 'pointer' }}>
                  {langList.map(l => (
                    <option key={l} value={l}>{LANG_NAMES[l] || l.toUpperCase()}</option>
                  ))}
                </select>
                <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%',
                  transform: 'translateY(-50%)', color: '#64748b', pointerEvents: 'none' }} />
              </div>
            </div>

            {/* Variables */}
            {tmplVars.length > 0 && (
              <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
                <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a', marginBottom: '10px' }}>
                  3. Fill Variables
                  <span style={{ fontWeight: '400', color: '#64748b', fontSize: '12px', marginLeft: '6px' }}>
                    ({'{name}'} is auto-filled)
                  </span>
                </div>
                {tmplVars.map(v => (
                  <div key={v} style={{ marginBottom: '8px' }}>
                    <label style={{ fontSize: '11px', fontWeight: '600', color: '#374151', textTransform: 'capitalize',
                      display: 'block', marginBottom: '4px' }}>
                      {'{' + v + '}'}
                    </label>
                    <input
                      value={vars[v] || ''}
                      onChange={e => setVars(prev => ({ ...prev, [v]: e.target.value }))}
                      placeholder={v === 'role' ? 'e.g. Python Developer' : v === 'client' ? 'e.g. TCS' : v === 'date' ? 'e.g. 15 Jul 2026, 10AM' : v}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '7px',
                        border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none',
                        boxSizing: 'border-box' as const }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            <button onClick={() => setShowPreview(!showPreview)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                padding: '9px', borderRadius: '8px', border: '1px solid #e2e8f0',
                background: showPreview ? '#eff6ff' : 'white', color: '#3b82f6',
                cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
              <Eye size={13} /> {showPreview ? 'Hide Preview' : 'Preview Message'}
            </button>
            {showPreview && sample && (
              <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '12px',
                padding: '14px 16px', fontSize: '13px', lineHeight: '1.6', color: '#14532d',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: '11px', fontWeight: '600', color: '#166534', marginBottom: '6px' }}>
                  📱 WhatsApp Preview
                </div>
                {renderPreview(sample, vars, selectedCandidates[0]?.full_name || 'Raj Kumar')}
              </div>
            )}
          </div>

          {/* Right: candidate picker + results */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Candidate list */}
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>
                  Select Recipients
                  <span style={{ fontWeight: '400', color: '#64748b', fontSize: '12px', marginLeft: '8px' }}>
                    {selectedIds.size} / {candidates.length} selected
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select value={stageFilter} onChange={e => { setStageFilter(e.target.value); setSelectedIds(new Set()); }}
                    style={{ padding: '6px 10px', borderRadius: '7px', border: '1px solid #e2e8f0',
                      fontSize: '12px', outline: 'none', cursor: 'pointer' }}>
                    {STAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button onClick={toggleAll}
                    style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid #3b82f6',
                      background: 'white', color: '#3b82f6', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                    {selectedIds.size === candidates.length && candidates.length > 0 ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>

              <div style={{ maxHeight: '340px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {candidates.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8', fontSize: '13px' }}>
                    No candidates found
                  </div>
                ) : candidates.map((c: any) => {
                  const checked = selectedIds.has(c.id);
                  const hasPhone = !!c.phone;
                  return (
                    <label key={c.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '8px 10px', borderRadius: '8px', cursor: hasPhone ? 'pointer' : 'not-allowed',
                        background: checked ? '#eff6ff' : 'transparent',
                        border: `1px solid ${checked ? '#bfdbfe' : 'transparent'}`,
                        opacity: hasPhone ? 1 : 0.5 }}>
                      <input type="checkbox" checked={checked} disabled={!hasPhone}
                        onChange={() => hasPhone && toggleOne(c.id)}
                        style={{ accentColor: '#3b82f6', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.full_name || 'Unknown'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>
                          {hasPhone ? c.phone : '⚠ no phone'} {c.current_employer ? `· ${c.current_employer}` : ''}
                        </div>
                      </div>
                      {c.current_stage && (
                        <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '10px',
                          background: '#f1f5f9', color: '#475569', fontWeight: '600', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {c.current_stage}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Send button */}
            <button onClick={sendBroadcast}
              disabled={broadcastLoading || selectedIds.size === 0}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '12px', borderRadius: '10px', border: 'none',
                background: broadcastLoading || selectedIds.size === 0
                  ? '#94a3b8'
                  : 'linear-gradient(135deg, #25d366, #128c7e)',
                color: 'white', fontSize: '14px', fontWeight: '700', cursor:
                broadcastLoading || selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                boxShadow: selectedIds.size > 0 ? '0 4px 12px rgba(37,211,102,0.35)' : 'none' }}>
              {broadcastLoading ? (
                <>
                  <div style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Sending to {selectedIds.size} candidates…
                </>
              ) : (
                <>
                  <Send size={15} />
                  Send to {selectedIds.size || 0} Candidate{selectedIds.size !== 1 ? 's' : ''}
                </>
              )}
            </button>

            {/* Results */}
            {broadcastResult && (
              <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
                <div style={{ fontWeight: '700', fontSize: '13px', color: '#0f172a', marginBottom: '12px' }}>
                  Broadcast Results
                </div>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                  {[
                    { label: 'Sent', value: broadcastResult.sent, color: '#065f46', bg: '#d1fae5', icon: <CheckCircle2 size={14} /> },
                    { label: 'Skipped', value: broadcastResult.skipped, color: '#92400e', bg: '#fef3c7', icon: <AlertCircle size={14} /> },
                    { label: 'Errors', value: broadcastResult.errors, color: '#991b1b', bg: '#fee2e2', icon: <XCircle size={14} /> },
                  ].map(({ label, value, color, bg, icon }) => (
                    <div key={label} style={{ flex: 1, textAlign: 'center', padding: '10px', borderRadius: '8px',
                      background: bg, color }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginBottom: '2px' }}>
                        {icon}
                        <span style={{ fontSize: '18px', fontWeight: '800' }}>{value}</span>
                      </div>
                      <div style={{ fontSize: '11px', fontWeight: '600' }}>{label}</div>
                    </div>
                  ))}
                </div>
                {broadcastResult.results?.length > 0 && (
                  <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                    {broadcastResult.results.map((r: any, i: number) => {
                      const cand = selectedCandidates.find(c => c.id === r.candidate_id);
                      const ok = r.status === 'sent';
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '6px 8px', borderRadius: '6px', marginBottom: '4px',
                          background: ok ? '#f0fdf4' : '#fef9c3', fontSize: '12px' }}>
                          {ok
                            ? <CheckCircle2 size={12} style={{ color: '#16a34a', flexShrink: 0 }} />
                            : <AlertCircle size={12} style={{ color: '#d97706', flexShrink: 0 }} />}
                          <span style={{ fontWeight: '600', color: '#0f172a' }}>
                            {cand?.full_name || r.candidate_id?.slice(0, 8)}
                          </span>
                          <span style={{ color: '#64748b', marginLeft: 'auto' }}>
                            {r.reason || r.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════ SESSION / BOT TAB ═══════════════════════ */}
      {activeTab === 'session' && (
        <div data-testid="session-panel">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
              <div style={{ fontWeight: '700', fontSize: '14px', marginBottom: '12px', color: '#0f172a' }}>Bot Status</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: isConnected ? '#22c55e' : '#ef4444' }} />
                <span style={{ fontSize: '13px', fontWeight: '600', color: isConnected ? '#059669' : '#dc2626' }}>
                  {isConnected ? 'WAHA Connected' : 'WAHA Disconnected'}
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
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (91XXXXXXXXXX)"
                style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '9px 12px',
                  fontSize: '13px', outline: 'none', background: 'white', boxSizing: 'border-box' as const, marginBottom: '8px' }} />
              <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Message text…"
                rows={3}
                style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '9px 12px',
                  fontSize: '13px', outline: 'none', background: 'white', boxSizing: 'border-box' as const,
                  marginBottom: '10px', resize: 'vertical', fontFamily: 'inherit' }} />
              <button onClick={sendMsg} disabled={!phone || !msg || sending}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  width: '100%', padding: '9px', borderRadius: '8px',
                  background: '#25d366', color: 'white', border: 'none', fontSize: '13px', fontWeight: '600',
                  cursor: 'pointer', opacity: (!phone || !msg || sending) ? 0.6 : 1 }}>
                {sending ? 'Sending...' : <><Send size={13} /> Send WhatsApp</>}
              </button>
              {result && <div style={{ marginTop: '8px', fontSize: '13px', textAlign: 'center', fontWeight: '600' }}>{result}</div>}
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
                  <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#1e40af', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '13px', marginBottom: '10px' }}>
                    {s.step}
                  </div>
                  <div style={{ fontWeight: '600', fontSize: '13px', color: '#0f172a', marginBottom: '4px' }}>{s.title}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════ TEMPLATES TAB ═══════════════════════ */}
      {activeTab === 'templates' && (
        <div data-testid="templates-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {(templates || []).map((t: any) => (
            <div key={t.template_key} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a', textTransform: 'capitalize' }}>
                  {t.template_key.replace(/_/g, ' ')}
                </div>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: '#eff6ff', color: '#3b82f6', fontWeight: '600' }}>
                  {t.languages?.length || 0} languages
                </span>
              </div>
              <div style={{ background: '#dcfce7', borderRadius: '10px', padding: '12px 14px',
                fontSize: '13px', color: '#14532d', marginBottom: '12px', lineHeight: '1.6' }}>
                {t.sample_en}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {(t.languages || []).map((l: string) => (
                  <span key={l} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '8px',
                    background: '#f1f5f9', color: '#475569', fontWeight: '500' }}>
                    {LANG_NAMES[l] || l}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════════════════ CONSENT TAB ═══════════════════════ */}
      {activeTab === 'consent' && (
        <div data-testid="consent-panel" style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '28px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔒</div>
          <h3 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>Consent Management</h3>
          <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '400px', margin: '0 auto 16px', lineHeight: '1.7' }}>
            WhatsApp Business requires opt-in consent before sending promotional messages.
            Candidates with <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', fontSize: '11px' }}>no_consent</code> status
            will be skipped automatically.
          </p>
          <p style={{ fontSize: '13px', color: '#64748b', maxWidth: '400px', margin: '0 auto' }}>
            To collect consent, include an opt-in link in your onboarding emails or SMS messages.
          </p>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
