// Shared constants for the WhatsApp Screening funnel and the
// sourcing_status funnel ("Screening Tracker"). Extracted out of
// screening/page.tsx and sourcing-tracker/page.tsx (2026-09-19) rather
// than exported directly from those page.tsx files -- Next.js's App
// Router build forbids arbitrary named exports from a page module (only
// the known route-config exports like `default`/`metadata` are allowed;
// confirmed by a real `next build` type error, not a guess), so the
// Recruitment Dashboard needed a real shared module to import these
// from instead of redefining them a third time.

export const FUNNEL_LABELS: Record<string, string> = {
  pending_optin: 'Pending opt-in', sent: 'Sent, awaiting reply', awaiting_screening: 'Consented',
  in_progress: 'Answering questions', awaiting_resume: 'Awaiting resume', completed: 'Completed',
  declined: 'Declined', opted_out: 'Opted out', no_response: 'No response', bad_number: 'Bad number',
};

export const SOURCING_STATUSES = [
  { value: 'sourced', label: 'Sourced' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'whatsapp_sent', label: 'WhatsApp Sent' },
  { value: 'interested', label: 'Interested' },
  { value: 'not_interested', label: 'Not Interested' },
  { value: 'screening_pending', label: 'Screening Pending' },
  { value: 'screening_completed', label: 'Screening Completed' },
  { value: 'qualified', label: 'Qualified' },
];
export const STATUS_LABEL = Object.fromEntries(SOURCING_STATUSES.map(s => [s.value, s.label]));
