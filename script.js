/* ============================================================
   CertiChain — Frontend Script
   New features:
   1. Password show/hide toggle
   2. "Email exists" on register → redirect to login with email pre-filled
   3. Navbar buttons work correctly when already logged in
   4. Upgrade user → admin (from Profile page)
   5. Bulk certificate generation + CSV/Excel/TXT file parsing
   ============================================================ */

const API = 'http://localhost:5000/api';

// ── State ──────────────────────────────────────────────────
let currentUser = JSON.parse(localStorage.getItem('cc_user') || 'null');
let token = localStorage.getItem('cc_token') || '';
let selectedTemplate = 'classic';
let lastGeneratedCert = null;
let lastBulkCerts = [];
let html5QrScanner = null;
let parsedBulkNames = [];

// ── Template Definitions ───────────────────────────────────
const TEMPLATES = {
  classic: { bg: 'cert-tpl-classic', accentColor: '#c9a227', qrFg: '#c9a227', qrBg: '#1a1200' },
  cyber:   { bg: 'cert-tpl-cyber',   accentColor: '#00e5ff', qrFg: '#00e5ff', qrBg: '#001220' },
  royal:   { bg: 'cert-tpl-royal',   accentColor: '#a855f7', qrFg: '#a855f7', qrBg: '#120a1f' },
  nature:  { bg: 'cert-tpl-nature',  accentColor: '#22c55e', qrFg: '#22c55e', qrBg: '#071a0e' },
  fire:    { bg: 'cert-tpl-fire',    accentColor: '#ff6030', qrFg: '#ff6030', qrBg: '#1a0800' },
};

// ══════════════════════════════════════════════════════════
// FEATURE 1: Password show / hide toggle
// ══════════════════════════════════════════════════════════
function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? '🙈' : '👁️';
  btn.title = isHidden ? 'Hide password' : 'Show password';
}

// ── Navigation ─────────────────────────────────────────────
/* ── ONE FUNCTION that does everything ───────────────────
   go(id)   = public API used everywhere in HTML and JS
   - login / register → always open directly, no guards
   - dashboard/generate/verify/profile → require login
   - generate → requires admin (else → profile)
   - register page → always clears the form
   ─────────────────────────────────────────────────────── */
function go(id) {
  const PROTECTED = ['dashboard', 'generate', 'verify', 'profile'];

  // Access control
  if (PROTECTED.includes(id) && !currentUser) { id = 'login'; }
  if (id === 'generate' && currentUser && currentUser.role !== 'admin') { id = 'profile'; }

  _show(id, true);
}

// _show: the actual section switcher — no access control, just shows it
function _show(id, pushHistory) {
  const VALID = ['home','register','login','dashboard','generate','verify','profile'];
  if (!VALID.includes(id)) id = 'home';

  // Switch section
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');

  // History
  if (pushHistory) history.pushState({ section: id }, '', '#' + id);

  // Side effects
  if (id === 'dashboard') loadDashboard();
  if (id === 'profile')   loadProfile();
  if (id !== 'verify')    stopScanner();
  if (id === 'register') {
    ['regName','regEmail','regPassword','regOrg'].forEach(f => { const e = document.getElementById(f); if(e) e.value=''; });
    document.getElementById('regRole').value = 'user';
    document.getElementById('orgGroup').classList.add('hidden');
    document.getElementById('registerError').classList.add('hidden');
    document.getElementById('registerSuccess').classList.add('hidden');
  }
  if (id === 'login') {
    const e = document.getElementById('loginError');
    if (e) e.classList.add('hidden');
  }

  window.scrollTo(0, 0);
  document.getElementById('navLinks').classList.remove('open');
}

// Aliases so existing code still works
function navigateTo(id) { go(id); }
function showSection(id) { go(id); }
function showSectionDirect(id) { _show(id, true); }

// Browser back / forward
window.addEventListener('popstate', (e) => {
  _show(e.state?.section || 'home', false);
});


