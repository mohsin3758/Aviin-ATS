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
const BG_VERSION = 41;
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
// a real visitor. Reused as-is for Sales Navigator (see ADAPTERS
// below) -- a Lead page renders the same underlying profile data, just
// inside different UI chrome, and this function reads document/window
// state generically rather than hardcoding a linkedin.com/in/-specific
// assumption anywhere. This function is the one piece that will need
// occasional upkeep if LinkedIn changes its markup — nothing else in
// the extension needs to change alongside it.
async function scrapeLinkedinProfile() {
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
      // Real gap fix (reported live: a candidate's name came back as
      // "Deepan Majumdar Deepan Majumdar . 1stCertified SAP Finance
      // Consultant | SAP FI-CA | SAP FICO | Public CloudKolkata, West
      // Bengal, IndiaMessageCertifications: ...Sumit Kelkar, Shubham
      // Jain & 81 other mutual connections" -- every real element from
      // the top card concatenated into one string, with the real name
      // literally repeated at the start). That exact content --  name
      // twice, connection degree, headline, location, the Message
      // button, mutual connections -- is the signature of LinkedIn's own
      // hidden accessibility-summary heading, which screen readers use
      // to announce the whole top card at once and which also happens
      // to be an <h1>. document.querySelector('h1') only ever returns
      // the FIRST h1 in DOM order; if that hidden summary heading comes
      // before the real, short, visible name heading, this always
      // picked the wrong one. A real person's name is never anywhere
      // close to this length, so any candidate under a selector is now
      // rejected past a sane cap instead of accepted on faith -- and
      // ALL elements matching a given selector are tried (not just the
      // first), so a rejected oversized match doesn't stop this from
      // finding the real, short one still under the same selector.
      function firstMatch(selectors, maxLen) {
        for (const sel of selectors) {
          const candidates = Array.from(document.querySelectorAll(sel));
          for (const el of candidates) {
            const text = el && el.textContent && el.textContent.trim();
            if (text && (!maxLen || text.length <= maxLen)) return text;
          }
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
        // Real gap fix (reported live, with a real screenshot of the
        // actual Experience detail page showing 7 full roles): About
        // extracted fine but Experience/Education came back completely
        // empty -- not truncated, not partial, nothing at all. This
        // query used to only check h1-h4, but findContactInfoPanel
        // (elsewhere in this file) already had to add [role="heading"]
        // for the exact same reason -- LinkedIn's own design system uses
        // non-semantic heading elements (a styled div with an ARIA
        // heading role) for some section types and never got that same
        // fix applied here. Also: the old code gave up entirely if
        // heading.closest('section') (or its immediate parent) happened
        // to contain only the heading itself with the real entries
        // living in a sibling container instead -- the exact "undershoots
        // the real row" class of bug already found and fixed for company/
        // headline extraction earlier in this file, just never
        // generalized to this function. Now climbs up to 4 ancestor
        // levels, same bounded pattern used everywhere else in this file,
        // stopping at the first container with real content beyond just
        // the heading label.
        const needle = headingText.toLowerCase();
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
          .filter((el) => (el.textContent || '').trim().toLowerCase().startsWith(needle));
        for (const heading of headings) {
          let container = heading.closest('section') || heading.parentElement;
          for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
            // Strip just the heading TEXT from a line, rather than
            // discarding the whole line -- if the heading and its first
            // content line ever end up concatenated with no separator
            // (browser innerText normally inserts one between block
            // elements, but isn't guaranteed for every possible layout),
            // dropping the whole line would silently lose real content
            // instead of just the heading label.
            const lines = cleanBlockText(container).split('\n')
              .map((l) => {
                if (!l.toLowerCase().startsWith(needle)) return l;
                // Also drop a bare leftover count like "(4)" once the
                // heading word itself is stripped from e.g. "Skills (4)".
                return l.slice(needle.length).trim().replace(/^\(\d+\)$/, '').trim();
              })
              .filter(Boolean);
            const text = lines.join('\n');
            if (text.length > 5) {
              const cap = maxLen || 2000;
              if (text.length <= cap) return { text, lines };
              // Real gap fix (reported live, comparing the real LinkedIn
              // Experience detail page against the ATS resume side by
              // side: a senior candidate's real 7 roles came back with
              // only the first 4 -- the last 3 (older, but real) jobs
              // were silently missing). A bare text.slice(0, maxLen)
              // truncates mid-line wherever the character cap happens to
              // land, which can cut a role or a bullet in half AND
              // discard everything after it. Rebuilds from whole lines
              // up to the cap instead, so a long profile only ever loses
              // its LAST few complete lines (if any), never a half-cut
              // bullet, and never a role bullet later in the section that
              // happened to still fit.
              let acc = '';
              const keptLines = [];
              for (const line of lines) {
                if (acc.length + line.length + 1 > cap) break;
                acc += (acc ? '\n' : '') + line;
                keptLines.push(line);
              }
              return { text: acc, lines: keptLines };
            }
          }
        }
        return null;
      }
      function normalizedUrl() {
        try {
          const u = new URL(window.location.href);
          let path = u.pathname.replace(/\/$/, '');
          // Real gap fix (reported live: stored linkedin_url ended in
          // "/overlay/contact-info" -- LinkedIn appends a sub-path like
          // this to the URL while a panel such as Contact Info is open).
          // Keep only the real profile slug so linkedin_url is always
          // the canonical profile URL a human would share, never an
          // artifact of whatever overlay happened to be open at the
          // moment of import -- this also matters for future dedup
          // matching, which compares this exact string.
          const profileMatch = path.match(/^(\/in\/[^/]+)/);
          if (profileMatch) path = profileMatch[1];
          return u.origin + path;
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

      // Real gap fix (reported live: Navneet Kumar's import came back
      // with a COLLEGE name in the headline slot and a company-ad-
      // looking string ("...4,419 followers") in the employer slot,
      // with email/phone BOTH empty despite being clearly visible
      // on-screen). Root-caused via the stored linkedin_url itself,
      // which ended in "/overlay/contact-info": the Contact Info panel
      // was ALREADY open (the user had checked it manually) at the
      // moment Import was clicked. Every extraction step below assumes
      // a clean, un-obstructed page -- an already-open overlay sits on
      // top of the real profile and throws off the structural (DOM-
      // sibling-walk, first "/company/" link) heuristics into reading
      // the overlay's own content, or an unrelated ad/suggestion
      // widget, instead of the real profile. Detected and closed FIRST,
      // before any other field is read -- and its email/phone read
      // directly while it's open, since openContactInfoAndExtract()
      // further below only knows how to CLICK OPEN a currently-closed
      // panel, not read one that's already showing.
      // Real gap fix (reported live: email/phone STILL both empty even
      // on a confirmed-clean scrape where the dialog genuinely opened
      // with real data visible on screen). Two compounding fragilities,
      // both generalized away here: (1) email assumed LinkedIn always
      // wraps it in a real mailto: link -- but the same screenshot shows
      // "Address" ALSO styled as blue link-like text, suggesting several
      // Contact-info fields get link-like styling generically, not
      // necessarily via the mailto: protocol specifically for email;
      // (2) "check one or two fixed sibling levels" for phone is the
      // exact same "undershoots because LinkedIn wraps things deeper
      // than expected" problem already found and fixed for the "Contact
      // info" row itself further up this file, just never generalized
      // to these two fields. This climbs multiple ancestor levels (like
      // that earlier fix) and reads the line immediately after the
      // label in the container's own rendered text -- label-based, not
      // link-based, so it works regardless of whether a field happens
      // to be a real hyperlink. Shared by BOTH extraction call sites
      // below (a dialog found already open, and one freshly opened by
      // a click) -- a previous version duplicated this logic across
      // both and only ever got fixed in one of them.
      // Real gap fix (reported live, twice now, with a real screenshot
      // this time): an exact "===" match against a label's own text is
      // the exact same fragility already found and fixed for "Skills
      // (4)" earlier in this file -- LinkedIn commonly appends hidden,
      // screen-reader-only text to a label ("Phone, click to view phone
      // number") that a real visitor never sees but which is still part
      // of the element's textContent, silently defeating an exact
      // match. Switched to startsWith, the same fix already applied
      // there. Also scans a few lines past the label (not just the very
      // next one) and skips anything that itself looks like ANOTHER
      // known Contact-info label, in case a hidden accessibility line
      // sits between the label and the real value.
      const CONTACT_INFO_LABELS = ['phone', 'email', 'address', 'birthday', 'connected since', 'websites', 'im'];
      function readValueNearLabel(dialog, labelText) {
        const needle = labelText.trim().toLowerCase();
        const candidates = Array.from(dialog.querySelectorAll('h3, h2, span, div, dt, label'))
          .filter((el) => (el.textContent || '').trim().toLowerCase().startsWith(needle));
        for (const labelEl of candidates) {
          let container = labelEl.parentElement;
          for (let depth = 0; container && depth < 4; depth++) {
            const raw = (container.innerText || container.textContent || '');
            const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
            const idx = lines.findIndex((l) => l.toLowerCase().startsWith(needle));
            if (idx !== -1) {
              for (let j = idx + 1; j < lines.length && j <= idx + 3; j++) {
                const cand = lines[j];
                const isAnotherLabel = CONTACT_INFO_LABELS.some((o) => cand.toLowerCase().startsWith(o));
                if (cand && !isAnotherLabel) return cand;
              }
            }
            container = container.parentElement;
          }
        }
        return null;
      }
      function extractFromOpenDialog(dialog) {
        const mailLink = dialog.querySelector('a[href^="mailto:"]');
        const email = (mailLink
          ? (mailLink.textContent.trim() || decodeURIComponent(mailLink.href.replace(/^mailto:/i, '')))
          : null) || readValueNearLabel(dialog, 'Email');
        const phone = readValueNearLabel(dialog, 'Phone');
        return { email, phone };
      }
      // Real gap fix (reported live: the panel was confirmed manually
      // open, with real Phone/Email visibly showing, and this STILL
      // failed to read it -- proving [role="dialog"] alone isn't a
      // reliable way to find this panel on this account/render, since a
      // genuinely-open panel should always be findable by that if it
      // actually used that role). Directly confirmed via several
      // screenshots that the panel's own title renders as a real
      // heading reading "Contact info" -- separate from the trigger
      // link on the page itself (a plain, non-heading <a>) -- so this
      // is used as the primary detection signal instead of relying on
      // an ARIA role this page may not actually set. Falls back to
      // [role="dialog"] as a secondary check in case some other real
      // account/render DOES use it correctly.
      function findContactInfoPanel() {
        // Real gap fix (reported live: for a profile with no Phone
        // section at all, this climbed ALL THE WAY UP into the page's
        // own nav menu -- "Home", "My Network", "Jobs", "Messaging"...
        // -- because nothing at any of the first 8 ancestor levels
        // happened to mention "phone" or "email", so it kept climbing
        // until SOMETHING on the page coincidentally did, then picked
        // up a wrong, unrelated email from that much wider scope. A
        // real Contact Info popup (Profile link, Phone, Address, Email,
        // Birthday, Connected since) is at most a few hundred
        // characters -- capping how large a candidate container is
        // allowed to get stops the climb before it can ever reach
        // page-wide content like the nav.
        const heading = Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
          .find((el) => (el.textContent || '').trim().toLowerCase().startsWith('contact info'));
        if (heading) {
          let container = heading.parentElement;
          let lastReasonable = heading.parentElement;
          for (let depth = 0; container && depth < 6; depth++) {
            const text = container.textContent || '';
            if (text.length > 2000) break; // implausibly large for a real Contact Info popup -- stop, don't climb further
            lastReasonable = container;
            const lower = text.toLowerCase();
            if (lower.includes('phone') || lower.includes('email')) return container;
            container = container.parentElement;
          }
          return lastReasonable;
        }
        return document.querySelector('[role="dialog"]');
      }
      const preOpenDialog = safe('pre-open-dialog', findContactInfoPanel, null);
      let preOpenContact = null;
      if (preOpenDialog) {
        preOpenContact = safe('pre-open-dialog-extract', () => extractFromOpenDialog(preOpenDialog), null);
        const dismissBtn = preOpenDialog.querySelector(
          'button[aria-label="Dismiss"], button[aria-label*="Dismiss" i], button[aria-label*="close" i]');
        if (dismissBtn) safe('pre-open-dialog-dismiss', () => dismissBtn.click(), null);
        debug.push(`pre-existing dialog found and closed: email=${!!(preOpenContact && preOpenContact.email)} phone=${!!(preOpenContact && preOpenContact.phone)}`);
        await new Promise((resolve) => setTimeout(resolve, 300)); // let the DOM settle after closing before reading anything else
      }

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
        || safe('name-dom', () => firstMatch(['.pv-text-details__left-panel h1', 'main h1', 'h1', 'main h2', 'h2'], 100), null);
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
      // Real gap fix (reported live: location came back as "Certified
      // SAP Finance Consultant | SAP FI-CA | SAP FICO | Public Cloud" --
      // the candidate's own headline, with zero real location text at
      // all. Traced the cascade: this picked the WRONG "Contact info"
      // link/row for this profile -- the exact same "which duplicate
      // element wins a first-match query" issue already found and fixed
      // for the name field's hidden accessibility heading -- and since
      // the headline backward-walk below starts FROM this row, it then
      // landed one row further back than it should have and returned
      // the NAME as the headline/designation too). A real location
      // string never uses LinkedIn's headline convention of listing
      // multiple specializations separated by " | " -- rejecting a
      // candidate that looks like a headline instead of accepting on
      // faith, and trying every "Contact info" link on the page (not
      // just the first), stops this the same general way the name fix
      // did: don't trust winning a query, verify the shape of what it
      // found.
      function looksLikeHeadlineNotLocation(text) {
        return / \| /.test(text || '');
      }
      function findLocationRow() {
        const contactLinks = Array.from(document.querySelectorAll('a'))
          .filter((a) => (a.textContent || '').trim() === 'Contact info');
        for (const contactLink of contactLinks) {
          let node = contactLink.parentElement;
          for (let depth = 0; node && depth < 5; depth++) {
            const text = node.textContent
              .replace('Contact info', '')
              .replace(/[·•]/g, ' ')
              .replace(/[\d,]+\+?\s*connections?/gi, '')
              .replace(/\s+/g, ' ')
              .trim();
            if (text && !looksLikeHeadlineNotLocation(text)) return { node, text };
            node = node.parentElement;
          }
        }
        return null;
      }
      const locationRow = safe('location-row', findLocationRow, null);
      // Real gap fix (reported live: "JYOTI COLLEGE OF MANAGEMENT
      // SCIENCE AND TECHNOLOGY, BAREILLY" -- an education badge -- got
      // returned as the headline). The isBadge link-based skip below is
      // the primary defense, but LinkedIn doesn't always wrap an
      // education/company badge in a matching href (confirmed live: it
      // still got through once), so this is a second, content-shape-
      // based check -- a real personal headline is essentially never
      // ALL CAPS, and institution names are a recognizable, narrow
      // vocabulary a real headline is very unlikely to consist of.
      function looksLikeInstitutionOrJunk(text) {
        if (!text) return false;
        if (/\b(college|university|institute|school|academy|polytechnic)\b/i.test(text)) return true;
        const letters = text.replace(/[^A-Za-z]/g, '');
        return letters.length > 8 && letters === letters.toUpperCase();
      }
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
          if (text && text.length > 4 && text !== name && !looksLikeInstitutionOrJunk(text)) return text;
        }
        return null;
      }, null)
        || ogParsed.headline
        || safe('headline-dom', () => firstMatch(['.pv-text-details__left-panel .text-body-medium', '.text-body-medium.break-words']), null);

      // Real gap fix (reported live: current_company came back as "HR
      // proBusiness Consulting and Services4,419 followers" -- the text
      // of a company-page AD/suggestion card, not the candidate's real
      // employer). An unbounded "first /company/ link anywhere in the
      // document" can't tell a sidebar ad/suggestion widget's company
      // link apart from the real employer badge in the top card, and a
      // sidebar widget can render EARLIER in DOM source order than the
      // visually-later main content. Now bounded to links that appear
      // before locationRow in document order -- the top card is
      // everything above it, and every ad/suggestion widget or
      // Experience-section entry observed so far renders after it.
      function currentCompanyFromLink() {
        // Real gap fix (reported live TWICE now: an unbounded "/company/"
        // search, and then a "shared ancestor with locationRow" scoping
        // attempt, both still returned a sidebar ad/suggestion widget's
        // own text -- confirmed live, the ad sits close enough in the
        // DOM tree to share an ancestor with the real top card on a real
        // page, unlike the offline mock this was first verified against).
        // Switched to the SAME backward-sibling-walk-from-locationRow
        // pattern already proven reliable for headline extraction just
        // above (its badge-skip logic already demonstrates company/
        // school badges genuinely are top-card siblings on a real page).
        // Deliberately has NO wider fallback search left: if nothing
        // turns up in that bounded walk (e.g. this profile's top card
        // simply has no distinct company badge), returning null is the
        // honest outcome -- degrading to an unscoped document-wide
        // search is exactly what picked up the ad both previous times.
        if (!locationRow || !locationRow.node) return null;
        let sib = locationRow.node.previousElementSibling;
        for (let hops = 0; sib && hops < 6; hops++, sib = sib.previousElementSibling) {
          if (/^H[1-4]$/.test(sib.tagName)) break; // reached the name heading -- stop, nothing found
          const companyLink = (sib.matches && sib.matches('a[href*="/company/"]'))
            ? sib
            : (sib.querySelector && sib.querySelector('a[href*="/company/"]'));
          if (!companyLink) continue;
          const text = (companyLink.textContent || '').trim();
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
      // Real gap fix (reported live, confirmed via the service worker
      // console: "clicked 'Contact info' but no [role=\"dialog\"]
      // appeared within 2.5s" -- the dialog was never even opening, so
      // every label-reading fix so far never had a chance to run at
      // all). A plain element.click() only fires a synthetic click
      // event; some React components attach their real open-panel
      // handler to pointerdown/mousedown instead (or require the full
      // native event sequence a real click produces), and silently
      // never fire on a bare .click() alone. Dispatches the fuller
      // pointerdown -> mousedown -> mouseup -> click sequence a genuine
      // user interaction produces, which reaches handlers a bare
      // .click() can miss.
      function robustClick(el) {
        const opts = { bubbles: true, cancelable: true, view: window };
        try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) { /* PointerEvent not available in every context */ }
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) { /* ditto */ }
        el.click();
      }
      async function openContactInfoAndExtract() {
        const contactLink = Array.from(document.querySelectorAll('a'))
          .find((a) => (a.textContent || '').trim() === 'Contact info');
        if (!contactLink) {
          debug.push('contact-info: no "Contact info" link found on this page');
          return { email: null, phone: null };
        }
        robustClick(contactLink);

        // Real gap fix (reported live: a different profile's dialog
        // lines came back as literally just ["Contact info"] -- the
        // panel's OWN heading appears in the DOM before its actual
        // content (Phone/Email/etc.) has finished rendering, and the
        // old "ready" check only required the word "contact info" to
        // be present anywhere -- which the heading alone already
        // satisfies, so the poll broke out one tick too early, before
        // there was anything real to read). Now requires the panel to
        // show some ADDITIONAL real signal beyond just its own title.
        let dialog = null;
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          dialog = findContactInfoPanel();
          if (dialog) {
            const text = (dialog.textContent || '').toLowerCase();
            const hasRealContent = dialog.querySelector('a[href^="mailto:"]')
              || text.includes('phone') || text.includes('email') || text.includes('profile');
            if (hasRealContent) break;
          }
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (!dialog) {
          // Real diagnostic gap (this session, "deep check to get mobile
          // number and email id"): every extension-imported candidate so
          // far has BOTH fields empty, with no way to tell whether that's
          // because the click never opened anything (link.click() from
          // an injected script is one plausible reason: some sites
          // ignore script-dispatched clicks on certain interactive
          // elements, unlike a real, OS-generated click) or because
          // those specific profiles simply don't expose contact info to
          // this viewer (very plausible on its own -- LinkedIn's own
          // visibility rule, not a bug). This distinguishes the two
          // instead of returning the same silent {null,null} either way.
          debug.push('contact-info: clicked "Contact info" but no panel (by heading or [role="dialog"]) appeared within 2.5s');
          return { email: null, phone: null };
        }

        // Reuses the same readValueNearLabel helper (defined once,
        // shared with extractFromOpenDialog above) instead of
        // duplicating this logic a second time in this second call site
        // -- exactly the kind of duplication that let phone get fixed
        // in one place and email stay broken in the other, last round.
        const mailLink = dialog.querySelector('a[href^="mailto:"]');
        const email = (mailLink
          ? (mailLink.textContent.trim() || decodeURIComponent(mailLink.href.replace(/^mailto:/i, '')))
          : null) || readValueNearLabel(dialog, 'Email');

        const phone = readValueNearLabel(dialog, 'Phone');
        // Dialog genuinely opened but a field is still missing --
        // distinguishes "this profile just doesn't expose contact info
        // to this viewer" (a real LinkedIn visibility rule, expected to
        // happen often) from the click/dialog-detection or label-
        // reading failing outright. Dumped LINE BY LINE (not flattened
        // to one whitespace-collapsed string) so the real structure --
        // including any hidden accessibility text riding along with a
        // label -- is actually visible in the next round instead of
        // requiring yet another guess.
        if (!email || !phone) {
          const rawLines = (dialog.innerText || dialog.textContent || '')
            .split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20);
          debug.push(`contact-info: email=${!!email} phone=${!!phone} -- dialog lines: ${JSON.stringify(rawLines)}`);
        }

        const dismissBtn = dialog.querySelector('button[aria-label="Dismiss"], button[aria-label*="Dismiss" i], button[aria-label*="close" i]');
        if (dismissBtn) dismissBtn.click();

        return { email, phone };
      }

      // Real gap fix (reported live, with side-by-side screenshots: the
      // real profile page clearly shows 5 Experience entries and an
      // Education entry, but the extracted resume_text_like came back
      // with ONLY the About paragraph -- Experience/Education were
      // missing entirely, not just truncated). sectionTextByHeading can
      // only find a heading that already EXISTS in the DOM -- LinkedIn
      // lazy-mounts everything below the initial viewport as the page is
      // scrolled near it, so on a freshly-loaded profile the Experience/
      // Education <h2> elements themselves may not be in the DOM yet at
      // the moment this function runs (name/headline/location/company
      // are unaffected since the top card is already in view on load).
      // Steps the window down through the full page height first, giving
      // LinkedIn's own lazy-render a chance to mount each section before
      // any of them is read -- the same "wait for real content to
      // appear" principle already used for the Contact Info panel, just
      // driven by scroll position instead of a click.
      // Real gap fix (reported live, with a real console log: a
      // FIXED-BUDGET scroll -- a set number of steps, each waited a
      // fixed 220ms -- still came back with experience=false,
      // education=false on a profile that had successfully captured
      // both sections on an earlier attempt just before this one, with
      // NO code change in between. That inconsistency between identical
      // attempts on the same profile is the signature of a real timing
      // race, not a structural DOM problem: LinkedIn's lazy-mount can
      // depend on a network round-trip whose duration varies between
      // page loads (especially after an SPA client-side navigation back
      // from a "details" sub-page, rather than a fresh full reload), so
      // a fixed step count can simply run out before the fetch resolves
      // one time and not another. Replaced with the same "poll for the
      // real signal, not a fixed budget" principle already used for the
      // Contact Info panel: keeps scrolling toward the (possibly still-
      // growing) bottom of the page and checking after each step whether
      // both the Experience and Education headings have actually
      // appeared, returning as soon as they have (often faster than the
      // old fixed budget) instead of only ever waiting exactly one fixed
      // amount regardless of how long this particular page load needs.
      // Real gap fix (reported live, confirmed by the user manually
      // scrolling that exact page themselves: Experience/Education
      // render FINE for a real human scroll on this profile, ruling out
      // both a LinkedIn-side restriction and a structural DOM problem --
      // yet a full 6-second poll of window.scrollTo() calls, one after
      // another, still found neither heading). window.scrollTo() moves
      // the scroll position directly; it does NOT dispatch a 'wheel' or
      // 'touch' event the way an actual mouse/trackpad gesture does. If
      // LinkedIn's lazy-load for these specific sections is wired to a
      // real scroll GESTURE rather than (or in addition to) the
      // resulting scroll position/IntersectionObserver, a position-only
      // jump can be a no-op for it -- the exact same class of gap
      // already found and fixed for the Contact Info panel's click
      // (needed the fuller pointerdown/mousedown/mouseup sequence, not a
      // bare .click()). Dispatches a real wheel event alongside each
      // scrollTo() call, giving LinkedIn's own listener the actual event
      // type a genuine scroll produces, not just its end position.
      function dispatchWheel(deltaY) {
        try {
          window.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, view: window }));
        } catch (e) { /* WheelEvent may not be constructible in every context */ }
      }
      async function ensureSectionsRendered() {
        const scrollStep = Math.max(400, Math.floor(window.innerHeight * 0.8));
        const hasHeading = (needle) => Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
          .some((el) => (el.textContent || '').trim().toLowerCase().startsWith(needle));
        const deadline = Date.now() + 6000;
        let y = 0;
        while (Date.now() < deadline) {
          if (hasHeading('experience') && hasHeading('education')) break;
          y += scrollStep;
          window.scrollTo(0, y);
          dispatchWheel(scrollStep);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        window.scrollTo(0, 0);
        dispatchWheel(-y);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      await asyncSafe('ensure-sections-rendered', ensureSectionsRendered, null);

      // Real gap fix (reported live, confirmed with an exact character
      // count on the actual stored text: the About section came back at
      // EXACTLY 807 characters, cutting off mid-word at "New dimensional
      // co" -- this candidate wrote a full career-summary-length About
      // section, not a short bio, and the old 800-char cap silently
      // clipped it. The same class of bug already found and fixed for
      // Experience (2000 was too small for a real multi-role profile);
      // never checked whether About/Skills/Education could hit their own
      // caps too until this exact evidence proved About could. Raised all
      // four section caps well past what a normal, detailed profile
      // needs -- the whole-line-preserving truncation (see
      // sectionTextByHeading above) already protects against a mid-word
      // cut for whatever still exceeds even this.
      const aboutSection = safe('about-section', () => sectionTextByHeading('About', 3000), null);
      const skillsSection = safe('skills-section', () => sectionTextByHeading('Skills', 1500), null);
      const experienceSection = safe('experience-section', () => sectionTextByHeading('Experience', 8000), null);
      const educationSection = safe('education-section', () => sectionTextByHeading('Education', 3000), null);

      debug.push(
        `sections found: about=${!!aboutSection} skills=${!!skillsSection} experience=${!!experienceSection} education=${!!educationSection}`
      );
      // Real diagnostic gap: if a section is STILL missing after
      // scrolling, this is the concrete next-round signal (what heading
      // text actually exists on the page right now) instead of another
      // guess at a selector or a heading-text variant.
      if (!experienceSection || !educationSection) {
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, [role="heading"]'))
          .map((h) => `${h.tagName}${h.getAttribute('role') ? '[role=heading]' : ''}:${(h.textContent || '').trim().slice(0, 40)}`)
          .filter((s) => !s.endsWith(':'))
          .slice(0, 25);
        debug.push(`experience/education still missing -- headings on page after scroll: ${JSON.stringify(allHeadings)}`);
      }

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

      // Prefer whatever the ALREADY-open dialog gave us at the very top
      // of this function -- clicking "Contact info" again here would
      // just open the same panel a second time for no benefit. Only
      // click-and-open a fresh one if there wasn't already one showing.
      const contact = (preOpenContact && (preOpenContact.email || preOpenContact.phone))
        ? preOpenContact
        : await asyncSafe('contact-info', openContactInfoAndExtract, { email: null, phone: null });
      debug.push(`contact-info: email=${!!contact.email} phone=${!!contact.phone}`);

      // Real gap fix ("deep check to get mobile number and email id"):
      // the Contact info panel is the authoritative source when it has
      // something, but it depends on (a) LinkedIn actually opening the
      // panel for a script-dispatched click, which isn't guaranteed the
      // same way a real user click is, and (b) the profile owner having
      // chosen to expose that field to this viewer at all -- either one
      // failing looks identical from here: empty. Some recruiters/
      // candidates instead write their email or number directly into
      // their headline or About/Experience text (a common practice to
      // stay reachable) -- this reads it from there as a second, click-
      // free path, filling in ONLY whatever the panel didn't already
      // provide. Scoped to the headline/section text already collected
      // above (never the raw page/DOM), so it can't pick up an
      // unrelated email/phone from an ad, a script tag, or someone
      // else's profile card elsewhere on the page.
      const contactTextScan = safe('contact-text-scan', () => {
        const blob = [headline, resumeTextLike].filter(Boolean).join('\n');
        const emailMatch = blob.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        const phoneMatch = blob.match(/(\+?\d[\d\s().-]{8,}\d)/);
        return {
          email: emailMatch ? emailMatch[0] : null,
          phone: phoneMatch ? phoneMatch[0].replace(/\s+/g, ' ').trim() : null,
        };
      }, { email: null, phone: null });
      const finalEmail = contact.email || contactTextScan.email;
      const finalPhone = contact.phone || contactTextScan.phone;
      if (contactTextScan.email || contactTextScan.phone) {
        debug.push(`contact-text-scan (used as fallback where panel had none): email=${!!contactTextScan.email} phone=${!!contactTextScan.phone}`);
      }

      return {
        name: name || null,
        current_title: headline || null,
        current_company: currentCompany,
        location: location || null,
        profile_url: safe('url', normalizedUrl, window.location.href),
        linkedin_url: safe('url', normalizedUrl, window.location.href),
        email: finalEmail || null,
        phone: finalPhone || null,
        resume_text_like: resumeTextLike,
        // Real gap fix (reported live, repeatedly, across v22/v26/v27:
        // three different fixes to force Experience/Education to mount
        // on the MAIN profile page -- lazy-mount waiting, then a poll,
        // then a real wheel event -- and a real console log STILL showed
        // both missing after all three, even though the user confirmed
        // a real human scroll on that exact page shows them fine. Rather
        // than chase a 4th theory about what event/gesture LinkedIn's
        // lazy-load actually requires, these are exposed separately (not
        // just pre-joined into resume_text_like) so scrapeActiveTab() in
        // background.js can fall back to scraping the dedicated
        // /details/experience/ and /details/education/ sub-pages
        // directly -- confirmed by the user's own copy-paste to render
        // completely, no scroll tricks needed -- and splice in whichever
        // is missing here, instead of leaving it permanently empty.
        about_text: aboutSection ? aboutSection.text : null,
        skills_text: skillsSection ? skillsSection.text : null,
        experience_text: experienceSection ? experienceSection.text : null,
        education_text: educationSection ? educationSection.text : null,
        _debug: debug.length ? debug : undefined,
      };
}

// Real gap fix (see the comment on scrapeLinkedinProfile's return above):
// a lightweight, PURPOSE-BUILT scraper for the dedicated
// /details/experience/ and /details/education/ sub-pages -- these pages
// show ONLY that one section's full list already rendered (confirmed via
// the user's own copy-paste, no lazy-load/scroll issue at all), so this
// doesn't need any of the heading-search/climb/scroll machinery
// scrapeLinkedinProfile needs for the main page.
// Real gap fix (reported live: the FIRST version of this function --
// verified only against a guessed mock, never real page output --
// shipped with a per-line blocklist that missed most of the actual
// noise on a real page: a "People Also Viewed" sidebar (real people's
// names and headlines, which can't be told apart from real content by
// word-matching alone) immediately followed by LinkedIn's global page
// footer (Accessibility, Talent Solutions, a 30-language picker, "©
// 2026", etc.) -- all of it got treated as real content and appended
// to BOTH Experience and Education, and Education ended up with NO
// real data at all, just this tail. Root cause of the missed
// connection-degree lines specifically: the regex required a line to
// START with a digit ("2nd"), but the real page renders it as "· 2nd"
// (a bullet character first) -- a plain word-blocklist can never be
// complete against arbitrary real names anyway. Replaced with a
// structural cutoff instead of more word-guessing: truncates the WHOLE
// remainder of the page at the first sign of either boundary --
// LinkedIn's footer (keyed on "linkedin corporation", present on every
// single page) or a connection-degree line ("· 2nd" etc., which also
// drops the person-name line immediately before it, since a sidebar
// card's name has no other distinguishing marker) -- whichever comes
// first, keeping everything before it untouched.
function scrapeDetailsPageText() {
  function isDegreeLine(line) {
    return /^[·•]?\s*(1st|2nd|3rd|\d+(st|nd|rd|th))\+?\s*$/i.test(line.trim());
  }
  // Real gap fix (reported live: a clean, correct Education capture
  // still had a stray "More profiles for you" tacked onto the very end
  // -- a sidebar widget heading with no degree-marker card following it
  // this time, so the degree-line cutoff below never triggered). Same
  // "widget heading means everything after it is boundary content"
  // reasoning as the degree-marker cutoff, just keyed on this specific
  // recurring LinkedIn widget title instead of its cards' shape.
  function isFooterLine(line) {
    return /linkedin corporation|visit our help center|select language|recommendation transparency|^more profiles for you$|^people also viewed$|^people you may know$/i.test(line.trim());
  }
  // Real gap fix (reported live: the Skills details page had real skill
  // names -- SAP Hybris Billing, SAP FI-CA, AutoCAD, SAS, SPSS, R,
  // Microsoft Office, SAP FICO -- but interspersed line-by-line with
  // LinkedIn's own endorsement UI: "2 endorsements", "Endorse",
  // "Endorsed by Nilesh Nikam (mutual connection)" repeated after almost
  // every skill, plus the page's filter tabs ("All", "Industry
  // Knowledge", "Tools & Technologies", "Other Skills") and a duplicate
  // "Skills" heading. Unlike the sidebar/footer noise above, this is
  // scattered THROUGHOUT the real content, not a trailing block -- a
  // single cutoff point can't remove it, so each of these needs
  // dropping individually, line by line, while every real skill line
  // (which never matches any of these exact/pattern forms) stays.
  const SKILLS_UI_NOISE_LINES = new Set(['skills', 'all', 'industry knowledge', 'tools & technologies', 'other skills', 'endorse']);
  function isSkillsUiNoiseLine(line) {
    const l = line.trim().toLowerCase();
    if (SKILLS_UI_NOISE_LINES.has(l)) return true;
    if (/^\d+\s+endorsements?$/.test(l)) return true;
    if (/^endorsed by /.test(l)) return true;
    return false;
  }
  try {
    const main = document.querySelector('main') || document.body;
    const raw = main.innerText || main.textContent || '';
    const allLines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let cutoff = allLines.length;
    for (let i = 0; i < allLines.length; i++) {
      if (isFooterLine(allLines[i])) { cutoff = Math.min(cutoff, i); break; }
    }
    for (let i = 0; i < allLines.length; i++) {
      if (isDegreeLine(allLines[i])) { cutoff = Math.min(cutoff, Math.max(0, i - 1)); break; }
    }
    const lines = allLines.slice(0, cutoff).filter((l) => !isSkillsUiNoiseLine(l));
    return { text: lines.join('\n').slice(0, 8000) };
  } catch (e) {
    return { text: null, error: e?.message || String(e) };
  }
}

const ADAPTERS = {
  linkedin: {
    urlPattern: /^https:\/\/(www\.)?linkedin\.com\/in\//,
    scrapeFn: scrapeLinkedinProfile,
  },
  salesNavigator: {
    // Real gap fix (reported live, "is we missing any features"): best-
    // effort, NOT verified against a real Sales Navigator page (no
    // Sales Navigator account/screenshot was available while building
    // this). Reuses the exact same extraction function as a plain
    // profile page rather than guessing new selectors -- a Lead page
    // renders the same underlying profile data inside different UI
    // chrome, and scrapeLinkedinProfile doesn't hardcode anything
    // specific to linkedin.com/in/ (it reads document/window state
    // generically). If an import here comes back with fields missing
    // that a matching linkedin.com/in/ import gets fine, check the
    // _debug output in the service worker console first -- same
    // diagnostic path used to fix every other gap in this file.
    urlPattern: /^https:\/\/(www\.)?linkedin\.com\/sales\/(lead|people)\//,
    scrapeFn: scrapeLinkedinProfile,
  },
};

function matchAdapter(url) {
  for (const key of Object.keys(ADAPTERS)) {
    if (ADAPTERS[key].urlPattern.test(url)) return ADAPTERS[key];
  }
  return null;
}

// Real gap fix (see the comment on scrapeLinkedinProfile's return, and
// scrapeDetailsPageText above): opens a details sub-page (experience or
// education) in a background tab -- never the user's active tab, so
// their own browsing isn't disturbed -- waits for it to actually load,
// scrapes it with the lightweight page-specific scraper, then always
// closes the tab (even on error) so a failed attempt never leaves a
// stray tab open.
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(listener); } catch (e) { /* already gone */ }
      resolve();
    }
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, timeoutMs);
  });
}

