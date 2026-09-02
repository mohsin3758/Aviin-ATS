// 2026-09-02 gap-audit fix, found while building the jobs sitemap: no
// robots.txt existed at all (confirmed live, 404) - the standard
// mechanism a crawler actually uses to discover a sitemap in the first
// place. A sitemap with nothing pointing at it is far less likely to
// ever get crawled.
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ats.aviinjobs.com';

export async function GET() {
  const body = `User-agent: *\nAllow: /careers\nDisallow: /dashboard\nDisallow: /candidates\nDisallow: /pipeline\nDisallow: /settings\nDisallow: /api\n\nSitemap: ${SITE_URL}/jobs-sitemap.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
