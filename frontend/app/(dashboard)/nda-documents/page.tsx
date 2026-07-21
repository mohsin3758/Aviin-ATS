'use client';
import { useState, useRef } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { authHeaders, API } from '@/lib/auth';
import { FileSignature, Download, ExternalLink, Clock, Upload, Trash2, FileText, RefreshCw } from 'lucide-react';

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

function TemplateSlot({ docType, title, tmpl, onChanged, showToast }: any) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}/settings/document-templates/${docType}`, { method: 'POST', headers: authHeaders(), body: fd });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || 'Upload failed'); }
      showToast(`${title} uploaded`);
      onChanged();
    } catch (e: any) { showToast(String(e?.message || 'Upload failed'), false); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Remove the ${title.toLowerCase()}? Future sends will use the auto-generated document instead.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/settings/document-templates/${docType}`, { method: 'DELETE' });
      showToast(`${title} removed`);
      onChanged();
    } catch (e: any) { showToast(String(e?.message || 'Remove failed'), false); } finally { setBusy(false); }
  }

  async function download() {
    const res = await fetch(`${API}/settings/document-templates/${docType}/download`, { headers: authHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = tmpl?.file_name || `${docType}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ flex: 1, minWidth: 260, border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: tmpl ? '#f0fdf4' : '#f8fafc' }}>
      <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <FileText size={15} style={{ color: tmpl ? '#16a34a' : '#94a3b8' }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{title}</div>
      </div>
      {tmpl ? (
        <>
          <div onClick={download} title="Download" style={{ fontSize: 12, color: '#15803d', marginBottom: 10, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tmpl.file_name}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => fileInputRef.current?.click()} disabled={busy}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#374151', cursor: 'pointer' }}>
              <RefreshCw size={11} /> Replace
            </button>
            <button onClick={remove} disabled={busy}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#dc2626', cursor: 'pointer' }}>
              <Trash2 size={11} /> Remove
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>No file uploaded — the auto-generated document is used instead</div>
          <button onClick={() => fileInputRef.current?.click()} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            <Upload size={12} /> {busy ? 'Uploading…' : 'Upload PDF or Word'}
          </button>
        </>
      )}
    </div>
  );
}

export default function NdaDocumentsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const { data: ndas, loading } = useFetch<any[]>(`/nda${statusFilter ? `?status=${statusFilter}` : ''}`);
  const { data: templates, refetch: refetchTemplates } = useFetch<any>('/settings/document-templates');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

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

      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 3 }}>Document Templates</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          Upload your own NDA and/or Contract file (PDF or Word). When sending a candidate their NDA, you can choose to attach one of these instead of the auto-generated document. Replace or remove any time.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <TemplateSlot docType="nda" title="NDA Template" tmpl={templates?.nda} onChanged={refetchTemplates} showToast={showToast} />
          <TemplateSlot docType="contract" title="Contract Template" tmpl={templates?.contract} onChanged={refetchTemplates} showToast={showToast} />
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

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? '#1e293b' : '#dc2626', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
