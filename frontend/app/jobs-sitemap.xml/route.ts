// Real jobs sitemap - 2026-09-02 gap-audit fix: /jobs-sitemap.xml
// confirmed 404 live before this. Generated fresh on every request
// straight from the same public jobs API the careers page and the
// existing XML/JSON feeds already use (backend/routers/p28_p32.py's
// public_list_jobs) - no caching to invalidate, so this inherently
// reflects a job going live, being edited, or closing with no extra
// wiring needed. Reaches the backend over Docker's own internal
// service DNS ('backend', the real container/service name in
// docker-compose.yml) rather than depending on the /api rewrite
// chain, matching this project's established service-to-service
// convention (e.g. WAHA_URL=http://waha:3000).
const TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce';
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://backend:8080';
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ats.aviinjobs.com';

export async function GET() {
  let jobs: any[] = [];
  try {
    // Gap-audit fix (2026-09-02, same day): /public/jobs's response
    // shape changed from a bare array to {jobs,total,offset,limit} as
    // part of the real, server-driven pagination fix - this route
    // wasn't updated at the same time, and silently 500'd on every
    // request as a result (jobs.map is not a function once `jobs` was
    // the whole response object, not an array). Caught by this route's
    // own permanent regression test, not in production. limit=500
    // matches the existing /public/jobs/feed.xml's own convention - a
    // sitemap needs every real open job, not just the public board's
    // one-page default.
    const r = await fetch(
      `${INTERNAL_API_URL}/public/jobs?tenant_id=${TENANT_ID}&limit=500`,
      { cache: 'no-store' }
    );
    if (r.ok) {
      const d = await r.json();
      jobs = Array.isArray(d) ? d : (d.jobs || []);
    }
  } catch {
    // A real backend hiccup should never make the sitemap itself 500 -
    // return a structurally valid, empty sitemap instead. A crawler
    // sees "no URLs this time," not a broken response.
  }

  const esc = (s: string) =>
    String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const urls = jobs
    .map((j) => {
      const loc = `${SITE_URL}/careers/${j.id}`;
      const lastmod = j.created_at
        ? new Date(j.created_at).toISOString()
        : new Date().toISOString();
      return `  <url>\n    <loc>${esc(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${esc(SITE_URL + '/careers')}</loc>\n    <changefreq>daily</changefreq>\n  </url>\n${urls}\n</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
