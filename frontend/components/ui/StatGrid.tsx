
interface StatItem {
  icon: string; label: string; value: any;
  color?: string; bg?: string; sub?: string;
}
export function StatGrid({ stats, cols = 4 }: { stats: StatItem[]; cols?: number }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-${cols} gap-4 mb-6`}>
      {stats.map((s, i) => (
        <div key={i} className="stat-card">
          <div className="stat-icon" style={{ background: s.bg || '#eff6ff' }}>{s.icon}</div>
          <div className="stat-value" style={{ color: s.color || 'var(--primary)' }}>
            {s.value ?? '—'}
          </div>
          <div className="stat-label">{s.label}</div>
          {s.sub && <div className="text-xs mt-1" style={{ color:'var(--gray-400)' }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}