async function scrapeDetailsSubpage(baseProfileUrl, section, restoreToTabId) {
  const url = `${baseProfileUrl.replace(/\/$/, '')}/details/${section}/`;
  let tab;
  try {
    // Real gap fix (reported live: a full 5-second poll of a BACKGROUND
    // (active:false) tab never once returned more than "More profiles
    // for you" -- a small sidebar widget's own heading, 21 characters,
    // identical on every one of ~12 attempts. Not a slow hydration --
    // Chrome deliberately deprioritizes rendering/layout work in tabs
    // that are open but not visible on screen, which can leave a
    // background tab's real content effectively stalled rather than
    // just delayed. The user's own successful copy-pastes always came
    // from a normal, VISIBLE tab -- this makes the sub-page tab visible
    // too (briefly switching the browser to it, then switching back to
    // the tab the recruiter was actually on) instead of trying to
    // out-wait throttling that may never resolve.
    tab = await chrome.tabs.create({ url, active: true });
    await waitForTabComplete(tab.id, 8000);
    let best = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeDetailsPageText });
      const frameResult = results && results[0];
      const text = frameResult && frameResult.result && frameResult.result.text;
      if (text && (!best || text.length > best.length)) best = text;
      if (best && best.length > 300) break; // comfortably past a loading skeleton -- treat as hydrated
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    console.log(`[AVIIN Import] details sub-page (${section}) scrape: ${best ? best.length + ' chars' : 'nothing'}${best && best.length < 300 ? ` -- short result: ${JSON.stringify(best)}` : ''}`);
    return best || null;
  } catch (e) {
    console.log(`[AVIIN Import] details sub-page (${section}) scrape failed:`, e?.message || e);
    return null;
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (e) { /* tab may already be gone */ }
    }
    if (restoreToTabId) {
      try { await chrome.tabs.update(restoreToTabId, { active: true }); } catch (e) { /* original tab may be gone */ }
    }
  }
}

