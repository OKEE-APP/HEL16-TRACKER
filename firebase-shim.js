/* HEL16 Site Tracker: Firebase layer.
   Gives app.js the same db / user / assets / downloads objects it had inside Claude,
   backed by Firestore (with an on-phone cache), Firebase Auth and Firebase Storage. */
const V = '10.14.1';
const base = 'https://www.gstatic.com/firebasejs/' + V + '/';
const H = window.__hel16;
const CFG = window.HEL16_CONFIG || {};
const OWNERS = (CFG.owners || []).map(e => e.toLowerCase());
const ROLE_KEY = 'hel16.role';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- gate (sign-in screens) ---------- */
const gate = document.createElement('div');
gate.id = 'gate'; gate.hidden = true;
document.body.appendChild(gate);
function showGate(html) { gate.innerHTML = '<div class="gbox"><div class="gplate"><img alt="OKEE" src="' + (document.querySelector('.plate .logo') || {}).src + '"></div>' + html + '</div>'; gate.hidden = false; }
function hideGate() { gate.hidden = true; gate.innerHTML = ''; }
function fail(msg) { H.failMsg = msg; H.resolve({}); }

if (!CFG.firebase || !CFG.firebase.apiKey || String(CFG.firebase.apiKey).startsWith('PASTE')) {
  showGate('<h2>Almost ready</h2><p>This copy of the tracker is not connected to its Firebase project yet.</p>');
  fail('The app is not connected to its database yet.');
  throw new Error('HEL16: missing Firebase config');
}

let fb;
try {
  const [app, auth, fsx, st] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-storage.js'].map(f => import(base + f)));
  fb = { ...app, ...auth, ...fsx, ...st };
} catch (e) {
  showGate('<h2>Open once with signal</h2><p>This phone has not downloaded the app yet. Open it once while you have mobile data or Wi-Fi, then it will work without signal.</p><button class="gbtn" onclick="location.reload()">Try again</button>');
  fail('The app has not finished downloading on this phone.');
  throw e;
}

const app = fb.initializeApp(CFG.firebase);
const auth = fb.getAuth(app);
let fs;
try { fs = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) }); }
catch (e) { fs = fb.getFirestore(app); }
let storage = null; try { storage = fb.getStorage(app); } catch (e) {}

/* ---------- db adapter: the same calls app.js made on Claude's database ---------- */
const mapErr = e => { const c = e && e.code; throw { code: c === 'not-found' || c === 'permission-denied' ? 'invalid_argument' : c === 'unavailable' ? 'offline' : (c || 'error'), message: e && e.message }; };
const offline = () => !navigator.onLine;
const wrapSnap = s => ({ id: s.id, exists: s.exists(), data: () => s.data() });
const wrapQS = qs => ({ docs: qs.docs.map(d => ({ id: d.id, data: () => d.data() })), size: qs.size, empty: qs.empty });
const isPlain = v => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Blob);
// deep merge, like Claude's db: nested maps are merged field by field, not replaced
function flatten(o, pre = [], out = []) {
  for (const [k, v] of Object.entries(o)) {
    const p = pre.concat(k);
    if (isPlain(v) && Object.keys(v).length) flatten(v, p, out);
    else out.push(new fb.FieldPath(...p), v === undefined ? null : v);
  }
  return out;
}
function docApi(path) {
  const r = fb.doc(fs, ...path.split('/'));
  return {
    id: r.id,
    get: () => fb.getDoc(r).then(wrapSnap, mapErr),
    set: d => offline() ? Promise.reject({ code: 'offline' }) : fb.setDoc(r, d).catch(mapErr),
    update: d => {
      if (offline()) return Promise.reject({ code: 'offline' });
      const f = flatten(d); if (!f.length) return Promise.resolve();
      return fb.updateDoc(r, f[0], f[1], ...f.slice(2)).catch(mapErr);
    },
    delete: () => fb.deleteDoc(r).catch(mapErr),
    onSnapshot: (cb, err) => fb.onSnapshot(r, s => cb(wrapSnap(s)), e => err && err(e)),
  };
}
function collApi(path, cons = []) {
  const ref = () => cons.length ? fb.query(fb.collection(fs, ...path.split('/')), ...cons) : fb.collection(fs, ...path.split('/'));
  return {
    doc: id => docApi(path + '/' + id),
    where: (f, op, v) => collApi(path, cons.concat(fb.where(f, op, v))),
    orderBy: (f, dir) => collApi(path, cons.concat(fb.orderBy(f, dir))),
    limit: n => collApi(path, cons.concat(fb.limit(n))),
    get: () => fb.getDocs(ref()).then(wrapQS, mapErr),
    onSnapshot: (cb, err) => fb.onSnapshot(ref(), qs => cb(wrapQS(qs)), e => err && err(e)),
  };
}
const db = { doc: docApi, collection: p => collApi(p) };

