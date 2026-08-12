'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, useFetch } from '@/lib/useFetch';
import { getToken } from '@/lib/auth';
import { FileText, X, Download, Send, History, Loader2, CheckCircle } from 'lucide-react';

interface Props {
  candidate: { id: string; full_name: string; latest_resume_file_name?: string };
  requisitionId?: string;
  clientName?: string;
  onClose: () => void;
}

const radioRow: React.CSSProperties = { display: 'flex', gap: '8px', flexWrap: 'wrap' };
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px', display: 'block' };
const section: React.CSSProperties = { marginBottom: '16px' };

function OptBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} type="button" style={{
      padding: '6px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
      border: active ? '1.5px solid #1e40af' : '1px solid #e2e8f0',
      background: active ? '#eff6ff' : 'white', color: active ? '#1e40af' : '#475569',
    }}>{children}</button>
  );
}

export function ResumeGeneratorModal({ candidate, requisitionId, clientName, onClose }: Props) {
  const { data: templates } = useFetch<any[]>('/resume-generator/templates');

  const [templateId, setTemplateId] = useState('');
  const [nameFormat, setNameFormat] = useState<'full' | 'masked'>('full');
  const [showMobile, setShowMobile] = useState(true);
  const [showEmail, setShowEmail] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [companyMode, setCompanyMode] = useState<'original' | 'replace' | 'hide'>('original');
  const [companyReplacement, setCompanyReplacement] = useState('Aviin Technology');
  const [projectMode, setProjectMode] = useState<'include' | 'hide' | 'focus'>('include');
  const [clientNameMode, setClientNameMode] = useState<'show' | 'hide' | 'replace'>('hide');
  const [clientNameReplacement, setClientNameReplacement] = useState('');
  const [outputFormat, setOutputFormat] = useState<'pdf' | 'docx'>('pdf');

  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [recommendation, setRecommendation] = useState<any>(null);
  const [versions, setVersions] = useState<any[] | null>(null);
  const applied = useRef(false);

  function applyTemplate(t: any) {
    setTemplateId(t.id);
    setNameFormat(t.name_format);
    setShowMobile(t.show_mobile);
    setShowEmail(t.show_email);
    setShowLocation(t.show_location);
    setCompanyMode(t.company_mode);
    if (t.default_company_replacement) setCompanyReplacement(t.default_company_replacement);
    setProjectMode(t.project_mode);
    setClientNameMode(t.client_name_mode);
  }

  // Auto-recommend a starting template once, on open (52.9) — recruiter can freely override after.
  useEffect(() => {
    const url = `/resume-generator/candidates/${candidate.id}/recommend` + (requisitionId ? `?requisition_id=${requisitionId}` : '');
    apiFetch(url).then(r => {
      setRecommendation(r);
      if (r.template && !applied.current) { applyTemplate(r.template); applied.current = true; }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configBody = useCallback(() => ({
    template_id: templateId || undefined,
    name_format: nameFormat,
    show_mobile: showMobile,
    show_email: showEmail,
    show_location: showLocation,
    company_mode: companyMode,
    company_replacement: companyMode === 'replace' ? companyReplacement : undefined,
    project_mode: projectMode,
    client_name_mode: clientNameMode,
    client_name_replacement: clientNameMode === 'replace' ? clientNameReplacement : undefined,
    requisition_id: requisitionId || undefined,
  }), [templateId, nameFormat, showMobile, showEmail, showLocation, companyMode, companyReplacement, projectMode, clientNameMode, clientNameReplacement, requisitionId]);

  const runPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const r = await apiFetch(`/resume-generator/candidates/${candidate.id}/preview`, { method: 'POST', body: JSON.stringify(configBody()) });
      setPreview(r);
    } catch { /* preview is best-effort */ }
    setLoadingPreview(false);
  }, [candidate.id, configBody]);

  // Live preview — do not generate the final document until the recruiter
  // explicitly clicks Generate (spec 52.4). Debounced so toggling several
  // options quickly doesn't fire a preview call per click.
  useEffect(() => {
    const t = setTimeout(runPreview, 350);
    return () => clearTimeout(t);
  }, [runPreview]);

  async function generate(submitToKae = false) {
    setGenerating(true);
    setResult(null);
    try {
      const r = await apiFetch(`/resume-generator/candidates/${candidate.id}/generate`, {
        method: 'POST',
        body: JSON.stringify({ ...configBody(), output_format: outputFormat, submit_to_kae: submitToKae }),
      });
      setResult(r);
    } catch (e: any) {
      alert(e?.message || 'Failed to generate resume');
    }
    setGenerating(false);
  }

  async function downloadGenerated(id: string, ext: string) {
    const token = getToken();
    const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';
    const resp = await fetch(`${API}/resume-generator/${id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!resp.ok) { alert('Download failed: ' + resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(candidate.full_name || 'resume').replace(/[^A-Za-z0-9_-]+/g, '_')}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function loadVersions() {
    const r = await apiFetch(`/resume-generator/candidates/${candidate.id}/versions`);
    setVersions(r);
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' };
  const inputStyle: React.CSSProperties = { width: '100%', border: '1px solid #e2e8f0', borderRadius: '7px', padding: '7px 10px', fontSize: '12.5px', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '960px', maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '36px', height: '36px', background: '#eff6ff', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={18} style={{ color: '#1e40af' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', margin: 0 }}>Resume Generator</h2>
              <div style={{ fontSize: '12px', color: '#64748b' }}>
                {candidate.full_name}{candidate.latest_resume_file_name ? ` — ${candidate.latest_resume_file_name}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={loadVersions} style={{ display: 'flex', alignItems: 'center', gap: '5px', border: '1px solid #e2e8f0', background: 'white', borderRadius: '7px', padding: '6px 10px', fontSize: '11.5px', fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
              <History size={12} /> Versions
            </button>
            <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: configuration */}
          <div style={{ flex: '1 1 55%', padding: '18px 22px', overflowY: 'auto', borderRight: '1px solid #f1f5f9' }}>
            {recommendation?.template && (
              <div style={{ fontSize: '11.5px', color: '#7c3aed', background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '7px 10px', marginBottom: '14px' }}>
                Recommended: <strong>{recommendation.template.name}</strong> — {recommendation.reason}
              </div>
            )}

            <div style={section}>
              <span style={label}>Format / Template</span>
              <div style={radioRow}>
                {(templates || []).map(t => (
                  <OptBtn key={t.id} active={templateId === t.id} onClick={() => applyTemplate(t)}>{t.name}</OptBtn>
                ))}
              </div>
            </div>

            <div style={section}>
              <span style={label}>Name Display</span>
              <div style={radioRow}>
                <OptBtn active={nameFormat === 'full'} onClick={() => setNameFormat('full')}>Full Name</OptBtn>
                <OptBtn active={nameFormat === 'masked'} onClick={() => setNameFormat('masked')}>First Name + Last Initial</OptBtn>
              </div>
            </div>

            <div style={section}>
              <span style={label}>Contact</span>
              <div style={radioRow}>
                <OptBtn active={showMobile} onClick={() => setShowMobile(v => !v)}>Mobile: {showMobile ? 'Show' : 'Hide'}</OptBtn>
                <OptBtn active={showEmail} onClick={() => setShowEmail(v => !v)}>Email: {showEmail ? 'Show' : 'Hide'}</OptBtn>
                <OptBtn active={showLocation} onClick={() => setShowLocation(v => !v)}>Location: {showLocation ? 'Show' : 'Hide'}</OptBtn>
              </div>
            </div>

            <div style={section}>
              <span style={label}>Company</span>
              <div style={{ ...radioRow, marginBottom: companyMode === 'replace' ? '8px' : 0 }}>
                <OptBtn active={companyMode === 'original'} onClick={() => setCompanyMode('original')}>Original</OptBtn>
                <OptBtn active={companyMode === 'replace'} onClick={() => setCompanyMode('replace')}>Replace</OptBtn>
                <OptBtn active={companyMode === 'hide'} onClick={() => setCompanyMode('hide')}>Hide</OptBtn>
              </div>
              {companyMode === 'replace' && (
                <div>
                  <label style={{ fontSize: '10.5px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Replacement Company</label>
                  <input style={inputStyle} value={companyReplacement} onChange={e => setCompanyReplacement(e.target.value)} placeholder="e.g. Aviin Technology" />
                </div>
              )}
            </div>

            <div style={section}>
              <span style={label}>Projects</span>
              <div style={radioRow}>
                <OptBtn active={projectMode === 'include'} onClick={() => setProjectMode('include')}>Include</OptBtn>
                <OptBtn active={projectMode === 'hide'} onClick={() => setProjectMode('hide')}>Hide</OptBtn>
                <OptBtn active={projectMode === 'focus'} onClick={() => setProjectMode('focus')}>Project Focus</OptBtn>
              </div>
            </div>

            {requisitionId && (
              <div style={section}>
                <span style={label}>Client / Confidentiality {clientName ? `(${clientName})` : ''}</span>
                <div style={{ ...radioRow, marginBottom: clientNameMode === 'replace' ? '8px' : 0 }}>
                  <OptBtn active={clientNameMode === 'show'} onClick={() => setClientNameMode('show')}>Show Client Name</OptBtn>
                  <OptBtn active={clientNameMode === 'hide'} onClick={() => setClientNameMode('hide')}>Hide Client Name</OptBtn>
                  <OptBtn active={clientNameMode === 'replace'} onClick={() => setClientNameMode('replace')}>Replace Client Name</OptBtn>
                </div>
                {clientNameMode === 'replace' && (
                  <input style={inputStyle} value={clientNameReplacement} onChange={e => setClientNameReplacement(e.target.value)} placeholder="Replacement client label" />
                )}
              </div>
            )}

            <div style={section}>
              <span style={label}>Output Format</span>
              <div style={radioRow}>
                <OptBtn active={outputFormat === 'pdf'} onClick={() => setOutputFormat('pdf')}>PDF</OptBtn>
                <OptBtn active={outputFormat === 'docx'} onClick={() => setOutputFormat('docx')}>DOCX</OptBtn>
              </div>
            </div>
          </div>

          {/* Right: live preview */}
          <div style={{ flex: '1 1 45%', padding: '18px 22px', overflowY: 'auto', background: '#f8fafc' }}>
            <span style={label}>Live Preview {loadingPreview && <Loader2 size={11} style={{ display: 'inline', marginLeft: '4px', verticalAlign: 'middle' }} />}</span>
            {preview ? (
              <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', fontSize: '12.5px', color: '#0f172a' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, textAlign: 'center' }}>{preview.display_name}</div>
                {preview.designation && <div style={{ textAlign: 'center', color: '#1e40af', fontWeight: 600, fontSize: '12px', marginBottom: '8px' }}>{preview.designation}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', color: '#64748b', fontSize: '11.5px', marginBottom: '6px', justifyContent: 'center' }}>
                  {preview.mobile && <span>📱 {preview.mobile}</span>}
                  {preview.email && <span>✉️ {preview.email}</span>}
                  {preview.location && <span>📍 {preview.location}</span>}
                </div>
                {preview.company && <div style={{ fontSize: '11.5px', marginBottom: '6px' }}><b>Company:</b> {preview.company}</div>}
                {!!preview.skills?.length && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#1e40af', marginBottom: '3px' }}>KEY SKILLS</div>
                    <div style={{ fontSize: '11px', color: '#374151' }}>{preview.skills.join(', ')}</div>
                  </div>
                )}
                {preview.body_snippet && (
                  <div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#1e40af', marginBottom: '3px' }}>{preview.section_heading}</div>
                    <div style={{ fontSize: '11px', color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{preview.body_snippet}</div>
                  </div>
                )}
                {preview.client_line && <div style={{ marginTop: '10px', fontSize: '10.5px', color: '#94a3b8', fontStyle: 'italic' }}>Submitted for: {preview.client_line}</div>}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Loading preview…</div>
            )}

            {result && (
              <div style={{ marginTop: '14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#16a34a', fontWeight: 700, fontSize: '12.5px', marginBottom: '6px' }}>
                  <CheckCircle size={14} /> Generated (v{result.version})
                </div>
                {result.submitted_to_kae !== undefined && (
                  <div style={{ fontSize: '11.5px', color: result.submitted_to_kae ? '#16a34a' : '#dc2626', marginBottom: '6px' }}>
                    {result.submitted_to_kae ? 'Submitted to KAE via email.' : `Not submitted: ${result.submit_error || 'unknown error'}`}
                  </div>
                )}
                <button onClick={() => downloadGenerated(result.id, result.output_format)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '7px', border: '1px solid #bbf7d0', background: 'white', color: '#16a34a', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  <Download size={12} /> Download {result.output_format?.toUpperCase()}
                </button>
              </div>
            )}

            {versions && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '6px' }}>PRIOR VERSIONS ({versions.length})</div>
                {versions.length === 0 && <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>No prior generations for this candidate yet.</div>}
                {versions.map(v => (
                  <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #e2e8f0', fontSize: '11.5px' }}>
                    <span>v{v.version} — {v.template_name} ({v.output_format.toUpperCase()})</span>
                    <button onClick={() => downloadGenerated(v.id, v.output_format)} style={{ border: 'none', background: 'none', color: '#1e40af', cursor: 'pointer' }}><Download size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 22px', borderTop: '1px solid #f1f5f9' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: '#374151' }}>Cancel</button>
          {requisitionId && (
            <button onClick={() => generate(true)} disabled={generating} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '8px', border: 'none', background: generating ? '#94a3b8' : '#7c3aed', color: 'white', cursor: generating ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600 }}>
              <Send size={13} /> Generate &amp; Submit
            </button>
          )}
          <button onClick={() => generate(false)} disabled={generating} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', borderRadius: '8px', border: 'none', background: generating ? '#94a3b8' : '#1e40af', color: 'white', cursor: generating ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600 }}>
            {generating ? <Loader2 size={13} /> : <FileText size={13} />} {generating ? 'Generating…' : 'Generate Resume'}
          </button>
        </div>
      </div>
    </div>
  );
}