async function enrichWithDetailsPages(scraped, originalTabId) {
  if (!scraped.linkedin_url) return scraped;
  // Sequential, not Promise.all: only one tab can be the visible/active
  // one at a time, so opening both at once with active:true would just
  // immediately background whichever one lost the race -- the same
  // problem this whole fix exists to avoid, just moved to a different
  // tab. One at a time, each fully handled (including restoring focus)
  // before the next opens.
  if (!scraped.experience_text) {
    const text = await scrapeDetailsSubpage(scraped.linkedin_url, 'experience', originalTabId);
    if (text) scraped.experience_text = text;
  }
  if (!scraped.education_text) {
    const text = await scrapeDetailsSubpage(scraped.linkedin_url, 'education', originalTabId);
    if (text) scraped.education_text = text;
  }
  // Real gap fix (explicit user request, prioritized after a review
  // found Skills was the one section never confirmed against real
  // data): LinkedIn's main profile page only shows a short inline
  // preview of Skills (commonly capped around 5) with a "Show all N
  // skills" link to its own /details/skills/ sub-page for the full
  // list -- the exact same pattern already confirmed and fixed for
  // Experience/Education. A profile with no Skills section at all
  // simply returns nothing here (same graceful "genuinely not there"
  // outcome as any other missing field), so this never invents data --
  // it only recovers a real, truncated list the main page under-shows.
  if (!scraped.skills_text) {
    const text = await scrapeDetailsSubpage(scraped.linkedin_url, 'skills', originalTabId);
    if (text) scraped.skills_text = text;
  }
  scraped.resume_text_like = [
    scraped.about_text ? 'About:\n' + scraped.about_text : '',
    scraped.skills_text ? 'Skills:\n' + scraped.skills_text : '',
    scraped.experience_text ? 'Experience:\n' + scraped.experience_text : '',
    scraped.education_text ? 'Education:\n' + scraped.education_text : '',
  ].filter(Boolean).join('\n\n') || null;
  return scraped;
}

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[AVIIN Import] active tab url:', tab?.url);
  if (!tab || !tab.url) return { ok: false, error: 'No active tab' };
  const adapter = matchAdapter(tab.url);
  if (!adapter) return { ok: false, error: 'not_supported_page' };

  // Real gap fix (reported live, with a real service worker console log:
  // a re-import of a profile with a full Experience/Education history
  // came back with EVERY field null except name/linkedin_url -- not a
  // scraper bug this time. The active tab URL in that log was
  // ".../details/experience/", not the main profile page -- LinkedIn's
  // "Show all N experiences" link navigates to a dedicated sub-page that
  // shows ONLY that one section, with no top card, no About, no Contact
  // info link, nothing else scrapeLinkedinProfile relies on. linkedin's
  // urlPattern (anything starting with /in/) matches this sub-page too,
  // so the extension silently activated there and produced a near-empty
  // "successful" scrape instead of any indication anything was wrong.
  // Refusing up front with a specific, actionable message is far better
  // than importing a stripped-down profile that looks like a clean
  // success -- exactly the failure mode that took 3 rounds of guessing
  // at the scraper itself to rule out, when the real fix was never in
  // scrapeLinkedinProfile() at all.
  if (/^https:\/\/(www\.)?linkedin\.com\/in\/[^/]+\/details\//.test(tab.url)) {
    return {
      ok: false,
      error: 'This is a LinkedIn "details" sub-page (it only shows one section, like Experience or Education) -- '
        + 'go back to the main profile page (the one with the photo and headline at the top) and import from there '
        + 'to capture the full profile.',
    };
  }

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
  // Real gap fix (see the comment on scrapeLinkedinProfile's return, and
  // scrapeDetailsPageText above): only pays the extra-tab cost when the
  // main page actually came up short on Experience/Education/Skills --
  // most profiles don't need this at all, so a normal import stays fast.
  if (adapter === ADAPTERS.linkedin && (!scraped.experience_text || !scraped.education_text || !scraped.skills_text)) {
    await enrichWithDetailsPages(scraped, tab.id);
  }
  return { ok: true, scraped };
}