function toggleNav() {
  document.getElementById('navLinks').classList.toggle('open');
}

// ── Navbar update ──────────────────────────────────────────
function updateNavbar() {
  const guest   = document.getElementById('navGuest');
  const auth    = document.getElementById('navAuth');
  const navGen  = document.getElementById('navGenerate');

  if (currentUser) {
    guest.classList.add('hidden');
    auth.classList.remove('hidden');
    // Generate: visible only for admin
    if (navGen) navGen.style.display = currentUser.role === 'admin' ? '' : 'none';
  } else {
    guest.classList.remove('hidden');
    auth.classList.add('hidden');
  }
}

function toggleOrgField() {
  const role = document.getElementById('regRole').value;
  document.getElementById('orgGroup').classList.toggle('hidden', role !== 'admin');
}

// ══════════════════════════════════════════════════════════
// FEATURE 2: Register — "email already exists" → redirect to login
// ══════════════════════════════════════════════════════════
async function register() {
  const name         = document.getElementById('regName').value.trim();
  const email        = document.getElementById('regEmail').value.trim();
  const password     = document.getElementById('regPassword').value;
  const role         = document.getElementById('regRole').value;
  const organization = document.getElementById('regOrg').value.trim();
  const errEl = document.getElementById('registerError');
  const sucEl = document.getElementById('registerSuccess');
  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  if (!name || !email || !password) return showAlert(errEl, 'Please fill in all required fields.');
  if (password.length < 6) return showAlert(errEl, 'Password must be at least 6 characters.');

  try {
    const res  = await fetch(`${API}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role, organization })
    });
    const data = await res.json();

    // FEATURE 2: Email already registered → show message with login link
    if (!res.ok && data.emailExists) {
      showAlert(errEl, `⚠️ This email is already registered.`);
      // After 1.5 seconds, navigate to login with the email pre-filled
      setTimeout(() => {
        document.getElementById('loginEmail').value = data.email || email;
        document.getElementById('loginPassword').value = '';
        const loginSuccessEl = document.getElementById('loginSuccess');
        showAlert(loginSuccessEl, `👋 Email found! Please enter your password to log in.`);
        go('login');
      }, 1500);
      return;
    }

    if (!res.ok) return showAlert(errEl, data.message || 'Registration failed.');
    showAlert(sucEl, '✅ Account created! Redirecting...');
    setTimeout(() => loginWithData(data), 1000);
  } catch (e) {
    showAlert(errEl, 'Cannot connect to server. Is the backend running?');
  }
}

// ── Login ──────────────────────────────────────────────────
async function login() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  errEl.classList.add('hidden');
  if (!email || !password) return showAlert(errEl, 'Please enter email and password.');
  try {
    const res  = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) return showAlert(errEl, data.message || 'Login failed.');
    loginWithData(data);
  } catch (e) {
    showAlert(errEl, 'Cannot connect to server. Is the backend running?');
  }
}

function loginWithData(data) {
  currentUser = data.user;
  token = data.token;
  localStorage.setItem('cc_user', JSON.stringify(data.user));
  localStorage.setItem('cc_token', data.token);
  updateNavbar();
  go('dashboard');
}

// ── Logout ─────────────────────────────────────────────────
function logout() {
  currentUser = null;
  token = '';
  localStorage.removeItem('cc_user');
  localStorage.removeItem('cc_token');
  updateNavbar();
  go('home');
}

// ── Dashboard ──────────────────────────────────────────────
async function loadDashboard() {
  if (!currentUser) return;
  document.getElementById('dashWelcome').textContent = `Welcome back, ${currentUser.name}! (${currentUser.role})`;

  const statsEl    = document.getElementById('dashStats');
  const listEl     = document.getElementById('dashCertList');
  const tableEl    = document.getElementById('certTable');
  const actionsEl  = document.getElementById('dashAdminActions');
  const bannerEl   = document.getElementById('dashUpgradeBanner');

  if (currentUser.role === 'admin') {
    actionsEl.classList.remove('hidden');
    bannerEl.classList.add('hidden');
    try {
      const res = await apiFetch('/certs/my');
      const data = await res.json();
      const certs = data.certs || [];
      statsEl.innerHTML = `
        <div class="stat-card"><span class="stat-val">${certs.length}</span><span class="stat-lbl">Total Issued</span></div>
        <div class="stat-card"><span class="stat-val">${certs.filter(c => !c.revoked).length}</span><span class="stat-lbl">Active</span></div>
        <div class="stat-card"><span class="stat-val">${currentUser.organization || '—'}</span><span class="stat-lbl">Organization</span></div>
      `;
      if (certs.length > 0) {
        listEl.classList.remove('hidden');
        tableEl.innerHTML = certs.map(c => `
          <div class="cert-row">
            <span class="cr-id">${c.certId}</span>
            <span>${c.name}</span>
            <span class="cr-date">${new Date(c.date).toLocaleDateString()}</span>
            <span>${c.revoked
              ? '<span style="color:var(--red);font-size:0.72rem;">REVOKED</span>'
              : `<button class="btn btn-sm btn-danger" onclick="revokeCert('${c.certId}')">Revoke</button>`}
            </span>
          </div>`).join('');
      } else {
        listEl.classList.add('hidden');
      }
    } catch (e) {
      statsEl.innerHTML = '<p style="color:var(--red)">Failed to load data.</p>';
    }
  } else {
    // User role
    actionsEl.classList.add('hidden');
    bannerEl.classList.remove('hidden'); // Show upgrade banner
    statsEl.innerHTML = `
      <div class="stat-card"><span class="stat-val">User</span><span class="stat-lbl">Account Role</span></div>
      <div class="stat-card" style="cursor:pointer" onclick="go('verify')"><span class="stat-val">→</span><span class="stat-lbl">Verify a Certificate</span></div>
    `;
    listEl.classList.add('hidden');
  }
}

async function revokeCert(certId) {
  if (!confirm(`Revoke certificate ${certId}? This cannot be undone.`)) return;
  try {
    const res  = await apiFetch(`/certs/revoke/${certId}`, 'PATCH');
    const data = await res.json();
    if (res.ok) loadDashboard();
    else alert(data.message);
  } catch (e) { alert('Failed to revoke.'); }
}

// ══════════════════════════════════════════════════════════
// FEATURE 4: Profile page + Upgrade to Admin
// ══════════════════════════════════════════════════════════
function loadProfile() {
  if (!currentUser) return;

  document.getElementById('profileSubtitle').textContent = currentUser.email;

  const infoEl = document.getElementById('profileInfo');
  infoEl.innerHTML = `
    <div class="profile-row"><span class="profile-label">Name</span><span class="profile-val">${currentUser.name}</span></div>
    <div class="profile-row"><span class="profile-label">Email</span><span class="profile-val">${currentUser.email}</span></div>
    <div class="profile-row"><span class="profile-label">Role</span><span class="profile-val">
      <span class="role-badge ${currentUser.role === 'admin' ? 'role-admin' : 'role-user'}">${currentUser.role === 'admin' ? '👑 Admin' : '👤 User'}</span>
    </span></div>
    ${currentUser.organization ? `<div class="profile-row"><span class="profile-label">Organization</span><span class="profile-val">${currentUser.organization}</span></div>` : ''}
  `;

  const upgradeCard     = document.getElementById('upgradeCard');
  const alreadyAdminCard = document.getElementById('alreadyAdminCard');

  if (currentUser.role === 'admin') {
    upgradeCard.classList.add('hidden');
    alreadyAdminCard.classList.remove('hidden');
  } else {
    upgradeCard.classList.remove('hidden');
    alreadyAdminCard.classList.add('hidden');
  }
}

async function upgradeToAdmin() {
  const org      = document.getElementById('upgradeOrg').value.trim();
  const password = document.getElementById('upgradePassword').value;
  const errEl    = document.getElementById('upgradeError');
  const sucEl    = document.getElementById('upgradeSuccess');
  errEl.classList.add('hidden');
  sucEl.classList.add('hidden');

  if (!org)      return showAlert(errEl, 'Please enter your organization name.');
  if (!password) return showAlert(errEl, 'Please confirm your password.');

  try {
    const res  = await apiFetch('/auth/upgrade', 'PATCH', { organization: org, password });
    const data = await res.json();
    if (!res.ok) return showAlert(errEl, data.message || 'Upgrade failed.');

    // Update local state with new token + user
    currentUser = data.user;
    token = data.token;
    localStorage.setItem('cc_user', JSON.stringify(data.user));
    localStorage.setItem('cc_token', data.token);

    showAlert(sucEl, '🎉 You are now an Admin! Redirecting to Generate...');
    updateNavbar();

    setTimeout(() => go('generate'), 1800);
  } catch (e) {
    showAlert(errEl, 'Cannot connect to server.');
  }
}

// ── Generate Certificate (single) ─────────────────────────
function selectTemplate(tpl) {
  selectedTemplate = tpl;
  document.querySelectorAll('.template-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.tpl === tpl);
  });
  const tplAccent = TEMPLATES[tpl].accentColor;
  document.getElementById('custAccentColor').value = tplAccent;
  document.getElementById('custAccentColorHex').textContent = tplAccent;
  updatePreview();
}

function updatePreview() {
  const titleColor  = document.getElementById('custTitleColor').value;
  const accentColor = document.getElementById('custAccentColor').value;
  document.getElementById('custTitleColorHex').textContent  = titleColor;
  document.getElementById('custAccentColorHex').textContent = accentColor;

  const name      = document.getElementById('certName').value.trim() || 'Certificate Title';
  const recipient = document.getElementById('certRecipient').value.trim() || '';
  const font      = document.getElementById('custFont').value;
  const date      = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const html = buildCertHTML({
    name, recipient,
    issuer: currentUser?.name || 'Issuer Name',
    org: currentUser?.organization || 'Organization',
    certId: 'CERT-PREVIEW', date, hash: '',
    font, titleColor, accentColor,
    template: selectedTemplate, isPreview: true
  });
  document.getElementById('liveCertPreview').innerHTML = html;
}

function buildCertHTML({ name, recipient, issuer, org, certId, date, hash, font, titleColor, accentColor, template, isPreview }) {
  const tpl = TEMPLATES[template];
  const qrPlaceholder = isPreview ? '' : `<canvas id="finalQrCanvas" style="border-radius:6px"></canvas>`;
  return `
  <div class="cert-tpl ${tpl.bg}">
    <div class="cert-top-row">
      <span class="cert-brand">🔗 CertiChain</span>
      <span class="cert-date-label">${date}</span>
    </div>
    <div class="cert-main-title" style="color:${accentColor}">Certificate of Achievement</div>
    <div class="cert-divider"></div>
    <div class="cert-award-name" style="font-family:'${font}',sans-serif;color:${titleColor}">${name}</div>
    <div class="cert-divider"></div>
    ${recipient ? `
    <div class="cert-recipient-row">
      <span class="cert-recipient-label">Awarded To</span>
      <span class="cert-recipient-name" style="font-family:'${font}',sans-serif;color:${titleColor}">${recipient}</span>
    </div>` : ''}
    <span class="cert-org-line">Issued by ${issuer} · ${org}</span>
    <div class="cert-footer-row">
      <div class="cert-id-group">
        <span class="cert-id-tag">Certificate ID</span>
        <span class="cert-id-val" style="color:${accentColor}">${certId}</span>
        ${!isPreview && hash ? `<span style="font-size:0.6rem;color:var(--muted);margin-top:0.2rem;word-break:break-all;max-width:280px">${hash.substring(0,32)}…</span>` : ''}
      </div>
      ${qrPlaceholder}
    </div>
  </div>`;
}

async function generateCert() {
  const name = document.getElementById('certName').value.trim();
  const errEl = document.getElementById('generateError');
  errEl.classList.add('hidden');
  if (!name) return showAlert(errEl, 'Please enter a certificate name.');
  try {
    const res  = await apiFetch('/certs/generate', 'POST', { name });
    const data = await res.json();
    if (!res.ok) return showAlert(errEl, data.message || 'Generation failed.');
    lastGeneratedCert = data.cert;
    displayCertResult(data.cert);
  } catch (e) {
    showAlert(errEl, 'Cannot connect to server.');
  }
}

function displayCertResult(cert) {
  const titleColor  = document.getElementById('custTitleColor').value;
  const accentColor = document.getElementById('custAccentColor').value;
  const font        = document.getElementById('custFont').value;
  const recipient   = document.getElementById('certRecipient').value.trim();
  const date        = new Date(cert.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const container = document.getElementById('certPreviewContainer');
  container.innerHTML = buildCertHTML({
    name: cert.name, recipient, issuer: cert.issuer, org: cert.organization,
    certId: cert.certId, date, hash: cert.hash,
    font, titleColor, accentColor, template: selectedTemplate, isPreview: false
  });
  document.getElementById('prevHash').textContent = cert.hash;

  setTimeout(() => {
    const canvas = document.getElementById('finalQrCanvas');
    if (canvas) {
      const tpl = TEMPLATES[selectedTemplate];
      new QRious({ element: canvas, value: `${window.location.origin}#verify?id=${cert.certId}`, size: 80, foreground: tpl.qrFg, background: tpl.qrBg });
    }
  }, 50);

  document.getElementById('certResult').classList.remove('hidden');
  document.getElementById('certResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function printCert() { window.print(); }

function copyCertId() {
  if (!lastGeneratedCert) return;
  navigator.clipboard.writeText(lastGeneratedCert.certId)
    .then(() => alert(`✅ Copied: ${lastGeneratedCert.certId}`))
    .catch(() => prompt('Copy this Certificate ID:', lastGeneratedCert.certId));
}

// ══════════════════════════════════════════════════════════
// FEATURE 5: Bulk Certificate Generation
// ══════════════════════════════════════════════════════════
function switchGenMode(mode) {
  document.getElementById('tabSingle').classList.toggle('active', mode === 'single');
  document.getElementById('tabBulk').classList.toggle('active', mode === 'bulk');
  document.getElementById('singleMode').classList.toggle('hidden', mode !== 'single');
  document.getElementById('bulkMode').classList.toggle('hidden', mode !== 'bulk');
}

function switchBulkInputTab(tab) {
  document.getElementById('bTabManual').classList.toggle('active', tab === 'manual');
  document.getElementById('bTabFile').classList.toggle('active', tab === 'file');
  document.getElementById('bulkManualPanel').classList.toggle('hidden', tab !== 'manual');
  document.getElementById('bulkFilePanel').classList.toggle('hidden', tab !== 'file');
  updateBulkCount();
}

function updateBulkCount() {
  const names = getBulkNames();
  const badge = document.getElementById('bulkCountBadge');
  badge.textContent = `${names.length} recipient${names.length !== 1 ? 's' : ''}`;
  badge.style.color = names.length > 0 ? 'var(--green)' : 'var(--muted)';
}

function getBulkNames() {
  // Check which input tab is active
  const isFile = !document.getElementById('bulkFilePanel').classList.contains('hidden');
  if (isFile) return parsedBulkNames.filter(n => n.trim());

  const raw = document.getElementById('bulkNames').value;
  return raw.split('\n').map(n => n.trim()).filter(Boolean);
}

// Attach live count update to textarea
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('bulkNames');
  if (ta) ta.addEventListener('input', updateBulkCount);

  // File drop zone drag support
  const dz = document.getElementById('fileDropZone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) parseFile(file);
    });
  }
});

