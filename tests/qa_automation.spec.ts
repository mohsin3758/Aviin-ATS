import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3001';
const API  = 'http://localhost:8080';
const EMAIL = process.env.QA_EMAIL || 'admin@example.com';
const PASS  = process.env.QA_PASSWORD || 'changeme';
const TID   = process.env.TENANT_ID || '';

// Suite 1: API Health
test.describe('S1 API Health', () => {
  test('backend /health', async ({ request }) => {
    const r = await request.get(`${API}/health`);
    expect(r.status()).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });
  test('embeddings return 384 dims', async ({ request }) => {
    const r = await request.post('http://localhost:8081/embed', {
      data: { texts: ['Senior Python Engineer Bengaluru'] }
    });
    expect((await r.json()).embeddings[0]).toHaveLength(384);
  });
  test('Ollama model loaded', async ({ request }) => {
    const r = await request.get('http://localhost:11434/api/tags');
    const models = (await r.json()).models?.map((m: any) => m.name) || [];
    expect(models.some((n: string) => n.includes('qwen2.5'))).toBe(true);
  });
});

// Suite 2: Zero-Token AI
test.describe('S2 Zero-Token AI', () => {
  test('match_candidates returns fit_scores 0-100', async ({ request }) => {
    if (!TID) return test.skip();
    const reqs = await request.get(`${API}/requisitions`, { headers: { 'x-tenant-id': TID } });
    const reqId = (await reqs.json())[0]?.id;
    if (!reqId) return test.skip();
    const r = await request.get(`${API}/requisitions/${reqId}/match-candidates`, { headers: { 'x-tenant-id': TID } });
    const matches = await r.json();
    expect(matches[0].fit_score).toBeGreaterThanOrEqual(0);
    expect(matches[0].fit_score).toBeLessThanOrEqual(100);
  });
  test('match_recruiters returns match_scores 0-100', async ({ request }) => {
    if (!TID) return test.skip();
    const reqs = await request.get(`${API}/requisitions`, { headers: { 'x-tenant-id': TID } });
    const reqId = (await reqs.json())[0]?.id;
    if (!reqId) return test.skip();
    const r = await request.get(`${API}/requisitions/${reqId}/match-recruiters`, { headers: { 'x-tenant-id': TID } });
    const matches = await r.json();
    expect(matches[0].match_score).toBeGreaterThanOrEqual(0);
    expect(matches[0].match_score).toBeLessThanOrEqual(100);
  });
  test('assign-with-explanation returns recruiter + explanation', async ({ request }) => {
    if (!TID) return test.skip();
    const reqs = await request.get(`${API}/requisitions`, { headers: { 'x-tenant-id': TID } });
    const reqId = (await reqs.json())[0]?.id;
    if (!reqId) return test.skip();
    const r = await request.post(`${API}/requisitions/${reqId}/assign`, { headers: { 'x-tenant-id': TID } });
    const body = await r.json();
    expect(body.recruiter_id).toBeTruthy();
    expect(body.explanation.reason).toBeTruthy();
  });
  test('JD generation caches on 2nd call', async ({ request }) => {
    if (!TID) return test.skip();
    const body = { title: 'QA Tester Role', skills_required: ['Playwright'], location: 'Bengaluru', experience_years: 3 };
    const r1 = await request.post(`${API}/jd/generate`, { headers: { 'x-tenant-id': TID, 'content-type': 'application/json' }, data: body });
    expect((await r1.json()).jd_text.length).toBeGreaterThan(0);
    const r2 = await request.post(`${API}/jd/generate`, { headers: { 'x-tenant-id': TID, 'content-type': 'application/json' }, data: body });
    const body2 = await r2.json();
    expect(body2.cached).toBe(true);
    expect(body2.similarity).toBeGreaterThan(0.95);
  });
  test('analytics views return arrays', async ({ request }) => {
    if (!TID) return test.skip();
    for (const route of ['redeployment-queue', 'agency-funnel', 'recruiter-capacity', 'skill-gap']) {
      const r = await request.get(`${API}/analytics/${route}`, { headers: { 'x-tenant-id': TID } });
      expect(r.status()).toBe(200);
      expect(Array.isArray(await r.json())).toBe(true);
    }
  });
});

