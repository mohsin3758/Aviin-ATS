'use client';
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import WhatsAppChatButton from '@/components/WhatsAppChatButton';
import { ResumeGeneratorModal } from '@/components/ResumeGeneratorModal';
import { authHeaders, API, getTokenPayload } from '@/lib/auth';
import {
  Search, Plus, X, RotateCcw, ChevronDown, MapPin, Users, Briefcase,
  Clock, CheckCircle, AlertTriangle, Send, Star, MessageSquare,
  Activity, Download, ExternalLink, ArrowRight, Inbox, LayoutGrid,
  KanbanSquare, Mail, Phone, IndianRupee, FileText, RefreshCw, Calendar,
  FileSignature, Upload, ShieldCheck, Copy, CheckSquare, Printer,
  Columns3, GripVertical, Trash2, Building2, Eye, EyeOff,
} from 'lucide-react';

// ── Stage config (fallback — overridden by /settings/pipeline-stages once loaded) ──
const DEFAULT_STAGES = [
  { key: 'sourced',        label: 'Sourced',        color: '#6366F1', light: '#EEF2FF' },
  { key: 'contacted',      label: 'Contacted',      color: '#06B6D4', light: '#ECFEFF' },
  { key: 'interested',     label: 'Interested',     color: '#3B82F6', light: '#EFF6FF' },
  { key: 'nda',            label: 'NDA',            color: '#F59E0B', light: '#FFFBEB' },
  { key: 'screened',       label: 'Screened',       color: '#0891B2', light: '#ECFEFF' },
  { key: 'submitted',      label: 'Submitted',      color: '#64748B', light: '#F8FAFC' },
  { key: 'l1_interview',   label: 'L1 Interview',   color: '#7C3AED', light: '#F5F3FF' },
  { key: 'l2_interview',   label: 'L2 Interview',   color: '#9333EA', light: '#FAF5FF' },
  { key: 'offer',          label: 'Offer',          color: '#CA8A04', light: '#FFFBEB' },
  { key: 'offer_accepted', label: 'Offer Accepted', color: '#059669', light: '#F0FDF4' },
  { key: 'placed',         label: 'Placed ✓',       color: '#16A34A', light: '#F0FDF4' },
  { key: 'hold',           label: 'On Hold',        color: '#94A3B8', light: '#F8FAFC' },
  { key: 'rejected',       label: 'Rejected',       color: '#DC2626', light: '#FEF2F2' },
];


// ── Helpers ───────────────────────────────────────────────────────────────────
function gx(mo: number) {
  if (!mo) return '0mo';
  const y = Math.floor(mo / 12), m = mo % 12;
  return y > 0 ? `${y}y${m > 0 ? ` ${m}m` : ''}` : `${m}m`;
}
function ago(ts: string) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}
function daysSince(ts: string) {
  if (!ts) return 0;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}
// Staleness thresholds match this app's existing SLA_DAYS convention
// (pipeline_p2.py) loosely — not tied to it exactly since that's per-stage
// and configurable server-side, this is just a simple visual "stuck too
// long" cue on the card itself, not a policy.
function stalenessBadge(days: number): { label: string; color: string; bg: string } | null {
  if (days >= 14) return { label: `${days}d stuck`, color: '#DC2626', bg: '#FEF2F2' };
  if (days >= 7) return { label: `${days}d stuck`, color: '#B45309', bg: '#FFFBEB' };
  return null;
}
function scoreColor(s: number | null) {
  if (!s) return '#94A3B8';
  if (s >= 80) return '#16A34A';
  if (s >= 65) return '#0891B2';
  if (s >= 50) return '#F59E0B';
  return '#DC2626';
}
function scoreBg(s: number | null) {
  if (!s) return '#F8FAFC';
  if (s >= 80) return '#F0FDF4';
  if (s >= 65) return '#ECFEFF';
  if (s >= 50) return '#FFFBEB';
  return '#FEF2F2';
}
function initials(name: string) {
  return name?.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
}
const AVATAR_COLORS = ['#6366F1','#0891B2','#7C3AED','#059669','#CA8A04','#DC2626','#9333EA','#F59E0B','#3B82F6','#EC4899'];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name?.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// Resume download must go through the auth-gated /resume-intake download
// endpoint — c.resume_path is a raw storage path with no static file route
// serving it (confirmed 404 in production), unlike resume_file_id which
// resolves through the same working endpoint candidates/[id] and Resume
// Inbox already use.
async function downloadResume(fileId: string, fileName: string) {
  try {
    const resp = await fetch(`${API}/resume-intake/${fileId}/download`, { headers: authHeaders() });
    if (!resp.ok) { alert('Download failed: ' + resp.status); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName || 'resume';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { alert('Download error: ' + String(e)); }
}

function useToast() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const show = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, show };
}

