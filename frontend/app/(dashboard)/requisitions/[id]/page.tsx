'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useFetch, apiFetch } from '@/lib/useFetch';
import {
  ArrowLeft, MapPin, Users, Clock, Briefcase, Edit, BarChart2,
  Plus, X, ChevronDown, Mail, Phone, Download, ExternalLink,
  Star, MessageSquare, FileText, Activity, Search, SlidersHorizontal,
  RotateCcw, CheckCircle, AlertTriangle, Send
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

// ── Toast ─────────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const show = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);
  return { toast, show };
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RequisitionPipelinePage() {
  const params = useParams();
  const router = useRouter();
  const reqId = params?.id as string;

  const { data: req } = useFetch<any>(`/requisitions/${reqId}`);
  const { data: rawBoard, refresh: refreshBoard } = useFetch<Record<string, any[]>>(`/requisitions/${reqId}/pipeline`);
  const { data: stats, refresh: refreshStats } = useFetch<any>(`/requisitions/${reqId}/pipeline-stats`);

  const [board, setBoard] = useState<Record<string, any[]>>({});
  const [selected, setSelected] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState('candidates');
  const [search, setSearch] = useState('');
  const [drawerTab, setDrawerTab] = useState('profile');
  const { toast, show: showToast } = useToast();
  const dragRef = useRef<{ id: string; fromStage: string } | null>(null);

  // Sync board from fetch
  useEffect(() => {
    if (rawBoard) setBoard(rawBoard);
  }, [rawBoard]);

  // ── Stage move ──────────────────────────────────────────────────────────────
  const moveStage = useCallback(async (appId: string, fromStage: string, toStage: string, sendEmail = false) => {
    if (fromStage === toStage) return;

    // Optimistic update
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
      await apiFetch(`/applications/${appId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: toStage, send_email: sendEmail }),
      });
      showToast(`Moved to ${STAGES.find(s => s.key === toStage)?.label || toStage}`);
      refreshStats();
    } catch (e: any) {
      showToast(String(e?.message || 'Move failed'), false);
      if (rawBoard) setBoard(rawBoard);
    }
  }, [rawBoard, selected, showToast, refreshStats]);

  // ── Drag & drop ─────────────────────────────────────────────────────────────
  function onDragStart(e: React.DragEvent, appId: string, fromStage: string) {
    dragRef.current = { id: appId, fromStage };
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDrop(e: React.DragEvent, toStage: string) {
    e.preventDefault();
    if (!dragRef.current) return;
    const { id, fromStage } = dragRef.current;
    dragRef.current = null;
    moveStage(id, fromStage, toStage);
  }

  // ── Search filter ────────────────────────────────────────────────────────────
  const filteredBoard = useCallback((apps: any[]) => {
    if (!search.trim()) return apps;
    const q = search.toLowerCase();
    return apps.filter(a =>
      a.candidate_name?.toLowerCase().includes(q) ||
      a.current_designation?.toLowerCase().includes(q) ||
      a.current_employer?.toLowerCase().includes(q) ||
      a.skills?.some((s: string) => s.toLowerCase().includes(q))
    );
  }, [search]);

  const totalCandidates = Object.values(board).reduce((sum, arr) => sum + (arr?.length || 0), 0);

  if (!req) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: '#64748B', fontSize: 13 }}>
      Loading pipeline…
    </div>
  );

  const stageConfig = STAGES.find(s => s.key === req.status) || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#F1F5F9' }}>

      {/* ── JOB HEADER ─────────────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E3A8A 60%, #1E40AF 100%)', flexShrink: 0 }}>
        <div style={{ padding: '14px 20px 0' }}>

          {/* Back + title row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
            <button onClick={() => router.push('/requisitions')}
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 12px', color: '#CBD5E1', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', marginTop: 2 }}>
              <ArrowLeft size={13} /> Jobs
            </button>

            {/* Client logo */}
            <div style={{ width: 48, height: 48, borderRadius: 10, background: 'linear-gradient(135deg,#F97316,#EF4444)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, color: '#fff', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
              {req.client_name?.[0] || 'J'}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>{req.title}</h1>
                {req.employment_type && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(139,92,246,0.25)', color: '#C4B5FD', border: '1px solid rgba(139,92,246,0.35)' }}>
                    {req.employment_type.replace('_', ' ')}
                  </span>
                )}
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: req.status === 'open' ? 'rgba(34,197,94,0.25)' : 'rgba(148,163,184,0.25)', color: req.status === 'open' ? '#86EFAC' : '#CBD5E1', border: '1px solid rgba(34,197,94,0.35)' }}>
                  ● {(req.status || 'open').toUpperCase()}
                </span>
                {req.priority === 'high' && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(239,68,68,0.25)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.35)' }}>
                    🔴 Urgent
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px' }}>
                {req.client_name && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 4 }}><Briefcase size={11} />{req.client_name}</span>}
                {req.location && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} />{req.location}</span>}
                {(req.experience_min != null) && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} />{req.experience_min}–{req.experience_max ?? '?'} yrs</span>}
                {req.positions_count && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', gap: 4 }}><Users size={11} />{req.positions_count} position{req.positions_count > 1 ? 's' : ''}</span>}
              </div>
            </div>

            {/* KPI cards */}
            <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
              {[
                { label: 'Placed', val: stats?.placed ?? 0, bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.3)', num: '#86EFAC' },
                { label: 'In Pipeline', val: stats?.in_pipeline ?? 0, bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.3)', num: '#C4B5FD' },
                { label: 'Dropped', val: stats?.dropped ?? 0, bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.25)', num: '#94A3B8' },
              ].map(k => (
                <div key={k.label} style={{ textAlign: 'center', padding: '8px 16px', borderRadius: 10, background: k.bg, border: `1px solid ${k.border}`, minWidth: 72 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: k.num, lineHeight: 1 }}>{k.val}</div>
                  <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{k.label}</div>
                </div>
              ))}
              <button onClick={() => router.push(`/requisitions?edit=${reqId}`)}
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '0 12px', color: '#CBD5E1', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Edit size={12} /> Edit
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, overflow: 'hidden' }}>
            {['candidates', 'summary', 'scorecards', 'activities'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{ padding: '9px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', color: activeTab === tab ? '#fff' : 'rgba(255,255,255,0.55)', borderBottom: `2px solid ${activeTab === tab ? '#60A5FA' : 'transparent'}`, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                {tab === 'candidates' && <span style={{ background: activeTab === tab ? '#2563EB' : 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999 }}>{totalCandidates}</span>}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── TOOLBAR ───────────────────────────────────────────────────────── */}
      {activeTab === 'candidates' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fff', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '5px 10px', flex: 1, maxWidth: 280 }}>
            <Search size={13} color="#94A3B8" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search candidates, skills…"
              style={{ border: 'none', background: 'none', outline: 'none', fontSize: 12, color: '#374151', width: '100%' }} />
            {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0 }}><X size={12} /></button>}
          </div>
          <button style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}>
            <SlidersHorizontal size={13} /> Filter
          </button>
          <button onClick={refreshBoard} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid #E2E8F0', borderRadius: 8, background: '#fff', fontSize: 12, fontWeight: 600, color: '#64748B', cursor: 'pointer' }}>
            <RotateCcw size={13} /> Refresh
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => router.push(`/resume-inbox?req=${reqId}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', border: '1px solid #DDD6FE', borderRadius: 8, background: '#FAF5FF', fontSize: 12, fontWeight: 700, color: '#7C3AED', cursor: 'pointer' }}>
              📬 Inbox Matches
            </button>
            <button style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', border: 'none', borderRadius: 8, background: '#2563EB', fontSize: 12, fontWeight: 700, color: '#fff', cursor: 'pointer' }}>
              <Plus size={13} /> Add Candidate
            </button>
          </div>
        </div>
      )}

      {/* ── KANBAN BOARD ──────────────────────────────────────────────────── */}
      {activeTab === 'candidates' && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '14px 16px', display: 'flex', gap: 12 }}
            onDragOver={onDragOver}>
            {STAGES.map(stage => {
              const apps = filteredBoard(board[stage.key] || []);
              const total = (board[stage.key] || []).length;
              return (
                <div key={stage.key} style={{ flexShrink: 0, width: 242, display: 'flex', flexDirection: 'column' }}
                  onDragOver={onDragOver} onDrop={e => onDrop(e, stage.key)}>

                  {/* Column header */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', background: '#fff', border: '1px solid #E2E8F0', borderBottom: 'none', borderRadius: '10px 10px 0 0' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, marginRight: 7, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#1E293B', flex: 1 }}>{stage.label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: stage.light, color: stage.color, border: `1px solid ${stage.color}30`, marginRight: 5 }}>{total}</span>
                    <Plus size={13} color="#94A3B8" style={{ cursor: 'pointer' }} />
                  </div>

                  {/* Column body */}
                  <div style={{ flex: 1, overflowY: 'auto', border: `1px solid ${stage.color}`, borderTop: `2px solid ${stage.color}`, background: '#F8FAFC', borderRadius: '0 0 10px 10px', padding: 7, display: 'flex', flexDirection: 'column', gap: 7, minHeight: 80, maxHeight: 'calc(100vh - 310px)' }}>
                    {apps.map(app => (
                      <CandidateCard key={app.id} app={app} stageColor={stage.color}
                        onClick={() => { setSelected(app); setDrawerTab('profile'); }}
                        onDragStart={e => onDragStart(e, app.id, stage.key)}
                        onMoveStage={(toStage: string) => moveStage(app.id, stage.key, toStage)} />
                    ))}
                    {apps.length === 0 && (
                      <div style={{ textAlign: 'center', color: '#CBD5E1', fontSize: 11, padding: '20px 8px', fontStyle: 'italic' }}>
                        Drop candidates here
                      </div>
                    )}
                  </div>

                  {/* Column footer */}
                  <div style={{ padding: '5px 10px', fontSize: 10, fontWeight: 600, color: '#94A3B8', background: '#fff', border: '1px solid #E2E8F0', borderTop: 'none', borderRadius: '0 0 10px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#CBD5E1' }} />
                    {total} total
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SUMMARY TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 800 }}>
          <SummaryTab req={req} stats={stats} board={board} />
        </div>
      )}

      {/* ── SCORECARDS TAB ────────────────────────────────────────────────── */}
      {activeTab === 'scorecards' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 900 }}>
          <ScorecardsTab reqId={reqId} board={board} />
        </div>
      )}

      {/* ── ACTIVITIES TAB ────────────────────────────────────────────────── */}
      {activeTab === 'activities' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 800 }}>
          <ActivitiesTab reqId={reqId} board={board} />
        </div>
      )}

      {/* ── CANDIDATE DRAWER ──────────────────────────────────────────────── */}
      {selected && (
        <CandidateDrawer
          app={selected}
          onClose={() => setSelected(null)}
          onMoveStage={(toStage: string) => moveStage(selected.id, selected.stage, toStage)}
          drawerTab={drawerTab}
          setDrawerTab={setDrawerTab}
          showToast={showToast}
        />
      )}

      {/* ── TOAST ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: toast.ok ? '#1E293B' : '#DC2626', color: '#fff', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {toast.ok ? <CheckCircle size={14} /> : <AlertTriangle size={14} />} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Candidate Card ────────────────────────────────────────────────────────────
function CandidateCard({ app, stageColor, onClick, onDragStart, onMoveStage }: any) {
  const score = app.jd_match_score ?? app.fit_score ?? app.ai_match_score;
  const skills: string[] = app.skills || [];

  return (
    <div draggable onDragStart={onDragStart} onClick={onClick}
      style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 10px 8px', cursor: 'pointer', transition: 'all 0.15s', position: 'relative', userSelect: 'none' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#93C5FD'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(37,99,235,0.12)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>

      {/* Left accent bar */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: stageColor, borderRadius: '10px 0 0 10px', opacity: 0.7 }} />

      {/* Top row: avatar + name + score */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: `linear-gradient(135deg, ${avatarColor(app.candidate_name)}, ${avatarColor(app.candidate_name)}aa)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
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

      {/* Skills */}
      {skills.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 7 }}>
          {skills.slice(0, 3).map((sk: string) => (
            <span key={sk} style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>{sk}</span>
          ))}
          {skills.length > 3 && <span style={{ fontSize: 9, color: '#94A3B8', padding: '2px 4px' }}>+{skills.length - 3}</span>}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {app.total_exp_mo > 0 && <span style={{ fontSize: 9, color: '#94A3B8', background: '#F8FAFC', padding: '2px 5px', borderRadius: 4 }}>⏱ {gx(app.total_exp_mo)}</span>}
        <span style={{ fontSize: 9, color: '#CBD5E1' }}>{ago(app.updated_at)}</span>
        {app.scorecard_count > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE' }}>S×{app.scorecard_count}</span>
        )}
      </div>
    </div>
  );
}

// ── Candidate Drawer ──────────────────────────────────────────────────────────
function CandidateDrawer({ app, onClose, onMoveStage, drawerTab, setDrawerTab, showToast }: any) {
  const stageCfg = STAGES.find(s => s.key === app.stage);
  const score = app.jd_match_score ?? app.fit_score ?? app.ai_match_score;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ width: 500, maxWidth: '96vw', height: '100%', background: '#fff', boxShadow: '-6px 0 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Drawer header */}
        <div style={{ padding: '16px 18px 0', borderBottom: '1px solid #F1F5F9', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg,${avatarColor(app.candidate_name)},${avatarColor(app.candidate_name)}99)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff' }}>
                  {initials(app.candidate_name)}
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1E293B' }}>{app.candidate_name}</div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>{[app.current_designation, app.current_employer].filter(Boolean).join(' @ ')}</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {score != null && (
                <div style={{ textAlign: 'center', padding: '4px 10px', borderRadius: 8, background: scoreBg(score), border: `1px solid ${scoreColor(score)}30` }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: scoreColor(score), lineHeight: 1 }}>{Math.round(score)}%</div>
                  <div style={{ fontSize: 9, color: '#94A3B8', fontWeight: 600 }}>AI MATCH</div>
                </div>
              )}
              <button onClick={onClose} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#94A3B8', fontSize: 16 }}>✕</button>
            </div>
          </div>

          {/* Current stage + move buttons */}
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
              <button onClick={() => onMoveStage('hold')}
                style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid #CBD5E140', background: app.stage === 'hold' ? '#94A3B8' : '#F8FAFC', color: app.stage === 'hold' ? '#fff' : '#94A3B8' }}>
                Hold
              </button>
              <button onClick={() => onMoveStage('rejected')}
                style={{ fontSize: 10, fontWeight: 700, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid #FCA5A440', background: app.stage === 'rejected' ? '#DC2626' : '#FEF2F2', color: app.stage === 'rejected' ? '#fff' : '#DC2626' }}>
                Reject
              </button>
            </div>
          </div>

          {/* Drawer tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
            {[
              { key: 'profile', icon: <Briefcase size={12} />, label: 'Profile' },
              { key: 'notes', icon: <MessageSquare size={12} />, label: 'Notes' },
              { key: 'scorecards', icon: <Star size={12} />, label: 'Scorecards' },
              { key: 'activity', icon: <Activity size={12} />, label: 'Activity' },
            ].map(t => (
              <button key={t.key} onClick={() => setDrawerTab(t.key)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', borderBottom: `2px solid ${drawerTab === t.key ? '#2563EB' : 'transparent'}`, color: drawerTab === t.key ? '#2563EB' : '#64748B' }}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Drawer body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {drawerTab === 'profile' && <ProfileTab app={app} />}
          {drawerTab === 'notes' && <NotesTab appId={app.id} showToast={showToast} />}
          {drawerTab === 'scorecards' && <AppScorecardsTab appId={app.id} showToast={showToast} />}
          {drawerTab === 'activity' && <ActivityTab candidateId={app.candidate_id} />}
        </div>
      </div>
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab({ app }: any) {
  const skills: string[] = app.skills || [];
  const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Contact */}
      <Card title="Contact Info">
        {app.email && <Row icon={<Mail size={13} color="#6366F1" />} label={app.email} />}
        {app.phone && <Row icon={<Phone size={13} color="#059669" />} label={app.phone} />}
        {app.location && <Row icon={<MapPin size={13} color="#F59E0B" />} label={app.location} />}
        {app.total_exp_mo > 0 && <Row icon={<Briefcase size={13} color="#0891B2" />} label={`${gx(app.total_exp_mo)} experience`} />}
        {app.notice_period_days != null && <Row icon={<Clock size={13} color="#64748B" />} label={`${app.notice_period_days}d notice period`} />}
      </Card>

      {/* CTC */}
      {(app.expected_ctc || app.current_ctc) && (
        <Card title="Compensation">
          {app.expected_ctc && <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}><b>Expected:</b> ₹{(app.expected_ctc / 100000).toFixed(1)}L</div>}
        </Card>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <Card title={`Skills (${skills.length})`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {skills.map((sk: string) => (
              <span key={sk} style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>{sk}</span>
            ))}
          </div>
        </Card>
      )}

      {/* AI Scores */}
      <Card title="AI Assessment">
        {[
          { label: 'JD Match Score', val: app.jd_match_score },
          { label: 'AI Match Score', val: app.ai_match_score },
          { label: 'Fit Score', val: app.fit_score },
        ].filter(r => r.val != null).map(r => (
          <div key={r.label} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: '#64748B' }}>{r.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(r.val) }}>{Math.round(r.val)}%</span>
            </div>
            <div style={{ height: 5, background: '#E2E8F0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(r.val, 100)}%`, background: scoreColor(r.val), borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </Card>

      {/* Resume */}
      {app.resume_path && (
        <Card title="Resume">
          <a href={`${API_URL}${app.resume_path}`} target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, textDecoration: 'none', color: '#15803D', fontSize: 12, fontWeight: 700 }}>
            <Download size={13} /> Download Resume
          </a>
        </Card>
      )}

      {/* Links */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a href={`/candidates/${app.candidate_id}`}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', background: '#1E40AF', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>
          <ExternalLink size={12} /> Full ATS Profile
        </a>
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

  useEffect(() => {
    setLoading(true);
    apiFetch(`/applications/${appId}/notes`).then(data => {
      setNotes(Array.isArray(data) ? data : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [appId]);

  async function addNote() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      const note = await apiFetch(`/applications/${appId}/notes`, { method: 'POST', body: JSON.stringify({ note: text }) });
      setNotes(prev => [note, ...prev]);
      setText('');
      showToast('Note added');
    } catch (e: any) {
      showToast(String(e?.message || 'Failed'), false);
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Add a note about this candidate…"
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, resize: 'vertical', minHeight: 80, outline: 'none', fontFamily: 'inherit', color: '#374151' }} />
        <button onClick={addNote} disabled={!text.trim() || saving}
          style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: text.trim() && !saving ? 'pointer' : 'not-allowed', opacity: text.trim() && !saving ? 1 : 0.5 }}>
          <Send size={12} /> {saving ? 'Saving…' : 'Add Note'}
        </button>
      </div>
      {loading && <div style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', padding: 20 }}>Loading notes…</div>}
      {!loading && notes.length === 0 && <div style={{ color: '#CBD5E1', fontSize: 12, textAlign: 'center', padding: 20, fontStyle: 'italic' }}>No notes yet</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {notes.map((n: any) => (
          <div key={n.id} style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 5 }}>{n.text}</div>
            <div style={{ fontSize: 10, color: '#94A3B8' }}>{n.author || 'Recruiter'} · {ago(n.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Scorecards Tab ────────────────────────────────────────────────────────────
function AppScorecardsTab({ appId, showToast }: any) {
  const { data: scorecards, refresh } = useFetch<any[]>(`/interview-scorecards?application_id=${appId}`);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ round: 'L1', overall_rating: '', recommendation: 'yes', notes: '' });
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await apiFetch('/interview-scorecards', { method: 'POST', body: JSON.stringify({ application_id: appId, round: form.round, overall_rating: form.overall_rating ? parseFloat(form.overall_rating) : null, recommendation: form.recommendation, notes: form.notes, scores: {} }) });
      setAdding(false);
      setForm({ round: 'L1', overall_rating: '', recommendation: 'yes', notes: '' });
      refresh();
      showToast('Scorecard added');
    } catch (e: any) {
      showToast(String(e?.message || 'Failed'), false);
    } finally { setSaving(false); }
  }

  const RECO_COLORS: Record<string, string> = { strong_yes: '#16A34A', yes: '#059669', neutral: '#F59E0B', no: '#DC2626', strong_no: '#7F1D1D' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>{scorecards?.length || 0} scorecard(s)</span>
        <button onClick={() => setAdding(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={12} /> Add Scorecard
        </button>
      </div>

      {adding && (
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 }}>ROUND</label>
              <select value={form.round} onChange={e => setForm(f => ({ ...f, round: e.target.value }))}
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 }}>
                {['L1','L2','HR','Technical','Final'].map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 }}>RATING (1–5)</label>
              <input type="number" min="1" max="5" step="0.5" value={form.overall_rating} onChange={e => setForm(f => ({ ...f, overall_rating: e.target.value }))}
                placeholder="e.g. 4.5"
                style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 }} />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 }}>RECOMMENDATION</label>
            <select value={form.recommendation} onChange={e => setForm(f => ({ ...f, recommendation: e.target.value }))}
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12 }}>
              {['strong_yes','yes','neutral','no','strong_no'].map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 }}>NOTES</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Interview observations…"
              style={{ width: '100%', padding: '6px 8px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 12, resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submit} disabled={saving}
              style={{ padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save Scorecard'}
            </button>
            <button onClick={() => setAdding(false)}
              style={{ padding: '7px 12px', background: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
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
                  <span style={{ background: '#FFFBEB', color: '#CA8A04', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, border: '1px solid #FDE68A' }}>⭐ {sc.overall_rating}/5</span>
                )}
              </div>
              {sc.recommendation && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: (RECO_COLORS[sc.recommendation] || '#94A3B8') + '20', color: RECO_COLORS[sc.recommendation] || '#94A3B8', border: `1px solid ${(RECO_COLORS[sc.recommendation] || '#94A3B8')}40` }}>
                  {sc.recommendation.replace('_', ' ')}
                </span>
              )}
            </div>
            {sc.notes && <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 4 }}>{sc.notes}</div>}
            <div style={{ fontSize: 10, color: '#94A3B8' }}>{ago(sc.created_at)}</div>
          </div>
        ))}
        {(!scorecards || scorecards.length === 0) && !adding && (
          <div style={{ color: '#CBD5E1', fontSize: 12, textAlign: 'center', padding: 20, fontStyle: 'italic' }}>No scorecards yet</div>
        )}
      </div>
    </div>
  );
}