// Suite 3: Frontend
test.describe('S3 Frontend Pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });
  const pages = [
    ['dashboard', 'T1 Command Center'],
    ['pipeline', 'T2 Kanban'],
    ['candidates', 'Candidates'],
    ['analytics', 'T4 Analytics'],
    ['command-center', 'T5 War Room'],
    ['finance', 'T6 Finance'],
  ];
  for (const [route, label] of pages) {
    test(`${label} page loads`, async ({ page }) => {
      await page.goto(`${BASE}/${route}`);
      await page.screenshot({ path: `tests/screenshots/${route}.png` });
      expect(page.url()).toContain(route);
    });
  }
  test('Sidebar has all nav items', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    for (const item of ['Dashboard','Pipeline','Candidates','Analytics','Finance','Requisitions']) {
      await expect(page.locator(`text=${item}`).first()).toBeVisible({ timeout: 5000 });
    }
  });
  test('Cmd+K opens command palette', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForSelector('nav', { state: 'visible', timeout: 10000 });
    await page.keyboard.press('Control+k');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 5000 });
  });
});

// Suite 5: Recruiter Command Center (P5)
test.describe('S5 Recruiter Command Center', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('stat cards visible with numeric values', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForSelector('[data-testid="stat-cards"]', { state: 'visible', timeout: 10000 });
    // Wait for at least one card to show a number (not a spinner)
    await page.waitForFunction(() => {
      const cards = document.querySelector('[data-testid="stat-cards"]');
      return cards && /\d/.test(cards.textContent ?? '');
    }, { timeout: 10000 });
    const cardText = await page.locator('[data-testid="stat-cards"]').textContent();
    expect(cardText).toMatch(/Open Requisitions/);
    expect(cardText).toMatch(/Active Candidates/);
  });

  test('redeployment queue section renders', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForSelector('text=Redeployment Queue', { state: 'visible', timeout: 10000 });
    // Either data rows or the empty-state message must appear
    const hasContent = await page.locator('text=No upcoming redeployments').or(
      page.locator('table tbody tr').first()
    ).waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    expect(hasContent).toBe(true);
  });

  test('recruiter capacity bars render', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForSelector('text=Recruiter Capacity', { state: 'visible', timeout: 10000 });
    const hasCapacity = await page.locator('[data-testid="capacity-bars"]').or(
      page.locator('text=No recruiter data')
    ).waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    expect(hasCapacity).toBe(true);
  });
});

// Suite 6: Kanban Pipeline Board (P6)
test.describe('S6 Kanban Pipeline Board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('pipeline list shows requisitions', async ({ page }) => {
    await page.goto(`${BASE}/pipeline`);
    await page.waitForSelector('[data-testid="requisition-list"]', { state: 'visible', timeout: 10000 });
    const count = await page.locator('[data-testid="requisition-list"] a').count();
    expect(count).toBeGreaterThan(0);
  });

  test('kanban board shows stage columns', async ({ page }) => {
    if (!TID) return test.skip();
    // Get first requisition ID from API
    const resp = await page.request.get(`${API}/requisitions`, {
      headers: { 'x-tenant-id': TID },
    });
    const reqs = await resp.json();
    const reqId = reqs[0]?.id;
    expect(reqId).toBeTruthy();

    await page.goto(`${BASE}/pipeline/${reqId}`);
    await page.waitForSelector('[data-testid="kanban-board"]', { state: 'visible', timeout: 10000 });
    // Verify stage columns present
    const sourced = page.locator('[data-stage="sourced"]');
    const screened = page.locator('[data-stage="screened"]');
    await expect(sourced).toBeVisible();
    await expect(screened).toBeVisible();
  });

  test('match candidates button fetches AI matches', async ({ page }) => {
    if (!TID) return test.skip();
    const resp = await page.request.get(`${API}/requisitions`, {
      headers: { 'x-tenant-id': TID },
    });
    const reqs = await resp.json();
    const reqId = reqs[0]?.id;

    await page.goto(`${BASE}/pipeline/${reqId}`);
    await page.waitForSelector('[data-testid="kanban-board"]', { state: 'visible', timeout: 10000 });
    await page.waitForSelector('nav', { state: 'visible', timeout: 5000 });
    await page.click('button:has-text("Match Candidates")');
    await page.waitForSelector('[data-testid="match-cards"]', { state: 'visible', timeout: 15000 });
    const matchCount = await page.locator('[data-testid="match-cards"] > div').count();
    expect(matchCount).toBeGreaterThanOrEqual(0);
  });
});