// ── Inner page (uses useSearchParams — must be wrapped in Suspense) ────────────
function PipelineInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialJobId = searchParams?.get('job') || '';

  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const [jobSearch, setJobSearch] = useState('');
  const [jobPickerOpen, setJobPickerOpen] = useState(!initialJobId);
  const [board, setBoard] = useState<Record<string, any[]>>({});
  const [selected, setSelected] = useState<any | null>(null);
  const [drawerTab, setDrawerTab] = useState('profile');
  const [candSearch, setCandSearch] = useState('');
  const [activeStage, setActiveStage] = useState('all');
  const [addCandidateOpen, setAddCandidateOpen] = useState(false);
  const [booleanOpen, setBooleanOpen] = useState(false);
  const { toast, show: showToast } = useToast();
  const dragRef = useRef<{ id: string; fromStage: string } | null>(null);
  // Rejecting now requires a reason_code — shared across both ways a card
  // can be rejected (drag-drop into the Rejected column, or the drawer's
  // Reject button), so there's one modal, not two divergent flows.
  const [pendingReject, setPendingReject] = useState<{ appId: string; fromStage: string } | null>(null);

  // "Remove from Pipeline" (2026-08-20) — a genuinely separate, more
  // final action than Reject: the candidate disappears from every stage
  // on this board entirely (not even shown under Rejected), for cases
  // like "added by mistake" or "duplicate entry." Backend soft-deletes
  // and enforces the same HITL admin/manager bar as Reject — this local
  // `canManage` just avoids showing a button that would only 403.
  // getTokenPayload() reads localStorage, unavailable during SSR —
  // deferred to an effect so the server/client first-render match (same
  // pattern used elsewhere in this codebase, e.g. offers/recruiter-ops).
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    setCanManage(['admin', 'super_admin', 'manager'].includes(getTokenPayload()?.role || ''));
  }, []);
  const [pendingRemove, setPendingRemove] = useState<{ appId: string; fromStage: string; candidateName: string } | null>(null);

  // Real per-stage "Manual" email send mode (2026-08-22) — see
  // getSendMode/moveStage below. Holds the real, resolved preview
  // (fetched from /applications/{id}/stage-preview) while the user
  // reviews/edits it; the actual stage PATCH is deferred until they
  // confirm, matching the setting's own description ("edit the message
  // before sending").
  const { data: emailSettings } = useFetch<any>('/settings/email');
  const [pendingEmailReview, setPendingEmailReview] = useState<{ appId: string; fromStage: string; toStage: string; extra: Record<string, any>; candidateName: string; subject: string; message: string } | null>(null);
  // Real "Client Submission" stage wiring (2026-08-25) — a real custom
  // stage this tenant created. Manual send mode for this ONE stage opens
  // the actual Submit-to-Client engine (resume + real tracking sheet to
  // the client's SPOC) instead of the generic subject/body review modal,
  // which has no way to show tracking-sheet columns or a SPOC picker.
  // Automatic mode skips this entirely — the backend's own stage-change
  // hook fires the real send in the background once the move commits.
  const [pendingClientSubmission, setPendingClientSubmission] = useState<{ appId: string; fromStage: string; toStage: string; extra: Record<string, any>; candidateName: string } | null>(null);

  // Bulk multi-select — checkboxes on cards, a floating action bar for
  // bulk stage-move (via the existing /pipeline/bulk-action endpoint,
  // previously only reachable outside the board itself) and comparison.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoving, setBulkMoving] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const { data: stageConfig } = useFetch<any[]>('/settings/pipeline-stages');
  const ALL_STAGES = useMemo(() => {
    if (!stageConfig || stageConfig.length === 0) return DEFAULT_STAGES;
    return [...stageConfig]
      .sort((a: any, b: any) => a.display_order - b.display_order)
      .map((s: any) => ({ key: s.stage_key, label: s.label, color: s.color, light: `${s.color}1A` }));
  }, [stageConfig]);
  const STAGES = useMemo(() => {
    if (!stageConfig || stageConfig.length === 0) return DEFAULT_STAGES;
    const visibleKeys = new Set(stageConfig.filter((s: any) => s.is_visible).map((s: any) => s.stage_key));
    return ALL_STAGES.filter((s: any) => visibleKeys.has(s.key));
  }, [stageConfig, ALL_STAGES]);
  // Tenant-configurable (Settings > Pipeline Stages > star icon) — used by
  // Add Candidate when no specific stage tab is active. Falls back to
  // 'sourced' only if the backend hasn't returned a default yet/at all.
  const defaultAddStageKey = (stageConfig || []).find((s: any) => s.is_default_add)?.stage_key || 'sourced';

  const { data: reqs } = useFetch<any[]>('/requisitions?limit=200&status=open');
  const { data: rawBoard, refetch: refreshBoard } = useFetch<Record<string, any[]>>(
    selectedJobId ? `/requisitions/${selectedJobId}/pipeline` : null
  );
  const { data: stats, refetch: refreshStats } = useFetch<any>(
    selectedJobId ? `/requisitions/${selectedJobId}/pipeline-stats` : null
  );
  const selectedJob = (reqs || []).find((r: any) => r.id === selectedJobId);

  useEffect(() => {
    if (rawBoard) setBoard(rawBoard);
  }, [rawBoard]);

  const reqList = (reqs || []).filter((r: any) =>
    !jobSearch || r.title?.toLowerCase().includes(jobSearch.toLowerCase()) ||
    r.client_name?.toLowerCase().includes(jobSearch.toLowerCase())
  );

  function selectJob(id: string) {
    setSelectedJobId(id);
    setJobPickerOpen(false);
    setBoard({});
    setSelected(null);
    setActiveStage('all');
    router.replace(`/pipeline?job=${id}`, { scroll: false });
  }

  // Real UX fix (2026-08-22): "Email Send Mode" used to be one global
  // Automatic/Manual toggle applying to every stage — now genuinely
  // per-stage (backend/routers/email_settings.py's stage_templates[stage
  // ].send_mode). A stage set to Manual shows a real review-and-edit
  // popup (StageEmailReviewModal below) before anything sends; Automatic
  // stages keep sending instantly, unchanged from before. Falls back to
  // 'manual' (the safer default) if a stage has no explicit setting yet.
  const getSendMode = useCallback((stage: string) => {
    return emailSettings?.stage_templates?.[stage]?.send_mode || 'manual';
  }, [emailSettings]);

  // The actual API call + optimistic board update + success/error
  // handling — shared by the immediate-auto path and the manual-review
  // modal's own confirm handlers, so both commit a move identically.
  const commitStageMove = useCallback(async (appId: string, fromStage: string, toStage: string, extra: Record<string, any>, sendEmail: boolean, customMessage?: string) => {
    setBoard(prev => {
      const app = prev[fromStage]?.find((a: any) => a.id === appId);
      if (!app) return prev;
      return {
        ...prev,
        [fromStage]: (prev[fromStage] || []).filter((a: any) => a.id !== appId),
        [toStage]: [{ ...app, stage: toStage }, ...(prev[toStage] || [])],
      };
    });
    if (selected?.id === appId) setSelected((s: any) => s ? { ...s, stage: toStage } : s);
    try {
      const body: Record<string, any> = { stage: toStage, send_email: sendEmail, ...extra };
      if (customMessage !== undefined) body.custom_message = customMessage;
      await apiFetch(`/applications/${appId}/stage`, { method: 'PATCH', body: JSON.stringify(body) });
      showToast(`Moved to ${ALL_STAGES.find((s: any) => s.key === toStage)?.label || toStage}`);
      refreshStats();
    } catch (e: any) {
      showToast(String(e?.message || 'Move failed'), false);
      if (rawBoard) setBoard(rawBoard);
    }
  }, [rawBoard, selected, showToast, refreshStats, ALL_STAGES]);

  const moveStage = useCallback(async (appId: string, fromStage: string, toStage: string, extra: Record<string, any> = {}) => {
    if (fromStage === toStage) return;
    // Real "Client Submission" wiring (2026-08-25) — this stage's email
    // is a client-facing send, not a candidate notification, so it never
    // goes through the generic per-stage email path at all (sendEmail is
    // always false here; nothing in SUBJS/MSGS matches this custom stage
    // anyway). Manual mode opens the real Submit-to-Client review panel
    // BEFORE the move commits; Automatic mode just commits the move and
    // lets the backend's own stage-change hook fire the real send.
    if (toStage === 'client_submission') {
      if (getSendMode(toStage) === 'manual') {
        const candidateName = board[fromStage]?.find((a: any) => a.id === appId)?.candidate_name
          || board[fromStage]?.find((a: any) => a.id === appId)?.full_name || 'this candidate';
        setPendingClientSubmission({ appId, fromStage, toStage, extra, candidateName });
        return;
      }
      await commitStageMove(appId, fromStage, toStage, extra, false);
      return;
    }
    if (getSendMode(toStage) === 'manual') {
      let preview: any = { subject: '', message: '' };
      try { preview = await apiFetch(`/applications/${appId}/stage-preview?stage=${toStage}`); } catch { /* best-effort */ }
      const candidateName = board[fromStage]?.find((a: any) => a.id === appId)?.candidate_name
        || board[fromStage]?.find((a: any) => a.id === appId)?.full_name || 'this candidate';
      setPendingEmailReview({ appId, fromStage, toStage, extra, candidateName, subject: preview.subject || '', message: preview.message || '' });
      return;
    }
    await commitStageMove(appId, fromStage, toStage, extra, true);
  }, [getSendMode, board, commitStageMove]);

  // Full removal from the pipeline (distinct from Reject, which just
  // moves a card to the Rejected column — see pendingRemove above).
  const removeApplication = useCallback(async (appId: string, fromStage: string, reason?: string) => {
    setBoard(prev => ({ ...prev, [fromStage]: (prev[fromStage] || []).filter((a: any) => a.id !== appId) }));
    if (selected?.id === appId) setSelected(null);
    try {
      await apiFetch(`/applications/${appId}`, { method: 'DELETE', body: JSON.stringify({ reason: reason || undefined }) });
      showToast('Removed from pipeline');
      refreshStats(); refreshBoard();
    } catch (e: any) {
      showToast(String(e?.message || 'Remove failed'), false);
      if (rawBoard) setBoard(rawBoard);
    }
  }, [rawBoard, selected, showToast, refreshStats, refreshBoard]);

  const filteredApps = useCallback((apps: any[]) => {
    if (!candSearch.trim()) return apps;
    const q = candSearch.toLowerCase();
    return apps.filter(a =>
      a.candidate_name?.toLowerCase().includes(q) ||
      a.current_designation?.toLowerCase().includes(q) ||
      a.skills?.some((s: string) => s.toLowerCase().includes(q))
    );
  }, [candSearch]);

  // Within-column drag reorder — full-column resnapshot (matches the
  // backend's own approach) rather than midpoint-rank math, since a
  // column realistically never has more than a few dozen visible cards.
  const reorderColumn = useCallback(async (stageKey: string, targetAppId: string) => {
    if (!dragRef.current) return;
    const { id: draggedId, fromStage } = dragRef.current;
    dragRef.current = null;
    if (fromStage !== stageKey || draggedId === targetAppId) return;
    const stageApps = board[stageKey] || [];
    const ids = stageApps.map((a: any) => a.id);
    if (!ids.includes(draggedId) || !ids.includes(targetAppId)) return;
    const reordered = ids.filter((id: string) => id !== draggedId);
    reordered.splice(reordered.indexOf(targetAppId), 0, draggedId);
    const byId = new Map(stageApps.map((a: any) => [a.id, a]));
    setBoard(prev => ({ ...prev, [stageKey]: reordered.map((id: string) => byId.get(id)) }));
    try {
      await apiFetch('/pipeline/reorder', {
        method: 'POST',
        body: JSON.stringify({ requisition_id: selectedJobId, stage: stageKey, ordered_application_ids: reordered }),
      });
    } catch (e: any) {
      showToast('Reorder failed', false);
      if (rawBoard) setBoard(rawBoard);
    }
  }, [board, selectedJobId, rawBoard, showToast]);

  // Reuses the same real endpoint the requisition-detail page's manual
  // Reject button already goes through for a single candidate — bulk
  // reject still needs a reason_code (HITL-adjacent structured feedback,
  // not a free-for-all), so it's deliberately NOT part of this bulk-move
  // action; only move_stage is exposed from the board's multi-select.
  async function bulkMoveSelected(targetStage: string) {
    if (selectedIds.size === 0) return;
    setBulkMoving(true);
    try {
      const res: any = await apiFetch('/pipeline/bulk-action', {
        method: 'POST',
        body: JSON.stringify({ application_ids: Array.from(selectedIds), action: 'move_stage', target_stage: targetStage }),
      });
      const label = ALL_STAGES.find((s: any) => s.key === targetStage)?.label || targetStage;
      showToast(`${res.success} moved to ${label}${res.failed ? `, ${res.failed} failed` : ''}`, res.failed === 0);
      setSelectedIds(new Set());
      setSelectMode(false);
      refreshBoard();
      refreshStats();
    } catch (e: any) {
      showToast(String(e?.message || 'Bulk move failed'), false);
    } finally {
      setBulkMoving(false);
    }
  }

  function exportBoardCsv() {
    const cols = ['Candidate', 'Stage', 'Score', 'Designation', 'Employer', 'Location', 'Experience', 'Notice Period (days)', 'Expected CTC', 'Email', 'Phone', 'Days in Stage'];
    const rows: string[][] = [];
    for (const stage of STAGES) {
      for (const app of (board[stage.key] || [])) {
        rows.push([
          app.candidate_name || '', stage.label, app.fit_score != null ? String(Math.round(app.fit_score)) : '',
          app.current_designation || '', app.current_employer || '', app.location || '',
          app.total_exp_mo ? gx(app.total_exp_mo) : '', app.notice_period_days != null ? String(app.notice_period_days) : '',
          app.expected_ctc != null ? String(app.expected_ctc) : '', app.email || '', app.phone || '',
          String(daysSince(app.updated_at)),
        ]);
      }
    }
    const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = [cols, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${selectedJob?.title || 'pipeline'}-board.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function printBoard() {
    const win = window.open('', '_blank');
    if (!win) { showToast('Pop-up blocked — allow pop-ups to print', false); return; }
    const rowsHtml = STAGES.map(stage => {
      const apps = board[stage.key] || [];
      if (apps.length === 0) return '';
      const body = apps.map((a: any) => `<tr>
        <td>${a.candidate_name || ''}</td>
        <td>${[a.current_designation, a.current_employer].filter(Boolean).join(' @ ')}</td>
        <td>${a.fit_score != null ? Math.round(a.fit_score) + '%' : '—'}</td>
        <td>${a.total_exp_mo ? gx(a.total_exp_mo) : '—'}</td>
        <td>${a.location || '—'}</td>
        <td>${daysSince(a.updated_at)}d</td>
      </tr>`).join('');
      return `<h3 style="color:${stage.color}">${stage.label} (${apps.length})</h3>
        <table><thead><tr><th>Candidate</th><th>Role @ Employer</th><th>Score</th><th>Experience</th><th>Location</th><th>Days in Stage</th></tr></thead>
        <tbody>${body}</tbody></table>`;
    }).join('');
    win.document.write(`<!doctype html><html><head><title>${selectedJob?.title || 'Pipeline'} — Pipeline Board</title>
      <style>
        body{font-family:Arial,sans-serif;color:#1e293b;padding:24px;}
        h1{font-size:20px;margin-bottom:2px;} .meta{color:#64748b;font-size:12px;margin-bottom:20px;}
        h3{font-size:14px;margin:20px 0 6px;}
        table{width:100%;border-collapse:collapse;margin-bottom:8px;}
        th,td{border:1px solid #e2e8f0;padding:6px 8px;font-size:11px;text-align:left;}
        th{background:#f8fafc;}
        @media print { body{padding:0;} }
      </style></head><body>
      <h1>${selectedJob?.title || 'Pipeline Board'}</h1>
      <div class="meta">${selectedJob?.client_name || ''} · Exported ${new Date().toLocaleDateString()} · ${totalCandidates} candidates</div>
      ${rowsHtml}
      </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  const totalCandidates = Object.values(board).reduce((sum, arr) => sum + (arr?.length || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#F1F5F9' }}>

      {/* ── TOP HEADER ──────────────────────────────────────────────────── */}
      <div style={{ background: '#0F172A', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <div style={{ padding: '14px 20px 0' }}>

          {/* Row 1: Job picker + KPIs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>

            {/* Job selector button */}
            <div style={{ position: 'relative' }}>
              <button onClick={() => setJobPickerOpen(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, color: '#fff', cursor: 'pointer', minWidth: 280, maxWidth: 400 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: selectedJob ? `linear-gradient(135deg,${avatarColor(selectedJob.client_name||selectedJob.title)},#1E40AF)` : 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
                  {selectedJob ? (selectedJob.client_name?.[0] || selectedJob.title?.[0] || 'J') : <Briefcase size={15} color="rgba(255,255,255,0.65)" />}
                </div>
                <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedJob?.title || 'Select a Job Role'}
                  </div>
                  {selectedJob && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>{selectedJob.client_name || ''} · {totalCandidates} candidates</div>}
                </div>
                <ChevronDown size={14} color="rgba(255,255,255,0.7)" style={{ transform: jobPickerOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
              </button>

              {/* Job picker dropdown */}
              {jobPickerOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, width: 420, background: '#fff', borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,0.25)', border: '1px solid #E2E8F0', zIndex: 999, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #F1F5F9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 10px' }}>
                      <Search size={13} color="#94A3B8" />
                      <input value={jobSearch} onChange={e => setJobSearch(e.target.value)} placeholder="Search jobs or clients…"
                        style={{ border: 'none', background: 'none', outline: 'none', fontSize: 12, color: '#374151', flex: 1 }} autoFocus />
                      {jobSearch && <button onClick={() => setJobSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0 }}><X size={11} /></button>}
                    </div>
                  </div>
                  <div style={{ maxHeight: 340, overflowY: 'auto' }} data-testid="requisition-list">
                    {reqList.length === 0 && (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>No open jobs found</div>
                    )}
                    {reqList.map((r: any) => (
                      <button key={r.id} onClick={() => selectJob(r.id)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', cursor: 'pointer', background: r.id === selectedJobId ? '#EFF6FF' : '#fff', borderBottom: '1px solid #F8FAFC', textAlign: 'left' }}
                        onMouseEnter={e => { if (r.id !== selectedJobId) (e.currentTarget as HTMLElement).style.background = '#F8FAFC'; }}
                        onMouseLeave={e => { if (r.id !== selectedJobId) (e.currentTarget as HTMLElement).style.background = '#fff'; }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: `linear-gradient(135deg,${avatarColor(r.client_name||r.title)},${avatarColor(r.client_name||r.title)}99)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                          {(r.client_name || r.title)?.[0]?.toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: r.id === selectedJobId ? '#1D4ED8' : '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                          <div style={{ fontSize: 11, color: '#64748B' }}>{r.client_name || ''}{r.location ? ` · ${r.location}` : ''}</div>
                        </div>
                        {r.id === selectedJobId && <CheckCircle size={14} color="#2563EB" />}
                      </button>
                    ))}
                  </div>
                  <div style={{ padding: '8px 12px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: '#94A3B8' }}>{reqList.length} open job{reqList.length !== 1 ? 's' : ''}</span>
                    <a href="/requisitions" style={{ fontSize: 11, fontWeight: 700, color: '#2563EB', textDecoration: 'none' }}>View All Jobs →</a>
                  </div>
                </div>
              )}
            </div>

            {/* Job meta (visible when job selected) */}
            {selectedJob && (
              <div style={{ flex: 1, display: 'flex', gap: '10px 20px', flexWrap: 'wrap', overflow: 'hidden' }}>
                {selectedJob.location && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} />{selectedJob.location}</span>}
                {selectedJob.positions_count && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 4 }}><Users size={11} />{selectedJob.positions_count} pos.</span>}
                {selectedJob.experience_min != null && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} />{selectedJob.experience_min}–{selectedJob.experience_max ?? '?'} yrs</span>}
                <a href={`/requisitions/${selectedJobId}`} style={{ fontSize: 11, fontWeight: 700, color: '#93C5FD', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3 }}>
                  Full Page <ExternalLink size={10} />
                </a>
              </div>
            )}

            {/* KPI cards */}
            {selectedJob && (
              <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                {[
                  { label: 'Placed', val: stats?.placed ?? 0, num: '#86EFAC', bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.3)' },
                  { label: 'In Pipeline', val: stats?.in_pipeline ?? 0, num: '#C4B5FD', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.3)' },
                  { label: 'Dropped', val: stats?.dropped ?? 0, num: '#94A3B8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.25)' },
                ].map(k => (
                  <div key={k.label} style={{ textAlign: 'center', padding: '8px 16px', borderRadius: 10, background: k.bg, border: `1px solid ${k.border}`, minWidth: 68 }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: k.num, lineHeight: 1 }}>{k.val}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{k.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stage tab bar */}
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>
            <button onClick={() => setActiveStage('all')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: 'none', border: 'none', color: activeStage === 'all' ? '#fff' : 'rgba(255,255,255,0.6)', borderBottom: activeStage === 'all' ? '2px solid #60A5FA' : '2px solid transparent', whiteSpace: 'nowrap' }}>
              <LayoutGrid size={13} /> All Stages
              {totalCandidates > 0 && <span style={{ marginLeft: 2, background: '#2563EB', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999 }}>{totalCandidates}</span>}
            </button>
            {STAGES.filter(s => (board[s.key]?.length || 0) > 0).map(s => (
              <button key={s.key} onClick={() => setActiveStage(s.key)}
                style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', color: activeStage === s.key ? '#fff' : 'rgba(255,255,255,0.6)', borderBottom: activeStage === s.key ? '2px solid #60A5FA' : '2px solid transparent', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
                {s.label}
                <span style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999 }}>{board[s.key]?.length}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── NO JOB SELECTED ─────────────────────────────────────────────── */}
      {!selectedJobId && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 24 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <KanbanSquare size={30} color="#60A5FA" />
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#1E293B', marginBottom: 8 }}>Select a Job to View Pipeline</div>
            <div style={{ fontSize: 14, color: '#64748B', marginBottom: 24 }}>Click the job selector above or choose from the list below</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, maxWidth: 900, width: '100%', padding: '0 24px' }}>
            {(reqs || []).slice(0, 9).map((r: any) => (
              <button key={r.id} onClick={() => selectJob(r.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#93C5FD'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(37,99,235,0.12)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg,${avatarColor(r.client_name||r.title)},${avatarColor(r.client_name||r.title)}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
                  {(r.client_name || r.title)?.[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>{r.client_name || ''}{r.location ? ` · ${r.location}` : ''}</div>
                </div>
                <ArrowRight size={14} color="#CBD5E1" />
              </button>
            ))}
          </div>
          {(reqs || []).length > 9 && (
            <a href="/requisitions" style={{ fontSize: 13, fontWeight: 700, color: '#2563EB', textDecoration: 'none' }}>View all {reqs?.length} jobs →</a>
          )}
        </div>
      )}

      {/* ── TOOLBAR ─────────────────────────────────────────────────────── */}
      {selectedJobId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fff', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '5px 10px', flex: 1, maxWidth: 280 }}>
            <Search size={13} color="#94A3B8" />
            <input value={candSearch} onChange={e => setCandSearch(e.target.value)} placeholder="Search candidates, skills…"
              style={{ border: 'none', background: 'none', outline: 'none', fontSize: 12, color: '#374151', width: '100%' }} />
            {candSearch && <button onClick={() => setCandSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0 }}><X size={12} /></button>}
          </div>
          <button onClick={refreshBoard} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}>
            <RotateCcw size={13} /> Refresh
          </button>
          <button onClick={() => { setSelectMode(v => !v); setSelectedIds(new Set()); }}
            title="Select multiple candidates for a bulk stage move or comparison"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: `1px solid ${selectMode ? '#93C5FD' : '#E2E8F0'}`, borderRadius: 8, background: selectMode ? '#EFF6FF' : '#fff', fontSize: 12, fontWeight: 600, color: selectMode ? '#1D4ED8' : '#64748B', cursor: 'pointer' }}>
            <CheckSquare size={13} /> {selectMode ? 'Cancel Select' : 'Select'}
          </button>
          <button onClick={exportBoardCsv} title="Export this board's candidates to CSV"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}>
            <Download size={13} /> CSV
          </button>
          <button onClick={printBoard} title="Print or save as PDF — opens a clean printable view"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}>
            <Printer size={13} /> Print / PDF
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => setBooleanOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', border: '1px solid #FDE68A', borderRadius: 8, background: '#FFFBEB', fontSize: 12, fontWeight: 700, color: '#B45309', cursor: 'pointer' }}>
              <Search size={13} /> Boolean Search
            </button>
            <a href={`/resume-inbox?req=${selectedJobId}`}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', border: '1px solid #DDD6FE', borderRadius: 8, background: '#FAF5FF', fontSize: 12, fontWeight: 700, color: '#7C3AED', textDecoration: 'none', cursor: 'pointer' }}>
              <Inbox size={13} /> Inbox Matches
            </a>
            <button onClick={() => setAddCandidateOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', border: 'none', borderRadius: 8, background: '#2563EB', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
              <Plus size={13} /> Add Candidate
            </button>
          </div>
        </div>
      )}

      {/* ── BULK SELECTION ACTION BAR ──────────────────────────────────── */}
      {selectMode && selectedIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#1E293B', flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{selectedIds.size} selected</span>
          <select disabled={bulkMoving} defaultValue="" onChange={e => { if (e.target.value) bulkMoveSelected(e.target.value); e.target.value = ''; }}
            style={{ fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#fff' }}>
            <option value="" disabled>{bulkMoving ? 'Moving…' : 'Move to stage…'}</option>
            {STAGES.map((s: any) => <option key={s.key} value={s.key} style={{ color: '#1E293B' }}>{s.label}</option>)}
          </select>
          {selectedIds.size >= 2 && (
            <button onClick={() => setCompareOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6, border: 'none', background: '#7C3AED', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              <Columns3 size={13} /> Compare
            </button>
          )}
          <button onClick={() => setSelectedIds(new Set())} style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}>
            Clear selection
          </button>
        </div>
      )}

      {/* ── KANBAN BOARD ────────────────────────────────────────────────── */}
      {selectedJobId && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 18px', display: 'flex', gap: 14 }}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}>
            {(activeStage === 'all' ? STAGES : STAGES.filter(s => s.key === activeStage)).map(stage => {
              const apps = filteredApps(board[stage.key] || []);
              const total = (board[stage.key] || []).length;
              return (
                <div key={stage.key} style={{ flexShrink: 0, width: 246, display: 'flex', flexDirection: 'column', background: '#F8FAFC', border: '1px solid #E5E9F0', borderTop: `3px solid ${stage.color}`, borderRadius: 12, overflow: 'hidden' }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault(); if (!dragRef.current) return;
                    const { id, fromStage } = dragRef.current; dragRef.current = null;
                    if (stage.key === 'rejected') { setPendingReject({ appId: id, fromStage }); return; }
                    moveStage(id, fromStage, stage.key);
                  }}>

                  {/* Column header */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#fff', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', flex: 1 }}>{stage.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: stage.light, color: stage.color }}>{total}</span>
                  </div>

                  {/* Column body */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 90, maxHeight: 'calc(100vh - 262px)' }}>
                    {apps.map(app => (
                      <KanbanCard key={app.id} app={app} stageColor={stage.color}
                        onClick={() => { if (selectMode) { toggleSelected(app.id); return; } setSelected(app); setDrawerTab('profile'); }}
                        onNotesClick={() => { setSelected(app); setDrawerTab('notes'); }}
                        onQuickReject={() => setPendingReject({ appId: app.id, fromStage: stage.key })}
                        selectMode={selectMode} isSelected={selectedIds.has(app.id)} onToggleSelect={() => toggleSelected(app.id)}
                        onDragStart={(e: React.DragEvent) => { dragRef.current = { id: app.id, fromStage: stage.key }; e.dataTransfer.effectAllowed = 'move'; }}
                        onCardDragOver={(e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }}
                        onCardDrop={(e: React.DragEvent) => {
                          e.preventDefault(); e.stopPropagation();
                          if (!dragRef.current) return;
                          const { id, fromStage } = dragRef.current;
                          if (fromStage === stage.key) { reorderColumn(stage.key, app.id); return; }
                          dragRef.current = null;
                          if (stage.key === 'rejected') { setPendingReject({ appId: id, fromStage }); return; }
                          moveStage(id, fromStage, stage.key);
                        }} />
                    ))}
                    {apps.length === 0 && (
                      <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 11, padding: '24px 8px', fontStyle: 'italic' }}>Drop candidates here</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── DRAWER ──────────────────────────────────────────────────────── */}
      {selected && (
        <CandidateDrawer app={selected} onClose={() => setSelected(null)}
          onMoveStage={(toStage: string, extra?: Record<string, any>) => moveStage(selected.id, selected.stage, toStage, extra)}
          onSubmittedToKae={(bumped: boolean) => {
            if (bumped) {
              setBoard(prev => {
                const fromStage = selected.stage;
                const a = prev[fromStage]?.find((x: any) => x.id === selected.id);
                if (!a || fromStage === 'submitted') return prev;
                return {
                  ...prev,
                  [fromStage]: (prev[fromStage] || []).filter((x: any) => x.id !== selected.id),
                  submitted: [{ ...a, stage: 'submitted' }, ...(prev['submitted'] || [])],
                };
              });
              setSelected((s: any) => s ? { ...s, stage: 'submitted' } : s);
            }
            refreshStats();
          }}
          onRequestReject={() => setPendingReject({ appId: selected.id, fromStage: selected.stage })}
          onRequestRemove={canManage ? () => setPendingRemove({ appId: selected.id, fromStage: selected.stage, candidateName: selected.candidate_name }) : undefined}
          drawerTab={drawerTab} setDrawerTab={setDrawerTab} showToast={showToast} stages={STAGES} allStages={ALL_STAGES}
          requisitionId={selectedJobId} clientName={selectedJob?.client_name} />
      )}

      {/* ── ADD CANDIDATE MODAL ─────────────────────────────────────────── */}
      {addCandidateOpen && selectedJobId && (
        <AddCandidateModal jobId={selectedJobId} board={board} stages={STAGES}
          defaultStage={STAGES.some((s: any) => s.key === activeStage) ? activeStage : defaultAddStageKey}
          onClose={() => setAddCandidateOpen(false)}
          onAdded={(stageLabel: string) => { setAddCandidateOpen(false); refreshBoard(); refreshStats(); showToast(`Candidate(s) added to ${stageLabel}`); }} />
      )}

      {/* ── BOOLEAN SEARCH MODAL ─────────────────────────────────────────── */}
      {booleanOpen && selectedJobId && (
        <BooleanSearchModal jobId={selectedJobId} onClose={() => setBooleanOpen(false)} />
      )}

      {/* ── REJECT REASON MODAL ─────────────────────────────────────────── */}
      {pendingReject && (
        <RejectReasonModal
          onCancel={() => setPendingReject(null)}
          onConfirm={(reason_code: string, reason: string) => {
            moveStage(pendingReject.appId, pendingReject.fromStage, 'rejected', { reason_code, reason: reason || undefined });
            setPendingReject(null);
          }} />
      )}

      {/* ── REMOVE FROM PIPELINE MODAL ─────────────────────────────────── */}
      {pendingRemove && (
        <RemoveFromPipelineModal
          candidateName={pendingRemove.candidateName}
          onCancel={() => setPendingRemove(null)}
          onConfirm={(reason: string) => {
            removeApplication(pendingRemove.appId, pendingRemove.fromStage, reason || undefined);
            setPendingRemove(null);
          }} />
      )}

      {/* ── STAGE EMAIL REVIEW MODAL (Manual send mode) ──────────────────── */}
      {pendingEmailReview && (
        <StageEmailReviewModal
          review={pendingEmailReview}
          stageLabel={ALL_STAGES.find((s: any) => s.key === pendingEmailReview.toStage)?.label || pendingEmailReview.toStage}
          onCancel={() => setPendingEmailReview(null)}
          onConfirm={async (customMessage: string | undefined) => {
            const r = pendingEmailReview;
            setPendingEmailReview(null);
            await commitStageMove(r.appId, r.fromStage, r.toStage, r.extra, customMessage !== undefined, customMessage);
          }} />
      )}

      {/* ── CLIENT SUBMISSION MOVE MODAL (Manual send mode) ──────────────── */}
      {pendingClientSubmission && (
        <ClientSubmissionMoveModal
          appId={pendingClientSubmission.appId}
          candidateName={pendingClientSubmission.candidateName}
          stageLabel={ALL_STAGES.find((s: any) => s.key === 'client_submission')?.label || 'Client Submission'}
          showToast={showToast}
          onCancel={() => setPendingClientSubmission(null)}
          onSent={async (bumped?: boolean) => {
            const r = pendingClientSubmission;
            setPendingClientSubmission(null);
            // Real automation (2026-08-26): a real send already moved the
            // real backend stage straight to "Submitted" (and already sent
            // the candidate's own "Submitted" notification server-side) —
            // reflect that real end state on the board instead of re-
            // patching back to "Submit to Client", which would silently
            // undo it. send_email stays false either way: a genuine send
            // already fired its own candidate notification server-side;
            // "Move Without Sending" (bumped=false) never sent anything at
            // all, so no notification is appropriate there either.
            const landingStage = bumped ? 'submitted' : r.toStage;
            await commitStageMove(r.appId, r.fromStage, landingStage, r.extra, false);
          }} />
      )}

      {/* ── CANDIDATE COMPARISON MODAL ─────────────────────────────────── */}
      {compareOpen && (
        <CompareModal
          apps={Object.values(board).flat().filter((a: any) => selectedIds.has(a.id))}
          requiredSkills={selectedJob?.skills_required || []}
          stages={ALL_STAGES}
          onClose={() => setCompareOpen(false)} />
      )}

      {/* ── TOAST ───────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? '#1E293B' : '#DC2626', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertTriangle size={14} />} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Kanban Card ────────────────────────────────────────────────────────────────
function KanbanCard({ app, stageColor, onClick, onNotesClick, onQuickReject, onDragStart, selectMode, isSelected, onToggleSelect, onCardDragOver, onCardDrop }: any) {
  const score = app.fit_score ?? app.jd_match_score ?? app.ai_match_score ?? app.readiness_index;
  const skills: string[] = app.skills || [];
  const notesCount = Array.isArray(app.app_notes) ? app.app_notes.length : 0;
  const [hovered, setHovered] = useState(false);
  const stale = stalenessBadge(daysSince(app.updated_at));
  return (
    <div draggable onDragStart={onDragStart} onClick={onClick} onDragOver={onCardDragOver} onDrop={onCardDrop}
      style={{ background: '#fff', border: `1px solid ${isSelected ? '#93C5FD' : '#EDF0F4'}`, borderRadius: 10, padding: '11px 12px 9px', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', position: 'relative', userSelect: 'none', boxShadow: isSelected ? '0 0 0 2px #93C5FD' : 'none' }}
      onMouseEnter={e => { setHovered(true); (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 20px rgba(15,23,42,0.09)'; }}
      onMouseLeave={e => { setHovered(false); (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = isSelected ? '0 0 0 2px #93C5FD' : 'none'; }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: stageColor, borderRadius: '10px 0 0 10px' }} />
      {selectMode && (
        <input type="checkbox" checked={!!isSelected} onClick={e => { e.stopPropagation(); onToggleSelect?.(); }} onChange={() => {}}
          style={{ position: 'absolute', top: 8, right: 8, width: 15, height: 15, cursor: 'pointer', zIndex: 1 }} />
      )}
      {!selectMode && <GripVertical size={11} style={{ position: 'absolute', top: 10, right: 6, color: '#E2E8F0' }} />}
      {/* Quick Reject (2026-08-20): the only way to reject used to be
          opening the drawer or dragging onto the Rejected column — neither
          obvious from the board itself. A hover-reveal icon here makes it
          discoverable without hiding the full Reject-reason flow (still
          opens the same reason modal, just one click closer). */}
      {!selectMode && hovered && onQuickReject && app.stage !== 'rejected' && (
        <button title="Reject candidate" data-testid={`quick-reject-${app.id}`} onClick={e => { e.stopPropagation(); onQuickReject(); }}
          style={{ position: 'absolute', top: 8, right: 20, width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 4, background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', padding: 0 }}>
          <X size={10} strokeWidth={3} />
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: `linear-gradient(135deg,${avatarColor(app.candidate_name)},${avatarColor(app.candidate_name)}aa)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
          {initials(app.candidate_name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.candidate_name}</div>
          <div style={{ fontSize: 10, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[app.current_designation, app.current_employer].filter(Boolean).join(' @ ')}
          </div>
        </div>
        {!selectMode && score != null && (
          <div style={{ width: 34, height: 34, borderRadius: '50%', border: `2px solid ${scoreColor(score)}`, background: scoreBg(score), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900, color: scoreColor(score), flexShrink: 0 }}>
            {Math.round(score)}%
          </div>
        )}
      </div>
      {skills.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 7 }}>
          {skills.slice(0, 3).map((sk: string) => (
            <span key={sk} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>{sk}</span>
          ))}
          {skills.length > 3 && <span style={{ fontSize: 9, color: '#94A3B8', padding: '2px 4px' }}>+{skills.length - 3}</span>}
        </div>
      )}
      {stale && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: stale.bg, color: stale.color, marginBottom: 7 }}>
          <AlertTriangle size={9} /> {stale.label}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {app.total_exp_mo > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#94A3B8', background: '#F8FAFC', padding: '2px 6px', borderRadius: 4 }}>
            <Clock size={9} /> {gx(app.total_exp_mo)}
          </span>
        )}
        <span style={{ fontSize: 9, color: '#CBD5E1' }}>{ago(app.updated_at)}</span>
        {app.scorecard_count > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE' }}>
            <Star size={8} fill="#2563EB" /> {app.scorecard_count}
          </span>
        )}
        {notesCount > 0 ? (
          <span onClick={e => { e.stopPropagation(); onNotesClick?.(); }}
            title={`${notesCount} note${notesCount !== 1 ? 's' : ''} — click to view`}
            style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: '#FFFBEB', color: '#CA8A04', border: '1px solid #FDE68A', cursor: 'pointer' }}>
            <MessageSquare size={8} /> {notesCount}
          </span>
        ) : (
          <span onClick={e => { e.stopPropagation(); onNotesClick?.(); }}
            title="Add a note"
            style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: '#F8FAFC', color: '#94A3B8', border: '1px solid #E2E8F0', cursor: 'pointer', marginLeft: 'auto', opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}>
            <MessageSquare size={8} /> Note
          </span>
        )}
      </div>
    </div>
  );
}

// ── Candidate Drawer ──────────────────────────────────────────────────────────
function CandidateDrawer({ app, onClose, onMoveStage, onSubmittedToKae, onRequestReject, onRequestRemove, drawerTab, setDrawerTab, showToast, stages, allStages, requisitionId, clientName }: any) {
  const stageCfg = allStages.find((s: any) => s.key === app.stage);
  const score = app.fit_score ?? app.jd_match_score ?? app.ai_match_score ?? app.readiness_index;
  const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
  // Real gate (2026-08-25): the backend now requires admin/manager/kae/kam
  // to actually send a client submission (was reachable by any
  // authenticated user before) — hide the tab for anyone who'd only hit a
  // 403, rather than let them click into a dead end. SSR-safe deferred
  // localStorage read, same pattern used throughout this codebase.
  const [canSubmitToClient, setCanSubmitToClient] = useState(false);
  useEffect(() => {
    setCanSubmitToClient(['admin', 'super_admin', 'manager', 'kae', 'kam'].includes(getTokenPayload()?.role || ''));
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ width: 500, maxWidth: '96vw', height: '100%', background: '#fff', boxShadow: '-6px 0 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 18px 0', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: `linear-gradient(135deg,${avatarColor(app.candidate_name)},${avatarColor(app.candidate_name)}99)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff' }}>
                {initials(app.candidate_name)}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1E293B' }}>{app.candidate_name}</div>
                <div style={{ fontSize: 11, color: '#64748B' }}>{[app.current_designation, app.current_employer].filter(Boolean).join(' @ ')}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {score != null && (
                <div style={{ textAlign: 'center', padding: '4px 10px', borderRadius: 8, background: scoreBg(score), border: `1px solid ${scoreColor(score)}30` }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(score), lineHeight: 1 }}>{Math.round(score)}%</div>
                  <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 600 }}>AI MATCH</div>
                </div>
              )}
              <button onClick={onClose} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94A3B8' }}><X size={15} /></button>
            </div>
          </div>

          {/* Stage: current + move buttons */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Current Stage: <span style={{ color: stageCfg?.color }}>{stageCfg?.label}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {stages.filter((s: any) => s.key !== 'rejected' && s.key !== 'hold').map((s: any) => (
                <button key={s.key} data-testid={`stage-pill-${s.key}`} onClick={() => onMoveStage(s.key)}
                  style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${s.color}40`, background: app.stage === s.key ? s.color : `${s.color}15`, color: app.stage === s.key ? '#fff' : s.color, transition: 'all 0.15s' }}>
                  {s.label}
                </button>
              ))}
              <button onClick={() => onMoveStage('hold')} style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid #CBD5E140', background: app.stage === 'hold' ? '#94A3B8' : '#F8FAFC', color: app.stage === 'hold' ? '#fff' : '#94A3B8' }}>Hold</button>
              <button onClick={() => onRequestReject()} style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid #FCA5A440', background: app.stage === 'rejected' ? '#DC2626' : '#FEF2F2', color: app.stage === 'rejected' ? '#fff' : '#DC2626' }}>Reject</button>
              {/* Remove from Pipeline (2026-08-20) — deliberately separate
                  from Reject: fully removes the candidate from this job's
                  board, not just moves them to Rejected. admin/manager only
                  (onRequestRemove is undefined for everyone else). */}
              {onRequestRemove && (
                <button title="Fully remove this candidate from the pipeline (different from Reject)" data-testid="drawer-remove-from-pipeline" onClick={() => onRequestRemove()}
                  style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid #E2E8F0', background: '#F8FAFC', color: '#64748B' }}>
                  <Trash2 size={10} /> Remove
                </button>
              )}
            </div>
          </div>

          {/* Drawer tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
            {[
              { key: 'profile', icon: <Briefcase size={12} />, label: 'Profile' },
              { key: 'nda', icon: <FileSignature size={12} />, label: 'NDA' },
              { key: 'kae', icon: <Send size={12} />, label: 'Submit to KAE' },
              ...(canSubmitToClient ? [{ key: 'client', icon: <Building2 size={12} />, label: 'Submit to Client' }] : []),
              { key: 'resume-gen', icon: <FileText size={12} />, label: 'Generate Resume' },
              { key: 'call-letter', icon: <Calendar size={12} />, label: 'Call Letter' },
              { key: 'notes', icon: <MessageSquare size={12} />, label: 'Notes', count: Array.isArray(app.app_notes) ? app.app_notes.length : 0 },
              { key: 'scorecards', icon: <Star size={12} />, label: 'Scorecards' },
              { key: 'activity', icon: <Activity size={12} />, label: 'Activity' },
            ].map(t => (
              <button key={t.key} data-tab={t.key} onClick={() => setDrawerTab(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', borderBottom: `2px solid ${drawerTab === t.key ? '#2563EB' : 'transparent'}`, color: drawerTab === t.key ? '#2563EB' : '#64748B' }}>
                {t.icon}{t.label}
                {!!t.count && (
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '0px 5px', borderRadius: 999, background: drawerTab === t.key ? '#2563EB' : '#E2E8F0', color: drawerTab === t.key ? '#fff' : '#64748B' }}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {drawerTab === 'profile' && <ProfileTab app={app} apiUrl={API_URL} />}
          {drawerTab === 'nda' && <NdaTab appId={app.id} showToast={showToast} />}
          {drawerTab === 'kae' && <SubmitKaeTab appId={app.id} showToast={showToast} onSubmitted={onSubmittedToKae} />}
          {drawerTab === 'client' && canSubmitToClient && <SubmitClientTab appId={app.id} showToast={showToast} onSubmitted={onSubmittedToKae} />}
          {drawerTab === 'resume-gen' && <ResumeGenTab candidateId={app.candidate_id} candidateName={app.candidate_name} requisitionId={requisitionId} clientName={clientName} />}
          {drawerTab === 'call-letter' && <CallLetterTab appId={app.id} showToast={showToast} />}
          {drawerTab === 'notes' && <NotesTab appId={app.id} showToast={showToast} />}
          {drawerTab === 'scorecards' && <ScorecardsTab appId={app.id} showToast={showToast} />}
          {drawerTab === 'activity' && <ActivityTab candidateId={app.candidate_id} />}
        </div>
      </div>
    </div>
  );
}

// Captured via the structured rejection-reason taxonomy (S16 Tier-1) but
// previously never shown anywhere again after the reject action itself —
// GET /applications/{id}/rejection had no caller in the whole frontend.
function RejectionReasonCard({ appId }: { appId: string }) {
  const { data } = useFetch<any>(`/applications/${appId}/rejection`);
  if (!data) return null;
  return (
    <InfoCard title="Rejection Reason">
      <div style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', marginBottom: data.notes ? 6 : 0 }}>{data.reason_label}</div>
      {data.notes && <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{data.notes}</div>}
      {data.rejected_at && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 6 }}>{new Date(data.rejected_at).toLocaleDateString()}</div>}
    </InfoCard>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab({ app, apiUrl }: any) {
  const skills: string[] = app.skills || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {app.stage === 'rejected' && <RejectionReasonCard appId={app.id} />}
      <InfoCard title="Contact Info">
        {app.email && <InfoRow icon={<Mail size={12} />} label={app.email} />}
        {app.phone && <InfoRow icon={<Phone size={12} />} label={app.phone} />}
        {app.phone && (
          <div style={{ marginTop: 4 }}>
            <WhatsAppChatButton phone={app.phone} candidateId={app.candidate_id} candidateName={app.candidate_name} />
          </div>
        )}
        {app.location && <InfoRow icon={<MapPin size={12} />} label={app.location} />}
        {app.total_exp_mo > 0 && <InfoRow icon={<Briefcase size={12} />} label={`${gx(app.total_exp_mo)} experience`} />}
        {app.notice_period_days != null && <InfoRow icon={<Clock size={12} />} label={`${app.notice_period_days}d notice period`} />}
        {app.expected_ctc && <InfoRow icon={<IndianRupee size={12} />} label={`Expected ${(app.expected_ctc / 100000).toFixed(1)}L`} />}
      </InfoCard>
      {skills.length > 0 && (
        <InfoCard title={`Skills (${skills.length})`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {skills.map((sk: string) => <span key={sk} style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>{sk}</span>)}
          </div>
        </InfoCard>
      )}
      {[{ label: 'JD Match Score', val: app.jd_match_score }, { label: 'AI Match Score', val: app.ai_match_score }, { label: 'Fit Score', val: app.fit_score }, { label: 'Readiness Score', val: app.readiness_index }].filter(r => r.val != null).length > 0 && (
        <InfoCard title="AI Assessment">
          {[{ label: 'JD Match Score', val: app.jd_match_score }, { label: 'AI Match Score', val: app.ai_match_score }, { label: 'Fit Score', val: app.fit_score }, { label: 'Readiness Score', val: app.readiness_index }].filter(r => r.val != null).map(r => (
            <div key={r.label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: '#64748B' }}>{r.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(r.val) }}>{Math.round(r.val!)}%</span>
              </div>
              <div style={{ height: 5, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(r.val!, 100)}%`, background: scoreColor(r.val), borderRadius: 3 }} />
              </div>
            </div>
          ))}
        </InfoCard>
      )}
      {app.resume_file_id && (
        <button onClick={() => downloadResume(app.resume_file_id, app.resume_file_name)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, cursor: 'pointer', color: '#15803D', fontSize: 12, fontWeight: 700 }}>
          <Download size={13} /> Download Resume
        </button>
      )}
      <a href={`/candidates/${app.candidate_id}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', background: '#1E40AF', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 12, fontWeight: 700, width: 'fit-content' }}>
        <ExternalLink size={12} /> Full ATS Profile
      </a>
    </div>
  );
}

// ── NDA Tab ───────────────────────────────────────────────────────────────────
const NDA_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  draft:            { label: 'Draft — not sent',       color: '#64748B', bg: '#F8FAFC' },
  sent:             { label: 'Awaiting signature',     color: '#CA8A04', bg: '#FFFBEB' },
  e_signed:         { label: 'E-Signed',                color: '#16A34A', bg: '#F0FDF4' },
  manually_signed:  { label: 'Manually Signed',          color: '#16A34A', bg: '#F0FDF4' },
  expired:          { label: 'Expired',                  color: '#DC2626', bg: '#FEF2F2' },
};

async function downloadNdaFile(appId: string, kind: 'pdf' | 'docx') {
  const res = await fetch(`${API}/applications/${appId}/nda/${kind}`, { headers: authHeaders() });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `nda_${appId.slice(0, 8)}.${kind}`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function NdaTab({ appId, showToast }: any) {
  const { data: nda, refetch } = useFetch<any>(`/applications/${appId}/nda`);
  const { data: templates } = useFetch<any>('/settings/document-templates');
  const [draftText, setDraftText] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [signMethod, setSignMethod] = useState<'type_name' | 'otp'>('type_name');
  const [attachment, setAttachment] = useState<'generated' | 'nda_template' | 'contract_template'>('generated');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [signUrl, setSignUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (nda && !initialized) { setDraftText(nda.draft_text || ''); setInitialized(true); }
  }, [nda, initialized]);

  if (!nda) return <div style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', padding: 20 }}>Loading…</div>;

  const cfg = NDA_STATUS_CFG[nda.status] || NDA_STATUS_CFG.draft;
  const editable = nda.status === 'draft';

  async function saveDraft() {
    setSaving(true);
    try {
      await apiFetch(`/applications/${appId}/nda`, { method: 'PUT', body: JSON.stringify({ draft_text: draftText }) });
      showToast('NDA draft saved'); refetch();
    } catch (e: any) { showToast(String(e?.message || 'Save failed'), false); } finally { setSaving(false); }
  }

  async function sendForSignature() {
    setSending(true);
    try {
      const res = await apiFetch(`/applications/${appId}/nda/send`, { method: 'POST', body: JSON.stringify({ sign_method: signMethod, attachment }) });
      setSignUrl(res.sign_url || '');
      showToast(`NDA emailed to ${res.recipient}`); refetch();
    } catch (e: any) { showToast(String(e?.message || 'Send failed'), false); } finally { setSending(false); }
  }

  async function uploadManualSign(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API}/applications/${appId}/nda/manual-sign?signatory_name=${encodeURIComponent('Signed copy uploaded by recruiter')}`, {
        method: 'POST', headers: authHeaders(), body: fd,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || 'Upload failed'); }
      showToast('Signed copy uploaded — moved to Screened'); refetch();
    } catch (e: any) { showToast(String(e?.message || 'Upload failed'), false); } finally { setUploading(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: cfg.bg, color: cfg.color }}>
          <ShieldCheck size={11} /> {cfg.label}
        </span>
        {(nda.status === 'e_signed' || nda.status === 'manually_signed') && (
          <span style={{ fontSize: 10, color: '#94A3B8' }}>
            {nda.signatory_name} · {ago(nda.signed_at)}
          </span>
        )}
      </div>

      {editable ? (
        <textarea value={draftText} onChange={e => setDraftText(e.target.value)}
          style={{ width: '100%', minHeight: 220, padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, lineHeight: 1.6, resize: 'vertical', outline: 'none', fontFamily: 'Georgia,serif', color: '#374151', marginBottom: 10 }} />
      ) : (
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 14px', fontSize: 12, lineHeight: 1.6, color: '#374151', fontFamily: 'Georgia,serif', whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto', marginBottom: 10 }}>
          {nda.final_text || nda.draft_text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {editable && (
          <button onClick={saveDraft} disabled={saving}
            style={{ padding: '7px 14px', background: '#F1F5F9', color: '#374151', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Saving…' : 'Save Draft'}
          </button>
        )}
        <button onClick={() => downloadNdaFile(appId, 'pdf')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: '#F1F5F9', color: '#374151', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Download size={12} /> PDF
        </button>
        <button onClick={() => downloadNdaFile(appId, 'docx')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: '#F1F5F9', color: '#374151', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Download size={12} /> Word
        </button>
      </div>

      {editable && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1E40AF', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Send for Signature</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
              <input type="radio" checked={signMethod === 'type_name'} onChange={() => setSignMethod('type_name')} /> Type-name signature
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
              <input type="radio" checked={signMethod === 'otp'} onChange={() => setSignMethod('otp')} /> Type-name + Email OTP
            </label>
          </div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#1E40AF', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Attach</div>
          <select value={attachment} onChange={e => setAttachment(e.target.value as any)}
            style={{ width: '100%', padding: '7px 10px', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 12, color: '#374151', marginBottom: 10, background: '#fff' }}>
            <option value="generated">Auto-generated NDA document</option>
            <option value="nda_template" disabled={!templates?.nda}>{templates?.nda ? `NDA Template (${templates.nda.file_name})` : 'NDA Template — none uploaded'}</option>
            <option value="contract_template" disabled={!templates?.contract}>{templates?.contract ? `Contract Template (${templates.contract.file_name})` : 'Contract Template — none uploaded'}</option>
          </select>
          {attachment !== 'generated' && (
            <div style={{ fontSize: 10, color: '#64748B', marginBottom: 10 }}>
              Manage uploaded templates on the <a href="/nda-documents" style={{ color: '#2563EB', fontWeight: 700 }}>NDA Documents</a> page.
            </div>
          )}
          <button onClick={sendForSignature} disabled={sending}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <Send size={12} /> {sending ? 'Sending…' : 'Send for Signature'}
          </button>
        </div>
      )}

      {signUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 11, color: '#15803D' }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signUrl}</span>
          <button onClick={() => { navigator.clipboard.writeText(signUrl); showToast('Signing link copied'); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803D', display: 'flex' }}>
            <Copy size={13} />
          </button>
        </div>
      )}

      {nda.status !== 'e_signed' && nda.status !== 'manually_signed' && (
        <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Or mark as manually signed</div>
          <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadManualSign(f); }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', background: '#fff', color: '#374151', border: '1px dashed #CBD5E1', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <Upload size={12} /> {uploading ? 'Uploading…' : 'Upload Signed Copy'}
          </button>
        </div>
      )}

      {(nda.status === 'manually_signed' && nda.manual_file_path) && (
        <button onClick={async () => {
          const res = await fetch(`${API}/nda/${nda.id}/manual-file`, { headers: authHeaders() });
          if (!res.ok) return;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, color: '#15803D', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Download size={13} /> View Uploaded Signed Copy
        </button>
      )}
    </div>
  );
}

// ── Submit to KAE Tab ────────────────────────────────────────────────────────
function CallLetterTab({ appId, showToast }: any) {
  const [interviewDate, setInterviewDate] = useState('');
  const [interviewTime, setInterviewTime] = useState('');
  const [venue, setVenue] = useState('');
  const [mode, setMode] = useState('in_person');
  const [notes, setNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);

  const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em', marginBottom: 6, display: 'block' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 9px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 };

  const payload = () => ({
    application_id: appId,
    interview_date: interviewDate,
    interview_time: interviewTime || undefined,
    venue: venue || undefined,
    mode,
    notes: notes || undefined,
  });

  const preview = async () => {
    if (!interviewDate) { showToast('Interview date is required', false); return; }
    setBusy('preview');
    try {
      const res = await fetch(`${API}/call-letters/preview`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.detail || 'Preview failed'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e: any) {
      showToast(String(e?.message || 'Preview failed'), false);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!interviewDate) { showToast('Interview date is required', false); return; }
    setBusy('send');
    try {
      const r = await apiFetch('/call-letters/generate', {
        method: 'POST',
        body: JSON.stringify({ ...payload(), send_email: sendEmail }),
      });
      showToast(r.email_sent ? `Call letter sent to ${r.candidate_name} ✓` : (sendEmail ? `Generated, but email failed: ${r.email_error || 'SMTP error'}` : 'Call letter generated'), sendEmail ? !!r.email_sent : true);
    } catch (e: any) {
      showToast(String(e?.message || 'Failed to generate call letter'), false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="call-letter-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <span style={lbl}>INTERVIEW DATE</span>
          <input type="date" value={interviewDate} onChange={e => setInterviewDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <span style={lbl}>TIME (OPTIONAL)</span>
          <input type="time" value={interviewTime} onChange={e => setInterviewTime(e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div>
        <span style={lbl}>MODE</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {[{ key: 'in_person', label: 'In-Person' }, { key: 'virtual', label: 'Virtual' }].map(o => (
            <button key={o.key} onClick={() => setMode(o.key)}
              style={{ flex: 1, padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                border: `1.5px solid ${mode === o.key ? '#2563EB' : '#E2E8F0'}`,
                background: mode === o.key ? '#EFF6FF' : '#fff', color: mode === o.key ? '#1D4ED8' : '#475569' }}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span style={lbl}>{mode === 'virtual' ? 'MEETING LINK' : 'VENUE'}</span>
        <input value={venue} onChange={e => setVenue(e.target.value)}
          placeholder={mode === 'virtual' ? 'https://meet.google.com/...' : 'Office address'} style={inputStyle} />
      </div>

      <div>
        <span style={lbl}>ADDITIONAL NOTES (OPTIONAL)</span>
        <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
          style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569', cursor: 'pointer' }}>
        <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} /> Email to candidate
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={preview} disabled={busy !== null}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: '#fff', color: '#2563EB', border: '1px solid #2563EB', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          <FileText size={13} /> {busy === 'preview' ? 'Opening…' : 'Preview PDF'}
        </button>
        <button onClick={send} disabled={busy !== null}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          <Send size={13} /> {busy === 'send' ? 'Sending…' : sendEmail ? 'Generate & Send' : 'Generate'}
        </button>
      </div>
    </div>
  );
}

// ── Generate Resume Tab (opens the shared ResumeGeneratorModal with real
// job/client context — same engine Submit to KAE's own resume formats
// now call under the hood, but with the full compositional config: editable
// company replacement, per-field contact toggles, project focus, and
// Generate & Submit straight to the assigned KAE) ──────────────────────────
function ResumeGenTab({ candidateId, candidateName, requisitionId, clientName }: any) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: '20px 16px', textAlign: 'center' }}>
      <FileText size={28} style={{ color: '#7c3aed', marginBottom: 10 }} />
      <p style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16, lineHeight: 1.5 }}>
        Generate a privacy-controlled, company-replaced, or project-focused resume
        version for {candidateName || 'this candidate'}{clientName ? ` — for ${clientName}` : ''}.
        The original resume is never modified.
      </p>
      <button onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
        <FileText size={13} /> Open Resume Generator
      </button>
      {open && candidateId && (
        <ResumeGeneratorModal
          candidate={{ id: candidateId, full_name: candidateName }}
          requisitionId={requisitionId}
          clientName={clientName}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SubmitKaeTab({ appId, showToast, onSubmitted }: any) {
  const { data: preview, refetch: refetchPreview } = useFetch<any>(`/applications/${appId}/submit-to-kae/preview`);
  const { data: templates } = useFetch<any[]>('/submission-templates');
  const { data: history, refetch: refetchHistory } = useFetch<any[]>(`/applications/${appId}/submissions`);
  // Real improvement (2026-08-19): the 8 visual themes built for the
  // standalone Resume Generator (2026-08-18) never reached this older,
  // still-live KAE-submission path -- every format here rendered in the
  // Classic theme only, regardless of which content style was picked.
  // Reuses the same real endpoints the Resume Generator modal already
  // calls, not a duplicated list. Doesn't apply to Manual Editing, which
  // has its own dedicated, un-themed renderer (see backend comment on
  // SubmitToKaeIn.visual_theme for why).
  const { data: visualThemes } = useFetch<any[]>('/resume-generator/visual-themes');
  const { data: logoPositionOptions } = useFetch<any[]>('/resume-generator/logo-position-options');
  const [visualTheme, setVisualTheme] = useState('classic');
  const [logoPosition, setLogoPosition] = useState('top_right');
  const [templateId, setTemplateId] = useState('');
  const [resumeStyle, setResumeStyle] = useState('clean_generated');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [ccSelf, setCcSelf] = useState(true);
  const [sending, setSending] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [manualDraft, setManualDraft] = useState<Record<string, string> | null>(null);
  const [manualLoading, setManualLoading] = useState(false);

  useEffect(() => {
    if (preview && !initialized) {
      setTemplateId(preview.resolved_template_id || '');
      setFields(preview.auto_values || {});
      setInitialized(true);
    }
  }, [preview, initialized]);

  useEffect(() => {
    if (resumeStyle === 'manual' && !manualDraft) {
      setManualLoading(true);
      apiFetch(`/applications/${appId}/submit-to-kae/manual-draft`)
        .then((d: any) => setManualDraft(d))
        .catch(() => setManualDraft({ name: '', designation: '', location: '', total_exp: '', skills: '', summary: '' }))
        .finally(() => setManualLoading(false));
    }
  }, [resumeStyle, appId, manualDraft]);

  const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em', marginBottom: 6, display: 'block' };

  if (!preview) return <div style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', padding: 20 }}>Loading…</div>;

  if (!preview.kae) {
    return (
      <div data-testid="kae-submit-panel" style={{ padding: 16, textAlign: 'center', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10 }}>
        <AlertTriangle size={20} color="#CA8A04" style={{ marginBottom: 6 }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>No KAE assigned to this client</div>
        <div style={{ fontSize: 11, color: '#92400E', marginBottom: 8 }}>Assign a Key Account Executive to this client before submitting a profile.</div>
        <a href="/kae" style={{ fontSize: 11, fontWeight: 700, color: '#2563EB' }}>Go to KAE → Owners →</a>
      </div>
    );
  }

  const selectedTemplate = (templates || []).find((t: any) => t.id === templateId);

  const send = async () => {
    if (resumeStyle === 'manual' && !manualDraft) return;
    setSending(true);
    try {
      const r = await apiFetch(`/applications/${appId}/submit-to-kae`, {
        method: 'POST',
        body: JSON.stringify({
          template_id: templateId, resume_style: resumeStyle, field_values: fields, cc_self: ccSelf,
          manual_resume: resumeStyle === 'manual' ? manualDraft : undefined,
          visual_theme: resumeStyle !== 'manual' ? visualTheme : undefined,
          logo_position: resumeStyle !== 'manual' ? logoPosition : undefined,
        }),
      });
      showToast(r.email_sent ? `Sent to ${r.kae_name} ✓` : `Logged, but email failed: ${r.email_error || 'SMTP error'}`, !!r.email_sent);
      setInitialized(false);
      refetchHistory();
      refetchPreview();
      onSubmitted?.(r.stage_bumped_to_submitted);
    } catch (e: any) {
      showToast(String(e?.message || 'Submission failed'), false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-testid="kae-submit-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: '#1E293B' }}>To: {preview.kae.full_name}</div>
        <div style={{ color: '#64748B' }}>{preview.kae.email}</div>
      </div>

      <div>
        <span style={lbl}>TRACKING SHEET TEMPLATE</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(templates || []).map((t: any) => (
            <button key={t.id} onClick={() => setTemplateId(t.id)}
              style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${templateId === t.id ? '#2563EB' : '#E2E8F0'}`,
                background: templateId === t.id ? '#2563EB' : '#fff', color: templateId === t.id ? '#fff' : '#475569' }}>
              {t.name}{t.client_name ? ` (${t.client_name})` : t.is_default ? ' (Default)' : ''}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span style={lbl}>RESUME FORMAT</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { key: 'clean_generated', label: 'Clean Summary', hint: 'Generated one-pager, no contact info' },
            { key: 'manual', label: 'Manual Editing', hint: 'Edit the summary yourself before sending' },
            { key: 'projects_only', label: 'Projects Only', hint: 'Contact & employment history removed' },
            { key: 'confidential', label: 'Confidential Company', hint: 'Company & projects marked Confidential' },
            { key: 'anonymized', label: 'Anonymized', hint: 'Name + employer masked (AviinTech Business Solutions)' },
            { key: 'redacted_original', label: 'Redacted Original', hint: 'Full resume text, contact info blanked' },
          ].map(o => (
            <button key={o.key} onClick={() => setResumeStyle(o.key)}
              style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                border: `1.5px solid ${resumeStyle === o.key ? '#2563EB' : '#E2E8F0'}`,
                background: resumeStyle === o.key ? '#EFF6FF' : '#fff' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: resumeStyle === o.key ? '#1D4ED8' : '#1E293B' }}>{o.label}</div>
              <div style={{ fontSize: 10, color: '#94A3B8' }}>{o.hint}</div>
            </button>
          ))}
        </div>
        {(resumeStyle === 'redacted_original' || resumeStyle === 'projects_only') && !preview.has_resume_text && (
          <div style={{ fontSize: 10, color: '#DC2626', marginTop: 4 }}>No extracted resume text on file for this candidate — Clean Summary is recommended instead.</div>
        )}
      </div>

      {resumeStyle !== 'manual' && (
        <div>
          <span style={lbl}>VISUAL LAYOUT</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {(visualThemes || []).map((t: any) => (
              <button key={t.id} type="button" title={t.description} onClick={() => setVisualTheme(t.id)}
                style={{ fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${visualTheme === t.id ? '#2563EB' : '#E2E8F0'}`,
                  background: visualTheme === t.id ? '#2563EB' : '#fff', color: visualTheme === t.id ? '#fff' : '#475569' }}>
                {t.label}
              </button>
            ))}
          </div>
          <span style={lbl}>LOGO POSITION</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(logoPositionOptions || []).map((o: any) => (
              <button key={o.id} type="button" title={o.description} onClick={() => setLogoPosition(o.id)}
                style={{ fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${logoPosition === o.id ? '#2563EB' : '#E2E8F0'}`,
                  background: logoPosition === o.id ? '#2563EB' : '#fff', color: logoPosition === o.id ? '#fff' : '#475569' }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {resumeStyle === 'manual' && (
        <div>
          <span style={lbl}>EDIT BEFORE SENDING</span>
          {manualLoading || !manualDraft ? (
            <div style={{ fontSize: 11, color: '#94A3B8' }}>Loading draft…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['name', 'designation', 'location', 'total_exp', 'skills'] as const).map(k => (
                <div key={k}>
                  <label style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8' }}>{k.replace('_', ' ').toUpperCase()}</label>
                  <input value={manualDraft[k] || ''} onChange={e => setManualDraft({ ...manualDraft, [k]: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11, marginTop: 2 }} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8' }}>SUMMARY</label>
                <textarea rows={6} value={manualDraft.summary || ''} onChange={e => setManualDraft({ ...manualDraft, summary: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11, marginTop: 2, fontFamily: 'inherit', resize: 'vertical' }} />
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <span style={lbl}>TRACKING SHEET ROW (SL No {preview.auto_values?.sl_no})</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(selectedTemplate?.columns || []).filter((c: any) => c.key !== 'sl_no').map((c: any) => (
            <div key={c.key} style={{ gridColumn: c.key === 'skill_summary' ? '1 / -1' : undefined }}>
              <label style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8' }}>{c.label.toUpperCase()}</label>
              <input value={fields[c.key] || ''} onChange={e => setFields({ ...fields, [c.key]: e.target.value })}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11, marginTop: 2 }} />
            </div>
          ))}
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569', cursor: 'pointer' }}>
        <input type="checkbox" checked={ccSelf} onChange={e => setCcSelf(e.target.checked)} /> CC myself
      </label>

      <button onClick={send} disabled={sending}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.7 : 1 }}>
        <Send size={13} /> {sending ? 'Sending…' : 'Submit to KAE'}
      </button>

      {history && history.length > 0 && (
        <div>
          <span style={lbl}>SUBMISSION HISTORY</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map((h: any) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 8, fontSize: 11 }}>
                {h.status === 'sent' ? <CheckCircle size={12} color="#16A34A" /> : <AlertTriangle size={12} color="#DC2626" />}
                <span style={{ flex: 1 }}>SL#{h.field_values?.sl_no} to {h.kae_name || 'KAE'} · {h.resume_style === 'clean_generated' ? 'Clean' : 'Redacted'} · {h.template_name}</span>
                <span style={{ color: '#94A3B8' }}>{new Date(h.sent_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SubmitClientTab({ appId, showToast, onSubmitted }: any) {
  const { data: preview, refetch: refetchPreview } = useFetch<any>(`/applications/${appId}/submit-to-client/preview`);
  const { data: templates } = useFetch<any[]>('/submission-templates?direction=kae_to_client');
  const { data: allHistory, refetch: refetchHistory } = useFetch<any[]>(`/applications/${appId}/submissions`);
  const history = (allHistory || []).filter((h: any) => h.direction === 'kae_to_client');
  const { data: visualThemes } = useFetch<any[]>('/resume-generator/visual-themes');
  const { data: logoPositionOptions } = useFetch<any[]>('/resume-generator/logo-position-options');
  const [visualTheme, setVisualTheme] = useState('classic');
  const [logoPosition, setLogoPosition] = useState('top_right');
  const [templateId, setTemplateId] = useState('');
  const [resumeStyle, setResumeStyle] = useState('clean_generated');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [toEmail, setToEmail] = useState('');
  const [ccSelf, setCcSelf] = useState(true);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [sending, setSending] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [manualDraft, setManualDraft] = useState<Record<string, string> | null>(null);
  const [manualLoading, setManualLoading] = useState(false);

  useEffect(() => {
    if (preview && !initialized) {
      setTemplateId(preview.resolved_template?.id || '');
      setFields(preview.auto_values || {});
      setToEmail(preview.primary_contact?.email || '');
      setInitialized(true);
    }
  }, [preview, initialized]);

  useEffect(() => {
    if (resumeStyle === 'manual' && !manualDraft) {
      setManualLoading(true);
      apiFetch(`/applications/${appId}/submit-to-kae/manual-draft`)
        .then((d: any) => setManualDraft(d))
        .catch(() => setManualDraft({ name: '', designation: '', location: '', total_exp: '', skills: '', summary: '' }))
        .finally(() => setManualLoading(false));
    }
  }, [resumeStyle, appId, manualDraft]);

  const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em', marginBottom: 6, display: 'block' };

  if (!preview) return <div style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', padding: 20 }}>Loading…</div>;

  if (!preview.contacts?.length) {
    return (
      <div data-testid="client-submit-panel" style={{ padding: 16, textAlign: 'center', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10 }}>
        <AlertTriangle size={20} color="#CA8A04" style={{ marginBottom: 6 }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>No client contact configured</div>
        <div style={{ fontSize: 11, color: '#92400E', marginBottom: 8 }}>Add the client's KAM/contact email before sending — see the client's Companies page.</div>
        <a href="/companies" style={{ fontSize: 11, fontWeight: 700, color: '#2563EB' }}>Go to Companies →</a>
      </div>
    );
  }

  const selectedTemplate = (templates || []).find((t: any) => t.id === templateId) || preview.resolved_template;
  const isFileTemplate = selectedTemplate?.template_type === 'file';
  const toggleHidden = (key: string) => setHiddenKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const send = async () => {
    if (resumeStyle === 'manual' && !manualDraft) return;
    setSending(true);
    try {
      const visibleColumns = (selectedTemplate?.columns || []).filter((c: any) => !hiddenKeys.includes(c.key));
      const r = await apiFetch(`/applications/${appId}/submit-to-client`, {
        method: 'POST',
        body: JSON.stringify({
          template_id: templateId || undefined,
          to_emails: toEmail ? [toEmail] : undefined,
          columns: saveAsDefault && hiddenKeys.length ? visibleColumns : undefined,
          hidden_columns: hiddenKeys,
          field_values: fields, cc_self: ccSelf, save_as_default: saveAsDefault,
          resume_style: resumeStyle,
          manual_resume: resumeStyle === 'manual' ? manualDraft : undefined,
          visual_theme: resumeStyle !== 'manual' ? visualTheme : undefined,
          logo_position: resumeStyle !== 'manual' ? logoPosition : undefined,
        }),
      });
      showToast(r.email_sent ? `Sent to ${r.recipient_name} ✓` : `Logged, but email failed: ${r.email_error || 'SMTP error'}`, !!r.email_sent);
      setInitialized(false);
      setHiddenKeys([]);
      setSaveAsDefault(false);
      refetchHistory();
      refetchPreview();
      // Real automation (2026-08-26): a real send now auto-advances the
      // backend stage straight to "Submitted" (see stage_bumped_to_submitted
      // in the response) — pass that through so callers (the drawer tab AND
      // the board's own "move into Submit to Client" modal) reflect the
      // real resulting stage instead of assuming nothing moved.
      onSubmitted?.(r.stage_bumped_to_submitted);
    } catch (e: any) {
      showToast(String(e?.message || 'Submission failed'), false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-testid="client-submit-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: 10, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12 }}>
        <span style={lbl}>TO (CLIENT / KAM)</span>
        {preview.contacts.length > 1 ? (
          <select value={toEmail} onChange={e => setToEmail(e.target.value)} style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 }}>
            {preview.contacts.map((c: any) => <option key={c.id} value={c.email}>{c.contact_name}{c.role_label ? ` (${c.role_label})` : ''} — {c.email}</option>)}
          </select>
        ) : (
          <input value={toEmail} onChange={e => setToEmail(e.target.value)} style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 }} />
        )}
      </div>

      <div>
        <span style={lbl}>TRACKING SHEET TEMPLATE</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(templates || []).map((t: any) => (
            <button key={t.id} onClick={() => { setTemplateId(t.id); setHiddenKeys([]); }}
              style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${templateId === t.id ? '#2563EB' : '#E2E8F0'}`,
                background: templateId === t.id ? '#2563EB' : '#fff', color: templateId === t.id ? '#fff' : '#475569' }}>
              {t.name}{t.client_name ? ` (${t.client_name})` : t.is_default ? ' (Default)' : ''}{t.template_type === 'file' ? ' 📄' : ''}
            </button>
          ))}
        </div>
        {isFileTemplate && (
          <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 4 }}>
            This is an uploaded {selectedTemplate?.file_name} — real candidate data is merged directly into it{selectedTemplate?.file_name?.toLowerCase().endsWith('.pdf') ? ' (PDF is attached as-is; a live table is also included below since a PDF can\'t be merge-filled)' : ' and attached'}.
          </div>
        )}
      </div>

      <div>
        <span style={lbl}>RESUME FORMAT</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { key: 'clean_generated', label: 'Clean Summary', hint: 'Generated one-pager, no contact info' },
            { key: 'manual', label: 'Manual Editing', hint: 'Edit the summary yourself before sending' },
            { key: 'projects_only', label: 'Projects Only', hint: 'Contact & employment history removed' },
            { key: 'confidential', label: 'Confidential Company', hint: 'Company & projects marked Confidential' },
            { key: 'anonymized', label: 'Anonymized', hint: 'Name + employer masked (AviinTech Business Solutions)' },
            { key: 'redacted_original', label: 'Redacted Original', hint: 'Full resume text, contact info blanked' },
          ].map(o => (
            <button key={o.key} onClick={() => setResumeStyle(o.key)}
              style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                border: `1.5px solid ${resumeStyle === o.key ? '#2563EB' : '#E2E8F0'}`,
                background: resumeStyle === o.key ? '#EFF6FF' : '#fff' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: resumeStyle === o.key ? '#1D4ED8' : '#1E293B' }}>{o.label}</div>
              <div style={{ fontSize: 10, color: '#94A3B8' }}>{o.hint}</div>
            </button>
          ))}
        </div>
        {(resumeStyle === 'redacted_original' || resumeStyle === 'projects_only') && !preview.has_resume_text && (
          <div style={{ fontSize: 10, color: '#DC2626', marginTop: 4 }}>No extracted resume text on file for this candidate — Clean Summary is recommended instead.</div>
        )}
      </div>

      {resumeStyle !== 'manual' && (
        <div>
          <span style={lbl}>VISUAL LAYOUT</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {(visualThemes || []).map((t: any) => (
              <button key={t.id} type="button" title={t.description} onClick={() => setVisualTheme(t.id)}
                style={{ fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${visualTheme === t.id ? '#2563EB' : '#E2E8F0'}`,
                  background: visualTheme === t.id ? '#2563EB' : '#fff', color: visualTheme === t.id ? '#fff' : '#475569' }}>
                {t.label}
              </button>
            ))}
          </div>
          <span style={lbl}>LOGO POSITION</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(logoPositionOptions || []).map((o: any) => (
              <button key={o.id} type="button" title={o.description} onClick={() => setLogoPosition(o.id)}
                style={{ fontSize: 10.5, fontWeight: 700, padding: '5px 10px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${logoPosition === o.id ? '#2563EB' : '#E2E8F0'}`,
                  background: logoPosition === o.id ? '#2563EB' : '#fff', color: logoPosition === o.id ? '#fff' : '#475569' }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {resumeStyle === 'manual' && (
        <div>
          <span style={lbl}>EDIT BEFORE SENDING</span>
          {manualLoading || !manualDraft ? (
            <div style={{ fontSize: 11, color: '#94A3B8' }}>Loading draft…</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(['name', 'designation', 'location', 'total_exp', 'skills'] as const).map(k => (
                <div key={k}>
                  <label style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8' }}>{k.replace('_', ' ').toUpperCase()}</label>
                  <input value={manualDraft[k] || ''} onChange={e => setManualDraft({ ...manualDraft, [k]: e.target.value })}
                    style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11, marginTop: 2 }} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8' }}>SUMMARY</label>
                <textarea rows={6} value={manualDraft.summary || ''} onChange={e => setManualDraft({ ...manualDraft, summary: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11, marginTop: 2, fontFamily: 'inherit', resize: 'vertical' }} />
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <span style={lbl}>TRACKING SHEET ROW (SL No {preview.auto_values?.sl_no}) — click the eye to hide a field from the client</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(selectedTemplate?.columns || []).filter((c: any) => c.key !== 'sl_no').map((c: any) => {
            const hidden = hiddenKeys.includes(c.key);
            return (
              <div key={c.key} style={{ gridColumn: c.key === 'skill_summary' ? '1 / -1' : undefined, opacity: hidden ? 0.45 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: 9, fontWeight: 700, color: '#94A3B8' }}>{c.label.toUpperCase()}</label>
                  <button type="button" data-testid={`hide-col-${c.key}`} onClick={() => toggleHidden(c.key)} title={hidden ? 'Hidden from this send — click to show' : 'Hide from this send'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: hidden ? '#DC2626' : '#CBD5E1', display: 'flex' }}>
                    {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                <input value={fields[c.key] || ''} disabled={hidden} onChange={e => setFields({ ...fields, [c.key]: e.target.value })}
                  style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 11, marginTop: 2, background: hidden ? '#F8FAFC' : '#fff' }} />
              </div>
            );
          })}
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569', cursor: 'pointer' }}>
        <input type="checkbox" checked={ccSelf} onChange={e => setCcSelf(e.target.checked)} /> CC myself
      </label>
      {hiddenKeys.length > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569', cursor: 'pointer' }}>
          <input type="checkbox" checked={saveAsDefault} onChange={e => setSaveAsDefault(e.target.checked)} />
          Save as this client's default template ({hiddenKeys.length} hidden field{hiddenKeys.length === 1 ? '' : 's'} removed permanently — otherwise this hide only applies to this one send)
        </label>
      )}

      <button onClick={send} disabled={sending}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px', background: '#16A34A', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.7 : 1 }}>
        <Send size={13} /> {sending ? 'Sending…' : 'Approve & Send to Client'}
      </button>

      {history.length > 0 && (
        <div>
          <span style={lbl}>SUBMISSION HISTORY</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {history.map((h: any) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 8, fontSize: 11 }}>
                {h.status === 'sent' ? <CheckCircle size={12} color="#16A34A" /> : <AlertTriangle size={12} color="#DC2626" />}
                <span style={{ flex: 1 }}>SL#{h.field_values?.sl_no} to {(h.to_emails || []).join(', ') || 'client'} · {h.template_name || 'Template'}</span>
                <span style={{ color: '#94A3B8' }}>{new Date(h.sent_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Modal wrapper reusing SubmitClientTab as-is, self-contained given only
// appId (2026-08-25) — invoked by moveStage() when a candidate is being
// moved into the real "Client Submission" stage with Manual send mode:
// the actual resume/tracking-sheet/SPOC review happens here, and the
// stage move itself only commits once the recruiter sends (or explicitly
// chooses to move without sending).
function ClientSubmissionMoveModal({ appId, candidateName, stageLabel, showToast, onCancel, onSent }: any) {
  const [sending, setSending] = useState(false);
  return (
    <div data-testid="client-submission-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ width: 560, maxWidth: '94vw', maxHeight: '88vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            {/* Real bug fix (2026-08-25) — was a hardcoded "Client
                Submission" title, stale the moment a tenant renames this
                real, tenant-configurable custom stage (this tenant's own
                current label is "Submit to Client", confirmed live) —
                now shows the actual current label instead of assuming one. */}
            <div data-testid="client-submission-modal-title" style={{ fontSize: 15, fontWeight: 800, color: '#1E293B' }}>Submit to Client — Moving to {stageLabel || 'Client Submission'}</div>
            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{candidateName} — review the resume, tracking sheet and SPOC before sending.</div>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 4 }}><X size={16} /></button>
        </div>
        <div style={{ marginTop: 14 }}>
          <SubmitClientTab appId={appId} showToast={showToast} onSubmitted={(bumped: boolean) => onSent(bumped)} />
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'flex-end' }}>
          <button data-testid="client-submission-move-only" disabled={sending} onClick={async () => { setSending(true); await onSent(false); }}
            style={{ padding: '8px 14px', background: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: sending ? 'default' : 'pointer' }}>
            {sending ? 'Moving…' : 'Move Without Sending'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Notes Tab ─────────────────────────────────────────────────────────────────
function NotesTab({ appId, showToast }: any) {
  const [notes, setNotes] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    apiFetch(`/applications/${appId}/notes`).then(d => setNotes(Array.isArray(d) ? d : [])).catch(() => setLoadError(true)).finally(() => setLoading(false));
  }, [appId]);
  async function addNote() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const note = await apiFetch(`/applications/${appId}/notes`, { method: 'POST', body: JSON.stringify({ note: text }) });
      setNotes(prev => [note, ...prev]); setText(''); showToast('Note added');
    } catch (e: any) { showToast(String(e?.message || 'Failed'), false); } finally { setSaving(false); }
  }
  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Add a note…"
        style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, resize: 'vertical', minHeight: 80, outline: 'none', fontFamily: 'inherit', color: '#374151', marginBottom: 8 }} />
      <button onClick={addNote} disabled={!text.trim() || saving}
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: text.trim() && !saving ? 'pointer' : 'not-allowed', opacity: text.trim() && !saving ? 1 : 0.5, marginBottom: 16 }}>
        <Send size={12} /> {saving ? 'Saving…' : 'Add Note'}
      </button>
      {loading && <div style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', padding: 20 }}>Loading…</div>}
      {!loading && loadError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#DC2626', fontSize: 12, textAlign: 'center', padding: 14, background: '#FEF2F2', border: '1px solid #FCA5A4', borderRadius: 8, justifyContent: 'center' }}>
          <AlertTriangle size={13} /> Couldn't load notes — try reopening this candidate
        </div>
      )}
      {!loading && !loadError && notes.length === 0 && <div style={{ color: '#CBD5E1', fontSize: 12, textAlign: 'center', padding: 20, fontStyle: 'italic' }}>No notes yet</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {notes.map((n: any) => (
          <div key={n.id} style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 4 }}>{n.text}</div>
            <div style={{ fontSize: 10, color: '#94A3B8' }}>{n.author || 'Recruiter'} · {ago(n.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Scorecards Tab ────────────────────────────────────────────────────────────
function ScorecardsTab({ appId, showToast }: any) {
  const { data: scorecards, refetch: refresh } = useFetch<any[]>(`/interview-scorecards?application_id=${appId}`);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ round: 'L1', overall_rating: '', recommendation: 'yes', notes: '' });
  const [saving, setSaving] = useState(false);
  async function submit() {
    setSaving(true);
    try {
      await apiFetch('/interview-scorecards', { method: 'POST', body: JSON.stringify({ application_id: appId, round: form.round, overall_rating: form.overall_rating ? parseFloat(form.overall_rating) : null, recommendation: form.recommendation, notes: form.notes, scores: {} }) });
      setAdding(false); setForm({ round: 'L1', overall_rating: '', recommendation: 'yes', notes: '' }); refresh(); showToast('Scorecard added');
    } catch (e: any) { showToast(String(e?.message || 'Failed'), false); } finally { setSaving(false); }
  }
  const RECO_COLORS: Record<string, string> = { strong_yes: '#16A34A', yes: '#059669', neutral: '#F59E0B', no: '#DC2626', strong_no: '#7F1D1D' };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>{scorecards?.length || 0} scorecard(s)</span>
        <button onClick={() => setAdding(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}><Plus size={12} /> Add Scorecard</button>
      </div>
      {adding && (
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 }}>ROUND</label>
              <select value={form.round} onChange={e => setForm(f => ({ ...f, round: e.target.value }))} style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 }}>
                {['L1','L2','HR','Technical','Final'].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 }}>RATING (1–5)</label>
              <input type="number" min="1" max="5" step="0.5" value={form.overall_rating} onChange={e => setForm(f => ({ ...f, overall_rating: e.target.value }))} placeholder="e.g. 4.5" style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 }} />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 }}>RECOMMENDATION</label>
            <select value={form.recommendation} onChange={e => setForm(f => ({ ...f, recommendation: e.target.value }))} style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 }}>
              {['strong_yes','yes','neutral','no','strong_no'].map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 }}>NOTES</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Interview observations…" style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12, resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submit} disabled={saving} style={{ padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save Scorecard'}</button>
            <button onClick={() => setAdding(false)} style={{ padding: '7px 12px', background: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(scorecards || []).map((sc: any) => (
          <div key={sc.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#1E293B' }}>{sc.round}</span>
                {sc.overall_rating && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, background: '#FFFBEB', color: '#CA8A04', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, border: '1px solid #FDE68A' }}>
                    <Star size={10} fill="#CA8A04" /> {sc.overall_rating}/5
                  </span>
                )}
              </div>
              {sc.recommendation && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: (RECO_COLORS[sc.recommendation] || '#94A3B8') + '20', color: RECO_COLORS[sc.recommendation] || '#94A3B8' }}>{sc.recommendation.replace('_', ' ')}</span>}
            </div>
            {sc.notes && <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 4 }}>{sc.notes}</div>}
            <div style={{ fontSize: 10, color: '#94A3B8' }}>{ago(sc.created_at)}</div>
          </div>
        ))}
        {(!scorecards || scorecards.length === 0) && !adding && <div style={{ color: '#CBD5E1', fontSize: 12, textAlign: 'center', padding: 20, fontStyle: 'italic' }}>No scorecards yet</div>}
      </div>
    </div>
  );
}

