// Service worker (MV3) -- the ONLY place in this extension that ever
// calls the AVIIN ATS API. Content scripts (page-origin context) would
// be blocked by the API's CORS allowlist; this background context, with
// host_permissions covering the API's origin (see manifest.json), gets
// cross-origin fetch without needing any backend CORS change.

const API_BASE = 'https://ats.aviintech.com/api';

// Same normalization the LinkedIn adapter applies to window.location.href
// (content-scripts/adapters/linkedin.js) -- kept identical so a URL
// checked here and a URL later captured on Import always compare equal.
function normalizeLinkedinUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch (e) {
    return rawUrl;
  }
}

async function checkDuplicate(linkedinUrl) {
  const token = await getToken();
  if (!token) return { matched: false };
  const res = await fetch(`${API_BASE}/extension/check-duplicate?linkedin_url=${encodeURIComponent(linkedinUrl)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { matched: false };
  return res.json();
}

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

// Real gap fix (reported live: "Could not read this profile" on every
// attempt, even on a fully-loaded, clearly-rendered profile page). The
// original design injected the adapter logic via one files:[...] call
// (defining window.__aviinAdapter_linkedin) and then read it back via a
// SEPARATE executeScript call — relying on that global surviving across
// two independent injections into the same tab. Chrome's own docs only
// unambiguously guarantee a reliable return value for a SINGLE func:
// call whose own return value becomes the result; splitting the logic
// across two calls added a real, now-confirmed-live point of failure
// with no error surfaced (a silent `null`, which read as "no name
// found" rather than "the adapter never even ran"). Fixed by making
// each site's adapter one fully self-contained function passed directly
// to a single executeScript({func}) call — the standard, reliable MV3
// content-extraction pattern. Adding a new site (Naukri, Foundit) means
// adding one more entry to ADAPTERS below; nothing else changes.
const ADAPTERS = {
  linkedin: {
    urlPattern: /^https:\/\/(www\.)?linkedin\.com\/in\//,
    // Runs INSIDE the LinkedIn page, in the extension's isolated world.
    // Scrapes only what's reliably visible without any extra click (no
    // "Contact info" modal) — LinkedIn profiles routinely have no
    // visible email/phone at all, and this deliberately never invents
    // one (see backend/routers/gap_features.py's ext_capture_convert
    // docstring for why: a placeholder email caused a real candidate-
    // merge corruption incident elsewhere in this codebase). LinkedIn's
    // DOM uses obfuscated, frequently-changing class names, so several
    // known selector patterns are tried per field, falling back to
    // document.title (a stable "Name - Headline | LinkedIn" string
    // LinkedIn has kept consistent for years). This function is the one
    // piece that will need occasional upkeep if LinkedIn changes its
    // markup — nothing else in the extension needs to change alongside it.
    scrapeFn: function scrapeLinkedinProfile() {
      function firstMatch(selectors) {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const text = el && el.textContent && el.textContent.trim();
          if (text) return text;
        }
        return null;
      }
      function parseTitleTag() {
        const t = document.title || '';
        const m = t.match(/^(.*?)\s*-\s*(.*?)\s*\|\s*LinkedIn\s*$/i);
        if (m) return { name: m[1].trim(), headline: m[2].trim() };
        return { name: null, headline: null };
      }
      function sectionLines(anchorId, max) {
        const section = document.getElementById(anchorId);
        const container = section && section.closest('section');
        if (!container) return [];
        return Array.from(container.querySelectorAll('li'))
          .slice(0, max)
          .map((li) => li.textContent.replace(/\s+/g, ' ').trim())
          .filter((t) => t && t.length > 3);
      }
      function normalizedUrl() {
        try {
          const u = new URL(window.location.href);
          return u.origin + u.pathname.replace(/\/$/, '');
        } catch (e) {
          return window.location.href;
        }
      }

      const titleParsed = parseTitleTag();
      const name = firstMatch(['.pv-text-details__left-panel h1', 'main h1', 'h1']) || titleParsed.name;
      const headline = firstMatch(['.pv-text-details__left-panel .text-body-medium', '.text-body-medium.break-words']) || titleParsed.headline;
      const location = firstMatch(['.pv-text-details__left-panel .text-body-small.inline.t-black--light', '.pv-text-details__left-panel .text-body-small']);

      let currentCompany = null;
      const expSection = document.getElementById('experience');
      const expContainer = expSection && expSection.closest('section');
      const firstItem = expContainer && expContainer.querySelector('li');
      if (firstItem) {
        const spans = Array.from(firstItem.querySelectorAll('span[aria-hidden="true"]'))
          .map((s) => s.textContent.trim()).filter(Boolean);
        currentCompany = spans[1] || null; // [role title, company name, duration, location...]
      }

      const expLines = sectionLines('experience', 10);
      const eduLines = sectionLines('education', 6);
      const resumeTextLike = [
        expLines.length ? 'Experience:\n' + expLines.join('\n') : '',
        eduLines.length ? 'Education:\n' + eduLines.join('\n') : '',
      ].filter(Boolean).join('\n\n') || null;

      return {
        name: name || null,
        current_title: headline || null,
        current_company: currentCompany,
        location: location || null,
        profile_url: normalizedUrl(),
        linkedin_url: normalizedUrl(),
        email: null,
        phone: null,
        resume_text_like: resumeTextLike,
      };
    },
  },
};

function matchAdapter(url) {
  for (const key of Object.keys(ADAPTERS)) {
    if (ADAPTERS[key].urlPattern.test(url)) return ADAPTERS[key];
  }
  return null;
}

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return { ok: false, error: 'No active tab' };
  const adapter = matchAdapter(tab.url);
  if (!adapter) return { ok: false, error: 'not_supported_page' };

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: adapter.scrapeFn,
    });
  } catch (e) {
    // A real, surfaced reason instead of the old generic message — e.g.
    // "Cannot access a chrome:// URL" or a permissions error would show
    // up here now instead of silently reading as "no name found".
    return { ok: false, error: `Could not read this page: ${e?.message || e}` };
  }
  const scraped = results && results[0] && results[0].result;
  if (!scraped || !scraped.name) {
    return { ok: false, error: 'Could not read this profile — try reloading the LinkedIn page and importing again.' };
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
    try {
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
        case 'CHECK_TAB_DUPLICATE': {
          // Real feature (follow-up): "is this profile already a
          // candidate?" the moment the popup opens, using only the
          // tab's URL -- no content-script injection, no click spent.
          // Only reachable for a URL that already passed the same
          // linkedin.com/in/ check scrapeActiveTab() enforces, so a
          // profile that's actually unsupported never even asks.
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab?.url || !matchAdapter(tab.url)) {
            sendResponse({ matched: false });
            break;
          }
          sendResponse(await checkDuplicate(normalizeLinkedinUrl(tab.url)));
          break;
        }
        default:
          sendResponse({ status: 'error', message: 'Unknown message' });
      }
    } catch (e) {
      // Real gap fix: without this, a thrown exception (a network
      // failure calling the API, an unexpected null somewhere) meant
      // sendResponse never ran at all -- the popup's awaited promise
      // never resolved, leaving "Logging in…"/"Importing…" stuck on
      // the button forever with no error shown, indistinguishable from
      // the extension being broken. Both .error and .message are set --
      // the LOGIN caller reads .error, the IMPORT_ACTIVE_TAB caller
      // reads .status/.message, and this can fail during either.
      const msg = e?.message || 'Unexpected error';
      sendResponse({ ok: false, error: msg, status: 'error', message: msg });
    }
  })();
  return true; // keep the async sendResponse channel open
});
