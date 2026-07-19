'use client';
import { useState, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Search, Download } from 'lucide-react';
import { useFetch } from '@/lib/useFetch';

type SlaRow = {
  requisition_id: string;
  role_title: string;
  client_name: string;
  opened_at: string;
  status: string;
  age_days: number;
  total_submissions: number;
  interviews: number;
  offers: number;
  hires: number;
  time_to_first_sub_hrs: number | null;
  time_to_fill_days: number | null;
  sla_target_days: number;
  sla_breached: boolean;
};

type SlaSummary = {
  total_requisitions: number;
  breached: number;
  on_track: number;
  avg_age_days: number;
  avg_time_to_first_sub_hrs: number | null;
  avg_time_to_fill_days: number | null;
  stale_no_submission: number;
};

function SlaProgressBar({ ageDays, targetDays }: { ageDays: number; targetDays: number }) {
  const pct = Math.min(100, Math.round((ageDays / targetDays) * 100));
  const color = pct >= 100 ? '#dc2626' : pct >= 80 ? '#f59e0b' : pct >= 50 ? '#3b82f6' : '#10b981';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '140px' }}>
      <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: '#e2e8f0', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: '3px', transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: '700', color, minWidth: '34px', textAlign: 'right' }}>
        {ageDays}d
      </span>
    </div>
  );
}

