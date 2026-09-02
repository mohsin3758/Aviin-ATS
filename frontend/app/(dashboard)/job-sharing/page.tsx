'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Share2, ExternalLink, Copy, CheckCircle2, Search, Flag, XCircle, RotateCcw, Zap, AlertTriangle, BarChart3, Facebook, Link2, Unlink, Send, Linkedin, Twitter, Mail, MessageCircle, Plug, Briefcase, MapPin, Rocket, MousePointerClick, TrendingUp, Clock } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch, apiFetch } from '@/lib/useFetch';

const AUTO_CHANNELS = ['linkedin', 'whatsapp', 'facebook', 'twitter', 'telegram', 'email', 'whatsapp_channel'];

const CATEGORY_LABELS: Record<string, string> = {
  social: 'Social / Direct Share',
  general: 'General (India)',
  tech: 'Tech / IT',
  fresher_campus: 'Fresher / Campus',
  women: 'Women-Focused',
  bluecollar_gig: 'Blue-Collar / Gig',
  remote_global: 'Remote / Global',
  gulf: 'Gulf / International',
  aggregator: 'Aggregators',
  government: 'Government',
  startup_niche: 'Startup / Niche',
};

const ISSUE_TYPES = [
  { value: 'broken_link', label: 'Broken link' },
  { value: 'wrong_info', label: 'Wrong info' },
  { value: 'posting_failed', label: 'Posting failed' },
  { value: 'other', label: 'Other' },
];

interface Portal { key: string; name: string; category: string; share_intent: boolean; link: string; }

