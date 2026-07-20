'use client';
import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import {
  Search, Plus, X, RotateCcw, ChevronDown, MapPin, Users, Briefcase,
  Clock, CheckCircle, AlertTriangle, Send, Star, MessageSquare,
  Activity, Download, ExternalLink, ArrowRight, Inbox, LayoutGrid,
  KanbanSquare, Mail, Phone, IndianRupee, FileText, RefreshCw, Calendar,
} from 'lucide-react';

// ── Stage config ──────────────────────────────────────────────────────────────
const STAGES = [
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
  const { toast, show: showToast } = useToast();
  const dragRef = useRef<{ id: string; fromStage: string } | null>(null);

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

  const moveStage = useCallback(async (appId: string, fromStage: string, toStage: string) => {
    if (fromStage === toStage) return;
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
      await apiFetch(`/applications/${appId}/stage`, { method: 'PATCH', body: JSON.stringify({ stage: toStage, send_email: false }) });
      showToast(`Moved to ${STAGES.find(s => s.key === toStage)?.label || toStage}`);
      refreshStats();
    } catch (e: any) {
      showToast(String(e?.message || 'Move failed'), false);
      if (rawBoard) setBoard(rawBoard);
    }
  }, [rawBoard, selected, showToast, refreshStats]);

  const filteredApps = useCallback((apps: any[]) => {
    if (!candSearch.trim()) return apps;
    const q = candSearch.toLowerCase();
    return apps.filter(a =>
      a.candidate_name?.toLowerCase().includes(q) ||
      a.current_designation?.toLowerCase().includes(q) ||
      a.skills?.some((s: string) => s.toLowerCase().includes(q))
    );
  }, [candSearch]);

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
                  <div style={{ maxHeight: 340, overflowY: 'auto' }}>
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
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
                  onDrop={e => { e.preventDefault(); if (!dragRef.current) return; const { id, fromStage } = dragRef.current; dragRef.current = null; moveStage(id, fromStage, stage.key); }}>

                  {/* Column header */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#fff', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', flex: 1 }}>{stage.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: stage.light, color: stage.color }}>{total}</span>
                  </div>

                  {/* Column body */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 90, maxHeight: 'calc(100vh - 262px)' }}>
                    {apps.map(app => (
                      <KanbanCard key={app.id} app={app} stageColor={stage.color}
                        onClick={() => { setSelected(app); setDrawerTab('profile'); }}
                        onNotesClick={() => { setSelected(app); setDrawerTab('notes'); }}
                        onDragStart={(e: React.DragEvent) => { dragRef.current = { id: app.id, fromStage: stage.key }; e.dataTransfer.effectAllowed = 'move'; }} />
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
          onMoveStage={(toStage: string) => moveStage(selected.id, selected.stage, toStage)}
          drawerTab={drawerTab} setDrawerTab={setDrawerTab} showToast={showToast} />
      )}

      {/* ── ADD CANDIDATE MODAL ─────────────────────────────────────────── */}
      {addCandidateOpen && selectedJobId && (
        <AddCandidateModal jobId={selectedJobId} board={board}
          onClose={() => setAddCandidateOpen(false)}
          onAdded={() => { setAddCandidateOpen(false); refreshBoard(); refreshStats(); showToast('Candidate(s) added to pipeline'); }} />
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
function KanbanCard({ app, stageColor, onClick, onNotesClick, onDragStart }: any) {
  const score = app.fit_score ?? app.jd_match_score ?? app.ai_match_score;
  const skills: string[] = app.skills || [];
  const notesCount = Array.isArray(app.app_notes) ? app.app_notes.length : 0;
  const [hovered, setHovered] = useState(false);
  return (
    <div draggable onDragStart={onDragStart} onClick={onClick}
      style={{ background: '#fff', border: '1px solid #EDF0F4', borderRadius: 10, padding: '11px 12px 9px', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s', position: 'relative', userSelect: 'none' }}
      onMouseEnter={e => { setHovered(true); (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 20px rgba(15,23,42,0.09)'; }}
      onMouseLeave={e => { setHovered(false); (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: stageColor, borderRadius: '10px 0 0 10px' }} />
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
        {score != null && (
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
function CandidateDrawer({ app, onClose, onMoveStage, drawerTab, setDrawerTab, showToast }: any) {
  const stageCfg = STAGES.find(s => s.key === app.stage);
  const score = app.fit_score ?? app.jd_match_score ?? app.ai_match_score;
  const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

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
              {STAGES.filter(s => s.key !== 'rejected' && s.key !== 'hold').map(s => (
                <button key={s.key} onClick={() => onMoveStage(s.key)}
                  style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${s.color}40`, background: app.stage === s.key ? s.color : `${s.color}15`, color: app.stage === s.key ? '#fff' : s.color, transition: 'all 0.15s' }}>
                  {s.label}
                </button>
              ))}
              <button onClick={() => onMoveStage('hold')} style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid #CBD5E140', background: app.stage === 'hold' ? '#94A3B8' : '#F8FAFC', color: app.stage === 'hold' ? '#fff' : '#94A3B8' }}>Hold</button>
              <button onClick={() => onMoveStage('rejected')} style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid #FCA5A440', background: app.stage === 'rejected' ? '#DC2626' : '#FEF2F2', color: app.stage === 'rejected' ? '#fff' : '#DC2626' }}>Reject</button>
            </div>
          </div>

          {/* Drawer tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
            {[
              { key: 'profile', icon: <Briefcase size={12} />, label: 'Profile' },
              { key: 'notes', icon: <MessageSquare size={12} />, label: 'Notes', count: Array.isArray(app.app_notes) ? app.app_notes.length : 0 },
              { key: 'scorecards', icon: <Star size={12} />, label: 'Scorecards' },
              { key: 'activity', icon: <Activity size={12} />, label: 'Activity' },
            ].map(t => (
              <button key={t.key} onClick={() => setDrawerTab(t.key)}
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
          {drawerTab === 'notes' && <NotesTab appId={app.id} showToast={showToast} />}
          {drawerTab === 'scorecards' && <ScorecardsTab appId={app.id} showToast={showToast} />}
          {drawerTab === 'activity' && <ActivityTab candidateId={app.candidate_id} />}
        </div>
      </div>
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab({ app, apiUrl }: any) {
  const skills: string[] = app.skills || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <InfoCard title="Contact Info">
        {app.email && <InfoRow icon={<Mail size={12} />} label={app.email} />}
        {app.phone && <InfoRow icon={<Phone size={12} />} label={app.phone} />}
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
      {[{ label: 'JD Match Score', val: app.jd_match_score }, { label: 'AI Match Score', val: app.ai_match_score }, { label: 'Fit Score', val: app.fit_score }].filter(r => r.val != null).length > 0 && (
        <InfoCard title="AI Assessment">
          {[{ label: 'JD Match Score', val: app.jd_match_score }, { label: 'AI Match Score', val: app.ai_match_score }, { label: 'Fit Score', val: app.fit_score }].filter(r => r.val != null).map(r => (
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
      {app.resume_path && (
        <a href={`${apiUrl}${app.resume_path}`} target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 10, textDecoration: 'none', color: '#15803D', fontSize: 12, fontWeight: 700 }}>
          <Download size={13} /> Download Resume
        </a>
      )}
      <a href={`/candidates/${app.candidate_id}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', background: '#1E40AF', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 12, fontWeight: 700, width: 'fit-content' }}>
        <ExternalLink size={12} /> Full ATS Profile
      </a>
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
function AddCandidateModal({ jobId, board, onClose, onAdded }: any) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const { data: matches, loading } = useFetch<any[]>(`/requisitions/${jobId}/match-candidates?limit=50`);

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
        body: JSON.stringify({ candidate_ids: Array.from(selected), requisition_id: jobId }),
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
            {saving ? 'Adding…' : `Add to Pipeline`}
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
