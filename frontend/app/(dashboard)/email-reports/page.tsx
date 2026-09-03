'use client';
import { useState, useEffect } from 'react';
import { useFetch, apiFetch } from '@/lib/useFetch';
import { getTokenPayload } from '@/lib/auth';
import {
  Mail, TrendingUp, Users, Building2, Clock, Award, Download,
  RefreshCw, Settings, AlertCircle, CheckCircle,
} from 'lucide-react';

// Real Email Reports & Analytics — built 2026-09-03 to close the "zero
// reporting/analytics layer" gap found in the same-day audit. Every
// number here comes from backend/routers/email_reports.py's own real
// SQL against candidate_messages/email_threads — no fabricated data.

const MGMT_ROLES = ['admin', 'super_admin', 'manager', 'lead_recruiter', 'kae', 'kam'];

function BarChart({ rows, keyX, keyY, color = '#1e40af' }: any) {
  if (!rows?.length) return <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', padding: '20px' }}>No data for this period</p>;
  const max = Math.max(...rows.map((r: any) => Number(r[keyY]) || 0), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '130px', padding: '0 4px', overflowX: 'auto' }}>
      {rows.map((r: any, i: number) => {
        const v = Number(r[keyY]) || 0;
        const h = Math.round((v / max) * 100);
        return (
          <div key={i} style={{ flex: '0 0 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>{v}</span>
            <div style={{ width: '100%', background: color, borderRadius: '4px 4px 0 0', height: `${h}%`, minHeight: '4px' }} />
            <span style={{ fontSize: '9px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{String(r[keyX]).slice(5, 10)}</span>
          </div>
        );
      })}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color = '#1e40af' }: any) {
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{value}</div>
        <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: '10px', color: '#94a3b8' }}>{sub}</div>}
      </div>
    </div>
  );
}

const ENGAGEMENT_COLORS: Record<string, string> = { high: '#16a34a', medium: '#f59e0b', low: '#ea580c', inactive: '#94a3b8' };

const TH: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: '11px', fontWeight: 700, color: '#64748b', borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' };
const TD: React.CSSProperties = { padding: '8px 10px', fontSize: '12px', color: '#1e293b', borderBottom: '1px solid #f1f5f9' };

type Tab = 'executive' | 'client' | 'kae' | 'recruiter' | 'performance' | 'engagement' | 'sla' | 'schedule';

