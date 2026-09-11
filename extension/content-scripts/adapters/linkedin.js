// LinkedIn profile-page adapter. Scrapes only what's reliably visible
// without any extra click (no "Contact info" modal, no expanding
// sections) -- LinkedIn profiles routinely have no visible email/phone
// at all, and this deliberately never invents one (see
// backend/routers/gap_features.py's ext_capture_convert docstring for
// why: a placeholder email caused a real candidate-merge corruption
// incident elsewhere in this codebase).
//
// LinkedIn's DOM uses obfuscated, frequently-changing class names, so
// every field below tries a few known selector patterns and falls back
// to document.title (a stable "Name - Headline | LinkedIn" string
// LinkedIn has kept consistent for years) rather than failing outright.
// This is the one adapter file that will need occasional upkeep if
// LinkedIn changes its markup -- the per-adapter-file structure exists
// so that upkeep never touches background.js, the popup, or any other
// site's adapter.

(function () {
  function firstMatch(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el && el.textContent && el.textContent.trim();
      if (text) return text;
    }
    return null;
  }

  function parseTitleTag() {
    // "Jane Doe - Senior SAP FICO Consultant | LinkedIn"
    const t = document.title || '';
    const m = t.match(/^(.*?)\s*-\s*(.*?)\s*\|\s*LinkedIn\s*$/i);
    if (m) return { name: m[1].trim(), headline: m[2].trim() };
    return { name: null, headline: null };
  }

  function scrapeExperienceSection() {
    // Best-effort: the "Experience" section's list items, each usually
    // carrying a role title and a company/duration line. Formatted into
    // plain text (not a fabricated structure) so the existing skill/
    // experience extraction pipeline on the backend can run over it
    // exactly like it does for any other candidate's resume_text.
    const section = document.getElementById('experience');
    const container = section && section.closest('section');
    if (!container) return '';
    const items = Array.from(container.querySelectorAll('li'));
    const lines = [];
    for (const li of items.slice(0, 10)) {
      const text = li.textContent.replace(/\s+/g, ' ').trim();
      if (text && text.length > 3) lines.push(text);
    }
    return lines.length ? 'Experience:\n' + lines.join('\n') : '';
  }

  function scrapeEducationSection() {
    const section = document.getElementById('education');
    const container = section && section.closest('section');
    if (!container) return '';
    const items = Array.from(container.querySelectorAll('li'));
    const lines = [];
    for (const li of items.slice(0, 6)) {
      const text = li.textContent.replace(/\s+/g, ' ').trim();
      if (text && text.length > 3) lines.push(text);
    }
    return lines.length ? 'Education:\n' + lines.join('\n') : '';
  }

  window.__aviinAdapter_linkedin = function () {
    const titleParsed = parseTitleTag();

    const name = firstMatch([
      '.pv-text-details__left-panel h1',
      'main h1',
      'h1',
    ]) || titleParsed.name;

    const headline = firstMatch([
      '.pv-text-details__left-panel .text-body-medium',
      '.text-body-medium.break-words',
    ]) || titleParsed.headline;

    const location = firstMatch([
      '.pv-text-details__left-panel .text-body-small.inline.t-black--light',
      '.pv-text-details__left-panel .text-body-small',
    ]);

    // Current company: prefer the first Experience-section entry's
    // company line over parsing it out of the headline, since a
    // headline is free text ("Helping teams ship faster") and often
    // isn't a job title/company pair at all.
    let currentCompany = null;
    const expSection = document.getElementById('experience');
    const expContainer = expSection && expSection.closest('section');
    if (expContainer) {
      const firstItem = expContainer.querySelector('li');
      if (firstItem) {
        const spans = Array.from(firstItem.querySelectorAll('span[aria-hidden="true"]'))
          .map(s => s.textContent.trim()).filter(Boolean);
        // Typical shape: [role title, company name, duration, location...]
        currentCompany = spans[1] || null;
      }
    }

    return {
      name: name || null,
      current_title: headline || null,
      current_company: currentCompany,
      location: location || null,
      profile_url: location_href_without_query(),
      linkedin_url: location_href_without_query(),
      email: null,   // never invented -- LinkedIn rarely exposes this without an extra click
      phone: null,
      resume_text_like: [scrapeExperienceSection(), scrapeEducationSection()]
        .filter(Boolean).join('\n\n') || null,
    };
  };

  function location_href_without_query() {
    try {
      const u = new URL(window.location.href);
      return u.origin + u.pathname.replace(/\/$/, '');
    } catch (e) {
      return window.location.href;
    }
  }
})();