const SEARCH_RESULTS_URL_PATTERN = /^https:\/\/(www\.)?linkedin\.com\/search\/results\/people\//;

// Real gap fix (reported live, "is we missing any features"): the
// single-profile flow above only ever handles one linkedin.com/in/
// page at a time -- a recruiter working a list of search results had
// to open each one individually. This reads whatever result cards are
// ALREADY rendered on a people-search page (no scrolling/auto-paging --
// only what a human looking at the page right now can already see,
// same "never simulate more activity than a human click" principle as
// the rest of this file) and returns a thin record per profile: name,
// best-effort headline/location, and the profile URL (the one field
// that's always reliable, since it's the link's own href). It
// deliberately does NOT open each profile individually to enrich it
// (company-via-/company/-link, About/Experience text, Contact info) --
// doing that across many profiles in one click would start to look
// like automated crawling rather than reading what's on screen, which
// this project avoids. A thin record imported this way can always be
// enriched later by opening that one profile and clicking "Update
// From LinkedIn" (see ext_capture_convert's fill-blank-fields logic).
function scrapeSearchResultsList() {
  const debug = [];
  function safe(label, fn, fallback) {
    try { return fn(); } catch (e) { debug.push(`${label}: ${e?.message || e}`); return fallback; }
  }
  function normalizeUrl(href) {
    try {
      const u = new URL(href, window.location.href);
      return u.origin + u.pathname.replace(/\/$/, '');
    } catch (e) {
      return href;
    }
  }
  function cardLines(el) {
    const raw = el.innerText || el.textContent || '';
    return raw.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  // Noise lines to filter out of a card's text before guessing at
  // name/headline/location -- LinkedIn search cards mix in degree
  // badges, action buttons, and connection counts in varying order/
  // positions depending on account type, so this filters by content
  // rather than a fixed line index. Badges are often rendered as
  // "· 2nd" (a leading separator dot) rather than a bare "2nd", so
  // each line is stripped of leading "·"/"•" before testing.
  const NOISE = /^(1st|2nd|3rd|\d+(st|nd|rd|th)?\+?\s*connection|connect$|message$|follow$|pending$|view profile|mutual connection|\d+\s*mutual|current:|previous:|see more$|\d+\s*followers?$)/i;
  const stripLeadingDot = (l) => l.replace(/^[·•]+\s*/, '').trim();

  const seen = new Set();
  const results = [];
  const links = safe('links', () => Array.from(document.querySelectorAll('a[href*="/in/"]')), []);
  for (const link of links) {
    if (results.length >= 25) break; // safety cap -- one page's worth, not an open-ended crawl
    const url = safe('normalize', () => normalizeUrl(link.href), null);
    if (!url || seen.has(url)) continue;
    if (!/\/in\/[^/]+$/.test(safe('path', () => new URL(url).pathname, ''))) continue; // skip non-profile links (e.g. /in/ mentions in unrelated text)

    const card = link.closest('li') || link.closest('[data-view-name]') || link.parentElement;
    if (!card) continue;

    const lines = safe('card-lines', () => cardLines(card), []);
    // Real gap fix (caught before shipping, via an offline mock test):
    // filtering noise only AFTER picking a name meant a card with no
    // real name text (just badges/buttons) fabricated a fake candidate
    // named "1st" or similar. Both the name fallback and headline/
    // location now draw from the SAME noise-filtered line list, so a
    // card with nothing real to show is skipped outright instead of
    // producing a bogus record.
    const cleanLines = lines.filter((l) => l && l.length > 2 && !NOISE.test(stripLeadingDot(l)));
    let name = safe('name', () => (link.textContent || '').trim(), '') || null;
    if (!name) name = cleanLines[0] || null;
    if (!name) continue; // no usable name -- skip rather than create a blank/bogus candidate

    const candidateLines = cleanLines.filter((l) => l !== name);
    const headline = candidateLines[0] || null;
    const location = candidateLines[1] || null;

    seen.add(url);
    results.push({
      name, current_title: headline, current_company: null, location,
      profile_url: url, linkedin_url: url, email: null, phone: null,
      resume_text_like: null,
    });
  }
  return { results, _debug: debug };
}

async function scrapeActiveTabSearchResults() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return { ok: false, error: 'No active tab' };
  if (!SEARCH_RESULTS_URL_PATTERN.test(tab.url)) return { ok: false, error: 'not_supported_page' };

  let execResults;
  try {
    execResults = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeSearchResultsList });
    console.log('[AVIIN Import] raw search-results scrape:', JSON.stringify(execResults));
  } catch (e) {
    return { ok: false, error: `Could not read this page: ${e?.message || e}` };
  }
  const frameResult = execResults && execResults[0];
  if (frameResult && frameResult.error) {
    return { ok: false, error: `Scraper error on the page: ${frameResult.error.message || frameResult.error}` };
  }
  const data = frameResult && frameResult.result;
  if (!data || !data.results || !data.results.length) {
    return { ok: false, error: 'No profiles found on this page — scroll so some results are visible, then try again.' };
  }
  return { ok: true, list: data.results, tabId: tab.id, tabUrl: tab.url };
}

