const APP_URL = location.origin + location.pathname;
const SITE = [['COLO1','COLO 1'],['COLO2','COLO 2'],['COLO3','COLO 3'],['COLO4','COLO 4'],['COLO5','COLO 5'],['ADMIN','ADMIN']];
let CODE = 'COLO3', COLO = 'COLO 3';   // the area currently loaded
const PROJECT_REF = 'HEL16-1229', REG_NO = 'A6627';
const SHORT = () => new RegExp('^' + CODE + '-');
const cellsOf = () => [...new Set(Object.values(S.boards).map(b => b.cell))].sort();
const cellLabel = c => /^CE\d/.test(c) ? 'Cell ' + c.slice(2) : c;
function setColo(code) { const x = SITE.find(s => s[0] === code) || SITE[2]; CODE = x[0]; COLO = x[1]; try { localStorage.setItem('hel16s.colo', CODE); } catch (e) {} }
try { setColo(localStorage.getItem('hel16s.colo') || 'COLO3'); } catch (e) {}
const IR_MIN = 1.0, RCD_MAX = 300, RCD5_MAX = 40;

const TEAMS = {
  install: { name: 'Installers', tabs: [['boards','Boards'],['today','Today'],['activity','Activity']], blurb: 'Pull cables and terminate both ends. Tap a stage when it is done.' },
  test:    { name: 'Testers',    tabs: [['boards','Test sheets'],['results','Results'],['me','My details'],['activity','Activity']], blurb: 'Record pre-connection and post-connection test results on the board test record sheet, and mark circuits labelled.' },
  qa:      { name: 'QA/QC',      tabs: [['boards','Inspect'],['results','Test results'],['labels','QR labels'],['activity','Activity']], blurb: 'Inspect terminations and labelling, review the tests and sign off each circuit.' },
};
const INSTALL = [
  { k: 'inst', s: 'PULL', l: 'Cable pulled' },
  { k: 'bt',   s: 'BT',   l: 'Terminated at board' },
  { k: 'ft',   s: 'FT',   l: 'Terminated at load' },
];
// labelling is done by the Testers (quick-tap LAB on each circuit, and a Labelling tab on the test sheet)
const LABEL = { k: 'lab', s: 'LAB', l: 'Labelled' };
const STAGES = INSTALL.concat(LABEL);
const TERM_CHECKS = [['size','Cable type and size match the schedule'],['gland','Gland fitted and earthed (or not needed)'],['torque','Conductors terminated and torqued'],['lugs','Ferrules / lugs fitted and crimped'],['cores','Cores identified (phase colours / numbers)'],['ident','Cable ident fitted at this end']];
const LAB_CHECKS = [['board','Circuit label fitted at the board'],['field','Label fitted at the load / outlet'],['chart','Board circuit chart updated']];
const CABLE_TYPES = ['NHXH','NYMJ','N2XH','NYY','CYY','LSF','PVC','PVC/SWA/PVC','PVC/SWA/XLPE','XLPE','XLPE/SWA/XLPE','PH30','PH60','PH90','PH120'];
const BLOCKERS = ['Need cable','Need location','Waiting material','No access','Design change','Re-pull required','Other'];
// circuit schedule fields Editors can change; every team app reads the same record, so a change shows everywhere
const FIELDS = [
  ['circ', 'Circuit', 'e.g. L1/21'], ['desc', 'Description', 'Load or equipment tag'], ['dev', 'Device no', 'e.g. 5Q7'], ['term', 'Terminal no', 'e.g. 5X1 13/14/PE'],
  ['drw', 'Drawing ref', ''], ['ebox', 'E-box', 'e.g. Sub 01 (ELP boards only)'], ['size', 'Cable size (mm²)', 'e.g. 2.5'], ['elem', 'No. of points', ''],
  ['cat', 'Device category', 'e.g. MCB, MCB/RCD, FUSE'], ['dtype', 'Device type', 'e.g. C'], ['rating', 'Rating', 'e.g. 16A'],
];
// test record sheet columns (matching HEL16 test record sheet, columns N..AL)
const PRE = [
  { k: 'r12',   l: 'Continuity P+E (R1+R2) Ω', col: 'N', need: () => true },
  { k: 'r2',    l: 'Continuity E (R2) Ω',      col: 'O', need: () => false },
  { k: 'rpp',   l: 'Ring P–P Ω', col: 'P', ring: true }, { k: 'rnn', l: 'Ring N–N Ω', col: 'Q', ring: true }, { k: 'ree', l: 'Ring E–E Ω', col: 'R', ring: true },
  { k: 'irpn',  l: 'IR P–N MΩ',   col: 'S', ir: true, need: () => true },
  { k: 'irpne', l: 'IR P+N–E MΩ', col: 'T', ir: true, need: () => true },
  { k: 'irppp', l: 'IR P1P2P3+N–E MΩ', col: 'U', ir: true, three: true, need: c => c.three },
  { k: 'irbus', l: 'IR phase busbar to open MCB MΩ', col: 'V', ir: true, need: () => false },
];
const POST3 = [['v12','V L1–L2','X'],['v13','V L1–L3','Y'],['v23','V L2–L3','Z'],['v1g','V L1–Gnd','AA'],['v2g','V L2–Gnd','AB'],['v3g','V L3–Gnd','AC'],['v1n','V L1–N','AD'],['v2n','V L2–N','AE'],['v3n','V L3–N','AF'],['vne','V N–E','AG']];

const S = { db: null, user: null, assets: null, downloads: null, me: { id: null }, canEdit: false, readOnly: false,
  boards: {}, tests: {}, qa: {}, loaded: false, failed: '', events: [], names: {},
  team: null, view: 'boards', cell: 'CE1', board: null, q: '', filter: 'all', sheet: null, sheetKind: null, dirty: false, resBoard: 'all', mode: null };
try { const c = localStorage.getItem('hel16t.cell'); if (c) S.cell = c; } catch (e) {}
let ME = { name: '', qc: '', make: 'MEGGER', model: '', serial: '', cal: '', cable: 'NHXH' };
try { Object.assign(ME, JSON.parse(localStorage.getItem('hel16t.tester') || '{}')); } catch (e) {}
function saveMe() { try { localStorage.setItem('hel16t.tester', JSON.stringify(ME)); } catch (e) {} }
function parseHash() {
  const h = location.hash.slice(1), [team, target] = h.split('.');
  S.team = TEAMS[team] ? team : null; S.view = 'boards';
  const site = target && SITE.find(s => target.startsWith(s[0] + '-'));
  if (site) { if (site[0] !== CODE) { setColo(site[0]); S._coloChanged = true; } S.board = target; const m = /-(CE\d)-/.exec(target); S.cell = m ? m[1] : site[0]; }
  else if (target && /^CE\d-/.test(target)) S.pendingRef = target;
  // a board QR label: #<board> with no team, e.g. #COLO1-CE1-PNL01
  S.scanBoard = null;
  const scan = !S.team && !target && h && SITE.find(s => h.startsWith(s[0] + '-'));
  if (scan) { if (scan[0] !== CODE) { setColo(scan[0]); S._coloChanged = true; } S.scanBoard = h; const m = /-(CE\d)-/.exec(h); S.cell = m ? m[1] : scan[0]; }
  document.body.className = S.team ? 'team-' + S.team : '';
}
parseHash();
window.addEventListener('hashchange', () => { closeSheet(); S.board = null; parseHash(); if (S._coloChanged) { S._coloChanged = false; if (S.db) subscribe(); } render(); window.scrollTo(0, 0); });

/* ---------- utils ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
const todayIso = () => iso(new Date());
const fmtDMY = s => { if (!s) return ''; const [y,m,d] = s.split('-'); return d + '/' + m + '/' + y; };
const fmtDM = s => { if (!s) return ''; const [, m, d] = s.split('-'); return d + '/' + m; };
const ago = ts => { const s = (Date.now() - ts) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s/60) + ' min ago'; if (s < 86400) return Math.floor(s/3600) + ' h ago'; return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
const nameOf = id => { if (!id) return 'Imported'; const p = S.names[id]; return (p && p.name) || (id === S.me.id ? 'You' : 'Someone'); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : null; };
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) { for (const k in b) { const v = b[k]; if (isObj(v) && isObj(a[k])) merge(a[k], v); else a[k] = isObj(v) ? merge({}, v) : v; } return a; }
const clone = o => JSON.parse(JSON.stringify(o || {}));
// percentages round up (best impression), but only a finished set shows 100%
const pct = (n, d) => !d ? 0 : n >= d ? 100 : Math.min(99, Math.ceil(n / d * 100 - 1e-9));
const stamp = () => ({ d: todayIso(), by: S.me.id, at: Date.now() });

/* ---------- hold queue: every change waits on this phone until it is confirmed saved ---------- */
const OUTBOX_KEY = 'hel16s.outbox';
let outbox = []; try { outbox = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) {}
const saveOutbox = () => { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch (e) {} };
let idb = null;
const idbReady = new Promise(res => { try { const r = indexedDB.open('hel16t', 1); r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'key' }); r.onsuccess = () => { idb = r.result; res(idb); }; r.onerror = () => res(null); } catch (e) { res(null); } });
const heldPhotos = [];
idbReady.then(db => { if (!db) return; const rq = db.transaction('photos', 'readonly').objectStore('photos').getAll(); rq.onsuccess = () => { (rq.result || []).forEach(p => heldPhotos.push({ ...p, url: URL.createObjectURL(p.blob) })); render(); flush(); }; });
const idbPut = p => idbReady.then(db => db && new Promise(r => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put({ key: p.key, coll: p.coll, board: p.board, ref: p.ref, tag: p.tag, blob: p.blob, t: p.t }); tx.oncomplete = r; tx.onerror = r; }));
const idbDel = key => idbReady.then(db => db && new Promise(r => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(key); tx.oncomplete = r; tx.onerror = r; }));
function queue(coll, board, data, ev, opts) {
  if (S.readOnly) { toast('View only: ask the owner for Contributor access.'); return; }
  const at = Date.now();
  outbox.push({ id: uid(), coll, board, data, create: !!(opts && opts.create), ev: ev ? { ...ev, team: S.team, board, at, by: S.me.id } : null, t: at });
  saveOutbox(); render(); flush();
}
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]);
let flushing = false, lastErr = '';
const TRANSIENT = ['offline', 'timeout', 'unavailable', 'deadline-exceeded', 'unauthenticated', 'resource-exhausted', 'cancelled', 'aborted', 'internal', 'unknown', 'error'];
const FAILED_KEY = 'hel16s.failed';
let photoErr = '';
// data first, photos after: a photo that cannot upload never holds up ticks, tests or sign-offs
async function flush() {
  if (flushing || !S.db) return; flushing = true; updateHold();
  try {
    while (outbox.length) {
      const op = outbox[0], ref = S.db.doc(op.coll + '/' + op.board);
      try { await timeout(ref.update(op.data), 15000); }
      catch (e) {
        const code = (e && e.code) || 'error';
        if (code === 'invalid_argument') {
          const snap = await timeout(ref.get(), 15000);
          if (!snap.exists && (op.coll !== 'boards' || op.create)) await timeout(ref.set(merge({ board: op.board, colo: op.board.split('-')[0], circuits: {} }, op.data)), 15000);
          else { outbox.shift(); saveOutbox(); if (snap.exists) S.readOnly = true; toast(snap.exists ? 'Not saved: your access is view only.' : 'That board no longer exists.'); continue; }
        } else if (!TRANSIENT.includes(code)) {
          // a change the database refuses for good: park it so everything behind it still sends
          let failed = []; try { failed = JSON.parse(localStorage.getItem(FAILED_KEY) || '[]'); } catch (x) {}
          failed.push({ ...op, err: code, failedAt: Date.now() }); try { localStorage.setItem(FAILED_KEY, JSON.stringify(failed)); } catch (x) {}
          outbox.shift(); saveOutbox(); toast('One change could not be saved (' + code + '). Tell the site lead.'); continue;
        } else throw e;
      }
      if (op.ev) { try { await timeout(S.db.collection('events').doc(op.id).set(op.ev), 15000); } catch (e) {} }
      outbox.shift(); saveOutbox();
    }
    lastErr = '';
  } catch (e) { lastErr = (e && e.code) || 'offline'; }
  try {
    for (const p of heldPhotos.slice()) {
      if (!S.assets || lastErr) break;
      const res = await timeout(S.assets.upload(p.blob, { type: 'image/jpeg' }), 60000);
      outbox.push({ id: uid(), coll: p.coll, board: p.board, data: { circuits: { [p.ref]: { ph: { [res.id]: { t: p.tag, by: S.me.id, at: p.t, u: res.url || '' } } } } }, ev: { act: 'photo', k: p.tag, ref: p.ref, team: S.team, board: p.board, at: p.t, by: S.me.id }, t: p.t });
      saveOutbox(); await idbDel(p.key); heldPhotos.splice(heldPhotos.indexOf(p), 1); URL.revokeObjectURL(p.url);
    }
    photoErr = '';
  } catch (e) { photoErr = (e && e.code) || 'error'; }
  finally { flushing = false; updateHold(); render(); }
  if (outbox.length && !lastErr) setTimeout(flush, 500);   // photo records just queued
}
window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
setInterval(() => { if (outbox.length || heldPhotos.length) flush(); }, 15000);
const heldCount = () => outbox.length + heldPhotos.length;
document.getElementById('hold').addEventListener('click', () => { lastErr = ''; flush(); });
document.getElementById('hold').style.cursor = 'pointer';
function updateHold() {
  const el = document.getElementById('hold'), n = outbox.length, ph = heldPhotos.length, off = !navigator.onLine || (lastErr && n);
  el.className = 'hold' + (n || ph ? ' held' : '') + (off ? ' off' : '');
  const photos = ph ? (ph + ' photo' + (ph > 1 ? 's' : '') + ' kept on this phone' + (!S.assets ? ' (photo upload not switched on yet)' : '')) : '';
  el.querySelector('span').textContent = !S.db ? (S.failed ? 'Not connected' : 'Connecting')
    : n ? (off ? n + ' held on this phone · sends when signal returns' : flushing ? 'Sending ' + n + '…' : n + ' waiting to send · tap to send')
    : photos || 'All saved';
  el.title = 'Tap to send now';
}