// ── Activity Tab ──────────────────────────────────────────────────────────────
function ActivityTab({ candidateId }: any) {
  const { data: activities } = useFetch<any[]>(`/activities/${candidateId}`);
  const ACT_COLORS: Record<string, string> = {
    note: '#F59E0B', email_sent: '#2563EB', status_change: '#7C3AED',
    interview_scheduled: '#059669', offer_made: '#CA8A04', call_logged: '#0891B2',
    whatsapp_sent: '#16A34A',
  };
  return (
    <div>
      {(!activities || activities.length === 0) && (
        <div style={{ color: '#CBD5E1', fontSize: 12, textAlign: 'center', padding: 30, fontStyle: 'italic' }}>No activities recorded</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {(activities || []).map((act: any, i: number) => (
          <div key={act.id} style={{ display: 'flex', gap: 10, paddingBottom: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: (ACT_COLORS[act.activity_type] || '#94A3B8') + '20', border: `2px solid ${ACT_COLORS[act.activity_type] || '#94A3B8'}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0 }}>
                {act.activity_type === 'note' ? '📝' : act.activity_type === 'email_sent' ? '📧' : act.activity_type === 'status_change' ? '🔄' : act.activity_type === 'interview_scheduled' ? '📅' : '●'}
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

// ── Summary Tab ───────────────────────────────────────────────────────────────
function SummaryTab({ req, stats, board }: any) {
  const stageBreakdown = STAGES.map(s => ({ ...s, count: (board[s.key] || []).length })).filter(s => s.count > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card title="Job Details">
        {req.description && <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{req.description}</div>}
      </Card>
      <Card title="Pipeline Breakdown">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {stageBreakdown.map(s => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#374151', minWidth: 120 }}>{s.label}</span>
              <div style={{ flex: 1, height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, s.count * 10)}%`, background: s.color, borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.color, minWidth: 24, textAlign: 'right' }}>{s.count}</span>
            </div>
          ))}
        </div>
      </Card>
      {req.skills_required?.length > 0 && (
        <Card title="Required Skills">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {req.skills_required.map((sk: string) => (
              <span key={sk} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>{sk}</span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Scorecards overview tab ───────────────────────────────────────────────────
function ScorecardsTab({ reqId, board }: any) {
  const { data } = useFetch<any[]>(`/interview-scorecards`);
  const allAppIds = new Set(Object.values(board).flat().map((a: any) => a.id));
  const relevant = (data || []).filter(sc => allAppIds.has(sc.application_id));
  const appMap = Object.fromEntries(Object.values(board).flat().map((a: any) => [a.id, a]));
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#64748B', marginBottom: 16 }}>{relevant.length} scorecard(s) across {new Set(relevant.map(s => s.application_id)).size} candidates</div>
      {relevant.map((sc: any) => {
        const app = appMap[sc.application_id];
        return (
          <div key={sc.id} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 16px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>{app?.candidate_name || 'Unknown'}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: '#EFF6FF', color: '#2563EB' }}>{sc.round}</span>
                {sc.overall_rating && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: '#FFFBEB', color: '#CA8A04' }}>⭐ {sc.overall_rating}/5</span>}
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#64748B' }}>{app?.current_designation} @ {app?.current_employer}</div>
            {sc.notes && <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>{sc.notes}</div>}
          </div>
        );
      })}
      {relevant.length === 0 && <div style={{ color: '#CBD5E1', fontSize: 13, textAlign: 'center', padding: 40, fontStyle: 'italic' }}>No scorecards yet for this job</div>}
    </div>
  );
}

// ── Activities overview tab ───────────────────────────────────────────────────
function ActivitiesTab({ reqId, board }: any) {
  return (
    <div style={{ color: '#94A3B8', textAlign: 'center', padding: 40, fontSize: 13 }}>
      Open individual candidate profiles to view their activity timeline.
    </div>
  );
}

// ── Shared UI components ──────────────────────────────────────────────────────
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', marginBottom: 6 }}>
      {icon}<span>{label}</span>
    </div>
  );
}