/* ---------- people (names shown on records) ---------- */
let people = {}, peopleReady;
const peopleLoaded = new Promise(r => peopleReady = r);
setTimeout(() => peopleReady(), 4000);

/* ---------- assets (photos) ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const assets = storage ? {
  async upload(blob, opts) {
    if (offline()) throw { code: 'offline' };
    const id = uid(), r = fb.ref(storage, 'photos/' + id + '.jpg');
    await fb.uploadBytes(r, blob, { contentType: (opts && opts.type) || blob.type || 'image/jpeg' });
    return { id, url: await fb.getDownloadURL(r) };
  },
} : null;

/* ---------- downloads (test sheets, QR label sheets) ---------- */
const downloads = {
  async save({ filename, data }) {
    const type = /\.html?$/i.test(filename) ? 'text/html' : /\.csv$/i.test(filename) ? 'text/csv' : 'application/octet-stream';
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
    if (mobile && navigator.canShare) {
      const file = new File([blob], filename, { type });
      if (navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e && e.name === 'AbortError') throw { code: 'declined' }; } }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  },
};

/* ---------- sign-in ---------- */
const nice = e => {
  const c = (e && e.code) || '';
  if (c.includes('popup-closed') || c.includes('cancelled-popup')) return 'Sign-in was closed before it finished.';
  if (c.includes('popup-blocked')) return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  if (c.includes('unauthorized-domain')) return 'This web address is not allowed to sign in yet. Add it under Authentication → Settings → Authorized domains in Firebase.';
  if (c.includes('network')) return 'No signal. Signing in needs a connection the first time.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'That email and password do not match.';
  if (c.includes('email-already-in-use')) return 'That email already has an account. Use Sign in instead.';
  if (c.includes('weak-password')) return 'Use a password of at least 6 characters.';
  if (c.includes('invalid-email')) return 'That email address does not look right.';
  if (c.includes('operation-not-allowed')) return 'This sign-in method is not switched on in Firebase yet.';
  return 'Could not sign in (' + (c || 'error') + ').';
};
function signInScreen(msg, mode) {
  mode = mode || 'start';
  const err = msg ? '<p class="gerr">' + esc(msg) + '</p>' : '';
  if (mode === 'start') {
    showGate('<h2>HEL16 Site Tracker</h2><p>Sign in so your work is saved under your name. You only need signal the first time.</p>' + err +
      '<button class="gbtn" id="gGoogle">Sign in with Google</button><button class="gbtn alt" id="gEmail">Sign in with email</button>');
    gate.querySelector('#gGoogle').onclick = async () => {
      try { await fb.signInWithPopup(auth, new fb.GoogleAuthProvider()); } catch (e) { signInScreen(nice(e)); }
    };
    gate.querySelector('#gEmail').onclick = () => signInScreen('', 'email');
  } else {
    showGate('<h2>Sign in with email</h2>' + err +
      '<label class="gl">Email<input id="gE" type="email" autocomplete="email" inputmode="email"></label>' +
      '<label class="gl">Password<input id="gP" type="password" autocomplete="current-password"></label>' +
      '<label class="gl" id="gNameL" hidden>Your name (shown on your work)<input id="gN" autocomplete="name"></label>' +
      '<button class="gbtn" id="gIn">Sign in</button><button class="gbtn alt" id="gNew">Create account</button>' +
      '<div class="glinks"><button class="glink" id="gReset">Forgot password</button><button class="glink" id="gBack">Back</button></div>');
    const E = () => gate.querySelector('#gE').value.trim(), P = () => gate.querySelector('#gP').value;
    gate.querySelector('#gIn').onclick = async () => { try { await fb.signInWithEmailAndPassword(auth, E(), P()); } catch (e) { signInScreen(nice(e), 'email'); } };
    gate.querySelector('#gNew').onclick = async () => {
      const nl = gate.querySelector('#gNameL');
      if (nl.hidden) { nl.hidden = false; gate.querySelector('#gNew').textContent = 'Create my account'; gate.querySelector('#gN').focus(); return; }
      const name = gate.querySelector('#gN').value.trim(); if (!name) { gate.querySelector('#gN').focus(); return; }
      try { const c = await fb.createUserWithEmailAndPassword(auth, E(), P()); await fb.updateProfile(c.user, { displayName: name }); await fb.sendEmailVerification(c.user); verifyScreen(c.user); } catch (e) { signInScreen(nice(e), 'email'); }
    };
    gate.querySelector('#gReset').onclick = async () => { if (!E()) { signInScreen('Type your email first, then tap Forgot password.', 'email'); return; } try { await fb.sendPasswordResetEmail(auth, E()); signInScreen('A reset link is on its way to ' + E() + '.', 'email'); } catch (e) { signInScreen(nice(e), 'email'); } };
    gate.querySelector('#gBack').onclick = () => signInScreen();
  }
}
function verifyScreen(user, msg) {
  showGate('<h2>Check your email</h2><p>We sent a link to <b>' + esc(user.email) + '</b>. Tap it, then come back here and tap Continue.</p>' + (msg ? '<p class="gerr">' + esc(msg) + '</p>' : '') +
    '<button class="gbtn" id="gDone">Continue</button><div class="glinks"><button class="glink" id="gResend">Send the link again</button><button class="glink" id="gOut">Use a different account</button></div>');
  gate.querySelector('#gDone').onclick = async () => { try { await user.reload(); await user.getIdToken(true); } catch (e) {} if (auth.currentUser && auth.currentUser.emailVerified) location.reload(); else verifyScreen(user, 'Not verified yet. Tap the link in the email first.'); };
  gate.querySelector('#gResend').onclick = async () => { try { await fb.sendEmailVerification(user); verifyScreen(user, 'Sent again.'); } catch (e) { verifyScreen(user, nice(e)); } };
  gate.querySelector('#gOut').onclick = () => fb.signOut(auth).then(() => location.reload());
}

