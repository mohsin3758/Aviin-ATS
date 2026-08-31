'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import {
  ClipboardList, Users, Download, History, RotateCcw,
  AlertTriangle, Sparkles, X, CheckSquare, Square, Moon,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

const card: React.CSSProperties = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#64748B', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' };
const inputSm: React.CSSProperties = { padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, background: '#fff' };
const btn: React.CSSProperties = { padding: '7px 14px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 };
const btnGhost: React.CSSProperties = { ...btn, background: '#fff', color: '#374151', border: '1px solid #E2E8F0' };

const CAPACITY_TIER_COLOR: Record<string, { bg: string; color: string }> = {
  healthy: { bg: '#F0FDF4', color: '#16A34A' },
  stretch: { bg: '#FFFBEB', color: '#D97706' },
  overloaded: { bg: '#FEF2F2', color: '#DC2626' },
};
const WORKLOAD_COLOR: Record<string, { bg: string; color: string }> = {
  Low: { bg: '#F0FDF4', color: '#16A34A' },
  Medium: { bg: '#FFFBEB', color: '#D97706' },
  High: { bg: '#FEF2F2', color: '#DC2626' },
};

function StatCard({ title, value, sub, icon: Icon, tone }: { title: string; value: string | number; sub?: string; icon: any; tone?: string }) {
  return (
    <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: tone || '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={18} style={{ color: '#2563EB' }} />
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>{value}</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>{title}</div>
        {sub && <div style={{ fontSize: 10, color: '#94A3B8' }}>{sub}</div>}
      </div>
    </div>
  );
}

function HistoryModal({ requisitionId, onClose }: { requisitionId: string; onClose: () => void }) {
  const { data, loading } = useFetch<any>(`/assignment-dashboard/history/${requisitionId}`);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, width: 560, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Assignment History</div>
            <div style={{ fontSize: 12, color: '#64748B' }}>{data?.requisition_title || '...'}</div>
          </div>
          <button onClick={onClose} data-testid="modal-close-btn" style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        {loading && <div style={{ fontSize: 12, color: '#94A3B8' }}>Loading...</div>}
        {!loading && !data?.timeline?.length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No assignment history yet for this requisition.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(data?.timeline || []).map((e: any) => (
            <div key={e.id} style={{ display: 'flex', gap: 10, borderLeft: '2px solid #E2E8F0', paddingLeft: 12, paddingBottom: 4 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B', textTransform: 'capitalize' }}>
                  {e.event_type.replace(/_/g, ' ')} — {e.recruiter_name || 'Unknown recruiter'}
                </div>
                {e.reason && <div style={{ fontSize: 11, color: '#64748B' }}>{e.reason}</div>}
                {e.metadata?.workload_label && (
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>
                    Workload: {e.metadata.workload_label} · Match: {Math.round((e.metadata.match_score || 0) * 100) / 100}%
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
                  {new Date(e.created_at).toLocaleString('en-IN')} {e.actor_name ? `· by ${e.actor_name}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Same Low/Medium/High convention already used by the requisition detail
// page's own AssignedRecruiterCard picker (WORKLOAD_BADGE) — matched here
// for a consistent look between the single-requisition and bulk pickers.
const RECRUITER_WORKLOAD_BADGE: Record<string, { color: string; bg: string }> = {
  Low: { color: '#16A34A', bg: '#F0FDF4' },
  Medium: { color: '#CA8A04', bg: '#FEFCE8' },
  High: { color: '#DC2626', bg: '#FEF2F2' },
};

function BulkReassignModal({ ids, onDone, onClose }: { ids: string[]; onDone: () => void; onClose: () => void }) {
  const { data: users } = useFetch<any[]>('/users?is_active=true&role=recruiter');
  // Real workload/capacity/on-leave per recruiter (2026-08-31) — a bulk
  // selection can span several different requisitions at once, so this
  // deliberately reuses the requisition-INDEPENDENT capacity signal
  // (/analytics/recruiter-capacity, not the per-requisition
  // match-recruiters score AssignedRecruiterCard uses) rather than
  // averaging or picking one arbitrary requisition's match score.
  const { data: capacity } = useFetch<any[]>('/analytics/recruiter-capacity');
  const capMap = Object.fromEntries((capacity || []).map((c: any) => [c.recruiter_id, c]));
  const [recruiterId, setRecruiterId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/assignment-dashboard/bulk-reassign', {
        method: 'POST',
        body: JSON.stringify({ assignment_ids: ids, new_recruiter_id: recruiterId || undefined, reason: reason || undefined }),
      });
      setResult(r);
      onDone();
    } catch (e: any) {
      setResult({ error: e.message || 'Failed' });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 20, width: 460 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>Bulk Reassign</div>
        <p style={{ fontSize: 12, color: '#64748B', marginBottom: 14 }}>{ids.length} assignment(s) selected.</p>
        <label style={label}>NEW RECRUITER — pick a name, or auto-pick the next-best match per assignment</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, maxHeight: 280, overflowY: 'auto' }} data-testid="bulk-recruiter-picker">
          <div
            onClick={() => setRecruiterId('')}
            data-testid="bulk-recruiter-option-autopick"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${recruiterId === '' ? '#93C5FD' : '#E2E8F0'}`,
              background: recruiterId === '' ? '#EFF6FF' : '#fff',
            }}>
            <Sparkles size={14} style={{ color: '#4338CA', flexShrink: 0 }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B' }}>
              Auto-pick per assignment <span style={{ fontWeight: 400, color: '#94A3B8' }}>(next-best match for each role)</span>
            </div>
          </div>
          {(users || []).map((u: any) => {
            const c = capMap[u.id];
            const wl = RECRUITER_WORKLOAD_BADGE[c?.workload_label] || RECRUITER_WORKLOAD_BADGE.Medium;
            const isSelected = recruiterId === u.id;
            return (
              <div key={u.id} data-testid={`bulk-recruiter-option-${u.id}`}
                onClick={() => setRecruiterId(u.id)}
                title={c ? `${c.available_capacity}/${c.capacity_weekly ?? c.max_active_reqs} slots free · ${c.active_assignments ?? 0} active assignment(s)${c.on_leave ? ' · on leave' : ''}` : 'No capacity data yet'}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${isSelected ? '#93C5FD' : '#E2E8F0'}`,
                  background: isSelected ? '#EFF6FF' : '#fff',
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B' }}>{u.full_name}</div>
                  {c && (
                    <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>
                      {c.available_capacity}/{c.max_active_reqs} req slots free · {c.active_assignments} active
                      {c.on_leave ? ' · on leave' : ''}
                    </div>
                  )}
                </div>
                {c?.on_leave && (
                  <span title="On leave right now" style={{ color: '#D97706', flexShrink: 0 }}><Moon size={13} /></span>
                )}
                {c && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, color: wl.color, background: wl.bg, flexShrink: 0 }}>
                    {c.workload_label} load
                  </span>
                )}
              </div>
            );
          })}
          {!(users || []).length && <div style={{ fontSize: 12, color: '#94A3B8' }}>No active recruiters found.</div>}
        </div>
        <label style={label}>REASON</label>
        <input value={reason} onChange={e => setReason(e.target.value)} style={{ ...inputSm, width: '100%', marginBottom: 14, boxSizing: 'border-box' }} placeholder="e.g. Rebalancing workload" />
        {result && !result.error && (
          <div style={{ fontSize: 12, color: '#16A34A', background: '#F0FDF4', borderRadius: 8, padding: 8, marginBottom: 10 }}>
            {result.succeeded} succeeded, {result.failed} failed.
          </div>
        )}
        {result?.error && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 10 }}>{result.error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={submit} disabled={busy} style={btn}>{busy ? 'Reassigning…' : 'Confirm Bulk Reassign'}</button>
          <button onClick={onClose} style={btnGhost}>{result ? 'Close' : 'Cancel'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AssignmentDashboardPage() {
  const [role, setRole] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setRole(getTokenPayload()?.role || ''); setMounted(true); }, []);
  const isManager = mounted && ['admin', 'super_admin', 'manager', 'kae'].includes(role || '');

  const [groupBy, setGroupBy] = useState<'recruiter' | 'client' | 'desk'>('recruiter');
  const [filters, setFilters] = useState({ client_id: '', department: '', recruiter_id: '', priority: '', status: 'active', method: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historyReqId, setHistoryReqId] = useState<string | null>(null);
  const [showBulk, setShowBulk] = useState(false);

  const { data: clients } = useFetch<any>('/clients');
  const clientList = clients?.items || clients || [];

  const { data: summaryData } = useFetch<any>(mounted ? `/assignment-dashboard/summary?group_by=${groupBy}` : null);
  const summaryRows = summaryData?.rows || [];

  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v as string); });
  if (!isManager) qs.set('mine', 'true');
  const { data: listData, refetch: refetchList } = useFetch<any[]>(mounted ? `/assignment-dashboard/list?${qs.toString()}` : null);
  const rows = listData || [];

  // Recruiter-grouped summary always fetched separately for the top stat
  // cards, regardless of the "View by" toggle the user has selected.
  const { data: recruiterSummary } = useFetch<any>(mounted ? '/assignment-dashboard/summary?group_by=recruiter' : null);
  const recRows = recruiterSummary?.rows || [];
  const totalAssigned = recRows.reduce((s: number, r: any) => s + r.total_assigned, 0);
  const totalSlaBreached = recRows.reduce((s: number, r: any) => s + r.sla_breached_count, 0);
  const totalAi = recRows.reduce((s: number, r: any) => s + r.ai_assigned, 0);
  const totalManual = recRows.reduce((s: number, r: any) => s + r.manual_assigned, 0);

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Select-all toggles every currently VISIBLE (filtered) row, not every
  // assignment that ever existed — matching the same "select all" scope
  // convention used elsewhere in this app (Resume Inbox, Users & Roles).
  const allVisibleSelected = rows.length > 0 && rows.every((r: any) => selected.has(r.id));
  const toggleSelectAll = () => setSelected(allVisibleSelected ? new Set() : new Set(rows.map((r: any) => r.id)));

  const exportCsv = async () => {
    const token = localStorage.getItem('airecruit_token');
    const resp = await fetch(`${API_URL}/assignment-dashboard/export.csv?${qs.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'assignment_dashboard.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  if (!mounted) return null;

  return (
    <div className="anim-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={20} /> {isManager ? 'Assignment Dashboard' : 'My Assignments'}
          </div>
          <p style={{ fontSize: 12, color: '#64748B' }}>
            {isManager
              ? 'Who is assigned to what, AI vs manual, client/desk/recruiter breakdown, SLA, and submission rollup.'
              : 'Everything currently assigned to you — priority, SLA, and submission status.'}
          </p>
        </div>
        <button onClick={exportCsv} style={btnGhost}><Download size={13} /> Export CSV</button>
      </div>

      {isManager && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          <StatCard title="Total Active Assignments" value={totalAssigned} icon={ClipboardList} />
          <StatCard title="SLA Breached" value={totalSlaBreached} icon={AlertTriangle} tone="#FEF2F2" />
          <StatCard title="AI-Assigned" value={totalAi} sub={`${totalManual} manual`} icon={Sparkles} tone="#EEF2FF" />
          <StatCard title="Recruiters w/ Assignments" value={recRows.filter((r: any) => r.total_assigned > 0).length} sub={`of ${recRows.length}`} icon={Users} />
        </div>
      )}

      {isManager && (
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>View by</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['recruiter', 'client', 'desk'] as const).map(g => (
                <button key={g} onClick={() => setGroupBy(g)} data-testid={`groupby-${g}`}
                  style={{ ...(groupBy === g ? btn : btnGhost), padding: '6px 12px', textTransform: 'capitalize' }}>
                  {g === 'desk' ? 'Desk / Team' : g}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>{groupBy === 'desk' ? 'Desk' : groupBy === 'client' ? 'Client' : 'Recruiter'}</th>
                  <th style={{ padding: '6px 8px' }}>Assigned</th>
                  <th style={{ padding: '6px 8px' }}>Positions</th>
                  <th style={{ padding: '6px 8px' }}>AI / Manual</th>
                  <th style={{ padding: '6px 8px' }}>SLA Breached</th>
                  <th style={{ padding: '6px 8px' }}>SLA At-Risk (predicted)</th>
                  {groupBy === 'recruiter' && <th style={{ padding: '6px 8px' }}>Workload</th>}
                  {groupBy === 'recruiter' && <th style={{ padding: '6px 8px' }}>Capacity Tier</th>}
                  {groupBy === 'desk' && <th style={{ padding: '6px 8px' }}>Recruiters</th>}
                  {groupBy === 'client' && <th style={{ padding: '6px 8px' }}>Avg Client Response</th>}
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r: any) => (
                  <tr key={r.key} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '8px', fontWeight: 700 }}>{r.label}</td>
                    <td style={{ padding: '8px' }}>{r.total_assigned}</td>
                    <td style={{ padding: '8px' }}>{r.total_positions}</td>
                    <td style={{ padding: '8px' }}>{r.ai_assigned} / {r.manual_assigned}</td>
                    <td style={{ padding: '8px', color: r.sla_breached_count > 0 ? '#DC2626' : '#94A3B8', fontWeight: r.sla_breached_count > 0 ? 700 : 400 }}>{r.sla_breached_count}</td>
                    <td style={{ padding: '8px', color: r.sla_at_risk_predicted > 0 ? '#D97706' : '#94A3B8' }}>{r.sla_at_risk_predicted}</td>
                    {groupBy === 'recruiter' && (
                      <td style={{ padding: '8px' }}>
                        {r.ratio_workload_label && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, ...WORKLOAD_COLOR[r.ratio_workload_label] }}>
                            {r.ratio_workload_label}
                          </span>
                        )}
                      </td>
                    )}
                    {groupBy === 'recruiter' && (
                      <td style={{ padding: '8px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, ...(CAPACITY_TIER_COLOR[r.capacity_tier] || {}) }}>
                          {r.capacity_tier} ({r.total_assigned})
                        </span>
                      </td>
                    )}
                    {groupBy === 'desk' && <td style={{ padding: '8px' }}>{r.recruiters_count}</td>}
                    {groupBy === 'client' && <td style={{ padding: '8px' }}>{r.avg_client_response_hours != null ? `${r.avg_client_response_hours}h` : '—'}</td>}
                  </tr>
                ))}
                {!summaryRows.length && <tr><td colSpan={9} style={{ padding: 12, color: '#94A3B8' }}>No active assignments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginRight: 8 }}>{isManager ? 'All Assignments' : 'Assigned to me'}</div>
          {isManager && (
            <>
              <select value={filters.client_id} onChange={e => setFilters(f => ({ ...f, client_id: e.target.value }))} style={inputSm} data-testid="filter-client">
                <option value="">All Clients</option>
                {clientList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input placeholder="Desk / department" value={filters.department} onChange={e => setFilters(f => ({ ...f, department: e.target.value }))} style={inputSm} />
            </>
          )}
          <select value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))} style={inputSm}>
            <option value="">All Priorities</option>
            <option value="critical">Critical</option><option value="high">High</option>
            <option value="medium">Medium</option><option value="low">Low</option>
          </select>
          <select value={filters.method} onChange={e => setFilters(f => ({ ...f, method: e.target.value }))} style={inputSm}>
            <option value="">AI + Manual</option><option value="ai">AI only</option><option value="manual">Manual only</option>
          </select>
          <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={inputSm}>
            <option value="active">Active</option><option value="reassigned">Reassigned</option>
            <option value="completed">Completed</option><option value="">All</option>
          </select>
        </div>

        {isManager && selected.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#1E40AF' }}>{selected.size} selected</span>
            <button onClick={() => setShowBulk(true)} style={{ ...btn, padding: '5px 12px' }}><RotateCcw size={12} /> Bulk Reassign</button>
            <button onClick={() => setSelected(new Set())} style={{ ...btnGhost, padding: '5px 12px' }}>Clear</button>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E2E8F0', textAlign: 'left' }}>
                {isManager && (
                  <th style={{ padding: '6px 8px', width: 24 }}>
                    {rows.length > 0 && (
                      <button onClick={toggleSelectAll} data-testid="select-all-assignments" title={allVisibleSelected ? 'Clear selection' : 'Select all visible'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}>
                        {allVisibleSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                      </button>
                    )}
                  </th>
                )}
                <th style={{ padding: '6px 8px' }}>Requisition</th>
                <th style={{ padding: '6px 8px' }}>Client</th>
                {isManager && <th style={{ padding: '6px 8px' }}>Recruiter</th>}
                <th style={{ padding: '6px 8px' }}>Desk</th>
                <th style={{ padding: '6px 8px' }}>Priority</th>
                <th style={{ padding: '6px 8px' }}>Method</th>
                <th style={{ padding: '6px 8px' }}>Assigned</th>
                <th style={{ padding: '6px 8px' }}>SLA</th>
                <th style={{ padding: '6px 8px' }}>Submissions</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} data-testid={`assignment-row-${r.id}`} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  {isManager && (
                    <td style={{ padding: '8px' }}>
                      <button onClick={() => toggleSelect(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}>
                        {selected.has(r.id) ? <CheckSquare size={15} /> : <Square size={15} />}
                      </button>
                    </td>
                  )}
                  <td style={{ padding: '8px', fontWeight: 700 }}>
                    <a href={`/requisitions/${r.requisition_id}`} style={{ color: '#1E40AF', textDecoration: 'none' }}>{r.requisition_title}</a>
                    <div style={{ fontSize: 10, color: '#94A3B8' }}>{r.positions_count} position(s) · {r.employment_type}</div>
                  </td>
                  <td style={{ padding: '8px', color: '#475569' }}>{r.client_name || '—'}</td>
                  {isManager && (
                    <td style={{ padding: '8px' }}>
                      {r.recruiter_name}
                      {r.recruiter_on_leave && (
                        <span title="On leave right now" style={{ marginLeft: 4, color: '#D97706' }}><Moon size={11} style={{ display: 'inline' }} /></span>
                      )}
                    </td>
                  )}
                  <td style={{ padding: '8px', color: '#64748B' }}>{r.department}</td>
                  <td style={{ padding: '8px', textTransform: 'capitalize' }}>{r.priority}</td>
                  <td style={{ padding: '8px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: r.assign_method === 'AI' ? '#EEF2FF' : '#F1F5F9', color: r.assign_method === 'AI' ? '#4338CA' : '#475569' }}>
                      {r.assign_method === 'AI' ? '✨ AI' : '↻ Manual'}
                    </span>
                  </td>
                  <td style={{ padding: '8px', color: '#64748B' }}>{new Date(r.assigned_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                  <td style={{ padding: '8px' }}>
                    {r.sla_breached
                      ? <span style={{ color: '#DC2626', fontWeight: 700 }}>Breached</span>
                      : <span style={{ color: '#16A34A' }}>{Math.max(0, Math.round(r.effective_sla_hours - r.hours_open))}h left</span>}
                  </td>
                  <td style={{ padding: '8px' }}>{r.submission_count}</td>
                  <td style={{ padding: '8px' }}>
                    <button onClick={() => setHistoryReqId(r.requisition_id)} title="Assignment history" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                      <History size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={10} style={{ padding: 16, color: '#94A3B8', textAlign: 'center' }}>
                  {isManager ? 'No assignments match these filters.' : "You don't have any active assignments right now."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {historyReqId && <HistoryModal requisitionId={historyReqId} onClose={() => setHistoryReqId(null)} />}
      {showBulk && (
        <BulkReassignModal ids={Array.from(selected)} onClose={() => setShowBulk(false)}
          onDone={() => { setSelected(new Set()); refetchList(); }} />
      )}
    </div>
  );
}
