'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { MapPin, Search, Plus, Link2, Copy, XCircle, CheckCircle, AlertTriangle, Trash2 } from 'lucide-react';

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  clean: { label: 'Clean', color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
  flagged: { label: 'Flagged', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  manual_override: { label: 'Overridden', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
};

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px 20px' }}>{children}</div>;
}
const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', outline: 'none', color: '#1e293b', background: 'white', boxSizing: 'border-box' };

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] || STATUS_CFG.clean;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>{c.label}</span>;
}

function PlacementsTab() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);
  const { data: geofences } = useFetch<any[]>('/field-attendance/geofences');
  const [assigning, setAssigning] = useState('');
  const [msg, setMsg] = useState('');

  async function search() {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try { setResults(await apiFetch(`/field-attendance/placements-search?q=${encodeURIComponent(q)}`)); }
    finally { setSearching(false); }
  }

  async function loadConfig(p: any) {
    setSelected(p); setMsg('');
    const c = await apiFetch(`/field-attendance/placements/${p.id}`);
    setConfig(c);
  }

  async function assignGeofence() {
    if (!assigning || !selected) return;
    await apiFetch(`/field-attendance/placements/${selected.id}/assign-geofence`, { method: 'POST', body: JSON.stringify({ geofence_id: assigning }) });
    loadConfig(selected);
  }

  async function genLink() {
    if (!selected) return;
    const r = await apiFetch(`/field-attendance/placements/${selected.id}/generate-link`, { method: 'POST' });
    await navigator.clipboard.writeText(window.location.origin + r.checkin_url).catch(() => {});
    setMsg('Check-in link copied to clipboard');
    loadConfig(selected);
  }

  async function revokeLink() {
    if (!selected) return;
    await apiFetch(`/field-attendance/placements/${selected.id}/revoke-link`, { method: 'POST' });
    setMsg('Link revoked');
    loadConfig(selected);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16 }}>
      <Card>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Find a placement</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={inputStyle} placeholder="Candidate or client name..." value={q}
            onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
          <button onClick={search} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#2563eb', cursor: 'pointer' }}><Search size={14} /></button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 440, overflowY: 'auto' }}>
          {searching && <div style={{ fontSize: 12, color: '#94a3b8' }}>Searching…</div>}
          {results.map(p => (
            <div key={p.id} onClick={() => loadConfig(p)} style={{
              padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
              background: selected?.id === p.id ? '#eff6ff' : '#f8fafc',
              border: `1px solid ${selected?.id === p.id ? '#bfdbfe' : '#e2e8f0'}`,
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>{p.candidate_name}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{p.client_name || 'No client'} · {p.status}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        {!selected ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8', fontSize: 13 }}>
            Search for a placed candidate to configure their site geofence and check-in link.
          </div>
        ) : !config ? (
          <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</div>
        ) : (
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{selected.candidate_name}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>{selected.client_name || 'No client'} · {config.placement.status}</div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Client site geofence</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <select style={inputStyle} value={assigning || config.geofence?.id || ''} onChange={e => setAssigning(e.target.value)}>
                <option value="">Select a site…</option>
                {(geofences || []).filter((g: any) => g.client_id === selected.client_id).map((g: any) => (
                  <option key={g.id} value={g.id}>{g.site_name} ({g.radius_meters}m radius)</option>
                ))}
              </select>
              <button onClick={assignGeofence} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1e40af', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Assign</button>
            </div>
            {(geofences || []).filter((g: any) => g.client_id === selected.client_id).length === 0 && (
              <div style={{ fontSize: 11.5, color: '#b45309', marginBottom: 12 }}>No sites configured for this client yet — add one in the Site Geofences tab first.</div>
            )}
            {config.geofence && (
              <div style={{ fontSize: 12, color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', margin: '8px 0 16px' }}>
                Current site: <strong>{config.geofence.site_name}</strong> ({config.geofence.radius_meters}m radius)
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6, marginTop: 16 }}>Check-in link</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={genLink} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <Link2 size={13} /> {config.has_active_link ? 'Copy Link' : 'Generate Link'}
              </button>
              {config.has_active_link && (
                <button onClick={revokeLink} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid #fee2e2', background: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <XCircle size={13} /> Revoke
                </button>
              )}
              {msg && <span style={{ fontSize: 11.5, color: '#15803d' }}>{msg}</span>}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, marginTop: 20 }}>Recent attendance (14 days)</div>
            {config.recent_attendance.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>No check-ins recorded yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {config.recent_attendance.map((r: any) => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: '#f8fafc', borderRadius: 7, fontSize: 12 }}>
                    <span>{r.attendance_date}</span>
                    <span style={{ color: '#64748b' }}>
                      {r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      {' → '}
                      {r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function RecordsTab() {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: records, loading, refetch } = useFetch<any[]>(`/field-attendance/records${statusFilter ? `?status=${statusFilter}` : ''}`);
  const [overriding, setOverriding] = useState<any>(null);
  const [reason, setReason] = useState('');

  async function submitOverride() {
    if (!overriding || !reason.trim()) return;
    await apiFetch(`/field-attendance/records/${overriding.id}/override`, { method: 'PATCH', body: JSON.stringify({ reason }) });
    setOverriding(null); setReason(''); refetch();
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['', 'clean', 'flagged', 'manual_override'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} style={{
            padding: '6px 14px', borderRadius: 20, border: `1px solid ${statusFilter === s ? '#1e40af' : '#e2e8f0'}`,
            background: statusFilter === s ? '#eff6ff' : 'white', color: statusFilter === s ? '#1e40af' : '#64748b',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>{s ? STATUS_CFG[s].label : 'All'}</button>
        ))}
      </div>
      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['Date', 'Candidate', 'Client', 'Check In', 'Check Out', 'Distance', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Loading…</td></tr>
            ) : !records || records.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>No attendance records yet.</td></tr>
            ) : records.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px 12px' }}>{r.attendance_date}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.candidate_name}</td>
                <td style={{ padding: '8px 12px', color: '#64748b' }}>{r.client_name || '—'}</td>
                <td style={{ padding: '8px 12px' }}>{r.check_in_at ? new Date(r.check_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td style={{ padding: '8px 12px' }}>{r.check_out_at ? new Date(r.check_out_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                <td style={{ padding: '8px 12px', color: '#64748b' }}>
                  {r.check_out_distance_m != null ? `${Math.round(r.check_out_distance_m)}m` : r.check_in_distance_m != null ? `${Math.round(r.check_in_distance_m)}m` : '—'}
                </td>
                <td style={{ padding: '8px 12px' }}><StatusBadge status={r.status} /></td>
                <td style={{ padding: '8px 12px' }}>
                  {r.status === 'flagged' && (
                    <button onClick={() => setOverriding(r)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd6fe', background: '#f5f3ff', color: '#7c3aed', cursor: 'pointer' }}>Override</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {overriding && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setOverriding(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 22, width: 380 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Override flagged attendance</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{overriding.candidate_name} · {overriding.attendance_date}</div>
            <textarea style={{ ...inputStyle, minHeight: 70 }} placeholder="Reason for override (e.g. approved off-site work)" value={reason} onChange={e => setReason(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setOverriding(null)} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
              <button onClick={submitOverride} disabled={!reason.trim()} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#1e40af', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Confirm Override</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GeofencesTab() {
  const { data: clients } = useFetch<any[]>('/clients');
  const { data: geofences, refetch } = useFetch<any[]>('/field-attendance/geofences');
  const [form, setForm] = useState({ client_id: '', site_name: '', address: '', center_lat: '', center_lng: '', radius_meters: 200 });
  const [saving, setSaving] = useState(false);

  async function useMyLocation() {
    navigator.geolocation.getCurrentPosition(pos => {
      setForm(f => ({ ...f, center_lat: String(pos.coords.latitude), center_lng: String(pos.coords.longitude) }));
    });
  }

  async function create() {
    if (!form.client_id || !form.site_name || !form.center_lat || !form.center_lng) return;
    setSaving(true);
    try {
      await apiFetch('/field-attendance/geofences', {
        method: 'POST',
        body: JSON.stringify({ ...form, center_lat: Number(form.center_lat), center_lng: Number(form.center_lng), radius_meters: Number(form.radius_meters) }),
      });
      setForm({ client_id: '', site_name: '', address: '', center_lat: '', center_lng: '', radius_meters: 200 });
      refetch();
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('Deactivate this site?')) return;
    await apiFetch(`/field-attendance/geofences/${id}`, { method: 'DELETE' });
    refetch();
  }

  const clientList = Array.isArray(clients) ? clients : (clients as any)?.items || [];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
      <Card>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase' }}>New client site</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select style={inputStyle} value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
            <option value="">Select client…</option>
            {clientList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input style={inputStyle} placeholder="Site name (e.g. HQ, Warehouse B)" value={form.site_name} onChange={e => setForm(f => ({ ...f, site_name: e.target.value }))} />
          <input style={inputStyle} placeholder="Address (optional)" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={inputStyle} placeholder="Latitude" value={form.center_lat} onChange={e => setForm(f => ({ ...f, center_lat: e.target.value }))} />
            <input style={inputStyle} placeholder="Longitude" value={form.center_lng} onChange={e => setForm(f => ({ ...f, center_lng: e.target.value }))} />
          </div>
          <button onClick={useMyLocation} style={{ fontSize: 11.5, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>Use my current location</button>
          <div>
            <label style={{ fontSize: 11.5, color: '#64748b' }}>Radius: {form.radius_meters}m</label>
            <input type="range" min={50} max={2000} step={50} value={form.radius_meters} onChange={e => setForm(f => ({ ...f, radius_meters: Number(e.target.value) }))} style={{ width: '100%' }} />
          </div>
          <button onClick={create} disabled={saving} style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#1e40af', color: 'white', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            <Plus size={12} style={{ verticalAlign: 'text-bottom' }} /> {saving ? 'Saving…' : 'Add Site'}
          </button>
        </div>
      </Card>
      <Card>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase' }}>Configured sites</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(geofences || []).length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>No sites configured yet.</div>}
          {(geofences || []).map((g: any) => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: g.is_active ? '#f8fafc' : '#fef2f2', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{g.site_name} <span style={{ fontWeight: 400, color: '#64748b' }}>· {g.client_name}</span></div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{g.center_lat.toFixed(4)}, {g.center_lng.toFixed(4)} · {g.radius_meters}m radius {!g.is_active && '· inactive'}</div>
              </div>
              {g.is_active && <button onClick={() => remove(g.id)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={14} style={{ color: '#dc2626' }} /></button>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function FieldAttendancePage() {
  const [tab, setTab] = useState<'placements' | 'records' | 'geofences'>('placements');
  const { data: summary } = useFetch<any>('/field-attendance/summary');

  return (
    <div className="anim-fade-up">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
          <MapPin size={20} style={{ color: '#2563eb' }} /> Field Attendance
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>GPS-verified check-in/out for placed contractors at client sites — not wired into billing, shown here as supporting evidence for timesheet approval.</p>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <StatCard label="Clean check-ins" value={summary?.clean_count ?? '—'} color="#15803d" />
        <StatCard label="Flagged" value={summary?.flagged_count ?? '—'} color="#dc2626" />
        <StatCard label="Overridden" value={summary?.override_count ?? '—'} color="#7c3aed" />
        <StatCard label="Active sites" value={summary?.active_geofences ?? '—'} color="#1e40af" />
        <StatCard label="Active links" value={summary?.active_checkin_links ?? '—'} color="#0891b2" />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #e2e8f0' }}>
        {[['placements', 'Placements'], ['records', 'Attendance Records'], ['geofences', 'Site Geofences']].map(([k, l]) => (
          <button key={k} data-testid={`fa-tab-${k}`} onClick={() => setTab(k as any)} style={{
            padding: '9px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: tab === k ? '#1e40af' : '#64748b',
            borderBottom: `2px solid ${tab === k ? '#1e40af' : 'transparent'}`,
          }}>{l}</button>
        ))}
      </div>

      {tab === 'placements' && <PlacementsTab />}
      {tab === 'records' && <RecordsTab />}
      {tab === 'geofences' && <GeofencesTab />}
    </div>
  );
}