// ── Activity Tab ──────────────────────────────────────────────────────────────
function ActivityTab({ candidateId }: any) {
  const { data: activities } = useFetch<any[]>(`/activities/${candidateId}`);
  const ACT_ICONS: Record<string, React.ReactNode> = {
    note: <FileText size={13} />, email_sent: <Mail size={13} />, status_change: <RefreshCw size={13} />,
    interview_scheduled: <Calendar size={13} />, offer_made: <Briefcase size={13} />, call_logged: <Phone size={13} />,
  };
  return (
    <div>
      {(!activities || activities.length === 0) && <div style={{ color: '#CBD5E1', fontSize: 12, textAlign: 'center', padding: 30, fontStyle: 'italic' }}>No activities recorded</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {(activities || []).map((act: any, i: number) => (
          <div key={act.id} style={{ display: 'flex', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#F1F5F9', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', flexShrink: 0 }}>
                {ACT_ICONS[act.activity_type] || <Activity size={13} />}
              </div>
              {i < (activities?.length || 0) - 1 && <div style={{ width: 1, flex: 1, background: '#E2E8F0', marginTop: 3 }} />}
            </div>
            <div style={{ flex: 1, paddingTop: 3 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B' }}>{act.title}</div>
              {act.description && <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{act.description}</div>}
              <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 4 }}>{ago(act.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Add Candidate Modal ──────────────────────────────────────────────────────
// Shows candidates ranked by JD-match score (match_candidates(): 60% resume/JD
// embedding similarity + 40% skill overlap, pre-sorted highest→lowest), not a
// plain alphabetical/text search — matches how a recruiter actually shortlists.
// ── Reject Reason Modal ──────────────────────────────────────────────────────
// ── Stage Email Review Modal (Manual send mode) ──────────────────────────────
// Real feature (2026-08-22): a stage configured as "Manual" in Settings >
// Email Configuration now genuinely shows this before anything sends —
// previously the setting existed but nothing ever consulted it. Editing
// here sends via custom_message (always wins server-side); "Move Without
// Sending" still moves the card, just with send_email:false; Cancel does
// nothing at all, reverting the optimistic board move already made.
function StageEmailReviewModal({ review, stageLabel, onCancel, onConfirm }: any) {
  const [subject, setSubject] = useState(review.subject);
  const [message, setMessage] = useState(review.message);
  const [sending, setSending] = useState(false);

  const send = async () => { setSending(true); await onConfirm(message); };
  const moveWithoutSending = async () => { setSending(true); await onConfirm(undefined); };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ width: 520, maxWidth: '92vw', background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#1E293B', marginBottom: 4 }}>Review Email — Moving to {stageLabel}</div>
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>To {review.candidateName} — edit before sending, or move without an email.</div>

        <label style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em' }}>SUBJECT</label>
        <input value={subject} onChange={e => setSubject(e.target.value)}
          style={{ width: '100%', padding: '9px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, margin: '4px 0 12px', color: '#1E293B', boxSizing: 'border-box' }} />

        <label style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em' }}>MESSAGE</label>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={8}
          style={{ width: '100%', padding: '9px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, margin: '4px 0 12px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: 1.5 }} />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onCancel} disabled={sending} style={{ padding: '8px 14px', background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: sending ? 'default' : 'pointer' }}>Cancel</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button data-testid="stage-review-move-only" onClick={moveWithoutSending} disabled={sending} style={{ padding: '8px 14px', background: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: sending ? 'default' : 'pointer' }}>Move Without Sending</button>
            <button data-testid="stage-review-send" onClick={send} disabled={sending} style={{ padding: '8px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: sending ? 'default' : 'pointer' }}>{sending ? 'Sending…' : 'Send & Move'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RejectReasonModal({ onCancel, onConfirm }: any) {
  const { data: reasons } = useFetch<any[]>('/rejection-reasons');
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (reasons && reasons.length > 0 && !code) setCode(reasons[0].code);
  }, [reasons]);

  const confirm = () => {
    if (!code) { setErr('Select a reason'); return; }
    onConfirm(code, notes);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ width: 420, maxWidth: '92vw', background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#1E293B', marginBottom: 4 }}>Reject Candidate</div>
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>Pick a reason — this is shared directly with the assigned recruiter.</div>

        <label style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em' }}>REASON</label>
        <select value={code} onChange={e => setCode(e.target.value)}
          style={{ width: '100%', padding: '9px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, margin: '4px 0 12px', color: '#1E293B' }}>
          {(reasons || []).map((r: any) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>

        <label style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em' }}>ADDITIONAL NOTES (OPTIONAL)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          style={{ width: '100%', padding: '9px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, margin: '4px 0 12px', resize: 'vertical', fontFamily: 'inherit' }} />

        {err && <div style={{ color: '#DC2626', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          <button onClick={confirm} style={{ padding: '8px 16px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reject Candidate</button>
        </div>
      </div>
    </div>
  );
}

// ── Remove From Pipeline Modal ───────────────────────────────────────────────
// Deliberately separate from RejectReasonModal — this is a more final
// action (the candidate disappears from every stage entirely, not even
// shown under Rejected), so it gets its own clearer warning copy rather
// than reusing Reject's UI with different labels.
function RemoveFromPipelineModal({ candidateName, onCancel, onConfirm }: any) {
  const [reason, setReason] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ width: 420, maxWidth: '92vw', background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Trash2 size={16} color="#DC2626" />
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1E293B' }}>Remove from Pipeline</div>
        </div>
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16, lineHeight: 1.5 }}>
          This is different from <b>Reject</b> — <b>{candidateName}</b> will disappear from
          every stage on this board entirely, including Rejected. Use this for a duplicate
          entry or a candidate added by mistake, not a real hiring decision. This can be
          undone by an admin/manager if needed.
        </div>

        <label style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.04em' }}>REASON (OPTIONAL)</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
          placeholder="e.g. duplicate of another application, added by mistake…"
          style={{ width: '100%', padding: '9px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 13, margin: '4px 0 14px', resize: 'vertical', fontFamily: 'inherit' }} />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          <button data-testid="remove-from-pipeline-confirm" onClick={() => onConfirm(reason)} style={{ padding: '8px 16px', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Remove from Pipeline</button>
        </div>
      </div>
    </div>
  );
}

// ── Candidate Comparison ─────────────────────────────────────────────────────
function CompareRow({ label, cells }: { label: string; cells: any[] }) {
  return (
    <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
      <td style={{ position: 'sticky', left: 0, background: '#F8FAFC', padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap', borderRight: '1px solid #F1F5F9' }}>{label}</td>
      {cells.map((c, i) => (
        <td key={i} style={{ padding: '10px 14px', fontSize: 12, color: '#1E293B', verticalAlign: 'top', minWidth: 200 }}>{c}</td>
      ))}
    </tr>
  );
}

function CompareModal({ apps, requiredSkills, stages, onClose }: any) {
  const reqSkillsLower = new Set((requiredSkills || []).map((s: string) => s.toLowerCase()));
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, maxWidth: '96vw', maxHeight: '90vh', width: Math.min(260 + apps.length * 220, 1400), display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1E293B' }}>Compare Candidates ({apps.length})</div>
          <button onClick={onClose} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94A3B8' }}><X size={14} /></button>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
                <th style={{ position: 'sticky', left: 0, top: 0, background: '#fff', zIndex: 2, borderRight: '1px solid #F1F5F9' }} />
                {apps.map((a: any) => (
                  <th key={a.id} style={{ padding: '12px 14px', textAlign: 'left', minWidth: 200, background: '#fff', position: 'sticky', top: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: `linear-gradient(135deg,${avatarColor(a.candidate_name)},${avatarColor(a.candidate_name)}aa)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                        {initials(a.candidate_name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.candidate_name}</div>
                        <div style={{ fontSize: 10, color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[a.current_designation, a.current_employer].filter(Boolean).join(' @ ')}</div>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Score" cells={apps.map((a: any) => {
                const s = a.fit_score ?? a.jd_match_score ?? a.ai_match_score ?? a.readiness_index;
                return s != null ? <span style={{ color: scoreColor(s), fontWeight: 800 }}>{Math.round(s)}%</span> : '—';
              })} />
              <CompareRow label="Stage" cells={apps.map((a: any) => stages.find((s: any) => s.key === a.stage)?.label || a.stage)} />
              <CompareRow label="Days in Stage" cells={apps.map((a: any) => {
                const d = daysSince(a.updated_at);
                const badge = stalenessBadge(d);
                return badge ? <span style={{ color: badge.color, fontWeight: 700 }}>{d}d</span> : `${d}d`;
              })} />
              <CompareRow label="Experience" cells={apps.map((a: any) => a.total_exp_mo ? gx(a.total_exp_mo) : '—')} />
              <CompareRow label="Notice Period" cells={apps.map((a: any) => a.notice_period_days != null ? `${a.notice_period_days}d` : '—')} />
              <CompareRow label="Expected CTC" cells={apps.map((a: any) => a.expected_ctc ? `₹${(a.expected_ctc / 100000).toFixed(1)}L` : '—')} />
              <CompareRow label="Location" cells={apps.map((a: any) => a.location || '—')} />
              <CompareRow label="Matched Skills" cells={apps.map((a: any) => {
                const matched = (a.skills || []).filter((sk: string) => reqSkillsLower.has(sk.toLowerCase()));
                return matched.length > 0
                  ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>{matched.map((sk: string) => <span key={sk} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}>{sk}</span>)}</div>
                  : '—';
              })} />
              {requiredSkills.length > 0 && (
                <CompareRow label="Missing Skills" cells={apps.map((a: any) => {
                  const have = new Set((a.skills || []).map((sk: string) => sk.toLowerCase()));
                  const missing = requiredSkills.filter((sk: string) => !have.has(sk.toLowerCase()));
                  return missing.length > 0
                    ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>{missing.map((sk: string) => <span key={sk} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>{sk}</span>)}</div>
                    : <span style={{ color: '#16A34A', fontWeight: 700 }}>None</span>;
                })} />
              )}
              <CompareRow label="Contact" cells={apps.map((a: any) => (
                <div style={{ fontSize: 11 }}>
                  {a.email && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.email}</div>}
                  {a.phone && <div>{a.phone}</div>}
                  {!a.email && !a.phone && '—'}
                </div>
              ))} />
              <CompareRow label="Resume" cells={apps.map((a: any) => (
                a.resume_file_id
                  ? <button onClick={() => downloadResume(a.resume_file_id, a.resume_file_name)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #BBF7D0', background: '#F0FDF4', color: '#15803D', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      <Download size={11} /> Download
                    </button>
                  : '—'
              ))} />
              <CompareRow label="" cells={apps.map((a: any) => (
                <a href={`/candidates/${a.candidate_id}`} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#2563EB', textDecoration: 'none' }}>
                  Full Profile <ExternalLink size={10} />
                </a>
              ))} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Boolean Search ────────────────────────────────────────────────────────────
function BooleanSearchModal({ jobId, onClose }: any) {
  const { data, loading } = useFetch<any>(`/requisitions/${jobId}/boolean-search`);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, which: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ width: 560, maxWidth: '94vw', maxHeight: '86vh', background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1E293B' }}>Boolean Search String</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Zero-token — built from this role's required skills, with real synonym expansion. No AI involved.</div>
          </div>
          <button onClick={onClose} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94A3B8' }}><X size={14} /></button>
        </div>
        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: 20 }}>Building search string…</div>}
          {!loading && data && (
            <>
              {data.skills_used?.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 12, padding: 20, fontStyle: 'italic' }}>
                  This role has no required skills set — add some under the requisition's skills field first.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>SKILLS (paste into a LinkedIn/Naukri search box)</div>
                  <textarea readOnly value={data.boolean_string} rows={4}
                    style={{ width: '100%', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace', color: '#1E293B', resize: 'vertical', background: '#F8FAFC', marginBottom: 8 }} />
                  <button onClick={() => copy(data.boolean_string, 'skills')}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, border: 'none', background: copied === 'skills' ? '#16A34A' : '#2563EB', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 16 }}>
                    <Copy size={12} /> {copied === 'skills' ? 'Copied!' : 'Copy Skills String'}
                  </button>

                  {data.title_string && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>TITLE</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                        <code style={{ flex: 1, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>{data.title_string}</code>
                        <button onClick={() => copy(data.title_string, 'title')}
                          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #E2E8F0', background: copied === 'title' ? '#F0FDF4' : '#fff', color: copied === 'title' ? '#16A34A' : '#64748B', cursor: 'pointer' }}>
                          <Copy size={12} />
                        </button>
                      </div>
                    </>
                  )}

                  <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#374151', marginBottom: 16 }}>
                    {data.location && <div><b>Location:</b> {data.location}</div>}
                    {data.experience_range && <div><b>Experience:</b> {data.experience_range}</div>}
                  </div>

                  <div style={{ fontSize: 11, color: '#94A3B8', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px' }}>
                    {data.note}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AddCandidateModal({ jobId, board, stages, defaultStage, onClose, onAdded }: any) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [targetStage, setTargetStage] = useState(defaultStage || 'sourced');
  const { data: matchData, loading } = useFetch<any>(`/requisitions/${jobId}/match-candidates?limit=50`);
  const matches: any[] = Array.isArray(matchData?.matches) ? matchData.matches : [];

  const alreadyIn = new Set<string>(
    Object.values(board || {}).flat().map((a: any) => a.candidate_id)
  );

  const q = search.trim().toLowerCase();
  const items: any[] = (matches || []).filter((c: any) =>
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
        body: JSON.stringify({ candidate_ids: Array.from(selected), requisition_id: jobId, stage: targetStage }),
      });
      const label = stages?.find((s: any) => s.key === targetStage)?.label || targetStage;
      onAdded(label);
    } catch (e: any) {
      alert(String(e?.message || 'Failed to add candidates'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: 560, maxWidth: '94vw', maxHeight: '84vh', background: '#fff', borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#1E293B' }}>Add Candidate to Pipeline</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Ranked by JD match — highest score first</div>
          </div>
          <button onClick={onClose} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94A3B8' }}><X size={14} /></button>
        </div>
        <div style={{ padding: '12px 18px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '7px 10px' }}>
            <Search size={13} color="#94A3B8" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by name, skill, employer…" autoFocus
              style={{ border: 'none', background: 'none', outline: 'none', fontSize: 12, color: '#374151', flex: 1 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', flexShrink: 0 }}>Add into stage:</span>
            <select value={targetStage} onChange={e => setTargetStage(e.target.value)}
              style={{ flex: 1, border: '1px solid #E2E8F0', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontWeight: 600, color: '#1E293B', background: '#fff' }}>
              {(stages || []).map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px' }}>
          {loading && <div style={{ textAlign: 'center', color: '#94A3B8', fontSize: 12, padding: 20 }}>Scoring candidates against this JD…</div>}
          {!loading && items.length === 0 && <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 12, padding: 20, fontStyle: 'italic' }}>No matching candidates found</div>}
          {items.map((c: any) => {
            const isIn = alreadyIn.has(c.candidate_id);
            const isSelected = selected.has(c.candidate_id);
            return (
              <label key={c.candidate_id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 8px', borderRadius: 10, cursor: isIn ? 'default' : 'pointer', background: isSelected ? '#EFF6FF' : 'transparent', opacity: isIn ? 0.55 : 1, marginBottom: 2 }}>
                <input type="checkbox" checked={isSelected} disabled={isIn} onChange={() => toggle(c.candidate_id)} style={{ marginTop: 3 }} />
                <div style={{ width: 40, height: 40, borderRadius: '50%', border: `2px solid ${scoreColor(c.fit_score)}`, background: scoreBg(c.fit_score), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900, color: scoreColor(c.fit_score), flexShrink: 0 }}>
                  {Math.round(c.fit_score)}%
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1E293B' }}>{c.full_name}</span>
                    {isIn && (
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: '#F1F5F9', color: '#64748B' }}>already in pipeline</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>
                    {[c.current_designation, c.current_employer].filter(Boolean).join(' @ ') || '—'}
                    {c.total_exp_mo > 0 && ` · ${gx(c.total_exp_mo)} exp`}
                    {c.location && ` · ${c.location}`}
                  </div>
                  {c.skills?.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                      {c.skills.slice(0, 5).map((sk: string) => (
                        <span key={sk} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>{sk}</span>
                      ))}
                      {c.skills.length > 5 && <span style={{ fontSize: 9, color: '#94A3B8', padding: '2px 4px' }}>+{c.skills.length - 5}</span>}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#94A3B8' }}>{selected.size} selected</span>
          <button onClick={submit} disabled={selected.size === 0 || saving}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: selected.size === 0 || saving ? '#94A3B8' : '#2563EB', color: '#fff', fontSize: 12, fontWeight: 700, cursor: selected.size === 0 || saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Adding…' : `Add to ${stages?.find((s: any) => s.key === targetStage)?.label || 'Pipeline'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function InfoRow({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', marginBottom: 8 }}>
      {icon && <span style={{ color: '#94A3B8', display: 'flex', flexShrink: 0 }}>{icon}</span>}
      {label}
    </div>
  );
}

// ── Export with Suspense wrapper ──────────────────────────────────────────────
export default function PipelinePage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#64748B', fontSize: 13 }}>
        Loading pipeline…
      </div>
    }>
      <PipelineInner />
    </Suspense>
  );
}
