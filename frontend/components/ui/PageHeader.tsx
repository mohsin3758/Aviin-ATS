
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: string;
  actions?: React.ReactNode;
  badge?: { text: string; color?: string };
}
export function PageHeader({ title, subtitle, icon, actions, badge }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div className="flex items-center gap-3">
        {icon && <div className="text-3xl">{icon}</div>}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold" style={{ color:'var(--gray-900)' }}>{title}</h1>
            {badge && (
              <span className="badge badge-green text-xs">{badge.text}</span>
            )}
          </div>
          {subtitle && <p className="text-sm mt-0.5" style={{ color:'var(--gray-500)' }}>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