function randomDelayMs(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

// Real gap fix (explicit user request, after confirming the single-
// profile pipeline's fixes all work: "apply same to all... at a time
// [many] profiles... in one click"). Visits each profile in the SAME
// tab that was already showing the search results -- exactly like a
// human clicking through one result at a time and going back, never
// many tabs/requests at once -- and runs the FULL per-profile scraper
// (including the Contact Info click-and-wait and the details-sub-page
// fallback), instead of only ever saving the thin card data (name/
// headline/location) bulk import used to save deliberately. A true
// "hundreds/thousands in one click" version was explicitly ruled out
// (real risk of LinkedIn rate-limiting or restricting the account that
// runs it) in favor of this: full depth per profile, capped to one
// page's worth per click (~25, same cap scrapeSearchResultsList
// already enforced), with a randomized few-second pause between
// profiles so the pattern reads as a person browsing, not a script.
async function enrichProfileFullyByUrl(url, tabId) {
  try {
    await chrome.tabs.update(tabId, { url });
    await waitForTabComplete(tabId, 10000);
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: scrapeLinkedinProfile });
    const frameResult = results && results[0];
    if (frameResult && frameResult.error) {
      console.log(`[AVIIN Import] bulk: full scrape error for ${url}:`, frameResult.error.message || frameResult.error);
      return null;
    }
    const scraped = frameResult && frameResult.result;
    if (!scraped || !scraped.name) return null;
    if (!scraped.experience_text || !scraped.education_text || !scraped.skills_text) {
      await enrichWithDetailsPages(scraped, tabId);
    }
    return scraped;
  } catch (e) {
    console.log(`[AVIIN Import] bulk: full scrape failed for ${url}:`, e?.message || e);
    return null;
  }
}

