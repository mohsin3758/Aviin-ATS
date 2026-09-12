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

function statusBox(kind, html) {
  return el('div', { class: `status-box ${kind}`, html });
}

async function renderReady(email) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'user-row' }, [
    el('span', { text: email || 'Logged in' }),
    el('button', { text: 'Log out', onclick: onLogoutClick }),
  ]));

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

  const result = await sendMessage({ type: 'IMPORT_ACTIVE_TAB' });

  btn.disabled = false;
  btn.textContent = originalLabel;

  if (result.status === 'created') {
    resultDiv.appendChild(statusBox('good',
      `✓ Imported: <strong>${escapeHtml(result.name)}</strong><br/><a href="https://ats.aviintech.com/candidates/${result.candidateId}" target="_blank">View in ATS →</a>`));
  } else if (result.status === 'updated') {
    // Real gap fix: re-importing an already-known profile used to just
    // say "already exists" and do nothing -- now the backend fills in
    // whatever fields were blank on the existing candidate (never
    // overwrites a value that's already there), so this reports what
    // actually changed instead of a flat "nothing happened" message.
    const fieldLabels = { phone: 'phone', current_employer: 'company', location: 'location', resume_text: 'resume/skills text', email: 'email' };
    const added = (result.updatedFields || []).map((f) => fieldLabels[f] || f).join(', ');
    resultDiv.appendChild(statusBox('good',
      `✓ Updated existing candidate: <strong>${escapeHtml(result.name)}</strong><br/>Filled in: ${escapeHtml(added)}<br/><a href="https://ats.aviintech.com/candidates/${result.candidateId}" target="_blank">View candidate →</a>`));
  } else if (result.status === 'no_change') {
    resultDiv.appendChild(statusBox('warn',
      `Already in AVIIN ATS: <strong>${escapeHtml(result.name)}</strong> — already up to date.<br/><a href="https://ats.aviintech.com/candidates/${result.candidateId}" target="_blank">View existing →</a>`));
  } else if (result.status === 'not_supported') {
    resultDiv.appendChild(statusBox('warn', 'Open a LinkedIn profile page to import.'));
  } else {
    resultDiv.appendChild(statusBox('err', escapeHtml(result.message || 'Something went wrong.')));
  }
}

async function onImportSearchResultsClick() {
  const btn = document.getElementById('action-btn');
  const resultDiv = document.getElementById('result');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  resultDiv.innerHTML = '';
  // Note: this can take a while (one create/dedup-check request per
  // visible profile, done sequentially on purpose -- see
  // importSearchResults in background.js). A completion notification
  // fires regardless of whether this popup is still open by the time
  // it finishes.
  resultDiv.appendChild(el('div', { class: 'muted', text: 'Importing each visible profile — this can take a little while…' }));

  const result = await sendMessage({ type: 'IMPORT_SEARCH_RESULTS' });

  btn.disabled = false;
  btn.textContent = 'Import All Visible Profiles';
  resultDiv.innerHTML = '';

  if (result.status === 'batch_done') {
    const s = result.summary;
    resultDiv.appendChild(statusBox('good',
      `✓ Done: ${s.created} created, ${s.updated} updated, ${s.no_change} already up to date${s.error ? `, ${s.error} failed` : ''} (of ${s.total} visible).` +
      `<br/><a href="https://ats.aviintech.com/captured-profiles" target="_blank">View Captured Profiles →</a>`));
  } else if (result.status === 'not_supported') {
    resultDiv.appendChild(statusBox('warn', 'Open a LinkedIn people-search results page to bulk import.'));
  } else {
    resultDiv.appendChild(statusBox('err', escapeHtml(result.message || 'Something went wrong.')));
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
