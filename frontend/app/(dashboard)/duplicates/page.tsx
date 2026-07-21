'use client';
import { useState } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { GitMerge, ScanSearch, X, Mail, Phone, Check } from 'lucide-react';

const TABS = [
  { key: 'pending',   label: 'Pending' },
  { key: 'merged',    label: 'Merged' },
  { key: 'dismissed', label: 'Dismissed' },
];

export default function DuplicatesPage() {
  const [status, setStatus] = useState('pending');
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const showStatus = (m: string, ms = 3000) => { setStatusMsg(m); setTimeout(() => setStatusMsg(''), ms); };

  const { data, loading, refetch } = useFetch<any[]>(`/duplicates?status=${status}`);
  const rows: any[] = Array.isArray(data) ? data : [];

  const scan = async () => {
    setScanning(true);
    try {
      const r = await apiFetch('/duplicates/scan', { method: 'POST' });
      showStatus(`✅ Scan complete — ${r?.duplicates_found ?? 0} potential duplicate${r?.duplicates_found === 1 ? '' : 's'} found`);
      setStatus('pending');
      refetch();
    } catch (e: any) { showStatus('Scan failed: ' + (e?.message || 'error')); }
    finally { setScanning(false); }
  };

  const merge = async (id: string, name1: string) => {
    if (!confirm(`Merge duplicate of "${name1}"?\n\nThe first-listed record will be kept, the other deactivated and its applications transferred.`)) return;
    setBusyId(id);
    try {
      await apiFetch(`/duplicates/${id}/merge`, { method: 'PATCH' });
      showStatus('✅ Merged');
      refetch();
    } catch (e: any) { showStatus('Merge failed: ' + (e?.message || 'error')); }
    finally { setBusyId(null); }
  };

  const dismiss = async (id: string) => {
    setBusyId(id);
    try {
      await apiFetch(`/duplicates/${id}/dismiss`, { method: 'PATCH' });
      showStatus('Marked as not a duplicate');
      refetch();
    } catch (e: any) { showStatus('Failed: ' + (e?.message || 'error')); }
    finally { setBusyId(null); }
  };

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', marginBottom: '2px' }}>Duplicate Candidates</h1>
          <p style={{ fontSize: '13px', color: '#64748b' }}>Detected by matching email or phone across candidates — catches duplicates even when the name differs.</p>
        </div>
        <button onClick={scan} disabled={scanning}
          style={{ padding: '9px 16px', borderRadius: '8px', border: 'none', background: scanning ? '#94a3b8' : '#1e40af', color: 'white', cursor: scanning ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
          <ScanSearch size={15} />{scanning ? 'Scanning...' : 'Scan for Duplicates'}
        </button>
      </div>

      {statusMsg && (
        <div style={{ padding: '10px 16px', borderRadius: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', fontSize: '13px', fontWeight: '600' }}>{statusMsg}</div>
      )}

      <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #e2e8f0' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setStatus(t.key)}
            style={{ padding: '9px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '13px', fontWeight: '600', color: status === t.key ? '#1e40af' : '#64748b', borderBottom: status === t.key ? '2px solid #1e40af' : '2px solid transparent', marginBottom: '-1px' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>Loading...</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8', fontSize: '13px' }}>
            {status === 'pending' ? 'No pending duplicates. Run a scan to check for email/phone matches.' : `No ${status} duplicates.`}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                {['CANDIDATE 1 (KEPT ON MERGE)', 'CANDIDATE 2', 'MATCHED ON', 'DETECTED', status === 'pending' ? 'ACTIONS' : 'RESOLVED'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#64748b', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{r.name1}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{r.email1 || 'no email'}</div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{r.name2}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{r.email2 || 'no email'}</div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '6px', background: r.match_field === 'email' ? '#eff6ff' : '#f0fdf4', color: r.match_field === 'email' ? '#1e40af' : '#166534' }}>
                      {r.match_field === 'email' ? <Mail size={11} /> : <Phone size={11} />}{r.match_field}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '11px', color: '#94a3b8' }}>
                    {r.detected_at ? new Date(r.detected_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    {status === 'pending' ? (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => merge(r.id, r.name1)} disabled={busyId === r.id}
                          style={{ padding: '5px 12px', borderRadius: '7px', border: 'none', background: busyId === r.id ? '#94a3b8' : '#dc2626', color: 'white', cursor: busyId === r.id ? 'not-allowed' : 'pointer', fontSize: '11px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <GitMerge size={11} />Merge
                        </button>
                        <button onClick={() => dismiss(r.id)} disabled={busyId === r.id}
                          style={{ padding: '5px 12px', borderRadius: '7px', border: '1px solid #e2e8f0', background: 'white', color: '#64748b', cursor: busyId === r.id ? 'not-allowed' : 'pointer', fontSize: '11px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <X size={11} />Not a duplicate
                        </button>
                      </div>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '600', color: status === 'merged' ? '#166534' : '#64748b' }}>
                        <Check size={11} />{status === 'merged' ? 'Merged' : 'Dismissed'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
