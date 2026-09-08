'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, useFetch } from '@/lib/useFetch';
import { getToken } from '@/lib/auth';
import { FileText, X, Download, Send, History, Loader2, CheckCircle, Maximize2, Minimize2 } from 'lucide-react';
import { RichTextEditor } from './RichTextEditor';

// Real, safe seed for the rich-text summary editor's very first load --
// the auto-extracted text is plain (never contains real markup of its
// own), so this only ever needs to escape genuine HTML-special
// characters and turn real line breaks into <br> -- never a full HTML
// parser, since the input here is guaranteed plain by construction
// (backend/routers/resume_generator.py's preview endpoint).
function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div>${escaped.split('\n').join('<br>')}</div>`;
}

interface Props {
  candidate: { id: string; full_name: string; latest_resume_file_name?: string };
  requisitionId?: string;
  clientName?: string;
  onClose: () => void;
  // REAL BUG FIX (2026-09-09): "Generate & Submit" (submit_to_kae=true)
  // sends this straight to the recruiter->KAE hop (_do_kae_submission) --
  // correct from the candidate profile page, but wrong and confusing when
  // this same modal is opened from INSIDE the later Submit-to-Client flow
  // (the candidate is already past that stage there) -- would silently
  // re-fire a KAE submission email and stage bump that doesn't belong to
  // what the caller is actually doing. Callers in a client-facing context
  // pass this true to hide that specific action; every other real caller
  // (unset) keeps the original behavior unchanged.
  hideSubmitToKae?: boolean;
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

// Small logo-position indicator reused across every theme's live preview —
// mirrors where the real document's header logo will actually render
// (left/right/hidden), not just a caption.
function LogoChip({ position, dark }: { position: 'top_left' | 'top_right' | 'none'; dark?: boolean }) {
  if (position === 'none') return null;
  return (
    <div style={{ display: 'flex', justifyContent: position === 'top_left' ? 'flex-start' : 'flex-end', marginBottom: '6px' }}>
      <span style={{
        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px',
        color: dark ? '#000' : '#1e40af', background: dark ? 'transparent' : '#eff6ff',
        border: dark ? '1px solid #444' : 'none',
      }}>🏢 AviinTech</span>
    </div>
  );
}

export function ResumeGeneratorModal({ candidate, requisitionId, clientName, onClose, hideSubmitToKae }: Props) {
  const { data: templates } = useFetch<any[]>('/resume-generator/templates');
  const { data: visualThemes } = useFetch<any[]>('/resume-generator/visual-themes');
  const { data: logoPositionOptions } = useFetch<any[]>('/resume-generator/logo-position-options');

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
  const [visualTheme, setVisualTheme] = useState<'classic' | 'modern_sidebar' | 'minimal_ats' | 'executive_header' | 'two_tone_header' | 'timeline' | 'compact_grid' | 'elegant_serif'>('classic');
  const [logoPosition, setLogoPosition] = useState<'top_left' | 'top_right' | 'none'>('top_right');
  const [outputFormat, setOutputFormat] = useState<'pdf' | 'docx'>('pdf');

  const [preview, setPreview] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [recommendation, setRecommendation] = useState<any>(null);
  const [versions, setVersions] = useState<any[] | null>(null);
  const applied = useRef(false);
  // REAL FEATURE (2026-09-09, reported live: "not able to edit in the
  // resume and it should be full view with editing features... to edit
  // and add anything in the resume"). Seeded ONCE from the first real
  // preview response (auto-extracted content) so the KAE starts from
  // exactly what's already there, not a blank box -- see runPreview's own
  // seeding logic. Once set, it's the real source of truth sent as
  // content_overrides on every subsequent preview/generate call, so what
  // gets typed here is exactly what lands in the actual generated PDF/
  // DOCX (backend: _apply_content_overrides in resume_generator.py).
  // null means "not yet loaded" -- distinct from an intentionally blanked
  // field (empty string), which a real edit can produce.
  const [contentEdits, setContentEdits] = useState<{ display_name: string; designation: string; company: string; skills: string; summary: string } | null>(null);
  const [editorResetKey, setEditorResetKey] = useState(0);
  // REAL GAP FIX (2026-09-09, reported live: "resume should be full not
  // half right side view and full max size view and real resume page") --
  // the fixed 960px-wide modal squeezed the Live Preview into a cramped
  // half-column fighting the edit panel for room. Same real one-click
  // enlarge pattern already proven elsewhere in this app (pipeline/
  // page.tsx's ClientSubmissionMoveModal), not a new one invented here.
  const [enlarged, setEnlarged] = useState(false);

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
    if (t.visual_theme) setVisualTheme(t.visual_theme);
    if (t.logo_position) setLogoPosition(t.logo_position);
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
    visual_theme: visualTheme,
    logo_position: logoPosition,
    requisition_id: requisitionId || undefined,
    content_overrides: contentEdits || undefined,
  }), [templateId, nameFormat, showMobile, showEmail, showLocation, companyMode, companyReplacement, projectMode, clientNameMode, clientNameReplacement, visualTheme, logoPosition, requisitionId, contentEdits]);

  const runPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const r = await apiFetch(`/resume-generator/candidates/${candidate.id}/preview`, { method: 'POST', body: JSON.stringify(configBody()) });
      setPreview(r);
      // Seed the editable fields from the real auto-extracted content the
      // very first time (or after an explicit Reset, which nulls this back
      // out) -- never again after that, so the KAE's own typed edits are
      // never silently overwritten by a later debounced re-preview (e.g.
      // from switching visual theme).
      if (!contentEdits) {
        setContentEdits({
          display_name: r.display_name || '',
          designation: r.designation || '',
          company: r.company || '',
          skills: (r.skills || []).join(', '),
          summary: plainTextToHtml(r.body_snippet || ''),
        });
      }
    } catch { /* preview is best-effort */ }
    setLoadingPreview(false);
  }, [candidate.id, configBody, contentEdits]);

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
    // Real feature (2026-08-26): use the server's real "Candidate Name_
    // Position_TotalExp.ext" filename (Content-Disposition) instead of a
    // hand-built name-only one.
    const cd = resp.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename="([^"]+)"/);
    const a = document.createElement('a');
    a.href = url; a.download = m ? m[1] : `${(candidate.full_name || 'resume').replace(/[^A-Za-z0-9_-]+/g, '_')}.${ext}`;
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
      <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: enlarged ? '98vw' : '960px', height: enlarged ? '95vh' : undefined, maxHeight: '95vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', transition: 'max-width 0.15s ease' }} onClick={e => e.stopPropagation()}>
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
            <button onClick={() => setEnlarged(v => !v)} title={enlarged ? 'Restore size' : 'Full view'}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', border: '1px solid #e2e8f0', background: enlarged ? '#eff6ff' : 'white', borderRadius: '7px', padding: '6px 10px', fontSize: '11.5px', fontWeight: 600, color: enlarged ? '#1e40af' : '#374151', cursor: 'pointer' }}>
              {enlarged ? <Minimize2 size={12} /> : <Maximize2 size={12} />} {enlarged ? 'Restore' : 'Full View'}
            </button>
            <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: configuration */}
          <div style={{ flex: enlarged ? '0 0 400px' : '1 1 55%', padding: '18px 22px', overflowY: 'auto', borderRight: '1px solid #f1f5f9' }}>
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
              <span style={label}>Visual Layout</span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(visualThemes || []).map(vt => (
                  <button key={vt.id} type="button" onClick={() => setVisualTheme(vt.id)} title={vt.description} style={{
                    padding: '8px 12px', borderRadius: '9px', cursor: 'pointer', textAlign: 'left', maxWidth: '190px',
                    border: visualTheme === vt.id ? '1.5px solid #1e40af' : '1px solid #e2e8f0',
                    background: visualTheme === vt.id ? '#eff6ff' : 'white',
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: visualTheme === vt.id ? '#1e40af' : '#0f172a' }}>{vt.label}</div>
                    <div style={{ fontSize: '10.5px', color: '#64748b', marginTop: '2px', lineHeight: 1.35 }}>{vt.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={section}>
              <span style={label}>Logo Position</span>
              <div style={radioRow}>
                {(logoPositionOptions || []).map(lp => (
                  <OptBtn key={lp.id} active={logoPosition === lp.id} onClick={() => setLogoPosition(lp.id)}>{lp.label}</OptBtn>
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
            {/* REAL FEATURE (2026-09-09, reported live: "not able to edit
                in the resume... edit and add anything") -- plain-text
                edit fields for exactly the content shown below (name,
                designation, company, skills, summary), seeded from the
                real auto-extracted values. What's typed here is sent as
                content_overrides on every preview/generate call, so the
                Live Preview below updates with it and the real generated
                PDF/DOCX uses it too -- not a separate mockup. */}
            {contentEdits && (
              <div style={{ marginBottom: '16px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={label}>✏️ Edit Resume Content</span>
                  <button type="button" onClick={() => { setContentEdits(null); setEditorResetKey(k => k + 1); }}
                    style={{ fontSize: '10.5px', fontWeight: 600, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
                    ↺ Reset to auto-extracted
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ fontSize: '10.5px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Name</label>
                    <input style={inputStyle} value={contentEdits.display_name} onChange={e => setContentEdits({ ...contentEdits, display_name: e.target.value })} />
                  </div>
                  <div>
                    <label style={{ fontSize: '10.5px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Designation</label>
                    <input style={inputStyle} value={contentEdits.designation} onChange={e => setContentEdits({ ...contentEdits, designation: e.target.value })} />
                  </div>
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ fontSize: '10.5px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Company</label>
                  <input style={inputStyle} value={contentEdits.company} onChange={e => setContentEdits({ ...contentEdits, company: e.target.value })} />
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ fontSize: '10.5px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>Key Skills (comma-separated)</label>
                  <input style={inputStyle} value={contentEdits.skills} onChange={e => setContentEdits({ ...contentEdits, skills: e.target.value })} />
                </div>
                <div>
                  <label style={{ fontSize: '10.5px', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>
                    {preview?.section_heading || 'Professional Summary'}
                  </label>
                  {/* REAL SCOPE NOTE (2026-09-09): full rich rendering
                      (real bold/tables/bullets in the actual generated
                      document) is wired up for the Classic theme only so
                      far -- every other theme still uses this same real
                      edited text, just flattened to clean plain text
                      server-side (never raw HTML tags, never reverted).
                      Never claim more than what a given theme actually
                      does. */}
                  {visualTheme === 'classic' ? (
                    <div style={{ fontSize: '10px', color: '#16a34a', marginBottom: '4px' }}>✓ Font, size, bold/italic, bullet/numbered lists, and tables render exactly like this in the generated document.</div>
                  ) : (
                    <div style={{ fontSize: '10px', color: '#b45309', marginBottom: '4px' }}>⚠ This theme renders your words as plain text (formatting/tables not yet applied) — switch to the Classic theme above for full formatting in the generated document.</div>
                  )}
                  {/* Real bug fix (2026-09-09): a contentEditable editor
                      only ever seeds its DOM from `value` on first mount
                      (see RichTextEditor's own seeding effect -- writing
                      innerHTML on every render would reset the cursor
                      mid-type). Reset needs a genuinely fresh DOM node to
                      pick up the newly re-fetched auto-extracted content,
                      not just a new prop value the mounted instance would
                      otherwise ignore -- key forces that remount. */}
                  <RichTextEditor key={editorResetKey} value={contentEdits.summary} onChange={html => setContentEdits({ ...contentEdits, summary: html })} minHeight="160px" placeholder="Type the resume's summary/experience content here…" />
                </div>
              </div>
            )}
            <span style={label}>Live Preview {loadingPreview && <Loader2 size={11} style={{ display: 'inline', marginLeft: '4px', verticalAlign: 'middle' }} />}</span>
            {/* REAL GAP FIX (2026-09-09, reported live: "resume should be
                full not half right side view and full max size view and
                real resume page") -- a real page-mockup frame (off-white
                surface, generous max-width matching a real printed page,
                a drop shadow) around the exact same theme-rendered card
                every branch below already builds -- none of those 8
                branches were touched, just wrapped, so the enlarge toggle
                above and this frame are what actually make the preview
                read as a real page instead of a cramped half-column. */}
            <div style={{ background: '#e2e8f0', borderRadius: '10px', padding: enlarged ? '28px' : '16px', display: 'flex', justifyContent: 'center' }}>
              <div style={{ width: '100%', maxWidth: enlarged ? '820px' : '520px', boxShadow: '0 4px 18px rgba(15,23,42,0.12)', borderRadius: '10px' }}>
            {preview ? (
              visualTheme === 'modern_sidebar' ? (
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', display: 'flex', fontSize: '12px' }}>
                  <div style={{ background: '#1e3a5f', color: '#e8eef5', padding: '14px 12px', width: '38%', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#7fb3e0', marginBottom: '5px' }}>CONTACT</div>
                    {preview.mobile && <div style={{ marginBottom: '2px' }}>{preview.mobile}</div>}
                    {preview.email && <div style={{ marginBottom: '2px', wordBreak: 'break-all' }}>{preview.email}</div>}
                    {preview.location && <div style={{ marginBottom: '8px' }}>{preview.location}</div>}
                    {preview.company && (<><div style={{ fontSize: '9.5px', fontWeight: 700, color: '#7fb3e0', marginBottom: '5px' }}>COMPANY</div><div style={{ marginBottom: '8px' }}>{preview.company}</div></>)}
                    {!!preview.skills?.length && (
                      <>
                        <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#7fb3e0', marginBottom: '5px' }}>KEY SKILLS</div>
                        {preview.skills.slice(0, 10).map((s: string) => <div key={s} style={{ marginBottom: '2px' }}>• {s}</div>)}
                      </>
                    )}
                  </div>
                  <div style={{ padding: '14px 16px', flex: 1, color: '#0f172a' }}>
                    <LogoChip position={logoPosition} />
                    <div style={{ fontSize: '15px', fontWeight: 700 }}>{preview.display_name}</div>
                    {preview.designation && <div style={{ color: '#1e40af', fontWeight: 600, fontSize: '12px', marginBottom: '8px' }}>{preview.designation}</div>}
                    {preview.body_snippet && (
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: '#1e40af', marginBottom: '3px' }}>{preview.section_heading}</div>
                        <div style={{ fontSize: '11px', color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{preview.body_snippet}</div>
                      </div>
                    )}
                    {preview.client_line && <div style={{ marginTop: '10px', fontSize: '10.5px', color: '#94a3b8', fontStyle: 'italic' }}>Submitted for: {preview.client_line}</div>}
                  </div>
                </div>
              ) : visualTheme === 'minimal_ats' ? (
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', fontSize: '12.5px', color: '#000' }}>
                  <LogoChip position={logoPosition} dark />
                  <div style={{ fontSize: '14px', fontWeight: 700 }}>{preview.display_name}</div>
                  {preview.designation && <div style={{ fontSize: '12px', marginBottom: '6px' }}>{preview.designation}</div>}
                  <div style={{ borderTop: '1px solid #444', margin: '4px 0 8px' }} />
                  <div style={{ fontSize: '11.5px', color: '#000', marginBottom: '6px' }}>
                    {[preview.location, preview.mobile, preview.email].filter(Boolean).join('  |  ')}
                  </div>
                  {preview.company && <div style={{ fontSize: '11.5px', marginBottom: '6px' }}>Current Company: {preview.company}</div>}
                  {!!preview.skills?.length && (
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '10.5px', fontWeight: 700, marginBottom: '3px' }}>KEY SKILLS</div>
                      <div style={{ fontSize: '11px' }}>{preview.skills.join(', ')}</div>
                    </div>
                  )}
                  {preview.body_snippet && (
                    <div>
                      <div style={{ fontSize: '10.5px', fontWeight: 700, marginBottom: '3px' }}>{preview.section_heading}</div>
                      <div style={{ fontSize: '11px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{preview.body_snippet}</div>
                    </div>
                  )}
                  {preview.client_line && <div style={{ marginTop: '10px', fontSize: '10.5px', color: '#444' }}>Submitted for: {preview.client_line}</div>}
                </div>
              ) : visualTheme === 'executive_header' ? (
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', fontSize: '12.5px', color: '#0f172a' }}>
                  <LogoChip position={logoPosition} />
                  <div style={{ background: '#1e3a5f', color: 'white', padding: '14px 16px' }}>
                    <div style={{ fontSize: '17px', fontWeight: 700 }}>{preview.display_name}</div>
                    {preview.designation && <div style={{ fontSize: '12px', color: '#cbd5e1', marginTop: '2px' }}>{preview.designation}</div>}
                  </div>
                  <div style={{ padding: '14px 16px' }}>
                    {preview.company && <div style={{ fontSize: '11.5px', marginBottom: '6px' }}><b>Current Company:</b> {preview.company}</div>}
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
                </div>
              ) : visualTheme === 'two_tone_header' ? (
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', fontSize: '12.5px', color: '#0f172a' }}>
                  <LogoChip position={logoPosition} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 700 }}>{preview.display_name}</div>
                      {preview.designation && <div style={{ color: '#1e40af', fontWeight: 600, fontSize: '12px', marginTop: '2px' }}>{preview.designation}</div>}
                    </div>
                    <div style={{ background: '#eff6ff', padding: '8px 10px', borderRadius: '6px', fontSize: '10.5px', minWidth: '110px' }}>
                      {preview.mobile && <div>{preview.mobile}</div>}
                      {preview.email && <div style={{ wordBreak: 'break-all' }}>{preview.email}</div>}
                      {preview.location && <div>{preview.location}</div>}
                    </div>
                  </div>
                  <div style={{ borderTop: '1.5px solid #1e40af', margin: '8px 0 8px' }} />
                  {preview.company && <div style={{ fontSize: '11.5px', marginBottom: '6px' }}><b>Current Company:</b> {preview.company}</div>}
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
              ) : visualTheme === 'timeline' ? (
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', fontSize: '12.5px', color: '#0f172a' }}>
                  <LogoChip position={logoPosition} />
                  <div style={{ fontSize: '15px', fontWeight: 700, textAlign: 'center' }}>{preview.display_name}</div>
                  {preview.designation && <div style={{ textAlign: 'center', color: '#0d9488', fontWeight: 600, fontSize: '12px', marginBottom: '8px' }}>{preview.designation}</div>}
                  <div style={{ borderTop: '1.5px solid #0d9488', margin: '4px 0 8px' }} />
                  {preview.company && <div style={{ fontSize: '11.5px', marginBottom: '6px' }}><b>Current Company:</b> {preview.company}</div>}
                  {!!preview.skills?.length && (
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#0d9488', marginBottom: '3px' }}>KEY SKILLS</div>
                      <div style={{ fontSize: '11px', color: '#374151' }}>{preview.skills.join(', ')}</div>
                    </div>
                  )}
                  {preview.body_snippet && (
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#0d9488', marginBottom: '3px' }}>● {preview.section_heading}</div>
                      <div style={{ borderTop: '1px solid #cbd5e1', marginBottom: '4px' }} />
                      <div style={{ fontSize: '11px', color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{preview.body_snippet}</div>
                    </div>
                  )}
                  {preview.client_line && <div style={{ marginTop: '10px', fontSize: '10.5px', color: '#94a3b8', fontStyle: 'italic' }}>Submitted for: {preview.client_line}</div>}
                </div>
              ) : visualTheme === 'compact_grid' ? (
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', fontSize: '11.5px', color: '#0f172a' }}>
                  <LogoChip position={logoPosition} />
                  <div style={{ fontSize: '14px', fontWeight: 700, textAlign: 'center' }}>{preview.display_name}</div>
                  {preview.designation && <div style={{ textAlign: 'center', color: '#1e40af', fontWeight: 600, fontSize: '11px', marginBottom: '6px' }}>{preview.designation}</div>}
                  <div style={{ textAlign: 'center', fontSize: '10.5px', color: '#64748b', marginBottom: '6px' }}>
                    {[preview.location, preview.mobile, preview.email].filter(Boolean).join(' • ')}
                  </div>
                  <div style={{ borderTop: '1px solid #1e40af', margin: '4px 0 8px' }} />
                  {!!preview.skills?.length && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginBottom: '8px' }}>
                      {preview.skills.slice(0, 9).map((s: string) => (
                        <div key={s} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '3px 5px', textAlign: 'center', fontSize: '9.5px' }}>{s}</div>
                      ))}
                    </div>
                  )}
                  {preview.body_snippet && (
                    <div>
                      <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#1e40af', marginBottom: '3px' }}>{preview.section_heading}</div>
                      <div style={{ fontSize: '10px', color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.3 }}>{preview.body_snippet}</div>
                    </div>
                  )}
                  {preview.client_line && <div style={{ marginTop: '10px', fontSize: '10px', color: '#94a3b8', fontStyle: 'italic' }}>Submitted for: {preview.client_line}</div>}
                </div>
              ) : visualTheme === 'elegant_serif' ? (
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', fontSize: '12.5px', color: '#1c1917', fontFamily: 'Georgia, "Times New Roman", serif' }}>
                  <LogoChip position={logoPosition} />
                  <div style={{ fontSize: '17px', fontWeight: 700, textAlign: 'center' }}>{preview.display_name}</div>
                  {preview.designation && <div style={{ textAlign: 'center', color: '#7c2d12', fontStyle: 'italic', fontSize: '12px', marginBottom: '8px' }}>{preview.designation}</div>}
                  <div style={{ borderTop: '1.5px solid #7c2d12', margin: '2px 0 1px' }} />
                  <div style={{ borderTop: '0.5px solid #7c2d12', margin: '1px 0 8px' }} />
                  {preview.company && <div style={{ fontSize: '11.5px', marginBottom: '6px' }}><b>Current Company:</b> {preview.company}</div>}
                  {!!preview.skills?.length && (
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#7c2d12', marginBottom: '3px' }}>KEY SKILLS</div>
                      <div style={{ fontSize: '11px', color: '#1c1917' }}>{preview.skills.join(', ')}</div>
                    </div>
                  )}
                  {preview.body_snippet && (
                    <div>
                      <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#7c2d12', marginBottom: '3px' }}>{preview.section_heading}</div>
                      <div style={{ fontSize: '11px', color: '#1c1917', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{preview.body_snippet}</div>
                    </div>
                  )}
                  {preview.client_line && <div style={{ marginTop: '10px', fontSize: '10.5px', color: '#78716c', fontStyle: 'italic' }}>Submitted for: {preview.client_line}</div>}
                </div>
              ) : (
                <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', fontSize: '12.5px', color: '#0f172a' }}>
                  <LogoChip position={logoPosition} />
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
              )
            ) : (
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Loading preview…</div>
            )}
              </div>
            </div>

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
          {requisitionId && !hideSubmitToKae && (
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
