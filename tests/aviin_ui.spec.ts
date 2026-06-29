import { test, expect, Page, APIRequestContext } from '@playwright/test';

// ─── helpers ────────────────────────────────────────────────────────────────
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
  test.beforeEach(async ({ page }) => { await login(page); });

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
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('http://localhost:3001/candidates');
    await page.waitForLoadState('networkidle');
  });

  test('page count text matches pattern', async ({ page }) => {
    const countEl = page.locator('text=/\\d+ candidates in/i');
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
    // Use the specific candidates-page search (not the topbar search)
    // The topbar has 'Search candidates, jobs...' — candidates page has 'Search name, email...'
    const searchInput = page.locator('input[placeholder*="name, email"]').first();
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
    await searchInput.click();
    await searchInput.fill('Priya');
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
    await page.click('button:has-text("Add Candidate")');
    await expect(page.locator('text=PERSONAL INFORMATION').first()).toBeVisible();
    await expect(page.locator('text=PROFESSIONAL DETAILS').first()).toBeVisible();
    await expect(page.locator('text=COMPENSATION').first()).toBeVisible();
    await expect(page.locator('text=SKILLS').first()).toBeVisible();
  });

  test('Save button visible after modal opens', async ({ page }) => {
    await page.click('button:has-text("Add Candidate")');
    const saveBtn = page.locator('button:has-text("Add Candidate")').last();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
  });

  test('full add candidate flow', async ({ page }) => {
    const rowsBefore = await page.locator('tbody tr').count();
    await page.click('button:has-text("Add Candidate")');
    await page.waitForSelector('h2:has-text("Add New Candidate")', { timeout: 5000 });
    await page.fill('input[placeholder="e.g. Rahul Sharma"]', 'QA PW Test');
    await page.fill('input[placeholder="rahul@example.com"]', 'qapwunique@aviin.io');
    await page.fill('input[placeholder="+91 9876543210"]', '9900001234');
    await page.locator('button:has-text("Add Candidate")').last().click();
    await page.waitForTimeout(2000);
    const rowsAfter = await page.locator('tbody tr').count();
    expect(rowsAfter).toBeGreaterThan(rowsBefore);
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
test.describe('S4: Pipeline Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('http://localhost:3001/pipeline');
    await page.waitForLoadState('networkidle');
  });

  test('all 7 stage labels visible', async ({ page }) => {
    await page.waitForTimeout(6000); // Wait for pipeline to fully load
    // Stage column headers use partial text matching (they may have bullet dots or counts)
    for (const stage of ['SOURCED', 'SCREENED', 'SUBMITTED', 'OFFER', 'PLACED', 'REJECTED']) {
      await expect(page.locator('text=' + stage).first()).toBeVisible({ timeout: 12000 });
    }
    await expect(page.locator('text=INTERVIEW').first()).toBeVisible({ timeout: 12000 });
  });

  test('first select has at least 1 option', async ({ page }) => {
    const sel = page.locator('select').first();
    await expect(sel).toBeVisible();
    const opts = await sel.locator('option').count();
    expect(opts).toBeGreaterThanOrEqual(1);
  });

  test('no hydration errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(2000);
    const hydrationErrors = errors.filter(e => e.includes('Hydration'));
    expect(hydrationErrors).toHaveLength(0);
  });
});

// ─── S5: Requisitions Page ───────────────────────────────────────────────────
test.describe('S5: Requisitions Page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
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

  test('GET /pipeline/metrics upcoming_interviews equals by_stage.interview', async ({ request }) => {
    const res = await request.get('http://localhost:8080/pipeline/metrics', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m.upcoming_interviews).toBe(m.by_stage?.interview);
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