// Parse uploaded file (CSV / Excel / TXT)
function handleBulkFile(input) {
  const file = input.files[0];
  if (file) parseFile(file);
}

function parseFile(file) {
  const statusEl  = document.getElementById('fileParseStatus');
  const previewEl = document.getElementById('parsedNamesPreview');
  const listEl    = document.getElementById('parsedNamesList');

  statusEl.classList.remove('hidden');
  statusEl.textContent = `⏳ Parsing ${file.name}...`;
  statusEl.className = 'file-parse-status';

  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv' || ext === 'txt') {
    // Plain text / CSV
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const names = parseCSVText(text);
      setParsedNames(names, file.name, statusEl, previewEl, listEl);
    };
    reader.readAsText(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    // Excel — use SheetJS
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data    = new Uint8Array(e.target.result);
        const wb      = XLSX.read(data, { type: 'array' });
        const ws      = wb.Sheets[wb.SheetNames[0]];
        const rows    = XLSX.utils.sheet_to_json(ws, { header: 1 });
        // Flatten all cells, take first non-empty column that looks like a name
        const names = [];
        rows.forEach(row => {
          if (!row || row.length === 0) return;
          // Take the first non-empty cell per row
          const val = String(row[0] || '').trim();
          if (val && val.toLowerCase() !== 'name' && val.toLowerCase() !== 'names') names.push(val);
        });
        setParsedNames(names, file.name, statusEl, previewEl, listEl);
      } catch (err) {
        statusEl.textContent = `❌ Failed to parse Excel: ${err.message}`;
        statusEl.classList.add('parse-error');
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    statusEl.textContent = '❌ Unsupported file type. Use .csv, .xlsx, .xls, or .txt';
    statusEl.classList.add('parse-error');
  }
}

