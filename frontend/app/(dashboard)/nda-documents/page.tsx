'use client';
import { useState } from 'react';
import { useFetch } from '@/lib/useFetch';
import { authHeaders, API } from '@/lib/auth';
import { FileSignature, Download, ExternalLink, Clock } from 'lucide-react';

const STATUS_BADGE: Record<string, { color: string; bg: string; label: string }> = {
  draft:            { color: '#64748b', bg: '#f1f5f9', label: 'Draft' },
  sent:             { color: '#d97706', bg: '#fffbeb', label: 'Awaiting Signature' },
  e_signed:         { color: '#16a34a', bg: '#f0fdf4', label: 'E-Signed' },
  manually_signed:  { color: '#16a34a', bg: '#f0fdf4', label: 'Manually Signed' },
  expired:          { color: '#dc2626', bg: '#fef2f2', label: 'Expired' },
};

const SIGN_METHOD_LABEL: Record<string, string> = {
  type_name: 'Type-name', otp: 'Type-name + OTP', manual: 'Manual upload',
};

function ago(ts: string) {
  if (!ts) return '—';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}

async function downloadPdf(applicationId: string) {
  const res = await fetch(`${API}/applications/${applicationId}/nda/pdf`, { headers: authHeaders() });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `nda_${applicationId.slice(0, 8)}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function NdaDocumentsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: ndas, loading } = useFetch<any[]>(`/nda${statusFilter ? `?status=${statusFilter}` : ''}`);

  const tabs = [
    { key: '', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'sent', label: 'Awaiting Signature' },
    { key: 'e_signed', label: 'E-Signed' },
    { key: 'manually_signed', label: 'Manually Signed' },
  ];

  return (
    <div className="anim-fade-up space-y-6">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FileSignature size={20} style={{ color: '#d97706' }} />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 }}>NDA Documents</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
            Every NDA / pre-contract agreement generated, sent, and signed across candidates
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setStatusFilter(t.key)}
            style={{ padding: '7px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${statusFilter === t.key ? '#1e40af' : '#e2e8f0'}`, background: statusFilter === t.key ? '#eff6ff' : 'white', color: statusFilter === t.key ? '#1e40af' : '#64748b' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32 }}>{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8, marginBottom: 8 }} />)}</div>
        ) : (ndas || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
            <FileSignature size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>No NDA documents yet</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Generate one from a candidate's NDA tab on the Pipeline board</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                {['Candidate', 'Job', 'Status', 'Method', 'Sent', 'Signed', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(ndas || []).map((n: any) => {
                const badge = STATUS_BADGE[n.status] || STATUS_BADGE.draft;
                return (
                  <tr key={n.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{n.candidate_name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{n.candidate_email}</div>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#475569' }}>{n.job_title}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: badge.bg, color: badge.color }}>{badge.label}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#475569' }}>{n.sign_method ? SIGN_METHOD_LABEL[n.sign_method] || n.sign_method : '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#94a3b8' }}><Clock size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />{n.sent_at ? ago(n.sent_at) : '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#94a3b8' }}>{n.signed_at ? ago(n.signed_at) : '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => downloadPdf(n.application_id)} title="Download PDF"
                          style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                          <Download size={12} style={{ color: '#64748b' }} />
                        </button>
                        <a href={`/candidates/${n.candidate_id || ''}`} title="Open candidate"
                          style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
                          <ExternalLink size={12} style={{ color: '#64748b' }} />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