function ReportIssueModal({ portal, reqId, onClose, onReported }: {
  portal: Portal; reqId: string; onClose: () => void; onReported: () => void;
}) {
  const [issueType, setIssueType] = useState('broken_link');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await apiFetch('/job-sharing/issues', {
        method: 'POST',
        body: JSON.stringify({ req_id: reqId || null, portal_key: portal.key, portal_name: portal.name, issue_type: issueType, note: note || null }),
      });
      onReported();
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 14, width: '100%', maxWidth: 380, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Report issue — {portal.name}</h3>
          <button onClick={onClose}><XCircle className="h-4 w-4 text-gray-400" /></button>
        </div>
        <label className="text-xs font-medium text-gray-600 block mb-1">Issue type</label>
        <select value={issueType} onChange={e => setIssueType(e.target.value)}
          className="w-full border rounded-lg px-2 py-1.5 text-sm mb-3">
          {ISSUE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <label className="text-xs font-medium text-gray-600 block mb-1">Note (optional)</label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
          placeholder="e.g. link 404s, redirected to wrong page..."
          className="w-full border rounded-lg px-2 py-1.5 text-sm mb-4 resize-none" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg border text-gray-600">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-50">
            {saving ? 'Reporting...' : 'Report Issue'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Per-channel visual identity for the redesigned "Distribute" grid — icon +
// brand-ish accent so the channel row is scannable at a glance instead of
// six identically-styled gray buttons.
const CHANNEL_META: Record<string, { icon: any; ring: string; iconBg: string; iconColor: string }> = {
  linkedin: { icon: Linkedin,      ring: 'ring-[#0A66C2]/20', iconBg: 'bg-[#0A66C2]/10', iconColor: 'text-[#0A66C2]' },
  whatsapp: { icon: MessageCircle, ring: 'ring-[#25D366]/20', iconBg: 'bg-[#25D366]/10', iconColor: 'text-[#128C4A]' },
  facebook: { icon: Facebook,      ring: 'ring-[#1877F2]/20', iconBg: 'bg-[#1877F2]/10', iconColor: 'text-[#1877F2]' },
  twitter:  { icon: Twitter,       ring: 'ring-gray-900/10',  iconBg: 'bg-gray-900/5',    iconColor: 'text-gray-900' },
  telegram: { icon: Send,          ring: 'ring-[#26A5E4]/20', iconBg: 'bg-[#26A5E4]/10', iconColor: 'text-[#26A5E4]' },
  email:    { icon: Mail,          ring: 'ring-gray-400/20',  iconBg: 'bg-gray-100',      iconColor: 'text-gray-600' },
  whatsapp_channel: { icon: MessageCircle, ring: 'ring-[#25D366]/20', iconBg: 'bg-[#25D366]/10', iconColor: 'text-[#128C4A]' },
};

const INTEGRATION_STYLES: Record<string, { border: string; dot: string }> = {
  auto_share:   { border: 'border-l-blue-500',  dot: 'bg-blue-500' },
  auto_feed:    { border: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  auto_indexed: { border: 'border-l-violet-500', dot: 'bg-violet-500' },
  manual:       { border: 'border-l-gray-300',  dot: 'bg-gray-400' },
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  posted:      { label: 'Posted',       cls: 'bg-green-50 text-green-700 border-green-200' },
  flagged:     { label: 'Flagged',      cls: 'bg-amber-50 text-amber-800 border-amber-300' },
  not_posted:  { label: 'Never posted', cls: 'bg-gray-50 text-gray-500 border-gray-200' },
};

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border rounded-xl px-4 py-3 bg-white">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900 mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function DistributionPerformance() {
  // Gap-audit fix (2026-09-02): real per-channel click/apply analytics -
  // job_shares.click_count/apply_count already existed on the schema,
  // just never written until the /job-sharing/go/{...} click-redirect
  // was added. Shows genuine engagement, not just "was it posted".
  const { data } = useFetch<any[]>('/job-sharing/analytics-summary');
  const PLATFORM_LABELS: Record<string, string> = { facebook: 'Facebook', telegram: 'Telegram', whatsapp_channel: 'WhatsApp Channel', linkedin: 'LinkedIn', twitter: 'X / Twitter', whatsapp: 'WhatsApp (share)', email: 'Email' };
  const rows = (data || []).filter(r => r.clicks > 0 || r.applies > 0 || r.shares > 0);
  const totalClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
  const totalApplies = rows.reduce((s, r) => s + (r.applies || 0), 0);

  return (
    <Card>
      <CardHeader><h2 className="font-semibold flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-gray-400" /> Distribution Performance</h2></CardHeader>
      <CardContent>
        <p className="text-xs text-gray-400 mb-3">
          Real click-through and apply-through counts per channel — only tracked for the 3 auto-post channels (Facebook, Telegram, WhatsApp Channel), since only those route through a trackable link.
        </p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <StatTile label="Total Clicks" value={totalClicks} />
          <StatTile label="Applications from Clicks" value={totalApplies} />
        </div>
        {rows.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-6">No tracked clicks yet — connect an auto-channel and distribute a job to start seeing real engagement here.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="py-2 pr-3 font-medium">Channel</th>
                  <th className="py-2 pr-3 font-medium">Posts</th>
                  <th className="py-2 pr-3 font-medium">Jobs</th>
                  <th className="py-2 pr-3 font-medium">Clicks</th>
                  <th className="py-2 pr-3 font-medium">Applications</th>
                  <th className="py-2 pr-3 font-medium">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.platform} className="border-b border-gray-50">
                    <td className="py-2 pr-3 font-medium text-gray-800">{PLATFORM_LABELS[r.platform] || r.platform}</td>
                    <td className="py-2 pr-3 text-gray-600">{r.shares}</td>
                    <td className="py-2 pr-3 text-gray-600">{r.jobs}</td>
                    <td className="py-2 pr-3 text-gray-700 font-semibold">{r.clicks || 0}</td>
                    <td className="py-2 pr-3 text-gray-700 font-semibold">{r.applies || 0}</td>
                    <td className="py-2 pr-3 text-gray-500">{r.clicks > 0 ? `${((r.applies / r.clicks) * 100).toFixed(0)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardView() {
  const { data } = useFetch<any>('/job-sharing/dashboard');
  const [dCat, setDCat] = useState('');
  const [dStatus, setDStatus] = useState('');

  if (!data) return <div className="flex justify-center py-10"><Spinner size="lg" /></div>;

  const { summary, integration_breakdown, portals, recent_posts } = data;
  const topPosted = portals.filter((p: any) => p.times_posted > 0).slice(0, 10);
  const maxPosted = Math.max(1, ...topPosted.map((p: any) => p.times_posted));
  const categories = Array.from(new Set(portals.map((p: any) => p.category))) as string[];
  const filtered = portals.filter((p: any) =>
    (!dCat || p.category === dCat) && (!dStatus || p.status === dStatus));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Total Portals" value={summary.total_portals} />
        <StatTile label="Total Posts (all-time)" value={summary.total_shares} />
        <StatTile label="Open Issues" value={summary.open_issues} sub={summary.open_issues > 0 ? 'needs attention' : 'all clear'} />
        <StatTile label="Never Posted" value={summary.portals_never_posted} sub={`of ${summary.total_portals} portals`} />
      </div>

      <DistributionPerformance />

      <Card>
        <CardHeader><h2 className="font-semibold">Integration Type</h2></CardHeader>
        <CardContent>
          <p className="text-xs text-gray-400 mb-3">What "posted" actually means differs by portal — these aren't the same guarantee.</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {integration_breakdown.map((b: any) => (
              <div key={b.type} className={`border-l-4 ${INTEGRATION_STYLES[b.type]?.border || 'border-l-gray-300'} border-y border-r rounded-lg px-3 py-2.5`}>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${INTEGRATION_STYLES[b.type]?.dot || 'bg-gray-400'}`} />
                  <span className="text-xs font-medium text-gray-700">{b.label}</span>
                </div>
                <div className="text-xl font-bold text-gray-900 mt-1">{b.count}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {topPosted.length > 0 && (
        <Card>
          <CardHeader><h2 className="font-semibold">Most-Posted Portals</h2></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topPosted.map((p: any) => (
                <div key={p.key} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-xs text-gray-600 truncate">{p.name}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div className="bg-blue-500 h-full rounded-full" style={{ width: `${(p.times_posted / maxPosted) * 100}%` }} />
                  </div>
                  <div className="w-6 shrink-0 text-xs font-semibold text-gray-700 text-right">{p.times_posted}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {recent_posts && recent_posts.length > 0 && (
        <Card>
          <CardHeader><h2 className="font-semibold">Recent Posts — Direct Links</h2></CardHeader>
          <CardContent>
            <p className="text-xs text-gray-400 mb-3">Every individual post logged, most recent first — click "View Post" to open the exact link that was shared.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 border-b">
                    <th className="py-2 pr-3 font-medium">Portal</th>
                    <th className="py-2 pr-3 font-medium">Job</th>
                    <th className="py-2 pr-3 font-medium">Posted By</th>
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_posts.map((post: any) => (
                    <tr key={post.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-3 font-medium text-gray-800">{post.portal_name}</td>
                      <td className="py-2 pr-3 text-gray-600 truncate max-w-[180px]">{post.requisition_title}</td>
                      <td className="py-2 pr-3 text-gray-500">{post.posted_by_name || '—'}</td>
                      <td className="py-2 pr-3 text-gray-400">{post.posted_at ? new Date(post.posted_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td className="py-2 pr-3">
                        <a href={post.link} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium">
                          <ExternalLink className="h-3 w-3" /> View Post
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold">All {portals.length} Portals — Status</h2>
          <div className="flex items-center gap-2">
            <select value={dCat} onChange={e => setDCat(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
            </select>
            <select value={dStatus} onChange={e => setDStatus(e.target.value)} className="border rounded-lg px-2 py-1.5 text-xs">
              <option value="">All statuses</option>
              <option value="posted">Posted</option>
              <option value="flagged">Flagged</option>
              <option value="not_posted">Never posted</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b">
                <th className="py-2 pr-3 font-medium">Portal</th>
                <th className="py-2 pr-3 font-medium">Integration</th>
                <th className="py-2 pr-3 font-medium">Times Posted</th>
                <th className="py-2 pr-3 font-medium">Jobs</th>
                <th className="py-2 pr-3 font-medium">Last Posted</th>
                <th className="py-2 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr key={p.key} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-3 font-medium text-gray-800">{p.name}</td>
                  <td className="py-2 pr-3 text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${INTEGRATION_STYLES[p.integration_type]?.dot || 'bg-gray-400'}`} />
                      {p.integration_label}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-700">{p.times_posted}</td>
                  <td className="py-2 pr-3 text-gray-500">{p.jobs_posted_to}</td>
                  <td className="py-2 pr-3 text-gray-400">{p.last_posted_at ? new Date(p.last_posted_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td className="py-2 pr-3">
                    <span className={`inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[p.status].cls}`}>
                      {p.status === 'flagged' && <AlertTriangle className="h-3 w-3" />}
                      {STATUS_BADGE[p.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function FacebookConnectionCard({ onStatusChange }: { onStatusChange: (connected: boolean) => void }) {
  const { data: status, refetch } = useFetch<any>('/job-sharing/facebook/status');
  const [showForm, setShowForm] = useState(false);
  const [pageId, setPageId] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (status) onStatusChange(!!status.connected); }, [status]);

  async function connect() {
    if (!pageId || !token) { setErr('Page ID and Access Token are both required'); return; }
    setSaving(true); setErr('');
    try {
      await apiFetch('/job-sharing/facebook/connect', { method: 'POST', body: JSON.stringify({ page_id: pageId, page_access_token: token }) });
      setShowForm(false); setPageId(''); setToken('');
      refetch();
    } catch (e: any) { setErr(e.message || 'Connection failed'); }
    finally { setSaving(false); }
  }

  async function disconnect() {
    if (!confirm('Disconnect this Facebook Page? "Facebook" will go back to opening the share dialog instead of posting automatically.')) return;
    await apiFetch('/job-sharing/facebook/disconnect', { method: 'DELETE' });
    refetch();
  }

  return (
    <Card className="border-blue-200 bg-blue-50/40">
      <CardHeader>
        <h2 className="font-semibold flex items-center gap-1.5"><Facebook className="h-4 w-4 text-blue-600" /> Facebook Page — Real Automatic Posting</h2>
      </CardHeader>
      <CardContent>
        {status?.connected ? (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Connected to <strong>{status.page_name}</strong> — Facebook posts go out automatically now, no dialog, no paste.</span>
            </div>
            <button onClick={disconnect} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-2.5 py-1.5">
              <Unlink className="h-3 w-3" /> Disconnect
            </button>
          </div>
        ) : showForm ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">
              One-time setup: create a Facebook App at developers.facebook.com, add your own account as an Admin/Tester on it,
              request the <code className="bg-white px-1 rounded border">pages_manage_posts</code> permission (Standard Access —
              no App Review needed for posting to your own Page), then generate a Page Access Token for your Page and paste both below.
            </p>
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">{err}</div>}
            <input value={pageId} onChange={e => setPageId(e.target.value)} placeholder="Facebook Page ID"
              className="w-full border rounded-lg px-2.5 py-1.5 text-sm" />
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="Page Access Token" type="password"
              className="w-full border rounded-lg px-2.5 py-1.5 text-sm" />
            <div className="flex items-center gap-2">
              <button onClick={connect} disabled={saving}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 disabled:opacity-50">
                <Link2 className="h-3.5 w-3.5" /> {saving ? 'Verifying...' : 'Connect'}
              </button>
              <button onClick={() => { setShowForm(false); setErr(''); }} className="text-xs text-gray-500 px-2 py-1.5">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-600">
              Not connected — Facebook currently opens a share dialog you have to paste into (Facebook blocks pre-filled post text
              for any tool). Connect your Page's API token for genuinely automatic posting instead.
            </p>
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 shrink-0">
              <Link2 className="h-3.5 w-3.5" /> Connect Facebook Page
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TelegramConnectionCard({ onStatusChange }: { onStatusChange: (connected: boolean) => void }) {
  const { data: status, refetch } = useFetch<any>('/job-sharing/telegram/status');
  const [showForm, setShowForm] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (status) onStatusChange(!!status.connected); }, [status]);

  async function connect() {
    if (!botToken || !chatId) { setErr('Bot Token and Channel/Chat ID are both required'); return; }
    setSaving(true); setErr('');
    try {
      await apiFetch('/job-sharing/telegram/connect', { method: 'POST', body: JSON.stringify({ bot_token: botToken, chat_id: chatId }) });
      setShowForm(false); setBotToken(''); setChatId('');
      refetch();
    } catch (e: any) { setErr(e.message || 'Connection failed'); }
    finally { setSaving(false); }
  }

  async function disconnect() {
    if (!confirm('Disconnect this Telegram channel? "Telegram" will go back to opening the share dialog instead of posting automatically.')) return;
    await apiFetch('/job-sharing/telegram/disconnect', { method: 'DELETE' });
    refetch();
  }

  return (
    <Card className="border-sky-200 bg-sky-50/40">
      <CardHeader>
        <h2 className="font-semibold flex items-center gap-1.5"><Send className="h-4 w-4 text-sky-600" /> Telegram Channel — Real Automatic Posting</h2>
      </CardHeader>
      <CardContent>
        {status?.connected ? (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Connected to <strong>{status.channel_name}</strong> — Telegram posts go out automatically now, no dialog, no paste.</span>
            </div>
            <button onClick={disconnect} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-2.5 py-1.5">
              <Unlink className="h-3 w-3" /> Disconnect
            </button>
          </div>
        ) : showForm ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">
              One-time setup: message <code className="bg-white px-1 rounded border">@BotFather</code> on Telegram, send{' '}
              <code className="bg-white px-1 rounded border">/newbot</code> and follow the prompts to get a Bot Token (instant,
              no review). Then add that bot as an <strong>admin</strong> of your job-alerts channel and paste the channel's
              Chat ID below (for a public channel, its @username works too, e.g. <code className="bg-white px-1 rounded border">@yourchannel</code>).
            </p>
            {err && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">{err}</div>}
            <input value={botToken} onChange={e => setBotToken(e.target.value)} placeholder="Bot Token" type="password"
              className="w-full border rounded-lg px-2.5 py-1.5 text-sm" />
            <input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="Channel Chat ID (e.g. @yourchannel or -100...)"
              className="w-full border rounded-lg px-2.5 py-1.5 text-sm" />
            <div className="flex items-center gap-2">
              <button onClick={connect} disabled={saving}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg px-3 py-1.5 disabled:opacity-50">
                <Link2 className="h-3.5 w-3.5" /> {saving ? 'Verifying...' : 'Connect'}
              </button>
              <button onClick={() => { setShowForm(false); setErr(''); }} className="text-xs text-gray-500 px-2 py-1.5">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-600">
              Not connected — Telegram currently opens a share dialog you have to click through. Connect a bot for genuinely
              automatic posting to your own job-alerts channel instead (free, no approval process, ~2 minutes to set up).
            </p>
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded-lg px-3 py-1.5 shrink-0">
              <Link2 className="h-3.5 w-3.5" /> Connect Telegram Channel
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Gap-audit addition (2026-09-02) — genuinely simpler than Facebook/
// Telegram's own connect forms: no credential to type at all, since this
// reuses the already-connected shared WhatsApp number. "Connecting" is
// just picking which real channel (that number administers) should get
// the auto-posts, from a real, live list — never a raw JID typed by hand.
function WhatsAppChannelConnectionCard({ onStatusChange }: { onStatusChange: (connected: boolean) => void }) {
  const { data: status, refetch } = useFetch<any>('/job-sharing/whatsapp-channel/status');
  const [showPicker, setShowPicker] = useState(false);
  const [channels, setChannels] = useState<any[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState('');

  useEffect(() => { if (status) onStatusChange(!!status.connected); }, [status]);

  async function openPicker() {
    setShowPicker(true); setLoading(true); setLoadErr(''); setChannels(null);
    try {
      const data = await apiFetch('/job-sharing/whatsapp-channel/available');
      setChannels(data as any[]);
    } catch (e: any) { setLoadErr(e.message || 'Could not load channels'); }
    finally { setLoading(false); }
  }

  async function connectTo(c: any) {
    setConnecting(c.id);
    try {
      await apiFetch('/job-sharing/whatsapp-channel/connect', { method: 'POST', body: JSON.stringify({ channel_id: c.id, channel_name: c.name }) });
      setShowPicker(false);
      refetch();
    } catch (e: any) { setLoadErr(e.message || 'Connect failed'); }
    finally { setConnecting(''); }
  }

  async function disconnect() {
    if (!confirm('Disconnect this WhatsApp Channel? Job posts will stop going out to it automatically.')) return;
    await apiFetch('/job-sharing/whatsapp-channel/disconnect', { method: 'DELETE' });
    refetch();
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <CardHeader>
        <h2 className="font-semibold flex items-center gap-1.5"><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp Channel — Real Automatic Posting</h2>
      </CardHeader>
      <CardContent>
        {status?.connected ? (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Connected to <strong>{status.channel_name}</strong> — job posts go out automatically now.</span>
            </div>
            <button onClick={disconnect} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-2.5 py-1.5">
              <Unlink className="h-3 w-3" /> Disconnect
            </button>
          </div>
        ) : showPicker ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-2">
              Uses your already-connected WhatsApp number (see Company WhatsApp Number in Settings) — no new credential
              needed. Pick one of the real Channels that number already administers as an Owner/Admin. Don't see the right
              one? Create it once in the WhatsApp app itself, then reopen this list.
            </p>
            {loadErr && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">{loadErr}</div>}
            {loading && <p className="text-xs text-gray-500">Loading your real channels…</p>}
            {channels && channels.length === 0 && !loadErr && (
              <p className="text-xs text-gray-500">This number doesn't administer any WhatsApp Channels yet — create one in the WhatsApp app first.</p>
            )}
            {channels && channels.length > 0 && (
              <div className="space-y-1.5">
                {channels.map((c: any) => (
                  <button key={c.id} onClick={() => connectTo(c)} disabled={!!connecting}
                    className="w-full flex items-center justify-between text-left border rounded-lg px-2.5 py-1.5 text-sm hover:border-emerald-400 hover:bg-white disabled:opacity-50">
                    <span>{c.name || c.id}</span>
                    <span className="text-xs text-emerald-600 font-medium">{connecting === c.id ? 'Connecting…' : 'Use this channel'}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setShowPicker(false)} className="text-xs text-gray-500 px-2 py-1.5">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-gray-600">
              Not connected — reuses your existing WhatsApp connection, no bot token or app review needed, ~10 seconds to
              set up once you have a real Channel.
            </p>
            <button onClick={openPicker}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5 shrink-0">
              <Link2 className="h-3.5 w-3.5" /> Connect WhatsApp Channel
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Integrations tab ───────────────────────────────────────────────────────
// Pulled the two "connect once" API integrations plus the free-feed
// registration out of the per-job Distribute flow into their own settings
// area — connecting a Page/bot is a one-time setup action, not something
// that belongs mixed into "post this specific job" every time.
function RebumpConfigCard() {
  // Gap-audit fix (2026-09-02): "no scheduled re-posting" - a listing
  // posts once and sinks in a recency-ranked feed with no way to bump
  // it. Real, opt-in, off-by-default weekly re-post to whichever
  // connected auto-channel's post for a still-open job is older than
  // the configured threshold.
  const { data, refetch } = useFetch<any>('/job-sharing/rebump-config');
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState(14);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setDays(data.rebump_after_days); }, [data]);

  async function toggle(enabled: boolean) {
    setSaving(true);
    try {
      await apiFetch('/job-sharing/rebump-config', { method: 'PUT', body: JSON.stringify({ auto_rebump_enabled: enabled, rebump_after_days: days }) });
      refetch();
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } finally { setSaving(false); }
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader><h2 className="font-semibold flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400" /> Scheduled Re-post ("Bump")</h2></CardHeader>
      <CardContent>
        <p className="text-xs text-gray-500 mb-3">
          Most free boards rank by recency — a role open for weeks quietly sinks. When enabled, every Monday a still-open job
          gets re-posted to any connected auto-channel (Facebook / Telegram / WhatsApp Channel) whose most recent post for it
          is older than the threshold below. Off by default.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!data.auto_rebump_enabled} disabled={saving}
              onChange={e => toggle(e.target.checked)} className="h-4 w-4" />
            Auto re-post stale listings
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            Re-post after
            <input type="number" min={1} max={90} value={days} disabled={saving}
              onChange={e => setDays(Number(e.target.value) || 14)}
              onBlur={() => data.auto_rebump_enabled && toggle(true)}
              className="w-14 border rounded px-1.5 py-1 text-center" />
            days of no new post
          </label>
          {saved && <span className="text-xs text-green-600 font-medium">Saved</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationsTab({ feedInfo, feedCopied, onCopyFeed, onFbStatus, onTgStatus, onWaStatus }: any) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 border rounded-xl px-4 py-3.5 bg-white">
        <div className="p-2 rounded-lg bg-purple-50 shrink-0"><Plug className="h-4 w-4 text-purple-600" /></div>
        <div>
          <div className="text-sm font-semibold text-gray-900">Connect your accounts once</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Once connected, every new requisition posts here <strong>automatically</strong> the moment it goes open — right
            when it's created (or, if this tenant uses the approval chain, the moment it clears final approval). No need to
            visit the Distribute tab for these three — it's still there if you want to re-post, check status, or reach
            every other free board (those don't have an API to auto-post to, so they stay manual for everyone, not just here).
          </div>
        </div>
      </div>

      <FacebookConnectionCard onStatusChange={onFbStatus} />
      <TelegramConnectionCard onStatusChange={onTgStatus} />
      <WhatsAppChannelConnectionCard onStatusChange={onWaStatus} />
      <RebumpConfigCard />

      {feedInfo && (
        <Card className="border-green-200 bg-green-50/40">
          <CardHeader>
            <h2 className="font-semibold flex items-center gap-1.5"><Zap className="h-4 w-4 text-green-600" /> Automatic Distribution (Free, Zero-Click)</h2>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 mb-3">
              This is the real "post once, auto-distribute everywhere" mechanism — the same one every ATS actually relies on for
              its free tier. <strong>Google for Jobs</strong> is already fully automatic (structured data ships on every job
              listing — nothing to set up). For Indeed/Jooble's free organic listings, register the feed URL below <em>once</em> —
              every future open requisition then appears automatically, no manual posting, ever again.
            </p>
            <div className="flex items-center gap-2 mb-3">
              <input readOnly value={feedInfo.feed_url}
                className="flex-1 border rounded-lg px-2.5 py-1.5 text-xs bg-white font-mono text-gray-600" />
              <button onClick={onCopyFeed}
                className="flex items-center gap-1 text-xs text-white bg-green-600 hover:bg-green-700 rounded-lg px-3 py-1.5 shrink-0">
                <Copy className="h-3 w-3" /> {feedCopied ? 'Copied!' : 'Copy Feed URL'}
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {(feedInfo.registration_steps || []).map((s: any) => (
                <a key={s.platform} href={s.url} target="_blank" rel="noopener noreferrer"
                  className="border rounded-lg px-3 py-2 text-xs bg-white hover:border-green-300 hover:bg-green-50">
                  <div className="font-medium text-gray-700">{s.platform}</div>
                  <div className="text-gray-400 mt-0.5">{s.how}</div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BulkDistributeAllCard({ connectedCount }: { connectedCount: number }) {
  // Gap-audit fix (2026-09-02): every real distribution action operated
  // on exactly one requisition at a time before this - a recruiter
  // revisiting distribution after a gap had to click through jobs one
  // by one. Calls the real backend bulk endpoint, which reuses
  // auto_distribute_on_open() per job (already skips a platform already
  // posted-to for that specific job).
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState('');

  async function run() {
    if (connectedCount === 0) return;
    if (!confirm('Distribute every currently open job to all connected auto-channels (Facebook / Telegram / WhatsApp Channel)? Jobs already posted to a channel are skipped for that channel.')) return;
    setRunning(true); setErr(''); setResult(null);
    try {
      const res = await apiFetch('/job-sharing/distribute-all', { method: 'POST' });
      setResult(res);
    } catch (e: any) {
      setErr(e.message || 'Bulk distribution failed');
    } finally { setRunning(false); }
  }

  return (
    <Card className="border-purple-200 bg-purple-50/40">
      <CardContent className="flex items-center justify-between flex-wrap gap-3 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-100"><Rocket className="h-4 w-4 text-purple-700" /></div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Distribute all open jobs</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {connectedCount === 0
                ? 'Connect at least one auto-channel (Facebook, Telegram, or WhatsApp Channel) on the Integrations tab first.'
                : `Posts every currently open job to your ${connectedCount} connected auto-channel${connectedCount > 1 ? 's' : ''} in one action, skipping anything already posted.`}
            </div>
            {result && (
              <div className="text-xs text-green-700 font-medium mt-1">
                Done — {result.jobs_processed} open job{result.jobs_processed === 1 ? '' : 's'} checked, {result.jobs_with_new_posts} had a new post.
              </div>
            )}
            {err && <div className="text-xs text-red-600 font-medium mt-1">{err}</div>}
          </div>
        </div>
        <button onClick={run} disabled={running || connectedCount === 0}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-40 rounded-lg px-4 py-2 shrink-0">
          {running ? <Spinner size="sm" /> : <Rocket className="h-3.5 w-3.5" />}
          {running ? 'Distributing…' : 'Distribute All'}
        </button>
      </CardContent>
    </Card>
  );
}

function JobSharingPageInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<'distribute' | 'integrations' | 'analytics'>('distribute');
  const { data: reqs } = useFetch<any[]>('/requisitions');
  const [selId, setSelId] = useState('');
  useEffect(() => {
    const reqParam = searchParams.get('req');
    if (reqParam) setSelId(reqParam);
  }, [searchParams]);
  const { data: links, loading } = useFetch<any>(selId ? `/job-sharing/requisition/${selId}` : null);
  const { data: feedInfo } = useFetch<any>('/job-sharing/feed-info');
  const [feedCopied, setFeedCopied] = useState(false);
  const { data: sharedData, refetch: refetchShared } = useFetch<any>(selId ? `/job-sharing/shared/${selId}` : null);
  const { data: issuesData, refetch: refetchIssues } = useFetch<any[]>('/job-sharing/issues?status=open');
  const [posted, setPosted] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const [issuePortal, setIssuePortal] = useState<Portal | null>(null);
  const [clearing, setClearing] = useState(false);
  const [fbConnected, setFbConnected] = useState(false);
  const [fbPosting, setFbPosting] = useState(false);
  const [tgConnected, setTgConnected] = useState(false);
  const [tgPosting, setTgPosting] = useState(false);
  const [waConnected, setWaConnected] = useState(false);
  const [waPosting, setWaPosting] = useState(false);

  useEffect(() => {
    // Restore real server-recorded share state on load/select (was
    // previously lost on every page refresh - see /job-sharing/log fix).
    const platforms: string[] = sharedData?.platforms || [];
    setPosted(Object.fromEntries(platforms.map(p => [p, true])));
  }, [sharedData]);

  const portals: Portal[] = links?.portals || [];
  const autoPortals = portals.filter(p => AUTO_CHANNELS.includes(p.key));
  const manualPortals = portals.filter(p => !AUTO_CHANNELS.includes(p.key));

  const categories = useMemo(() => Array.from(new Set(manualPortals.map(p => p.category))), [manualPortals]);

  const filteredManual = manualPortals.filter(p =>
    (!catFilter || p.category === catFilter) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase())));

  const grouped = useMemo(() => {
    const g: Record<string, Portal[]> = {};
    for (const p of filteredManual) (g[p.category] ||= []).push(p);
    return g;
  }, [filteredManual]);

  function logShare(platform: string, shareUrl: string) {
    setPosted(p => ({ ...p, [platform]: true }));
    apiFetch('/job-sharing/log', { method: 'POST', body: JSON.stringify({ req_id: selId, platform, share_url: shareUrl }) }).catch(() => {});
  }

  async function postToFacebookApi() {
    setFbPosting(true);
    try {
      const res = await apiFetch('/job-sharing/facebook/post', { method: 'POST', body: JSON.stringify({ req_id: selId }) });
      setPosted(p => ({ ...p, facebook: true }));
      refetchShared();
      window.open(res.post_url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      alert(`Facebook post failed: ${e.message || 'unknown error'}`);
    } finally { setFbPosting(false); }
  }

  async function postToTelegramApi() {
    setTgPosting(true);
    try {
      const res = await apiFetch('/job-sharing/telegram/post', { method: 'POST', body: JSON.stringify({ req_id: selId }) });
      setPosted(p => ({ ...p, telegram: true }));
      refetchShared();
      window.open(res.post_url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      alert(`Telegram post failed: ${e.message || 'unknown error'}`);
    } finally { setTgPosting(false); }
  }

  async function postToWhatsappChannelApi() {
    setWaPosting(true);
    try {
      await apiFetch('/job-sharing/whatsapp-channel/post', { method: 'POST', body: JSON.stringify({ req_id: selId }) });
      setPosted(p => ({ ...p, whatsapp_channel: true }));
      refetchShared();
    } catch (e: any) {
      alert(`WhatsApp Channel post failed: ${e.message || 'unknown error'}`);
    } finally { setWaPosting(false); }
  }

  function openPortal(p: Portal) {
    // A connected Facebook Page / Telegram channel / WhatsApp Channel
    // posts for real, no dialog at all - see postToFacebookApi/
    // postToTelegramApi/postToWhatsappChannelApi. Everything else still
    // uses the share-dialog/homepage link.
    if (p.key === 'facebook' && fbConnected) { postToFacebookApi(); return; }
    if (p.key === 'telegram' && tgConnected) { postToTelegramApi(); return; }
    if (p.key === 'whatsapp_channel' && waConnected) { postToWhatsappChannelApi(); return; }
    // Facebook and LinkedIn both stopped letting any tool pre-fill the
    // actual post text years ago (anti-spam policy - not fixable, applies
    // to every product, not just this one) - their dialogs open with a
    // blank text box no matter what URL params are sent. Auto-copy the
    // message so it's one paste (Ctrl+V) instead of typing from scratch.
    const needsClipboardCopy = !p.share_intent || p.key === 'facebook' || p.key === 'linkedin';
    if (needsClipboardCopy && links?.job_description_text) {
      navigator.clipboard.writeText(links.job_description_text).catch(() => {});
    }
    window.open(p.link, '_blank', 'noopener,noreferrer');
    logShare(p.key, p.link);
  }

  function shareToAllAuto() {
    if (links?.job_description_text) navigator.clipboard.writeText(links.job_description_text).catch(() => {});
    autoPortals.forEach((p, i) => {
      setTimeout(() => {
        if (p.key === 'facebook' && fbConnected) { postToFacebookApi(); return; }
        if (p.key === 'telegram' && tgConnected) { postToTelegramApi(); return; }
        if (p.key === 'whatsapp_channel' && waConnected) { postToWhatsappChannelApi(); return; }
        window.open(p.link, '_blank', 'noopener,noreferrer');
        logShare(p.key, p.link);
      }, i * 250);
    });
  }

  async function clearShared() {
    if (!selId || !confirm('Clear all "posted" checkmarks for this requisition? This only resets tracking — it does not remove your listing from any portal.')) return;
    setClearing(true);
    try {
      await apiFetch(`/job-sharing/clear/${selId}`, { method: 'POST' });
      setPosted({});
      refetchShared();
    } finally { setClearing(false); }
  }

  async function resolveIssue(id: string) {
    await apiFetch(`/job-sharing/issues/${id}/resolve`, { method: 'PATCH' });
    refetchIssues();
  }

  const sharedCount = Object.keys(posted).length;
  const totalPortals = portals.length;
  const openIssues = issuesData || [];
  // A portal already flagged broken should say so right in the grid, not
  // only in the panel further down the page - otherwise the next person
  // clicks it not knowing it's a known dead link.
  const flaggedKeys = useMemo(() => new Set(openIssues.map((i: any) => i.portal_key)), [openIssues]);

  const selectedReq = (reqs || []).find((r: any) => r.id === selId);
  const connectedCount = (fbConnected ? 1 : 0) + (tgConnected ? 1 : 0) + (waConnected ? 1 : 0);

  return (
    <div className="space-y-6" data-testid="job-sharing-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-50"><Share2 className="h-5 w-5 text-purple-600" /></div>
          <div>
            <h1 className="text-2xl font-bold">Job Distribution</h1>
            <p className="text-sm text-gray-500">Post once, reach {totalPortals || '80+'} free job boards · {connectedCount}/3 accounts connected for real automatic posting</p>
          </div>
        </div>
        <div className="flex items-center border rounded-lg overflow-hidden bg-white">
          <button data-testid="tab-distribute" onClick={() => setTab('distribute')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${tab === 'distribute' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Share2 className="h-3.5 w-3.5" /> Distribute
          </button>
          <button data-testid="tab-integrations" onClick={() => setTab('integrations')}
            className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-l ${tab === 'integrations' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <Plug className="h-3.5 w-3.5" /> Integrations
            {connectedCount === 0 && (
              <span className={`w-1.5 h-1.5 rounded-full ${tab === 'integrations' ? 'bg-white' : 'bg-amber-500'}`} />
            )}
          </button>
          <button data-testid="tab-analytics" onClick={() => setTab('analytics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-l ${tab === 'analytics' ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <BarChart3 className="h-3.5 w-3.5" /> Analytics
          </button>
        </div>
      </div>

      {tab === 'analytics' && <DashboardView />}

      {tab === 'integrations' && (
        <IntegrationsTab
          feedInfo={feedInfo} feedCopied={feedCopied}
          onCopyFeed={() => navigator.clipboard.writeText(feedInfo.feed_url).then(() => { setFeedCopied(true); setTimeout(() => setFeedCopied(false), 2000); })}
          onFbStatus={setFbConnected} onTgStatus={setTgConnected} onWaStatus={setWaConnected}
        />
      )}

      {tab === 'distribute' && (<>
        <BulkDistributeAllCard connectedCount={connectedCount} />
        <Card>
          <CardHeader><h2 className="font-semibold flex items-center gap-1.5"><Briefcase className="h-4 w-4 text-gray-400" /> Choose a job</h2></CardHeader>
          <CardContent>
            <select value={selId} onChange={e => { setSelId(e.target.value); setPosted({}); }}
              className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select an open requisition to distribute…</option>
              {(reqs || []).filter((r: any) => r.status === 'open').map((r: any) => (
                <option key={r.id} value={r.id}>{r.title} — {r.location}</option>
              ))}
            </select>
            {selectedReq && (
              <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-gray-500">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {selectedReq.location || 'Location TBD'}</span>
                {selectedReq.employment_type && <><span className="text-gray-300">·</span><span>{selectedReq.employment_type}</span></>}
              </div>
            )}
          </CardContent>
        </Card>

        {selId && (loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : links && (<>
          <Card>
            <CardHeader className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="font-semibold">Auto channels</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Facebook and Telegram post for real with zero clicks once connected (see the Integrations tab). The rest open pre-filled — WhatsApp, Telegram share-dialog, X and Email have the message typed in already; Facebook and LinkedIn block pre-filled text platform-wide, so those two copy the message to your clipboard first (one paste).
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={clearShared} disabled={clearing || sharedCount === 0}
                  title="Clear posted checkmarks for this requisition"
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 border rounded-lg px-2.5 py-1.5 disabled:opacity-40">
                  <RotateCcw className="h-3.5 w-3.5" /> Clear
                </button>
                <button onClick={shareToAllAuto}
                  className="flex items-center gap-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg px-3 py-1.5">
                  <Share2 className="h-3.5 w-3.5" /> Distribute to all {autoPortals.length}
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {autoPortals.map(p => {
                  const isFbAuto = p.key === 'facebook' && fbConnected;
                  const isTgAuto = p.key === 'telegram' && tgConnected;
                  const isWaAuto = p.key === 'whatsapp_channel' && waConnected;
                  const isAuto = isFbAuto || isTgAuto || isWaAuto;
                  const busy = (isFbAuto && fbPosting) || (isTgAuto && tgPosting) || (isWaAuto && waPosting);
                  const isDone = !!posted[p.key];
                  const isFlagged = flaggedKeys.has(p.key);
                  const meta = CHANNEL_META[p.key];
                  const Icon = meta?.icon || ExternalLink;
                  return (
                    <div key={p.key} className="relative group">
                      <button onClick={() => openPortal(p)} disabled={busy}
                        title={isFlagged ? 'Known issue reported for this portal' : isAuto ? 'Posts automatically via connected API' : undefined}
                        className={`w-full flex flex-col items-center gap-1.5 py-3.5 px-2 rounded-xl border-2 text-center transition-colors
                          ${isFlagged ? 'bg-amber-50 border-amber-300' :
                            isDone ? 'bg-green-50 border-green-300' :
                            'bg-white border-gray-200 hover:border-gray-300'}`}>
                        <div className={`relative w-9 h-9 rounded-full flex items-center justify-center ${meta?.iconBg || 'bg-gray-100'}`}>
                          {busy ? <Spinner size="sm" /> : <Icon className={`h-4.5 w-4.5 ${meta?.iconColor || 'text-gray-500'}`} style={{ width: 18, height: 18 }} />}
                          {isAuto && !busy && (
                            <span className="absolute -bottom-0.5 -right-0.5 bg-blue-600 rounded-full p-[3px] ring-2 ring-white">
                              <Zap className="h-2 w-2 text-white" />
                            </span>
                          )}
                          {isDone && !busy && (
                            <span className="absolute -bottom-0.5 -right-0.5 bg-green-600 rounded-full p-[3px] ring-2 ring-white">
                              <CheckCircle2 className="h-2 w-2 text-white" />
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-medium text-gray-800">{p.name}</span>
                        <span className={`text-[10px] font-medium ${isFlagged ? 'text-amber-700' : isAuto ? 'text-blue-600' : isDone ? 'text-green-700' : 'text-gray-400'}`}>
                          {isFlagged ? 'Issue reported' : isAuto ? 'Auto-post' : isDone ? 'Posted' : 'Share dialog'}
                        </span>
                      </button>
                      <button onClick={() => setIssuePortal(p)} title="Report issue"
                        className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Flag className="h-3 w-3 text-red-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-semibold">{manualPortals.length} more free portals</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search portal..."
                    className="pl-7 pr-2 py-1.5 border rounded-lg text-xs w-40" />
                </div>
                <button onClick={() => navigator.clipboard.writeText(links.job_description_text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
                  className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 border rounded-lg px-2.5 py-1.5">
                  <Copy className="h-3 w-3" /> {copied ? 'Copied!' : 'Copy JD'}
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-gray-400 mb-3">
                No public posting API exists for these (true of nearly every free board — they require your own logged-in employer account). Each card copies the job description and opens the portal to paste + submit. Hover and click the flag to report a broken link.
              </p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                <button onClick={() => setCatFilter('')}
                  className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${!catFilter ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                  All ({manualPortals.length})
                </button>
                {categories.map(c => {
                  const count = manualPortals.filter(p => p.category === c).length;
                  return (
                    <button key={c} onClick={() => setCatFilter(catFilter === c ? '' : c)}
                      className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${catFilter === c ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
                      {CATEGORY_LABELS[c] || c} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="space-y-4">
                {Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat}>
                    {!catFilter && <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">{CATEGORY_LABELS[cat] || cat} ({list.length})</div>}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {list.map(p => (
                        <div key={p.key} className="relative group">
                          <button onClick={() => openPortal(p)} title={flaggedKeys.has(p.key) ? 'Known issue reported for this portal' : undefined}
                            className={`w-full flex items-center justify-between gap-1.5 py-2 px-3 rounded-lg text-xs font-medium border transition-colors
                              ${flaggedKeys.has(p.key) ? 'bg-amber-50 border-amber-300 text-amber-800' :
                                posted[p.key] ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300 hover:bg-purple-50'}`}>
                            <span className="truncate">{p.name}</span>
                            {flaggedKeys.has(p.key) ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> :
                             posted[p.key] ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <ExternalLink className="h-3 w-3 shrink-0 text-gray-400" />}
                          </button>
                          <button onClick={() => setIssuePortal(p)} title="Report issue"
                            className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Flag className="h-3 w-3 text-red-500" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(grouped).length === 0 && (
                  <div className="text-center py-8 text-sm text-gray-400">No portals match "{search}"</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="font-semibold">WhatsApp message preview</h2>
              <button onClick={() => navigator.clipboard.writeText(links.whatsapp_message)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 border rounded px-2 py-1">
                <Copy className="h-3 w-3" /> Copy
              </button>
            </CardHeader>
            <CardContent><pre className="text-sm bg-gray-50 rounded-xl p-4 whitespace-pre-wrap font-sans">{links.whatsapp_message}</pre></CardContent>
          </Card>

          <div className="text-xs text-gray-400">
            {sharedCount} of {totalPortals} portals posted for this requisition · Resumes from applicants who apply via email (most free portals notify by email)
            land automatically in Resume Inbox, source-tagged by portal.
          </div>
        </>))}

        {openIssues.length > 0 && (
          <Card>
            <CardHeader><h2 className="font-semibold text-red-600">Reported Issues ({openIssues.length})</h2></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {openIssues.map((i: any) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium">{i.portal_name}</span>
                      <span className="text-gray-400 mx-1.5">·</span>
                      <span className="text-xs text-gray-500">{ISSUE_TYPES.find(t => t.value === i.issue_type)?.label || i.issue_type}</span>
                      {i.requisition_title && <span className="text-xs text-gray-400"> · {i.requisition_title}</span>}
                      {i.note && <div className="text-xs text-gray-500 truncate">{i.note}</div>}
                    </div>
                    <button onClick={() => resolveIssue(i.id)}
                      className="shrink-0 text-xs px-2.5 py-1 rounded-lg border text-green-700 border-green-200 bg-green-50 hover:bg-green-100">
                      Resolve
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </>)}

      {issuePortal && (
        <ReportIssueModal portal={issuePortal} reqId={selId}
          onClose={() => setIssuePortal(null)}
          onReported={refetchIssues} />
      )}
    </div>
  );
}

export default function JobSharingPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-10"><Spinner size="lg" /></div>}>
      <JobSharingPageInner />
    </Suspense>
  );
}
