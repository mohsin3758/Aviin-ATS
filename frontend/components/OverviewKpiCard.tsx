'use client';
import Link from 'next/link';

// Shared KPI card for the role-specific personal "Overview" dashboards
// (Recruiter/KAE — 2026-08-31). Reuses the existing .stat-card/.stat-icon/
// .stat-value/.stat-label CSS classes the admin dashboard's own StatCard
// already established, so both looks match without duplicating styles.
export default function OverviewKpiCard({
  icon, label, value, color, bg, href, sub,
}: {
  icon: string; label: string; value: string | number; color: string; bg: string; href?: string; sub?: string;
}) {
  const content = (
    <div className="stat-card group cursor-pointer">
      <div className="stat-icon" style={{ background: bg }}>{icon}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}
