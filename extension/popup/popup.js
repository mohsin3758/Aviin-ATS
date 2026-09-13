const root = document.getElementById('root');

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      // Real gap fix: chrome.runtime.sendMessage's callback fires with
      // `response === undefined` (not a rejected promise) if the
      // background service worker never called sendResponse or wasn't
      // reachable — every caller below does `result.ok`/`result.status`
      // on the return value, which would throw a TypeError on
      // `undefined` instead of showing a real error message.
      if (chrome.runtime.lastError || response === undefined) {
        const msg = chrome.runtime.lastError?.message || 'No response from extension background — try reopening the popup.';
        // Different callers read either .error (LOGIN) or .status/.message
        // (IMPORT_ACTIVE_TAB) — this fallback covers both shapes so
        // neither caller silently loses the real error text.
        resolve({ ok: false, error: msg, status: 'error', message: msg });
        return;
      }
      resolve(response);
    });
  });
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  });
  children.forEach((c) => node.appendChild(c));
  return node;
}

function renderLogin(error) {
  root.innerHTML = '';
  const emailInput = el('input', { type: 'email', placeholder: 'Work email', id: 'email' });
  const passInput = el('input', { type: 'password', placeholder: 'Password', id: 'password' });
  const errBox = error ? el('div', { class: 'error', text: error }) : null;
  const loginBtn = el('button', { text: 'Log In', onclick: onLoginClick });

  root.appendChild(el('div', { class: 'muted', text: 'Log in to your AVIIN ATS account to import candidates.' }));
  root.appendChild(document.createElement('br'));
  root.appendChild(emailInput);
  root.appendChild(passInput);
  if (errBox) root.appendChild(errBox);
  root.appendChild(loginBtn);

  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onLoginClick(); });
}

async function onLoginClick() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) return renderLogin('Enter your email and password.');
  const btn = root.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Logging in…';
  const result = await sendMessage({ type: 'LOGIN', email, password });
  if (!result.ok) return renderLogin(result.error || 'Login failed.');
  init();
}

async function onLogoutClick() {
  await sendMessage({ type: 'LOGOUT' });
  init();
}

async function onStopBulkImportClick() {
  const btn = document.getElementById('stop-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Stopping…'; }
  await sendMessage({ type: 'STOP_BULK_IMPORT' });
  // Re-render immediately rather than waiting for the next open -- the
  // background loop won't have actually stopped yet (it finishes the
  // profile already in progress first), but the popup should reflect
  // "stopping" right away instead of looking like the click did nothing.
  init();
}

function statusBox(kind, html) {
  return el('div', { class: `status-box ${kind}`, html });
}

