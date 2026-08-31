'use client';
import { useState } from 'react';
import { useFetch } from '@/lib/useFetch';
import OverviewKpiCard from './OverviewKpiCard';
import KaeReviewPanel from './KaeReviewPanel';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';

// KAE/KAM's own personal "Overview" dashboard (2026-08-31) — the "just me"
// counterpart to the admin-oriented view, backed by GET /kae/my-overview
// (is_active-scoped, verified end-to-end against direct SQL counts before
// this was wired up) plus a real, expandable Review Queue list reusing
// the already-built KaeReviewPanel (compact mode) — no second comparison
// UI, the same real AI-Match-Score comparison the requisition-level page
// already uses.
const fmtRupee = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function KaeOverview() {
  const { data, loading } = useFetch<any>('/kae/my-overview');
  const { data: queue } = useFetch<any[]>('/kae/review-queue');
  const d = data || {};
  const [expanded, setExpanded] = useState<string | null>(null);

  const pendingRows = (queue || []).filter((r: any) => r.undecided_count > 0);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="kae-overview-cards">
        <OverviewKpiCard icon="🏢" label="My Owned Clients" value={loading ? '…' : d.owned_clients ?? 0} color="#1e40af" bg="#eff6ff" href="/kae" />
        <OverviewKpiCard icon="📋" label="Candidates Pending My Review" value={loading ? '…' : d.candidates_pending_review ?? 0} color="#b45309" bg="#fef3c7" />
        <OverviewKpiCard icon="💰" label="Revenue This Month" value={loading ? '…' : fmtRupee(d.revenue_this_month || 0)} color="#065f46" bg="#d1fae5" href="/account-pl" />
        <OverviewKpiCard icon="🧾" label="Collections This Month" value={loading ? '…' : fmtRupee(d.collections_this_month || 0)} color="#1e3a5f" bg="#dbeafe" href="/collections" />
        <OverviewKpiCard icon="⏰" label="Pending Follow-ups" value={loading ? '…' : d.pending_followups ?? 0} color="#dc2626" bg="#fee2e2" href="/reminders" />
      </div>

      <div className="card" style={{ marginTop: 20 }} data-testid="kae-overview-retention">
        <div className="card-header">
          <h3>Client Retention Snapshot</h3>
        </div>
        <div className="card-body" style={{ display: 'flex', gap: 24 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{loading ? '…' : d.retention_clients_tracked ?? 0}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Clients with a retention record</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>{loading ? '…' : (d.retention_avg_months ?? 0)}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Avg. months served</div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }} data-testid="kae-overview-review-queue">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Candidates Awaiting My Review</h3>
          <Link href="/kae" className="btn btn-ghost btn-sm">All in /kae <ArrowRight size={13} /></Link>
        </div>
        {pendingRows.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13, padding: '16px 0' }}>Nothing awaiting your review right now.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingRows.map((r: any) => (
              <div key={r.requisition_id}>
                <button
                  onClick={() => setExpanded(expanded === r.requisition_id ? null : r.requisition_id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {expanded === r.requisition_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{r.requisition_title}</span>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{r.client_name || ''}</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: '#fef3c7', color: '#b45309' }}>
                    {r.undecided_count} undecided
                  </span>
                </button>
                {expanded === r.requisition_id && (
                  <div style={{ marginTop: 8 }}>
                    <KaeReviewPanel requisitionId={r.requisition_id} compact />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
