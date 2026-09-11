const root = document.getElementById('root');

function sendMessage(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
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
  const isLinkedInProfile = !!tab?.url && /^https:\/\/(www\.)?linkedin\.com\/in\//.test(tab.url);

  if (!isLinkedInProfile) {
    root.appendChild(el('div', { class: 'muted', text: 'Open a LinkedIn profile to import a candidate.' }));
  } else {
    const btn = el('button', { text: 'Import This Profile', onclick: onImportClick });
    root.appendChild(btn);
    root.appendChild(el('div', { id: 'result' }));
  }

  root.appendChild(el('a', {
    class: 'footer-link', href: 'https://ats.aviintech.com/captured-profiles', target: '_blank', text: 'View Captured Profiles →',
  }));
}

async function onImportClick() {
  const btn = root.querySelector('button');
  const resultDiv = document.getElementById('result');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  resultDiv.innerHTML = '';

  const result = await sendMessage({ type: 'IMPORT_ACTIVE_TAB' });

  btn.disabled = false;
  btn.textContent = 'Import This Profile';

  if (result.status === 'created') {
    resultDiv.appendChild(statusBox('good',
      `✓ Imported: <strong>${escapeHtml(result.name)}</strong><br/><a href="https://ats.aviintech.com/candidates/${result.candidateId}" target="_blank">View in ATS →</a>`));
  } else if (result.status === 'exists') {
    const m = result.match;
    resultDiv.appendChild(statusBox('warn',
      `Matches an existing candidate: <strong>${escapeHtml(m.matched_candidate_name || 'this profile')}</strong><br/><a href="https://ats.aviintech.com/candidates/${m.matched_candidate_id}" target="_blank">View existing →</a>`));
  } else if (result.status === 'not_supported') {
    resultDiv.appendChild(statusBox('warn', 'Open a LinkedIn profile page to import.'));
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