// Real gap fix (reported live: "it was showing popup result... now
// it's stopped"). The Experience/Education details-sub-page fallback
// (background.js's enrichWithDetailsPages) deliberately switches the
// browser's active tab to scrape reliably -- which is ALSO exactly
// what makes Chrome tear this popup down before onImportClick's own
// sendMessage() call ever resolves, every time an import needs that
// fallback (not just on an occasional focus loss). background.js now
// persists the finished result to chrome.storage.local specifically so
// it can still be shown here -- on the VERY NEXT open of this popup,
// however long after the popup actually closed -- instead of being
// lost. Shared with onImportClick's own live rendering (below) so a
// fix to one status's wording can't silently miss the other path, the
// exact class of bug already found and fixed for email/phone
// extraction earlier this file's own history.
function buildResultStatusBox(result) {
  if (result.status === 'created') {
    return statusBox('good',
      `✓ Imported: <strong>${escapeHtml(result.name)}</strong><br/><a href="https://ats.aviintech.com/candidates/${result.candidateId}" target="_blank">View in ATS →</a>`);
  }
  if (result.status === 'updated') {
    const fieldLabels = { phone: 'phone', current_employer: 'company', location: 'location', resume_text: 'resume/skills text', email: 'email' };
    const added = (result.updatedFields || []).map((f) => fieldLabels[f] || f).join(', ');
    return statusBox('good',
      `✓ Updated existing candidate: <strong>${escapeHtml(result.name)}</strong><br/>Filled in: ${escapeHtml(added)}<br/><a href="https://ats.aviintech.com/candidates/${result.candidateId}" target="_blank">View candidate →</a>`);
  }
  if (result.status === 'no_change') {
    return statusBox('warn',
      `Already in AVIIN ATS: <strong>${escapeHtml(result.name)}</strong> — already up to date.<br/><a href="https://ats.aviintech.com/candidates/${result.candidateId}" target="_blank">View existing →</a>`);
  }
  if (result.status === 'not_supported') {
    return statusBox('warn', 'Open a LinkedIn profile page to import.');
  }
  if (result.status === 'batch_done') {
    // Real gap fix (explicit user request, after confirming live
    // per-profile progress: "show view link after completing the
    // importing and updated" for every candidate the batch touched, not
    // just a generic link to the whole Captured Profiles list). Each
    // entry in summary.results has the exact same shape a live single
    // import's own result does, so this reuses buildResultStatusBox
    // per-candidate instead of a second, parallel formatting -- the
    // same wording/link a recruiter already knows from a single import,
    // just repeated once per profile in this batch.
    const s = result.summary;
    const label = s.cancelled ? '✓ Bulk import stopped' : '✓ Bulk import done';
    const wrapper = el('div');
    wrapper.appendChild(statusBox('good',
      `${label}: ${s.created} created, ${s.updated} updated, ${s.no_change} already up to date${s.error ? `, ${s.error} failed` : ''} (of ${s.total} visible).`));
    for (const item of s.results || []) {
      wrapper.appendChild(buildResultStatusBox(item));
    }
    wrapper.appendChild(el('a', {
      class: 'footer-link', href: 'https://ats.aviintech.com/captured-profiles', target: '_blank', text: 'View all in Captured Profiles →',
    }));
    return wrapper;
  }
  return statusBox('err', escapeHtml(result.message || 'Something went wrong.'));
}

const RECENT_RESULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes -- long enough to cover the sub-page fallback's own several-second detour, short enough that a much older result never resurfaces as if it just happened

// Real gap fix (reported live, with a screenshot of the popup that
// actually clicked "Import All Visible Profiles" showing only a static
// "Importing…" button and no Stop option, and separately asking for "a
// click view for individual view" of each profile as it finishes).
// Two gaps in one: the Stop button was only ever wired into renderReady
// (a REOPENED popup) -- the popup instance that's still sitting on its
// own sendMessage() await for the whole multi-minute run never got one;
// and there was no visibility into individual profiles at all until the
// entire batch finished. Shared between renderReady's reopened-popup
// path and onImportSearchResultsClick's own live-polling loop below, so
// both render identically from background.js's bulkImportProgress
// (current/total counts, and the LAST completed profile's own result --
// reusing buildResultStatusBox as-is, so it gets the same "View in
// ATS →" / "View candidate →" link a live single import would show).
function renderBulkRunningUI(container, status) {
  container.innerHTML = '';
  if (!status || !status.running) return;
  const p = status.progress;
  if (status.cancelling) {
    container.appendChild(statusBox('warn', 'Stopping bulk import — finishing the profile already in progress…'));
  } else {
    container.appendChild(statusBox('good', p ? `Bulk import running — profile ${p.current} of ${p.total}…` : 'Bulk import starting…'));
  }
  if (p && p.last) {
    container.appendChild(el('div', { class: 'muted', text: 'Most recent:' }));
    container.appendChild(buildResultStatusBox(p.last));
  }
  if (!status.cancelling) {
    container.appendChild(el('button', { id: 'stop-btn', class: 'secondary', text: 'Stop Import', onclick: onStopBulkImportClick }));
  }
  container.appendChild(el('div', { class: 'muted', text: 'Safe to close this popup — progress picks back up here the next time you open it.' }));
}