export default function EmailReportsPage() {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { setRole(getTokenPayload()?.role || null); }, []);
  const isMgmt = role === null || MGMT_ROLES.includes(role);

  const [tab, setTab] = useState<Tab>('executive');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [granularity, setGranularity] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('daily');
  const [toast, setToast] = useState('');

  const qs = (dateFrom || dateTo) ? `?${dateFrom ? `date_from=${dateFrom}&` : ''}${dateTo ? `date_to=${dateTo}` : ''}` : '';

  const { data: exec, refetch: refetchExec } = useFetch<any>(isMgmt && tab === 'executive' ? '/email-reports/executive' : null);
  const { data: clientReport, refetch: refetchClient } = useFetch<any>(isMgmt && tab === 'client' ? `/email-reports/client-wise${qs}` : null);
  const { data: kaeReport } = useFetch<any>(isMgmt && tab === 'kae' ? `/email-reports/kae-wise${qs}` : null);
  const { data: recruiterReport } = useFetch<any>(tab === 'recruiter' ? `/email-reports/recruiter${qs}${qs ? '&' : '?'}team_view=${isMgmt}` : null);
  const { data: perf } = useFetch<any>(isMgmt && tab === 'performance' ? `/email-reports/performance?granularity=${granularity}${qs ? '&' + qs.slice(1) : ''}` : null);
  const { data: engagement, refetch: refetchEngagement } = useFetch<any[]>(isMgmt && tab === 'engagement' ? '/email-reports/engagement' : null);
  const { data: sla } = useFetch<any[]>(isMgmt && tab === 'sla' ? '/email-reports/sla' : null);
  const { data: schedCfg, refetch: refetchSched } = useFetch<any>(isMgmt && tab === 'schedule' ? '/email-reports/schedule-config' : null);

  const recomputeEngagement = async () => {
    try {
      const r = await apiFetch('/email-reports/engagement/compute', { method: 'POST' });
      setToast(`Recomputed ${r.computed} client score(s)`);
      refetchEngagement();
    } catch (e: any) { setToast(e?.message || 'Recompute failed'); }
    setTimeout(() => setToast(''), 3500);
  };

  const doExport = async (report: string, fmt: 'csv' | 'xlsx') => {
    try {
      const { authHeaders } = await import('@/lib/auth');
      const res = await fetch((process.env.NEXT_PUBLIC_API_URL ?? '/api') + `/email-reports/export?report=${report}&fmt=${fmt}${qs ? '&' + qs.slice(1) : ''}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${report}_report.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) { setToast(e?.message || 'Export failed'); setTimeout(() => setToast(''), 3500); }
  };

  const TABS: [Tab, string, boolean][] = [
    ['executive', 'Executive Dashboard', isMgmt],
    ['client', 'Client-Wise', isMgmt],
    ['kae', 'KAE-Wise', isMgmt],
    ['recruiter', 'Recruiter Report', true],
    ['performance', 'Performance Trend', isMgmt],
    ['engagement', 'Client Engagement', isMgmt],
    ['sla', 'Email SLA', isMgmt],
    ['schedule', 'Scheduled Reports', isMgmt],
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1400px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Mail size={22} /> Email Reports & Analytics
          </h1>
          <p style={{ fontSize: '12px', color: '#64748b' }}>Real tracking, threading, engagement, and SLA — computed from your actual mailbox data.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px' }} />
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px' }} />
        </div>
      </div>

      {toast && (
        <div style={{ marginBottom: '12px', padding: '8px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '12px', color: '#1e40af' }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', gap: '4px', marginBottom: '18px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }} data-testid="email-reports-tabs">
        {TABS.filter(([, , show]) => show).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} data-tab={key}
            style={{ padding: '9px 14px', background: 'none', border: 'none', borderBottom: tab === key ? '2px solid #1e40af' : '2px solid transparent',
              color: tab === key ? '#1e40af' : '#64748b', fontWeight: tab === key ? 700 : 500, fontSize: '13px', cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {!isMgmt && tab !== 'recruiter' && (
        <p style={{ color: '#94a3b8', fontSize: '13px' }}>This view is restricted to KAE/KAM/Manager/Admin. You can still see your own Recruiter Report.</p>
      )}

      {tab === 'executive' && isMgmt && exec && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '20px' }}>
            <KpiCard icon={Mail} label="Emails Sent Today" value={exec.emails_sent_today} color="#1e40af" />
            <KpiCard icon={CheckCircle} label="Opened Today" value={exec.emails_opened_today} color="#16a34a" />
            <KpiCard icon={Users} label="Client Replies Today" value={exec.client_replies_today} color="#0891b2" />
            <KpiCard icon={AlertCircle} label="Pending Follow-Ups" value={exec.pending_followups} color="#d97706" />
            <KpiCard icon={TrendingUp} label="Open Rate (30d)" value={`${exec.open_rate_pct}%`} color="#8b5cf6" />
            <KpiCard icon={TrendingUp} label="Reply Rate (30d)" value={`${exec.reply_rate_pct}%`} color="#ec4899" />
            <KpiCard icon={Building2} label="Active Clients" value={exec.active_clients} sub={`${exec.inactive_clients} inactive`} color="#059669" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>Top Responsive Clients</h3>
              {(exec.top_responsive_clients || []).map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '12px', borderBottom: '1px solid #f1f5f9' }}>
                  <span>{c.client_name}</span><span style={{ fontWeight: 700, color: '#16a34a' }}>{c.reply_rate ?? '—'}%</span>
                </div>
              ))}
            </div>
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>Least Responsive Clients</h3>
              {(exec.least_responsive_clients || []).map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '12px', borderBottom: '1px solid #f1f5f9' }}>
                  <span>{c.client_name}</span><span style={{ fontWeight: 700, color: '#dc2626' }}>{c.reply_rate ?? '—'}%</span>
                </div>
              ))}
            </div>
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>Top KAE by Email Activity (30d)</h3>
              {(exec.top_kae_by_activity || []).map((k: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '12px', borderBottom: '1px solid #f1f5f9' }}>
                  <span>{k.full_name}</span><span style={{ fontWeight: 700 }}>{k.emails_sent}</span>
                </div>
              ))}
            </div>
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>Pending Client Responses</h3>
              {(exec.pending_client_responses || []).map((p: any, i: number) => (
                <div key={i} style={{ padding: '5px 0', fontSize: '12px', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontWeight: 600 }}>{p.client_name} — {p.subject || '(no subject)'}</div>
                  <div style={{ color: '#d97706', fontSize: '11px' }}>{p.hours_pending}h pending</div>
                </div>
              ))}
              {!(exec.pending_client_responses || []).length && <p style={{ color: '#94a3b8', fontSize: '12px' }}>Nothing pending — all client emails have a reply.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === 'client' && isMgmt && clientReport && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '10px' }}>
            <button onClick={() => doExport('client_wise', 'csv')} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', fontSize: '12px', cursor: 'pointer' }}><Download size={12} /> CSV</button>
            <button onClick={() => doExport('client_wise', 'xlsx')} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', background: 'white', fontSize: '12px', cursor: 'pointer' }}><Download size={12} /> Excel</button>
          </div>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>Daily Trend</h3>
            <BarChart rows={clientReport.daily_trend} keyX="day" keyY="sent" />
          </div>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={TH}>Client</th><th style={TH}>Sent</th><th style={TH}>Delivered</th><th style={TH}>Opened</th>
                <th style={TH}>Replied</th><th style={TH}>Open Rate</th><th style={TH}>Reply Rate</th><th style={TH}>Avg Response</th>
              </tr></thead>
              <tbody>
                {(clientReport.clients || []).map((c: any, i: number) => (
                  <tr key={i}>
                    <td style={TD}>{c.client_name}</td><td style={TD}>{c.emails_sent}</td><td style={TD}>{c.delivered}</td>
                    <td style={TD}>{c.opened}</td><td style={TD}>{c.replied}</td>
                    <td style={TD}>{c.open_rate_pct}%</td><td style={TD}>{c.reply_rate_pct}%</td>
                    <td style={TD}>{c.avg_response_hours != null ? `${c.avg_response_hours}h` : '—'}</td>
                  </tr>
                ))}
                {!(clientReport.clients || []).length && <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', color: '#94a3b8' }}>No client emails in this period</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'kae' && isMgmt && kaeReport && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Rank</th><th style={TH}>KAE</th><th style={TH}>Sent</th><th style={TH}>Clients Contacted</th>
              <th style={TH}>Client Replies</th><th style={TH}>Follow-Ups</th><th style={TH}>Response Rate</th><th style={TH}>Avg Response</th>
            </tr></thead>
            <tbody>
              {(kaeReport.kaes || []).map((k: any, i: number) => (
                <tr key={i}>
                  <td style={TD}><span style={{ fontWeight: 700, color: k.rank <= 3 ? '#d97706' : '#64748b' }}>#{k.rank}</span></td>
                  <td style={TD}>{k.full_name}</td><td style={TD}>{k.emails_sent}</td><td style={TD}>{k.clients_contacted}</td>
                  <td style={TD}>{k.client_replies}</td><td style={TD}>{k.follow_ups_sent}</td>
                  <td style={TD}><span style={{ fontWeight: 700 }}>{k.response_rate_pct}%</span></td>
                  <td style={TD}>{k.avg_response_hours != null ? `${k.avg_response_hours}h` : '—'}</td>
                </tr>
              ))}
              {!(kaeReport.kaes || []).length && <tr><td colSpan={8} style={{ ...TD, textAlign: 'center', color: '#94a3b8' }}>No client emails sent by any KAE in this period</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'recruiter' && recruiterReport && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
          <p style={{ padding: '10px 14px', fontSize: '11px', color: '#94a3b8' }}>Internal communication only — candidates and internal (KAE) contacts. Client communication is never attributed to a recruiter.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Recruiter</th><th style={TH}>To Candidates</th><th style={TH}>From Candidates</th>
              <th style={TH}>To KAE</th><th style={TH}>Candidate Response Rate</th>
            </tr></thead>
            <tbody>
              {(recruiterReport.recruiters || []).map((r: any, i: number) => (
                <tr key={i}>
                  <td style={TD}>{r.full_name}</td><td style={TD}>{r.to_candidates}</td><td style={TD}>{r.from_candidates}</td>
                  <td style={TD}>{r.to_kae}</td><td style={TD}>{r.candidate_response_rate_pct}%</td>
                </tr>
              ))}
              {!(recruiterReport.recruiters || []).length && <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', color: '#94a3b8' }}>No emails in this period</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'performance' && isMgmt && (
        <div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const).map(g => (
              <button key={g} onClick={() => setGranularity(g)}
                style={{ padding: '5px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '11px', cursor: 'pointer',
                  background: granularity === g ? '#1e40af' : 'white', color: granularity === g ? 'white' : '#475569' }}>
                {g[0].toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
            <BarChart rows={perf?.trend} keyX="period" keyY="sent" />
          </div>
        </div>
      )}

      {tab === 'engagement' && isMgmt && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
            <button onClick={recomputeEngagement} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', border: '1px solid #1e40af', borderRadius: '6px', background: '#eff6ff', color: '#1e40af', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
              <RefreshCw size={12} /> Recompute (last 30 days)
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '10px' }}>
            {(engagement || []).map((c: any) => (
              <div key={c.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: '13px' }}>{c.client_name}</span>
                  <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    background: `${ENGAGEMENT_COLORS[c.engagement_level]}20`, color: ENGAGEMENT_COLORS[c.engagement_level] }}>{c.engagement_level}</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '6px' }}>{c.engagement_score}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Open {c.open_rate}% · Reply {c.reply_rate}% · {c.emails_sent} sent</div>
              </div>
            ))}
            {!(engagement || []).length && <p style={{ color: '#94a3b8', fontSize: '13px' }}>No scores computed yet — click Recompute.</p>}
          </div>
        </div>
      )}

      {tab === 'sla' && isMgmt && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={TH}>Client</th><th style={TH}>Emails Sent</th><th style={TH}>Avg Response</th>
              <th style={TH}>Fastest Response</th><th style={TH}>Longest Pending</th>
            </tr></thead>
            <tbody>
              {(sla || []).map((s: any, i: number) => (
                <tr key={i}>
                  <td style={TD}>{s.client_name}</td><td style={TD}>{s.emails_sent}</td>
                  <td style={TD}>{s.avg_response_hours != null ? `${s.avg_response_hours}h` : '—'}</td>
                  <td style={TD}>{s.fastest_response_hours != null ? `${s.fastest_response_hours}h` : '—'}</td>
                  <td style={TD}>
                    {s.longest_pending_hours != null
                      ? <span style={{ color: s.longest_pending_hours > 48 ? '#dc2626' : '#1e293b', fontWeight: s.longest_pending_hours > 48 ? 700 : 400 }}>{Math.round(s.longest_pending_hours)}h</span>
                      : '—'}
                  </td>
                </tr>
              ))}
              {!(sla || []).length && <tr><td colSpan={5} style={{ ...TD, textAlign: 'center', color: '#94a3b8' }}>No client email history yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'schedule' && isMgmt && schedCfg && (
        <ScheduleConfigPanel cfg={schedCfg} onSaved={() => { setToast('Saved'); refetchSched(); setTimeout(() => setToast(''), 2500); }} />
      )}
    </div>
  );
}

function ScheduleConfigPanel({ cfg, onSaved }: { cfg: any; onSaved: () => void }) {
  const [daily, setDaily] = useState(!!cfg.daily_enabled);
  const [weekly, setWeekly] = useState(!!cfg.weekly_enabled);
  const [monthly, setMonthly] = useState(!!cfg.monthly_enabled);
  const [emails, setEmails] = useState((cfg.recipient_emails || []).join(', '));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch('/email-reports/schedule-config', {
        method: 'PUT',
        body: JSON.stringify({
          daily_enabled: daily, weekly_enabled: weekly, monthly_enabled: monthly,
          recipient_emails: emails.split(',').map((e: string) => e.trim()).filter(Boolean),
        }),
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', maxWidth: '520px' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Settings size={16} /> Scheduled Report Delivery
      </h3>
      <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '14px' }}>
        Automatically email a real email-activity summary to the recipients below.
      </p>
      {[['Daily', daily, setDaily], ['Weekly', weekly, setWeekly], ['Monthly', monthly, setMonthly]].map(([label, checked, setter]: any) => (
        <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={checked} onChange={e => setter(e.target.checked)} /> {label} report
        </label>
      ))}
      <div style={{ marginTop: '10px' }}>
        <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>Recipient emails (comma-separated)</label>
        <input value={emails} onChange={e => setEmails(e.target.value)} placeholder="admin@company.com, manager@company.com"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', marginTop: '4px' }} />
      </div>
      <button onClick={save} disabled={saving}
        style={{ marginTop: '14px', padding: '8px 18px', background: '#1e40af', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
