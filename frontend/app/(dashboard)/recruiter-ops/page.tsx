'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import { Circle, ListChecks, Target, Flame, Plus, X, Clock, Sparkles, CalendarOff, Sun, AlertCircle, Video, Activity, Trophy, HeartPulse } from 'lucide-react';

const TABS = [
  { key: 'myday', label: 'My Day', icon: Sun },
  { key: 'activity', label: 'Activity', icon: Activity },
  { key: 'autoassign', label: 'Auto-Assign', icon: Sparkles },
  { key: 'leaderboard', label: 'Team Leaderboard', icon: Trophy },
  { key: 'risk', label: 'Risk & Wellbeing', icon: HeartPulse },
  { key: 'presence', label: 'Presence', icon: Circle },
  { key: 'sessions', label: 'Work Sessions', icon: Clock },
  { key: 'tasks', label: 'Tasks', icon: ListChecks },
  { key: 'targets', label: 'Targets', icon: Target },
  { key: 'hotlist', label: 'Hotlist', icon: Flame },
  { key: 'leave', label: 'Leave', icon: CalendarOff },
];

// Same hand-rolled CSS-bar chart already used on reports/page.tsx — kept
// as a local copy rather than a shared import, matching that file's own
// self-contained convention (no shared /components/charts module exists
// in this codebase yet).
function BarChart({ rows, keyX, keyY, color = '#2563EB' }: any) {
  if (!rows?.length) return <p style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: 20 }}>No data yet</p>;
  const max = Math.max(...rows.map((r: any) => Number(r[keyY]) || 0), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 100, padding: '0 4px', overflowX: 'auto' }}>
      {rows.map((r: any, i: number) => {
        const v = Number(r[keyY]) || 0;
        const h = Math.round((v / max) * 100);
        return (
          <div key={i} style={{ flex: '0 0 auto', minWidth: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>{v}</span>
            <div style={{ width: 20, background: color, borderRadius: '4px 4px 0 0', height: `${h}%`, minHeight: 4, transition: 'height 0.3s' }} />
            <span style={{ fontSize: 9, color: '#94A3B8' }}>{String(r[keyX]).slice(5, 10)}</span>
          </div>
        );
      })}
    </div>
  );
}

const GRADE_CFG: Record<string, { bg: string; color: string }> = {
  'A+': { bg: '#d1fae5', color: '#059669' },
  'A': { bg: '#d1fae5', color: '#10b981' },
  'B': { bg: '#dbeafe', color: '#3b82f6' },
  'C': { bg: '#fef3c7', color: '#f59e0b' },
  'D': { bg: '#fee2e2', color: '#ef4444' },
};

function GradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <span style={{ color: '#94A3B8', fontSize: 11 }}>—</span>;
  const cfg = GRADE_CFG[grade] || { bg: '#F1F5F9', color: '#64748B' };
  return <span style={{ background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6 }}>{grade}</span>;
}

// Today's real productivity counts + a 30-day trend, for the logged-in
// recruiter — reuses GET /recruiter/activity/today and /activity/trends
// (Workforce Intelligence, 2026-08-11). The daily rollup job runs at
// 02:30 IST for the *previous* day, so "today" itself is served live
// from recruiter_activity_events directly, not the aggregate table.
// recruiter_productivity_hourly/weekly (2026-08-11) were computed and
// never surfaced — this toggle reuses the same BarChart against whichever
// granularity's real rollup the recruiter picks, rather than a 3rd
// duplicated chart block.
const GRANULARITY_ENDPOINT: Record<string, string> = {
  hourly: '/recruiter/activity/hourly?hours=48',
  daily: '/recruiter/activity/trends?days=14',
  weekly: '/recruiter/activity/weekly?weeks=12',
};
function granLabel(g: string, iso: string) {
  if (g === 'hourly') return iso?.slice(11, 16);
  return iso?.slice(0, 10);
}