// Real gap fix (reported live: "there is no option to stop bulk
// importing, its working continuesly"). A bulk run can now take several
// minutes per page (each profile visits its own page, possibly two more
// for the details-sub-page fallback) with no way to interrupt it once
// started -- a real problem if it was started by mistake, or the
// recruiter just needs their browser back. Storage-backed rather than
// an in-memory flag, since the popup that would show a Stop button is
// frequently NOT the one that started the import (it closes every time
// the active tab switches, per the v35/v36 fixes) -- any later popup
// open can still request cancellation this way.
async function isBulkImportCancelRequested() {
  const stored = await new Promise((resolve) => chrome.storage.local.get('bulkImportCancelRequested', resolve));
  return !!(stored && stored.bulkImportCancelRequested);
}

async function importSearchResults(list, searchResultsTabId, originalUrl) {
  const summary = { created: 0, updated: 0, no_change: 0, error: 0, total: list.length, cancelled: false };
  await chrome.storage.local.set({ bulkImportStatus: 'running', bulkImportCancelRequested: false, bulkImportProgress: { current: 0, total: list.length, last: null } });
  for (let i = 0; i < list.length; i++) {
    if (await isBulkImportCancelRequested()) { summary.cancelled = true; break; }
    const thin = list[i];
    // Sequential, not parallel -- a batch of concurrent requests against
    // a recruiter's own account looks a lot more like automation than a
    // human clicking through a handful of imports one at a time.
    const full = await enrichProfileFullyByUrl(thin.linkedin_url, searchResultsTabId);
    const result = await importProfile(full || thin);
    if (result.status === 'created') summary.created += 1;
    else if (result.status === 'updated') summary.updated += 1;
    else if (result.status === 'no_change') summary.no_change += 1;
    else summary.error += 1;

    // Real gap fix (reported live: "no option and click view for
    // individual view, if succesfully upload all details" -- the popup
    // only ever showed a static "Importing..." message for the whole
    // multi-minute run, then one final summary at the end). Persists
    // after EVERY profile (not just at the end) so a popup open at any
    // point during the run -- the one that started it, or one reopened
    // later -- can show live progress and a link straight to the
    // profile that just finished, not just a running total.
    try {
      await chrome.storage.local.set({
        bulkImportProgress: {
          current: i + 1, total: list.length,
          last: { name: result.name, candidateId: result.candidateId, status: result.status },
        },
      });
    } catch (e) { /* non-critical -- the final summary still lands either way */ }

    if (i < list.length - 1) {
      // Checked in small steps rather than once per profile -- a single
      // profile can itself take 10-30+ seconds, so only ever honoring
      // Stop between whole profiles would feel unresponsive.
      const delayMs = randomDelayMs(2500, 5500);
      const stepMs = 500;
      for (let waited = 0; waited < delayMs; waited += stepMs) {
        if (await isBulkImportCancelRequested()) { summary.cancelled = true; break; }
        await new Promise((resolve) => setTimeout(resolve, Math.min(stepMs, delayMs - waited)));
      }
      if (summary.cancelled) break;
    }
  }
  await chrome.storage.local.set({ bulkImportStatus: 'idle', bulkImportCancelRequested: false });
  // Leaves the recruiter back where they started, like a human who
  // browsed through several profiles and returned to the results list --
  // true whether it finished naturally or was stopped early.
  if (originalUrl) {
    try { await chrome.tabs.update(searchResultsTabId, { url: originalUrl }); } catch (e) { /* tab may be gone */ }
  }
  return summary;
}