async function renderReady(email) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'user-row' }, [
    el('span', { text: email || 'Logged in' }),
    el('button', { text: 'Log out', onclick: onLogoutClick }),
  ]));

  const stored = await new Promise((resolve) => chrome.storage.local.get('lastImportResult', resolve));
  const pending = stored && stored.lastImportResult;
  if (pending && Date.now() - pending.ts < RECENT_RESULT_WINDOW_MS) {
    root.appendChild(el('div', { class: 'muted', text: 'Result from your last import:' }));
    root.appendChild(buildResultStatusBox(pending.result));
    root.appendChild(document.createElement('hr'));
    chrome.storage.local.remove('lastImportResult'); // shown once -- don't resurface on the next open too
  }

  // Real gap fix (reported live: "there is no option to stop bulk
  // importing, its working continuesly"). A bulk run can take several
  // minutes and visits many pages on its own -- this popup is very
  // likely NOT looking at the search-results page any more by the time
  // the recruiter reopens it (the active tab keeps switching between
  // profiles), so this check runs BEFORE the normal tab-type branching
  // below and, if a run is in progress, replaces the whole UI with a
  // Stop control instead of showing a confusing/wrong Import button for
  // whatever profile the bulk run currently happens to be on.
  const bulkStatus = await sendMessage({ type: 'GET_BULK_IMPORT_STATUS' });
  if (bulkStatus && bulkStatus.running) {
    const bulkContainer = el('div');
    root.appendChild(bulkContainer);
    renderBulkRunningUI(bulkContainer, bulkStatus);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isLinkedInProfile = !!tab?.url && /^https:\/\/(www\.)?linkedin\.com\/(in|sales\/(lead|people))\//.test(tab.url);
  const isSearchResultsPage = !!tab?.url && /^https:\/\/(www\.)?linkedin\.com\/search\/results\/people\//.test(tab.url);

  if (isSearchResultsPage) {
    // Real gap fix (reported live, "is we missing any features"): a
    // recruiter working a list of search results had to open each
    // profile individually before this. Reads only what's already
    // rendered on the page (name/headline/location per card, no
    // scrolling or auto-paging) and imports each one through the same
    // create-or-fill-blanks pipeline as a single import.
    const btn = el('button', { id: 'action-btn', text: 'Import All Visible Profiles', onclick: onImportSearchResultsClick });
    root.appendChild(btn);
    root.appendChild(el('div', { id: 'result' }));
  } else if (!isLinkedInProfile) {
    root.appendChild(el('div', { class: 'muted', text: 'Open a LinkedIn profile, or a LinkedIn people-search results page, to import candidates.' }));
  } else {
    // Real feature (follow-up): check before showing Import at all,
    // so a profile already in AVIIN ATS shows that immediately instead
    // of costing a click + a request just to find out the same thing
    // the Import button itself would have said afterward.
    root.appendChild(el('div', { class: 'muted', id: 'dupe-check', text: 'Checking…' }));
    sendMessage({ type: 'CHECK_TAB_DUPLICATE' }).then((dupeResult) => {
      const slot = document.getElementById('dupe-check');
      if (!slot) return; // popup UI moved on (e.g. user clicked Import already)
      slot.remove();
      if (dupeResult?.matched) {
        root.insertBefore(
          statusBox('warn',
            `Already in AVIIN ATS: <strong>${escapeHtml(dupeResult.candidate_name || 'this candidate')}</strong><br/><a href="https://ats.aviintech.com/candidates/${dupeResult.candidate_id}" target="_blank">View existing →</a>`),
          root.lastElementChild,
        );
      }
      // Real gap fix: shown even when already matched, not just on a
      // genuinely new profile -- clicking it re-scrapes and fills in
      // whatever fields are still blank on the existing candidate (see
      // background.js's importProfile/ext_capture_convert), so a
      // candidate created back when the scraper had gaps can be
      // refreshed instead of staying stuck incomplete forever. Never
      // re-creates a duplicate, and never overwrites a value that's
      // already there.
      const btn = el('button', { id: 'action-btn', text: dupeResult?.matched ? 'Update From LinkedIn' : 'Import This Profile', onclick: onImportClick });
      root.insertBefore(btn, root.lastElementChild);
      root.insertBefore(el('div', { id: 'result' }), root.lastElementChild);
    });
  }

  root.appendChild(el('a', {
    class: 'footer-link', href: 'https://ats.aviintech.com/captured-profiles', target: '_blank', text: 'View Captured Profiles →',
  }));
}

