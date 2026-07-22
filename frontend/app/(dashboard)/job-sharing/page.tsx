'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Share2, ExternalLink, Copy, CheckCircle2, Search } from 'lucide-react';
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

interface Portal { key: string; name: string; category: string; share_intent: boolean; link: string; }

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
  const [posted, setPosted] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [copied, setCopied] = useState(false);

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
    apiFetch('/job-sharing/log', { method: 'POST', body: JSON.stringify({ req_id: selId, platform }) });
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

  const sharedCount = Object.keys(posted).length;
  const totalPortals = portals.length;

  return (
    <div className="space-y-6" data-testid="job-sharing-page">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-50"><Share2 className="h-5 w-5 text-purple-600" /></div>
        <div>
          <h1 className="text-2xl font-bold">Job Sharing — {totalPortals || '70+'} Free Portals</h1>
          <p className="text-sm text-gray-500">One click auto-shares to LinkedIn/WhatsApp/Facebook/X/Telegram/Email · JD auto-copied for the rest, ready to paste</p>
        </div>
      </div>

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
            <button onClick={shareToAllAuto}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg px-3 py-1.5">
              <Share2 className="h-3.5 w-3.5" /> Share to All 6
            </button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
              {autoPortals.map(p => (
                <button key={p.key} onClick={() => openPortal(p)}
                  className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium text-white bg-gray-800 hover:opacity-90 relative">
                  {posted[p.key] ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400" /> : <ExternalLink className="h-3.5 w-3.5" />}
                  {p.name}
                </button>
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
              employer account). Each button copies the job description and opens the portal so you can paste + submit.
            </p>
            <div className="space-y-4">
              {Object.entries(grouped).map(([cat, list]) => (
                <div key={cat}>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">{CATEGORY_LABELS[cat] || cat} ({list.length})</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {list.map(p => (
                      <button key={p.key} onClick={() => openPortal(p)}
                        className={`flex items-center justify-between gap-1.5 py-2 px-3 rounded-lg text-xs font-medium border transition-colors
                          ${posted[p.key] ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-700 hover:border-purple-300 hover:bg-purple-50'}`}>
                        <span className="truncate">{p.name}</span>
                        {posted[p.key] ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <ExternalLink className="h-3 w-3 shrink-0 text-gray-400" />}
                      </button>
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
          {sharedCount} of {totalPortals} portals opened this session · Resumes from applicants who apply via email (most free portals notify by email)
          land automatically in Resume Inbox, source-tagged by portal.
        </div>
      </>))}

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