/* ---------- role ---------- */
async function roleOf(email) {
  if (OWNERS.includes(email)) return 'editor';
  try {
    const s = await fb.getDoc(fb.doc(fs, 'members', email));
    const r = s.exists() ? (s.data().role || 'viewer') : 'none';
    try { localStorage.setItem(ROLE_KEY, JSON.stringify({ email, r })); } catch (e) {}
    return r;
  } catch (e) {
    try { const c = JSON.parse(localStorage.getItem(ROLE_KEY) || 'null'); if (c && c.email === email) return c.r; } catch (x) {}
    return offline() ? 'viewer' : 'none';
  }
}

/* ---------- account menu, team access and data import ---------- */
function accountButton(me, role) {
  const brand = document.querySelector('.brand'); if (!brand || document.getElementById('acctBtn')) return;
  const b = document.createElement('button'); b.id = 'acctBtn'; b.className = 'acct'; b.type = 'button';
  b.setAttribute('aria-label', 'Account'); b.textContent = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
  b.onclick = () => openAccount(me, role);
  brand.appendChild(b);
}
const ROLES = [['editor', 'Editor', 'Records work, edits the schedule, signs off, manages the team'], ['contributor', 'Contributor', 'Records work'], ['viewer', 'View only', 'Sees progress only']];
async function openAccount(me, role) {
  const host = document.createElement('div'); host.className = 'scrim'; host.id = 'acctScrim';
  const roleName = (ROLES.find(r => r[0] === role) || [0, role])[1];
  host.innerHTML = '<div class="sheet" role="dialog" aria-label="Account"><div class="sh"><h2>Account</h2><button class="btn" data-x>Close</button></div>' +
    '<section class="panel"><div><b>' + esc(me.name) + '</b><div class="by">' + esc(me.email) + ' · ' + esc(roleName) + '</div></div><div class="tools"><button class="btn" data-out>Sign out</button></div>' +
    '<p class="by" style="margin:0">Signing out removes this phone\'s copy of the site data. Anything still held offline is sent first only if you have signal.</p></section>' +
    (role === 'editor' ? '<section class="panel" id="teamPanel"><h3>Team access</h3><p class="by" style="margin:0">Add people by the email they sign in with.</p>' +
      '<div class="tools"><input id="tmEmail" type="email" placeholder="name@example.com" style="flex:1 1 200px;min-width:0;border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:9px 12px;min-height:42px">' +
      '<select id="tmRole" class="sel">' + ROLES.map(r => '<option value="' + r[0] + '"' + (r[0] === 'contributor' ? ' selected' : '') + '>' + r[1] + '</option>').join('') + '</select><button class="btn team" data-add>Add</button></div>' +
      '<div id="tmList" class="by">Loading…</div></section>' +
      '<section class="panel"><h3>Import site data</h3><p class="by" style="margin:0">One-off move of the boards, tests and activity exported from the old Claude tracker. Needs signal.</p>' +
      '<div class="tools"><label class="btn">Choose export file<input type="file" id="impFile" accept=".json,application/json" hidden></label><span id="impMsg" class="by"></span></div></section>' : '') +
    '</div>';
  document.body.appendChild(host);
  const close = () => host.remove();
  host.addEventListener('click', e => { if (e.target === host || e.target.closest('[data-x]')) close(); });
  host.querySelector('[data-out]').onclick = async () => {
    if (!confirmInline(host.querySelector('[data-out]'), 'Tap again to sign out')) return;
    try { await fb.signOut(auth); } catch (e) {}
    try { await fb.terminate(fs); await fb.clearIndexedDbPersistence(fs); } catch (e) {}
    try { localStorage.removeItem(ROLE_KEY); } catch (e) {}
    location.reload();
  };
  if (role !== 'editor') return;
  const list = host.querySelector('#tmList');
  const draw = async () => {
    try {
      const qs = await fb.getDocs(fb.collection(fs, 'members'));
      const rows = qs.docs.map(d => [d.id, d.data().role]).sort((a, b) => a[0].localeCompare(b[0]));
      list.innerHTML = '<div class="checks">' + OWNERS.map(e => '<div class="chk" style="justify-content:space-between"><span>' + esc(e) + '</span><span class="chip">Owner</span></div>').join('') +
        rows.filter(r => !OWNERS.includes(r[0])).map(([e, r]) => '<div class="chk" style="justify-content:space-between;flex-wrap:wrap"><span style="overflow-wrap:anywhere">' + esc(e) + '</span><span class="tools"><select class="sel" data-role="' + esc(e) + '">' +
          ROLES.map(x => '<option value="' + x[0] + '"' + (x[0] === r ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select><button class="btn danger" data-rm="' + esc(e) + '">Remove</button></span></div>').join('') + '</div>';
    } catch (e) { list.textContent = 'Could not load the team list. Check your signal.'; }
  };
  draw();
  host.querySelector('[data-add]').onclick = async () => {
    const e = host.querySelector('#tmEmail').value.trim().toLowerCase(), r = host.querySelector('#tmRole').value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { host.querySelector('#tmEmail').focus(); return; }
    try { await fb.setDoc(fb.doc(fs, 'members', e), { role: r, addedBy: me.email, addedAt: Date.now() }); host.querySelector('#tmEmail').value = ''; draw(); } catch (x) { list.textContent = 'Could not add (' + (x.code || 'error') + '). Check your signal.'; }
  };
  list.addEventListener('change', async e => { const s = e.target.closest('[data-role]'); if (!s) return; try { await fb.updateDoc(fb.doc(fs, 'members', s.dataset.role), { role: s.value }); } catch (x) { draw(); } });
  list.addEventListener('click', async e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    if (!confirmInline(b, 'Tap again')) return;
    try { await fb.deleteDoc(fb.doc(fs, 'members', b.dataset.rm)); draw(); } catch (x) { draw(); }
  });
  host.querySelector('#impFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const msg = host.querySelector('#impMsg');
    try {
      const data = JSON.parse(await f.text());
      const writes = [];
      for (const coll of ['boards', 'tests', 'qa', 'events', 'people']) for (const [id, d] of Object.entries(data[coll] || {})) writes.push([coll, id, d]);
      if (!writes.length) { msg.textContent = 'That file has nothing to import.'; return; }
      let n = 0;
      for (let i = 0; i < writes.length; i += 200) {
        const b = fb.writeBatch(fs);
        writes.slice(i, i + 200).forEach(([c, id, d]) => b.set(fb.doc(fs, c, id), d, { merge: c === 'people' }));
        await b.commit(); n += Math.min(200, writes.length - i); msg.textContent = 'Imported ' + n + ' of ' + writes.length + '…';
      }
      msg.textContent = 'Done: imported ' + writes.length + ' records.';
    } catch (x) { msg.textContent = 'Import failed (' + ((x && (x.code || x.message)) || 'error') + ').'; }
  };
}
function confirmInline(btn, label) {
  if (btn.dataset.armed) return true;
  const old = btn.textContent; btn.dataset.armed = '1'; btn.textContent = label;
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 4000);
  return false;
}

/* ---------- warm the on-phone copy of every area while there is signal ---------- */
async function warmCache() {
  if (offline()) return;
  for (const c of ['boards', 'tests', 'qa', 'people']) { try { await fb.getDocs(fb.collection(fs, c)); } catch (e) {} }
  try { await fb.getDocs(fb.query(fb.collection(fs, 'events'), fb.orderBy('at', 'desc'), fb.limit(100))); } catch (e) {}
}

/* ---------- start ---------- */
let started = false;
fb.onAuthStateChanged(auth, async user => {
  if (started) return;
  if (!user) { signInScreen(); return; }
  const isPassword = user.providerData.some(p => p.providerId === 'password');
  if (isPassword && !user.emailVerified) { verifyScreen(user); return; }
  started = true;
  const email = (user.email || '').toLowerCase();
  const role = await roleOf(email);
  if (role === 'none') {
    started = false;
    showGate('<h2>Not on the team list yet</h2><p>You are signed in as <b>' + esc(email) + '</b>, but this address has not been given access. Ask the site lead to add it under Account → Team access, then tap Try again.</p>' +
      '<button class="gbtn" onclick="location.reload()">Try again</button><div class="glinks"><button class="glink" id="gOut">Use a different account</button></div>');
    gate.querySelector('#gOut').onclick = () => fb.signOut(auth).then(() => location.reload());
    return;
  }
  hideGate();
  const me = { id: user.uid, name: user.displayName || email.split('@')[0], email, canEdit: role === 'editor' };
  fb.onSnapshot(fb.collection(fs, 'people'), qs => { qs.docs.forEach(d => people[d.id] = d.data()); peopleReady(); }, () => peopleReady());
  if (!offline() && role !== 'viewer') fb.setDoc(fb.doc(fs, 'people', user.uid), { name: me.name, email }, { merge: true }).catch(() => {});
  const userApi = {
    me: async () => ({ ...me }),
    can: async perm => perm === 'data.write' ? role !== 'viewer' : true,
    profiles: async ids => { await peopleLoaded; const out = {}; ids.forEach(id => { out[id] = { name: (people[id] && people[id].name) || '' }; }); return out; },
  };
  accountButton(me, role);
  H.resolve({ db, user: userApi, assets, downloads });
  warmCache();
});
