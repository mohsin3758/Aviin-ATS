'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { Modal, FormField, FormRow, SectionDivider, FormActions } from '@/components/ui/Modal';
import { Plus, Search, Briefcase, MapPin, Users, Eye, Edit, Trash2, Calendar, DollarSign, Clock , Link2, Copy, LayoutGrid, Grid2x2, List, Table2, X, ArrowLeft, Download, Mail, Phone, ExternalLink, Star, CheckCircle } from 'lucide-react';

// Same auth-gated blob-fetch pattern already used by the Candidate 360
// page's own Download Resume button — duplicated here (not imported
// cross-page) matching this file's existing AiMatchModal/AddCandidateModal
// precedent of small, self-contained components over cross-page imports.
async function downloadResume(fileId: string, fileName: string) {
  const token = localStorage.getItem('airecruit_token');
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '/api';
  try {
    const resp = await fetch(`${apiBase}/resume-intake/${fileId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) { alert('Download failed: ' + resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName || 'resume';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { alert('Download error: ' + String(e)); }
}

const SKILLS_LIST = [
  'Python','Java','React','Node.js','FastAPI','Django','AWS','Docker','Kubernetes',
  'PostgreSQL','MongoDB','TypeScript','Go','DevOps','Machine Learning','Data Science',
  'Salesforce','Angular','Vue.js','Spring Boot','Microservices','REST APIs',
  'QA Automation','Business Analysis','IT Recruitment','Talent Acquisition',
  'SAP','Oracle','Power BI','Tableau','Azure','GCP','Terraform','Jenkins','Git',
  'Redis','Elasticsearch','Kafka','RabbitMQ','C#','.NET','PHP','Laravel',
  'Flutter','React Native','iOS','Android','Blockchain','Cybersecurity',
  'SIEM','Penetration Testing',
];

const EMPTY_FORM = {
  title: '', client_name: '', client_id: '', industry: '', priority: 'medium',
  employment_type: 'contract', work_mode: 'onsite', shift_type: 'day',
  // Real multi-select fields (2026-08-24) — arrays are now the source of
  // truth; employment_type/work_mode above stay in sync as arrays[0] so
  // the many existing single-value display call sites keep working
  // unmodified. shift_timing_ids is new/additive alongside shift_type
  // (a general day/night/rotational category), not a replacement for it.
  employment_types: ['contract'] as string[],
  work_modes: ['onsite'] as string[],
  shift_timing_ids: [] as string[],
  positions_count: 1,
  location: '', expected_start_date: '', deadline: '', sla_hours: '' as any,
  submission_limit_per_recruiter: '' as any,
  experience_min: 0, experience_max: 10, notice_period_max: 60,
  education_required: '',
  budget_min: '' as any, budget_max: '' as any,
  bill_rate_min: '' as any, bill_rate_max: '' as any,
  skills_required: [] as string[],
  mandatory_skills: [] as string[],
  description: '',
};

const TYPE_BADGE: Record<string, string> = {
  contract: 'badge-blue', fulltime: 'badge-green', c2h: 'badge-purple',
  fte: 'badge-teal', part_time: 'badge-gray', fl_contract: 'badge-amber',
};
const TYPE_LABEL: Record<string, string> = {
  contract: 'Contract', fulltime: 'Full-time', c2h: 'Contract to Hire',
  fte: 'FTE', part_time: 'Part-time', fl_contract: 'FL Contract',
};
const WORK_MODE_LABEL: Record<string, string> = {
  onsite: 'Onsite', remote: 'Remote', hybrid: 'Hybrid',
};

// Real multi-select checkbox-chip control (2026-08-24) — reused for
// Employment Type, Work Mode, and Shift Timing presets, matching this
// file's existing chip-tag visual convention (skills_required) rather
// than a native <select multiple>, which has poor UX for a handful of
// short options.
function MultiSelectChips({
  options, selected, onToggle, colorFor,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  colorFor?: (value: string) => { color: string; bg: string; border: string };
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {options.map(opt => {
        const active = selected.includes(opt.value);
        const c = colorFor ? colorFor(opt.value) : { color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' };
        return (
          <button
            key={opt.value}
            type="button"
            data-testid={`chip-${opt.value}`}
            onClick={() => onToggle(opt.value)}
            style={{
              padding: '6px 12px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 600,
              cursor: 'pointer', transition: 'all .12s',
              border: `1px solid ${active ? c.border : '#e2e8f0'}`,
              background: active ? c.bg : 'white',
              color: active ? c.color : '#64748b',
            }}
          >
            {active ? '✓ ' : ''}{opt.label}
          </button>
        );
      })}
    </div>
  );
}

// Client / Company Name — real searchable combobox against the actual
// `clients` table (2026-08-25). Real gap found live: this field was a
// plain free-text input, and the form never populated client_id at all
// (only the free-text client_name column) — so a genuinely existing
// client like "Invenio" never showed up while typing, and even picking
// its exact name wouldn't have linked the requisition to the real
// client record (breaking KAE ownership/account P&L/client-portal/
// submission-template features that key off client_id). Typing still
// works for a genuinely new client not yet in the system — selecting a
// suggestion is what links client_id; typing without selecting keeps
// client_id cleared so a stale id from a previous selection can never
// silently carry over onto an unrelated typed name.
function ClientNameCombobox({
  value, clientId, onSelect, onChangeText,
}: {
  value: string;
  clientId: string;
  onSelect: (c: { id: string; name: string }) => void;
  onChangeText: (text: string) => void;
}) {
  const { data: clientsRaw } = useFetch<any[]>('/clients');
  const clients: any[] = clientsRaw || [];
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const filtered = q ? clients.filter((c: any) => c.name?.toLowerCase().includes(q)) : clients;
  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px',
    padding: '9px 12px', fontSize: '13px', outline: 'none',
    color: '#1e293b', background: 'white', boxSizing: 'border-box',
  };
  // Real follow-up gap fix, same day: typing a client's FULL, EXACT name
  // and tabbing away without ever clicking the suggestion (a confident
  // recruiter has no reason to expect a click is required) left client_id
  // unlinked, silently reproducing the original bug for the one case
  // where the user is most sure they typed something real. On blur, if
  // nothing was explicitly selected and the typed text case-insensitively
  // matches exactly one real client, auto-link it -- deliberately only on
  // an exact, unambiguous match, never a partial one, so a genuinely new
  // client name that happens to be a substring of an existing one is
  // never wrongly auto-linked.
  const handleBlur = () => {
    setTimeout(() => {
      setOpen(false);
      if (!clientId && q) {
        const exact = clients.filter((c: any) => c.name?.toLowerCase() === q);
        if (exact.length === 1) onSelect({ id: exact[0].id, name: exact[0].name });
      }
    }, 150);
  };
  return (
    <div style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        placeholder="Type to search existing clients, e.g. Invenio..."
        value={value}
        onChange={e => { onChangeText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        data-testid="client-name-input"
      />
      {clientId && (
        <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <CheckCircle size={11} /> Linked to existing client record
        </div>
      )}
      {open && filtered.length > 0 && (
        <div data-testid="client-name-dropdown" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 50, maxHeight: '220px', overflowY: 'auto' }}>
          {filtered.slice(0, 30).map((c: any) => (
            <button
              key={c.id}
              type="button"
              data-testid={`client-option-${c.id}`}
              onMouseDown={e => { e.preventDefault(); onSelect({ id: c.id, name: c.name }); setOpen(false); }}
              style={{ width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid #f8fafc', background: c.id === clientId ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: '12.5px', color: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <span>{c.name}{c.industry ? <span style={{ color: '#94a3b8' }}> · {c.industry}</span> : null}</span>
              {c.id === clientId && <CheckCircle size={12} color="#2563eb" />}
            </button>
          ))}
        </div>
      )}
      {open && q && filtered.length === 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 50, padding: '10px 12px', fontSize: '12px', color: '#94a3b8' }}>
          No existing client matches "{value.trim()}" — will be saved as a new client name (no linked record).
        </div>
      )}
    </div>
  );
}

// Manual/custom Shift Timing entry (2026-08-24) — the tenant-configured
// preset chips above are the fast path, but a recruiter posting a job
// with a genuinely new region/timing shouldn't have to leave this form
// and go to Settings > Ops Settings first. Creates a REAL, reusable
// preset via the same endpoint that page manages (not a disconnected
// free-text field) so it's immediately available for future jobs too,
// then auto-selects it on this one.
function ShiftTimingCustomAdd({ onCreated }: { onCreated: (newTiming: any) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: '', region: '', start_time: '09:00', end_time: '18:00', timezone_label: 'IST' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!form.label.trim() || !form.region.trim()) { setError('Label and Region are required'); return; }
    setSaving(true); setError('');
    try {
      const created = await apiFetch('/shift-timings', { method: 'POST', body: JSON.stringify(form) });
      onCreated(created);
      setOpen(false);
      setForm({ label: '', region: '', start_time: '09:00', end_time: '18:00', timezone_label: 'IST' });
    } catch (e: any) {
      setError(e.message || 'Could not save this shift timing');
    } finally { setSaving(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{
        padding: '6px 12px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 600,
        cursor: 'pointer', border: '1px dashed #cbd5e1', background: 'white', color: '#2563eb',
      }}>+ Add Custom Timing</button>
    );
  }

  const miniInput: React.CSSProperties = {
    border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 8px', fontSize: '12px', boxSizing: 'border-box',
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#f8fafc', marginTop: '6px' }}>
      {error && <div style={{ fontSize: '11px', color: '#dc2626', marginBottom: '8px' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '8px', marginBottom: '8px' }}>
        <input placeholder="Label (e.g. Germany Shift)" value={form.label}
          onChange={e => setForm(f => ({ ...f, label: e.target.value }))} style={{ ...miniInput, width: '100%' }} />
        <input placeholder="Region (e.g. Germany)" value={form.region}
          onChange={e => setForm(f => ({ ...f, region: e.target.value }))} style={{ ...miniInput, width: '100%' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
        <div>
          <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Start</label>
          <input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} style={{ ...miniInput, width: '100%' }} />
        </div>
        <div>
          <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>End</label>
          <input type="time" value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} style={{ ...miniInput, width: '100%' }} />
        </div>
        <div>
          <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '2px' }}>Timezone</label>
          <input placeholder="IST" value={form.timezone_label} onChange={e => setForm(f => ({ ...f, timezone_label: e.target.value }))} style={{ ...miniInput, width: '100%' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" onClick={submit} disabled={saving} style={{
          padding: '6px 14px', background: '#2563eb', color: 'white', border: 'none',
          borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: saving ? 'default' : 'pointer',
        }}>{saving ? 'Saving…' : 'Save & Select'}</button>
        <button type="button" onClick={() => { setOpen(false); setError(''); }} style={{
          padding: '6px 14px', background: 'white', color: '#64748b', border: '1px solid #e2e8f0',
          borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        }}>Cancel</button>
      </div>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-green', on_hold: 'badge-amber', filled: 'badge-blue', closed: 'badge-gray',
};
const PRIORITY_CONFIG: Record<string, { emoji: string; color: string; bg: string; border: string }> = {
  critical: { emoji: '🟣', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  high:     { emoji: '🔴', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  medium:   { emoji: '🟡', color: '#ca8a04', bg: '#fefce8', border: '#fde68a' },
  low:      { emoji: '🟢', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
};
const WORK_MODE_CONFIG: Record<string, { color: string; bg: string }> = {
  onsite: { color: '#2563eb', bg: '#eff6ff' },
  remote: { color: '#7c3aed', bg: '#f5f3ff' },
  hybrid: { color: '#0891b2', bg: '#ecfeff' },
};

// Shared badge for the (possibly multi-select) employment type — shows
// the primary type plus a real "+N" for any additional types actually
// selected, rather than silently only ever showing the scalar.
function EmploymentTypeBadge({ req, style }: { req: any; style?: React.CSSProperties }) {
  const extra = (req.employment_types?.length || 0) - 1;
  return (
    <span className={`badge ${TYPE_BADGE[req.employment_type] || 'badge-gray'}`} style={{ fontSize: '10px', ...style }}
      title={req.employment_types?.length > 1 ? req.employment_types.map((t: string) => TYPE_LABEL[t] || t).join(', ') : undefined}>
      {TYPE_LABEL[req.employment_type] || req.employment_type}{extra > 0 ? ` +${extra}` : ''}
    </span>
  );
}

function daysRemaining(deadline: string | null, clientNow?: number): number | null {
  if (!deadline || !clientNow) return null;
  const diff = new Date(deadline).getTime() - clientNow;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function fmtLakh(val: number): string {
  if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `${(val / 1000).toFixed(0)}K`;
  return String(val);
}

// Shared across all 4 view modes so Details/List/Small carry the exact
// same stage breakdown and Share action Cards always had — those two
// were previously Card-only, which is what made switching views feel
// like losing information rather than just re-laying it out.
function pillStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    fontSize: '10px', fontWeight: 700, padding: '2px 7px',
    borderRadius: 10, background: color + '14', color, border: `1px solid ${color}30`,
    whiteSpace: 'nowrap',
  };
}

function StageBreakdown({ counts }: { counts?: any }) {
  if (!counts) return null;
  const stages: { key: string; label: string; color: string; count: number }[] = counts.stages || [];
  const active = stages.filter((s: any) => s.count > 0);
  if (!active.length && !(counts.rejected > 0)) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      {active.map(s => (
        <span key={s.key} style={pillStyle(s.color)}>{s.count} {s.label}</span>
      ))}
      {counts.rejected > 0 && (
        <span style={pillStyle('#94a3b8')}>{counts.rejected} Rejected</span>
      )}
    </div>
  );
}

function InboxBadge({ reqId, count, iconOnly }: { reqId: string; count: number; iconOnly?: boolean }) {
  if (!count) return null;
  return (
    <a href={`/resume-inbox?req=${reqId}`} title="Resumes auto-matched to this JD from inbox" style={{ textDecoration: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: iconOnly ? '3px 8px' : '3px 10px', borderRadius: 20, background: '#7c3aed', cursor: 'pointer' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#fff' }}>{count}</span>
        <span style={{ fontSize: 9, fontWeight: 600, color: '#e9d5ff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Inbox</span>
      </div>
    </a>
  );
}

// The "Inbox" badge above only ever counts resumes that arrived via
// email/WhatsApp AFTER this job existed and got auto-matched to it at
// intake time — it's a real, live-accumulating count, not a snapshot of
// the whole candidate database. A brand-new job genuinely starts at 0
// and stays there until new resumes come in, which reads as "broken" to
// a user expecting an immediate AI match against everyone already in the
// system. That AI match already exists (GET /requisitions/{id}/
// match-candidates — pgvector cosine similarity + skill overlap, the
// same endpoint the Pipeline board's "Add Candidate" modal already
// uses) — it just wasn't reachable from this list. Made on-demand
// (not eager per-row) since a cosine-similarity scan is materially more
// expensive than the plain aggregate /pipeline/req-stage-counts query
// this page already runs for every row on load.
function AiMatchFinder({ reqId, reqTitle, onAdded }: { reqId: string; reqTitle?: string; onAdded?: () => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [matches, setMatches] = useState<any[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  // REAL BUG FIX (2026-08-23): reported live — "AI Match" showed the same
  // "50+" badge on nearly every role regardless of actual fit. That "50"
  // was never a real match count, just the query's own display cap - the
  // backend now applies a genuine relevance check (a real matched skill,
  // not just hitting a candidate-count limit) and returns an honest
  // total_matches separate from the display-limited list.
  const find = async (e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    if (state === 'loading') return;
    setState('loading');
    try {
      const data = await apiFetch(`/requisitions/${reqId}/match-candidates?limit=50`);
      setMatches(Array.isArray(data?.matches) ? data.matches : []);
      setTotalMatches(typeof data?.total_matches === 'number' ? data.total_matches : 0);
      setState('done');
    } catch {
      setState('error');
    }
  };

  if (state === 'done') {
    if (totalMatches === 0) {
      return <span style={{ fontSize: '11px', color: '#94a3b8' }}>No AI matches found</span>;
    }
    return (
      <>
        {/* REAL FIX (2026-08-20): this used to link to /pipeline?job=<id>,
            which lands on an empty Kanban board — the matched-candidate
            list itself only ever lived inside that page's separate "Add
            Candidate" modal, one more click away and not obviously
            connected to what was just found here. Opens the same
            ranked-list-with-AI-score UI right on this page instead, so
            "Find AI Matches" -> "see the list" -> "add to pipeline" is
            one flow, not a redirect into a different feature. */}
        <button onClick={e => { e.stopPropagation(); e.preventDefault(); setModalOpen(true); }}
          title="Review these AI-matched candidates and add them to the pipeline"
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, background: '#059669', border: 'none', cursor: 'pointer' }}>
          <span style={{ fontSize: '11px', fontWeight: 800, color: '#fff' }}>{totalMatches}</span>
          <span style={{ fontSize: '9px', fontWeight: 600, color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>✨ AI Match</span>
        </button>
        {modalOpen && (
          <AiMatchModal
            reqId={reqId} reqTitle={reqTitle} matches={matches}
            onClose={() => setModalOpen(false)}
            onAdded={() => { setModalOpen(false); onAdded?.(); }}
          />
        )}
      </>
    );
  }

  return (
    <button onClick={find} disabled={state === 'loading'}
      title="Search the existing candidate database for AI-based JD matches"
      style={{
        display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: 20,
        background: state === 'error' ? '#fef2f2' : '#eff6ff',
        border: `1px solid ${state === 'error' ? '#fecaca' : '#bfdbfe'}`,
        color: state === 'error' ? '#dc2626' : '#2563eb',
        fontSize: '10px', fontWeight: 600, cursor: state === 'loading' ? 'wait' : 'pointer', whiteSpace: 'nowrap',
      }}>
      {state === 'loading' ? '⏳ Searching…' : state === 'error' ? 'Retry AI Match' : '🔍 Find AI Matches'}
    </button>
  );
}

// Shares the exact visual language (score badge, skill chips, stage
// picker) and the same /candidates/bulk-assign call as the Pipeline
// board's AddCandidateModal — kept as its own component rather than
// imported cross-page since that one is coupled to the pipeline board's
// own board/state, but built to match it closely on purpose so a
// recruiter sees one consistent "AI match" UI everywhere it appears.
function aiScoreColor(s: number | null) {
  if (!s) return '#94a3b8';
  if (s >= 80) return '#16a34a';
  if (s >= 65) return '#0891b2';
  if (s >= 50) return '#f59e0b';
  return '#dc2626';
}
function aiScoreBg(s: number | null) {
  if (!s) return '#f8fafc';
  if (s >= 80) return '#f0fdf4';
  if (s >= 65) return '#ecfeff';
  if (s >= 50) return '#fffbeb';
  return '#fef2f2';
}
function fmtExpMonths(mo: number) {
  if (!mo) return '0mo';
  const y = Math.floor(mo / 12), m = mo % 12;
  return y > 0 ? `${y}y${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
}

function AiMatchModal({ reqId, reqTitle, matches, onClose, onAdded }: {
  reqId: string; reqTitle?: string; matches: any[]; onClose: () => void; onAdded: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // REAL BUG FIX (2026-08-21): "View Profile" used to be a plain <a
  // target="_blank"> link — reported live: after opening a candidate this
  // way and clicking the profile page's own "Back" button, it dropped
  // the user on the plain Candidates list instead of returning to this
  // modal (a separate, now-also-fixed bug in that page — see candidates/
  // [id]/page.tsx's goBack()). Rather than depend on cross-page/cross-tab
  // navigation at all, viewing a candidate now opens an inline preview
  // right inside this same modal — nothing to "come back" from, the
  // ranked list and every already-fetched match stays exactly as it was.
  // A "Open Full Profile" escape hatch still opens the real page in a
  // new tab for anyone who wants the complete Candidate 360 view.
  const [previewCandidateId, setPreviewCandidateId] = useState<string | null>(null);
  const { data: stageConfig } = useFetch<any[]>('/settings/pipeline-stages');
  const visibleStages = (stageConfig || []).filter((s: any) => s.is_visible)
    .sort((a: any, b: any) => a.display_order - b.display_order);
  const defaultAddStageKey = (stageConfig || []).find((s: any) => s.is_default_add)?.stage_key || 'sourced';
  const [targetStage, setTargetStage] = useState('');
  // REAL BUG FOUND 2026-08-20: firing this the instant defaultAddStageKey
  // is truthy locked in the 'sourced' fallback on the very first render
  // (stageConfig is still null/[] then, so defaultAddStageKey falls back
  // to the literal 'sourced' before the real /settings/pipeline-stages
  // fetch ever resolves) - and since the guard only checks `!targetStage`,
  // it never re-fired once the real tenant default (e.g. 'interested')
  // loaded. Confirmed live via a real network-request interception: the
  // dropdown visually showed "Interested" (a <select> with an unmatched
  // value silently falls back to displaying the first real <option>) while
  // the actual submitted stage was "sourced" - a hidden stage - the whole
  // time. Gated on stageConfig actually having loaded, not just on the
  // (always-truthy) fallback-masked defaultAddStageKey.
  useEffect(() => {
    if (!targetStage && stageConfig && stageConfig.length > 0) setTargetStage(defaultAddStageKey);
  }, [stageConfig, defaultAddStageKey, targetStage]);

  const q = search.trim().toLowerCase();
  const items = (matches || []).filter((c: any) =>
    !q ||
    c.full_name?.toLowerCase().includes(q) ||
    c.current_designation?.toLowerCase().includes(q) ||
    c.current_employer?.toLowerCase().includes(q) ||
    c.skills?.some((s: string) => s.toLowerCase().includes(q))
  );

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await apiFetch('/candidates/bulk-assign', {
        method: 'POST',
        body: JSON.stringify({ candidate_ids: Array.from(selected), requisition_id: reqId, stage: targetStage || undefined }),
      });
      onAdded();
    } catch (e: any) {
      alert(String(e?.message || 'Failed to add candidates'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: 560, maxWidth: '94vw', maxHeight: '84vh', background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>✨ AI Matched Candidates{reqTitle ? ` — ${reqTitle}` : ''}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Ranked by JD match score — highest first</div>
          </div>
          <button onClick={onClose} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94a3b8' }}><X size={14} /></button>
        </div>
        {previewCandidateId ? (
          <CandidatePreviewPanel
            candidateId={previewCandidateId}
            isSelected={selected.has(previewCandidateId)}
            onToggle={() => toggle(previewCandidateId)}
            onBack={() => setPreviewCandidateId(null)}
          />
        ) : (
        <>
        <div style={{ padding: '12px 18px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px' }}>
            <Search size={13} color="#94a3b8" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by name, skill, employer…" autoFocus
              style={{ border: 'none', background: 'none', outline: 'none', fontSize: 12, color: '#374151', flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', flexShrink: 0 }}>Add into stage:</span>
            <select value={targetStage} onChange={e => setTargetStage(e.target.value)}
              style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontWeight: 600, color: '#1e293b', background: '#fff' }}>
              {visibleStages.map((s: any) => <option key={s.stage_key} value={s.stage_key}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px' }}>
          {items.length === 0 && <div style={{ textAlign: 'center', color: '#cbd5e1', fontSize: 12, padding: 20, fontStyle: 'italic' }}>No matching candidates found</div>}
          {items.map((c: any) => {
            const isSelected = selected.has(c.candidate_id);
            // REAL FIX (2026-08-20): this row used to be a <label> wrapping
            // the checkbox, so there was no way to add a "View Profile"
            // link without it also toggling the checkbox (clicking
            // anywhere in a <label> activates its associated <input>) —
            // exactly the "not able to check the candidate before adding"
            // complaint. Switched to a plain row-click-to-toggle div (the
            // same stopPropagation convention already used elsewhere in
            // this codebase for this exact class of nested-clickable bug),
            // so the View Profile link/icon can sit inside without also
            // selecting the row.
            return (
              <div key={c.candidate_id} onClick={() => toggle(c.candidate_id)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', background: isSelected ? '#eff6ff' : 'transparent', marginBottom: 2 }}>
                <input type="checkbox" checked={isSelected} onChange={() => toggle(c.candidate_id)} onClick={e => e.stopPropagation()} style={{ marginTop: 3 }} />
                <div style={{ width: 40, height: 40, borderRadius: '50%', border: `2px solid ${aiScoreColor(c.fit_score)}`, background: aiScoreBg(c.fit_score), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: aiScoreColor(c.fit_score), flexShrink: 0 }}>
                  {Math.round(c.fit_score || 0)}%
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>{c.full_name}</span>
                    <button onClick={e => { e.stopPropagation(); setPreviewCandidateId(c.candidate_id); }}
                      title="Preview full profile & resume before adding — stays on this list"
                      style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, color: '#2563eb', cursor: 'pointer', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 999, padding: '1px 7px' }}>
                      <Eye size={9} /> View Profile
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                    {[c.current_designation, c.current_employer].filter(Boolean).join(' @ ') || '—'}
                    {c.total_exp_mo > 0 && ` · ${fmtExpMonths(c.total_exp_mo)} exp`}
                    {c.location && ` · ${c.location}`}
                  </div>
                  {c.missing_skills?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                      {(c.matched_skills?.length ? c.matched_skills : (c.skills || [])).slice(0, 4).map((sk: string) => (
                        <span key={sk} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>{sk}</span>
                      ))}
                      {c.missing_skills.slice(0, 3).map((sk: string) => (
                        <span key={'m-' + sk} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>✕ {sk}</span>
                      ))}
                    </div>
                  )}
                  {!(c.missing_skills?.length > 0) && c.skills?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                      {c.skills.slice(0, 5).map((sk: string) => (
                        <span key={sk} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>{sk}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>
        )}
        <div style={{ padding: '12px 18px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{selected.size} selected</span>
          <button onClick={submit} disabled={selected.size === 0 || saving}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: selected.size === 0 || saving ? '#94a3b8' : '#2563eb', color: '#fff', fontSize: 12, fontWeight: 700, cursor: selected.size === 0 || saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Adding…' : `Add ${selected.size || ''} to ${visibleStages.find((s: any) => s.stage_key === targetStage)?.label || 'Pipeline'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline candidate preview inside AiMatchModal — fetched on demand only
// when a recruiter actually clicks "View Profile" on one candidate, not
// eagerly for every ranked match. Deliberately does NOT navigate to
// /candidates/{id}: that was the original implementation and the direct
// cause of the reported bug (the Candidate 360 page's own "Back" button
// couldn't reliably return here — see candidates/[id]/page.tsx's
// goBack() for the companion fix to that page for every OTHER path into
// it). Staying inside this same modal means there is nothing to "go
// back" from at all.
function CandidatePreviewPanel({ candidateId, isSelected, onToggle, onBack }: {
  candidateId: string; isSelected: boolean; onToggle: () => void; onBack: () => void;
}) {
  const { data: c, loading } = useFetch<any>(`/candidates/${candidateId}`);
  if (loading || !c) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>Loading profile…</div>;
  }
  const skills: string[] = Array.isArray(c.skills) ? c.skills : [];
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 12, fontWeight: 600, padding: 0 }}>
          <ArrowLeft size={13} /> Back to list
        </button>
        <a href={`/candidates/${candidateId}`} target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>
          Open Full Profile <ExternalLink size={11} />
        </a>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#1e40af', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
          {(c.full_name || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>{c.full_name}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {[c.current_designation, c.current_employer].filter(Boolean).join(' @ ') || '—'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 11, color: '#64748b' }}>
            {c.total_exp_mo > 0 && <span>{fmtExpMonths(c.total_exp_mo)} experience</span>}
            {c.location && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><MapPin size={11} /> {c.location}</span>}
            {c.email && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Mail size={11} /> {c.email}</span>}
            {c.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Phone size={11} /> {c.phone}</span>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #bfdbfe', background: isSelected ? '#eff6ff' : '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#1e40af' }}>
          <input type="checkbox" checked={isSelected} onChange={onToggle} />
          {isSelected ? 'Selected for pipeline' : 'Select for pipeline'}
        </label>
        {c.latest_resume_file_id && (
          <button onClick={() => downloadResume(c.latest_resume_file_id, c.latest_resume_file_name)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#374151' }}>
            <Download size={12} /> Download Resume
          </button>
        )}
      </div>
      {skills.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Skills</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {skills.map((sk: string) => (
              <span key={sk} style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 5, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>{sk}</span>
            ))}
          </div>
        </div>
      )}
      {c.resume_text && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Resume Extract</div>
          <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 8, padding: 10 }}>
            {c.resume_text.slice(0, 3000)}{c.resume_text.length > 3000 ? '…' : ''}
          </div>
        </div>
      )}
    </div>
  );
}

function ShareButton({ reqId, size = 'normal' }: { reqId: string; size?: 'normal' | 'icon' }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // SECURITY FIX (2026-08-10 audit): the token used to be constructed
  // client-side as base64(tenantId:reqId) — unsigned and trivially
  // forgeable by anyone, since both halves are derivable from public
  // data. The backend now mints a real random token and remembers it
  // (client_portal_tokens); this just asks for one instead of building
  // it locally. Same URL shape, so no dashboard-side migration needed.
  async function copyClientLink(e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    setOpen(false); setBusy(true);
    try {
      const res = await apiFetch(`/client-portal/generate-link?requisition_id=${reqId}`, { method: 'POST' });
      const url = window.location.origin + '/client-portal/' + res.token;
      await navigator.clipboard.writeText(url);
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      alert('Could not generate a share link: ' + (err as Error).message);
    } finally { setBusy(false); }
  }
  // 2026-08-28: a second, real option next to the existing client-facing
  // link — a candidate-facing "send me your resume for this role" link
  // (recruiter_job_links), attributed to whoever generated it. Same
  // clean standard form as the personal "My Sourcing Link" (built
  // 2026-08-25 for the job-less version) but scoped to this exact
  // requisition, and creates a real application on submit.
  async function copyCandidateLink(e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault();
    setOpen(false); setBusy(true);
    try {
      const res = await apiFetch(`/personal-links/job/${reqId}`);
      await navigator.clipboard.writeText(res.share_url);
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      alert('Could not generate a candidate application link: ' + (err as Error).message);
    } finally { setBusy(false); }
  }
  const menu = open && (
    <div onClick={e => e.stopPropagation()} style={{
      position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 50,
      background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: '220px', overflow: 'hidden',
    }}>
      <button onClick={copyClientLink} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block' }}>
        Client Portal Link
        <div style={{ fontSize: '11px', fontWeight: 400, color: '#94a3b8', marginTop: '2px' }}>Client views the real-time shortlist</div>
      </button>
      <div style={{ borderTop: '1px solid #f1f5f9' }} />
      <button onClick={copyCandidateLink} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: '#334155', display: 'block' }}>
        Candidate Application Link
        <div style={{ fontSize: '11px', fontWeight: 400, color: '#94a3b8', marginTop: '2px' }}>Candidate submits a resume for this role</div>
      </button>
    </div>
  );
  if (size === 'icon') {
    return (
      <div style={{ position: 'relative' }}>
        <button onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }} disabled={busy} title="Share this job" style={{
          width: '26px', height: '26px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer',
          background: copied ? '#f0fdf4' : '#faf5ff',
          border: copied ? '1px solid #bbf7d0' : '1px solid #ddd6fe',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {copied ? <Copy size={12} style={{ color: '#15803d' }} /> : <Link2 size={12} style={{ color: '#7c3aed' }} />}
        </button>
        {menu}
      </div>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }} disabled={busy} title="Share this job" style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        fontSize: '12px', fontWeight: '600',
        color: copied ? '#15803d' : '#7c3aed',
        background: copied ? '#f0fdf4' : '#faf5ff',
        border: copied ? '1px solid #bbf7d0' : '1px solid #ddd6fe',
        padding: '5px 10px', borderRadius: '6px', cursor: busy ? 'default' : 'pointer',
      }}>
        {copied ? <><Copy size={11}/> Copied!</> : <><Link2 size={11}/> Share</>}
      </button>
      {menu}
    </div>
  );
}

function JobCard({ req, onEdit, onDelete, counts, onCandidatesAdded }: { req: any; onEdit: (r: any) => void; onDelete: (id: string) => void; counts?: any; onCandidatesAdded?: () => void }) {
  const [hover, setHover] = useState(false);
  const pri = PRIORITY_CONFIG[req.priority] || PRIORITY_CONFIG.medium;
  const wm = WORK_MODE_CONFIG[req.work_mode] || WORK_MODE_CONFIG.onsite;
  const [clientNow, setClientNow] = useState<number|undefined>(undefined);
  useEffect(() => { setClientNow(Date.now()); }, []);
  const days = daysRemaining(req.deadline, clientNow);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'white', border: `1px solid ${hover ? '#2563eb' : '#e2e8f0'}`,
        borderRadius: '12px', padding: '18px 20px',
        boxShadow: hover ? '0 4px 12px rgba(37,99,235,0.1)' : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'all 0.15s', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{
          width: '44px', height: '44px', borderRadius: '10px',
          background: '#eff6ff', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          <Briefcase size={20} style={{ color: '#2563eb' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginRight: '2px' }}>{req.title}</h3>
            <EmploymentTypeBadge req={req} />
            <span className={`badge ${STATUS_BADGE[req.status] || 'badge-gray'}`} style={{ fontSize: '10px' }}>
              {req.status}
            </span>
            {req.approval_status === 'pending_approval' && (
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px', background: '#FFFBEB', color: '#CA8A04', border: '1px solid #FDE68A' }}>
                PENDING APPROVAL
              </span>
            )}
          </div>
          {req.client_name && (
            <div style={{ fontSize: '12px', color: '#475569', fontWeight: '500', marginTop: '2px' }}>
              {req.client_name}{req.industry ? ` · ${req.industry}` : ''}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '5px', flexWrap: 'wrap' }}>
            {req.location && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b' }}>
                <MapPin size={11} /> {req.location}
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b' }}>
              <Users size={11} /> {req.positions_count} pos.
            </span>
            {(req.experience_min != null || req.experience_max != null) && (
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                {req.experience_min ?? 0}–{req.experience_max ?? 10} yrs
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Badges row: priority, work_mode, deadline */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        {req.priority && (
          <span style={{
            fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '6px',
            background: pri.bg, color: pri.color, border: `1px solid ${pri.border}`,
          }}>
            {pri.emoji} {req.priority.charAt(0).toUpperCase() + req.priority.slice(1)}
          </span>
        )}
        {req.work_mode && (
          <span style={{
            fontSize: '11px', fontWeight: '500', padding: '2px 8px', borderRadius: '6px',
            background: wm.bg, color: wm.color, border: `1px solid ${wm.color}30`,
          }} title={req.work_modes?.length > 1 ? req.work_modes.map((m: string) => WORK_MODE_LABEL[m] || m).join(', ') : undefined}>
            {WORK_MODE_LABEL[req.work_mode] || req.work_mode}
            {(req.work_modes?.length || 0) > 1 ? ` +${req.work_modes.length - 1}` : ''}
          </span>
        )}
        {req.budget_min && req.budget_max && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            fontSize: '11px', fontWeight: '500', padding: '2px 8px', borderRadius: '6px',
            background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0',
          }}>
            <DollarSign size={10} />
            Rs.{fmtLakh(req.budget_min)} – Rs.{fmtLakh(req.budget_max)}
          </span>
        )}
        {days !== null && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            fontSize: '11px', fontWeight: '500', padding: '2px 8px', borderRadius: '6px',
            background: days < 0 ? '#fef2f2' : days <= 7 ? '#fefce8' : '#f0fdf4',
            color: days < 0 ? '#dc2626' : days <= 7 ? '#ca8a04' : '#15803d',
            border: `1px solid ${days < 0 ? '#fecaca' : days <= 7 ? '#fde68a' : '#bbf7d0'}`,
          }}>
            <Clock size={10} />
            {days < 0 ? `🔴 Overdue (${Math.abs(days)}d)` : days === 0 ? '⚠️ Due today' : days <= 1 ? `⚠️ ${days}d left` : `${days} days left`}
          </span>
        )}
      </div>

      {/* Skills */}
      {(req.skills_required || []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {(req.skills_required || []).slice(0, 5).map((s: string) => (
            <span key={s} style={{
              fontSize: '10px', fontWeight: '500', padding: '2px 8px',
              borderRadius: '5px', background: '#eff6ff', color: '#2563eb',
              border: '1px solid #bfdbfe',
            }}>{s}</span>
          ))}
          {(req.skills_required || []).length > 5 && (
            <span style={{
              fontSize: '10px', padding: '2px 7px', borderRadius: '5px',
              background: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0',
            }}>+{req.skills_required.length - 5} more</span>
          )}
        </div>
      )}

      {/* Description preview */}
      {req.description && (
        <p style={{
          fontSize: '12px', color: '#64748b', lineHeight: '1.5',
          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical' as any,
        }}>
          {req.description}
        </p>
      )}

      {/* Mini Pipeline Bar — inbox matches + pipeline stages */}
      {counts && (counts.inbox_count > 0 || counts.total > 0) && (() => {
        const stages: {key:string;label:string;color:string;count:number}[] = counts.stages || [];
        const active = stages.filter((s:any) => s.count > 0);
        return (
          <div style={{ borderTop:'1px solid #f1f5f9', paddingTop:10, marginTop:4 }}>
            {/* Row 1: inbox vs pipeline counts */}
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap' }}>
              {/* Inbox badge */}
              <a href={`/resume-inbox?req=${req.id}`} style={{ textDecoration:'none' }}>
                <div style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#7c3aed', cursor:'pointer' }} title="Resumes auto-matched to this JD from inbox">
                  <span style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{counts.inbox_count||0}</span>
                  <span style={{ fontSize:9, fontWeight:600, color:'#e9d5ff', textTransform:'uppercase', letterSpacing:'0.05em' }}>📬 Inbox</span>
                </div>
              </a>
              {/* Pipeline badge */}
              <a href={`/pipeline?job=${req.id}`} style={{ textDecoration:'none' }}>
                <div style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#1e40af', cursor:'pointer' }} title="Candidates formally in pipeline stages">
                  <span style={{ fontSize:13, fontWeight:800, color:'#fff' }}>{counts.total}</span>
                  <span style={{ fontSize:9, fontWeight:600, color:'#93c5fd', textTransform:'uppercase', letterSpacing:'0.05em' }}>🔄 Pipeline</span>
                </div>
              </a>
              {/* Stage pills */}
              {active.map(s => (
                <div key={s.key} style={{ display:'flex', alignItems:'center', gap:2, padding:'2px 7px', borderRadius:10, background:s.color+'14', border:`1px solid ${s.color}30` }}>
                  <span style={{ fontSize:11, fontWeight:800, color:s.color }}>{s.count}</span>
                  <span style={{ fontSize:9, fontWeight:500, color:s.color }}>{s.label}</span>
                </div>
              ))}
              {counts.rejected > 0 && (
                <span style={{ fontSize:10, color:'#94a3b8', marginLeft:'auto' }}>{counts.rejected} ✗</span>
              )}
            </div>
            {/* Row 2: Pipeline funnel — prominent segmented bar */}
            {counts.total > 0 && (
              <div style={{ marginTop:6 }}>
                <div style={{ fontSize:9, fontWeight:700, color:'#94a3b8', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:5 }}>
                  Pipeline Funnel — {counts.total} candidate{counts.total!==1?'s':''}
                </div>
                <div style={{ display:'flex', borderRadius:6, overflow:'hidden', height:14, gap:'1px', background:'#e2e8f0' }}>
                  {stages.map(s => s.count > 0 ? (
                    <div key={s.key} title={`${s.label}: ${s.count}`}
                      style={{ background:s.color, flex:s.count, minWidth:6 }} />
                  ) : null)}
                </div>
                <div style={{ display:'flex', gap:'6px 12px', marginTop:6, flexWrap:'wrap' }}>
                  {active.map(s => (
                    <div key={s.key} style={{ display:'flex', alignItems:'center', gap:3 }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:s.color, flexShrink:0 }} />
                      <span style={{ fontSize:10, fontWeight:700, color:s.color }}>{s.count}</span>
                      <span style={{ fontSize:10, color:'#64748b' }}>{s.label}</span>
                    </div>
                  ))}
                  {counts.rejected > 0 && (
                    <div style={{ display:'flex', alignItems:'center', gap:3, marginLeft:'auto' }}>
                      <div style={{ width:8, height:8, borderRadius:2, background:'#ef4444', flexShrink:0 }} />
                      <span style={{ fontSize:10, fontWeight:700, color:'#ef4444' }}>{counts.rejected}</span>
                      <span style={{ fontSize:10, color:'#64748b' }}>Rejected</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* REAL GAP FIX (2026-08-23): AI Match used to be hidden entirely
          the moment a role had ANY real Inbox or Pipeline activity -
          reported live: a recruiter has no way to check the wider
          candidate database for a role that already has a few real
          applicants, which is exactly when that check is most useful.
          Always rendered now, alongside the Mini Pipeline Bar above
          when one exists, not instead of it. */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10, marginTop: 4 }}>
        <AiMatchFinder reqId={req.id} reqTitle={req.title} onAdded={onCandidatesAdded} />
      </div>

            {/* Actions */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        paddingTop: '10px', borderTop: '1px solid #f1f5f9',
      }}>
        <a href={`/pipeline?job=${req.id}`} style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          fontSize: '12px', fontWeight: '600', color: '#2563eb',
          textDecoration: 'none', background: '#eff6ff',
          padding: '5px 12px', borderRadius: '6px',
          border: '1px solid #bfdbfe',
        }}>
          <Eye size={12} /> View Pipeline
        </a>
        {/* REAL GAP FIX (2026-08-24): the list previously had zero direct
            link to the requisition detail page (/requisitions/{id}) —
            the Assigned Recruiter card, approval chain, and submission
            usage only lived there, reachable only via the Kanban board's
            own "Full Page" link, one extra hop and easy to miss. */}
        <a href={`/requisitions/${req.id}`} title="Full requisition details — Assigned Recruiter, approval chain, submission usage" style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          fontSize: '12px', fontWeight: '600', color: '#374151',
          textDecoration: 'none', background: '#f8fafc',
          padding: '5px 12px', borderRadius: '6px',
          border: '1px solid #e2e8f0',
        }}>
          <ExternalLink size={12} /> Details
        </a>
        <ShareButton reqId={req.id} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
          <button onClick={e => { e.stopPropagation(); onEdit(req); }} style={{
            width: '30px', height: '30px', borderRadius: '7px',
            border: '1px solid #e2e8f0', background: '#f8fafc',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <Edit size={13} style={{ color: '#64748b' }} />
          </button>
          <button onClick={e => { e.stopPropagation(); if (confirm('Delete this job?')) onDelete(req.id); }} style={{
            width: '30px', height: '30px', borderRadius: '7px',
            border: '1px solid #fee2e2', background: '#fef2f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <Trash2 size={13} style={{ color: '#ef4444' }} />
          </button>
        </div>
      </div>
    </div>
  );
}

function JobCardCompact({ req, onEdit, onDelete, counts }: { req: any; onEdit: (r: any) => void; onDelete: (id: string) => void; counts?: any }) {
  const [hover, setHover] = useState(false);
  const pri = PRIORITY_CONFIG[req.priority] || PRIORITY_CONFIG.medium;
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: 'white', border: `1px solid ${hover ? '#2563eb' : '#e2e8f0'}`,
        borderRadius: '10px', padding: '12px 14px',
        boxShadow: hover ? '0 4px 12px rgba(37,99,235,0.1)' : '0 1px 3px rgba(0,0,0,0.04)',
        transition: 'all 0.15s', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '128px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
        <h3 style={{ fontSize: '12.5px', fontWeight: '700', color: '#0f172a', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
          {req.title}
        </h3>
        <span title={req.priority} style={{ fontSize: '13px', flexShrink: 0 }}>{pri.emoji}</span>
      </div>
      {req.client_name && (
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {req.client_name}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
        <span className={`badge ${STATUS_BADGE[req.status] || 'badge-gray'}`} style={{ fontSize: '9px' }}>{req.status}</span>
        {req.location && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '10px', color: '#94a3b8' }}>
            <MapPin size={9} /> {req.location}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', color: '#94a3b8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}><Users size={9} /> {req.positions_count}</span>
        {counts && counts.total > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#1e40af', fontWeight: 700 }}>{counts.total} in pipeline</span>
        )}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', gap: '4px', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}>
        <a href={`/pipeline?job=${req.id}`} title="View Pipeline" style={{ flex: 1, textAlign: 'center', fontSize: '10.5px', fontWeight: 600, color: '#2563eb', textDecoration: 'none', background: '#eff6ff', padding: '4px 0', borderRadius: '5px', border: '1px solid #bfdbfe' }}>
          View
        </a>
        {/* Icon-only, matching this view's own deliberately-dense design
            (2026-08-11) — a full "Details" button would overcrowd it. */}
        <a href={`/requisitions/${req.id}`} title="Full requisition details — Assigned Recruiter, approval chain" style={{ width: '24px', height: '24px', borderRadius: '5px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <ExternalLink size={11} style={{ color: '#64748b' }} />
        </a>
        <ShareButton reqId={req.id} size="icon" />
        <button onClick={e => { e.stopPropagation(); onEdit(req); }} style={{ width: '24px', height: '24px', borderRadius: '5px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Edit size={11} style={{ color: '#64748b' }} />
        </button>
        <button onClick={e => { e.stopPropagation(); if (confirm('Delete this job?')) onDelete(req.id); }} style={{ width: '24px', height: '24px', borderRadius: '5px', border: '1px solid #fee2e2', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Trash2 size={11} style={{ color: '#ef4444' }} />
        </button>
      </div>
    </div>
  );
}

function JobListRow({ req, onEdit, onDelete, counts, onCandidatesAdded }: { req: any; onEdit: (r: any) => void; onDelete: (id: string) => void; counts?: any; onCandidatesAdded?: () => void }) {
  const [hover, setHover] = useState(false);
  const pri = PRIORITY_CONFIG[req.priority] || PRIORITY_CONFIG.medium;
  const [clientNow, setClientNow] = useState<number | undefined>(undefined);
  useEffect(() => { setClientNow(Date.now()); }, []);
  const days = daysRemaining(req.deadline, clientNow);
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: 'white', border: `1px solid ${hover ? '#2563eb' : '#e2e8f0'}`,
        borderRadius: '10px', padding: '10px 16px',
        boxShadow: hover ? '0 2px 8px rgba(37,99,235,0.08)' : 'none',
        transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
      }}
    >
      <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Briefcase size={16} style={{ color: '#2563eb' }} />
      </div>
      <div style={{ flex: '2 1 200px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{req.title}</span>
          <span title={req.priority} style={{ fontSize: '12px' }}>{pri.emoji}</span>
        </div>
        {req.client_name && <div style={{ fontSize: '11px', color: '#64748b' }}>{req.client_name}{req.industry ? ` · ${req.industry}` : ''}</div>}
      </div>
      <EmploymentTypeBadge req={req} style={{ flexShrink: 0 }} />
      <span className={`badge ${STATUS_BADGE[req.status] || 'badge-gray'}`} style={{ fontSize: '10px', flexShrink: 0 }}>{req.status}</span>
      {req.location && (
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b', flexShrink: 0 }}>
          <MapPin size={11} /> {req.location}
        </span>
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#64748b', flexShrink: 0 }}>
        <Users size={11} /> {req.positions_count} pos.
      </span>
      <InboxBadge reqId={req.id} count={counts?.inbox_count || 0} iconOnly />
      <AiMatchFinder reqId={req.id} reqTitle={req.title} onAdded={onCandidatesAdded} />
      {counts && counts.total > 0 && (
        <a href={`/pipeline?job=${req.id}`} style={{ textDecoration: 'none', flexShrink: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e40af' }}>{counts.total} in pipeline</span>
        </a>
      )}
      <StageBreakdown counts={counts} />
      {days !== null && (
        <span style={{ fontSize: '11px', fontWeight: 500, color: days < 0 ? '#dc2626' : days <= 7 ? '#ca8a04' : '#15803d', flexShrink: 0 }}>
          {days < 0 ? `Overdue ${Math.abs(days)}d` : days === 0 ? 'Due today' : `${days}d left`}
        </span>
      )}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', flexShrink: 0 }}>
        <a href={`/pipeline?job=${req.id}`} title="View Pipeline" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: '#2563eb', textDecoration: 'none', background: '#eff6ff', padding: '5px 10px', borderRadius: '6px', border: '1px solid #bfdbfe' }}>
          <Eye size={11} /> Pipeline
        </a>
        <a href={`/requisitions/${req.id}`} title="Full requisition details — Assigned Recruiter, approval chain" style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ExternalLink size={12} style={{ color: '#374151' }} />
        </a>
        <ShareButton reqId={req.id} size="icon" />
        <button onClick={e => { e.stopPropagation(); onEdit(req); }} style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Edit size={12} style={{ color: '#64748b' }} />
        </button>
        <button onClick={e => { e.stopPropagation(); if (confirm('Delete this job?')) onDelete(req.id); }} style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid #fee2e2', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Trash2 size={12} style={{ color: '#ef4444' }} />
        </button>
      </div>
    </div>
  );
}

function JobTableView({ reqs, onEdit, onDelete, stageCounts, onCandidatesAdded }: { reqs: any[]; onEdit: (r: any) => void; onDelete: (id: string) => void; stageCounts: any; onCandidatesAdded?: () => void }) {
  const [clientNow, setClientNow] = useState<number | undefined>(undefined);
  useEffect(() => { setClientNow(Date.now()); }, []);
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            {['Title', 'Client', 'Type', 'Priority', 'Location', 'Positions', 'Status', 'Opened', 'Inbox', 'Pipeline', 'Deadline', 'Actions'].map((h, i) => (
              <th key={i} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reqs.map(req => {
            const pri = PRIORITY_CONFIG[req.priority] || PRIORITY_CONFIG.medium;
            const days = daysRemaining(req.deadline, clientNow);
            const counts = stageCounts?.[req.id];
            return (
              <tr key={req.id} data-testid={`req-table-row-${req.id}`} style={{ borderBottom: '1px solid #f1f5f9' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8faff'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}>
                <td style={{ padding: '10px 14px', fontSize: '12.5px', fontWeight: 600, color: '#0f172a', maxWidth: '220px' }}>{req.title}</td>
                <td style={{ padding: '10px 14px', fontSize: '12px', color: '#475569' }}>{req.client_name || '—'}</td>
                <td style={{ padding: '10px 14px' }}><EmploymentTypeBadge req={req} /></td>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: pri.bg, color: pri.color, border: `1px solid ${pri.border}` }}>
                    {pri.emoji} {req.priority}
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b' }}>{req.location || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b' }}>{req.positions_count}</td>
                <td style={{ padding: '10px 14px' }}><span className={`badge ${STATUS_BADGE[req.status] || 'badge-gray'}`} style={{ fontSize: '10px' }}>{req.status}</span></td>
                <td style={{ padding: '10px 14px', fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap' }} title={req.created_at ? new Date(req.created_at).toLocaleString('en-IN') : undefined}>
                  {req.created_at ? new Date(req.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <InboxBadge reqId={req.id} count={counts?.inbox_count || 0} iconOnly />
                  <AiMatchFinder reqId={req.id} reqTitle={req.title} onAdded={onCandidatesAdded} />
                </td>
                <td style={{ padding: '10px 14px', maxWidth: '260px' }}>
                  {counts?.total > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <a href={`/pipeline?job=${req.id}`} style={{ textDecoration: 'none', fontSize: '12px', fontWeight: 700, color: '#1e40af' }}>
                        {counts.total} candidates
                      </a>
                      <StageBreakdown counts={counts} />
                    </div>
                  ) : <span style={{ fontSize: '12px', color: '#94a3b8' }}>—</span>}
                </td>
                <td style={{ padding: '10px 14px', fontSize: '11px', fontWeight: 500, color: days === null ? '#94a3b8' : days < 0 ? '#dc2626' : days <= 7 ? '#ca8a04' : '#15803d' }}>
                  {days === null ? '—' : days < 0 ? `Overdue ${Math.abs(days)}d` : days === 0 ? 'Due today' : `${days}d`}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <a href={`/pipeline?job=${req.id}`} title="View Pipeline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '6px', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                      <Eye size={12} style={{ color: '#2563eb' }} />
                    </a>
                    <a href={`/requisitions/${req.id}`} title="Full requisition details — Assigned Recruiter, approval chain" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', borderRadius: '6px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                      <ExternalLink size={12} style={{ color: '#374151' }} />
                    </a>
                    <ShareButton reqId={req.id} size="icon" />
                    <button onClick={() => onEdit(req)} style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <Edit size={12} style={{ color: '#64748b' }} />
                    </button>
                    <button onClick={() => { if (confirm('Delete this job?')) onDelete(req.id); }} style={{ width: '26px', height: '26px', borderRadius: '6px', border: '1px solid #fee2e2', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <Trash2 size={12} style={{ color: '#ef4444' }} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type ViewMode = 'card' | 'compact' | 'list' | 'table';
const VIEW_MODES: { key: ViewMode; label: string; icon: any }[] = [
  { key: 'card', label: 'Cards', icon: LayoutGrid },
  { key: 'compact', label: 'Small', icon: Grid2x2 },
  { key: 'list', label: 'List', icon: List },
  { key: 'table', label: 'Details', icon: Table2 },
];

function ViewSwitcher({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div style={{ display: 'flex', gap: '2px', background: '#f1f5f9', borderRadius: '8px', padding: '3px' }}>
      {VIEW_MODES.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          data-testid={`req-view-${key}`}
          title={label}
          onClick={() => onChange(key)}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '6px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
            background: mode === key ? 'white' : 'transparent',
            boxShadow: mode === key ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            color: mode === key ? '#1e40af' : '#64748b',
            fontSize: '12px', fontWeight: 600,
          }}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

function RequisitionsPageInner() {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [workModeFilter, setWorkModeFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [deadlineFilter, setDeadlineFilter] = useState('');
  // Same deferred-read pattern as viewMode below — Date.now() must only
  // be evaluated after mount, or the deadline filter's day math would
  // differ between server and client first paint.
  const [clientNow, setClientNow] = useState<number | undefined>(undefined);
  useEffect(() => { setClientNow(Date.now()); }, []);
  const [skillInput, setSkillInput] = useState('');
  const [error, setError] = useState('');
  // View mode preference — read from localStorage in an effect (not
  // during the initial render) so the server's first paint and the
  // client's first paint always match. Reading it synchronously here
  // would differ between server (no localStorage) and client, the same
  // hydration-mismatch bug class documented and fixed repeatedly
  // elsewhere in this app (device-monitoring, recruiter-ops).
  const [viewMode, setViewModeState] = useState<ViewMode>('card');
  useEffect(() => {
    const saved = localStorage.getItem('req_view_mode') as ViewMode | null;
    if (saved && VIEW_MODES.some(v => v.key === saved)) setViewModeState(saved);
  }, []);
  const setViewMode = (m: ViewMode) => {
    setViewModeState(m);
    localStorage.setItem('req_view_mode', m);
  };
  // BUG FIX (2026-08-10 audit): JD Templates had zero integration into
  // requisition creation — 0 of 26 real requisitions ever used template
  // content, and there was no picker on this form at all. Fetches the
  // real jd_text via the detail endpoint (also increments usage_count,
  // matching the same fix applied to the JD Templates page's own preview).
  const { data: jdTemplates } = useFetch<any[]>('/jd-templates');
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  async function applyJdTemplate(templateId: string) {
    if (!templateId) return;
    setApplyingTemplate(true);
    try {
      const full = await apiFetch(`/jd-templates/${templateId}`);
      setForm(f => ({ ...f, description: full.jd_text || f.description }));
    } catch { /* best-effort — leave existing description untouched */ }
    finally { setApplyingTemplate(false); }
  }

  const { data: rawReqs, loading, refetch } = useFetch<any>('/requisitions');
  const { data: stageCounts, refetch: refetchCounts } = useFetch<any>('/pipeline/req-stage-counts');
  // Tenant-configurable Shift Timing presets (2026-08-24) — real named
  // time-range + region presets an admin manages on Ops Settings, not a
  // hardcoded list, matching the same pattern already used for Rejection
  // Reasons / SLA Tiers / Tracking-Sheet Templates elsewhere in this app.
  const { data: shiftTimings, refetch: refetchShiftTimings } = useFetch<any[]>('/shift-timings');
  const reqs: any[] = Array.isArray(rawReqs) ? rawReqs : (rawReqs?.items || []);

  const clientOptions = Array.from(new Set(reqs.map(r => r.client_name).filter(Boolean))).sort();
  const locationOptions = Array.from(new Set(reqs.map(r => r.location).filter(Boolean))).sort();

  const filtered = reqs.filter(r => {
    if (search && !(r.title?.toLowerCase().includes(search.toLowerCase()) || r.client_name?.toLowerCase().includes(search.toLowerCase()))) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (priorityFilter && r.priority !== priorityFilter) return false;
    if (workModeFilter && r.work_mode !== workModeFilter) return false;
    if (typeFilter && r.employment_type !== typeFilter) return false;
    if (clientFilter && r.client_name !== clientFilter) return false;
    if (locationFilter && r.location !== locationFilter) return false;
    if (deadlineFilter) {
      const days = daysRemaining(r.deadline, clientNow);
      if (deadlineFilter === 'overdue' && !(days !== null && days < 0)) return false;
      if (deadlineFilter === 'this_week' && !(days !== null && days >= 0 && days <= 7)) return false;
      if (deadlineFilter === 'this_month' && !(days !== null && days > 7 && days <= 30)) return false;
      if (deadlineFilter === 'no_deadline' && r.deadline) return false;
    }
    return true;
  });

  const extraFiltersActive = !!(typeFilter || clientFilter || locationFilter || deadlineFilter);
  const clearExtraFilters = () => {
    setTypeFilter(''); setClientFilter(''); setLocationFilter(''); setDeadlineFilter('');
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM }); setEditId(null); setError(''); setShowModal(true);
  };

  const openEdit = (req: any) => {
    setForm({
      title: req.title || '',
      client_name: req.client_name || '',
      client_id: req.client_id || '',
      industry: req.industry || '',
      priority: req.priority || 'medium',
      employment_type: req.employment_type || 'contract',
      work_mode: req.work_mode || 'onsite',
      shift_type: req.shift_type || 'day',
      // Real records predating 2026-08-24 have no arrays at all - fall
      // back to the legacy scalar so editing an old requisition doesn't
      // silently wipe its existing single value.
      employment_types: (req.employment_types?.length ? req.employment_types : [req.employment_type || 'contract']),
      work_modes: (req.work_modes?.length ? req.work_modes : [req.work_mode || 'onsite']),
      shift_timing_ids: req.shift_timing_ids || [],
      positions_count: req.positions_count || 1,
      location: req.location || '',
      expected_start_date: req.expected_start_date ? req.expected_start_date.substring(0, 10) : '',
      deadline: req.deadline ? req.deadline.substring(0, 10) : '',
      sla_hours: req.sla_hours ?? '',
      submission_limit_per_recruiter: req.submission_limit_per_recruiter ?? '',
      experience_min: req.experience_min ?? 0,
      experience_max: req.experience_max ?? 10,
      notice_period_max: req.notice_period_max ?? 60,
      education_required: req.education_required || '',
      budget_min: req.budget_min ?? '',
      budget_max: req.budget_max ?? '',
      bill_rate_min: req.bill_rate_min ?? req.bill_rate ?? '',
      bill_rate_max: req.bill_rate_max ?? '',
      skills_required: req.skills_required || [],
      mandatory_skills: req.mandatory_skills || [],
      description: req.description || '',
    });
    setEditId(req.id); setError(''); setShowModal(true);
  };

  // auto-open edit modal when URL has ?edit=<id>
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const eid = searchParams.get('edit');
    if (!eid || !reqs.length) return;
    const target = reqs.find((r) => r.id === eid);
    if (target) openEdit(target);
    router.replace('/requisitions', { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, reqs]);

  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const fNum = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value === '' ? '' : Number(e.target.value) }));

  // Multi-select toggle for employment_types/work_modes/shift_timing_ids —
  // keeps the legacy scalar (employment_type/work_mode) in sync as
  // arrays[0] client-side too, so a save-then-immediate-view (before the
  // list refetches) still shows the right primary badge.
  const toggleArrayField = (arrKey: 'employment_types' | 'work_modes' | 'shift_timing_ids', scalarKey?: 'employment_type' | 'work_mode') =>
    (value: string) => setForm(prev => {
      const cur = prev[arrKey] as string[];
      const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
      // At least one selection required for employment_type/work_mode
      // (the scalar column is NOT NULL) - a click that would empty the
      // array is a no-op instead of silently breaking the derived scalar.
      if (next.length === 0 && scalarKey) return prev;
      return { ...prev, [arrKey]: next, ...(scalarKey ? { [scalarKey]: next[0] } : {}) };
    });

  // REAL BUG FOUND 2026-08-20: pasting or typing a JD's own multi-skill
  // line ("Important skills - Disaster management, Credit management and
  // Claim Management") only ever committed the ENTIRE input as one skill
  // string — and a recruiter trying to add each phrase separately by
  // pressing Enter mid-typing ended up with truncated fragments
  // ("Disaster", "Credit", "Clain") silently saved as real, permanent
  // required skills, directly feeding (and degrading) every AI-match
  // "missing skill" check downstream. Now splits on comma/semicolon/
  // " and "/newline so a real multi-skill paste becomes multiple clean
  // tags in one shot — a single plain skill with no delimiter behaves
  // exactly as before.
  const addSkill = (skill: string) => {
    const parts = skill.split(/,|;|\n|\r| and /i).map(p => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      setForm(prev => {
        const next = [...prev.skills_required];
        for (const p of parts) if (!next.includes(p)) next.push(p);
        return { ...prev, skills_required: next };
      });
    }
    setSkillInput('');
  };
  const removeSkill = (s: string) =>
    setForm(prev => ({
      ...prev,
      skills_required: prev.skills_required.filter(x => x !== s),
      mandatory_skills: prev.mandatory_skills.filter(x => x !== s),
    }));

  // Mandatory Skills (2026-08-24) — a real subset of skills_required, not
  // a parallel list a recruiter has to keep in sync by hand: toggling a
  // skill's own chip flips its membership here directly.
  const toggleMandatory = (s: string) =>
    setForm(prev => ({
      ...prev,
      mandatory_skills: prev.mandatory_skills.includes(s)
        ? prev.mandatory_skills.filter(x => x !== s)
        : [...prev.mandatory_skills, s],
    }));

  const handleSave = async () => {
    if (!form.title.trim()) { setError('Job title is required'); return; }
    setSaving(true); setError('');
    try {
      const payload: any = { ...form };
      // Convert empty strings to null for numeric/date fields
      ['sla_hours', 'budget_min', 'budget_max', 'bill_rate_min', 'bill_rate_max', 'submission_limit_per_recruiter'].forEach(k => {
        if (payload[k] === '' || payload[k] === null) payload[k] = undefined;
        else payload[k] = Number(payload[k]);
      });
      ['deadline', 'expected_start_date', 'education_required', 'industry', 'client_name'].forEach(k => {
        if (payload[k] === '') payload[k] = undefined;
      });
      // client_id is deliberately NOT folded into the generic '' -> undefined
      // pass above: PATCH uses model_dump(exclude_unset=True), so an omitted
      // key leaves the requisition's existing client_id untouched. If a
      // recruiter types a client name that no longer matches the
      // previously-selected client (real gap fixed 2026-08-25 — the field
      // never carried client_id at all before), the stale id must be
      // explicitly cleared, not silently left pointing at the old client.
      payload.client_id = form.client_id || null;

      if (editId) {
        await apiFetch(`/requisitions/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setShowModal(false);
        refetch();
      } else {
        const created = await apiFetch('/requisitions', { method: 'POST', body: JSON.stringify(payload) });
        setShowModal(false);
        // New requisitions are open by default - prompt to distribute it to
        // the 70+ free job portal directory right away instead of leaving
        // that as a separate step the recruiter has to remember to do.
        if (created?.status === 'open' && created?.id) {
          router.push(`/job-sharing?req=${created.id}`);
        } else {
          refetch();
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/requisitions/${id}`, { method: 'DELETE' });
      refetch();
    } catch { }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #e2e8f0', borderRadius: '8px',
    padding: '9px 12px', fontSize: '13px', outline: 'none',
    color: '#1e293b', background: 'white', boxSizing: 'border-box',
  };

  const modalFooter = (
    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
      <button onClick={() => setShowModal(false)} style={{
        padding: '9px 20px', borderRadius: '8px', border: '1px solid #e2e8f0',
        background: 'white', fontSize: '13px', fontWeight: '500', color: '#374151', cursor: 'pointer',
      }}>Cancel</button>
      <button onClick={handleSave} disabled={saving} style={{
        padding: '9px 24px', borderRadius: '8px', border: 'none',
        background: '#1e40af', color: 'white', fontSize: '13px', fontWeight: '600',
        cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
      }}>
        {saving ? 'Saving...' : (editId ? 'Update Requirement' : 'Save Requirement')}
      </button>
    </div>
  );

  return (
    <div className="anim-fade-up">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a' }}>Jobs & Requisitions</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
            {reqs.filter(r => r.status === 'open').length} open · {reqs.length} total
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input placeholder="Search jobs or clients..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, paddingLeft: '30px', width: '220px', borderRadius: '20px', background: '#f8fafc' }} />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: '120px' }}>
            <option value="">All Status</option>
            {['open', 'on_hold', 'filled', 'closed'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={{ ...inputStyle, width: '120px' }}>
            <option value="">All Priority</option>
            <option value="critical">🟣 Critical</option>
            <option value="high">🔴 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">🟢 Low</option>
          </select>
          <select value={workModeFilter} onChange={e => setWorkModeFilter(e.target.value)} style={{ ...inputStyle, width: '120px' }}>
            <option value="">All Modes</option>
            <option value="onsite">Onsite</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...inputStyle, width: '130px' }}>
            <option value="">All Types</option>
            <option value="contract">Contract</option>
            <option value="fulltime">Full-time</option>
            <option value="c2h">Contract to Hire</option>
            <option value="fte">FTE</option>
            <option value="part_time">Part-time</option>
          </select>
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} style={{ ...inputStyle, width: '140px' }}>
            <option value="">All Clients</option>
            {clientOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} style={{ ...inputStyle, width: '140px' }}>
            <option value="">All Locations</option>
            {locationOptions.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={deadlineFilter} onChange={e => setDeadlineFilter(e.target.value)} style={{ ...inputStyle, width: '150px' }}>
            <option value="">Any Deadline</option>
            <option value="overdue">🔴 Overdue</option>
            <option value="this_week">Due in 7 days</option>
            <option value="this_month">Due in 8–30 days</option>
            <option value="no_deadline">No deadline set</option>
          </select>
          {extraFiltersActive && (
            <button onClick={clearExtraFilters} title="Clear Client/Location/Type/Deadline filters" style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '9px 12px', borderRadius: '8px', border: '1px solid #fecaca',
              background: '#fef2f2', color: '#dc2626', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
            }}>
              <X size={12} /> Clear
            </button>
          )}
          <ViewSwitcher mode={viewMode} onChange={setViewMode} />
          <button onClick={openCreate} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '9px 18px', background: '#1e40af', color: 'white',
            border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
          }}>
            <Plus size={14} /> Add Requirement
          </button>
        </div>
      </div>

      {/* Stats pills */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {([['open', 'Open', '#059669', '#d1fae5'], ['on_hold', 'On Hold', '#ca8a04', '#fefce8'], ['filled', 'Filled', '#2563eb', '#eff6ff'], ['closed', 'Closed', '#64748b', '#f1f5f9']] as const).map(([k, l, col, bg]) => {
          const count = reqs.filter(r => r.status === k).length;
          return count > 0 ? (
            <div key={k} onClick={() => setStatusFilter(statusFilter === k ? '' : k)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 14px', borderRadius: '20px', border: `1px solid ${col}30`, background: bg, cursor: 'pointer' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: col }}>{count}</span>
              <span style={{ fontSize: '12px', color: col, fontWeight: '500' }}>{l}</span>
            </div>
          ) : null;
        })}
      </div>

      {/* Requisitions list — 4 selectable view modes (card/compact/list/table) */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: '16px' }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '200px', borderRadius: '12px' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '80px 20px',
          background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0',
        }}>
          <div style={{ fontSize: '56px', marginBottom: '16px' }}>💼</div>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
            {search ? `No jobs matching "${search}"` : 'No requirements yet'}
          </h3>
          <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '24px', maxWidth: '320px', margin: '0 auto 24px' }}>
            Add your first client requirement to start sourcing candidates
          </p>
          <button onClick={openCreate} style={{
            padding: '10px 24px', background: '#1e40af', color: 'white',
            border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
          }}>
            + Add Requirement
          </button>
        </div>
      ) : viewMode === 'table' ? (
        <div data-testid="req-view-content">
          <JobTableView reqs={filtered} onEdit={openEdit} onDelete={handleDelete} stageCounts={stageCounts} onCandidatesAdded={refetchCounts} />
        </div>
      ) : viewMode === 'list' ? (
        <div data-testid="req-view-content" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map((req: any) => (
            <JobListRow key={req.id} req={req} onEdit={openEdit} onDelete={handleDelete} counts={stageCounts?.[req.id]} onCandidatesAdded={refetchCounts} />
          ))}
        </div>
      ) : viewMode === 'compact' ? (
        <div data-testid="req-view-content" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '10px' }}>
          {filtered.map((req: any) => (
            <JobCardCompact key={req.id} req={req} onEdit={openEdit} onDelete={handleDelete} counts={stageCounts?.[req.id]} />
          ))}
        </div>
      ) : (
        <div data-testid="req-view-content" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: '16px' }}>
          {filtered.map((req: any) => (
            <JobCard key={req.id} req={req} onEdit={openEdit} onDelete={handleDelete} counts={stageCounts?.[req.id]} onCandidatesAdded={refetchCounts} />
          ))}
        </div>
      )}

      {/* ── CLIENT REQUIREMENT FORM ─────────────────────────────────────── */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editId ? 'Edit Client Requirement' : 'New Client Requirement'}
        subtitle="Fill in the requirement details for this job opening"
        size="xl"
        footer={modalFooter}
      >
        {error && (
          <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {/* ── Section 1: Job Details ─────────────────────────────────────── */}
        <SectionDivider label="Job Details" />
        <FormRow cols={2}>
          <FormField label="Job Title" required>
            <input style={inputStyle} placeholder="e.g. Senior Python Developer"
              value={form.title} onChange={f('title')} />
          </FormField>
          <FormField label="Client / Company Name">
            <ClientNameCombobox
              value={form.client_name}
              clientId={form.client_id}
              onChangeText={text => setForm(prev => ({ ...prev, client_name: text, client_id: '' }))}
              onSelect={c => setForm(prev => ({ ...prev, client_name: c.name, client_id: c.id }))}
            />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Industry">
            <select style={inputStyle} value={form.industry} onChange={f('industry')}>
              <option value="">Select Industry</option>
              {['IT/Software', 'BFSI', 'Healthcare', 'Manufacturing', 'Retail', 'E-commerce', 'Consulting', 'Other'].map(i => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority">
            <select style={inputStyle} value={form.priority} onChange={f('priority')}>
              <option value="critical">🟣 Critical</option>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </FormField>
        </FormRow>

        {/* ── Section 2: Work & Contract ─────────────────────────────────── */}
        <SectionDivider label="Work & Contract" />
        <FormRow cols={2}>
          <FormField label="Employment Type" required hint="Select one or more">
            <MultiSelectChips
              options={[
                { value: 'contract', label: 'Contract' },
                { value: 'fl_contract', label: 'FL Contract' },
                { value: 'fulltime', label: 'Full-time' },
                { value: 'c2h', label: 'Contract to Hire' },
                { value: 'fte', label: 'FTE' },
                { value: 'part_time', label: 'Part-time' },
              ]}
              selected={form.employment_types}
              onToggle={toggleArrayField('employment_types', 'employment_type')}
            />
          </FormField>
          <FormField label="Work Mode" hint="Select one or more">
            <MultiSelectChips
              options={[
                { value: 'remote', label: 'Remote' },
                { value: 'onsite', label: 'Onsite' },
                { value: 'hybrid', label: 'Hybrid' },
              ]}
              selected={form.work_modes}
              onToggle={toggleArrayField('work_modes', 'work_mode')}
              colorFor={(v) => ({
                color: WORK_MODE_CONFIG[v]?.color || '#1e40af',
                bg: WORK_MODE_CONFIG[v]?.bg || '#eff6ff',
                border: WORK_MODE_CONFIG[v]?.color || '#bfdbfe',
              })}
            />
          </FormField>
        </FormRow>
        <FormRow cols={4}>
          <FormField label="Shift Type">
            <select style={inputStyle} value={form.shift_type} onChange={f('shift_type')}>
              <option value="day">Day</option>
              <option value="night">Night</option>
              <option value="rotational">Rotational</option>
              <option value="flexible">Flexible</option>
            </select>
          </FormField>
          <FormField label="No. of Positions">
            <input type="number" style={inputStyle} min={1} max={500}
              value={form.positions_count} onChange={fNum('positions_count')} />
          </FormField>
        </FormRow>
        <FormRow cols={1}>
          <FormField label="Shift Timing (by region)" hint="Select one or more presets, or add a one-off timing below">
            {(shiftTimings?.length ?? 0) > 0 && (
              <MultiSelectChips
                options={(shiftTimings || []).filter((s: any) => s.is_active).map((s: any) => ({
                  value: s.id,
                  label: `${s.label} (${s.start_time?.slice(0, 5)}–${s.end_time?.slice(0, 5)} ${s.timezone_label || ''}, ${s.region})`,
                }))}
                selected={form.shift_timing_ids}
                onToggle={toggleArrayField('shift_timing_ids')}
              />
            )}
            <div style={{ marginTop: (shiftTimings?.length ?? 0) > 0 ? '8px' : 0 }}>
              <ShiftTimingCustomAdd onCreated={(newTiming) => {
                refetchShiftTimings();
                setForm(prev => ({ ...prev, shift_timing_ids: [...prev.shift_timing_ids, newTiming.id] }));
              }} />
            </div>
          </FormField>
        </FormRow>

        {/* ── Section 3: Location & Timeline ─────────────────────────────── */}
        <SectionDivider label="Location & Timeline" />
        <FormRow cols={4}>
          <FormField label="Location">
            <input style={inputStyle} placeholder="e.g. Bengaluru, Remote"
              value={form.location} onChange={f('location')} />
          </FormField>
          <FormField label="Expected Start Date">
            <input type="date" style={inputStyle}
              value={form.expected_start_date} onChange={f('expected_start_date')} />
          </FormField>
          <FormField label="Deadline / Close By">
            <input type="date" style={inputStyle}
              value={form.deadline} onChange={f('deadline')} />
          </FormField>
          <FormField label="SLA Hours" hint="Fill-by SLA in hours">
            <input type="number" style={inputStyle} min={1} placeholder="e.g. 72"
              value={form.sla_hours} onChange={fNum('sla_hours')} />
          </FormField>
          <FormField label="Submission Limit / Recruiter" hint="Max candidates one recruiter can submit for this role — blank = unlimited">
            <input type="number" style={inputStyle} min={1} placeholder="Unlimited"
              value={form.submission_limit_per_recruiter} onChange={fNum('submission_limit_per_recruiter')} />
          </FormField>
        </FormRow>

        {/* ── Section 4: Experience & Education ──────────────────────────── */}
        <SectionDivider label="Experience & Education" />
        <FormRow cols={4}>
          <FormField label="Min Experience (yrs)">
            <input type="number" style={inputStyle} min={0} max={40}
              value={form.experience_min} onChange={fNum('experience_min')} />
          </FormField>
          <FormField label="Max Experience (yrs)">
            <input type="number" style={inputStyle} min={0} max={40}
              value={form.experience_max} onChange={fNum('experience_max')} />
          </FormField>
          <FormField label="Notice Period Max (days)">
            <input type="number" style={inputStyle} min={0} placeholder="60"
              value={form.notice_period_max} onChange={fNum('notice_period_max')} />
          </FormField>
          <FormField label="Education Required">
            <select style={inputStyle} value={form.education_required} onChange={f('education_required')}>
              <option value="">Any</option>
              {['Graduate', 'Post Graduate', 'B.Tech/B.E.', 'M.Tech/M.E.', 'MBA', 'CA/CMA', 'PhD'].map(e => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </FormField>
        </FormRow>

        {/* ── Section 5: Budget / Billing ─────────────────────────────────── */}
        <SectionDivider label="Budget / Billing" />
        <FormRow cols={2}>
          <FormField label="Min Budget (Annual Rs.)">
            <input type="number" style={inputStyle} min={0} placeholder="e.g. 800000"
              value={form.budget_min} onChange={fNum('budget_min')} />
          </FormField>
          <FormField label="Max Budget (Annual Rs.)">
            <input type="number" style={inputStyle} min={0} placeholder="e.g. 1500000"
              value={form.budget_max} onChange={fNum('budget_max')} />
          </FormField>
        </FormRow>
        <FormRow cols={2}>
          <FormField label="Min Billing Rate (Rs./month) — contract roles">
            <input type="number" style={inputStyle} min={0} placeholder="e.g. 100000"
              value={form.bill_rate_min} onChange={fNum('bill_rate_min')} />
          </FormField>
          <FormField label="Max Billing Rate (Rs./month) — contract roles">
            <input type="number" style={inputStyle} min={0} placeholder="e.g. 140000"
              value={form.bill_rate_max} onChange={fNum('bill_rate_max')} />
          </FormField>
        </FormRow>

        {/* ── Section 6: Required Skills ──────────────────────────────────── */}
        <SectionDivider label="Required Skills" />
        <FormField label="" hint="Click the star on a skill to mark it Mandatory (vs. nice-to-have)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', minHeight: '28px' }}>
            {form.skills_required.map(s => {
              const isMandatory = form.mandatory_skills.includes(s);
              return (
                <span key={s} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '3px 8px 3px 10px',
                  background: isMandatory ? '#fef2f2' : '#eff6ff',
                  color: isMandatory ? '#b91c1c' : '#2563eb',
                  borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                  border: `1px solid ${isMandatory ? '#fecaca' : '#bfdbfe'}`,
                }}>
                  {s}
                  <span onClick={() => toggleMandatory(s)} title={isMandatory ? 'Mandatory — click to make optional' : 'Mark as Mandatory'}
                    style={{ cursor: 'pointer', display: 'inline-flex', color: isMandatory ? '#dc2626' : '#93c5fd' }}>
                    <Star size={12} fill={isMandatory ? '#dc2626' : 'none'} />
                  </span>
                  <span onClick={() => removeSkill(s)} style={{ cursor: 'pointer', color: isMandatory ? '#fca5a5' : '#93c5fd', fontWeight: '700', fontSize: '14px', lineHeight: 1 }}>×</span>
                </span>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input style={{ ...inputStyle, flex: 1 }}
              placeholder="Type skill and press Enter or pick below..."
              value={skillInput}
              onChange={e => setSkillInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addSkill(skillInput))} />
            <button onClick={() => addSkill(skillInput)} style={{
              padding: '9px 16px', background: '#eff6ff', color: '#2563eb',
              border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
            }}>Add</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px', maxHeight: '120px', overflowY: 'auto' }}>
            {SKILLS_LIST.map(s => (
              <button key={s} onClick={() => addSkill(s)}
                disabled={form.skills_required.includes(s)}
                style={{
                  padding: '3px 9px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
                  background: form.skills_required.includes(s) ? '#dcfce7' : '#f8fafc',
                  color: form.skills_required.includes(s) ? '#16a34a' : '#64748b',
                  border: `1px solid ${form.skills_required.includes(s) ? '#bbf7d0' : '#e2e8f0'}`,
                  fontWeight: '500',
                }}>{s}</button>
            ))}
          </div>
        </FormField>

        {/* ── Section 7: Job Description / Notes ─────────────────────────── */}
        <SectionDivider label="Job Description / Notes" />
        {jdTemplates && jdTemplates.length > 0 && (
          <FormField label="">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <select
                data-testid="jd-template-picker"
                disabled={applyingTemplate}
                defaultValue=""
                onChange={e => { if (e.target.value) applyJdTemplate(e.target.value); e.target.value = ''; }}
                style={{ ...inputStyle, maxWidth: '260px' }}
              >
                <option value="">{applyingTemplate ? 'Loading...' : 'Start from JD Template...'}</option>
                {jdTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>Fills the description below — you can still edit it.</span>
            </div>
          </FormField>
        )}
        <FormField label="">
          <textarea
            style={{ ...inputStyle, minHeight: '120px', resize: 'vertical', lineHeight: '1.6' }}
            placeholder="Describe responsibilities, required experience, company culture, interview process..."
            value={form.description}
            onChange={f('description')}
          />
        </FormField>
      </Modal>
    </div>
  );
}

export default function RequisitionsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>}>
      <RequisitionsPageInner />
    </Suspense>
  );
}
