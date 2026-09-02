import type { Metadata } from 'next';
import JobDetailClient from './JobDetailClient';

const TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce';
// Server-side fetches run inside the Node process, not a browser - a
// relative /api path (what the client uses) isn't a valid fetch() target
// there. Hit the backend container directly over the internal Docker
// network rather than round-tripping through the public domain/nginx.
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://backend:8080';
const PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://ats.aviinjobs.com';

interface RelatedJob {
  id: string;
  title: string;
  location: string | null;
  employment_type: string | null;
}

interface Job {
  id: string;
  title: string;
  location: string | null;
  employment_type: string | null;
  employment_types?: string[];
  work_modes?: string[];
  experience_min?: number | null;
  experience_max?: number | null;
  mandatory_skills?: string[];
  description: string | null;
  skills_required: string[];
  positions_count: number;
  created_at: string;
  budget_min: number | null;
  budget_max: number | null;
  company_name: string;
  related_jobs?: RelatedJob[];
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
    return { title: 'Job Not Found' };
  }
  // Gap-audit fix (2026-09-02): job.company_name is now the real tenant
  // name (a real DB join in public_get_job) instead of a hardcoded
  // literal - a real bug for a multi-tenant deployment, confirmed via
  // grep as 16 hardcoded occurrences across these public pages before
  // this fix.
  const company = job.company_name || 'Careers';
  const title = `${job.title}${job.location ? ` — ${job.location}` : ''} | ${company}`;
  const description = (job.description || `${job.title} opportunity at ${company}.`).slice(0, 200);
  const url = `${PUBLIC_APP_URL}/careers/${job.id}`;
  // These are what Facebook/LinkedIn/Twitter's link-preview crawlers
  // actually read - they fetch the raw HTML and never execute JS, so this
  // has to be server-rendered metadata, not something set client-side.
  return {
    title,
    description,
    openGraph: { title, description, url, type: 'website', siteName: company },
    twitter: { card: 'summary', title, description },
  };
}

export default async function JobDetailPage({ params }: { params: { jobId: string } }) {
  const job = await fetchJob(params.jobId);
  const company = job?.company_name || 'Careers';
  // 2026-09-02 gap-audit fix: this per-job page — the actual URL a real
  // candidate or Googlebot lands on — carried zero Schema.org structured
  // data at all before this; the careers LIST page had real JSON-LD, this
  // one had none. Server-rendered here (not in the client component)
  // since Googlebot's own JobPosting-rich-results crawler, like the
  // OG-tag crawlers generateMetadata above already accounts for, reads
  // raw server HTML rather than executing client JS.
  const jsonLd = job ? {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description || `${job.title} opportunity at ${company}`,
    identifier: { '@type': 'PropertyValue', name: company, value: job.id },
    datePosted: job.created_at,
    employmentType: (job.employment_type || 'FULL_TIME').toUpperCase().replace(/[\s-]/g, '_'),
    hiringOrganization: { '@type': 'Organization', name: company },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: job.location || 'Remote', addressCountry: 'IN' },
    },
    directApply: true,
    ...(job.budget_min != null && job.budget_max != null ? {
      baseSalary: {
        '@type': 'MonetaryAmount',
        currency: 'INR',
        value: { '@type': 'QuantitativeValue', minValue: job.budget_min, maxValue: job.budget_max, unitText: 'YEAR' },
      },
    } : {}),
  } : null;
  return (
    <>
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      )}
      <JobDetailClient job={job} />
    </>
  );
}
