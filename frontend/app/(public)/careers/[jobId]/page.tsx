import type { Metadata } from 'next';
import JobDetailClient from './JobDetailClient';

const TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce';
// Server-side fetches run inside the Node process, not a browser - a
// relative /api path (what the client uses) isn't a valid fetch() target
// there. Hit the backend container directly over the internal Docker
// network rather than round-tripping through the public domain/nginx.
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://backend:8080';
const PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ats.aviinjobs.com';

interface Job {
  id: string;
  title: string;
  location: string | null;
  employment_type: string | null;
  description: string | null;
  skills_required: string[];
  positions_count: number;
  created_at: string;
}

async function fetchJob(jobId: string): Promise<Job | null> {
  try {
    const r = await fetch(
      `${INTERNAL_API_URL}/public/jobs/${jobId}?tenant_id=${TENANT_ID}`,
      { cache: 'no-store' }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { jobId: string } }): Promise<Metadata> {
  const job = await fetchJob(params.jobId);
  if (!job) {
    return { title: 'Job Not Found — AVIIN Jobs Services' };
  }
  const title = `${job.title}${job.location ? ` — ${job.location}` : ''} | AVIIN Jobs Services`;
  const description = (job.description || `${job.title} opportunity at AVIIN Jobs Services.`).slice(0, 200);
  const url = `${PUBLIC_APP_URL}/careers/${job.id}`;
  // These are what Facebook/LinkedIn/Twitter's link-preview crawlers
  // actually read - they fetch the raw HTML and never execute JS, so this
  // has to be server-rendered metadata, not something set client-side.
  return {
    title,
    description,
    openGraph: { title, description, url, type: 'website', siteName: 'AVIIN Jobs Services' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function JobDetailPage({ params }: { params: { jobId: string } }) {
  const job = await fetchJob(params.jobId);
  return <JobDetailClient job={job} />;
}