function ActivityTab() {
  const { data: today } = useFetch<any>('/recruiter/activity/today');
  const [gran, setGran] = useState<'hourly' | 'daily' | 'weekly'>('daily');
  const { data: trendData } = useFetch<any>(GRANULARITY_ENDPOINT[gran]);
  const { data: slaRows } = useFetch<any[]>('/recruiter/sla-tracking?days=30');
  const [slaBreachedOnly, setSlaBreachedOnly] = useState(false);
  const t = today?.today || {};
  const score = today?.score;
  const trends = (trendData?.trends || []).map((r: any) => ({ ...r, period_start: granLabel(gran, r.period_start) }));
  const slaFiltered = slaBreachedOnly ? (slaRows || []).filter((r: any) => r.breached === true || (!r.first_response_at && r.elapsed_hours > (r.sla_target_hours || 48))) : (slaRows || []);

  const stat = (label: string, value: any) => (
    <div style={{ ...card, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>{value ?? 0}</div>
      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
        {stat('Sourced', t.candidates_sourced)}
        {stat('Screened', t.candidates_screened)}
        {stat('Submitted', t.candidates_submitted)}
        {stat('Interviews', t.interviews_completed)}
        {stat('Offers', t.offers_generated)}
        {stat('Placed', t.placements)}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Today's performance score</div>
          <GradeBadge grade={score?.grade} />
        </div>
        {score ? (
          <div style={{ fontSize: 12, color: '#64748B' }}>
            Overall {Number(score.overall_score).toFixed(1)} / 100 — for {score.score_date}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#94A3B8' }}>No score computed yet — the daily job runs at 02:45 IST.</div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Candidates sourced — {gran}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['hourly', 'daily', 'weekly'] as const).map(g => (
              <button key={g} onClick={() => setGran(g)}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #E2E8F0', cursor: 'pointer',
                  background: gran === g ? '#0F172A' : 'white', color: gran === g ? 'white' : '#64748B', fontWeight: 600 }}>
                {g[0].toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <BarChart rows={trends} keyX="period_start" keyY="candidates_sourced" />
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Submissions — {gran}</div>
        <BarChart rows={trends} keyX="period_start" keyY="candidates_submitted" color="#10B981" />
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>First-response SLA — my sourced candidates (last 30 days)</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B', cursor: 'pointer' }}>
            <input type="checkbox" checked={slaBreachedOnly} onChange={e => setSlaBreachedOnly(e.target.checked)} />
            Breached only
          </label>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 10, textTransform: 'uppercase' }}>
                <th style={{ padding: '6px 8px' }}>Candidate</th>
                <th style={{ padding: '6px 8px' }}>Sourced</th>
                <th style={{ padding: '6px 8px' }}>First Response</th>
                <th style={{ padding: '6px 8px' }}>Target (hrs)</th>
                <th style={{ padding: '6px 8px' }}>Elapsed (hrs)</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {slaFiltered.map((r: any) => {
                const stillOpen = !r.first_response_at;
                const overdue = stillOpen && r.elapsed_hours > (r.sla_target_hours || 48);
                const breached = r.breached === true || overdue;
                return (
                  <tr key={r.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '8px' }}>{r.candidate_name}</td>
                    <td style={{ padding: '8px' }}>{new Date(r.sourced_at).toLocaleString()}</td>
                    <td style={{ padding: '8px' }}>{r.first_response_at ? new Date(r.first_response_at).toLocaleString() : (stillOpen ? '— still open' : '—')}</td>
                    <td style={{ padding: '8px' }}>{r.sla_target_hours}</td>
                    <td style={{ padding: '8px' }}>{Number(r.elapsed_hours).toFixed(1)}</td>
                    <td style={{ padding: '8px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        background: breached ? '#fef2f2' : (stillOpen ? '#fffbeb' : '#f0fdf4'),
                        color: breached ? '#dc2626' : (stillOpen ? '#b45309' : '#15803d') }}>
                        {breached ? 'Breached' : stillOpen ? 'Pending' : 'Met'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!slaFiltered.length && (
                <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: '#94A3B8' }}>No sourced candidates in this window.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Admin/manager only — same deferred-role-read pattern as TargetsTab's
// canManage, to avoid the SSR/hydration mismatch documented there.
function LeaderboardTab() {
  const [canView, setCanView] = useState(false);
  useEffect(() => {
    const role = getTokenPayload()?.role || '';
    setCanView(['admin', 'super_admin', 'manager'].includes(role));
  }, []);
  const { data: rows, loading } = useFetch<any[]>(canView ? '/manager/activity-leaderboard' : null);
  const [slaBreachedOnly, setSlaBreachedOnly] = useState(true);
  const { data: slaRows } = useFetch<any[]>(canView ? `/manager/sla-tracking?days=30&breached_only=${slaBreachedOnly}` : null);

  if (!canView) {
    return <div style={{ ...card, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>Team Leaderboard is visible to managers and admins.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Team activity leaderboard (today / this week)</div>
      {loading && <p style={{ fontSize: 12, color: '#94A3B8' }}>Loading…</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ padding: '6px 8px' }}>Recruiter</th>
              <th style={{ padding: '6px 8px' }}>Grade</th>
              <th style={{ padding: '6px 8px' }}>Score</th>
              <th style={{ padding: '6px 8px' }}>Sourced today</th>
              <th style={{ padding: '6px 8px' }}>Submitted today</th>
              <th style={{ padding: '6px 8px' }}>Sourced this week</th>
              <th style={{ padding: '6px 8px' }}>Placed this week</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r: any) => (
              <tr key={r.recruiter_id} style={{ borderTop: '1px solid #F1F5F9' }}>
                <td style={{ padding: '8px' }}>{r.full_name}</td>
                <td style={{ padding: '8px' }}><GradeBadge grade={r.grade} /></td>
                <td style={{ padding: '8px' }}>{r.overall_score != null ? Number(r.overall_score).toFixed(1) : '—'}</td>
                <td style={{ padding: '8px' }}>{r.today_sourced}</td>
                <td style={{ padding: '8px' }}>{r.today_submitted}</td>
                <td style={{ padding: '8px' }}>{r.week_sourced}</td>
                <td style={{ padding: '8px' }}>{r.week_placements}</td>
              </tr>
            ))}
            {!loading && !(rows || []).length && (
              <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: '#94A3B8' }}>No recruiters found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Team first-response SLA (last 30 days)</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748B', cursor: 'pointer' }}>
          <input type="checkbox" checked={slaBreachedOnly} onChange={e => setSlaBreachedOnly(e.target.checked)} />
          Breached / overdue only
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ padding: '6px 8px' }}>Recruiter</th>
              <th style={{ padding: '6px 8px' }}>Candidate</th>
              <th style={{ padding: '6px 8px' }}>Sourced</th>
              <th style={{ padding: '6px 8px' }}>Target (hrs)</th>
              <th style={{ padding: '6px 8px' }}>Elapsed (hrs)</th>
              <th style={{ padding: '6px 8px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(slaRows || []).map((r: any) => {
              const stillOpen = !r.first_response_at;
              const overdue = stillOpen && r.elapsed_hours > (r.sla_target_hours || 48);
              const breached = r.breached === true || overdue;
              return (
                <tr key={r.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '8px' }}>{r.recruiter_name}</td>
                  <td style={{ padding: '8px' }}>{r.candidate_name}</td>
                  <td style={{ padding: '8px' }}>{new Date(r.sourced_at).toLocaleString()}</td>
                  <td style={{ padding: '8px' }}>{r.sla_target_hours}</td>
                  <td style={{ padding: '8px' }}>{Number(r.elapsed_hours).toFixed(1)}</td>
                  <td style={{ padding: '8px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: breached ? '#fef2f2' : (stillOpen ? '#fffbeb' : '#f0fdf4'),
                      color: breached ? '#dc2626' : (stillOpen ? '#b45309' : '#15803d') }}>
                      {breached ? 'Breached' : stillOpen ? 'Pending' : 'Met'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!(slaRows || []).length && (
              <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: '#94A3B8' }}>{slaBreachedOnly ? 'No breaches — everyone is within SLA.' : 'No sourced candidates in this window.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}

const SIGNAL_LABEL: Record<string, string> = {
  extended_hours: 'Extended hours',
  declining_productivity: 'Declining productivity',
  irregular_pattern: 'Irregular pattern',
  overloaded: 'Overloaded',
};
const RISK_COLOR: Record<string, { color: string; bg: string }> = {
  low: { color: '#15803d', bg: '#f0fdf4' },
  medium: { color: '#b45309', bg: '#fffbeb' },
  high: { color: '#dc2626', bg: '#fef2f2' },
};

// Burnout/attrition-risk scoring (Time Champ gap-analysis, 2026-08-11) —
// distinct from the Team Leaderboard's performance score above: this is
// risk, computed weekly from real trend signals (extended hours vs the
// recruiter's own baseline, declining productivity, day-to-day
// irregularity, workload pressure), not a single metric. Managers see the
// whole team + can tune thresholds; a recruiter sees only their own
// history (same self-transparency principle as Device Monitoring).
function RiskWellbeingTab() {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { setRole(getTokenPayload()?.role || ''); }, []);
  const canManage = role !== null && ['admin', 'super_admin', 'manager'].includes(role);
  const { data: teamScores, loading: teamLoading } = useFetch<any[]>(role !== null && canManage ? '/manager/risk-scores' : null);
  const { data: myHistory, loading: myLoading } = useFetch<any[]>(role !== null ? '/recruiter/my-risk-history' : null);
  const { data: cfg, refetch: refetchCfg } = useFetch<any>(canManage ? '/manager/risk-config' : null);
  const [editCfg, setEditCfg] = useState<any>(null);
  const [savingCfg, setSavingCfg] = useState(false);

  async function saveCfg() {
    if (!editCfg) return;
    setSavingCfg(true);
    try {
      await apiFetch('/manager/risk-config', { method: 'PUT', body: JSON.stringify(editCfg) });
      refetchCfg();
    } finally { setSavingCfg(false); }
  }

  if (role === null) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {canManage && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Team risk scores (most recent scored week)</div>
          {teamLoading && <p style={{ fontSize: 12, color: '#94A3B8' }}>Loading…</p>}
          {!teamLoading && !(teamScores || []).length && (
            <p style={{ fontSize: 12, color: '#94A3B8' }}>No risk scores computed yet — the weekly job runs Monday 03:30 IST, or trigger it manually via POST /scheduler/trigger/risk-scores.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(teamScores || []).map((r: any) => {
              const rc = RISK_COLOR[r.risk_level] || RISK_COLOR.low;
              return (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{r.recruiter_name}</div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'wrap' }}>
                      {(r.signals || []).map((s: string) => (
                        <span key={s} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: '#fef2f2', color: '#dc2626' }}>{SIGNAL_LABEL[s] || s}</span>
                      ))}
                      {(!r.signals || r.signals.length === 0) && <span style={{ fontSize: 10, color: '#94a3b8' }}>No risk signals this week</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 20, background: rc.bg, color: rc.color, textTransform: 'uppercase' }}>{r.risk_level}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: rc.color, width: 36, textAlign: 'right' }}>{Number(r.risk_score).toFixed(0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{canManage ? 'Your own' : 'Your'} risk history (last 8 weeks)</div>
        {myLoading && <p style={{ fontSize: 12, color: '#94A3B8' }}>Loading…</p>}
        {!myLoading && !(myHistory || []).length && <p style={{ fontSize: 12, color: '#94A3B8' }}>No risk scores computed for you yet.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(myHistory || []).map((r: any) => {
            const rc = RISK_COLOR[r.risk_level] || RISK_COLOR.low;
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: '#f8fafc', borderRadius: 7, fontSize: 12 }}>
                <span style={{ flex: 1 }}>{r.period_start} → {r.period_end}</span>
                <span style={{ color: rc.color, fontWeight: 700 }}>{r.risk_level}</span>
              </div>
            );
          })}
        </div>
      </div>

      {canManage && cfg && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Risk signal thresholds</div>
          <label style={label}>Extended-hours threshold (% above own baseline)</label>
          <input type="number" style={input} value={editCfg?.hours_increase_threshold ?? cfg.hours_increase_threshold}
            onChange={e => setEditCfg((c: any) => ({ ...(c || cfg), hours_increase_threshold: Number(e.target.value) }))} />
          <label style={label}>Productivity-drop threshold (% decline vs prior 2 weeks)</label>
          <input type="number" style={input} value={editCfg?.productivity_drop_threshold ?? cfg.productivity_drop_threshold}
            onChange={e => setEditCfg((c: any) => ({ ...(c || cfg), productivity_drop_threshold: Number(e.target.value) }))} />
          <label style={label}>Workload-overload ratio (open tasks ÷ weekly capacity)</label>
          <input type="number" step="0.1" style={input} value={editCfg?.workload_overload_ratio ?? cfg.workload_overload_ratio}
            onChange={e => setEditCfg((c: any) => ({ ...(c || cfg), workload_overload_ratio: Number(e.target.value) }))} />
          <button onClick={saveCfg} disabled={!editCfg || savingCfg} style={{ ...btn, opacity: !editCfg || savingCfg ? 0.6 : 1 }}>
            {savingCfg ? 'Saving…' : 'Save Thresholds'}
          </button>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, marginBottom: 8 };
const btn: React.CSSProperties = { padding: '7px 16px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' };

// Unified daily action queue, backed by GET /recruiter/my-day — the data
// (tasks, interviews, stale candidates) already existed across 3-4 other
// pages; this is the one glanceable "what do I need to do today" view
// most competitor ATS platforms give a recruiter as their home screen.
function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MyDayTab() {
  const { data, loading } = useFetch<any>('/recruiter/my-day');
  const tasks = data?.tasks_due || [];
  const interviews = data?.interviews_today || [];
  const stale = data?.candidates_needing_action || [];
  const nothingToDo = !loading && !tasks.length && !interviews.length && !stale.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {nothingToDo && (
        <div style={{ ...card, textAlign: 'center', padding: 32, color: '#16A34A', fontSize: 13, fontWeight: 700 }}>
          ✓ Nothing needs your attention right now — no tasks due, no interviews today, no stale candidates.
        </div>
      )}

      {(loading || tasks.length > 0) && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ListChecks size={15} color="#2563EB" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>Tasks due or overdue ({tasks.length})</div>
          </div>
          {tasks.map((t: any) => {
            const overdue = t.due_at && new Date(t.due_at) < new Date();
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
                <span style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{t.title}</span>
                  {t.candidate_name && <span style={{ color: '#64748B' }}> — {t.candidate_name}</span>}
                  {t.req_title && <span style={{ color: '#94A3B8' }}> ({t.req_title})</span>}
                </span>
                {t.due_at && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: overdue ? '#DC2626' : '#64748B' }}>
                    {overdue ? 'OVERDUE' : 'DUE'} {new Date(t.due_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(loading || interviews.length > 0) && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Video size={15} color="#2563EB" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>Interviews today ({interviews.length})</div>
          </div>
          {interviews.map((i: any) => (
            <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: '#2563EB', width: 60 }}>{timeOnly(i.scheduled_at)}</span>
              <span style={{ flex: 1 }}>{i.candidate_name}{i.req_title && <span style={{ color: '#94A3B8' }}> — {i.req_title}</span>}</span>
              <span style={{ fontSize: 10, color: '#64748B' }}>{i.duration_mins}min · {i.mode}</span>
              {i.im_interviewer && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#EEF2FF', color: '#4338CA' }}>YOU INTERVIEW</span>}
            </div>
          ))}
        </div>
      )}

      {(loading || stale.length > 0) && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <AlertCircle size={15} color="#EA580C" />
            <div style={{ fontSize: 13, fontWeight: 700 }}>Candidates needing action ({stale.length})</div>
          </div>
          {stale.map((s: any) => (
            <div key={s.application_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{s.candidate_name}</span>
                {s.req_title && <span style={{ color: '#94A3B8' }}> — {s.req_title}</span>}
              </span>
              <span style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase' }}>{s.stage}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#EA580C' }}>{s.days_stale}d stale</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AutoAssignTab() {
  const { data: reqs, loading: reqsLoading } = useFetch<any[]>('/requisitions?status=open');
  const { data: assignments, loading: assignLoading, refetch } = useFetch<any[]>('/assignments');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // REAL BUG FIX (2026-08-12 audit): POST /requisitions/{id}/assign had no
  // role check at all — a plain recruiter could reassign OTHER recruiters
  // to any requisition. Fixed server-side (require_role admin/manager);
  // this mirrors that here so the button doesn't invite a 403, matching
  // the same deferred-mount canManage pattern TargetsTab already uses.
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    const role = getTokenPayload()?.role || '';
    setCanManage(['admin', 'super_admin', 'manager'].includes(role));
  }, []);

  const activeReqIds = new Set((assignments || []).filter((a: any) => a.status === 'active').map((a: any) => a.requisition_id));
  const unassigned = (reqs || []).filter((r: any) => !activeReqIds.has(r.id) && !results[r.id]);

  const autoAssign = async (reqId: string) => {
    setBusyId(reqId);
    setErrors(e => ({ ...e, [reqId]: '' }));
    try {
      const result = await apiFetch(`/requisitions/${reqId}/assign`, { method: 'POST' });
      setResults(r => ({ ...r, [reqId]: result }));
      refetch();
    } catch (e: any) {
      setErrors(er => ({ ...er, [reqId]: e?.message || 'Auto-assign failed' }));
    } finally { setBusyId(null); }
  };

  const loading = reqsLoading || assignLoading;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Unassigned Open Requisitions</div>
        <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>
          Auto-Assign picks the top-ranked recruiter via <code>assign_with_explanation()</code> (skill match + capacity), same as the button on each requisition's detail page — surfaced here so nothing needing a recruiter goes unnoticed.
        </p>
        {!canManage && (
          <div style={{ fontSize: 12, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
            Assigning recruiters to requisitions is an admin/manager action — you can see the queue below, but the Auto-Assign button is disabled for your role.
          </div>
        )}
        {loading && <div style={{ fontSize: 12, color: '#94A3B8' }}>Loading…</div>}
        {!loading && !unassigned.length && (
          <div style={{ fontSize: 12, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 6 }}>✓ Every open requisition has an active recruiter assigned.</div>
        )}
        {unassigned.map((r: any) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#1E293B' }}>{r.title}</div>
              <div style={{ color: '#64748B' }}>{r.location || 'Remote'} · {r.positions_count} opening{r.positions_count > 1 ? 's' : ''}</div>
              {errors[r.id] && <div style={{ color: '#DC2626', marginTop: 4 }}>{errors[r.id]}</div>}
            </div>
            <button onClick={() => autoAssign(r.id)} disabled={busyId === r.id || !canManage}
              title={!canManage ? 'Admin/manager only' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px', borderRadius: 8, border: '1px solid #C7D2FE', background: !canManage ? '#F1F5F9' : '#EEF2FF', fontSize: 11, fontWeight: 700, color: !canManage ? '#94A3B8' : '#4338CA', cursor: busyId === r.id || !canManage ? 'default' : 'pointer', flexShrink: 0 }}>
              <Sparkles size={12} /> {busyId === r.id ? 'Assigning…' : 'Auto-Assign (AI)'}
            </button>
          </div>
        ))}
      </div>
      {Object.keys(results).length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Just Assigned</div>
          {Object.entries(results).map(([reqId, result]: [string, any]) => (
            <div key={reqId} style={{ fontSize: 12, color: '#4338CA', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8, padding: '8px 10px', marginBottom: 8, lineHeight: 1.6 }}>
              <strong>{result.recruiter_name}</strong> auto-assigned (match score {Math.round((result.match_score || 0) * 100) / 100}%).
              {result.explanation?.skill_match_count != null && (
                <> {result.explanation.skill_match_count} skill match(es), {result.explanation.available_capacity} slot(s) free.</>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PresenceTab() {
  const { data } = useFetch<any>('/recruiter-tracking/presence');
  const { data: activity } = useFetch<any>('/recruiter-tracking/activity');
  const colors: any = { online: '#16A34A', away: '#D97706', offline: '#94A3B8' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {['online', 'away', 'offline'].map(k => (
          <div key={k} style={{ ...card, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: colors[k] }}>{data?.[k] ?? 0}</div>
            <div style={{ fontSize: 11, color: '#64748B', textTransform: 'capitalize' }}>{k}</div>
          </div>
        ))}
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Recruiters</div>
        {(data?.recruiters || []).map((r: any) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <Circle size={8} fill={colors[r.presence]} color={colors[r.presence]} />
            <span style={{ flex: 1 }}>{r.full_name}</span>
            <span style={{ color: '#94A3B8' }}>{r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : 'never seen'}</span>
          </div>
        ))}
        {!data?.recruiters?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No recruiters found.</div>}
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Recent Activity</div>
        {(activity?.activity || []).map((a: any) => (
          <div key={a.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
            <strong>{a.actor_name}</strong> {a.action} {a.entity_type} · <span style={{ color: '#94A3B8' }}>{new Date(a.created_at).toLocaleString()}</span>
          </div>
        ))}
        {!activity?.activity?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No recent activity.</div>}
      </div>
    </div>
  );
}

function LeaveTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const { data: leave, refetch } = useFetch<any[]>('/recruiter-leave?upcoming_only=true');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recruiter_id: '', leave_type: 'vacation', start_date: '', end_date: '', notes: '' });
  const [err, setErr] = useState('');

  const add = async () => {
    if (!form.recruiter_id || !form.start_date || !form.end_date) { setErr('Recruiter, start date, and end date are required'); return; }
    setErr('');
    try {
      await apiFetch('/recruiter-leave', { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false); setForm({ recruiter_id: '', leave_type: 'vacation', start_date: '', end_date: '', notes: '' }); refetch();
    } catch (e: any) { setErr(e?.message || 'Failed to add leave'); }
  };
  const remove = async (id: string) => { await apiFetch(`/recruiter-leave/${id}`, { method: 'DELETE' }); refetch(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: '#64748B' }}>Recruiters on leave are excluded from Auto-Assign scoring for the duration of their leave.</p>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> Log Leave
      </button>
      {showForm && (
        <div style={card}>
          <label style={label}>RECRUITER</label>
          <select value={form.recruiter_id} onChange={e => setForm({ ...form, recruiter_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <label style={label}>TYPE</label>
          <select value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value })} style={input}>
            <option value="vacation">Vacation</option><option value="sick">Sick</option>
            <option value="personal">Personal</option><option value="other">Other</option>
          </select>
          <label style={label}>START DATE</label>
          <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} style={input} />
          <label style={label}>END DATE</label>
          <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} style={input} />
          {err && <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 8 }}>{err}</div>}
          <button onClick={add} style={btn}>Save</button>
        </div>
      )}
      <div style={card}>
        {(leave || []).map((l: any) => {
          const today = new Date().toISOString().slice(0, 10);
          const active = l.start_date <= today && l.end_date >= today;
          return (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l.recruiter_name}</span>
              <span style={{ color: '#64748B', textTransform: 'capitalize' }}>{l.leave_type}</span>
              <span style={{ color: '#94A3B8' }}>{l.start_date} → {l.end_date}</span>
              {active && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#FEF2F2', color: '#DC2626' }}>ON LEAVE NOW</span>}
              <button onClick={() => remove(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={14} /></button>
            </div>
          );
        })}
        {!leave?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No upcoming or active leave logged.</div>}
      </div>
    </div>
  );
}

function WorkSessionsTab() {
  const { data, refetch } = useFetch<any>('/work-sessions');
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { setRole(getTokenPayload()?.role || ''); }, []);
  const canManage = role !== null && ['admin', 'super_admin', 'manager'].includes(role);
  const { data: breakReport } = useFetch<any[]>(canManage ? '/work-sessions/break-report' : null);

  const clockIn = async () => { setBusy(true); try { await apiFetch('/work-sessions/clock-in', { method: 'POST' }); refetch(); } finally { setBusy(false); } };
  const clockOut = async () => { setBusy(true); try { await apiFetch('/work-sessions/clock-out', { method: 'POST' }); refetch(); } finally { setBusy(false); } };
  const startBreak = async () => { setBusy(true); try { await apiFetch('/work-sessions/break/start', { method: 'POST' }); refetch(); } finally { setBusy(false); } };
  const endBreak = async () => { setBusy(true); try { await apiFetch('/work-sessions/break/end', { method: 'POST' }); refetch(); } finally { setBusy(false); } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
        {data?.open_session ? (
          <>
            <div style={{ flex: 1, fontSize: 13 }}>
              Clocked in since <strong>{new Date(data.open_session.clock_in).toLocaleTimeString()}</strong>
              {data?.open_break && <span style={{ color: '#b45309', fontWeight: 700 }}> · On break since {new Date(data.open_break.break_start).toLocaleTimeString()}</span>}
            </div>
            {data?.open_break ? (
              <button onClick={endBreak} disabled={busy} style={{ ...btn, background: '#b45309' }}>{busy ? '…' : 'End Break'}</button>
            ) : (
              <button onClick={startBreak} disabled={busy} style={{ ...btn, background: '#f59e0b' }}>{busy ? '…' : 'Start Break'}</button>
            )}
            <button onClick={clockOut} disabled={busy} style={{ ...btn, background: '#DC2626' }}>{busy ? '…' : 'Clock Out'}</button>
          </>
        ) : (
          <>
            <div style={{ flex: 1, fontSize: 13, color: '#64748B' }}>Not currently clocked in.</div>
            <button onClick={clockIn} disabled={busy} style={{ ...btn, background: '#16A34A' }}>{busy ? '…' : 'Clock In'}</button>
          </>
        )}
      </div>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Recent Sessions</div>
        {(data?.sessions || []).map((s: any) => (
          <div key={s.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1 }}>{new Date(s.clock_in).toLocaleString()}</span>
            <span style={{ color: '#64748B' }}>{s.clock_out ? `${s.duration_mins} min` : 'in progress'}</span>
          </div>
        ))}
        {!data?.sessions?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No sessions logged yet.</div>}
      </div>
      {canManage && (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Team break-time split (all completed sessions)</div>
          {(breakReport || []).length === 0 ? (
            <div style={{ fontSize: 12, color: '#94A3B8' }}>No completed sessions yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#64748B', fontSize: 10, textTransform: 'uppercase' }}>
                    <th style={{ padding: '6px 8px' }}>Recruiter</th>
                    <th style={{ padding: '6px 8px' }}>Sessions</th>
                    <th style={{ padding: '6px 8px' }}>Total Time</th>
                    <th style={{ padding: '6px 8px' }}>Break Time</th>
                    <th style={{ padding: '6px 8px' }}>Net Work Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(breakReport || []).map((r: any) => (
                    <tr key={r.user_id} style={{ borderTop: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '8px' }}>{r.full_name}</td>
                      <td style={{ padding: '8px' }}>{r.session_count}</td>
                      <td style={{ padding: '8px' }}>{Number(r.total_session_mins).toFixed(0)} min</td>
                      <td style={{ padding: '8px', color: '#b45309' }}>{Number(r.total_break_mins).toFixed(0)} min</td>
                      <td style={{ padding: '8px', fontWeight: 700 }}>{Number(r.net_work_mins).toFixed(0)} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TasksTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const { data: tasks, refetch } = useFetch<any[]>('/recruiter-tasks');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recruiter_id: '', title: '', task_type: 'general', priority: 'medium', due_at: '' });
  const userMap = Object.fromEntries((users || []).map((u: any) => [u.id, u.full_name]));

  const create = async () => {
    if (!form.title) return;
    await apiFetch('/recruiter-tasks', { method: 'POST', body: JSON.stringify(form) });
    setShowForm(false); setForm({ recruiter_id: '', title: '', task_type: 'general', priority: 'medium', due_at: '' }); refetch();
  };
  const setStatus = async (id: string, status: string) => {
    await apiFetch(`/recruiter-tasks/${id}?status=${status}`, { method: 'PATCH' }); refetch();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> New Task
      </button>
      {showForm && (
        <div style={card}>
          <label style={label}>RECRUITER</label>
          <select value={form.recruiter_id} onChange={e => setForm({ ...form, recruiter_id: e.target.value })} style={input}>
            <option value="">— Auto-assign (least loaded) —</option>
            {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <label style={label}>TITLE</label>
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} style={input} />
          <label style={label}>PRIORITY</label>
          <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={input}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
          <label style={label}>DUE DATE</label>
          <input type="date" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} style={input} />
          <button onClick={create} style={btn}>Create</button>
        </div>
      )}
      <div style={card}>
        {(tasks || []).map((t: any) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1, textDecoration: t.status === 'completed' ? 'line-through' : 'none', color: t.status === 'completed' ? '#94A3B8' : '#1E293B' }}>{t.title}</span>
            <span style={{ color: '#64748B' }}>{userMap[t.recruiter_id] || '—'}</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: t.priority === 'high' ? '#FEF2F2' : '#F1F5F9', color: t.priority === 'high' ? '#DC2626' : '#64748B' }}>{t.priority}</span>
            <select value={t.status} onChange={e => setStatus(t.id, e.target.value)} style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
              <option value="pending">Pending</option><option value="in_progress">In Progress</option>
              <option value="completed">Completed</option><option value="cancelled">Cancelled</option>
            </select>
          </div>
        ))}
        {!tasks?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No tasks yet.</div>}
      </div>
    </div>
  );
}

function TargetsTab() {
  const { data: users } = useFetch<any[]>('/users?is_active=true');
  const now = new Date();
  const { data: targets, refetch } = useFetch<any[]>(`/recruiter-targets?period_year=${now.getFullYear()}`);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ recruiter_id: '', target_submissions: 10, target_interviews: 5, target_placements: 2, target_work_hours: 160 });
  // getTokenPayload() reads localStorage, which doesn't exist during SSR —
  // reading it synchronously during render (as this used to) made the
  // server's first paint (canManage=false, no Set Target button) differ
  // from the client's (real role, button present), a hydration mismatch
  // (React error #418) — same bug class already fixed on this same page's
  // top-level component and on device-monitoring/page.tsx. Deferred to an
  // effect so the first client render matches the server's exactly.
  const [canManage, setCanManage] = useState(false);
  useEffect(() => {
    const role = getTokenPayload()?.role || '';
    setCanManage(['admin', 'super_admin', 'manager'].includes(role));
  }, []);

  const create = async () => {
    if (!form.recruiter_id) return;
    await apiFetch('/recruiter-targets', { method: 'POST', body: JSON.stringify({ ...form, period_month: now.getMonth() + 1, period_year: now.getFullYear() }) });
    setShowForm(false); refetch();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {canManage && (
        <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Plus size={14} /> Set Target
        </button>
      )}
      {showForm && (
        <div style={card}>
          <label style={label}>RECRUITER</label>
          <select value={form.recruiter_id} onChange={e => setForm({ ...form, recruiter_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {(users || []).map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
          <label style={label}>TARGET SUBMISSIONS (this month)</label>
          <input type="number" value={form.target_submissions} onChange={e => setForm({ ...form, target_submissions: +e.target.value })} style={input} />
          <label style={label}>TARGET INTERVIEWS</label>
          <input type="number" value={form.target_interviews} onChange={e => setForm({ ...form, target_interviews: +e.target.value })} style={input} />
          <label style={label}>TARGET PLACEMENTS</label>
          <input type="number" value={form.target_placements} onChange={e => setForm({ ...form, target_placements: +e.target.value })} style={input} />
          <button onClick={create} style={btn}>Save</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
        {(targets || []).map((t: any) => {
          const pct = t.target_submissions ? Math.min(100, Math.round((t.actual_submissions / t.target_submissions) * 100)) : 0;
          return (
            <div key={t.id} style={card}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t.recruiter_name}</div>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 8 }}>{t.period_month}/{t.period_year}</div>
              <div style={{ fontSize: 11, color: '#374151', marginBottom: 4 }}>Submissions: {t.actual_submissions}/{t.target_submissions}</div>
              <div style={{ height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#16A34A' : '#2563EB', borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
        {!targets?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No targets set for this year.</div>}
      </div>
    </div>
  );
}

function HotlistTab() {
  const { data: candidates } = useFetch<any>('/candidates?limit=200');
  const { data: hotlist, refetch } = useFetch<any[]>('/hotlist');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ candidate_id: '', available_from: '', reason: '', notes: '' });
  const candList = candidates?.items || [];

  const add = async () => {
    if (!form.candidate_id) return;
    await apiFetch('/hotlist', { method: 'POST', body: JSON.stringify(form) });
    setShowForm(false); setForm({ candidate_id: '', available_from: '', reason: '', notes: '' }); refetch();
  };
  const remove = async (id: string) => { await apiFetch(`/hotlist/${id}`, { method: 'DELETE' }); refetch(); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button onClick={() => setShowForm(v => !v)} style={{ ...btn, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Plus size={14} /> Add to Hotlist
      </button>
      {showForm && (
        <div style={card}>
          <label style={label}>CANDIDATE</label>
          <select value={form.candidate_id} onChange={e => setForm({ ...form, candidate_id: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            {candList.slice(0, 200).map((c: any) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <label style={label}>AVAILABLE FROM</label>
          <input type="date" value={form.available_from} onChange={e => setForm({ ...form, available_from: e.target.value })} style={input} />
          <label style={label}>REASON</label>
          <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} style={input}>
            <option value="">-- Select --</option>
            <option value="bench">On bench (available now)</option>
            <option value="contract_ending">Contract ending soon</option>
            <option value="other">Other</option>
          </select>
          <button onClick={add} disabled={!form.candidate_id || !form.reason} style={btn}>Add</button>
        </div>
      )}
      <div style={card}>
        {(hotlist || []).map((h: any) => (
          <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{h.full_name}</span>
            <span style={{ color: '#64748B' }}>{h.reason}</span>
            <span style={{ color: '#94A3B8' }}>{h.available_from ? `from ${h.available_from}` : ''}</span>
            <button onClick={() => remove(h.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}><X size={14} /></button>
          </div>
        ))}
        {!hotlist?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>Hotlist is empty.</div>}
      </div>
    </div>
  );
}

export default function RecruiterOpsPage() {
  // 'autoassign' is the true initial value on both server and client (safe
  // for hydration - see the same fix on device-monitoring/page.tsx). Only
  // AFTER mount, once localStorage is actually reachable, do plain
  // recruiters get switched to My Day instead of landing on a tool built
  // for managing other people's assignments, not their own work.
  const [tab, setTab] = useState('autoassign');
  useEffect(() => {
    if ((getTokenPayload()?.role || '') === 'recruiter') setTab('myday');
  }, []);
  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>Recruiter Ops</h1>
        <p style={{ fontSize: 13, color: '#64748B' }}>AI auto-assignment, presence, tasks, monthly targets, and the candidate hotlist.</p>
      </div>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E2E8F0' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: tab === t.key ? '#2563EB' : '#64748B', borderBottom: tab === t.key ? '2px solid #2563EB' : '2px solid transparent' }}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'myday' && <MyDayTab />}
      {tab === 'activity' && <ActivityTab />}
      {tab === 'autoassign' && <AutoAssignTab />}
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'risk' && <RiskWellbeingTab />}
      {tab === 'presence' && <PresenceTab />}
      {tab === 'sessions' && <WorkSessionsTab />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'targets' && <TargetsTab />}
      {tab === 'hotlist' && <HotlistTab />}
      {tab === 'leave' && <LeaveTab />}
    </div>
  );
}
