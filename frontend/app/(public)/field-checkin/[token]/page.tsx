'use client';
import { useState, useEffect } from 'react';
import { MapPin, CheckCircle, XCircle, LogIn, LogOut, AlertTriangle } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

interface CheckinInfo {
  candidate_name: string;
  client_name: string | null;
  site_name: string | null;
  geofence_id: string | null;
}
interface TodayStatus {
  id: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  status: string | null;
}

export default function FieldCheckinPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [info, setInfo] = useState<CheckinInfo | null>(null);
  const [today, setToday] = useState<TodayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ within: boolean; distance: number; action: 'check-in' | 'check-out' } | null>(null);

  async function load() {
    try {
      const r = await fetch(`${API_URL}/field-checkin/${token}`);
      if (!r.ok) { setError('This check-in link is invalid or has been revoked.'); setLoading(false); return; }
      setInfo(await r.json());
      const r2 = await fetch(`${API_URL}/field-checkin/${token}/today`);
      setToday(await r2.json());
    } catch { setError('Could not load check-in details. Check your connection.'); }
    setLoading(false);
  }
  useEffect(() => { load(); }, [token]);

  function getPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('This device/browser does not support location services.')); return; }
      navigator.geolocation.getCurrentPosition(resolve, err => reject(new Error(
        err.code === err.PERMISSION_DENIED ? 'Location permission denied — please allow location access and try again.' : err.message
      )), { enableHighAccuracy: true, timeout: 15000 });
    });
  }

  async function doAction(action: 'check-in' | 'check-out') {
    setBusy(true); setError(''); setResult(null);
    try {
      const pos = await getPosition();
      const r = await fetch(`${API_URL}/field-checkin/${token}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Failed');
      setResult({ within: data.within_geofence, distance: data.distance_m, action });
      await load();
    } catch (e: any) { setError(e.message || 'Something went wrong'); }
    setBusy(false);
  }

  const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: '-apple-system,Segoe UI,sans-serif' };
  const card: React.CSSProperties = { background: 'white', borderRadius: '20px', padding: '28px 24px', maxWidth: '380px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' };

  if (loading) return <div style={wrap}><div style={{ color: 'white', fontSize: 14 }}>Loading…</div></div>;
  if (error && !info) return (
    <div style={wrap}><div style={card}>
      <XCircle size={40} style={{ color: '#dc2626', marginBottom: 12 }} />
      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Link unavailable</div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>{error}</div>
    </div></div>
  );

  const checkedIn = !!today?.check_in_at;
  const checkedOut = !!today?.check_out_at;

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <MapPin size={24} style={{ color: '#2563eb' }} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>{info?.candidate_name}</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            {info?.client_name || 'Client site'}{info?.site_name ? ` · ${info.site_name}` : ''}
          </div>
          {!info?.geofence_id && (
            <div style={{ fontSize: 11, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', marginTop: 10 }}>
              No site location configured yet — your check-in will still be recorded, just without location verification.
            </div>
          )}
        </div>

        {today?.status && (
          <div style={{ fontSize: 12, textAlign: 'center', marginBottom: 14, color: '#64748b' }}>
            Today: {today.check_in_at ? `In ${new Date(today.check_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
            {today.check_out_at ? ` · Out ${new Date(today.check_out_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </div>
        )}

        {result && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, marginBottom: 16,
            background: result.within === false ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${result.within === false ? '#fecaca' : '#bbf7d0'}`,
          }}>
            {result.within === false ? <AlertTriangle size={16} style={{ color: '#dc2626', flexShrink: 0 }} /> : <CheckCircle size={16} style={{ color: '#15803d', flexShrink: 0 }} />}
            <div style={{ fontSize: 12.5, color: result.within === false ? '#991b1b' : '#166534' }}>
              {result.within === false
                ? `You're ~${Math.round(result.distance)}m from the site — this ${result.action === 'check-in' ? 'check-in' : 'check-out'} has been flagged for review.`
                : `${result.action === 'check-in' ? 'Checked in' : 'Checked out'} — verified at the site.`}
            </div>
          </div>
        )}

        {error && info && (
          <div style={{ fontSize: 12.5, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>{error}</div>
        )}

        {checkedIn && checkedOut ? (
          <div style={{ textAlign: 'center', padding: '14px 0', color: '#166534', fontSize: 13, fontWeight: 600 }}>
            <CheckCircle size={22} style={{ marginBottom: 6 }} /><br />Done for today — see you tomorrow.
          </div>
        ) : (
          <button onClick={() => doAction(checkedIn ? 'check-out' : 'check-in')} disabled={busy} style={{
            width: '100%', padding: '16px', borderRadius: 14, border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
            background: checkedIn ? '#dc2626' : '#2563eb', color: 'white', fontSize: 16, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.7 : 1,
          }}>
            {checkedIn ? <LogOut size={19} /> : <LogIn size={19} />}
            {busy ? 'Getting your location…' : checkedIn ? 'Check Out' : 'Check In'}
          </button>
        )}
        <div style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'center', marginTop: 14 }}>
          Your location is only captured at the moment you check in/out — not tracked continuously.
        </div>
      </div>
    </div>
  );
}