/* ---------- shared data (server + anything still held on this phone) ---------- */
function layer(coll, board) {
  const src = coll === 'boards' ? S.boards : coll === 'tests' ? S.tests : S.qa;
  const base = clone(src[board] && src[board].circuits);
  outbox.filter(o => o.coll === coll && o.board === board && o.data.circuits).forEach(o => merge(base, clone(o.data.circuits)));
  return base;
}
function sheetOf(board) {
  const base = clone(S.tests[board] && S.tests[board].sheet);
  outbox.filter(o => o.coll === 'tests' && o.board === board && o.data.sheet).forEach(o => merge(base, clone(o.data.sheet)));
  return base;
}
// completion figures (site overview, area table, public progress page) count only the distribution boards:
// PNL01 + PNL02, ELP and NLP in the COLOs; every ADMIN board counts, as before. UPS, battery, ADP, MSB, UPM boards are left out.
const inStats = id => { const m = /^(COLO\d|ADMIN)-(?:CE\d-)?(.+)$/.exec(id || ''); if (!m) return false; const t = m[2];
  return m[1] === 'ADMIN' ? true : /^(PNL0[12]|ELP\d\d|NLP\d\d)$/.test(t); };
const boardList = () => Object.values(S.boards).sort((a, b) => (a.order - b.order) || a.board.localeCompare(b.board));
const phaseOf = c => { const m = /^L([123])/.exec(c.circ || ''); return /L123/.test(c.circ || '') ? 0 : m ? +m[1] : 1; };
function circuitsOf(b) {
  const reg = layer('boards', b.board), te = layer('tests', b.board), qa = layer('qa', b.board);
  return Object.entries(reg).filter(([, c]) => c && !c.deleted).map(([ref, c]) => {
    const x = { ref, board: b.board, cell: b.cell, area: b.area, ...c, st: c.st || {}, te: te[ref] || {}, qa: qa[ref] || {} };
    x.three = /L123|3P|TP/i.test((x.circ || '') + ' ' + (x.term || '')); x.phase = phaseOf(x);
    const cat = String(x.cat || '').toUpperCase(), t = String(x.dtype || '').trim().toUpperCase(), In = num(x.rating), k = { B: 5, C: 10, D: 20 }[t];
    x.rcd = /RCD|RCBO/.test(cat); x.zsMax = (k && In && /MCB|RCBO/.test(cat)) ? +(0.95 * 230 / (k * In)).toFixed(2) : null;
    return x;
  }).sort((p, q) => (p.seq || 0) - (q.seq || 0));
}
const isActive = c => (c.status || 'Active') === 'Active';
function findCircuit(ref) { for (const b of Object.values(S.boards)) if (b.circuits && b.circuits[ref] && !b.circuits[ref].deleted) return circuitsOf(b).find(c => c.ref === ref); return null; }

/* ---------- rules ---------- */
function preVerdict(c, p) {
  if (!p || !p.at) return 'none';
  const need = PRE.filter(f => f.need && f.need(c)).map(f => f.k);
  if (p.ring) need.push('rpp', 'rnn', 'ree');
  if (need.some(k => num(p[k]) === null) || !p.pol) return 'inc';
  if (PRE.some(f => f.ir && num(p[f.k]) !== null && num(p[f.k]) < IR_MIN)) return 'fail';
  return 'pass';
}
function postFields(c) { return c.three ? POST3 : [['v' + c.phase + 'n', 'V L' + c.phase + '–N', POST3.find(x => x[0] === 'v' + c.phase + 'n')[2]], ['v' + c.phase + 'g', 'V L' + c.phase + '–Gnd', POST3.find(x => x[0] === 'v' + c.phase + 'g')[2]], ['vne', 'V N–E', 'AG']]; }
function postVerdict(c, p) {
  if (!p || !p.at) return 'none';
  const need = (c.three ? ['v12','v13','v23'] : ['v' + c.phase + 'n']).concat(['zs']).concat(c.rcd ? ['rcd1'] : []);
  if (need.some(k => num(p[k]) === null) || (c.three && !p.rot)) return 'inc';
  if (c.zsMax && num(p.zs) > c.zsMax) return 'fail';
  if (c.rcd && (num(p.rcd1) > RCD_MAX || (num(p.rcd5) !== null && num(p.rcd5) > RCD5_MAX) || p.rcdh === 'trip')) return 'fail';
  if (c.three && p.rot === 'Wrong') return 'fail';
  return 'pass';
}
const termDone = q => q && q.c && TERM_CHECKS.every(([k]) => q.c[k]);
const labDone = q => q && q.c && LAB_CHECKS.every(([k]) => q.c[k]);
function signReqs(c) {
  return [
    ['Installers', 'Cable pulled', !!c.st.inst], ['Installers', 'Terminated at board', !!c.st.bt], ['Installers', 'Terminated at load', !!c.st.ft], ['Testers', 'Labelled', !!c.st.lab],
    ['Testers', 'Pre-connection test passed' + (impTested(c) && preVerdict(c, c.te.pre) !== 'pass' ? ' (tested before the app)' : ''), preVerdict(c, c.te.pre) === 'pass' || impTested(c)], ['Testers', 'Post-connection test passed' + (impTested(c) && postVerdict(c, c.te.post) !== 'pass' ? ' (tested before the app)' : ''), postVerdict(c, c.te.post) === 'pass' || impTested(c)],
    ['QA/QC', 'Board-end termination checked', !!termDone(c.qa.bt)], ['QA/QC', 'Field-end termination checked', !!termDone(c.qa.ft)], ['QA/QC', 'Labelling checked', !!labDone(c.qa.lab)],
  ];
}
const canSign = c => signReqs(c).every(r => r[2]);
// circuits marked Tested in the original Excel tracker (imported) count as tested; their certificates already exist on paper
const impTested = c => !!(c.st.te && c.st.te.imp) && !(c.te.pre && c.te.pre.at);
function qaState(c) { if (c.st.qa) return 'qa'; if (preVerdict(c, c.te.pre) === 'fail' || postVerdict(c, c.te.post) === 'fail') return 'fail'; return canSign(c) ? 'ready' : 'lock'; }

