'use client';
import { useState } from 'react';
import { useFetch } from '@/lib/useFetch';
import OverviewKpiCard from './OverviewKpiCard';
import Link from 'next/link';
import { Loader2, ArrowRight, Clock, Video } from 'lucide-react';

// Recruiter's own personal "Overview" dashboard (2026-08-31) — the 11 real
// KPI cards a recruiter asked for by name, all backed by
// GET /recruiter/my-overview (is_active-scoped, verified end-to-end
// against direct SQL counts before this was wired up), plus a compact
// "Today" feed reusing /recruiter/my-day (already built, previously only
// surfaced on Recruiter Ops — brought here since this is the real personal
// home screen every recruiter now lands on).
const fmtRupee = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function RecruiterOverview() {
  const { data, loading } = useFetch<any>('/recruiter/my-overview');
  const { data: myDay } = useFetch<any>('/recruiter/my-day');
  const d = data || {};

  const tasksDue = (myDay?.tasks_due || []).slice(0, 5);
  // REAL FEATURE ADD (2026-08-31): reported live — this card only ever
  // showed today's interviews. /recruiter/my-day now also returns
  // interviews_tomorrow + interviews_this_week (day 2-7, disjoint from
  // today/tomorrow so nothing double-counts) — a simple 3-way toggle
  // surfaces all three without needing 3 separate cards.
  const [ivTab, setIvTab] = useState<'today' | 'tomorrow' | 'week'>('today');
  const ivMap: Record<string, any[]> = {
    today: myDay?.interviews_today || [],
    tomorrow: myDay?.interviews_tomorrow || [],
    week: myDay?.interviews_this_week || [],
  };
  const interviewsShown = ivMap[ivTab].slice(0, 5);
  const ivEmptyText: Record<string, string> = {
    today: 'No interviews scheduled today.',
    tomorrow: 'No interviews scheduled tomorrow.',
    week: 'No more interviews scheduled later this week.',
  };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="recruiter-overview-cards">
        <OverviewKpiCard icon="📄" label="Total Resumes Owned" value={loading ? '…' : d.resumes_owned ?? 0} color="#1e40af" bg="#eff6ff" href="/candidates?owned=mine" />
        {/* REAL BUG FIX (2026-08-31): reported live as "dashboard information
            is wrong and miss match... and link also" — this card and 4
            others below linked to /candidates?owned=mine, but the KPI's own
            real definition ("owned OR has an active application assigned to
            me") is broader than that page's plain ownership-only filter, so
            clicking it showed far fewer candidates than the number on the
            card (e.g. 12 shown here, 1 on the linked page). Backend now has
            a real owned=mine_or_assigned value matching each KPI exactly
            (candidates.py). */}
        <OverviewKpiCard icon="👤" label="Active Candidates" value={loading ? '…' : d.active_candidates ?? 0} color="#059669" bg="#d1fae5" href="/candidates?owned=mine_or_assigned" />
        <OverviewKpiCard icon="💼" label="Active Requirements" value={loading ? '…' : d.active_requirements ?? 0} color="#7c3aed" bg="#ede9fe" href="/requisitions" />
        {/* Candidates in Pipeline / Total Submissions are real APPLICATION-
            level counts (per-stage, cumulative-ever respectively) with no
            exact-matching cross-job candidate view to link to — /pipeline
            is a per-job Kanban picker, not a cross-job list, so it never
            matched either number. Links to the same broader candidate
            cohort as Active Candidates — an honest "these are your working
            candidates" destination, not a byte-exact row-count match. */}
        <OverviewKpiCard icon="📋" label="Candidates in Pipeline" value={loading ? '…' : d.candidates_in_pipeline ?? 0} color="#0369a1" bg="#e0f2fe" href="/candidates?owned=mine_or_assigned" />
        <OverviewKpiCard icon="📤" label="Total Submissions" value={loading ? '…' : d.total_submissions ?? 0} color="#9a3412" bg="#ffedd5" href="/candidates?owned=mine_or_assigned" />
        {/* /interviews and /offers had zero recruiter-scoping at all — every
            user saw the whole tenant's list regardless of the KPI's own
            "assigned to me" definition. Both pages now support a real
            ?mine=1 param (phase3.py's /auto-interview/list, offers.py's
            /offers) and default their own toggle/tab to the matching view. */}
        <OverviewKpiCard icon="🗓️" label="Interviews Scheduled" value={loading ? '…' : d.interviews_scheduled ?? 0} color="#0f766e" bg="#ccfbf1" href="/interviews?mine=1" />
        <OverviewKpiCard icon="📝" label="Offers Released" value={loading ? '…' : d.offers_released ?? 0} color="#b45309" bg="#fef3c7" href="/offers?mine=1" />
        {/* REAL BUG FIX (2026-08-31): this card never had an href at all -
            it visually looked clickable (OverviewKpiCard always applies
            cursor-pointer regardless of href) but did nothing, reported
            live as "Placements is not working." No dedicated placements-
            only view exists yet — links to the same broader "my candidates"
            cohort as Active Candidates, an honest approximate destination. */}
        <OverviewKpiCard icon="🎉" label="Placements / Joinings" value={loading ? '…' : d.placements ?? 0} color="#065f46" bg="#d1fae5" href="/candidates?owned=mine_or_assigned" />
        <OverviewKpiCard icon="💰" label="Revenue Generated" value={loading ? '…' : fmtRupee(d.revenue_generated || 0)} color="#1e3a5f" bg="#dbeafe" href="/incentives" sub="This month, best-effort attribution" />
        <OverviewKpiCard icon="⏰" label="Pending Follow-ups" value={loading ? '…' : d.pending_followups ?? 0} color="#dc2626" bg="#fee2e2" href="/reminders" />
        <OverviewKpiCard icon="🔔" label="On Notice Period" value={loading ? '…' : d.candidates_on_notice ?? 0} color="#92400e" bg="#fef3c7" href="/candidates?owned=mine_or_assigned" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" style={{ marginTop: 20 }} data-testid="recruiter-overview-today">
        <div className="card">
          <div className="card-header">
            <h3 className="flex items-center gap-2"><Clock size={16} style={{ color: 'var(--primary)' }} /> Follow-ups Due</h3>
            <Link href="/reminders" className="btn btn-ghost btn-sm">All <ArrowRight size={13} /></Link>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--gray-100)' }}>
            {tasksDue.length === 0 && (
              <p style={{ color: '#94a3b8', fontSize: 13, padding: '16px 20px' }}>Nothing due right now.</p>
            )}
            {tasksDue.map((t: any) => (
              <div key={t.id} style={{ padding: '10px 20px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {t.candidate_name ? `${t.candidate_name} · ` : ''}{t.req_title || ''}
                  {t.due_at ? ` · due ${new Date(t.due_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3 className="flex items-center gap-2"><Video size={16} style={{ color: 'var(--primary)' }} /> Interviews</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 7, padding: 2, gap: 1 }}>
                {(['today', 'tomorrow', 'week'] as const).map(tab => (
                  <button key={tab} onClick={() => setIvTab(tab)}
                    data-testid={`iv-tab-${tab}`}
                    style={{
                      padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                      fontSize: 11, fontWeight: 700,
                      background: ivTab === tab ? 'white' : 'transparent',
                      color: ivTab === tab ? '#1e40af' : '#64748b',
                      boxShadow: ivTab === tab ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    }}>
                    {tab === 'today' ? 'Today' : tab === 'tomorrow' ? 'Tomorrow' : 'This Week'}
                  </button>
                ))}
              </div>
              <Link href="/interviews" className="btn btn-ghost btn-sm">All <ArrowRight size={13} /></Link>
            </div>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--gray-100)' }} data-testid="recruiter-overview-interviews-list">
            {interviewsShown.length === 0 && (
              <p style={{ color: '#94a3b8', fontSize: 13, padding: '16px 20px' }}>{ivEmptyText[ivTab]}</p>
            )}
            {interviewsShown.map((iv: any) => (
              <div key={iv.id} style={{ padding: '10px 20px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{iv.candidate_name}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                  {iv.req_title || ''} · {ivTab === 'week' ? new Date(iv.scheduled_at).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }) + ' ' : ''}
                  {new Date(iv.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  {iv.im_interviewer ? ' · you are interviewing' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
