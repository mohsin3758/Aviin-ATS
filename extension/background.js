// Service worker (MV3) -- the ONLY place in this extension that ever
// calls the AVIIN ATS API. Content scripts (page-origin context) would
// be blocked by the API's CORS allowlist; this background context, with
// host_permissions covering the API's origin (see manifest.json), gets
// cross-origin fetch without needing any backend CORS change.

const API_BASE = 'https://ats.aviintech.com/api';

async function getToken() {
  const { aviin_token, aviin_token_exp } = await chrome.storage.local.get(['aviin_token', 'aviin_token_exp']);
  if (!aviin_token) return null;
  if (aviin_token_exp && Date.now() > aviin_token_exp) return null; // expired -- treat as logged out
  return aviin_token;
}

async function login(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.detail || 'Login failed' };
  }
  // JWT itself carries a 7-day exp (backend/auth.py); store a plain
  // client-side expiry too so getAuthState() can answer synchronously
  // without decoding the token on every popup open.
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await chrome.storage.local.set({
    aviin_token: data.access_token,
    aviin_token_exp: expiresAt,
    aviin_email: email,
  });
  return { ok: true };
}

async function logout() {
  await chrome.storage.local.remove(['aviin_token', 'aviin_token_exp', 'aviin_email']);
}

async function getAuthState() {
  const token = await getToken();
  if (!token) return { authenticated: false };
  const { aviin_email } = await chrome.storage.local.get(['aviin_email']);
  return { authenticated: true, email: aviin_email || null };
}

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return { ok: false, error: 'No active tab' };
  if (!/^https:\/\/(www\.)?linkedin\.com\/in\//.test(tab.url)) {
    return { ok: false, error: 'not_supported_page' };
  }
  // Two-step injection, deliberately not a single files:[...] call: the
  // adapter file (files:) just defines window.__aviinAdapter_linkedin;
  // the actual scrape result comes back from a second call using func:,
  // which is the one Chrome unambiguously documents as returning the
  // injected function's own return value — a multi-file files:[...]
  // call's completion-value semantics aren't reliable enough to depend
  // on here. Adding a new site's adapter later means adding one more
  // `files:` entry to the first call plus one more `else if` in the
  // dispatcher function below — nothing else changes.
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content-scripts/adapters/linkedin.js'],
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const host = window.location.hostname;
      if (host.includes('linkedin.com') && typeof window.__aviinAdapter_linkedin === 'function') {
        return window.__aviinAdapter_linkedin();
      }
      return null;
    },
  });
  const scraped = results && results[0] && results[0].result;
  if (!scraped || !scraped.name) {
    return { ok: false, error: 'Could not read this profile — try reloading the LinkedIn page.' };
  }
  return { ok: true, scraped };
}

async function importProfile(scraped) {
  const token = await getToken();
  if (!token) return { status: 'error', message: 'Not logged in' };

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const captureRes = await fetch(`${API_BASE}/extension/capture`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: scraped.name,
      email: scraped.email,
      phone: scraped.phone,
      current_title: scraped.current_title,
      current_company: scraped.current_company,
      profile_url: scraped.profile_url,
      location: scraped.location,
      linkedin_url: scraped.linkedin_url,
      resume_text_like: scraped.resume_text_like,
      source: 'linkedin',
    }),
  });
  const captureData = await captureRes.json().catch(() => ({}));
  if (!captureRes.ok) {
    return { status: 'error', message: captureData?.detail || 'Could not save the capture' };
  }

  const convertRes = await fetch(`${API_BASE}/extension/captures/${captureData.id}/convert`, {
    method: 'POST',
    headers,
  });
  const convertData = await convertRes.json().catch(() => ({}));

  if (convertRes.status === 409 && convertData?.detail?.matched_candidate_id) {
    return { status: 'exists', match: convertData.detail };
  }
  if (!convertRes.ok) {
    const msg = typeof convertData?.detail === 'string' ? convertData.detail : 'Could not create the candidate';
    return { status: 'error', message: msg };
  }
  return { status: 'created', candidateId: convertData.candidate_id, name: scraped.name };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'LOGIN': {
        const result = await login(message.email, message.password);
        sendResponse(result);
        break;
      }
      case 'LOGOUT': {
        await logout();
        sendResponse({ ok: true });
        break;
      }
      case 'GET_AUTH_STATE': {
        sendResponse(await getAuthState());
        break;
      }
      case 'IMPORT_ACTIVE_TAB': {
        const scrapeResult = await scrapeActiveTab();
        if (!scrapeResult.ok) {
          sendResponse({ status: scrapeResult.error === 'not_supported_page' ? 'not_supported' : 'error', message: scrapeResult.error });
          break;
        }
        const importResult = await importProfile(scrapeResult.scraped);
        sendResponse(importResult);
        break;
      }
      default:
        sendResponse({ status: 'error', message: 'Unknown message' });
    }
  })();
  return true; // keep the async sendResponse channel open
});
