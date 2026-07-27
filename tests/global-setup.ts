// Logs in ONCE for the whole test run and saves the authenticated session
// (cookies + localStorage, since the app keeps its JWT in localStorage)
// to tests/.auth/state.json. Every describe block that needs to be
// pre-authenticated loads this via `test.use({ storageState: AUTH_FILE })`
// instead of re-submitting the login form in its own beforeEach.
//
// Why this exists: the app's login endpoint is rate-limited to 10
// attempts per IP per 15 minutes (backend/app.py's RateLimitMiddleware,
// a real anti-brute-force control, not something to weaken). The test
// suite used to log in fresh in nearly every describe block's
// beforeEach — 11 browser-form logins plus 7 more direct API logins for
// bearer-token tests, 18+ per full run — which blew through that limit
// partway through almost every run and cascade-failed everything after
// with 429s that looked like application bugs but weren't.
import { chromium, request as pwRequest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BASE = 'http://localhost:3001';
const API = 'http://localhost:8080';
const EMAIL = process.env.QA_EMAIL || 'admin@example.com';
const PASS = process.env.QA_PASSWORD || 'changeme';

export const AUTH_FILE = path.join(__dirname, '.auth', 'state.json');

export default async function globalSetup() {
  const reqCtx = await pwRequest.newContext();
  const loginRes = await reqCtx.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASS },
  });
  if (!loginRes.ok()) {
    throw new Error(`global-setup login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const { access_token } = await loginRes.json();
  await reqCtx.dispose();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`);
  await page.evaluate((token) => localStorage.setItem('airecruit_token', token), access_token);

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
  await browser.close();
}
