const { chromium } = require('playwright');
const fs = require('fs');

const ROUTES = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/reminders', label: 'Reminders & Follow-Ups' },
  { href: '/candidates', label: 'Candidates' },
  { href: '/companies', label: 'Companies', roles: ['admin','super_admin','kae','kae_manager','lead_recruiter'] },
  { href: '/requisitions', label: 'Jobs / Requisitions', roles: ['admin','super_admin','kae','kae_manager','lead_recruiter'] },
  { href: '/pipeline', label: 'Pipeline (Kanban)' },
  { href: '/pipeline-velocity', label: 'Pipeline Velocity', roles: ['admin','super_admin','lead_recruiter'] },
  { href: '/duplicates', label: 'Duplicate Candidates' },
  { href: '/recruiter-ops', label: 'Recruiter Ops' },
  { href: '/assignments', label: 'Assignment Dashboard' },
  { href: '/device-monitoring', label: 'Device Monitoring' },
  { href: '/field-attendance', label: 'Field Attendance', roles: ['admin','super_admin','manager','lead_recruiter'] },
  { href: '/shift-scheduling', label: 'Shift Scheduling' },
  { href: '/intelligence', label: 'AI Intelligence' },
  { href: '/ai-tools', label: 'AI Tools' },
  { href: '/predictions', label: 'Predictive Hiring' },
  { href: '/resume-inbox', label: 'Resume Inbox' },
  { href: '/interviews', label: 'Interviews' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/video-screening', label: 'Video Screening' },
  { href: '/offers', label: 'Offer Engine' },
  { href: '/nda-documents', label: 'NDA Documents' },
  { href: '/jd-templates', label: 'JD Templates' },
  { href: '/email-templates', label: 'Email Templates' },
  { href: '/question-bank', label: 'Question Bank' },
  { href: '/reference-checks', label: 'Reference Checks' },
  { href: '/submittals', label: 'Submittals' },
  { href: '/jobs', label: 'Job Board' },
  { href: '/job-sharing', label: 'Job Sharing' },
  { href: '/onboarding', label: 'Onboarding' },
  { href: '/candidate-engagement', label: 'Candidate Engagement' },
  { href: '/captured-profiles', label: 'Captured Profiles' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/reports', label: 'Reports' },
  { href: '/sla', label: 'SLA Dashboard' },
  { href: '/revenue-forecast', label: 'Revenue Forecast' },
  { href: '/client-health', label: 'Client Health' },
  { href: '/clients', label: 'Clients & Packs' },
  { href: '/headcount', label: 'Headcount Plan' },
  { href: '/command-center', label: 'War Room' },
  { href: '/report-builder', label: 'Report Builder' },
  { href: '/finance', label: 'ERP / Finance' },
  { href: '/account-pl', label: 'Account P&L' },
  { href: '/collections', label: 'Collections' },
  { href: '/bu-tracker', label: 'BU Tracker' },
  { href: '/ceo-dashboard', label: 'CEO Dashboard' },
  { href: '/compliance', label: 'PF/ESI/TDS' },
  { href: '/salary-benchmark', label: 'Salary Benchmark' },
  { href: '/incentives', label: 'Incentives' },
  { href: '/kae', label: 'KAE Module' },
  { href: '/bgv', label: 'BGV Checks' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/conversations', label: 'Email / Conversations' },
  { href: '/whatsapp', label: 'WhatsApp Bot' },
  { href: '/whatsapp-setup', label: 'WhatsApp Setup' },
  { href: '/sms', label: 'SMS Notifications' },
  { href: '/automations', label: 'Automations' },
  { href: '/nurture', label: 'Nurture Sequences' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/vendor-analytics', label: 'Vendor Analytics' },
  { href: '/agency-portal', label: 'Agency Portal' },
  { href: '/settings/users', label: 'Users & Roles' },
  { href: '/settings/permissions', label: 'Permissions', roles: ['admin','super_admin'] },
  { href: '/settings/pipeline', label: 'Pipeline Stages' },
  { href: '/settings/email', label: 'Company Email (SMTP)' },
  { href: '/settings/signatures', label: 'Email Signatures' },
  { href: '/security', label: 'Security / 2FA' },
  { href: '/settings/skills', label: 'Skills Taxonomy' },
  { href: '/themes', label: '6 Themes' },
  { href: '/ops-settings', label: 'Ops Settings', roles: ['admin','super_admin','manager'] },
  { href: '/settings/mail-accounts', label: 'My Email Accounts' },
  { href: '/profile', label: 'My Profile' },
];

// Real credentials are passed via env vars, never hardcoded here - this
// file is committed to the repo. Usage:
//   QA_SWEEP_EMAIL=... QA_SWEEP_PW=... node tests/sidebar_sweep.js <role>
const ROLE_LOGINS = {
  admin: { email: 'admin@example.com', password: 'changeme' },
  kae: { email: process.env.QA_SWEEP_EMAIL, password: process.env.QA_SWEEP_PW },
  recruiter: { email: process.env.QA_SWEEP_EMAIL, password: process.env.QA_SWEEP_PW },
};

function isVisibleFor(route, role) {
  if (!route.roles) return true;
  return route.roles.includes(role);
}

(async () => {
  const roleArg = process.argv[2];
  if (!roleArg || !ROLE_LOGINS[roleArg]) {
    console.error('Usage: node sidebar_sweep.js <admin|kae|recruiter>');
    process.exit(1);
  }
  const creds = ROLE_LOGINS[roleArg];
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('https://ats.aviinjobs.com/login');
  await page.fill('input[type="email"]', creds.email);
  await page.fill('input[type="password"]', creds.password);
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL('**/dashboard**', { timeout: 15000 });
  } catch (e) {
    console.log(JSON.stringify({ role: roleArg, fatal: 'login failed', url: page.url() }));
    await browser.close();
    process.exit(1);
  }

  const results = [];
  for (const route of ROUTES) {
    const shouldSee = isVisibleFor(route, roleArg);
    const errors = [];
    const consoleHandler = (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 150)); };
    page.on('console', consoleHandler);
    let httpStatus = null;
    let bodyLen = 0;
    let hasErrorText = false;
    let navError = null;
    try {
      const resp = await page.goto('https://ats.aviinjobs.com' + route.href, { waitUntil: 'networkidle', timeout: 20000 });
      httpStatus = resp ? resp.status() : null;
      await page.waitForTimeout(600);
      const bodyText = await page.locator('body').innerText().catch(() => '');
      bodyLen = bodyText.length;
      hasErrorText = /application error|500|this page could not be found|404/i.test(bodyText.slice(0, 400));
    } catch (e) {
      navError = e.message.slice(0, 150);
    }
    page.off('console', consoleHandler);
    results.push({
      href: route.href, label: route.label, shouldSee, httpStatus, bodyLen,
      hasErrorText, navError, consoleErrors: errors.slice(0, 3),
    });
  }

  console.log(JSON.stringify({ role: roleArg, results }, null, 2));
  await browser.close();
})();
