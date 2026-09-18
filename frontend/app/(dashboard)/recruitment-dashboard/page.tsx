'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFetch } from '@/lib/useFetch';
import { FUNNEL_LABELS, SOURCING_STATUSES, STATUS_LABEL } from '@/lib/screeningConstants';
import { MessageCircle, Filter as FilterIcon, Target, Gauge } from 'lucide-react';

// Recruitment Overview Dashboard (2026-09-19) -- combines the three
// systems built earlier today into one filterable view: WhatsApp
// Screening (GET /screening/summary), "Screening Tracker" (confirmed
// live to mean the sourcing_status funnel -- GET /candidates/
// sourcing-status-summary), and Skills Match (GET /requisitions/
// skill-match-summary). All three now share client/role/recruiter/date
// filters, added specifically for this dashboard.
//
// Scope note, stated plainly rather than overclaiming: the period
// selector below is a QUICK WAY TO SET A DATE RANGE (jump to "This
// Month", "This Quarter", etc., reusing the exact real-calendar
// boundaries backend/routers/recruiter_attribution.py's _bucket_bounds
// computes), not a multi-bar trend chart -- each section still shows one
// snapshot for the selected range, same as before today's grid-library
// lesson about not overpromising what's actually been built. A real
// trend view (multiple bars over time, like Recruiter Tracking's own
// Trend tab) would be a natural next step per section if wanted later.

type Period = 'all' | 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

const selSm: React.CSSProperties = { padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, background: '#fff' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 };
const sectionTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 12 };
const funnelCard: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', minWidth: 120 };

// Quick-jump periods reuse the exact same real-calendar boundary logic
// as recruiter_attribution.py's _bucket_bounds(period, 1) -- computed
// here in JS rather than round-tripping to the backend just to learn
// today's own week/month/quarter/year start, since the frontend already
// knows today's date.
function periodToRange(period: Period): { from: string; to: string } | null {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (period === 'day') return { from: iso(today), to: iso(today) };
  if (period === 'week') {
    const day = (today.getDay() + 6) % 7; // Monday-start, matching the backend convention
    const start = new Date(today); start.setDate(today.getDate() - day);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { from: iso(start), to: iso(end) };
  }
  if (period === 'month') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: iso(start), to: iso(end) };
  }
  if (period === 'quarter') {
    const q = Math.floor(today.getMonth() / 3);
    const start = new Date(today.getFullYear(), q * 3, 1);
    const end = new Date(today.getFullYear(), q * 3 + 3, 0);
    return { from: iso(start), to: iso(end) };
  }
  if (period === 'year') {
    return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
  }
  return null; // 'all' or 'custom' -- no auto-computed range
}