function parseCSVText(text) {
  const lines = text.split(/\r?\n/);
  const names = [];
  lines.forEach(line => {
    // Support both comma-separated and just names on each line
    const parts = line.split(',');
    const val = parts[0].replace(/['"]/g, '').trim();
    if (val && val.toLowerCase() !== 'name' && val.toLowerCase() !== 'names') names.push(val);
  });
  return names;
}

function setParsedNames(names, filename, statusEl, previewEl, listEl) {
  parsedBulkNames = names;
  statusEl.textContent = `✅ Parsed ${names.length} names from "${filename}"`;
  statusEl.classList.add('parse-ok');

  if (names.length > 0) {
    previewEl.classList.remove('hidden');
    const preview = names.slice(0, 10);
    listEl.innerHTML = preview.map((n, i) =>
      `<div class="parsed-name-item"><span class="parsed-idx">${i + 1}</span> ${n}</div>`
    ).join('') + (names.length > 10 ? `<div class="parsed-name-item" style="color:var(--muted)">... and ${names.length - 10} more</div>` : '');
  }
  updateBulkCount();
}

async function generateBulk() {
  const title   = document.getElementById('bulkTitle').value.trim();
  const names   = getBulkNames();
  const errEl   = document.getElementById('bulkError');
  errEl.classList.add('hidden');

  if (!title)          return showAlert(errEl, 'Please enter a certificate title.');
  if (names.length === 0) return showAlert(errEl, 'Please add at least one recipient name.');
  if (names.length > 500) return showAlert(errEl, 'Maximum 500 certificates per batch.');

  // Disable button while processing
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = `⏳ Generating ${names.length} certificates...`;

  try {
    const res  = await apiFetch('/certs/generate-bulk', 'POST', { title, recipients: names });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = '⚡ Generate All Certificates';

    if (!res.ok) return showAlert(errEl, data.message || 'Bulk generation failed.');

    lastBulkCerts = data.certs || [];
    displayBulkResult(data);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '⚡ Generate All Certificates';
    showAlert(errEl, 'Cannot connect to server.');
  }
}

function displayBulkResult(data) {
  const resultEl = document.getElementById('bulkResult');
  const statsEl  = document.getElementById('bulkResultStats');
  const listEl   = document.getElementById('bulkCertList');

  statsEl.innerHTML = `
    <div class="bulk-stat"><span class="bulk-stat-num">${data.count}</span><span class="bulk-stat-lbl">Certificates Generated</span></div>
    <div class="bulk-stat"><span class="bulk-stat-num" style="color:var(--green)">✅</span><span class="bulk-stat-lbl">All Saved to Database</span></div>
  `;

  const preview = (data.certs || []).slice(0, 20);
  listEl.innerHTML = preview.map(c => `
    <div class="bulk-cert-row">
      <span class="cr-id">${c.certId}</span>
      <span class="bulk-cert-name">${c.name}</span>
      <span class="bulk-cert-date">${new Date(c.date).toLocaleDateString()}</span>
    </div>
  `).join('') + (data.count > 20 ? `<p style="font-size:0.75rem;color:var(--muted);margin-top:0.5rem">Showing first 20 of ${data.count}. Download CSV for full list.</p>` : '');

  resultEl.classList.remove('hidden');
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function downloadBulkCSV() {
  if (!lastBulkCerts.length) return;
  const header = 'Certificate ID,Name,Issuer,Organization,Date';
  const rows   = lastBulkCerts.map(c =>
    `${c.certId},"${c.name}","${c.issuer}","${c.organization}",${new Date(c.date).toLocaleDateString()}`
  );
  const csv  = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'certichain_bulk_certificates.csv';
  a.click(); URL.revokeObjectURL(url);
}

// ── Verify Certificate ─────────────────────────────────────
async function verifyCert(certIdOverride) {
  const certId = (certIdOverride || document.getElementById('verifyCertId').value.trim()).toUpperCase();
  const resultEl = document.getElementById('verifyResult');
  if (!certId) return;
  resultEl.className = 'verify-result hidden';
  try {
    const res  = await apiFetch(`/certs/verify/${certId}`);
    const data = await res.json();
    renderVerifyResult(data, certId, resultEl);
  } catch (e) {
    resultEl.classList.remove('hidden');
    resultEl.classList.add('verify-invalid');
    resultEl.innerHTML = `<h3>❌ Connection Error</h3><p style="color:var(--muted);font-size:0.8rem">Cannot reach server.</p>`;
  }
}

function renderVerifyResult(data, certId, el) {
  el.classList.remove('hidden');
  if (data.tampered) {
    el.classList.add('verify-warn');
    el.innerHTML = `<h3>⚠️ Certificate Tampered!</h3><p style="font-size:0.8rem;color:var(--yellow)">Hash mismatch detected. This certificate may have been forged.</p>`;
  } else if (!data.valid) {
    el.classList.add('verify-invalid');
    el.innerHTML = `<h3>❌ ${data.revoked ? 'Certificate Revoked' : 'Certificate Not Found'}</h3><p style="font-size:0.8rem;color:var(--muted)">${data.message || 'No certificate found with ID: ' + certId}</p>`;
  } else {
    const c = data.cert;
    el.classList.add('verify-valid');
    el.innerHTML = `
      <h3>✅ Certificate Valid</h3>
      <div class="verify-field"><span class="vf-label">Certificate ID</span><span class="vf-val" style="color:var(--accent)">${c.certId}</span></div>
      <div class="verify-field"><span class="vf-label">Certificate Name</span><span class="vf-val">${c.name}</span></div>
      <div class="verify-field"><span class="vf-label">Issued By</span><span class="vf-val">${c.issuer}</span></div>
      <div class="verify-field"><span class="vf-label">Organization</span><span class="vf-val">${c.organization}</span></div>
      <div class="verify-field"><span class="vf-label">Date Issued</span><span class="vf-val">${new Date(c.date).toLocaleDateString()}</span></div>
      <div class="verify-field"><span class="vf-label">Hash (SHA-256)</span><span class="vf-val" style="font-size:0.72rem;word-break:break-all;color:var(--green)">${c.hash}</span></div>`;
  }
}

// ── QR Scanner ─────────────────────────────────────────────
function switchVerifyTab(tab) {
  document.getElementById('tabManual').classList.toggle('active', tab === 'manual');
  document.getElementById('tabScan').classList.toggle('active', tab === 'scan');
  document.getElementById('verifyManualPanel').classList.toggle('hidden', tab !== 'manual');
  document.getElementById('verifyScanPanel').classList.toggle('hidden', tab !== 'scan');
  if (tab === 'manual') stopScanner();
}

function startScanner() {
  const statusEl = document.getElementById('scanStatus');
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn  = document.getElementById('stopScanBtn');
  statusEl.textContent = '⏳ Starting camera...';
  startBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');

  html5QrScanner = new Html5Qrcode('qrScannerBox');
  Html5Qrcode.getCameras().then(cameras => {
    if (!cameras || cameras.length === 0) {
      statusEl.textContent = '❌ No camera found.';
      startBtn.classList.remove('hidden'); stopBtn.classList.add('hidden'); return;
    }
    const cam = cameras.find(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('environment')) || cameras[0];
    return html5QrScanner.start(cam.id, { fps: 10, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        statusEl.textContent = '✅ QR Scanned!';
        stopScanner();
        let certId = decodedText;
        try { const u = new URL(decodedText); certId = u.searchParams.get('verify') || u.searchParams.get('id') || decodedText; } catch (_) {}
        certId = certId.toUpperCase().trim();
        document.getElementById('verifyCertId').value = certId;
        switchVerifyTab('manual');
        verifyCert(certId);
      }, () => {}
    );
  }).then(() => { statusEl.textContent = '📷 Camera active — hold QR code steady'; })
    .catch(err => { statusEl.textContent = `❌ Camera error: ${err}`; startBtn.classList.remove('hidden'); stopBtn.classList.add('hidden'); });
}

function stopScanner() {
  if (html5QrScanner) {
    html5QrScanner.stop().then(() => { html5QrScanner.clear(); html5QrScanner = null; }).catch(() => { html5QrScanner = null; });
  }
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn  = document.getElementById('stopScanBtn');
  const statusEl = document.getElementById('scanStatus');
  if (startBtn) startBtn.classList.remove('hidden');
  if (stopBtn)  stopBtn.classList.add('hidden');
  if (statusEl) statusEl.textContent = '';
}

// ── Helpers ────────────────────────────────────────────────
function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${API}${path}`, opts);
}

function showAlert(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function checkUrlForVerify() {
  const params = new URLSearchParams(window.location.search);
  let certId = params.get('verify');
  const hash = window.location.hash;
  if (!certId && hash.includes('?id=')) certId = hash.split('?id=')[1];
  if (certId) {
    certId = certId.toUpperCase().trim();
    _show('verify', false);
    document.getElementById('verifyCertId').value = certId;
    verifyCert(certId);
  }
}

// ── Init ───────────────────────────────────────────────────
(function init() {
  updateNavbar();

  // Determine which section to show on page load
  const raw   = window.location.hash.replace('#','').split('?')[0] || '';
  const valid = ['home','register','login','dashboard','generate','verify','profile'];
  const target = valid.includes(raw) ? raw : (currentUser ? 'dashboard' : 'home');
  history.replaceState({ section: target }, '', '#' + target);
  _show(target, false);  // _show respects login/register — never redirects them

  checkUrlForVerify();
  selectTemplate('classic');
})();