function PipelineDots({ subs, interviews, offers, hires }: {
  subs: number; interviews: number; offers: number; hires: number;
}) {
  const stages = [
    { label: 'Subs', value: subs, color: '#3b82f6' },
    { label: 'Int', value: interviews, color: '#8b5cf6' },
    { label: 'Off', value: offers, color: '#f59e0b' },
    { label: 'Hired', value: hires, color: '#10b981' },
  ];
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      {stages.map((s, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
          <div style={{
            width: '24px', height: '24px', borderRadius: '50%',
            background: s.value > 0 ? s.color : '#e2e8f0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', fontWeight: '700', color: s.value > 0 ? 'white' : '#94a3b8',
          }}>
            {s.value}
          </div>
          <span style={{ fontSize: '9px', color: '#94a3b8' }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function UrgencyBadge({ row }: { row: SlaRow }) {
  const pct = Math.round((row.age_days / row.sla_target_days) * 100);
  const isStale = row.total_submissions === 0 && row.age_days > 7;
  if (row.sla_breached || pct >= 100)
    return (
      <span style={{
        padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '700',
        background: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
      }}>
        <AlertTriangle size={9} /> Breached
      </span>
    );
  if (isStale)
    return (
      <span style={{
        padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '700',
        background: '#fef3c7', color: '#92400e', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
      }}>
        ⚠ Stale
      </span>
    );
  if (pct >= 80)
    return (
      <span style={{
        padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '700',
        background: '#fff7ed', color: '#ea580c', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
      }}>
        <Clock size={9} /> At Risk
      </span>
    );
  return (
    <span style={{
      padding: '3px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '700',
      background: '#d1fae5', color: '#065f46', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
    }}>
      <CheckCircle2 size={9} /> On Track
    </span>
  );
}

type FilterType = 'all' | 'breached' | 'at_risk' | 'stale' | 'on_track';
type SortType = 'age' | 'subs' | 'name';

export default function SlaPage() {
  const { data: summary } = useFetch<SlaSummary>('/sla/summary');
  const { data: rows } = useFetch<SlaRow[]>('/sla');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('age');

  const atRiskCount = useMemo(() =>
    (rows || []).filter(r => {
      const pct = (r.age_days / r.sla_target_days) * 100;
      return !r.sla_breached && pct >= 80 && pct < 100;
    }).length,
    [rows]
  );

  const filtered = useMemo(() => {
    let data = rows || [];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r =>
        r.role_title.toLowerCase().includes(q) || (r.client_name || '').toLowerCase().includes(q)
      );
    }
    data = data.filter(r => {
      const pct = (r.age_days / r.sla_target_days) * 100;
      const isStale = r.total_submissions === 0 && r.age_days > 7;
      if (filter === 'breached') return r.sla_breached || pct >= 100;
      if (filter === 'at_risk') return !r.sla_breached && pct >= 80 && pct < 100;
      if (filter === 'stale') return isStale && !r.sla_breached;
      if (filter === 'on_track') return !r.sla_breached && !isStale && pct < 80;
      return true;
    });
    return [...data].sort((a, b) => {
      if (sort === 'age') return b.age_days - a.age_days;
      if (sort === 'subs') return b.total_submissions - a.total_submissions;
      return a.role_title.localeCompare(b.role_title);
    });
  }, [rows, search, filter, sort]);

  function exportCsv() {
    const headers = ['Role', 'Client', 'Age(days)', 'SLA Target', '% Used', 'Submissions', 'Interviews', 'Offers', 'Hires', 'Status'];
    const lines = (rows || []).map(r => {
      const pct = Math.round((r.age_days / r.sla_target_days) * 100);
      const isStale = r.total_submissions === 0 && r.age_days > 7;
      const status = r.sla_breached || pct >= 100 ? 'Breached'
        : pct >= 80 ? 'At Risk'
        : isStale ? 'Stale' : 'On Track';
      return [r.role_title, r.client_name || '', r.age_days, r.sla_target_days,
        pct + '%', r.total_submissions, r.interviews, r.offers, r.hires, status].join(',');
    });
    const csv = [headers.join(','), ...lines].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'sla-report.csv';
    a.click();
  }

  const kpis = [
    { icon: '📋', label: 'Total Reqs', value: summary?.total_requisitions ?? 0, color: '#1e40af', bg: '#eff6ff' },
    { icon: '🚨', label: 'SLA Breached', value: summary?.breached ?? 0, color: '#dc2626', bg: '#fee2e2' },
    { icon: '⚡', label: 'At Risk', value: atRiskCount, color: '#ea580c', bg: '#fff7ed' },
    { icon: '⏳', label: 'Stale (No Subs)', value: summary?.stale_no_submission ?? 0, color: '#92400e', bg: '#fef3c7' },
    { icon: '✅', label: 'On Track', value: summary?.on_track ?? 0, color: '#059669', bg: '#d1fae5' },
    { icon: '📅', label: 'Avg Age (days)', value: summary?.avg_age_days ? summary.avg_age_days.toFixed(1) : '—', color: '#374151', bg: '#f1f5f9' },
  ];

  const filterButtons: { key: FilterType; label: string; activeColor: string }[] = [
    { key: 'all', label: 'All', activeColor: '#1e40af' },
    { key: 'breached', label: 'Breached', activeColor: '#dc2626' },
    { key: 'at_risk', label: 'At Risk', activeColor: '#ea580c' },
    { key: 'stale', label: 'Stale', activeColor: '#d97706' },
    { key: 'on_track', label: 'On Track', activeColor: '#059669' },
  ];

  return (
    <div className="anim-fade-up space-y-6">
      {/* Hero */}
      <div className="page-hero" style={{ background: 'linear-gradient(135deg,#7f1d1d,#dc2626,#f97316)' }}>
        <div className="relative z-10">
          <h1 className="text-white text-2xl font-bold mb-1">⏱️ SLA Tracking</h1>
          <p className="text-red-100 text-sm">Time-to-fill · Requisition aging · Pipeline progress · Breach alerts</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
        {kpis.map(k => (
          <div key={k.label} className="stat-card" style={{ cursor: 'default' }}>
            <div className="stat-icon" style={{ background: k.bg, fontSize: '18px' }}>{k.icon}</div>
            <div className="stat-value" style={{ color: k.color, fontSize: '24px' }}>{k.value}</div>
            <div className="stat-label">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters + Search */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '180px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search role or client…"
              style={{
                width: '100%', paddingLeft: '32px', paddingRight: '12px', paddingTop: '8px', paddingBottom: '8px',
                border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {filterButtons.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{
                  padding: '6px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600', border: 'none', cursor: 'pointer',
                  background: filter === f.key ? f.activeColor : '#f1f5f9',
                  color: filter === f.key ? 'white' : '#374151',
                }}>
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Sort:</span>
            <select
              value={sort}
              onChange={e => setSort(e.target.value as SortType)}
              style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', outline: 'none', cursor: 'pointer' }}>
              <option value="age">Age (oldest first)</option>
              <option value="subs">Submissions</option>
              <option value="name">Role name</option>
            </select>
            <button onClick={exportCsv}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', borderRadius: '8px',
                background: '#1e40af', color: 'white', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
              }}>
              <Download size={13} /> Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Requisition SLA Status</h3>
          <span style={{ fontSize: '12px', color: '#64748b' }}>{filtered.length} of {rows?.length ?? 0}</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: '900px' }}>
            <thead>
              <tr>
                <th style={{ minWidth: '200px' }}>Role</th>
                <th style={{ minWidth: '120px' }}>Client</th>
                <th style={{ minWidth: '160px' }}>SLA Progress</th>
                <th>Pipeline</th>
                <th style={{ minWidth: '90px' }}>Opened</th>
                <th style={{ minWidth: '80px' }}>1st Sub</th>
                <th style={{ minWidth: '100px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const pct = Math.round((r.age_days / r.sla_target_days) * 100);
                const rowBg = r.sla_breached || pct >= 100 ? '#fff5f5'
                  : pct >= 80 ? '#fffbf0'
                  : r.total_submissions === 0 && r.age_days > 7 ? '#fffcf0' : 'white';
                const opened = r.opened_at
                  ? new Date(r.opened_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                  : '—';
                return (
                  <tr key={r.requisition_id} style={{ background: rowBg }}>
                    <td>
                      <div style={{ fontWeight: '600', fontSize: '13px', color: '#0f172a', lineHeight: '1.3' }}>{r.role_title}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>Target: {r.sla_target_days}d</div>
                    </td>
                    <td>
                      <div style={{ fontSize: '12px', color: '#374151', fontWeight: '500' }}>{r.client_name || '—'}</div>
                      <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px', textTransform: 'capitalize' }}>{r.status}</div>
                    </td>
                    <td>
                      <SlaProgressBar ageDays={r.age_days} targetDays={r.sla_target_days} />
                      <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '3px' }}>{pct}% of target</div>
                    </td>
                    <td>
                      <PipelineDots subs={r.total_submissions} interviews={r.interviews} offers={r.offers} hires={r.hires} />
                    </td>
                    <td style={{ fontSize: '12px', color: '#374151' }}>{opened}</td>
                    <td style={{ fontSize: '12px', color: '#374151' }}>
                      {r.time_to_first_sub_hrs != null ? (
                        <span style={{
                          fontWeight: '600',
                          color: r.time_to_first_sub_hrs <= 24 ? '#059669' : r.time_to_first_sub_hrs <= 72 ? '#d97706' : '#dc2626',
                        }}>
                          {r.time_to_first_sub_hrs >= 24
                            ? Math.round(r.time_to_first_sub_hrs / 24) + 'd'
                            : r.time_to_first_sub_hrs + 'h'}
                        </span>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>—</span>
                      )}
                    </td>
                    <td><UrgencyBadge row={r} /></td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '14px' }}>
                    {rows?.length ? 'No requisitions match the current filter' : 'No SLA data found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>Progress bar color:</span>
          {[
            { color: '#10b981', label: '< 50% of SLA target' },
            { color: '#3b82f6', label: '50–79% of target' },
            { color: '#f59e0b', label: '80–99% (At Risk)' },
            { color: '#dc2626', label: '≥ 100% (Breached)' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: l.color }} />
              <span style={{ fontSize: '11px', color: '#64748b' }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
