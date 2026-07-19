'use client';
import { useState } from 'react';
import { Building2, Download, FileText, Users, ChevronRight, RefreshCw } from 'lucide-react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Spinner } from '@/components/ui/Spinner';

function SubmissionPackModal({ client, onClose }: any) {
  const { data: pack, loading } = useFetch<any>(`/clients/${client.id}/submission-pack`);
  const [downloading, setDownloading] = useState(false);

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/submission-pack/pdf`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('airecruit_token')}` }
      });
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SubmissionPack_${client.name.replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      // Fallback: direct link
      window.open(
        `/api/clients/${client.id}/submission-pack/pdf`,
        '_blank'
      );
    } finally {
      setDownloading(false);
    }
  };

  const STAGE_LABELS: Record<string, string> = {
    sourced: 'Sourced', contacted: 'Contacted', interested: 'Interested',
    nda: 'NDA', screened: 'Screened', submitted: 'Submitted',
    l1_interview: 'L1 Interview', l2_interview: 'L2 Interview',
    offer: 'Offer', offer_accepted: 'Offer Accepted', placed: 'Placed',
    rejected: 'Rejected', hold: 'Hold'
  };

  const STAGE_COLOR: Record<string, string> = {
    placed: '#059669', offer_accepted: '#10b981', offer: '#3b82f6',
    submitted: '#8b5cf6', screened: '#f59e0b', l1_interview: '#6366f1',
    l2_interview: '#4f46e5', rejected: '#ef4444', sourced: '#94a3b8',
    contacted: '#64748b', interested: '#0ea5e9', hold: '#d97706',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
      <div style={{ background: 'white', borderRadius: '16px', width: '680px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', margin: 0 }}>{client.name}</h2>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0' }}>Submission Pack · {client.industry || 'All Roles'}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={downloadPdf}
              disabled={downloading || loading}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}
            >
              {downloading ? <Spinner size="sm" /> : <Download size={13} />}
              {downloading ? 'Downloading…' : 'Download PDF'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#94a3b8', lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px' }}><Spinner /></div>
          ) : !pack ? (
            <div style={{ color: '#94a3b8', textAlign: 'center', padding: '48px' }}>No data</div>
          ) : (
            <>
              {/* Summary pills */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
                <div style={{ padding: '8px 16px', background: '#eff6ff', borderRadius: '20px', fontSize: '13px', fontWeight: '600', color: '#2563eb' }}>
                  {pack.summary?.total_candidates ?? 0} Candidates
                </div>
                {Object.entries(pack.summary?.by_stage || {}).map(([stage, count]: any) => (
                  <div key={stage} style={{ padding: '6px 12px', background: '#f8fafc', borderRadius: '20px', fontSize: '12px', fontWeight: '600', color: STAGE_COLOR[stage] || '#64748b', border: '1px solid #e2e8f0' }}>
                    {STAGE_LABELS[stage] || stage}: {count}
                  </div>
                ))}
              </div>

              {/* Candidates table */}
              {pack.candidates?.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8', fontSize: '14px' }}>
                  No candidates submitted for this client yet.<br />
                  <span style={{ fontSize: '12px' }}>Add applications to requisitions linked to this client.</span>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Candidate', 'Role', 'Exp', 'Stage', 'Last Interview'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#64748b', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(pack.candidates || []).map((c: any) => {
                      const expYr = c.experience_months ? Math.floor(c.experience_months / 12) : 0;
                      const expMo = c.experience_months ? c.experience_months % 12 : 0;
                      const expStr = c.experience_months ? `${expYr}y ${expMo}m` : '—';
                      const ivDate = c.last_interview_at
                        ? new Date(c.last_interview_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                        : '—';
                      return (
                        <tr key={c.application_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: '600', color: '#0f172a' }}>{c.candidate_name}</div>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.email || ''}</div>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#475569', fontSize: '12px' }}>{c.requisition_title || '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '12px' }}>{expStr}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600', background: (STAGE_COLOR[c.stage] || '#94a3b8') + '20', color: STAGE_COLOR[c.stage] || '#64748b' }}>
                              {STAGE_LABELS[c.stage] || c.stage}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '12px' }}>{ivDate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const { data: clients, loading, refetch } = useFetch<any[]>('/clients');
  const [selected, setSelected] = useState<any>(null);

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {selected && <SubmissionPackModal client={selected} onClose={() => setSelected(null)} />}

      <div className="page-hero" style={{ background: 'linear-gradient(135deg,#0f172a,#1e3a5f,#2563eb)' }}>
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <h1 className="text-white text-2xl font-bold mb-1">Clients & Submission Packs</h1>
            <p style={{ color: '#93c5fd', fontSize: '13px' }}>Download per-client candidate submission reports as PDF</p>
          </div>
          <button onClick={() => refetch()} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', color: 'white', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '600' }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {loading ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px' }}><Spinner /></div>
        ) : !clients?.length ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px', color: '#94a3b8' }}>No clients found.</div>
        ) : (
          clients.map((c: any) => (
            <div key={c.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg,#1e3a5f,#2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Building2 size={18} color="white" />
                  </div>
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a' }}>{c.name}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.industry || 'No industry set'}</div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setSelected(c)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px 14px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                >
                  <Users size={13} /> Submission Pack
                </button>
                <button
                  onClick={async () => {
                    const apiBase = '/api';
                    const token = localStorage.getItem('airecruit_token');
                    const res = await fetch(`${apiBase}/clients/${c.id}/submission-pack/pdf`, { headers: { Authorization: `Bearer ${token}` } });
                    if (res.ok) {
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `SubmissionPack_${c.name.replace(/\s+/g,'_')}.pdf`; a.click();
                      URL.revokeObjectURL(url);
                    }
                  }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '8px 12px', background: '#1e3a5f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                  title="Download PDF directly"
                >
                  <Download size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
