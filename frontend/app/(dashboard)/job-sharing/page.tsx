'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Share2, ExternalLink, Copy, CheckCircle2, Search, Flag, XCircle, RotateCcw, Zap } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { useFetch, apiFetch } from '@/lib/useFetch';

const AUTO_CHANNELS = ['linkedin', 'whatsapp', 'facebook', 'twitter', 'telegram', 'email'];

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

function JobSharingPageInner() {
  const searchParams = useSearchParams();
  const { data: reqs } = useFetch<any[]>('/requisitions');
  const [selId, setSelId] = useState('');
  useEffect(() => {
    const reqParam = searchParams.get('req');
    if (reqParam) setSelId(reqParam);
  }, [searchParams]);
  const { data: links, loading } = useFetch<any>(selId ? `/job-sharing/requisition/${selId}` : null);
  const { data: statsData } = useFetch<any[]>('/job-sharing/stats');
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

  function logShare(platform: string) {
    setPosted(p => ({ ...p, [platform]: true }));
    apiFetch('/job-sharing/log', { method: 'POST', body: JSON.stringify({ req_id: selId, platform }) }).catch(() => {});
  }

  function openPortal(p: Portal) {
    if (!p.share_intent && links?.job_description_text) {
      navigator.clipboard.writeText(links.job_description_text).catch(() => {});
    }
    window.open(p.link, '_blank', 'noopener,noreferrer');
    logShare(p.key);
  }

  function shareToAllAuto() {
    if (links?.job_description_text) navigator.clipboard.writeText(links.job_description_text).catch(() => {});
    autoPortals.forEach((p, i) => {
      setTimeout(() => { window.open(p.link, '_blank', 'noopener,noreferrer'); logShare(p.key); }, i * 250);
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

  return (
    <div className="space-y-6" data-testid="job-sharing-page">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-50"><Share2 className="h-5 w-5 text-purple-600" /></div>
        <div>
          <h1 className="text-2xl font-bold">Job Sharing — {totalPortals || '70+'} Free Portals</h1>
          <p className="text-sm text-gray-500">One click auto-shares to LinkedIn/WhatsApp/Facebook/X/Telegram/Email · JD auto-copied for the rest, ready to paste</p>
        </div>
      </div>

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
              <button onClick={() => navigator.clipboard.writeText(feedInfo.feed_url).then(() => { setFeedCopied(true); setTimeout(() => setFeedCopied(false), 2000); })}
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

      <Card><CardHeader><h2 className="font-semibold">1. Select Open Requisition</h2></CardHeader><CardContent>
        <select value={selId} onChange={e => { setSelId(e.target.value); setPosted({}); }}
          className="w-full border rounded-lg px-3 py-2 text-sm">
          <option value="">Choose requisition...</option>
          {(reqs || []).filter((r: any) => r.status === 'open').map((r: any) => (
            <option key={r.id} value={r.id}>{r.title} — {r.location}</option>
          ))}
        </select>
      </CardContent></Card>

      {selId && (loading ? <div className="flex justify-center py-10"><Spinner size="lg" /></div> : links && (<>
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="font-semibold">2. Auto-Share (zero typing — opens pre-filled)</h2>
            <div className="flex items-center gap-2">
              <button onClick={clearShared} disabled={clearing || sharedCount === 0}
                title="Clear posted checkmarks for this requisition"
                className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 border rounded-lg px-2.5 py-1.5 disabled:opacity-40">
                <RotateCcw className="h-3.5 w-3.5" /> Clear
              </button>
              <button onClick={shareToAllAuto}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg px-3 py-1.5">
                <Share2 className="h-3.5 w-3.5" /> Share to All 6
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              {autoPortals.map(p => (
                <div key={p.key} className="relative group">
                  <button onClick={() => openPortal(p)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium text-white bg-gray-800 hover:opacity-90">
                    {posted[p.key] ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    {p.name}
                  </button>
                  <button onClick={() => setIssuePortal(p)} title="Report issue"
                    className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Flag className="h-3 w-3 text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold">3. Post to {manualPortals.length} More Free Portals</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search portal..."
                  className="pl-7 pr-2 py-1.5 border rounded-lg text-xs w-40" />
              </div>
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                className="border rounded-lg px-2 py-1.5 text-xs">
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
              </select>
              <button onClick={() => navigator.clipboard.writeText(links.job_description_text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
                className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 border rounded-lg px-2.5 py-1.5">
                <Copy className="h-3 w-3" /> {copied ? 'Copied!' : 'Copy JD'}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-400 mb-3">
              These portals don't offer a public posting API (true of nearly every free job board — they require your own logged-in
              employer account). Each button copies the job description and opens the portal so you can paste + submit. Hover a
              portal and click the flag to report a broken link.
            </p>
            <div className="space-y-4">
              {Object.entries(grouped).map(([cat, list]) => (
                <div key={cat}>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">{CATEGORY_LABELS[cat] || cat} ({list.length})</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {list.map(p => (
                      <div key={p.key} className="relative group">
                        <button onClick={() => openPortal(p)}
                          className={`w-full flex items-center justify-between gap-1.5 py-2 px-3 rounded-lg text-xs font-medium border transition-colors
                            ${posted[p.key] ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300 hover:bg-purple-50'}`}>
                          <span className="truncate">{p.name}</span>
                          {posted[p.key] ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <ExternalLink className="h-3 w-3 shrink-0 text-gray-400" />}
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="font-semibold">WhatsApp Message</h2>
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

      {statsData && statsData.length > 0 && (
        <Card>
          <CardHeader><h2 className="font-semibold">All-Time Share Stats</h2></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {statsData.map((s: any) => (
                <div key={s.platform} className="border rounded-lg p-3">
                  <div className="text-xs text-gray-500">{s.platform}</div>
                  <div className="text-lg font-bold">{s.shares}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