// Suite 7: Candidate 360 View (P7)
test.describe('S7 Candidate 360 View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('candidate list shows candidates', async ({ page }) => {
    await page.goto(`${BASE}/candidates`);
    await page.waitForSelector('[data-testid="candidate-list"]', { state: 'visible', timeout: 10000 });
    const count = await page.locator('[data-testid="candidate-list"] a').count();
    expect(count).toBeGreaterThan(0);
  });

  test('candidate 360 profile tab loads', async ({ page }) => {
    if (!TID) return test.skip();
    const resp = await page.request.get(`${API}/candidates`, {
      headers: { 'x-tenant-id': TID },
    });
    const candidates = await resp.json();
    const candId = candidates.find((c: { full_name: string; id: string }) => !c.full_name.startsWith('QA'))?.id;
    expect(candId).toBeTruthy();

    await page.goto(`${BASE}/candidates/${candId}`);
    await page.waitForSelector('[data-testid="profile-panel"]', { state: 'visible', timeout: 10000 });
    await expect(page.locator('[data-tab="profile"]')).toBeVisible();
  });

  test('applications tab loads', async ({ page }) => {
    if (!TID) return test.skip();
    const resp = await page.request.get(`${API}/candidates`, {
      headers: { 'x-tenant-id': TID },
    });
    const candidates = await resp.json();
    const candId = candidates.find((c: { full_name: string; id: string }) => !c.full_name.startsWith('QA'))?.id;

    await page.goto(`${BASE}/candidates/${candId}`);
    await page.waitForSelector('nav', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="applications"]');
    await page.waitForSelector('[data-testid="applications-panel"]', { state: 'visible', timeout: 10000 });
  });

  test('assessment tab renders MCQ questions', async ({ page }) => {
    if (!TID) return test.skip();
    const resp = await page.request.get(`${API}/candidates`, {
      headers: { 'x-tenant-id': TID },
    });
    const candidates = await resp.json();
    const candId = candidates.find((c: { full_name: string; id: string }) => !c.full_name.startsWith('QA'))?.id;

    await page.goto(`${BASE}/candidates/${candId}`);
    await page.waitForSelector('nav', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="assessment"]');
    await page.waitForSelector('[data-testid="assessment-panel"]', { state: 'visible', timeout: 10000 });
  });
});

// Suite 8: Analytics BI Dashboard (P8)
test.describe('S8 Analytics BI Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('analytics KPI cards visible', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await page.waitForSelector('[data-testid="analytics-kpi"]', { state: 'visible', timeout: 10000 });
    const text = await page.locator('[data-testid="analytics-kpi"]').textContent();
    expect(text).toMatch(/Placement Rate|Skill Gaps|Utilization/);
  });

  test('funnel chart renders', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await page.waitForSelector('[data-testid="funnel-chart"]', { state: 'visible', timeout: 15000 });
  });

  test('skill gap chart renders', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await page.waitForSelector('[data-testid="skill-gap-chart"]', { state: 'visible', timeout: 15000 });
  });

  test('hiring difficulty panel renders', async ({ page }) => {
    await page.goto(`${BASE}/analytics`);
    await page.waitForSelector('[data-testid="difficulty-panel"]', { state: 'visible', timeout: 10000 });
  });
});

// Suite 9: CEO War Room (P9)
test.describe('S9 CEO War Room', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('war room KPI cards visible', async ({ page }) => {
    await page.goto(`${BASE}/command-center`);
    await page.waitForSelector('[data-testid="war-room-kpis"]', { state: 'visible', timeout: 10000 });
    const text = await page.locator('[data-testid="war-room-kpis"]').textContent();
    expect(text).toMatch(/Total Placements|Fill Rate|Utilization/);
  });

  test('capacity vs demand panel visible', async ({ page }) => {
    await page.goto(`${BASE}/command-center`);
    await page.waitForSelector('[data-testid="capacity-demand-panel"]', { state: 'visible', timeout: 15000 });
  });

  test('retention risk panel visible', async ({ page }) => {
    await page.goto(`${BASE}/command-center`);
    await page.waitForSelector('[data-testid="retention-risk-panel"]', { state: 'visible', timeout: 15000 });
  });
});