// Real gap fix (reported live, "is we missing any features"): the popup
// is a normal MV3 action popup -- Chrome tears it down the instant it
// loses focus (clicking elsewhere, alt-tabbing). An import takes a
// couple of seconds (scrape + the Contact info click-and-wait + two API
// calls); if the popup closes before that finishes, sendResponse still
// gets called but nothing is listening any more -- the import itself
// completes or fails on the server exactly the same either way, but the
// user never finds out and has no way to tell an early close from a
// real failure. A system notification (independent of the popup's own
// lifetime) was meant to close that gap.
// Real gap fix #2 (reported live: "it was showing popup result... now
// it's stopped" -- confirmed to be this exact scenario, not the system
// notification). The details-sub-page fallback (see
// enrichWithDetailsPages) deliberately switches the browser's ACTIVE
// tab to scrape Experience/Education reliably -- but that switch is
// ALSO exactly what makes Chrome tear down the popup, every single
// time an import needs that fallback, not just incidentally on an
// occasional focus loss. The system notification was supposed to cover
// this, but turned out to depend on OS-level notification settings
// this session couldn't fully control. Persists the result to
// chrome.storage.local as a second, code-only channel that doesn't
// depend on the popup surviving OR any OS setting -- popup.js shows it
// automatically the next time the extension icon is clicked, however
// long after the popup actually closed.
function notifyImportResult(result) {
  try {
    chrome.storage.local.set({ lastImportResult: { result, ts: Date.now() } });
  } catch (e) { /* storage full/unavailable -- the system notification below still tries */ }
  const title = 'AVIIN ATS Import';
  let message;
  switch (result.status) {
    case 'created': message = `Imported: ${result.name || 'candidate'}`; break;
    case 'updated': {
      const fields = (result.updatedFields || []).join(', ');
      message = `Updated ${result.name || 'candidate'}${fields ? ` — filled in: ${fields}` : ''}`;
      break;
    }
    case 'no_change': message = `${result.name || 'Candidate'} is already up to date.`; break;
    case 'not_supported': message = 'Open a LinkedIn profile page to import.'; break;
    case 'error': message = result.message || 'Something went wrong.'; break;
    default: return;
  }
  // Real gap fix (reported live: no system notification ever appeared
  // after a completed import, success or failure). Passing an explicit
  // empty-string id (instead of omitting it, the documented way to let
  // Chrome auto-generate one) is called out in real bug reports as
  // silently failing on some Chrome versions -- and this call never
  // checked chrome.runtime.lastError either, so a failure here had no
  // way to ever surface. Drops the id argument entirely and logs any
  // real error instead of failing silently.
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message }, () => {
    if (chrome.runtime.lastError) {
      console.log('[AVIIN Import] notification failed to show:', chrome.runtime.lastError.message);
    }
  });
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

  if (!convertRes.ok) {
    const msg = typeof convertData?.detail === 'string' ? convertData.detail : 'Could not create the candidate';
    return { status: 'error', message: msg };
  }
  // Real gap fix: re-importing an already-known profile used to just
  // refuse (409) with no action -- so a candidate created back when the
  // scraper was broken (missing company/location/skills/email/phone)
  // had no way to pick up the fix short of manually editing it in the
  // ATS. The backend now fills in whatever fields are currently blank
  // on the matched candidate and reports which ones it touched; this
  // just surfaces that outcome instead of a flat "already exists".
  if (convertData.status === 'updated') {
    return { status: 'updated', candidateId: convertData.candidate_id, name: convertData.candidate_name, updatedFields: convertData.updated_fields || [] };
  }
  if (convertData.status === 'no_change') {
    return { status: 'no_change', candidateId: convertData.candidate_id, name: convertData.candidate_name };
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
            const failResult = { status: scrapeResult.error === 'not_supported_page' ? 'not_supported' : 'error', message: scrapeResult.error };
            notifyImportResult(failResult);
            sendResponse(failResult);
            break;
          }
          const importResult = await importProfile(scrapeResult.scraped);
          notifyImportResult(importResult);
          sendResponse(importResult);
          break;
        }
        case 'IMPORT_SEARCH_RESULTS': {
          const statusCheck = await new Promise((resolve) => chrome.storage.local.get('bulkImportStatus', resolve));
          if (statusCheck && statusCheck.bulkImportStatus === 'running') {
            sendResponse({ status: 'error', message: 'A bulk import is already running — use Stop Import first if you want to start a different one.' });
            break;
          }
          const listResult = await scrapeActiveTabSearchResults();
          if (!listResult.ok) {
            const failResult = { status: listResult.error === 'not_supported_page' ? 'not_supported' : 'error', message: listResult.error };
            sendResponse(failResult);
            break;
          }
          const summary = await importSearchResults(listResult.list, listResult.tabId, listResult.tabUrl);
          const batchResult = { status: 'batch_done', summary };
          // Real gap fix (same class already found and fixed for the
          // single-profile flow): now that bulk import visits each
          // profile's own page in turn, the popup closes the same way a
          // single import's details-sub-page fallback closes it --
          // persisted here so the summary is still there the next time
          // the popup opens, not just via the system notification.
          try {
            chrome.storage.local.set({ lastImportResult: { result: batchResult, ts: Date.now() } });
          } catch (e) { /* storage full/unavailable -- notification below still tries */ }
          chrome.notifications.create({
            type: 'basic', iconUrl: 'icons/icon128.png', title: 'AVIIN ATS Import',
            message: `${summary.cancelled ? 'Bulk import stopped' : 'Bulk import done'}: ${summary.created} created, ${summary.updated} updated, ${summary.no_change} already up to date, ${summary.error} failed (of ${summary.total}).`,
          }, () => {
            if (chrome.runtime.lastError) {
              console.log('[AVIIN Import] batch notification failed to show:', chrome.runtime.lastError.message);
            }
          });
          sendResponse(batchResult);
          break;
        }
        case 'STOP_BULK_IMPORT': {
          // Real gap fix (reported live: "there is no option to stop
          // bulk importing, its working continuesly"). Only sets a flag
          // -- importSearchResults checks it between profiles and during
          // its own pacing delay, so this takes effect within a few
          // seconds, not instantly (the profile already in progress
          // finishes first; there's no safe way to abort mid-scrape
          // without risking a half-written import).
          await chrome.storage.local.set({ bulkImportCancelRequested: true });
          sendResponse({ ok: true });
          break;
        }
        case 'GET_BULK_IMPORT_STATUS': {
          const stored = await new Promise((resolve) => chrome.storage.local.get(['bulkImportStatus', 'bulkImportCancelRequested', 'bulkImportProgress'], resolve));
          sendResponse({
            running: stored && stored.bulkImportStatus === 'running',
            cancelling: !!(stored && stored.bulkImportCancelRequested),
            progress: (stored && stored.bulkImportProgress) || null,
          });
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
