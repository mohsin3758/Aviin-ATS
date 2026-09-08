'use client';
// Recruiter / Sender Tracking (2026-09-07 sender-attribution spec).
//
// Every recruiter/sender — registered ATS users AND real "Temporary
// Sender Records" (an internal @company-domain sender who forwarded a
// candidate but has no ATS login yet) — with the full Kanban-stage
// funnel + Offers + Joinees, attributed by sender-of-record (the Golden
// Rule: credit follows the actual sender, never applications.
// assigned_recruiter_id, which is a different concept — who's currently
// doing the day-to-day work, not who originally sourced the candidate).
//
// Backend: GET /recruiter-attribution/sender-tracking (+ /export CSV)
// and GET /recruiter-attribution/unregistered-senders.
import { useState } from 'react';
import { useFetch } from '@/lib/useFetch';
import { API, authHeaders } from '@/lib/auth';
import { UserCheck, Download, AlertTriangle } from 'lucide-react';

interface StageCount { key: string; label: string; count: number; }
interface SenderRow {
  recruiter_id: string | null;
  recruiter_name: string;
  recruiter_email: string;
  is_registered: boolean;
  is_portal_feed: boolean;
  status_label: string;
  total_candidates: number;
  stages: StageCount[];
  offers: number;
  offers_accepted: number;
  joinees: number;
}
interface UnregisteredSender {
  recruiter_email: string;
  recruiter_name: string;
  candidate_count: number;
  first_seen_at: string;
  last_activity_at: string;
}

const fdt = (s: string) => { if (!s) return '—'; return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };

export default function RecruiterTrackingPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const qs = (dateFrom ? `?date_from=${dateFrom}` : '') + (dateTo ? `${dateFrom ? '&' : '?'}date_to=${dateTo}` : '');

  const { data: trackingData, loading } = useFetch<{ senders: SenderRow[] }>(`/recruiter-attribution/sender-tracking${qs}`);
  const { data: unregistered } = useFetch<UnregisteredSender[]>('/recruiter-attribution/unregistered-senders');
  const senders = trackingData?.senders || [];
  const stageKeys = senders[0]?.stages?.map(s => s.key) || [];
  const stageLabels: Record<string, string> = {};
  senders[0]?.stages?.forEach(s => { stageLabels[s.key] = s.label; });

  const exportCsv = async () => {
    const resp = await fetch(`${API}/recruiter-attribution/sender-tracking/export${qs}`, { headers: authHeaders() });
    if (!resp.ok) { alert('Export failed: ' + resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'recruiter_submission_report.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserCheck size={22} color="#1e40af" />
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Recruiter / Sender Tracking</h1>
        </div>
        <button onClick={exportCsv} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <Download size={14} /> Export Recruiter Submission Report
        </button>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 4, marginBottom: 16 }}>
        Every recruiter/sender's real submission funnel — attributed to the actual sender email address (the Golden Rule), never to
        whoever&apos;s mailbox happened to receive the resume.
      </p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: '#64748b' }}>Date Range:</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
        <span style={{ color: '#94a3b8', fontSize: 12 }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ fontSize: 11, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>✕ Clear</button>
        )}
      </div>

      {!!unregistered?.length && (
        <div style={{ marginBottom: 16, padding: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#b45309', marginBottom: 6 }}>
            <AlertTriangle size={14} /> {unregistered.length} Unregistered Sender{unregistered.length > 1 ? 's' : ''} — Temporary Sender Record
          </div>
          <div style={{ fontSize: 12, color: '#78350f', marginBottom: 6 }}>
            These are real @company-domain senders who&apos;ve submitted candidates but have no ATS user account yet. Their submissions are
            still counted below under their own name/email — creating an ATS account for them will automatically map every prior
            submission to the new account.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ textAlign: 'left', color: '#92400e' }}>
              <th style={{ padding: '4px 8px' }}>Source Recruiter</th><th style={{ padding: '4px 8px' }}>Source Email</th>
              <th style={{ padding: '4px 8px' }}>Candidates</th><th style={{ padding: '4px 8px' }}>Last Activity</th>
            </tr></thead>
            <tbody>
              {unregistered.map(u => (
                <tr key={u.recruiter_email} style={{ borderTop: '1px solid #fde68a' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 600 }}>{u.recruiter_name}</td>
                  <td style={{ padding: '4px 8px' }}>{u.recruiter_email}</td>
                  <td style={{ padding: '4px 8px' }}>{u.candidate_count}</td>
                  <td style={{ padding: '4px 8px' }}>{fdt(u.last_activity_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b' }}>Recruiter / Sender</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b' }}>Status</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b' }}>Total Submitted</th>
              {stageKeys.map(k => (
                <th key={k} style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, color: '#64748b', whiteSpace: 'nowrap' }}>{stageLabels[k]}</th>
              ))}
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b' }}>Offers</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#64748b' }}>Offers Accepted</th>
              <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>Placed ✓</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={99} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>Loading…</td></tr>}
            {!loading && senders.length === 0 && <tr><td colSpan={99} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No submissions recorded yet for this date range.</td></tr>}
            {senders.map(s => {
              const stageMap: Record<string, number> = {};
              s.stages.forEach(st => { stageMap[st.key] = st.count; });
              return (
                <tr key={s.recruiter_id || s.recruiter_email} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 700, color: '#111827' }}>{s.recruiter_name}</div>
                    <div style={{ color: '#94a3b8', fontSize: 11 }}>{s.recruiter_email}</div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {s.is_portal_feed
                      ? <span style={{ fontSize: 10, fontWeight: 700, color: '#4338ca', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 6, padding: '2px 8px' }}>AUTOMATED JOB PORTAL FEED</span>
                      : s.is_registered
                      ? <span style={{ fontSize: 10, fontWeight: 700, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, padding: '2px 8px' }}>ACTIVE ATS USER</span>
                      : <span style={{ fontSize: 10, fontWeight: 700, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, padding: '2px 8px' }}>UNREGISTERED ATS USER</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{s.total_candidates}</td>
                  {stageKeys.map(k => (
                    <td key={k} style={{ padding: '10px 8px', textAlign: 'right', color: stageMap[k] ? '#374151' : '#cbd5e1' }}>{stageMap[k] || 0}</td>
                  ))}
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{s.offers}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{s.offers_accepted}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#059669' }}>{s.joinees}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