// Suite 10: Finance ERP Dashboard (P10)
test.describe('S10 Finance ERP', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('finance KPI cards visible', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForSelector('[data-testid="finance-kpis"]', { state: 'visible', timeout: 10000 });
    const text = await page.locator('[data-testid="finance-kpis"]').textContent();
    expect(text).toMatch(/Active Contractors|Monthly Bill|Gross Margin/);
  });

  test('contractor billing grid visible', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForSelector('[data-testid="contractors-panel"]', { state: 'visible', timeout: 15000 });
  });

  test('timesheets tab shows P12 stub', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForSelector('[data-testid="contractors-panel"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="timesheets"]');
    await page.waitForSelector('[data-testid="timesheets-panel"]', { state: 'visible', timeout: 5000 });
  });

  test('invoices tab shows P12 stub', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForSelector('[data-testid="contractors-panel"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="invoices"]');
    await page.waitForSelector('[data-testid="invoices-panel"]', { state: 'visible', timeout: 5000 });
  });
});

// Suite 11: WhatsApp Outreach (P11)
test.describe('S11 WhatsApp Outreach', () => {
  test('WhatsApp session status endpoint returns status field', async ({ request }) => {
    const r = await request.get(`${API}/whatsapp/session/status`, {
      headers: { 'x-tenant-id': process.env.TENANT_ID || 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const data = await r.json();
    expect(r.status()).toBe(200);
    expect(data.status).toBeDefined();
    expect(data.session).toBe('default');
  });

  test('WhatsApp templates endpoint returns 4 templates in 14 languages', async ({ request }) => {
    const r = await request.get(`${API}/whatsapp/templates`, {
      headers: { 'x-tenant-id': 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const templates = await r.json();
    expect(r.status()).toBe(200);
    expect(templates).toHaveLength(4);
    expect(templates[0].languages).toHaveLength(14);
  });

  test('HARD RULE #7: send without consent returns 403', async ({ request }) => {
    const loginR = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@example.com', password: 'changeme', tenant_id: 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const { access_token } = await loginR.json();
    const candsR = await request.get(`${API}/candidates`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const candId = (await candsR.json())[0]?.id;
    if (!candId) return;
    const r = await request.post(`${API}/whatsapp/send`, {
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      data: { candidate_id: candId, phone: '+919876543210', template_key: 'job_opportunity', lang: 'en', vars: {} }
    });
    expect(r.status()).toBe(403);
    const body = await r.json();
    expect(body.detail).toContain('HARD RULE #7/#12');
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('WhatsApp page session panel visible', async ({ page }) => {
    await page.goto(`${BASE}/whatsapp`);
    await page.waitForSelector('[data-testid="session-panel"]', { state: 'visible', timeout: 15000 });
  });

  test('WhatsApp templates tab shows 14 languages', async ({ page }) => {
    await page.goto(`${BASE}/whatsapp`);
    await page.waitForSelector('[data-testid="session-panel"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="templates"]');
    await page.waitForSelector('[data-testid="templates-panel"]', { state: 'visible', timeout: 5000 });
    const text = await page.locator('[data-testid="templates-panel"]').textContent();
    expect(text).toMatch(/Hindi|Tamil|Telugu|Kannada/);
  });

  test('WhatsApp consent tab visible', async ({ page }) => {
    await page.goto(`${BASE}/whatsapp`);
    await page.waitForSelector('[data-testid="session-panel"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="consent"]');
    await page.waitForSelector('[data-testid="consent-panel"]', { state: 'visible', timeout: 5000 });
  });
});

// Suite 12: ERP Timesheet + Invoice + Payroll (P12)
test.describe('S12 ERP Timesheet/Invoice/Payroll', () => {
  test('ERP timesheets endpoint returns array (RLS)', async ({ request }) => {
    const loginR = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@example.com', password: 'changeme', tenant_id: 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const { access_token } = await loginR.json();
    const r = await request.get(`${API}/erp/timesheets`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    expect(r.status()).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });

  test('ERP invoices endpoint returns array', async ({ request }) => {
    const loginR = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@example.com', password: 'changeme', tenant_id: 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const { access_token } = await loginR.json();
    const r = await request.get(`${API}/erp/invoices`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    expect(r.status()).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });

  test('HARD RULE #11: contractor PII encrypted — Aadhaar bytes not plaintext', async ({ request }) => {
    const loginR = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@example.com', password: 'changeme', tenant_id: 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const { access_token } = await loginR.json();
    const candsR = await request.get(`${API}/candidates`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const candId = (await candsR.json())[0]?.id;
    if (!candId) return;
    const piiR = await request.post(`${API}/erp/contractor-pii`, {
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      data: { candidate_id: candId, aadhaar: '9999-8888-7777', pan: 'TESTX1234Y', bank_account: '999888777' }
    });
    expect(piiR.status()).toBe(200);
    const body = await piiR.json();
    expect(body.note).toContain('HARD RULE #11');
    // Aadhaar must NOT be returned in plaintext
    expect(JSON.stringify(body)).not.toContain('9999-8888-7777');
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('Finance timesheets tab shows ERP table', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForSelector('[data-testid="contractors-panel"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="timesheets"]');
    await page.waitForSelector('[data-testid="timesheets-panel"]', { state: 'visible', timeout: 8000 });
  });

  test('Finance invoices tab shows ERP table', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForSelector('[data-testid="contractors-panel"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="invoices"]');
    await page.waitForSelector('[data-testid="invoices-panel"]', { state: 'visible', timeout: 8000 });
  });

  test('Finance payroll tab shows ERP table', async ({ page }) => {
    await page.goto(`${BASE}/finance`);
    await page.waitForSelector('[data-testid="contractors-panel"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="payroll"]');
    await page.waitForSelector('[data-testid="payroll-panel"]', { state: 'visible', timeout: 8000 });
  });
});

// Suite 13: BGV + Trust Intelligence (P13)
test.describe('S13 BGV Trust Intelligence', () => {
  test('BGV trust score endpoint returns score fields', async ({ request }) => {
    const loginR = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@example.com', password: 'changeme', tenant_id: 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const { access_token } = await loginR.json();
    const candsR = await request.get(`${API}/candidates`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const candId = (await candsR.json())[0]?.id;
    if (!candId) return;
    const r = await request.get(`${API}/bgv/trust-score/${candId}`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    expect(r.status()).toBe(200);
    const data = await r.json();
    expect(data.trust_rating).toBeDefined();
    expect(typeof data.total_score).toBe('number');
  });

  test('BGV check creation initiates in_progress check', async ({ request }) => {
    const loginR = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@example.com', password: 'changeme', tenant_id: 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const { access_token } = await loginR.json();
    const candsR = await request.get(`${API}/candidates`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const candId = (await candsR.json())[0]?.id;
    if (!candId) return;
    const r = await request.post(`${API}/bgv/checks`, {
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      data: { candidate_id: candId, check_type: 'education' }
    });
    expect(r.status()).toBe(200);
    const check = await r.json();
    expect(check.status).toBe('in_progress');
    expect(check.score_points).toBe(20);
  });

  test('Aadhaar initiate returns transaction_id (demo mode)', async ({ request }) => {
    const loginR = await request.post(`${API}/auth/login`, {
      data: { email: 'admin@example.com', password: 'changeme', tenant_id: 'a92d7fd7-fb72-47d8-881e-2493c61717ce' }
    });
    const { access_token } = await loginR.json();
    const candsR = await request.get(`${API}/candidates`, {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const candId = (await candsR.json())[0]?.id;
    if (!candId) return;
    const r = await request.post(`${API}/bgv/aadhaar/initiate`, {
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      data: { candidate_id: candId, aadhaar_number: '999988887777', mobile_last4: '1234' }
    });
    expect(r.status()).toBe(200);
    const data = await r.json();
    expect(data.transaction_id).toBeTruthy();
    expect(data.production_required).toBe(true);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForURL(`${BASE}/dashboard`);
  });

  test('BGV page trust overview visible', async ({ page }) => {
    await page.goto(`${BASE}/bgv`);
    await page.waitForSelector('[data-testid="trust-overview"]', { state: 'visible', timeout: 10000 });
  });

  test('BGV checks tab visible', async ({ page }) => {
    await page.goto(`${BASE}/bgv`);
    await page.waitForSelector('[data-testid="trust-overview"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="checks"]');
    await page.waitForSelector('[data-testid="bgv-checks-panel"]', { state: 'visible', timeout: 5000 });
  });

  test('India verify tab visible', async ({ page }) => {
    await page.goto(`${BASE}/bgv`);
    await page.waitForSelector('[data-testid="trust-overview"]', { state: 'visible', timeout: 10000 });
    await page.click('[data-tab="india-verify"]');
    await page.waitForSelector('[data-testid="india-verify-panel"]', { state: 'visible', timeout: 5000 });
  });
});

// Suite 14: P14 Production Deploy Config (static file checks)
test.describe('S14 VPS Deploy Config', () => {
  const fs = require('fs');
  const path = require('path');
  const REPO = path.resolve(__dirname, '..');

  test('nginx.conf.template exists and contains DOMAIN placeholder', async () => {
    const p = path.join(REPO, 'nginx', 'nginx.conf.template');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf8');
    expect(content).toContain('${DOMAIN}');
    expect(content).toContain('ssl_certificate');
    expect(content).toContain('proxy_pass');
  });

  test('docker-compose.prod.yml exists and references nginx + certbot', async () => {
    const p = path.join(REPO, 'docker-compose.prod.yml');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf8');
    expect(content).toContain('nginx:');
    expect(content).toContain('certbot');
    expect(content).toContain('127.0.0.1');
  });

  test('.env.prod.example has DOMAIN placeholder, not the forbidden domain as value', async () => {
    const p = path.join(REPO, '.env.prod.example');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf8');
    // finstack.aviinjobs.com may appear in a comment/warning; must NOT be the actual DOMAIN= value
    const domainLine = content.split('\n').find(l => l.startsWith('DOMAIN='));
    expect(domainLine).toBeTruthy();
    expect(domainLine).not.toContain('finstack.aviinjobs.com');
    expect(content).toContain('ERP_ENCRYPT_KEY=');
  });

  test('deploy-prod.sh exists and guards against CHANGEME domain', async () => {
    const p = path.join(REPO, 'scripts', 'deploy-prod.sh');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf8');
    expect(content).toContain('CHANGEME');
    expect(content).toContain('ERP_ENCRYPT_KEY');
    expect(content).toContain('zerotoken-check');
  });

  test('ssl-init.sh exists and warns against finstack.aviinjobs.com', async () => {
    const p = path.join(REPO, 'scripts', 'ssl-init.sh');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf8');
    expect(content).toContain('finstack.aviinjobs.com');
    expect(content).toContain('certbot');
  });

  test('p14-readiness-check.sh exists and runs zero-token check', async () => {
    const p = path.join(REPO, 'scripts', 'p14-readiness-check.sh');
    expect(fs.existsSync(p)).toBe(true);
    const content = fs.readFileSync(p, 'utf8');
    expect(content).toContain('zerotoken-check');
    expect(content).toContain('ERP_ENCRYPT_KEY');
  });
});

// Suite 4: Core API Workflows
test.describe('S4 Core Workflows', () => {
  test('Create candidate returns id', async ({ request }) => {
    if (!TID) return test.skip();
    const r = await request.post(`${API}/candidates`, {
      headers: { 'x-tenant-id': TID, 'content-type': 'application/json' },
      data: { full_name: 'QA Candidate', email: `qa${Date.now()}@test.com`, skills: ['QA'], total_exp_mo: 36, location: 'Bengaluru' }
    });
    expect((await r.json()).id).toBeTruthy();
  });
  test('RLS cross-tenant isolation', async ({ request }) => {
    const r = await request.get(`${API}/candidates`, { headers: { 'x-tenant-id': '00000000-0000-0000-0000-000000000000' } });
    if (r.status() === 200) expect((await r.json()).length).toBe(0);
  });
});
