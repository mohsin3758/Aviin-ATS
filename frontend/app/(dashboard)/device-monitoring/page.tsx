'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import { Laptop, ShieldCheck, Clock, Globe, Trash2, KeyRound, Download, CheckCircle2, XCircle, Camera, Keyboard, ShieldAlert, EyeOff, Eye, Video, Plus } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('airecruit_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnDanger: React.CSSProperties = { ...btn, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' };
const btnGhost: React.CSSProperties = { ...btn, background: '#fff', color: '#374151', border: '1px solid #E2E8F0' };
const select: React.CSSProperties = { padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12 };

function fmtHours(seconds: number) {
  return (seconds / 3600).toFixed(1) + 'h';
}

// Same authenticated-blob-download pattern already used for resume
// downloads elsewhere in this app (candidates/[id]/page.tsx) — these are
// JWT-gated endpoints, not public URLs, so a plain <a href> won't carry
// the auth header.
async function downloadFile(path: string, filename: string) {
  const token = localStorage.getItem('airecruit_token');
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api';
  try {
    const resp = await fetch(`${apiBase}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!resp.ok) { alert('Download failed: ' + resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { alert('Download error: ' + String(e)); }
}

function ScreenshotThumb({ id, isBlurred }: { id: string; isBlurred: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/device-monitoring/screenshots/${id}/image`, { headers: authHeaders() });
        if (!r.ok) return;
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        revoke = url;
        setSrc(url);
      } catch { /* ignore */ }
    })();
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [id]);
  return (
    <div style={{ position: 'relative', width: 140, height: 90, borderRadius: 8, overflow: 'hidden', background: '#F1F5F9', border: '1px solid #E2E8F0' }}>
      {src ? <img src={src} alt="screenshot" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#94A3B8' }}>Loading…</div>}
      {isBlurred && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,0.6)', color: 'white' }}>BLURRED</span>}
    </div>
  );
}

// Per-device extended-scope settings — self-service by the device owner
// (same self-determination principle as the rest of this feature: no
// admin-push, the person themselves controls what runs on their own
// enrolled device) or by admin/manager.
function DeviceExtendedSettings({ device, canEdit, onSaved }: { device: any; canEdit: boolean; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const update = async (patch: any) => {
    setSaving(true);
    try { await apiFetch(`/device-monitoring/devices/${device.id}/settings`, { method: 'PATCH', body: JSON.stringify(patch) }); onSaved(); }
    catch (e: any) { alert(e.message || 'Failed to update — extended consent may be required first.'); }
    finally { setSaving(false); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '8px 12px', background: '#F8FAFC', borderRadius: 8, fontSize: 11 }}>
      <span style={{ fontWeight: 700, color: '#64748B' }}>{device.hostname}:</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: canEdit ? 'pointer' : 'default' }}>
        <input type="checkbox" checked={!!device.screenshots_enabled} disabled={!canEdit || saving} onChange={e => update({ screenshots_enabled: e.target.checked })} />
        Screenshots
      </label>
      {device.screenshots_enabled && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            Every
            <input type="number" min={1} defaultValue={device.screenshot_interval_minutes || 10} disabled={!canEdit || saving}
              onBlur={e => update({ screenshot_interval_minutes: Number(e.target.value) })}
              style={{ width: 44, padding: '2px 4px', border: '1px solid #E2E8F0', borderRadius: 5 }} /> min
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: canEdit ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={!!device.blur_screenshots} disabled={!canEdit || saving} onChange={e => update({ blur_screenshots: e.target.checked })} />
            Blur
          </label>
        </>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: canEdit ? 'pointer' : 'default' }}>
        <input type="checkbox" checked={device.tracking_mode === 'silent'} disabled={!canEdit || saving}
          onChange={e => update({ tracking_mode: e.target.checked ? 'silent' : 'visible' })} />
        {device.tracking_mode === 'silent' ? <EyeOff size={12} /> : <Eye size={12} />} Silent mode
      </label>
    </div>
  );
}