/* ---------- names / toast ---------- */
let nameReq = null;
function wantNames(ids) { if (!S.user) return; const miss = [...new Set(ids.filter(Boolean))].filter(id => !(id in S.names)); if (!miss.length || nameReq) return; nameReq = S.user.profiles(miss).then(ps => { Object.assign(S.names, ps); nameReq = null; render(); }).catch(() => { nameReq = null; }); }
let toastTimer;
function toast(msg, fn, label) {
  const h = document.getElementById('toastHost');
  h.innerHTML = '<div class="toast" role="status"><span>' + esc(msg) + '</span>' + (fn ? '<button id="tAct">' + esc(label || 'Undo') + '</button>' : '') + '</div>';
  if (fn) document.getElementById('tAct').onclick = () => { h.innerHTML = ''; fn(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => h.innerHTML = '', fn ? 6000 : 3500);
}

/* ---------- render ---------- */
function render() {
  updateHold();
  const T = TEAMS[S.team];
  document.getElementById('title').textContent = 'HEL16 · ' + COLO;
  const cs = document.getElementById('coloSel'); if (cs.dataset.v !== CODE) { cs.innerHTML = SITE.map(([c, l]) => '<option value="' + c + '"' + (c === CODE ? ' selected' : '') + '>' + l + '</option>').join(''); cs.dataset.v = CODE; }
  const tag = document.getElementById('teamtag'); tag.hidden = !T; if (T) tag.textContent = T.name;
  document.getElementById('tabs').innerHTML = T ? T.tabs.map(([k, l]) => '<button role="tab" data-v="' + k + '" aria-selected="' + (S.view === k) + '">' + l + '</button>').join('') + '<a class="home" href="#">All teams</a>' : '';
  const v = document.getElementById('view'), a = document.activeElement;
  if (a && v.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.id !== 'q') { renderSheet(); return; }
  if (!S.loaded) { v.innerHTML = S.failed ? '<div class="empty"><h2>The site data is not available here</h2><p>' + esc(S.failed) + '</p></div>' : '<div class="empty"><h2>Loading the HEL16 site</h2><p>Boards and circuits appear here once the shared site data loads.</p></div>'; renderSheet(); return; }
  const ro = S.readOnly ? '<div class="banner">View only. You can see progress but not record work. Ask the owner for Contributor access.</div>' : '';
  if (!T) v.innerHTML = viewLanding();
  else if (S.view === 'boards') v.innerHTML = ro + (S.board && S.boards[S.board] ? viewBoard() : viewBoards());
  else if (S.view === 'today') v.innerHTML = viewToday();
  else if (S.view === 'results') v.innerHTML = viewResults();
  else if (S.view === 'me') v.innerHTML = viewMe();
  else if (S.view === 'labels') v.innerHTML = viewLabels();
  else v.innerHTML = viewActivity();
  const q = document.getElementById('q'); if (q && S._qFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  renderSheet();
}

/* landing: choose a team + combined progress */
function viewLanding() {
  const all = boardList().filter(b => inStats(b.board)).flatMap(circuitsOf).filter(isActive), N = all.length;
  const cnt = f => all.filter(f).length;
  const cards = [['install','--t-install'],['test','--t-test'],['qa','--t-qa']].map(([k, c]) => '<a class="tcard" href="#' + k + '" style="--c:var(' + c + ')"><h2>' + TEAMS[k].name + '</h2><p>' + TEAMS[k].blurb + '</p><span class="go">Open the ' + TEAMS[k].name + ' app →</span></a>').join('');
  const sb = S.scanBoard && S.boards[S.scanBoard];
  const scanned = S.scanBoard ? '<section class="panel" style="border-top:6px solid var(--hivis)"><h3>Board ' + esc(S.scanBoard) + '</h3>' + (sb ? '<p class="by" style="margin:0">' + esc(sb.area || '') + ' · open it as:</p><div class="tools">' + [['install','Installers'],['test','Testers'],['qa','QA/QC']].map(([k, l]) => '<a class="btn team" style="text-decoration:none;background:var(--t-' + k + ');border-color:var(--t-' + k + ');color:' + (k === 'install' ? '#1a1f25' : '#fff') + '" href="#' + k + '.' + esc(S.scanBoard) + '">' + l + '</a>').join('') + '</div>' : '<p class="by" style="margin:0">This board is not in the tracker. Check with the site lead.</p>') + '</section>' : '';
  const flow = '<div class="flow"><b>Installers</b> pull and terminate → <b>Testers</b> pre- and post-connection tests (a pass ticks "Tested") and labelling → <b>QA/QC</b> inspects and signs off, only once everything before it is complete.</div>';
  const cols = [['Pulled', c => c.st.inst], ['Board term', c => c.st.bt], ['Field term', c => c.st.ft], ['Tested', c => c.st.te], ['Labelled', c => c.st.lab], ['Post-test pass', c => postVerdict(c, c.te.post) === 'pass'], ['QA signed', c => c.st.qa]];
  let rows = '';
  cellsOf().forEach(cell => { const cs = all.filter(c => c.cell === cell); if (!cs.length) return;
    rows += '<tr><td>' + cellLabel(cell) + '</td><td>' + cs.length + '</td>' + cols.map(([, f]) => '<td>' + pct(cs.filter(f).length, cs.length) + '%</td>').join('') + '</tr>'; });
  rows += '<tr class="tot"><td>' + COLO + '</td><td>' + N + '</td>' + cols.map(([, f]) => '<td>' + pct(cnt(f), N) + '%</td>').join('') + '</tr>';
  const fails = cnt(c => preVerdict(c, c.te.pre) === 'fail' || postVerdict(c, c.te.post) === 'fail');
  // site overview: every area, loaded once on demand (the team apps only load the area in use)
  let site;
  if (!S.site) { if (!S.siteLoading) loadSite(); site = '<p class="by" style="margin:0">Loading every area…</p>'; }
  else {
    const srow = (label, o, code) => '<tr' + (code ? ' class="click" data-colo="' + code + '"' : ' class="tot"') + '><td>' + label + '</td><td>' + o.n + '</td>' + ['inst','bt','ft','te','lab','post','qa'].map(k => '<td>' + pct(o[k], o.n) + '%</td>').join('') + '<td>' + (o.fail ? '<span class="chip fail">' + o.fail + '</span>' : '0') + '</td></tr>';
    const tot = { n: 0, inst: 0, bt: 0, ft: 0, te: 0, lab: 0, post: 0, qa: 0, fail: 0 };
    SITE.forEach(([c]) => { const o = S.site[c]; if (o) Object.keys(tot).forEach(k => tot[k] += o[k]); });
    site = '<div class="scroll"><table><thead><tr><th>Area</th><th>Active</th>' + cols.map(([l]) => '<th>' + l + '</th>').join('') + '<th>Failed</th></tr></thead><tbody>' +
      SITE.filter(([c]) => S.site[c]).map(([c, l]) => srow(l, S.site[c], c)).join('') + srow('HEL16 site', tot) + '</tbody></table></div>' +
      '<div class="tools"><span class="by">Tap an area to open it. Loaded ' + new Date(S.siteAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '.</span><button class="btn" data-siteload>Refresh</button></div>';
  }
  return scanned + '<section class="panel"><div class="ph"><h3>HEL16 site progress, all areas</h3></div>' + site + '</section>' +
    '<section class="panel"><h3>Choose your team · ' + COLO + '</h3><div class="teams">' + cards + '</div>' + flow + '<p class="by" style="margin:0">Change area with the selector at the top. Each team app opens the area shown there.</p></section>' +
    '<section class="panel"><div class="ph"><h3>' + COLO + ' progress, all teams</h3>' + (fails ? '<span class="chip fail">' + fails + ' failed tests</span>' : '') + '</div><div class="scroll"><table><thead><tr><th>Cell</th><th>Active</th>' + cols.map(([l]) => '<th>' + l + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
}
async function loadSite() {
  if (!S.db) return; S.siteLoading = true;
  try {
    const [bs, ts] = await Promise.all([S.db.collection('boards').limit(1000).get(), S.db.collection('tests').limit(1000).get()]);
    const tests = {}; ts.docs.forEach(d => tests[d.id] = d.data());
    const out = {};
    bs.docs.forEach(d => { const b = d.data(); if (b.retired || !inStats(d.id)) return; const code = b.colo || d.id.split('-')[0], o = out[code] = out[code] || { n: 0, inst: 0, bt: 0, ft: 0, te: 0, lab: 0, post: 0, qa: 0, fail: 0 };
      const tc = (tests[d.id] && tests[d.id].circuits) || {};
      Object.entries(b.circuits || {}).forEach(([ref, c]) => { if (!c || c.deleted || (c.status || 'Active') !== 'Active') return;
        const st = c.st || {}, x = { ...c, circ: c.circ, term: c.term, st }, t = tc[ref] || {};
        x.three = /L123|3P|TP/i.test((c.circ || '') + ' ' + (c.term || '')); x.phase = phaseOf(x);
        const cat = String(c.cat || '').toUpperCase(), ty = String(c.dtype || '').trim().toUpperCase(), In = num(c.rating), k = { B: 5, C: 10, D: 20 }[ty];
        x.rcd = /RCD|RCBO/.test(cat); x.zsMax = (k && In && /MCB|RCBO/.test(cat)) ? +(0.95 * 230 / (k * In)).toFixed(2) : null;
        const pv = preVerdict(x, t.pre), qv = postVerdict(x, t.post);
        o.n++; ['inst','bt','ft','te','lab','qa'].forEach(s => { if (st[s]) o[s]++; }); if (qv === 'pass') o.post++; if (pv === 'fail' || qv === 'fail') o.fail++; });
    });
    S.site = out; S.siteAt = Date.now();
    const all = {}; bs.docs.forEach(d => all[d.id] = d.data()); publishProgress(all);
  } catch (e) { toast('Could not load the site overview. Check your signal and tap Refresh.'); S.site = S.site || {}; S.siteAt = Date.now(); }
  finally { S.siteLoading = false; render(); }
}
/* ---------- public progress: overall figures per board, readable without signing in (progress.html) ---------- */
const PUB_KEY = 'hel16.pub';
let pubSent = {}; try { pubSent = JSON.parse(localStorage.getItem(PUB_KEY) || '{}'); } catch (e) {}
function publishProgress(map) {
  if (!S.db || S.readOnly || !navigator.onLine) return;
  Object.entries(map || {}).forEach(([id, b]) => {
    if (b && (b.retired || !inStats(id))) { if (pubSent[id] !== 'retired') S.db.doc('progress/' + id).delete().then(() => { pubSent[id] = 'retired'; try { localStorage.setItem(PUB_KEY, JSON.stringify(pubSent)); } catch (e) {} }, () => {}); return; }
    if (!b || !b.circuits) return;
    const t = { n: 0, s: [0, 0, 0, 0, 0, 0], blk: 0 };
    Object.values(b.circuits).forEach(c => { if (!c || c.deleted || (c.status || 'Active') !== 'Active') return; const st = c.st || {};
      t.n++; if (c.blocker) t.blk++; ['inst', 'bt', 'ft', 'te', 'lab', 'qa'].forEach((k, i) => { if (st[k]) t.s[i]++; }); });
    const j = JSON.stringify({ b: id, c: b.colo || id.split('-')[0], cell: b.cell || '', area: b.area || '', o: b.order || 0, t });
    if (pubSent[id] === j) return;
    S.db.doc('progress/' + id).set({ colo: b.colo || id.split('-')[0], at: Date.now(), j }).then(() => { pubSent[id] = j; try { localStorage.setItem(PUB_KEY, JSON.stringify(pubSent)); } catch (e) {} }, () => {});
  });
}
let unsubs = [];
function subscribe() {
  unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = [];
  S.boards = {}; S.tests = {}; S.qa = {}; S.loaded = false; render();
  const db = S.db; if (!db) return;
  const sub = (coll, key, after) => unsubs.push(db.collection(coll).where('colo', '==', CODE).limit(500).onSnapshot(snap => { const n = {}; snap.docs.forEach(d => { const x = d.data(); if (!(coll === 'boards' && x && x.retired)) n[d.id] = x; }); S[key] = n; if (after) after(); render(); }, err => { if (coll === 'boards') { S.failed = 'The site data stopped updating (' + err.code + '). Reload the page to reconnect.'; S.loaded = false; render(); } }));
  sub('boards', 'boards', () => { S.loaded = true; publishProgress(S.boards); if (!cellsOf().includes(S.cell)) S.cell = cellsOf()[0];
    if (S.pendingRef) { const c = findCircuit(S.pendingRef); if (c) { S.board = c.board; S.cell = c.cell; S.pendingRef = null; setTimeout(() => openSheet(c.ref), 0); } } });
  sub('tests', 'tests'); sub('qa', 'qa');
}
function switchColo(code) {
  if (code === CODE) return;
  setColo(code); closeSheet(); S.board = null; S.cell = null; S.view = 'boards';
  if (location.hash.slice(1).split('.')[0] && S.team) history.replaceState(null, '', '#' + S.team);
  subscribe(); window.scrollTo(0, 0);
}
document.getElementById('coloSel').addEventListener('change', e => { switchColo(e.target.value); e.target.blur(); });

/* board grid per team */
function teamLadder(cs) {
  const act = cs.filter(isActive), n = act.length;
  let items;
  if (S.team === 'install') items = INSTALL.map(s => [s.s, act.filter(c => c.st[s.k]).length]);
  else if (S.team === 'test') items = [['PRE', act.filter(c => preVerdict(c, c.te.pre) === 'pass').length], ['POST', act.filter(c => postVerdict(c, c.te.post) === 'pass').length], ['LAB', act.filter(c => c.st.lab).length], ['READY', act.filter(c => c.st.inst).length]];
  else items = [['BT', act.filter(c => termDone(c.qa.bt)).length], ['FT', act.filter(c => termDone(c.qa.ft)).length], ['LAB', act.filter(c => labDone(c.qa.lab)).length], ['QA', act.filter(c => c.st.qa).length]];
  return '<div class="ladder" style="--n:' + items.length + '">' + items.map(([l, d]) => '<div class="rung"><span class="lbl">' + l + '</span><div class="bar"><i style="width:' + pct(d, n) + '%;background:' + (l === 'QA' ? 'var(--t-qa)' : 'var(--done)') + '"></i></div><span class="v">' + d + '/' + n + '</span></div>').join('') + '</div>';
}
function viewBoards() {
  const seg = '<div class="seg" role="group" aria-label="Cell">' + cellsOf().map(c => '<button data-cell="' + c + '" aria-pressed="' + (S.cell === c) + '">' + cellLabel(c) + '</button>').join('') + '</div>';
  const cards = boardList().filter(b => b.cell === S.cell).map(b => {
    const cs = circuitsOf(b), act = cs.filter(isActive), fails = act.filter(c => preVerdict(c, c.te.pre) === 'fail' || postVerdict(c, c.te.post) === 'fail').length;
    const held = outbox.filter(x => x.board === b.board).length + heldPhotos.filter(p => p.board === b.board).length;
    const blocked = act.filter(c => c.blocker).length;
    return '<button class="bcard" data-board="' + esc(b.board) + '"><div class="bh"><span class="bn">' + esc(b.board.replace(SHORT(), '')) + '</span></div><span class="ba">' + esc(b.area) + ' · ' + act.length + ' active circuits</span>' + teamLadder(cs) +
      '<div class="tools">' + (fails && S.team !== 'install' ? '<span class="chip fail">' + fails + ' failed</span>' : '') + (blocked && S.team === 'install' ? '<span class="chip block">' + blocked + ' blocked</span>' : '') + (held ? '<span class="chip held">' + held + ' held</span>' : '') + '</div></button>';
  }).join('');
  const add = (S.canEdit && !S.readOnly && S.team !== 'test') ? '<div class="tools"><button class="btn" data-addboard>+ Add board</button><span class="by">Editors only. New boards appear in all three team apps.</span></div>' : '';
  return seg + '<div class="boards">' + cards + '</div>' + add;
}
function othersChips(c) {
  const ch = [];
  if (S.team !== 'install') ch.push(...INSTALL.map(s => ['' + s.s, c.st[s.k] ? 'on' : '']));
  if (S.team !== 'test') ch.push([LABEL.s, c.st.lab ? 'on' : '']);
  if (S.team !== 'test') { const imp = impTested(c), p = imp ? 'pass' : preVerdict(c, c.te.pre), q = imp && !c.te.post ? 'pass' : postVerdict(c, c.te.post); ch.push(['PRE', p === 'pass' ? 'on' : p === 'fail' ? 'fail' : ''], ['POST', q === 'pass' ? 'on' : q === 'fail' ? 'fail' : '']); }
  if (S.team !== 'qa') ch.push(['QA', c.st.qa ? 'on' : '']);
  return '<span class="others">' + ch.map(([l, k]) => '<b class="' + k + '">' + l + '</b>').join('') + '</span>';
}
// the reference shown on a circuit: its drawing ref where one is recorded, else the tracker's own ref
// ELP boards keep the tracker's own ref
const refLabel = c => (c.drw && !/-ELP\d/.test(c.board || '')) ? 'Dwg ' + c.drw : c.ref;
function stageBtn(c, s) {
  const v = c.st[s.k], now = v && v.d === todayIso();
  return '<button class="sbtn' + (v ? ' on' : '') + (now ? ' now' : '') + '" data-stage="' + s.k + '" data-ref="' + esc(c.ref) + '"' + (S.readOnly ? ' disabled' : '') + ' aria-label="' + s.l + (v ? ' done ' + fmtDMY(v.d) : ' not done') + '"><span class="k">' + s.s + '</span><span class="d">' + (v ? fmtDM(v.d) : '—') + '</span></button>';
}
function rowHtml(c) {
  const info = '<button class="cinfo" data-open="' + esc(c.ref) + '"><span class="r1"><span class="circ">' + esc(c.circ || c.dev || '#' + c.seq) + '</span><span class="ref">' + esc(refLabel(c)) + (c.dev ? ' · ' + esc(c.dev) : '') + '</span>' + (c.blocker ? '<span class="chip block">' + esc(c.blocker) + '</span>' : '') + (c.qa && c.qa.note && c.qa.note.t ? '<span class="chip part">QA comment</span>' : '') + '</span><span class="desc">' + esc(c.desc) + '</span>' + othersChips(c) + '</button>';
  if (!isActive(c)) return '<div class="crow inactive">' + info + '<span class="chip">' + esc(c.status) + '</span></div>';
  let btns = '', cls = '';
  if (S.team === 'install') {
    btns = INSTALL.map(s => stageBtn(c, s)).join('');
    cls = c.blocker ? ' blocked' : '';
  } else if (S.team === 'test') {
    const p = preVerdict(c, c.te.pre), q = postVerdict(c, c.te.post);
    const b = (k, l, v) => '<button class="sbtn ' + (v === 'pass' ? 'on' : v === 'fail' ? 'fail' : v === 'inc' ? 'part' : '') + '" data-test="' + k + '" data-ref="' + esc(c.ref) + '"><span class="k">' + l + '</span><span class="d">' + ({ pass: 'pass', fail: 'FAIL', inc: 'part', none: '—' })[v] + '</span></button>';
    btns = (impTested(c) && p === 'none' ? '<button class="sbtn on" data-test="pre" data-ref="' + esc(c.ref) + '" title="Marked tested in the original tracker"><span class="k">PRE</span><span class="d">imported</span></button>' : b('pre', 'PRE', p)) + b('post', 'POST', q) + stageBtn(c, LABEL); cls = (p === 'fail' || q === 'fail') ? ' failed' : '';
  } else {
    const st = qaState(c), d = c => ['bt','ft','lab'].map(k => [k, k === 'lab' ? labDone(c.qa[k]) : termDone(c.qa[k])]);
    btns = d(c).map(([k, ok]) => '<button class="sbtn' + (ok ? ' on' : '') + '" data-open="' + esc(c.ref) + '"><span class="k">' + k.toUpperCase() + '</span><span class="d">' + (ok ? 'checked' : '—') + '</span></button>').join('') +
      '<button class="sbtn ' + st + '" data-open="' + esc(c.ref) + '"><span class="k">QA</span><span class="d">' + ({ qa: c.st.qa ? fmtDM(c.st.qa.d) : '', ready: 'ready', lock: 'locked', fail: 'test fail' })[st] + '</span></button>';
    cls = st === 'fail' ? ' failed' : st === 'qa' ? ' signed' : '';
  }
  return '<div class="crow' + cls + '">' + info + '<div class="steps">' + btns + '</div></div>';
}
function filtered(b) {
  const q = S.q.trim().toLowerCase();
  return circuitsOf(b).filter(c => {
    if (q && !(c.ref + ' ' + c.circ + ' ' + c.desc + ' ' + c.dev + ' ' + c.term + ' ' + (c.drw || '')).toLowerCase().includes(q)) return false;
    if (S.filter === 'todo') return isActive(c) && (S.team === 'install' ? INSTALL.some(s => !c.st[s.k]) : S.team === 'test' ? (preVerdict(c, c.te.pre) !== 'pass' || postVerdict(c, c.te.post) !== 'pass' || !c.st.lab) : !c.st.qa);
    if (S.filter === 'fail') return preVerdict(c, c.te.pre) === 'fail' || postVerdict(c, c.te.post) === 'fail';
    return true;
  });
}
const listHtml = b => { const r = filtered(b); return r.length ? r.map(rowHtml).join('') : '<div class="empty">No circuits match.</div>'; };
function viewBoard() {
  const b = S.boards[S.board], cs = circuitsOf(b), act = cs.filter(isActive);
  const fl = [['all','All'],['todo','Not finished']].concat(S.team !== 'install' ? [['fail','Failed']] : []);
  let extra = '';
  if (S.team === 'test') {
    const sh = sheetOf(b.board), hdrOk = sh.fed && sh.preA && sh.preA.name;
    extra = '<section class="panel"><div class="ph"><h3>Test record sheet</h3><div class="tools"><button class="btn team" data-sheethdr>' + (hdrOk ? 'Edit sheet details' : 'Fill in sheet details') + '</button>' + (S.downloads ? '<button class="btn" data-certcsv>Download sheet (CSV)</button>' : '') + '</div></div>' +
      '<div class="kv"><div><span>Panel no.</span>HEL16-' + esc(b.board) + '</div><div><span>Fed from</span>' + esc(sh.fed || '—') + '</div><div><span>Protective device</span>' + esc(sh.dev || '—') + '</div><div><span>Supply cable</span>' + esc(sh.cable || '—') + '</div><div><span>Pre-connection tester A</span>' + esc((sh.preA && sh.preA.name) || '—') + '</div><div><span>Test kit</span>' + esc([sh.make, sh.model, sh.serial].filter(Boolean).join(' ') || '—') + '</div></div>' +
      '<p style="margin:0;font-size:13px;color:var(--muted)">These details go on the board test certificate. Your name, QC no. and test kit from <b>My details</b> are filled in automatically the first time you save a test on this board.</p></section>';
  }
  return '<div class="bhead"><button class="back" data-back>← Cell ' + esc(b.cell.slice(2)) + ' boards</button><h2>' + esc(b.board) + '</h2><span class="ba">' + esc(b.area) + ' · ' + act.length + ' active circuits</span>' + teamLadder(cs) +
    '<div class="tools"><input type="search" id="q" placeholder="Search circuit, drawing ref, device or description" value="' + esc(S.q) + '" aria-label="Search circuits"><div class="seg" role="group" aria-label="Filter">' + fl.map(([k, l]) => '<button data-filter="' + k + '" aria-pressed="' + (S.filter === k) + '">' + l + '</button>').join('') + '</div></div></div>' +
    extra + '<div class="clist" id="list">' + listHtml(b) + '</div>' +
    ((S.canEdit && !S.readOnly && S.team !== 'test') ? '<div class="tools"><button class="btn" data-addc="' + esc(b.board) + '">+ Add circuit to ' + esc(b.board.replace(SHORT(), '')) + '</button><span class="by">Editors only. Tap a circuit to edit or delete it. Changes show in all three team apps.</span></div>' : '');
}

/* installers: today */
function viewToday() {
  const d = todayIso(), all = boardList().flatMap(circuitsOf).filter(isActive);
  const rows = boardList().map(b => { const cs = all.filter(c => c.board === b.board); return [b.board, INSTALL.map(s => cs.filter(c => c.st[s.k] && c.st[s.k].d === d).length)]; }).filter(([, n]) => n.some(Boolean));
  const tot = INSTALL.map((s, i) => rows.reduce((a, r) => a + r[1][i], 0));
  return '<section class="panel"><h3>Done today · ' + new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + '</h3><div class="scroll"><table><thead><tr><th>Board</th>' + INSTALL.map(s => '<th>' + s.s + '</th>').join('') + '</tr></thead><tbody>' +
    (rows.length ? rows.map(([b, n]) => '<tr><td>' + esc(b.replace(SHORT(), '')) + '</td>' + n.map(x => '<td' + (x ? '' : ' class="z"') + '>' + x + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="5" style="text-align:left;color:var(--muted)">Nothing recorded yet today.</td></tr>') +
    '<tr class="tot"><td>Total</td>' + tot.map(x => '<td>' + x + '</td>').join('') + '</tr></tbody></table></div></section>';
}

/* testers & QA: results */
function viewResults() {
  const opts = '<option value="all">All boards</option>' + boardList().map(b => '<option value="' + esc(b.board) + '"' + (S.resBoard === b.board ? ' selected' : '') + '>' + esc(b.board) + '</option>').join('');
  const all = boardList().filter(b => S.resBoard === 'all' || b.board === S.resBoard).flatMap(circuitsOf).filter(isActive);
  const tested = all.filter(c => c.te.pre || c.te.post);
  wantNames(tested.flatMap(c => [c.te.pre && c.te.pre.by, c.te.post && c.te.post.by]));
  const v = x => ({ pass: 'Pass', fail: 'FAIL', inc: 'Part', none: '—' })[x];
  const rows = tested.map(c => { const p = c.te.pre || {}, q = c.te.post || {}, pv = preVerdict(c, c.te.pre), qv = postVerdict(c, c.te.post), low = x => num(x) !== null && num(x) < IR_MIN ? ' class="bad"' : '';
    return '<tr class="click" data-open="' + esc(c.ref) + '"><td>' + esc(c.ref) + '</td><td class="l">' + esc((c.desc || '').slice(0, 34)) + '</td><td>' + esc(p.r12 || '') + '</td><td' + low(p.irpn) + '>' + esc(p.irpn || '') + '</td><td' + low(p.irpne) + '>' + esc(p.irpne || '') + '</td><td>' + (p.pol ? '✓' : p.at ? '✗' : '') + '</td><td' + (pv === 'fail' ? ' class="bad"' : '') + '>' + v(pv) + '</td><td>' + esc(q.zs || '') + '</td><td>' + esc(q.rcd1 || '') + '</td><td' + (qv === 'fail' ? ' class="bad"' : '') + '>' + v(qv) + '</td><td class="l">' + esc(nameOf((c.te.pre || c.te.post || {}).by)) + '</td></tr>'; }).join('');
  const fails = all.filter(c => preVerdict(c, c.te.pre) === 'fail' || postVerdict(c, c.te.post) === 'fail').length;
  return '<section class="panel"><div class="ph"><h3>Test results</h3><select class="sel" id="resBoard" aria-label="Board">' + opts + '</select></div>' +
    '<div class="tools"><span class="chip ok">' + all.filter(c => preVerdict(c, c.te.pre) === 'pass').length + ' pre passed</span><span class="chip ok">' + all.filter(c => postVerdict(c, c.te.post) === 'pass').length + ' post passed</span><span class="chip fail">' + fails + ' failed</span><span class="chip">' + (all.length - tested.length) + ' not tested</span></div>' +
    '<div class="scroll"><table><thead><tr><th>Ref</th><th class="l">Description</th><th>R1+R2 Ω</th><th>IR P-N</th><th>IR P+N-E</th><th>Pol</th><th>Pre</th><th>Zs Ω</th><th>RCD ms</th><th>Post</th><th class="l">Tester</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="11" style="text-align:left;color:var(--muted)">No test results recorded yet.</td></tr>') + '</tbody></table></div></section>';
}
function viewMe() {
  const f = (k, l, hint) => '<div class="fld"><label for="me_' + k + '">' + l + '</label><input id="me_' + k + '" value="' + esc(ME[k] || '') + '">' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
  return '<section class="panel"><h3>My details</h3><p style="margin:0;color:var(--muted);font-size:14px">Saved on this phone only. They are filled into each test record sheet you work on, as Tester A, with today’s date.</p>' +
    '<div class="grid2">' + f('name', 'Tester name') + f('qc', 'QC no.') + f('make', 'Test kit manufacturer') + f('model', 'Model no.', 'e.g. MFT 1721') + f('serial', 'Serial no.') + f('cal', 'Calibration expiry', 'dd/mm/yyyy') +
    '<div class="fld"><label for="me_cable">Usual cable type</label><select id="me_cable">' + CABLE_TYPES.map(x => '<option' + (ME.cable === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div></div>' +
    '<div class="tools"><button class="btn team" data-saveme>Save my details</button></div></section>';
}
const VIEW_URL = APP_URL.replace(/[^/]*$/, '') + 'progress.html';   // board QR codes open the public progress page at that board; crew tap through to the app
const qrSvg = t => { if (typeof qrcode !== 'function') return ''; const q = qrcode(0, 'M'); q.addData(t); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); };
function viewLabels() {
  if (!APP_URL || APP_URL.startsWith('__')) return '<div class="empty"><h2>QR labels are not set up yet</h2></div>';
  const card = b => '<div class="qrcard">' + qrSvg(VIEW_URL + '#' + b.board) + '<b>' + esc(b.board) + '</b><small>Scan to view progress · ' + esc(b.area) + '</small></div>';
  return '<section class="panel"><div class="ph"><h3>Board QR labels</h3>' + (S.downloads ? '<button class="btn team" data-labels>Download printable label sheet</button>' : '') + '</div>' +
    '<p style="margin:0;color:var(--muted);font-size:14px">Each board gets one code. Anyone who scans it, including client reps, sees that board’s overall progress without signing in. Site team members then tap Installers, Testers or QA/QC to open the board in the tracker.</p>' +
    '<div class="qrgrid">' + boardList().slice(0, 6).map(card).join('') + '</div><p style="margin:0;color:var(--muted);font-size:13px">Showing the first six boards. The download has every board.</p></section>';
}
function viewActivity() {
  const evs = S.events.filter(e => (e.board || '').startsWith(CODE + '-')).filter(e => !S.team || e.team === S.team || e.k === 'qa' || e.k === 'te' || ['added','edited','deleted','restored','board','schedule'].includes(e.act));
  wantNames(evs.map(e => e.by));
  if (!evs.length) return '<div class="empty"><h2>No activity yet</h2><p>Work recorded by this team shows here with who did it and when.</p></div>';
  const lbl0 = { added: 'added circuit', edited: 'edited circuit details', deleted: 'deleted circuit', restored: 'restored circuit', board: 'added board' };
  const lbl = { inst: 'cable pulled', bt: 'board termination', ft: 'field termination', lab: 'labelled', te: 'Tested (from test pass)', qa: 'QA/QC sign-off', pre: 'pre-connection test', post: 'post-connection test', sheet: 'test sheet details' };
  const verb = e => ({ done: 'marked ' + (lbl[e.k] || e.k), clear: 'cleared ' + (lbl[e.k] || e.k), test: 'saved ' + (lbl[e.k] || 'test') + (e.v ? ' (' + e.v + ')' : ''), check: 'completed the ' + (lbl[e.k] || e.k) + ' check', photo: 'added a photo', sign: 'signed off', unsign: 'withdrew sign-off', blocker: e.v ? 'flagged ' + e.v : 'cleared the blocker', note: 'updated the note', schedule: 'updated the board schedule' + (e.v ? ': ' + e.v : ''), qanote: e.v ? 'added a QA/QC comment: ' + e.v : 'cleared the QA/QC comment' })[e.act] || lbl0[e.act] || 'updated';
  return '<section class="panel"><h3>Latest activity</h3><div class="feed">' + evs.map(e => '<div class="ev"><div class="t"><b>' + esc(nameOf(e.by)) + '</b> ' + esc(verb(e)) + ' · ' + esc((e.board || '').replace(SHORT(), '')) + ' ' + esc(e.ref || '') + ' <span class="chip">' + esc((TEAMS[e.team] || {}).name || '') + '</span></div><span class="w">' + ago(e.at) + '</span></div>').join('') + '</div></section>';
}

/* ---------- sheets ---------- */
function photoStrip(c, coll, tag) {
  const rec = coll === 'qa' ? c.qa : coll === 'tests' ? c.te : c;
  const saved = Object.entries((rec && rec.ph) || {}).filter(([, p]) => p.t === tag).map(([id, p]) => ({ src: p.u || ('/_blob/' + id), ...p }));
  const held = heldPhotos.filter(p => p.ref === c.ref && p.tag === tag && p.coll === coll).map(p => ({ src: p.url, t: p.tag, by: S.me.id, at: p.t, held: true }));
  return '<div class="photos">' + saved.concat(held).map(p => '<span class="thumbwrap"><img class="thumb" alt="Photo" src="' + esc(p.src) + '" data-view="' + esc(p.src) + '" data-cap="' + esc(nameOf(p.by)) + ' · ' + esc(ago(p.at)) + '">' + (p.held ? '<span class="chip held">held</span>' : '') + '</span>').join('') +
    ((S.assets && !S.readOnly) ? '<button class="addph" data-photo="' + coll + '|' + tag + '">+ Photo</button>' : '') + '</div>';
}
const byLine = q => q && q.at ? 'By ' + esc(nameOf(q.by)) + ' · ' + esc(fmtDMY(q.d)) : 'Not recorded yet';
const qaNoteBanner = c => (S.team !== 'qa' && c.qa && c.qa.note && c.qa.note.t) ? '<div class="banner warn"><b>QA/QC comment:</b> ' + esc(c.qa.note.t) + ' <span class="by">(' + esc(nameOf(c.qa.note.by)) + ' · ' + esc(fmtDMY(c.qa.note.d)) + ')</span></div>' : '';
const kvOf = c => qaNoteBanner(c) + '<div class="kv">' + [['Board', c.board], ['Device', c.dev], ['Terminal', c.term], ['E-box', c.ebox], ['Cable', c.size ? c.size + ' mm²' : ''], ['Points', c.elem], ['Protection', [c.cat, c.dtype, c.rating].filter(Boolean).join(' ')]].filter(x => x[1]).map(x => '<div><span>' + esc(x[0]) + '</span>' + esc(x[1]) + '</div>').join('') + '</div>';
function sheetInstall(c) {
  const ro = S.readOnly ? ' disabled' : '';
  return kvOf(c) + '<section class="step"><div class="sth"><h3>Stages</h3></div>' + stageList(c, INSTALL) + '</section>' +
    INSTALL_SHEET_REST(c, ro);
}
function stageList(c, list) {
  const ro = S.readOnly ? ' disabled' : '';
  return '<div class="req">' + list.map(s => { const v = c.st[s.k];
      return '<div class="' + (v ? 'y' : 'n') + '"><i>' + (v ? '✓' : '·') + '</i><span>' + s.l + '</span><small>' + (v ? (v.imp ? 'imported ' : '') + fmtDMY(v.d) + (v.by ? ' · ' + esc(nameOf(v.by)) : '') : '') + '</small>' + (v ? '<button class="btn danger" style="margin-left:auto;min-height:34px;padding:4px 10px" data-clear="' + s.k + '"' + ro + '>Clear</button>' : '<button class="btn team" style="margin-left:auto;min-height:34px;padding:4px 10px" data-mark="' + s.k + '"' + ro + '>Done today</button>') + '</div>'; }).join('') + '</div>';
}
function INSTALL_SHEET_REST(c, ro) {
  return '<section class="step"><div class="sth"><h3>Termination photos (optional)</h3></div>' + photoStrip(c, 'boards', 'install') + '</section>' +
    '<section class="step"><div class="grid2"><div class="fld"><label for="i_block">Blocker</label><select id="i_block"' + ro + '><option value="">None</option>' + BLOCKERS.map(x => '<option' + (c.blocker === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div></div>' +
    '<div class="fld"><label for="i_note">Notes</label><textarea id="i_note"' + ro + '>' + esc(c.note || '') + '</textarea></div><div class="tools"><button class="btn primary" data-savenote' + ro + '>Save note</button></div></section>';
}
function testForm(c, kind) {
  const ro = S.readOnly ? ' disabled' : '';
  const p = c.te[kind] || {}, val = k => p[k] ?? '';
  // opts.q: one-tap values shown under the field (">999" for insulation readings, "N/A" where a reading does not apply)
  const inp = (k, l, col, opts = {}) => '<div class="fld"><label for="t_' + k + '">' + l + ' <span class="col">' + col + '</span></label><input id="t_' + k + '" inputmode="decimal" value="' + esc(val(k)) + '"' + (opts.bad ? ' class="bad"' : '') + ro + '>' +
    (opts.q && !S.readOnly ? '<span class="quick">' + opts.q.map(x => '<button type="button" data-quick="t_' + k + '" data-val="' + esc(x) + '">' + esc(x) + '</button>').join('') + '</span>' : '') +
    (opts.hint ? '<span class="hint">' + opts.hint + '</span>' : '') + '</div>';
  const IRQ = ['>999'], NA = ['N/A'], IRNA = ['>999', 'N/A'];
  const warn = kind === 'pre' ? (!c.st.inst ? 'The installers have not marked this cable as pulled yet.' : '') : (!(c.st.bt && c.st.ft) ? 'The installers have not marked both ends as terminated yet.' : '');
  let body = '';
  if (kind === 'pre') {
    const low = k => num(p[k]) !== null && num(p[k]) < IR_MIN;
    body = '<div class="grid2"><div class="fld"><label for="t_cable">Cable type <span class="col">H</span></label><select id="t_cable"' + ro + '>' + [...new Set([c.te.cable, c.ctype, ...CABLE_TYPES].filter(Boolean))].map(x => '<option' + ((c.te.cable || c.ctype || ME.cable) === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div>' +
      inp('r12', 'Continuity R1+R2 (P+E) Ω', 'N') + inp('r2', 'R2 (E) Ω', 'O', { hint: 'Optional', q: NA }) + '</div>' +
      '<label class="chk"><input type="checkbox" id="t_ring"' + (p.ring ? ' checked' : '') + ro + '><span>Ring circuit (records P–P, N–N, E–E)</span></label>' +
      '<div class="grid2" id="ringf"' + (p.ring ? '' : ' hidden') + '>' + inp('rpp', 'Ring P–P Ω', 'P') + inp('rnn', 'Ring N–N Ω', 'Q') + inp('ree', 'Ring E–E Ω', 'R') + '</div>' +
      (S.readOnly ? '' : '<div class="tools"><button type="button" class="btn" data-allir>Set all IR readings to &gt;999</button></div>') +
      '<div class="grid2">' + inp('irpn', 'IR P–N MΩ', 'S', { bad: low('irpn'), q: IRQ }) + inp('irpne', 'IR P+N–E MΩ', 'T', { bad: low('irpne'), q: IRQ }) + (c.three ? inp('irppp', 'IR P1P2P3+N–E MΩ', 'U', { bad: low('irppp'), q: IRQ }) : '') + inp('irbus', 'IR busbar to open MCB MΩ', 'V', { hint: 'Optional', bad: low('irbus'), q: IRNA }) + '</div>' +
      '<label class="chk"><input type="checkbox" id="t_pol"' + (p.pol ? ' checked' : '') + ro + '><span>Polarity correct <span class="col">W</span></span></label>' +
      '<p class="hint" style="margin:0;font-size:12px;color:var(--muted)">Pass needs continuity, every insulation reading at least ' + IR_MIN + ' MΩ, and correct polarity. Type ">999" for an over-range reading. A pass ticks "Tested" for the installers and the office.</p>';
  } else {
    const needV = c.three ? ['v12','v13','v23'] : ['v' + c.phase + 'n'];
    body = '<div class="grid2">' + postFields(c).map(([k, l, col]) => inp(k, l, col, needV.includes(k) ? {} : { q: NA })).join('') + '</div>' +
      (c.three ? '<div class="grid2"><div class="fld"><label for="t_rot">Phase rotation <span class="col">AH</span></label><select id="t_rot"' + ro + '><option value="">—</option>' + ['Correct','Wrong'].map(x => '<option' + (p.rot === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div></div>' : '') +
      '<div class="grid2">' + inp('zs', 'Zs P–E loop Ω', 'AI', { hint: c.zsMax ? 'Guide max ' + c.zsMax + ' Ω (0.4 s, Cmin 0.95). Check against the project spec.' : 'No guide value for this device', bad: c.zsMax && num(p.zs) > c.zsMax }) + '</div>' +
      (c.rcd ? '<div class="grid2"><div class="fld"><label for="t_rcdh">RCD at ½ IΔn <span class="col">AJ</span></label><select id="t_rcdh"' + ro + '><option value="">—</option><option value="no trip"' + (p.rcdh === 'no trip' ? ' selected' : '') + '>No trip</option><option value="trip"' + (p.rcdh === 'trip' ? ' selected' : '') + '>Tripped (fail)</option></select></div>' +
        inp('rcd1', 'RCD at IΔn (ms)', 'AK', { hint: 'Max ' + RCD_MAX + ' ms', bad: num(p.rcd1) > RCD_MAX }) + inp('rcd5', 'RCD at 5 IΔn (ms)', 'AL', { hint: 'Max ' + RCD5_MAX + ' ms', bad: num(p.rcd5) > RCD5_MAX, q: NA }) + '</div>' : '');
  }
  const v = kind === 'pre' ? preVerdict(c, c.te.pre) : postVerdict(c, c.te.post);
  const vb = { pass: '<span class="verdict ok">Pass</span>', fail: '<span class="verdict fail">Fail</span>', inc: '<span class="verdict inc">Incomplete</span>', none: '<span class="verdict inc">Not tested</span>' }[v];
  return '<section class="step ' + (v === 'pass' ? 'ok' : v === 'fail' ? 'fail' : '') + '"><div class="sth"><h3>' + (kind === 'pre' ? 'Pre-connection (dead) tests' : 'Post-connection (live) tests') + '</h3>' + vb + '</div><span class="by">' + byLine(c.te[kind]) + (p.tester ? ' · Tester ' + esc(p.tester) + (p.qc ? ' (' + esc(p.qc) + ')' : '') : '') + '</span>' +
    (warn ? '<div class="banner warn">' + warn + '</div>' : '') + body +
    '<div class="fld"><label for="t_note">Comments <span class="col">AN</span></label><textarea id="t_note"' + ro + '>' + esc(p.note || '') + '</textarea></div>' +
    '<div class="tools"><button class="btn team" data-savetest="' + kind + '"' + ro + '>Save</button><button class="btn" data-savetest="' + kind + '" data-next="1"' + ro + '>Save and next circuit</button>' + (c.te[kind] ? '<button class="btn danger" data-cleartest="' + kind + '"' + ro + '>Clear</button>' : '') + '</div>' +
    photoStrip(c, 'tests', kind) + '</section>';
}
function sheetTest(c) {
  const seg = '<div class="seg" role="group" aria-label="Test">' + [['pre','Pre-connection'],['post','Post-connection'],['lab','Labelling']].map(([k, l]) => '<button data-kind="' + k + '" aria-pressed="' + (S.sheetKind === k) + '">' + l + '</button>').join('') + '</div>';
  if (!ME.name && S.sheetKind !== 'lab') return kvOf(c) + seg + '<div class="banner warn">Add your tester name, QC no. and test kit in <b>My details</b> first. They go on the certificate.</div><div class="tools"><button class="btn team" data-gome>Go to My details</button></div>';
  if (S.sheetKind === 'lab') return kvOf(c) + seg + '<section class="step"><div class="sth"><h3>Labelling</h3></div>' + stageList(c, [LABEL]) + '<p class="by" style="margin:0">Mark the circuit labelled once its labels are fitted. QA/QC then checks the labelling.</p></section>';
  return kvOf(c) + seg + testForm(c, S.sheetKind || 'pre');
}
function checksHtml(list, q, step) {
  return '<div class="checks">' + list.map(([k, l]) => '<label class="chk"><input type="checkbox" data-chk="' + step + '" data-key="' + k + '"' + (q && q.c && q.c[k] ? ' checked' : '') + (S.readOnly ? ' disabled' : '') + '><span>' + esc(l) + '</span></label>').join('') + '</div>';
}
function sheetQA(c) {
  const step = (k, title, list) => { const q = c.qa[k], ok = k === 'lab' ? labDone(q) : termDone(q);
    return '<section class="step ' + (ok ? 'ok' : '') + '"><div class="sth"><h3>' + title + '</h3><span class="by">' + byLine(q) + '</span></div>' + checksHtml(list, q, k) + photoStrip(c, 'qa', k) + '</section>'; };
  const p = c.te.pre || {}, q = c.te.post || {}, pv = preVerdict(c, c.te.pre), qv = postVerdict(c, c.te.post);
  const tests = '<section class="step ' + (pv === 'pass' && qv === 'pass' ? 'ok' : (pv === 'fail' || qv === 'fail') ? 'fail' : '') + '"><div class="sth"><h3>Test results (from testers)</h3></div>' +
    '<div class="kv"><div><span>Pre-connection</span>' + ({ pass: 'Pass', fail: 'FAIL', inc: 'Incomplete', none: 'Not tested' })[pv] + '</div><div><span>R1+R2</span>' + esc(p.r12 || '—') + ' Ω</div><div><span>IR P–N / P+N–E</span>' + esc(p.irpn || '—') + ' / ' + esc(p.irpne || '—') + ' MΩ</div><div><span>Polarity</span>' + (p.pol ? 'Correct' : '—') + '</div>' +
    '<div><span>Post-connection</span>' + ({ pass: 'Pass', fail: 'FAIL', inc: 'Incomplete', none: 'Not tested' })[qv] + '</div><div><span>Zs</span>' + esc(q.zs || '—') + ' Ω</div>' + (c.rcd ? '<div><span>RCD IΔn</span>' + esc(q.rcd1 || '—') + ' ms</div>' : '') + '<div><span>Tested by</span>' + esc(p.tester || nameOf(p.by)) + '</div></div>' + photoStrip(c, 'tests', 'pre') + '</section>';
  const reqs = signReqs(c);
  const so = c.st.qa ? '<span class="verdict ok" style="background:var(--t-qa);color:#fff">Signed off</span><span class="by">' + byLine(c.st.qa) + '</span>' + (S.canEdit ? '<div class="tools"><button class="btn danger" data-unsign>Withdraw sign-off</button></div>' : '')
    : '<div class="req">' + reqs.map(([team, l, ok]) => '<div class="' + (ok ? 'y' : 'n') + '"><i>' + (ok ? '✓' : '✗') + '</i><span>' + l + '</span><small>' + team + '</small></div>').join('') + '</div>' +
      (S.canEdit ? '<div class="tools"><button class="btn team" data-sign' + (canSign(c) ? '' : ' disabled') + '>Sign off circuit</button></div>' : '<span class="by">An Editor signs off once every item above is ticked.</span>');
  const qn = c.qa.note || {}, ro = S.readOnly ? ' disabled' : '';
  const comments = '<section class="step"><div class="sth"><h3>QA/QC comments</h3><span class="by">' + (qn.at ? byLine(qn) : 'Optional') + '</span></div>' +
    '<div class="fld"><label for="qa_note">Comment for this circuit</label><textarea id="qa_note" rows="3" placeholder="e.g. label at load missing, re-torque L2"' + ro + '>' + esc(qn.t || '') + '</textarea>' +
    '<span class="hint">Installers and Testers see this comment on the circuit.</span></div>' +
    '<div class="tools"><button class="btn team" data-saveqanote' + ro + '>Save comment</button>' + (qn.t ? '<button class="btn danger" data-clearqanote' + ro + '>Clear</button>' : '') + '</div></section>';
  return kvOf(c) + step('bt', 'Board-end termination', TERM_CHECKS) + step('ft', 'Field-end termination', TERM_CHECKS) + step('lab', 'Labelling', LAB_CHECKS) + tests + comments +
    '<section class="step"><div class="sth"><h3>QA/QC sign-off</h3></div>' + so + '</section>';
}
function sheetHeader(b) {
  const sh = sheetOf(b.board), ro = S.readOnly ? ' disabled' : '';
  const f = (k, l, v, hint) => '<div class="fld"><label for="h_' + k + '">' + l + '</label><input id="h_' + k + '" value="' + esc(v || '') + '"' + ro + '>' + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
  const tester = (k, l) => { const t = sh[k] || {}; return '<div class="step"><div class="sth"><h3>' + l + '</h3></div><div class="grid2">' + f(k + '_name', 'Name / signature', t.name) + f(k + '_qc', 'QC no.', t.qc) + f(k + '_date', 'Date', t.date, 'dd/mm/yyyy') + '</div></div>'; };
  const yn = (k, l, v) => '<div class="fld"><label for="h_' + k + '">' + l + '</label><select id="h_' + k + '"' + ro + '>' + ['YES','NO','N/A'].map(x => '<option' + ((v || 'YES') === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>';
  return '<div class="kv"><div><span>Project ref</span>' + PROJECT_REF + '</div><div><span>Reg no.</span>' + REG_NO + '</div><div><span>Panel no.</span>HEL16-' + esc(b.board) + '</div><div><span>Location</span>' + esc(b.area) + '</div></div>' +
    '<section class="step"><div class="sth"><h3>Supply</h3></div><div class="grid2">' + f('fed', 'Fed from', sh.fed, 'e.g. HEL16-COLO3-CE1-PNL01-5Q6') + f('dev', 'Protective device', sh.dev, 'e.g. C32 MCB') + f('cable', 'Cable type / size', sh.cable, 'e.g. 10SQ X 3C NHXH') + '</div>' +
    '<div class="grid2"><div class="fld"><label for="h_earth">Earthing system</label><select id="h_earth"' + ro + '>' + ['TN','TT','IT'].map(x => '<option' + ((sh.earth || 'TN') === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' + yn('bond', 'Main bonding complete', sh.bond) + yn('ground', 'Main grounding complete', sh.ground) + f('no', 'Test record sheet no.', sh.no || '1') + '</div></section>' +
    '<section class="step"><div class="sth"><h3>Test kit</h3></div><div class="grid2">' + f('make', 'Manufacturer', sh.make) + f('model', 'Model no.', sh.model) + f('serial', 'Serial no.', sh.serial) + f('cal', 'Calibration expiry', sh.cal, 'dd/mm/yyyy') + '</div></section>' +
    tester('preA', 'Pre-connection tester A') + tester('preB', 'Pre-connection tester B') + tester('postA', 'Post-connection tester A') + tester('postB', 'Post-connection tester B') +
    '<div class="tools"><button class="btn team" data-savehdr' + ro + '>Save sheet details</button></div>';
}
function renderSheet(force) {
  const host = document.getElementById('sheetHost');
  if (!S.sheet) { host.innerHTML = ''; return; }
  if (S.dirty && !force) return;
  const fa = document.activeElement;
  if (!force && fa && host.contains(fa) && /^(INPUT|SELECT|TEXTAREA)$/.test(fa.tagName) && fa.type !== 'checkbox') return;
  const scroller = host.querySelector('.sheet'), top = scroller ? scroller.scrollTop : 0;
  let title, body;
  if (S.sheet.startsWith('hdr:')) { const b = S.boards[S.sheet.slice(4)]; if (!b) { host.innerHTML = ''; return; } title = '<h2 id="shT">' + esc('Test record sheet · ' + b.board) + '</h2>'; body = sheetHeader(b); }
  else if (S.sheet.startsWith('new:')) { const b = S.boards[S.sheet.slice(4)]; if (!b) { host.innerHTML = ''; return; } title = '<span class="ref">' + esc(nextRef(b.board)) + ' · new</span><h2 id="shT">Add circuit to ' + esc(b.board.replace(SHORT(), '')) + '</h2>'; body = formHtml({ status: 'Active' }, 'new'); }
  else if (S.sheet === 'newboard') { title = '<h2 id="shT">Add board to ' + COLO + '</h2>'; body = boardFormHtml(); }
  else {
    const c = findCircuit(S.sheet); if (!c) { host.innerHTML = ''; return; }
    wantNames([c.st.inst, c.st.bt, c.st.ft, c.st.lab, c.st.qa, c.te.pre, c.te.post, c.qa.bt, c.qa.ft, c.qa.lab, c.qa.note].map(x => x && x.by));
    title = esc(c.circ || c.dev || '#' + c.seq) + ' · ' + esc(c.desc);
    if (S.mode === 'edit') body = formHtml(c, 'edit');
    else body = (!isActive(c) ? '<div class="banner">This circuit is marked ' + esc(c.status) + ', so there is nothing to record.</div>' : S.team === 'install' ? sheetInstall(c) : S.team === 'test' ? sheetTest(c) : sheetQA(c)) + adminHtml(c);
    title = '<span class="ref">' + esc(refLabel(c)) + (refLabel(c) !== c.ref ? ' · ' + esc(c.ref) : '') + '</span><h2 id="shT">' + title + '</h2>';
  }
  host.innerHTML = '<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shT"><div class="sh"><div>' + title + '</div><button class="btn" id="shClose">Close</button></div>' + body + '</div></div>';
  const sc = host.querySelector('.sheet'); if (sc) sc.scrollTop = top;
}
function openSheet(id, kind) { S.sheet = id; S.sheetKind = kind || 'pre'; S.mode = null; S.dirty = false; renderSheet(true); const b = document.getElementById('shClose'); if (b) b.focus(); }
function closeSheet() { S.sheet = null; S.mode = null; S.dirty = false; S._confirm = false; renderSheet(); }

/* ---------- circuit schedule editing (Editors, Installers and QA/QC apps) ---------- */
const canAdmin = () => S.canEdit && !S.readOnly && S.team !== 'test';
function nextRef(board) {
  const reg = layer('boards', board), short = board.replace(SHORT(), '');
  const seq = Math.max(0, ...Object.values(reg).map(c => c.seq || 0)) + 1;
  let ref = short + '-' + String(seq).padStart(3, '0'), n = seq;
  while (reg[ref]) { n++; ref = short + '-' + String(n).padStart(3, '0'); }
  return ref;
}
function adminHtml(c) {
  if (!canAdmin()) return '';
  if (S.mode === 'delete') return '<section class="step fail"><div class="sth"><h3>Delete ' + esc(c.circ || c.ref) + '?</h3></div><span>It disappears from this board in all three team apps, from every total and from the certificate. Test and QA records already made for it are kept but hidden. You can undo straight after.</span>' +
    '<div class="tools"><button class="btn danger" id="shDelConfirm" style="background:var(--todo);color:#fff;border-color:var(--todo)">Delete circuit</button><button class="btn" id="shDelCancel">Keep it</button></div></section>';
  return '<section class="step"><div class="sth"><h3>Circuit schedule</h3><span class="by">Editors only · changes show in all three team apps</span></div><div class="tools"><button class="btn" id="shEdit">Edit details</button><button class="btn danger" id="shDelete">Delete circuit</button></div></section>';
}
function formHtml(c, kind) {
  const f = ([k, l, hint]) => '<div class="fld"><label for="f_' + k + '">' + l + '</label><input id="f_' + k + '" value="' + esc(c[k] || '') + '" placeholder="' + esc(hint) + '"></div>';
  return '<section class="step"><div class="grid2">' + FIELDS.map(f).join('') +
    '<div class="fld"><label for="f_status">Status</label><select id="f_status">' + ['Active','Spare','Not required'].map(x => '<option' + ((c.status || 'Active') === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div></div>' +
    '<p class="by" style="margin:0">' + (kind === 'new' ? 'The new circuit starts with nothing done. It appears straight away for installers, testers and QA/QC.' : 'Recorded progress, test results and QA checks are not changed here. The new details show in all three team apps and on the certificate.') + '</p>' +
    '<div class="tools"><button class="btn team" id="' + (kind === 'new' ? 'shAddSave' : 'shSaveEdit') + '">' + (kind === 'new' ? 'Add circuit' : 'Save changes') + '</button><button class="btn" id="shCancelEdit">Cancel</button></div></section>';
}
function readForm() { const o = {}; FIELDS.forEach(([k]) => o[k] = (document.getElementById('f_' + k).value || '').trim()); o.status = document.getElementById('f_status').value; return o; }
function boardFormHtml() {
  const f = (k, l, hint) => '<div class="fld"><label for="nb_' + k + '">' + l + '</label><input id="nb_' + k + '" placeholder="' + esc(hint) + '"></div>';
  return '<section class="step"><div class="grid2"><div class="fld"><label for="nb_cell">Cell</label><select id="nb_cell">' + cellsOf().map(c => '<option' + (S.cell === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
    f('name', 'Board name', 'e.g. PNL03 or UPS03-PNL01') + f('area', 'Area / room', 'e.g. COLO 3 ELECTRICAL ROOM 1') + '</div>' +
    '<p class="by" style="margin:0">The board is created as ' + CODE + '-&lt;cell&gt;-&lt;name&gt;, with its own test record sheet and QA/QC records. Add its circuits once it is created.</p>' +
    '<div class="tools"><button class="btn team" id="shBoardSave">Add board</button><button class="btn" id="shCancelEdit">Cancel</button></div></section>';
}

/* ---------- writes ---------- */
function setStage(c, k, val) {
  const prev = c.st[k] || null;
  queue('boards', c.board, { circuits: { [c.ref]: { st: { [k]: val } } } }, { act: val ? 'done' : 'clear', k, ref: c.ref });
  if (val) toast(STAGES.find(s => s.k === k).l + ' ✓ ' + (c.circ || c.ref), () => queue('boards', c.board, { circuits: { [c.ref]: { st: { [k]: prev } } } }, { act: 'clear', k, ref: c.ref }));
}
function saveTest(c, kind, next) {
  const g = id => { const el = document.getElementById('t_' + id); return el ? el.value.trim() : undefined; };
  const rec = { tester: ME.name, qc: ME.qc, kit: [ME.make, ME.model, ME.serial].filter(Boolean).join(' '), note: g('note'), ...stamp() };
  if (kind === 'pre') { PRE.forEach(f => { const v = g(f.k); if (v !== undefined) rec[f.k] = v; }); rec.ring = document.getElementById('t_ring').checked; rec.pol = document.getElementById('t_pol').checked; }
  else { postFields(c).forEach(([k]) => rec[k] = g(k)); ['rot','zs','rcdh','rcd1','rcd5'].forEach(k => { const v = g(k); if (v !== undefined) rec[k] = v; }); }
  const data = { circuits: { [c.ref]: { [kind]: rec } } };
  if (kind === 'pre') { data.circuits[c.ref].cable = g('cable'); ME.cable = g('cable'); saveMe(); }
  // first test on this board fills the certificate's tester and kit details
  const sh = sheetOf(c.board), who = kind === 'pre' ? 'preA' : 'postA';
  if (!sh[who] || !sh[who].name) data.sheet = { [who]: { name: ME.name, qc: ME.qc, date: fmtDMY(todayIso()) }, ...(sh.make ? {} : { make: ME.make, model: ME.model, serial: ME.serial, cal: ME.cal }) };
  const v = kind === 'pre' ? preVerdict(c, rec) : postVerdict(c, rec);
  queue('tests', c.board, data, { act: 'test', k: kind, ref: c.ref, v: v === 'pass' ? 'pass' : v === 'fail' ? 'FAIL' : 'incomplete' });
  // a passing pre-connection test is what ticks "Tested" for everyone else
  if (kind === 'pre') { const isPass = v === 'pass'; if (isPass !== !!c.st.te) queue('boards', c.board, { circuits: { [c.ref]: { st: { te: isPass ? { ...stamp(), src: 'test' } : null } } } }, isPass ? { act: 'done', k: 'te', ref: c.ref } : { act: 'clear', k: 'te', ref: c.ref }); }
  S.dirty = false; S._confirm = false;
  toast(v === 'pass' ? 'Saved: pass' : v === 'fail' ? 'Saved: FAIL. The readings marked red need attention.' : 'Saved as incomplete.');
  if (next) { const list = circuitsOf(S.boards[c.board]).filter(isActive), i = list.findIndex(x => x.ref === c.ref), n = list[i + 1]; if (n) { openSheet(n.ref, kind); return; } toast('That was the last circuit on this board.'); }
  renderSheet(true);
}

/* ---------- exports ---------- */
function csv(rows) { return rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); }
async function saveFile(filename, data) { try { await S.downloads.save({ filename, data }); toast('Saved ' + filename); } catch (e) { if (e && e.code === 'declined') return; toast(e && e.code === 'rate_limited' ? 'A download is already waiting for you to confirm.' : 'The file could not be saved here.'); } }
function certCsv(board) {
  const b = S.boards[board], sh = sheetOf(board), t = k => sh[k] || {};
  const out = [['HEL16 Test Record Sheet', 'Project ref ' + PROJECT_REF, 'Reg no ' + REG_NO], ['Panel no.', 'HEL16-' + board, 'Location', b.area], ['Fed from', sh.fed, 'Protective device', sh.dev, 'Cable type/size', sh.cable],
    ['Earthing', sh.earth || 'TN', 'Main bonding', sh.bond || 'YES', 'Main grounding', sh.ground || 'YES'], ['Test kit', sh.make, sh.model, 'Serial', sh.serial, 'Calibration expiry', sh.cal],
    ['Pre-connection tester A', t('preA').name, t('preA').qc, t('preA').date, 'Tester B', t('preB').name, t('preB').qc, t('preB').date], ['Post-connection tester A', t('postA').name, t('postA').qc, t('postA').date, 'Tester B', t('postB').name, t('postB').qc, t('postB').date], [],
    ['Device No.','L1','L2','L3','Term No.','Description','No. of points','Cable type','mm2','Device','Type','Poles','Amps','R1+R2 (P+E)','R2 (E)','Ring P-P','Ring N-N','Ring E-E','IR P-N','IR P+N-E','IR P1P2P3+N-E','IR busbar','Polarity'].concat(POST3.map(x => x[1])).concat(['Phase rotation','Zs','RCD 1/2 IDn','RCD IDn','RCD 5 IDn','Tester A/B','Comments'])];
  circuitsOf(b).forEach(c => {
    const p = c.te.pre || {}, q = c.te.post || {}, NA = 'N/A';
    const ph = k => c.three || c.phase === k ? 'x' : '';
    const pv = (k, ok) => ok ? (p[k] ?? '') : NA;
    out.push([c.dev, ph(1), ph(2), ph(3), c.term, c.desc, c.elem, c.te.cable || '', c.size, c.cat, c.dtype, c.three ? 3 : 1, c.rating,
      p.r12 ?? '', p.r2 || NA, pv('rpp', p.ring), pv('rnn', p.ring), pv('ree', p.ring), p.irpn ?? '', p.irpne ?? '', c.three ? (p.irppp ?? '') : NA, p.irbus || NA, p.at ? (p.pol ? '✓' : '✗') : '']
      .concat(POST3.map(([k]) => postFields(c).some(f => f[0] === k) ? (q[k] ?? '') : NA))
      .concat([c.three ? (q.rot || '') : NA, q.zs ?? '', c.rcd ? (q.rcdh || '') : NA, c.rcd ? (q.rcd1 || '') : NA, c.rcd ? (q.rcd5 || '') : NA, [p.tester, q.tester].filter(Boolean).join(' / '), [p.note, q.note].filter(Boolean).join('; ')]));
  });
  saveFile('HEL16-' + board + '-test-record-sheet.csv', csv(out));
}
function exportLabels() {
  const logo = document.querySelector('.logo').src;
  const cards = boardList().map(b => '<div class="l"><img class="lg" src="' + logo + '" alt="OKEE"><div class="q">' + qrSvg(VIEW_URL + '#' + b.board) + '</div><b>' + esc(b.board) + '</b><span>Scan to view progress</span><small>' + esc(b.area) + '</small></div>').join('');
  saveFile('HEL16-' + CODE + '-board-QR-labels.html', '<!doctype html><html><head><meta charset="utf-8"><title>HEL16 ' + COLO + ' board QR labels</title><style>body{font-family:Arial,sans-serif;margin:10mm}.g{display:grid;grid-template-columns:repeat(3,60mm);gap:6mm}.l{border:1px dashed #999;border-radius:3mm;padding:4mm;text-align:center;display:grid;gap:1.5mm;justify-items:center;break-inside:avoid}.lg{height:7mm}.q svg{width:36mm;height:36mm}b{font-size:11pt}span{font-size:10pt;font-weight:700}small{font-size:7pt;color:#555}</style></head><body><h1 style="font-size:14pt">HEL16 ' + COLO + ' board QR labels (view progress, team links inside)</h1><div class="g">' + cards + '</div></body></html>');
}

/* ---------- photos ---------- */
let photoTarget = null;
async function compress(file) {
  const bmp = await createImageBitmap(file).catch(() => null); if (!bmp) return file.type === 'image/jpeg' ? file : null;
  const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); return await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
}
document.getElementById('cam').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f || !photoTarget) return;
  const blob = await compress(f); if (!blob) { toast('That file is not a photo this app can read.'); return; }
  const p = { key: uid(), ...photoTarget, blob, t: Date.now() }; p.url = URL.createObjectURL(blob); heldPhotos.push(p); await idbPut(p); renderSheet(true); render(); flush();
});

/* ---------- events ---------- */
document.getElementById('tabs').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (!b) return; S.view = b.dataset.v; if (S.view !== 'boards') S.board = S.board; render(); window.scrollTo(0, 0); });
const view = document.getElementById('view');
view.addEventListener('click', e => {
  const t = e.target.closest('button, tr[data-open], tr[data-colo]'); if (!t) return;
  if (t.dataset.colo) { switchColo(t.dataset.colo); return; }
  if ('siteload' in t.dataset) { S.site = null; loadSite(); render(); return; }
  if (t.dataset.cell) { S.cell = t.dataset.cell; try { localStorage.setItem('hel16t.cell', S.cell); } catch (x) {} render(); }
  else if (t.dataset.board) { S.board = t.dataset.board; S.q = ''; S.filter = 'all'; render(); window.scrollTo(0, 0); }
  else if ('back' in t.dataset) { S.board = null; render(); }
  else if (t.dataset.filter) { S.filter = t.dataset.filter; render(); }
  else if (t.dataset.stage) { const c = findCircuit(t.dataset.ref); if (!c) return; if (c.st[t.dataset.stage]) openSheet(c.ref, t.dataset.stage === 'lab' ? 'lab' : undefined); else setStage(c, t.dataset.stage, stamp()); }
  else if (t.dataset.test) openSheet(t.dataset.ref, t.dataset.test);
  else if (t.dataset.open) openSheet(t.dataset.open);
  else if ('sheethdr' in t.dataset) openSheet('hdr:' + S.board);
  else if (t.dataset.addc) { if (canAdmin()) openSheet('new:' + t.dataset.addc); }
  else if ('addboard' in t.dataset) { if (canAdmin()) openSheet('newboard'); }
  else if ('certcsv' in t.dataset) certCsv(S.board);
  else if ('labels' in t.dataset) exportLabels();
  else if ('saveme' in t.dataset) { ['name','qc','make','model','serial','cal','cable'].forEach(k => ME[k] = document.getElementById('me_' + k).value.trim()); saveMe(); toast('Saved on this phone'); render(); }
});
view.addEventListener('input', e => { if (e.target.id === 'q') { S.q = e.target.value; const l = document.getElementById('list'); if (l) l.innerHTML = listHtml(S.boards[S.board]); } });
view.addEventListener('change', e => { if (e.target.id === 'resBoard') { S.resBoard = e.target.value; e.target.blur(); render(); } });
view.addEventListener('focusin', e => { if (e.target.id === 'q') S._qFocus = true; });
view.addEventListener('focusout', e => { if (e.target.id === 'q') S._qFocus = false; });
const sheetHost = document.getElementById('sheetHost');
sheetHost.addEventListener('input', e => { if (e.target.type !== 'checkbox') S.dirty = true; if (e.target.id === 't_ring') {} });
sheetHost.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 't_ring') { const r = document.getElementById('ringf'); if (r) r.hidden = !t.checked; S.dirty = true; return; }
  const c = S.sheet && !S.sheet.startsWith('hdr:') ? findCircuit(S.sheet) : null; if (!c) return;
  if (t.dataset.chk) {
    const step = t.dataset.chk, cur = clone(c.qa[step]); cur.c = cur.c || {}; cur.c[t.dataset.key] = t.checked;
    const done = (step === 'lab' ? LAB_CHECKS : TERM_CHECKS).every(([k]) => cur.c[k]);
    queue('qa', c.board, { circuits: { [c.ref]: { [step]: { c: { [t.dataset.key]: t.checked }, ...stamp() } } } }, done ? { act: 'check', k: step, ref: c.ref } : null);
    if (!S.dirty) renderSheet(true);
  }
  if (t.id === 'i_block') { t.blur(); queue('boards', c.board, { circuits: { [c.ref]: { blocker: t.value } } }, { act: 'blocker', v: t.value, ref: c.ref }); S.dirty = false; renderSheet(true); }
});
sheetHost.addEventListener('click', e => {
  const qb = e.target.closest('[data-quick], [data-allir]');
  if (qb) {   // one-tap readings: fill the field, keep the sheet open for the rest of the entries
    const ids = 'allir' in qb.dataset ? ['t_irpn', 't_irpne', 't_irppp'] : [qb.dataset.quick];
    ids.forEach(id => { const el = document.getElementById(id); if (el) { el.value = qb.dataset.val || '>999'; el.classList.remove('bad'); } });
    S.dirty = true; return;
  }
  if (e.target.id === 'scrim' || e.target.id === 'shClose') { if (S.dirty && !S._confirm) { S._confirm = true; toast('You have unsaved entries. Tap Close again to discard them.'); return; } return closeSheet(); }
  const img = e.target.closest('[data-view]');
  if (img) { document.getElementById('viewerHost').innerHTML = '<div class="viewer" id="viewer"><div><img alt="Photo" src="' + esc(img.dataset.view) + '"><div class="cap">' + esc(img.dataset.cap) + ' · tap to close</div></div></div>'; return; }
  const b = e.target.closest('button'); if (!b) return;
  if ('savehdr' in b.dataset) {
    const board = S.sheet.slice(4), g = id => (document.getElementById('h_' + id) || {}).value || '';
    const sheet = { fed: g('fed'), dev: g('dev'), cable: g('cable'), earth: g('earth'), bond: g('bond'), ground: g('ground'), no: g('no'), make: g('make'), model: g('model'), serial: g('serial'), cal: g('cal') };
    ['preA','preB','postA','postB'].forEach(k => sheet[k] = { name: g(k + '_name'), qc: g(k + '_qc'), date: g(k + '_date') });
    queue('tests', board, { sheet }, { act: 'test', k: 'sheet', ref: '' }); S.dirty = false; closeSheet(); toast('Sheet details saved'); return;
  }
  if ('gome' in b.dataset) { closeSheet(); S.view = 'me'; render(); return; }
  if (b.id === 'shCancelEdit') { if (S.sheet.startsWith('new:') || S.sheet === 'newboard') closeSheet(); else { S.mode = null; S.dirty = false; renderSheet(true); } return; }
  if (b.id === 'shAddSave' && canAdmin()) {
    const board = S.sheet.slice(4), o = readForm(); if (!o.desc && !o.circ) { toast('Enter at least a circuit or a description.'); return; }
    const ref = nextRef(board), seq = Math.max(0, ...Object.values(layer('boards', board)).map(c => c.seq || 0)) + 1;
    queue('boards', board, { circuits: { [ref]: { ...o, seq, load: '', blocker: '', note: '', st: { inst: null, bt: null, ft: null, te: null, lab: null, qa: null }, addedBy: S.me.id, addedAt: Date.now() } } }, { act: 'added', ref, v: o.desc });
    S.dirty = false; closeSheet(); toast('Added ' + (o.circ || ref) + ' to ' + board.replace(SHORT(), '')); return;
  }
  if (b.id === 'shBoardSave' && canAdmin()) {
    const cell = document.getElementById('nb_cell').value, name = document.getElementById('nb_name').value.trim().toUpperCase().replace(/\s+/g, '-'), area = document.getElementById('nb_area').value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]*$/.test(name)) { toast('Use letters, numbers and dashes for the board name, e.g. PNL03.'); return; }
    const id = CODE + '-' + (/^CE\d/.test(cell) ? cell + '-' : '') + name; if (S.boards[id]) { toast(id + ' already exists.'); return; }
    const order = Math.max(0, ...boardList().filter(x => x.cell === cell).map(x => x.order || 0)) + 1;
    queue('boards', id, { board: id, colo: CODE, cell, area: area || (COLO + ' ' + cell), order, circuits: {} }, { act: 'board', ref: id }, { create: true });
    S.boards[id] = { board: id, colo: CODE, cell, area: area || (COLO + ' ' + cell), order, circuits: {} };   // show it straight away; the hold queue saves it
    S.dirty = false; closeSheet(); S.board = id; S.cell = cell; render(); toast('Board ' + id + ' added. Now add its circuits.'); return;
  }
  { const c0 = S.sheet && findCircuit(S.sheet);
    if (c0 && canAdmin()) {
      if (b.id === 'shEdit') { S.mode = 'edit'; renderSheet(true); return; }
      if (b.id === 'shDelete') { S.mode = 'delete'; renderSheet(true); return; }
      if (b.id === 'shDelCancel') { S.mode = null; renderSheet(true); return; }
      if (b.id === 'shSaveEdit') { const o = readForm(); queue('boards', c0.board, { circuits: { [c0.ref]: o } }, { act: 'edited', ref: c0.ref, v: o.desc }); S.mode = null; S.dirty = false; renderSheet(true); toast('Saved. The new details show in all three team apps.'); return; }
      if (b.id === 'shDelConfirm') { const c = c0; queue('boards', c.board, { circuits: { [c.ref]: { deleted: true, deletedBy: S.me.id, deletedAt: Date.now() } } }, { act: 'deleted', ref: c.ref, v: c.desc }); closeSheet();
        toast('Deleted ' + (c.circ || c.ref), () => queue('boards', c.board, { circuits: { [c.ref]: { deleted: false } } }, { act: 'restored', ref: c.ref, v: c.desc })); return; }
    } }
  if (b.dataset.kind) { S.sheetKind = b.dataset.kind; S.dirty = false; renderSheet(true); return; }
  const c = findCircuit(S.sheet); if (!c) return;
  if (b.dataset.photo) { const [coll, tag] = b.dataset.photo.split('|'); photoTarget = { coll, board: c.board, ref: c.ref, tag }; document.getElementById('cam').click(); }
  else if (b.dataset.mark) { setStage(c, b.dataset.mark, stamp()); renderSheet(true); }
  else if (b.dataset.clear) { setStage(c, b.dataset.clear, null); renderSheet(true); }
  else if ('saveqanote' in b.dataset || 'clearqanote' in b.dataset) {
    const t = 'clearqanote' in b.dataset ? '' : document.getElementById('qa_note').value.trim();
    queue('qa', c.board, { circuits: { [c.ref]: { note: t ? { t, ...stamp() } : null } } }, { act: 'qanote', ref: c.ref, v: t.slice(0, 60) });
    S.dirty = false; toast(t ? 'Comment saved' : 'Comment cleared'); renderSheet(true);
  }
  else if ('savenote' in b.dataset) { queue('boards', c.board, { circuits: { [c.ref]: { note: document.getElementById('i_note').value.trim() } } }, { act: 'note', ref: c.ref }); S.dirty = false; toast('Note saved'); }
  else if (b.dataset.savetest) saveTest(c, b.dataset.savetest, !!b.dataset.next);
  else if (b.dataset.cleartest) { const k = b.dataset.cleartest; queue('tests', c.board, { circuits: { [c.ref]: { [k]: null } } }, { act: 'clear', k, ref: c.ref }); if (k === 'pre' && c.st.te) queue('boards', c.board, { circuits: { [c.ref]: { st: { te: null } } } }, { act: 'clear', k: 'te', ref: c.ref }); S.dirty = false; renderSheet(true); }
  else if ('sign' in b.dataset) { if (S.canEdit && canSign(c)) { queue('boards', c.board, { circuits: { [c.ref]: { st: { qa: stamp() } } } }, { act: 'sign', k: 'qa', ref: c.ref }); toast('Circuit signed off'); renderSheet(true); } }
  else if ('unsign' in b.dataset) { if (S.canEdit) { queue('boards', c.board, { circuits: { [c.ref]: { st: { qa: null } } } }, { act: 'unsign', k: 'qa', ref: c.ref }); renderSheet(true); } }
});
document.getElementById('viewerHost').addEventListener('click', () => { document.getElementById('viewerHost').innerHTML = ''; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (document.getElementById('viewer')) document.getElementById('viewerHost').innerHTML = ''; else if (S.sheet) closeSheet(); } });

/* ---------- boot ---------- */
render();
(async () => {
  const use = n => (window.claude && window.claude.use) ? window.claude.use(n).catch(() => null) : Promise.resolve(null);
  const [db, user, assets, downloads] = await Promise.all([use('db'), use('user'), use('assets'), use('downloads')]);
  Object.assign(S, { db, user, assets, downloads });
  if (user) { S.me = await user.me(); S.canEdit = !!S.me.canEdit; if ((await user.can('data.write')) === false) S.readOnly = true; if (!ME.name && S.me.name) ME.name = S.me.name; }
  if (!db) { S.failed = (window.__hel16 && window.__hel16.failMsg) || 'Could not open the shared site data. Check your signal and reopen the app.'; render(); return; }
  subscribe();
  db.collection('events').orderBy('at', 'desc').limit(100).onSnapshot(snap => { S.events = snap.docs.map(d => d.data()); if (S.view === 'activity') render(); }, () => {});
  flush();
})();
