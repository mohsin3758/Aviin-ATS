import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { AUTH_FILE } from './global-setup';

const API = 'http://localhost:8080';
const TID = process.env.TENANT_ID || 'a92d7fd7-fb72-47d8-881e-2493c61717ce';

// ─── helpers ────────────────────────────────────────────────────────────────
// Only used by S1 (tests the login flow itself) and the one S6 test that
// checks a freshly-issued token's expiry claim. Every other describe block
// below reuses the session global-setup already established via
// `test.use({ storageState: AUTH_FILE })`, instead of logging in again.
async function login(page: Page) {
  await page.goto('http://localhost:3001/login');
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', 'changeme');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

// ─── S1: Login Page ──────────────────────────────────────────────────────────
test.describe('S1: Login Page', () => {
  test('loads with AVIIN ATS in h1', async ({ page }) => {
    await page.goto('http://localhost:3001/login');
    const h1 = await page.locator('h1').first().textContent();
    expect(h1).toContain('AVIIN ATS');
  });

  test('logo div visible with green background containing A', async ({ page }) => {
    await page.goto('http://localhost:3001/login');
    const logo = page.locator('div').filter({ hasText: /^A$/ }).first();
    await expect(logo).toBeVisible();
  });

  test('wrong credentials stays on /login', async ({ page }) => {
    await page.goto('http://localhost:3001/login');
    await page.fill('input[name="email"]', 'wrong@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('correct credentials navigates to /dashboard', async ({ page }) => {
    await login(page);
    expect(page.url()).toContain('/dashboard');
  });

  test('?reason=session_expired shows amber banner', async ({ page }) => {
    await page.goto('http://localhost:3001/login?reason=session_expired');
    const banner = page.locator('text=/session expired/i');
    await expect(banner).toBeVisible({ timeout: 5000 });
  });
});

// ─── S2: Dashboard ───────────────────────────────────────────────────────────
test.describe('S2: Dashboard', () => {
  test.use({ storageState: AUTH_FILE });
  test.beforeEach(async ({ page }) => { await page.goto('http://localhost:3001/dashboard'); });

  test('sidebar has candidates, pipeline, requisitions links', async ({ page }) => {
    await expect(page.locator('a[href="/candidates"]').first()).toBeVisible();
    await expect(page.locator('a[href="/pipeline"]').first()).toBeVisible();
    await expect(page.locator('a[href="/requisitions"]').first()).toBeVisible();
  });

  test('no uncaught page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});

// ─── S3: Candidates Page ─────────────────────────────────────────────────────
test.describe('S3: Candidates Page', () => {
  test.use({ storageState: AUTH_FILE });
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3001/candidates');
    await page.waitForLoadState('networkidle');
  });

  test('page count text matches pattern', async ({ page }) => {
    // Was "/\d+ candidates in/i" — the header text is now "{total} candidates
    // · Page {n}/{total}" (candidates/page.tsx:695), no "in" substring. There's
    // ALSO a separate "Showing X–Y of Z candidates" footer near pagination
    // (line 900) that matches the same broad pattern — .first() avoids a
    // strict-mode violation from matching both.
    const countEl = page.locator('text=/[\\d,]+\\s+candidates/i').first();
    await expect(countEl).toBeVisible({ timeout: 10000 });
  });

  test('tbody has rows > 0', async ({ page }) => {
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('searching Priya shows fewer rows', async ({ page }) => {
    // Wait until the candidate table rows appear
    await page.waitForTimeout(4000);
    const rowsBefore = await page.locator('tbody tr').count();
    expect(rowsBefore).toBeGreaterThan(5); // sanity: must have loaded candidates
    // Use the specific candidates-page search (not the topbar search).
    // Placeholder is now "Name, email, phone..." (capital N) — the old
    // lowercase substring `*="name, email"` never matched (CSS attribute
    // selectors are case-sensitive); added the `i` flag. Search also only
    // applies on Enter/button-click, not live-as-you-type (see applyFilters
    // in candidates/page.tsx), so `.fill()` alone never triggered it either.
    const searchInput = page.locator('input[placeholder*="name, email" i]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.click();
    await searchInput.fill('Priya');
    await searchInput.press('Enter');
    await page.waitForTimeout(2000);
    const rowsAfter = await page.locator('tbody tr').count();
    expect(rowsAfter).toBeLessThan(rowsBefore);
    expect(rowsAfter).toBeGreaterThan(0);
  });

  test('Add Candidate button shows modal with h2', async ({ page }) => {
    await page.click('button:has-text("Add Candidate")');
    const h2 = page.locator('h2').filter({ hasText: /Add New Candidate/i });
    await expect(h2).toBeVisible({ timeout: 5000 });
  });

  test('modal contains section headers', async ({ page }) => {
    // COMPENSATION was merged into Professional Details at some point (CTC/
    // notice-period fields now live under that SectionDivider, see
    // candidates/page.tsx) — there's no separate section by that name
    // anymore. "Resume / Notes" is the 4th real section today.
    await page.click('button:has-text("Add Candidate")');
    await expect(page.locator('text=PERSONAL INFORMATION').first()).toBeVisible();
    await expect(page.locator('text=PROFESSIONAL DETAILS').first()).toBeVisible();
    await expect(page.locator('text=SKILLS').first()).toBeVisible();
    await expect(page.locator('text=RESUME / NOTES').first()).toBeVisible();
  });

  test('Save button visible after modal opens', async ({ page }) => {
    await page.click('button:has-text("Add Candidate")');
    const saveBtn = page.locator('button:has-text("Add Candidate")').last();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
  });

  test('full add candidate flow', async ({ page }) => {
    // Email AND phone must be unique per run — a hardcoded phone number
    // reused across many prior runs eventually collides with the app's own
    // duplicate-candidate detection (working as intended: it shows an
    // "Add Anyway" confirmation dialog this test never handled), which
    // silently blocked every submission after the first successful one.
    //
    // Also: rowsAfter > rowsBefore stopped being a valid check once there
    // were enough candidates to fill a full page (PAGE_SIZE=50) — the table
    // always shows exactly 50 rows regardless of total, so adding one more
    // candidate never changes the current page's row count. Checking that
    // the new candidate's own name is now visible (default sort is
    // created_at desc, so a new row lands on page 1) is what this test
    // actually needs to verify.
    const unique = Date.now();
    const name = `QA PW Test ${unique}`;
    const email = `qapwunique${unique}@aviin.io`;
    await page.click('button:has-text("Add Candidate")');
    await page.waitForSelector('h2:has-text("Add New Candidate")', { timeout: 5000 });
    await page.fill('input[placeholder="e.g. Rahul Sharma"]', name);
    await page.fill('input[placeholder="rahul@example.com"]', email);
    await page.fill('input[placeholder="+91 9876543210"]', `9${String(unique).slice(-9)}`);
    await page.locator('button:has-text("Add Candidate")').last().click();
    await expect(page.locator(`tbody tr:has-text("${name}")`)).toBeVisible({ timeout: 5000 });

    // Cleanup — this test intentionally exercises the real add-candidate UI
    // end-to-end, which means it really does create a live candidate. This
    // was the third of three tests found leaving permanent fake "QA ..."
    // candidates in front of real recruiters on the live Candidates page
    // (30+ accumulated before this was caught). No apiToken in scope here
    // (that's only set up in the S7 describe block) — pull the same
    // localStorage JWT the app itself uses instead.
    const token = await page.evaluate(() => localStorage.getItem('airecruit_token'));
    const listRes = await page.request.get(`http://localhost:8080/candidates?search=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json();
    const items = Array.isArray(listBody) ? listBody : (listBody.items || []);
    const created = items.find((c: any) => c.email === email);
    if (created) {
      await page.request.delete(`http://localhost:8080/candidates/${created.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test('Cancel closes modal without adding row', async ({ page }) => {
    const rowsBefore = await page.locator('tbody tr').count();
    await page.click('button:has-text("Add Candidate")');
    await page.waitForSelector('h2:has-text("Add New Candidate")', { timeout: 5000 });
    await page.click('button:has-text("Cancel")');
    await page.waitForTimeout(500);
    await expect(page.locator('h2:has-text("Add New Candidate")')).not.toBeVisible();
    const rowsAfter = await page.locator('tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore);
  });

  test('Export button triggers download', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('button:has-text("Export")'),
    ]);
    expect(download.suggestedFilename()).toMatch(/candidates/i);
  });

  test('no hydration errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(2000);
    const hydrationErrors = errors.filter(e => e.includes('Hydration'));
    expect(hydrationErrors).toHaveLength(0);
  });
});

// ─── S4: Pipeline Page ───────────────────────────────────────────────────────
// The base /pipeline route is now a job-*picker* landing page (no Kanban
// board, no stage columns) until a specific job is selected — it used to
// show the board directly. Selection is a `?job=<id>` query param
// (pipeline/page.tsx's selectJob()), not a path segment, so tests that need
// the actual board navigate there directly instead of clicking through the
// picker UI.
test.describe('S4: Pipeline Page', () => {
  test.use({ storageState: AUTH_FILE });

  test('all 7 stage labels visible', async ({ page, request }) => {
    const reqs = await (await request.get(`${API}/requisitions`, { headers: { 'x-tenant-id': TID } })).json();
    const openReq = (Array.isArray(reqs) ? reqs : reqs.items || []).find((r: any) => r.status === 'open');
    test.skip(!openReq, 'no open requisition available to test against');
    await page.goto(`http://localhost:3001/pipeline?job=${openReq.id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    // Stage labels are Title Case today (e.g. "Sourced") — text= matches
    // case-insensitively by default, so the all-caps search terms still work.
    for (const stage of ['SOURCED', 'SCREENED', 'SUBMITTED', 'OFFER', 'PLACED', 'REJECTED']) {
      await expect(page.locator('text=' + stage).first()).toBeVisible({ timeout: 12000 });
    }
    await expect(page.locator('text=INTERVIEW').first()).toBeVisible({ timeout: 12000 });
  });

  test('job picker has at least one selectable job', async ({ page }) => {
    // There's no native <select> on this page anymore — job selection is a
    // custom searchable dropdown (pipeline/page.tsx's job-picker, rendered
    // open by default when no job is pre-selected), so this now checks the
    // modern equivalent of the original intent: the picker offers >=1 option.
    await page.goto('http://localhost:3001/pipeline');
    await page.waitForSelector('[data-testid="requisition-list"]', { state: 'visible', timeout: 10000 });
    // Container renders before its async-fetched reqList populates —
    // expect().toBeVisible() auto-retries until the button actually exists,
    // a bare .count() read right after waitForSelector can race and see 0.
    await expect(page.locator('[data-testid="requisition-list"] button').first()).toBeVisible({ timeout: 10000 });
    const count = await page.locator('[data-testid="requisition-list"] button').count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('no hydration errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:3001/pipeline');
    await page.waitForTimeout(2000);
    const hydrationErrors = errors.filter(e => e.includes('Hydration'));
    expect(hydrationErrors).toHaveLength(0);
  });
});

// ─── S5: Requisitions Page ───────────────────────────────────────────────────
test.describe('S5: Requisitions Page', () => {
  test.use({ storageState: AUTH_FILE });
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3001/requisitions');
    await page.waitForLoadState('networkidle');
  });

  test('page has Jobs & Requisitions text', async ({ page }) => {
    await expect(page.locator('text=/Jobs & Requisitions/i')).toBeVisible({ timeout: 10000 });
  });

  test('h3 count > 0', async ({ page }) => {
    const count = await page.locator('h3').count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking Add Job shows h2', async ({ page }) => {
    await page.click('button:has-text("Add Requirement")');
    const h2 = page.locator('h2').first();
    await expect(h2).toBeVisible({ timeout: 5000 });
  });

  test('no hydration errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(2000);
    const hydrationErrors = errors.filter(e => e.includes('Hydration'));
    expect(hydrationErrors).toHaveLength(0);
  });
});

// ─── S6: Auth ────────────────────────────────────────────────────────────────
test.describe('S6: Auth', () => {
  test('unauthenticated /candidates redirects to /login', async ({ page }) => {
    await page.goto('http://localhost:3001/candidates');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('JWT token expiry > 6 days', async ({ page }) => {
    await login(page);
    const token = await page.evaluate(() => localStorage.getItem('airecruit_token'));
    expect(token).not.toBeNull();
    const payload = JSON.parse(atob(token!.split('.')[1]));
    const remainingSecs = payload.exp - Date.now() / 1000;
    expect(remainingSecs).toBeGreaterThan(6 * 24 * 60 * 60);
  });
});

// ─── S7: API Contract ────────────────────────────────────────────────────────
test.describe('S7: API Contract', () => {
  let apiToken: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post('http://localhost:8080/auth/login', {
      data: { email: 'admin@example.com', password: 'changeme' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    apiToken = body.access_token;
  });

  test('GET /candidates returns items and total', async ({ request }) => {
    const res = await request.get('http://localhost:8080/candidates?limit=5', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(body.items[0]).toHaveProperty('expected_ctc');
    expect(body.items[0]).toHaveProperty('notice_period_days');
  });

  test('GET /candidates?search=Priya returns fewer results', async ({ request }) => {
    const all = await request.get('http://localhost:8080/candidates', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const allBody = await all.json();
    const filtered = await request.get('http://localhost:8080/candidates?search=Priya', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const filteredBody = await filtered.json();
    expect(filteredBody.total).toBeLessThan(allBody.total);
  });

  test('PUT /candidates/:id updates location', async ({ request }) => {
    const listRes = await request.get('http://localhost:8080/candidates?limit=1', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const { items } = await listRes.json();
    const id = items[0].id;
    const res = await request.put(`http://localhost:8080/candidates/${id}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: { location: 'QA PUT Test' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.location).toBe('QA PUT Test');
  });

  test('GET /pipeline/metrics upcoming_interviews equals sum of interview stages', async ({ request }) => {
    // by_stage never had a literal "interview" key — it's split into
    // l1_interview/l2_interview (and tenants can add further custom rounds,
    // e.g. this tenant's l3_interview via pipeline_stage_config). The
    // backend used to look up by_stage["interview"] directly, which never
    // matched anything and silently left upcoming_interviews at 0 always
    // (fixed in pipeline_p2.py to sum every by_stage key containing
    // "interview" instead) — this assertion needs the same fix.
    const res = await request.get('http://localhost:8080/pipeline/metrics', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    expect(res.status()).toBe(200);
    const m = await res.json();
    const interviewSum = Object.entries(m.by_stage || {})
      .filter(([k]) => k.includes('interview'))
      .reduce((sum, [, v]) => sum + (v as number), 0);
    expect(m.upcoming_interviews).toBe(interviewSum);
  });

  test('GET /pipeline/active-requisitions all items have app_count', async ({ request }) => {
    const res = await request.get('http://localhost:8080/pipeline/active-requisitions', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    expect(res.status()).toBe(200);
    const items = await res.json();
    for (const item of items) {
      expect(item.app_count).toBeGreaterThan(0);
    }
  });

  test('POST candidate has all required fields', async ({ request }) => {
    const ts = Date.now();
    const res = await request.post('http://localhost:8080/candidates', {
      headers: { Authorization: 'Bearer ' + apiToken, 'Content-Type': 'application/json' },
      data: { full_name: 'API QA Test', email: 'apiqatest' + ts + '@aviin.io',
              skills: ['Python'], total_exp_mo: 36, source: 'direct',
              expected_ctc: 1500000, notice_period_days: 30 },
    });
    expect(res.status()).toBe(200);
    const d = await res.json();
    expect(d).toHaveProperty('id');
    expect(d.full_name).toBe('API QA Test');
    expect(d.expected_ctc).toBe(1500000);
    expect(d.notice_period_days).toBe(30);
    // Cleanup — same missing-cleanup bug as qa_automation.spec.ts's
    // "Create candidate returns id": this test never deleted what it
    // created, leaving a permanent fake "API QA Test" candidate visible
    // on the live Candidates page after every run.
    await request.delete('http://localhost:8080/candidates/' + d.id, {
      headers: { Authorization: 'Bearer ' + apiToken },
    });
  });

  test('DELETE candidate with cascade cleanup returns 200', async ({ request }) => {
    const ts = Date.now();
    const createRes = await request.post('http://localhost:8080/candidates', {
      headers: { Authorization: 'Bearer ' + apiToken, 'Content-Type': 'application/json' },
      data: { full_name: 'QA Delete Me', email: 'qadel' + ts + '@aviin.io',
              skills: [], total_exp_mo: 0, source: 'direct' },
    });
    expect(createRes.status()).toBe(200);
    const { id } = await createRes.json();
    const delRes = await request.delete('http://localhost:8080/candidates/' + id, {
      headers: { Authorization: 'Bearer ' + apiToken },
    });
    expect(delRes.status()).toBe(200);
  });
});