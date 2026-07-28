'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import { Laptop, ShieldCheck, Clock, Globe, Trash2, KeyRound } from 'lucide-react';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const btnDanger: React.CSSProperties = { ...btn, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' };
const select: React.CSSProperties = { padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12 };

function fmtHours(seconds: number) {
  return (seconds / 3600).toFixed(1) + 'h';
}

function MyDeviceTab() {
  const { data: policy } = useFetch<any>('/device-monitoring/policy');
  const { data: status, refetch: refetchStatus } = useFetch<any>('/device-monitoring/consent/status');
  const { data: devices, refetch: refetchDevices } = useFetch<any[]>('/device-monitoring/devices');
  const { data: summary } = useFetch<any>('/device-monitoring/summary?days=7');
  const { data: history } = useFetch<any[]>('/device-monitoring/browsing-history?days=7&limit=50');
  const [enrollCode, setEnrollCode] = useState<{ token: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const hasConsent = status?.has_active_consent;

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
            <KeyRound size={16} color="#2563EB" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>Enroll This Device</div>
          </div>
          <p style={{ fontSize: 12, color: '#64748B', marginBottom: 10 }}>
            Generate a one-time code, then run the agent on this company laptop and paste the code when prompted. The code expires in 15 minutes and can only be used once.
          </p>
          <button style={btn} onClick={generateCode} disabled={busy}>Generate Enrollment Code</button>
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
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <Laptop size={14} color="#64748B" />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{d.hostname}</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>{d.os} · last active {d.last_heartbeat_at ? new Date(d.last_heartbeat_at).toLocaleString() : 'never'}</div>
            </div>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: d.is_active ? '#DCFCE7' : '#F1F5F9', color: d.is_active ? '#16A34A' : '#94A3B8' }}>{d.is_active ? 'active' : 'inactive'}</span>
            {d.is_active && <button onClick={() => deactivate(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626' }}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>

      {hasConsent && summary && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>My Activity (last 7 days) — exactly what's collected about you</div>
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

function TeamOverviewTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const { data: devices } = useFetch<any[]>('/device-monitoring/devices');
  const [selectedUser, setSelectedUser] = useState('');
  const { data: summary } = useFetch<any>(`/device-monitoring/summary?days=7${selectedUser ? `&user_id=${selectedUser}` : ''}`);
  const { data: history } = useFetch<any[]>(selectedUser ? `/device-monitoring/browsing-history?user_id=${selectedUser}&days=7&limit=100` : null);
  const userMap = Object.fromEntries((users || []).map((u: any) => [u.id, u.full_name]));

  const activeByUser: Record<string, number> = {};
  (summary?.daily_active_time || []).forEach((r: any) => {
    activeByUser[r.user_id] = (activeByUser[r.user_id] || 0) + Number(r.active_seconds || 0);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Enrolled Devices ({(devices || []).length})</div>
        {(devices || []).map((d: any) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <Laptop size={14} color="#64748B" />
            <span style={{ fontWeight: 700 }}>{d.full_name}</span>
            <span style={{ color: '#64748B' }}>{d.hostname} · {d.os}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 6, background: d.is_active ? '#DCFCE7' : '#F1F5F9', color: d.is_active ? '#16A34A' : '#94A3B8' }}>{d.is_active ? 'active' : 'inactive'}</span>
          </div>
        ))}
        {!(devices || []).length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No devices enrolled by anyone yet.</div>}
      </div>

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
        <p style={{ fontSize: 13, color: '#64748B' }}>Company-device activity tracking — disclosed, consent-gated, no screenshots or keystrokes.</p>
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