export default function RecruitmentDashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [clientId, setClientId] = useState('');
  const [reqId, setReqId] = useState('');
  const [recruiterId, setRecruiterId] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // Real bug found live (2026-09-19): candidate_ownership mixes genuine
  // manual sourcing with fully-automated email/resume-inbox attribution
  // -- a recruiter with zero manual work still showed real-looking
  // "sourced" counts here, entirely from emails that happened to route
  // through her identity. Default stays 'all' (doesn't silently change
  // what anyone already saw), but the breakdown line below is always
  // visible regardless of this toggle, so the split can never be missed
  // again the way it was the first time.
  const [sourceType, setSourceType] = useState<'' | 'manual' | 'email'>('');

  const { data: clients } = useFetch<any[]>(mounted ? '/clients' : null);
  const { data: reqs } = useFetch<any[]>(mounted && clientId ? `/requisitions?client_id=${clientId}&status=open` : null);
  const { data: recruiters } = useFetch<any[]>(mounted ? '/users?role=recruiter&is_active=true' : null);

  const range = period === 'custom' ? { from: customFrom, to: customTo } : periodToRange(period);
  const dateFrom = range?.from || '';
  const dateTo = range?.to || '';

  const sharedQs = useMemo(() => {
    const p = new URLSearchParams();
    if (clientId) p.set('client_id', clientId);
    if (reqId) p.set('requisition_id', reqId);
    if (recruiterId) p.set('recruiter_id', recruiterId);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    return p.toString();
  }, [clientId, reqId, recruiterId, dateFrom, dateTo]);

  const sourcingQs = sourceType ? `${sharedQs}&source_type=${sourceType}` : sharedQs;

  const { data: screeningSummary, loading: loadingScreening } = useFetch<any>(mounted ? `/screening/summary?mine=false&${sharedQs}` : null);
  const { data: sourcingSummary, loading: loadingSourcing } = useFetch<any>(mounted ? `/candidates/sourcing-status-summary?${sourcingQs}` : null);
  const { data: skillsSummary, loading: loadingSkills } = useFetch<any>(mounted ? `/requisitions/skill-match-summary?${sharedQs}` : null);

  const funnel: Record<string, number> = screeningSummary?.funnel || {};
  const sourcingCounts: Record<string, number> = sourcingSummary?.counts || {};
  const sourceBreakdown: { manual: number; email: number; other: number } = sourcingSummary?.source_breakdown || { manual: 0, email: 0, other: 0 };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>Recruitment Dashboard</h1>
        <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
          WhatsApp Screening, Screening Tracker (sourcing status), and Skills Match — all in one place, filterable by client, role, recruiter, and date.
        </p>
      </div>

      <div style={{ ...card, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterIcon size={14} color="#64748b" />
        <select value={clientId} onChange={e => { setClientId(e.target.value); setReqId(''); }} style={selSm}>
          <option value="">All Clients</option>
          {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={reqId} onChange={e => setReqId(e.target.value)} disabled={!clientId} style={selSm}>
          <option value="">All Roles</option>
          {(reqs || []).map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <select value={recruiterId} onChange={e => setRecruiterId(e.target.value)} style={selSm}>
          <option value="">All Recruiters</option>
          {(recruiters || []).map((r: any) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'day', 'week', 'month', 'quarter', 'year', 'custom'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: period === p ? '#1e40af' : '#fff', color: period === p ? '#fff' : '#64748b', fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize' }}>
              {p === 'all' ? 'All Time' : p === 'custom' ? 'Custom' : `This ${p}`}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={selSm} />
            <span style={{ color: '#94a3b8', fontSize: 12 }}>to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={selSm} />
          </>
        )}
        {dateFrom && dateTo && period !== 'custom' && (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{dateFrom} → {dateTo}</span>
        )}
      </div>

      <div style={card}>
        <div style={sectionTitle}><MessageCircle size={16} color="#16a34a" /> WhatsApp Screening</div>
        {loadingScreening ? (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</div>
        ) : Object.keys(funnel).length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>No screening sessions match these filters.</div>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(funnel).map(([status, count]) => (
              <div key={status} style={funnelCard}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{count}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{FUNNEL_LABELS[status] || status}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ ...sectionTitle, marginBottom: 0 }}><Target size={16} color="#2563eb" /> Screening Tracker (Sourcing Status)</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {([['', 'All Sources'], ['manual', 'Manual Sourcing'], ['email', 'Email / Auto-Ingested']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setSourceType(val as '' | 'manual' | 'email')}
                style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: sourceType === val ? '#1e40af' : '#fff', color: sourceType === val ? '#fff' : '#64748b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
          Of the candidates matching these filters: <b style={{ color: '#166534' }}>{sourceBreakdown.manual} manually sourced</b> (added directly, WhatsApp-enrolled, or bulk-imported by a recruiter) · <b style={{ color: '#b45309' }}>{sourceBreakdown.email} from email/resume-inbox auto-intake</b> (never manually worked, just attributed by whose inbox a resume routed through){sourceBreakdown.other > 0 && <> · {sourceBreakdown.other} via referral/shared link</>}.
        </div>
        {loadingSourcing ? (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</div>
        ) : Object.keys(sourcingCounts).length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>No candidates match these filters.</div>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {SOURCING_STATUSES.map(s => (
              sourcingCounts[s.value] ? (
                <div key={s.value} style={funnelCard}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a' }}>{sourcingCounts[s.value]}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{STATUS_LABEL[s.value]}</div>
                </div>
              ) : null
            ))}
          </div>
        )}
        {(clientId || reqId) && (
          <p style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 10 }}>
            Sourcing status freezes once a candidate is assigned to a role — with a client/role filter active, this shows each candidate's last known status before that happened, not live pre-role activity for this specific role.
          </p>
        )}
      </div>

      <div style={card}>
        <div style={sectionTitle}><Gauge size={16} color="#d97706" /> Skills Match</div>
        {loadingSkills ? (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</div>
        ) : !skillsSummary || skillsSummary.roles_with_skills === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>No roles with mandatory skills match these filters.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={funnelCard}><div style={{ fontSize: 20, fontWeight: 800 }}>{skillsSummary.roles_with_skills}</div><div style={{ fontSize: 11, color: '#64748b' }}>Roles Tracked</div></div>
              <div style={funnelCard}><div style={{ fontSize: 20, fontWeight: 800 }}>{skillsSummary.candidates_tracked}</div><div style={{ fontSize: 11, color: '#64748b' }}>Candidates Tracked</div></div>
              <div style={funnelCard}><div style={{ fontSize: 20, fontWeight: 800 }}>{skillsSummary.fill_rate_pct}%</div><div style={{ fontSize: 11, color: '#64748b' }}>Skill Data Fill Rate ({skillsSummary.skills_filled}/{skillsSummary.skills_total_possible})</div></div>
            </div>
            {skillsSummary.avg_years_by_skill?.length > 0 && (
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 11, color: '#64748b', fontWeight: 700 }}>Skill</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: '#64748b', fontWeight: 700 }}>Avg Years</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: 11, color: '#64748b', fontWeight: 700 }}>Candidates With Data</th>
                  </tr>
                </thead>
                <tbody>
                  {skillsSummary.avg_years_by_skill.map((s: any) => (
                    <tr key={s.skill} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 10px', fontWeight: 600 }}>{s.skill}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>{s.avg_years}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: '#64748b' }}>{s.candidates_with_data}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