function MyDeviceTab() {
  const { data: policy } = useFetch<any>('/device-monitoring/policy');
  const { data: status, refetch: refetchStatus } = useFetch<any>('/device-monitoring/consent/status');
  const { data: extPolicy } = useFetch<any>('/device-monitoring/extended-policy');
  const { data: extStatus, refetch: refetchExtStatus } = useFetch<any>('/device-monitoring/consent/extended-status');
  const { data: devices, refetch: refetchDevices } = useFetch<any[]>('/device-monitoring/devices');
  const { data: summary } = useFetch<any>('/device-monitoring/summary?days=7');
  const { data: history } = useFetch<any[]>('/device-monitoring/browsing-history?days=7&limit=50');
  const hasExtConsent = extStatus?.has_active_consent;
  const { data: screenshots } = useFetch<any[]>(hasExtConsent ? '/device-monitoring/screenshots?days=7&limit=30' : null);
  const { data: intensity } = useFetch<any[]>(hasExtConsent ? '/device-monitoring/intensity-summary?days=7' : null);
  const { data: dlpEvents } = useFetch<any[]>(hasExtConsent ? '/device-monitoring/dlp-events?days=30' : null);
  const [enrollCode, setEnrollCode] = useState<{ token: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [extBusy, setExtBusy] = useState(false);

  const hasConsent = status?.has_active_consent;

  const giveExtConsent = async () => {
    setExtBusy(true);
    try { await apiFetch('/device-monitoring/consent/extended', { method: 'POST', body: JSON.stringify({ consent_given: true }) }); refetchExtStatus(); }
    finally { setExtBusy(false); }
  };
  const revokeExtConsent = async () => {
    if (!confirm('Revoke extended consent? This turns off screenshots, live view, intensity tracking, DLP detection, and silent mode on your device(s). Basic monitoring continues unless you revoke that separately.')) return;
    setExtBusy(true);
    try { await apiFetch('/device-monitoring/consent/extended/revoke', { method: 'POST' }); refetchExtStatus(); refetchDevices(); }
    finally { setExtBusy(false); }
  };

  const giveConsent = async () => {
    setBusy(true);
    try { await apiFetch('/device-monitoring/consent', { method: 'POST', body: JSON.stringify({ consent_given: true }) }); refetchStatus(); }
    finally { setBusy(false); }
  };
  const revokeConsent = async () => {
    if (!confirm('Revoke consent? This deactivates monitoring on all your enrolled devices.')) return;
    setBusy(true);
    try { await apiFetch('/device-monitoring/consent/revoke', { method: 'POST' }); refetchStatus(); refetchDevices(); setEnrollCode(null); }
    finally { setBusy(false); }
  };
  const generateCode = async () => {
    setBusy(true);
    try { setEnrollCode(await apiFetch('/device-monitoring/enrollment-token', { method: 'POST' })); }
    finally { setBusy(false); }
  };
  const deactivate = async (id: string) => {
    if (!confirm('Deactivate this device? It will stop reporting activity.')) return;
    await apiFetch(`/device-monitoring/devices/${id}`, { method: 'DELETE' });
    refetchDevices();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <ShieldCheck size={16} color="#2563EB" />
          <div style={{ fontSize: 13, fontWeight: 700 }}>What this monitors</div>
        </div>
        <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, marginBottom: 12 }}>{policy?.policy_text}</p>
        {!hasConsent ? (
          <button style={btn} onClick={giveConsent} disabled={busy}>I Consent — Enable on My Device</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 4 }}>✓ Consent active</span>
            <button style={btnDanger} onClick={revokeConsent} disabled={busy}>Revoke Consent</button>
          </div>
        )}
      </div>

      {hasConsent && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Camera size={16} color="#7C3AED" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>Extended Monitoring (optional, separate consent)</div>
          </div>
          <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, marginBottom: 12 }}>{extPolicy?.policy_text}</p>
          {!hasExtConsent ? (
            <button style={{ ...btn, background: '#7C3AED' }} onClick={giveExtConsent} disabled={extBusy}>I Consent — Enable Extended Monitoring</button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7C3AED', display: 'flex', alignItems: 'center', gap: 4 }}>✓ Extended consent active</span>
              <button style={btnDanger} onClick={revokeExtConsent} disabled={extBusy}>Revoke Extended Consent</button>
            </div>
          )}
        </div>
      )}

      {hasConsent && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <KeyRound size={16} color="#2563EB" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>Enroll This Device</div>
          </div>
          <p style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
            Download the agent, install it on this company laptop, then generate a one-time code below and paste it when the agent prompts you. The code expires in 15 minutes and can only be used once.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={btnGhost} onClick={() => downloadFile('/device-monitoring/agent/download', 'aviin-device-agent.zip')}>
              <Download size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />Download Agent (.zip)
            </button>
            <button style={btn} onClick={generateCode} disabled={busy}>Generate Enrollment Code</button>
          </div>
          {enrollCode && (
            <div style={{ marginTop: 10, padding: '10px 12px', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8 }}>
              <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 2, color: '#4338CA', fontFamily: 'monospace' }}>{enrollCode.token}</div>
              <div style={{ fontSize: 11, color: '#4338CA' }}>Expires {new Date(enrollCode.expires_at).toLocaleTimeString()}</div>
            </div>
          )}
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>My Enrolled Devices</div>
        {(devices || []).length === 0 && <div style={{ fontSize: 12, color: '#94A3B8' }}>No devices enrolled.</div>}
        {(devices || []).map((d: any) => (
          <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, marginBottom: hasExtConsent && d.is_active ? 8 : 0 }}>
              <Laptop size={14} color="#64748B" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{d.hostname}</div>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>{d.os} · last active {d.last_heartbeat_at ? new Date(d.last_heartbeat_at).toLocaleString() : 'never'}</div>
              </div>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: d.is_active ? '#DCFCE7' : '#F1F5F9', color: d.is_active ? '#16A34A' : '#94A3B8' }}>{d.is_active ? 'active' : 'inactive'}</span>
              {d.is_active && <button onClick={() => deactivate(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626' }}><Trash2 size={14} /></button>}
            </div>
            {hasExtConsent && d.is_active && <DeviceExtendedSettings device={d} canEdit={true} onSaved={refetchDevices} />}
          </div>
        ))}
      </div>

      {hasExtConsent && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Camera size={16} color="#7C3AED" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>My Screenshots (last 7 days)</div>
          </div>
          {(screenshots || []).length === 0 ? (
            <div style={{ fontSize: 12, color: '#94A3B8' }}>None yet — enable screenshots above on a device to start.</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(screenshots || []).map((s: any) => (
                <div key={s.id}>
                  <ScreenshotThumb id={s.id} isBlurred={s.is_blurred} />
                  <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 2, textAlign: 'center' }}>{new Date(s.captured_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hasExtConsent && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Keyboard size={16} color="#7C3AED" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>My Keystroke/Mouse Intensity (counts only — never content)</div>
          </div>
          {(intensity || []).length === 0 ? (
            <div style={{ fontSize: 12, color: '#94A3B8' }}>No intensity data yet.</div>
          ) : (
            (intensity || []).map((r: any, i: number) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid #F1F5F9' }}>
                <span>{new Date(r.day).toLocaleDateString()}</span>
                <span style={{ color: '#64748B' }}>{r.keystrokes} keys · {r.mouse_clicks} clicks</span>
              </div>
            ))
          )}
        </div>
      )}

      {hasExtConsent && (dlpEvents || []).length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ShieldAlert size={16} color="#DC2626" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>My DLP Alerts (last 30 days)</div>
          </div>
          {(dlpEvents || []).map((e: any) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span>{e.event_type === 'usb_connected' ? 'USB connected' : 'Blocked site visited'}: {e.detail}</span>
              <span style={{ color: '#94A3B8' }}>{new Date(e.occurred_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      {hasConsent && summary && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>My Activity (last 7 days) — exactly what's collected about you</div>
            <button style={btnGhost} onClick={() => downloadFile('/device-monitoring/export', 'my-device-monitoring-data.json')} title="Download everything collected about you, in full — not just this 7-day summary">
              <Download size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />Export My Data
            </button>
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginBottom: 6 }}>TOP APPLICATIONS</div>
          {(summary.top_apps || []).slice(0, 5).map((a: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
              <span>{a.app_name}</span><span style={{ color: '#64748B' }}>{fmtHours(a.seconds)}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: '#64748B', margin: '10px 0 6px' }}>TOP DOMAINS VISITED</div>
          {(summary.top_domains || []).slice(0, 5).map((d: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0' }}>
              <span>{d.domain}</span><span style={{ color: '#64748B' }}>{d.visits} visits</span>
            </div>
          ))}
        </div>
      )}

      {hasConsent && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>My Browsing History (last 7 days)</div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {(history || []).length === 0 && <div style={{ fontSize: 12, color: '#94A3B8' }}>No browsing recorded yet.</div>}
            {(history || []).map((h: any, i: number) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 11 }}>
                <div style={{ fontWeight: 600, color: '#1E293B' }}>{h.page_title || h.url}</div>
                <div style={{ color: '#94A3B8' }}>{h.url} · {new Date(h.visited_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LiveViewCard({ device }: { device: any }) {
  const [state, setState] = useState<{ ready: boolean; screenshot: any } | null>(null);
  const [polling, setPolling] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  const request = async () => {
    setPolling(true);
    setImgUrl(null);
    try {
      await apiFetch(`/device-monitoring/devices/${device.id}/live-view/request`, { method: 'POST' });
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const res = await apiFetch(`/device-monitoring/devices/${device.id}/live-view`);
        if (res.ready) {
          setState(res);
          const r = await fetch(`${API_BASE}/device-monitoring/screenshots/${res.screenshot.id}/image`, { headers: authHeaders() });
          if (r.ok) setImgUrl(URL.createObjectURL(await r.blob()));
          break;
        }
      }
    } catch (e: any) {
      alert(e.message || 'Live view request failed — this user may not have extended consent on file.');
    } finally { setPolling(false); }
  };

  return (
    <div style={{ padding: '8px 12px', background: '#F8FAFC', borderRadius: 8, marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={request} disabled={polling} style={{ ...btnGhost, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
          <Video size={12} /> {polling ? 'Waiting for device…' : 'Request Live View'}
        </button>
        {state?.screenshot && <span style={{ fontSize: 10, color: '#94A3B8' }}>Captured {new Date(state.screenshot.captured_at).toLocaleTimeString()}</span>}
      </div>
      {imgUrl && <img src={imgUrl} alt="live view" style={{ marginTop: 8, maxWidth: 320, borderRadius: 8, border: '1px solid #E2E8F0' }} />}
    </div>
  );
}

function DlpPolicyManager() {
  const { data: policies, refetch } = useFetch<any[]>('/device-monitoring/dlp-policies');
  const [domain, setDomain] = useState('');
  const usbPolicy = (policies || []).find((p: any) => p.policy_type === 'usb_restriction');
  const domainPolicies = (policies || []).filter((p: any) => p.policy_type === 'website_blocklist');

  const addDomain = async () => {
    if (!domain.trim()) return;
    await apiFetch('/device-monitoring/dlp-policies', { method: 'POST', body: JSON.stringify({ policy_type: 'website_blocklist', rule: domain.trim().toLowerCase() }) });
    setDomain(''); refetch();
  };
  const removePolicy = async (id: string) => {
    await apiFetch(`/device-monitoring/dlp-policies/${id}`, { method: 'DELETE' });
    refetch();
  };
  const toggleUsb = async () => {
    if (usbPolicy) { await removePolicy(usbPolicy.id); }
    else { await apiFetch('/device-monitoring/dlp-policies', { method: 'POST', body: JSON.stringify({ policy_type: 'usb_restriction', rule: 'alert' }) }); refetch(); }
  };

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <ShieldAlert size={16} color="#DC2626" />
        <div style={{ fontSize: 13, fontWeight: 700 }}>DLP Policies (alert-only — nothing is ever blocked)</div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 12 }}>
        <input type="checkbox" checked={!!usbPolicy} onChange={toggleUsb} /> Alert when a USB storage device is connected
      </label>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>BLOCKED-WEBSITE ALERT LIST</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com" style={{ ...select, flex: 1 }} onKeyDown={e => e.key === 'Enter' && addDomain()} />
        <button onClick={addDomain} style={{ ...btn, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={12} /> Add</button>
      </div>
      {domainPolicies.length === 0 ? (
        <div style={{ fontSize: 12, color: '#94A3B8' }}>No blocked domains configured.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {domainPolicies.map((p: any) => (
            <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '3px 8px', borderRadius: 12, background: '#FEF2F2', color: '#DC2626' }}>
              {p.rule} <button onClick={() => removePolicy(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontWeight: 700 }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamOverviewTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const { data: devices, refetch: refetchDevices } = useFetch<any[]>('/device-monitoring/devices');
  const { data: roster } = useFetch<any[]>('/device-monitoring/consent/roster');
  const [selectedUser, setSelectedUser] = useState('');
  const { data: summary } = useFetch<any>(`/device-monitoring/summary?days=7${selectedUser ? `&user_id=${selectedUser}` : ''}`);
  const { data: history } = useFetch<any[]>(selectedUser ? `/device-monitoring/browsing-history?user_id=${selectedUser}&days=7&limit=100` : null);
  const { data: selUserScreenshots } = useFetch<any[]>(selectedUser ? `/device-monitoring/screenshots?user_id=${selectedUser}&days=7&limit=30` : null);
  const { data: selUserIntensity } = useFetch<any[]>(selectedUser ? `/device-monitoring/intensity-summary?user_id=${selectedUser}&days=7` : null);
  const { data: selUserDlp } = useFetch<any[]>(selectedUser ? `/device-monitoring/dlp-events?user_id=${selectedUser}&days=30` : null);
  const userMap = Object.fromEntries((users || []).map((u: any) => [u.id, u.full_name]));

  const activeByUser: Record<string, number> = {};
  (summary?.daily_active_time || []).forEach((r: any) => {
    activeByUser[r.user_id] = (activeByUser[r.user_id] || 0) + Number(r.active_seconds || 0);
  });

  const deactivateDevice = async (id: string) => {
    if (!confirm('Deactivate this device? It will stop reporting activity.')) return;
    await apiFetch(`/device-monitoring/devices/${id}`, { method: 'DELETE' });
    refetchDevices();
  };

  const consentedCount = (roster || []).filter((r: any) => r.has_active_consent).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          Consent Status ({consentedCount} of {(roster || []).length} team members have consented)
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginBottom: 10 }}>
          Nobody can be enrolled without self-consenting first — this is a real-time roster, not a way to push consent onto anyone.
        </div>
        {(roster || []).map((r: any) => (
          <div key={r.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            {r.has_active_consent
              ? <CheckCircle2 size={14} color="#16A34A" />
              : <XCircle size={14} color="#CBD5E1" />}
            <span style={{ fontWeight: 600 }}>{r.full_name}</span>
            <span style={{ color: '#94A3B8', fontSize: 11 }}>{r.email}</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: r.has_active_consent ? '#16A34A' : '#94A3B8' }}>
              {r.has_active_consent ? `Consented ${new Date(r.consented_at).toLocaleDateString()}` : 'Not consented'}
              {r.active_device_count > 0 && ` · ${r.active_device_count} device${r.active_device_count > 1 ? 's' : ''}`}
            </span>
          </div>
        ))}
        {!(roster || []).length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No active team members found.</div>}
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Enrolled Devices ({(devices || []).length})</div>
        {(devices || []).map((d: any) => (
          <div key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
            <div data-testid={`device-row-${d.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
              <Laptop size={14} color="#64748B" />
              <span style={{ fontWeight: 700 }}>{d.full_name}</span>
              <span style={{ color: '#64748B' }}>{d.hostname} · {d.os}</span>
              <span data-testid={`device-status-${d.id}`} style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 6, background: d.is_active ? '#DCFCE7' : '#F1F5F9', color: d.is_active ? '#16A34A' : '#94A3B8' }}>{d.is_active ? 'active' : 'inactive'}</span>
              {d.is_active && <button onClick={() => deactivateDevice(d.id)} title="Deactivate this device" data-testid={`deactivate-device-${d.id}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626' }}><Trash2 size={14} /></button>}
            </div>
            {d.is_active && d.screenshots_enabled && <LiveViewCard device={d} />}
          </div>
        ))}
        {!(devices || []).length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No devices enrolled by anyone yet.</div>}
      </div>

      <DlpPolicyManager />

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Active Time (last 7 days)</div>
        </div>
        {Object.keys(activeByUser).length === 0 && <div style={{ fontSize: 12, color: '#94A3B8' }}>No activity recorded yet.</div>}
        {Object.entries(activeByUser).map(([uid, secs]) => (
          <div key={uid} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
            <span>{userMap[uid] || uid}</span><span style={{ fontWeight: 700 }}>{fmtHours(secs)}</span>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <Globe size={16} color="#2563EB" />
          <div style={{ fontSize: 13, fontWeight: 700 }}>Browsing History</div>
          <select style={{ ...select, marginLeft: 'auto' }} value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
            <option value="">-- Select a recruiter --</option>
            {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </div>
        {!selectedUser && <div style={{ fontSize: 12, color: '#94A3B8' }}>Select a recruiter to view their browsing history.</div>}
        {selectedUser && (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <button style={{ ...btnGhost, marginBottom: 10 }} onClick={() => downloadFile(`/device-monitoring/export?user_id=${selectedUser}`, `device-monitoring-export-${userMap[selectedUser] || selectedUser}.json`)}>
              <Download size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />Export {userMap[selectedUser] || 'this person'}'s Data
            </button>
            {(history || []).length === 0 && <div style={{ fontSize: 12, color: '#94A3B8' }}>No browsing recorded for this person yet.</div>}
            {(history || []).map((h: any, i: number) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 11 }}>
                <div style={{ fontWeight: 600, color: '#1E293B' }}>{h.page_title || h.url}</div>
                <div style={{ color: '#94A3B8' }}>{h.url} · {new Date(h.visited_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedUser && (selUserScreenshots || []).length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Camera size={16} color="#7C3AED" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>{userMap[selectedUser]}'s Screenshots (last 7 days)</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(selUserScreenshots || []).map((s: any) => (
              <div key={s.id}>
                <ScreenshotThumb id={s.id} isBlurred={s.is_blurred} />
                <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 2, textAlign: 'center' }}>{new Date(s.captured_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedUser && (selUserIntensity || []).length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Keyboard size={16} color="#7C3AED" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>{userMap[selectedUser]}'s Keystroke/Mouse Intensity</div>
          </div>
          {(selUserIntensity || []).map((r: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span>{new Date(r.day).toLocaleDateString()}</span>
              <span style={{ color: '#64748B' }}>{r.keystrokes} keys · {r.mouse_clicks} clicks</span>
            </div>
          ))}
        </div>
      )}

      {selectedUser && (selUserDlp || []).length > 0 && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ShieldAlert size={16} color="#DC2626" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>{userMap[selectedUser]}'s DLP Alerts (last 30 days)</div>
          </div>
          {(selUserDlp || []).map((e: any) => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span>{e.event_type === 'usb_connected' ? 'USB connected' : 'Blocked site visited'}: {e.detail}</span>
              <span style={{ color: '#94A3B8' }}>{new Date(e.occurred_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DeviceMonitoringPage() {
  // getTokenPayload() reads localStorage, which doesn't exist during SSR —
  // reading it synchronously during render made the server's first paint
  // (canManage=false, no tab bar) differ from the client's (real role,
  // tab bar present), a hydration mismatch (React error #418). Deferring
  // to an effect keeps the first client render identical to the server's,
  // then updates after mount once localStorage is actually available.
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    const role = getTokenPayload()?.role || '';
    setCanManage(['admin', 'super_admin', 'manager'].includes(role));
  }, []);
  const [tab, setTab] = useState('mine');

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Device Monitoring</h1>
        <p style={{ fontSize: 13, color: '#64748B' }}>Company-device activity tracking — disclosed, consent-gated. Extended features (screenshots, intensity, DLP, silent mode) require a separate consent.</p>
      </div>
      {canManage && (
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E2E8F0' }}>
          <button onClick={() => setTab('mine')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: tab === 'mine' ? '#2563EB' : '#64748B', borderBottom: tab === 'mine' ? '2px solid #2563EB' : '2px solid transparent' }}>
            <Clock size={14} /> My Device
          </button>
          <button onClick={() => setTab('team')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: tab === 'team' ? '#2563EB' : '#64748B', borderBottom: tab === 'team' ? '2px solid #2563EB' : '2px solid transparent' }}>
            <ShieldCheck size={14} /> Team Overview
          </button>
        </div>
      )}
      {tab === 'mine' && <MyDeviceTab />}
      {tab === 'team' && canManage && <TeamOverviewTab />}
    </div>
  );
}
