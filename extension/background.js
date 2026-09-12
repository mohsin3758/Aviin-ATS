// Service worker (MV3) -- the ONLY place in this extension that ever
// calls the AVIIN ATS API. Content scripts (page-origin context) would
// be blocked by the API's CORS allowlist; this background context, with
// host_permissions covering the API's origin (see manifest.json), gets
// cross-origin fetch without needing any backend CORS change.

const API_BASE = 'https://ats.aviintech.com/api';

// Version marker — logged once when this service worker starts (a fresh
// registration happens every time the extension is reloaded at
// chrome://extensions). Check this in the service worker's console
// FIRST when debugging anything: if the number here doesn't match the
// latest fix, Chrome is still running old code and nothing else in this
// file matters yet — reload the extension again before looking further.
const BG_VERSION = 11;
console.log(`[AVIIN Import] background.js loaded, version ${BG_VERSION}`);

// Same normalization ADAPTERS.linkedin.scrapeFn applies to
// window.location.href — kept identical so a URL checked here and a URL
// later captured on Import always compare equal.
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
    // Also clicks the real "Contact info" link and reads whatever
    // LinkedIn itself declares there (email/phone) -- LinkedIn profiles
    // routinely have neither visible to a given viewer at all, and this
    // deliberately never invents one (see backend/routers/
    // gap_features.py's ext_capture_convert docstring for why: a
    // placeholder email caused a real candidate-merge corruption
    // incident elsewhere in this codebase). LinkedIn's DOM uses
    // obfuscated, frequently-changing class names, so extraction here
    // deliberately avoids them: Open Graph meta tags for name/headline,
    // heading text ("Experience"/"Education"/"Skills"/"About") for
    // sections, and fixed accessibility hooks (the "Contact info" label,
    // [role="dialog"], mailto: links) for contact details -- all things
    // LinkedIn can't casually rename without breaking a real feature for
    // a real visitor. This function is the one piece that will need
    // occasional upkeep if LinkedIn changes its markup — nothing else in
    // the extension needs to change alongside it.
    scrapeFn: async function scrapeLinkedinProfile() {
      // Real gap fix (reported live: "Could not read this profile" on a
      // page that was visibly, fully loaded — name, photo, headline all
      // clearly rendered). The whole body used to run un-guarded: any
      // single DOM assumption failing (a selector Chrome can't parse in
      // this exact page variant, an unexpected null somewhere) would
      // throw and abort the ENTIRE scrape, discarding every field that
      // WAS successfully read along the way — and since the caller only
      // ever looked at chrome.scripting.executeScript's `.result`, never
      // its `.error`, that real exception was silently swallowed into a
      // generic "could not read" message with zero diagnostic value.
      // Every field is now read defensively (own try/catch per field),
      // so a failure on ANY one of them still returns everything else
      // that succeeded, plus a _debug field listing exactly which
      // field(s) failed and why — real signal instead of a guess.
      const debug = [];
      function safe(label, fn, fallback) {
        try { return fn(); } catch (e) { debug.push(`${label}: ${e?.message || e}`); return fallback; }
      }
      async function asyncSafe(label, fn, fallback) {
        try { return await fn(); } catch (e) { debug.push(`${label}: ${e?.message || e}`); return fallback; }
      }
      function firstMatch(selectors) {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const text = el && el.textContent && el.textContent.trim();
          if (text) return text;
        }
        return null;
      }
      function metaContent(selector) {
        const el = document.querySelector(selector);
        const content = el && el.getAttribute('content');
        return content ? content.trim() : null;
      }
      // Real gap fix (root-caused live via DevTools on a real profile):
      // LinkedIn's CSS classes are auto-generated per deploy (confirmed:
      // real page source shows hashed classes like "_17ca0086", not
      // stable names like ".pv-text-details__left-panel") -- that's why
      // every class-based selector below was quietly matching nothing,
      // with zero exceptions, on every profile tested. Open Graph meta
      // tags are the stable target instead: LinkedIn can't casually
      // change og:title/og:description without breaking every
      // WhatsApp/Slack/Facebook link preview of a profile, so unlike
      // CSS classes they're kept accurate release to release. This is
      // now the PRIMARY source for name/headline; DOM selectors are
      // kept only as a secondary fallback for whatever meta tags miss.
      function parseOgTitle() {
        const raw = metaContent('meta[property="og:title"]') || document.title || '';
        const t = raw.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
        const dashIdx = t.indexOf(' - ');
        if (dashIdx !== -1) {
          return { name: t.slice(0, dashIdx).trim(), headline: t.slice(dashIdx + 3).trim() };
        }
        return { name: t || null, headline: null };
      }
      // Real gap fix (reported live, twice now: name/headline extract
      // fine via og:title, but company/location/experience/education
      // are STILL empty -- the #experience / #education anchor-id
      // lookup below was carried over from the old code and never
      // actually confirmed against real current markup). Section
      // headings ("Experience", "Education", "Skills", "About") are
      // plain, always-visible English text LinkedIn shows every
      // visitor -- unlike a CSS class or an anchor id, hiding/renaming
      // that text would make the section unreadable to a human, so
      // it's the most stable hook available. This finds a section by
      // matching a real heading element's own text, not by guessing
      // an id or class on its container.
      function cleanBlockText(el) {
        const raw = (el.innerText || el.textContent || '');
        return raw.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
      }
      function sectionTextByHeading(headingText, maxLen) {
        // startsWith, not ===: LinkedIn appends a live count to some
        // headings (confirmed live: "Skills (4)", not "Skills") which
        // an exact match silently misses.
        const needle = headingText.toLowerCase();
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'))
          .filter((el) => (el.textContent || '').trim().toLowerCase().startsWith(needle));
        for (const heading of headings) {
          const container = heading.closest('section') || heading.parentElement;
          if (!container) continue;
          const lines = cleanBlockText(container).split('\n').filter((l) => !l.toLowerCase().startsWith(needle));
          const text = lines.join('\n');
          if (text.length > 5) return { text: text.slice(0, maxLen || 2000), lines };
        }
        return null;
      }
      function normalizedUrl() {
        try {
          const u = new URL(window.location.href);
          return u.origin + u.pathname.replace(/\/$/, '');
        } catch (e) {
          return window.location.href;
        }
      }

      // Always captured (not just on failure) so the very next console
      // log shows the real underlying page state instead of only this
      // function's own parsed-to-null outputs -- if fields are still
      // empty after this fix, this line tells us exactly what LinkedIn
      // is actually serving instead of requiring yet another guess.
      debug.push(
        `raw title="${document.title}" og:title="${metaContent('meta[property="og:title"]')}" ` +
        `og:desc="${(metaContent('meta[property="og:description"]') || metaContent('meta[name="description"]') || '').slice(0, 120)}" ` +
        `h1Count=${document.querySelectorAll('h1').length} h2Count=${document.querySelectorAll('h2').length}`
      );

      const ogParsed = safe('og-title', parseOgTitle, { name: null, headline: null });
      // Real gap fix (reported live: a candidate got saved with headline
      // "HR proBusiness Consulting and Services4,416 followers" -- text
      // that appears NOWHERE on the actual profile page). og:description
      // is a LinkedIn SPA meta tag; client-side navigation between
      // profiles in the same tab doesn't reliably re-render it, so it
      // can silently hold content left over from a DIFFERENT page/
      // widget. Using it as a headline fallback risked writing flatly
      // wrong text onto a candidate's record -- worse than leaving the
      // field blank (see CLAUDE.md: never guess-correct an identity
      // field). It's demoted to logging-only below; the DOM-derived
      // headline (found the same structural way as location, a few
      // lines down) is what actually replaces it.
      const ogDescriptionRaw = safe('og-description', () => metaContent('meta[property="og:description"], meta[name="description"]'), null);

      const name = ogParsed.name
        || safe('name-dom', () => firstMatch(['.pv-text-details__left-panel h1', 'main h1', 'h1', 'main h2', 'h2']), null);
      // Real gap fix (reported live TWICE: name now extracts fine via
      // og:title, but company/location/experience were still empty on
      // both a first attempt using href/id-based hooks AND real current
      // profiles). Rather than guess a fifth selector blind, this walks
      // UP from the fixed "Contact info" label until it reaches an
      // ancestor whose own text is more than just that label -- LinkedIn
      // wraps each short text run in its own span, so the immediate
      // parent is often empty of anything else and a fixed single hop
      // (the earlier attempt) undershoots the real row. The headline is
      // then read off that row's previous sibling -- the visual order
      // (name, headline, location) is a much more stable assumption than
      // any specific tag or class.
      function findLocationRow() {
        const contactLink = Array.from(document.querySelectorAll('a'))
          .find((a) => (a.textContent || '').trim() === 'Contact info');
        if (!contactLink) return null;
        let node = contactLink.parentElement;
        for (let depth = 0; node && depth < 5; depth++) {
          const text = node.textContent
            .replace('Contact info', '')
            .replace(/[·•]/g, ' ')
            .replace(/[\d,]+\+?\s*connections?/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (text) return { node, text };
          node = node.parentElement;
        }
        return null;
      }
      const locationRow = safe('location-row', findLocationRow, null);
      // Caught by the offline mock test before shipping (not live): a
      // plain "take the immediately previous sibling" both undershoots
      // when the row it wants is further back, AND wrongly grabs a
      // company/education badge element that happens to sit between the
      // headline and the location row. Walks back past up to a few
      // siblings, skipping anything that IS or CONTAINS a company/school
      // link, and stops at the name heading itself as a hard boundary.
      const headline = safe('headline-row', () => {
        if (!locationRow) return null;
        let sib = locationRow.node.previousElementSibling;
        for (let hops = 0; sib && hops < 6; hops++, sib = sib.previousElementSibling) {
          if (/^H[1-4]$/.test(sib.tagName)) break; // reached the name heading -- stop, nothing found
          const isBadge = (sib.matches && sib.matches('a[href*="/company/"], a[href*="/school/"]'))
            || (sib.querySelector && sib.querySelector('a[href*="/company/"], a[href*="/school/"]'));
          if (isBadge) continue;
          const text = sib.textContent && sib.textContent.trim();
          if (text && text.length > 4 && text !== name) return text;
        }
        return null;
      }, null)
        || ogParsed.headline
        || safe('headline-dom', () => firstMatch(['.pv-text-details__left-panel .text-body-medium', '.text-body-medium.break-words']), null);

      function currentCompanyFromLink() {
        const links = document.querySelectorAll('a[href*="/company/"]');
        for (const a of links) {
          const text = (a.textContent || '').trim();
          if (text) return text;
        }
        return null;
      }

      // Real gap fix (reported live: "number and email id not extracted"
      // -- v1 deliberately never scraped these at all, see README). This
      // now reads them the same way a human would: click the real
      // "Contact info" link and read whatever LinkedIn itself declares
      // in the panel it opens. Never invents a value -- if the profile
      // owner hasn't made an email/phone visible to this viewer (common
      // for a 2nd/3rd-degree connection), the panel simply won't have
      // one and this correctly returns null, same as today. mailto:
      // links are a real HTML convention LinkedIn can't casually drop
      // without breaking the "Send email" button itself, so that's the
      // primary hook; phone has no such anchor, so it's read off the
      // fixed "Phone" label the same way location was found off
      // "Contact info". [role="dialog"] is an accessibility attribute
      // (not a CSS class), used here for the same reason "Contact info"
      // and mailto: were chosen -- LinkedIn can't rename it without
      // breaking screen-reader support for the same panel.
      async function openContactInfoAndExtract() {
        const contactLink = Array.from(document.querySelectorAll('a'))
          .find((a) => (a.textContent || '').trim() === 'Contact info');
        if (!contactLink) return { email: null, phone: null };
        contactLink.click();

        let dialog = null;
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          dialog = document.querySelector('[role="dialog"]');
          if (dialog && (dialog.querySelector('a[href^="mailto:"]') || /contact info/i.test(dialog.textContent))) break;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (!dialog) return { email: null, phone: null };

        const mailLink = dialog.querySelector('a[href^="mailto:"]');
        const email = mailLink
          ? (mailLink.textContent.trim() || decodeURIComponent(mailLink.href.replace(/^mailto:/i, '')))
          : null;

        let phone = null;
        const labels = Array.from(dialog.querySelectorAll('h3, h2, span, div'));
        const phoneLabel = labels.find((el) => (el.textContent || '').trim().toLowerCase() === 'phone');
        if (phoneLabel) {
          const sib = phoneLabel.nextElementSibling || (phoneLabel.parentElement && phoneLabel.parentElement.nextElementSibling);
          const text = sib && sib.textContent && sib.textContent.trim();
          if (text) phone = text;
        }

        const dismissBtn = dialog.querySelector('button[aria-label="Dismiss"], button[aria-label*="Dismiss" i], button[aria-label*="close" i]');
        if (dismissBtn) dismissBtn.click();

        return { email, phone };
      }

      const aboutSection = safe('about-section', () => sectionTextByHeading('About', 800), null);
      const skillsSection = safe('skills-section', () => sectionTextByHeading('Skills', 500), null);
      const experienceSection = safe('experience-section', () => sectionTextByHeading('Experience', 2000), null);
      const educationSection = safe('education-section', () => sectionTextByHeading('Education', 800), null);

      debug.push(
        `sections found: about=${!!aboutSection} skills=${!!skillsSection} experience=${!!experienceSection} education=${!!educationSection}`
      );

      // Best-effort fallback: the line right after the job title in the
      // Experience block is almost always "Company · EmploymentType"
      // (e.g. "CipherStudio · Full-time") -- not as precise as a
      // dedicated element, but the section text itself is now reliably
      // found, so this beats returning nothing.
      const companyFromExperience = safe('company-from-experience', () => {
        if (!experienceSection || !experienceSection.lines || experienceSection.lines.length < 2) return null;
        return experienceSection.lines[1].split(' · ')[0].trim() || null;
      }, null);
      debug.push(
        `og:description(unused,logging-only)="${(ogDescriptionRaw || '').slice(0, 120)}" ` +
        `location-row=${JSON.stringify(locationRow && locationRow.text)} company-from-experience=${JSON.stringify(companyFromExperience)}`
      );

      const location = (locationRow && locationRow.text)
        || safe('location-dom', () => firstMatch(['.pv-text-details__left-panel .text-body-small.inline.t-black--light', '.pv-text-details__left-panel .text-body-small']), null);

      const currentCompany = safe('company-link', currentCompanyFromLink, null)
        || companyFromExperience;

      const resumeTextLike = [
        aboutSection ? 'About:\n' + aboutSection.text : '',
        skillsSection ? 'Skills:\n' + skillsSection.text : '',
        experienceSection ? 'Experience:\n' + experienceSection.text : '',
        educationSection ? 'Education:\n' + educationSection.text : '',
      ].filter(Boolean).join('\n\n') || null;

      const contact = await asyncSafe('contact-info', openContactInfoAndExtract, { email: null, phone: null });
      debug.push(`contact-info: email=${!!contact.email} phone=${!!contact.phone}`);

      return {
        name: name || null,
        current_title: headline || null,
        current_company: currentCompany,
        location: location || null,
        profile_url: safe('url', normalizedUrl, window.location.href),
        linkedin_url: safe('url', normalizedUrl, window.location.href),
        email: contact.email || null,
        phone: contact.phone || null,
        resume_text_like: resumeTextLike,
        _debug: debug.length ? debug : undefined,
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
  console.log('[AVIIN Import] active tab url:', tab?.url);
  if (!tab || !tab.url) return { ok: false, error: 'No active tab' };
  const adapter = matchAdapter(tab.url);
  if (!adapter) return { ok: false, error: 'not_supported_page' };

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: adapter.scrapeFn,
    });
    // Diagnostic aid (reported live, twice now, the same generic error
    // with no way to tell whether the fix even ran) — this bypasses
    // every layer of this file's OWN error-summarization logic (which
    // could itself have a bug) and shows the literal raw result Chrome
    // handed back. Visible in the service worker's own console, not the
    // popup — see extension/README.md for how to open it.
    console.log('[AVIIN Import] raw executeScript results:', JSON.stringify(results));
  } catch (e) {
    // A real, surfaced reason instead of the old generic message — e.g.
    // "Cannot access a chrome:// URL" or a permissions error would show
    // up here now instead of silently reading as "no name found". This
    // catches injection FAILING outright (the script never ran at all).
    return { ok: false, error: `Could not inject the scraper: ${e?.message || e}` };
  }
  // Real gap fix: chrome.scripting.executeScript's per-frame result can
  // ALSO carry an `.error` instead of `.result` if the injected function
  // itself threw uncaught (distinct from the injection failing outright,
  // caught above) — this was never checked, so a real in-page exception
  // silently read as "no name found" with the actual reason discarded.
  const frameResult = results && results[0];
  if (frameResult && frameResult.error) {
    return { ok: false, error: `Scraper error on the page: ${frameResult.error.message || frameResult.error}` };
  }
  const scraped = frameResult && frameResult.result;
  if (!scraped || !scraped.name) {
    const debugInfo = scraped && scraped._debug ? ` (${scraped._debug.join('; ')})` : '';
    return { ok: false, error: `Could not read this profile — try reloading the LinkedIn page and importing again.${debugInfo}` };
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