async function onImportClick() {
  const btn = document.getElementById('action-btn');
  const resultDiv = document.getElementById('result');
  const originalLabel = btn.textContent; // 'Import This Profile' or 'Update From LinkedIn'
  btn.disabled = true;
  btn.textContent = 'Importing…';
  resultDiv.innerHTML = '';

  // Real gap fix: the import can take long enough (the details-sub-page
  // fallback briefly switches the browser's active tab away from this
  // popup) that Chrome tears the popup down before this ever resolves --
  // background.js persists the result for renderReady to pick up on the
  // NEXT open in that case, so this path staying alive is a bonus, not
  // the only way the result reaches the user.
  const result = await sendMessage({ type: 'IMPORT_ACTIVE_TAB' });

  btn.disabled = false;
  btn.textContent = originalLabel;
  resultDiv.appendChild(buildResultStatusBox(result));
}

async function onImportSearchResultsClick() {
  const btn = document.getElementById('action-btn');
  const resultDiv = document.getElementById('result');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  resultDiv.innerHTML = '';
  resultDiv.appendChild(el('div', { class: 'muted', text: 'Starting…' }));

  // Real gap fix (reported live: this popup -- the one that actually
  // clicked the button -- never showed a Stop option or any per-profile
  // progress, only a static message for the whole multi-minute run,
  // because the Stop button had only ever been wired into a REOPENED
  // popup, not this one sitting on its own sendMessage() await).
  // Polls every 2s and re-renders via the same renderBulkRunningUI a
  // reopened popup uses, so this popup shows live progress AND a
  // working Stop button too -- not just after being closed and
  // reopened. Bails out harmlessly (via the getElementById check) if
  // the popup UI has since moved on (e.g. the user clicked Stop, which
  // re-renders the whole page through init()).
  const pollHandle = setInterval(async () => {
    const status = await sendMessage({ type: 'GET_BULK_IMPORT_STATUS' });
    const liveResultDiv = document.getElementById('result');
    if (!liveResultDiv) return;
    renderBulkRunningUI(liveResultDiv, status);
  }, 2000);

  const result = await sendMessage({ type: 'IMPORT_SEARCH_RESULTS' });
  clearInterval(pollHandle);

  // The popup may have re-rendered itself already (e.g. via Stop's own
  // init() call) by the time this finally resolves -- nothing left to
  // update in that case, same guard used elsewhere in this file.
  const finalBtn = document.getElementById('action-btn');
  const finalResultDiv = document.getElementById('result');
  if (!finalBtn || !finalResultDiv) return;

  finalBtn.disabled = false;
  finalBtn.textContent = 'Import All Visible Profiles';
  finalResultDiv.innerHTML = '';

  if (result.status === 'not_supported') {
    finalResultDiv.appendChild(statusBox('warn', 'Open a LinkedIn people-search results page to bulk import.'));
  } else {
    finalResultDiv.appendChild(buildResultStatusBox(result));
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

async function init() {
  root.innerHTML = '<div class="muted">Loading…</div>';
  const auth = await sendMessage({ type: 'GET_AUTH_STATE' });
  if (!auth.authenticated) return renderLogin();
  renderReady(auth.email);
}

init();
