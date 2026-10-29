/* HEL16 Site Tracker: board schedule updates (Editors only).
   Merges a schedule-update file (built from the board test record sheets) into the LIVE site data:
   - existing circuits: only schedule details change (description, device, terminal, drawing ref, cable, protection, rating, e-box)
   - work is never touched: stage ticks, tests, QA/QC, blockers, notes and comments stay exactly as recorded
   - new circuits and new boards are added; nothing is deleted (circuits missing from the sheets are listed for review)
   - paper test results are added only where the app has no pre-connection test for that circuit
   - a placeholder board is retired only when nobody has recorded work on it
   Nothing is written until the Editor presses Apply. */
(function () {
  const FIELDS = ['desc', 'dev', 'term', 'drw', 'elem', 'ctype', 'size', 'cat', 'dtype', 'rating', 'ebox'];
  const LABEL = { desc: 'description', dev: 'device', term: 'terminal', drw: 'drawing ref', elem: 'points', ctype: 'cable type', size: 'cable size', cat: 'device type', dtype: 'curve/type', rating: 'rating', ebox: 'e-box', status: 'status' };
  const up = v => String(v == null ? '' : v).toUpperCase().replace(/\s+/g, ' ').trim();
  const key = v => up(v).replace(/\s+/g, '');
  const cmp = (k, v) => {
    let s = key(v);
    if (k === 'rating') s = s.replace(/A$/, '');
    if (k === 'cat') s = s.replace('VIARCD', '/RCD');
    if (k === 'drw') s = s.replace(/,/g, '/');
    return s;
  };
  // write values in the app's own style
  const styled = (k, v, live) => {
    v = String(v).trim();
    if (k === 'cat') return v.replace(/\s*VIA\s*RCD/i, '/RCD');
    if (k === 'rating' && /^\d+(\.\d+)?$/.test(v) && (live == null || /A$/i.test(String(live)))) return v + 'A';
    return v;
  };
  const hasWork = (c, te, qa) => !!c && (Object.values(c.st || {}).some(Boolean) || !!c.blocker || !!c.note) || !!(te && (te.pre || te.post)) || !!(qa && Object.values(qa).some(Boolean));
  const circOf = r => {
    const n = String(r.drw || '').split(/[\/,]/).map(x => parseInt(x, 10)).filter(Number.isFinite);
    if (n.length >= 3) return 'L123/' + Math.ceil(n[0] / 3);
    if (n.length) return 'L' + ((n[0] - 1) % 3 + 1) + '/' + Math.ceil(n[0] / 3);
    if (r.ph) return 'L' + r.ph + '/' + r.dev;
    return '';
  };
  const isSpare = c => /^SPARE\b/i.test(String(c.desc || '').trim()) || c.status === 'Spare';
  // wording similarity: shared words, ignoring board codes and "emergency"
  const words = t => new Set(up(t).replace(/COLO\d-CE\d-[A-Z]{3}\d\d-[\d.]+/g, ' ').replace(/\bEMERGENCY ?/g, '').replace(/\bE-(?=[A-Z])/g, 'EAST ').replace(/\bW-(?=[A-Z])/g, 'WEST ').replace(/\bN-(?=[A-Z])/g, 'NORTH ').replace(/\bS-(?=[A-Z])/g, 'SOUTH ').replace(/\bMECH\b/g, 'MECHANICAL').replace(/\bELEC\b/g, 'ELECTRICAL').replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean));
  const sim = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; A.forEach(x => { if (B.has(x)) n++; }); return n / (A.size + B.size - n); };
  const lbl = c => [c.circ || c.dev || c.ref, c.desc].filter(Boolean).join(' · ');
  const three = c => /L123|3P|TP/i.test((c.circ || '') + ' ' + (c.term || ''));

  async function liveData(ids) {
    const want = new Set(ids), get = async coll => { const qs = await S.db.collection(coll).limit(2000).get(); const o = {}; qs.docs.forEach(d => { if (want.has(d.id)) o[d.id] = d.data(); }); return o; };
    const [boards, tests, qa] = [await get('boards'), await get('tests'), await get('qa')];
    return { boards, tests, qa };
  }

  function plan(file, live, me, opts) {
    opts = opts || {};
    const out = [], now = Date.now(), colo = file.area;
    const placeholderOrder = {};
    Object.entries(file.retire || {}).forEach(([old, nu]) => { if (live.boards[old]) placeholderOrder[nu] = live.boards[old].order; });
    const extraOrder = {};
    for (const [id, sb] of Object.entries(file.boards)) {
      const lb = live.boards[id], short = id.replace(colo + '-', ''), elp = /-ELP\d/.test(id);
      const p = { id, kind: lb ? 'update' : 'new', changes: [], added: [], missing: [], conflicts: [], tests: [], payload: { circuits: {} }, testsPayload: null, doc: null };
      const lc = lb ? (lb.circuits || {}) : {};
      const lt = (live.tests[id] || {}).circuits || {}, lq = (live.qa[id] || {}).circuits || {};
      // ---- match each sheet row to a live circuit, most certain first ----
      const liveRefs = Object.keys(lc).filter(ref => lc[ref] && !lc[ref].deleted);
      const rows = [], devSeen = {};
      sb.circuits.forEach(r => { const k = key(r.dev); if (k && devSeen[k] != null) { devSeen[k]++; r = { ...r, _dup: true }; } else if (k) devSeen[k] = 0; rows.push(r); });
      if (rows.some(r => r._dup)) p.conflicts.push('Some device numbers repeat on the sheet (e.g. a second terminal strip); each row is kept as its own circuit, told apart by its terminal number. Worth checking the sheet.');
      const match = new Array(rows.length).fill(null), how = new Array(rows.length).fill(''), used = new Set();
      const take = (i, ref, h) => { match[i] = ref; how[i] = h; used.add(ref); };
      const free = () => liveRefs.filter(ref => !used.has(ref));
      // 1. device number (+ terminal when the device number repeats)
      rows.forEach((r, i) => { const k = key(r.dev); if (!k) return;
        const cand = free().filter(ref => key(lc[ref].dev) === k);
        const pick = cand.length > 1 ? cand.find(ref => key(lc[ref].term) === key(r.term)) || cand[0] : cand[0];
        if (pick) take(i, pick, 'device'); });
      // 2. terminal number, then drawing ref, for rows with no device number
      rows.forEach((r, i) => { if (match[i] || key(r.dev)) return;
        const ref = (key(r.term) && free().find(ref => key(lc[ref].term) === key(r.term))) || (key(r.drw) && free().find(ref => cmp('drw', lc[ref].drw) === cmp('drw', r.drw)));
        if (ref) take(i, ref, 'terminal/drawing ref'); });
      // 3. older entries that kept the drawing ref in the device column ("1", "2", ...)
      rows.forEach((r, i) => { if (match[i]) return; const d = cmp('drw', r.drw); if (!/^\d+(\/\d+)*$/.test(d)) return;
        const ref = free().find(ref => !lc[ref].drw && cmp('drw', lc[ref].dev) === d && (sim(lc[ref].desc, r.desc) >= 0.25 || isSpare(lc[ref]) === (r.status === 'Spare')));
        if (ref) take(i, ref, 'drawing ref ' + r.drw); });
      // 4. description (closest wording, each live circuit used once)
      const pairs = [];
      rows.forEach((r, i) => { if (match[i] || r.status === 'Spare') return; free().forEach(ref => { if (isSpare(lc[ref])) return; const sc = sim(lc[ref].desc, r.desc); if (sc >= 0.6) pairs.push([sc, i, ref]); }); });
      pairs.sort((a, b) => b[0] - a[0]).forEach(([sc, i, ref]) => { if (!match[i] && !used.has(ref)) take(i, ref, 'description (' + Math.round(sc * 100) + '% alike)'); });
      // 5. remaining spare ways, in order
      const spareRefs = free().filter(ref => isSpare(lc[ref])).sort((a, b) => (lc[a].seq || 0) - (lc[b].seq || 0));
      rows.forEach((r, i) => { if (!match[i] && r.status === 'Spare' && spareRefs.length) take(i, spareRefs.shift(), 'spare way'); });

      let seq = Math.max(0, ...Object.values(lc).map(c => (c && c.seq) || 0));
      const nextRef = () => { let r; do { seq++; r = short + '-' + String(seq).padStart(3, '0'); } while (lc[r] || p.payload.circuits[r]); return r; };
      const anyA = Object.values(lc).some(c => c && /A$/i.test(c.rating || ''));
      rows.forEach((r, i) => {
        const ref = match[i];
        if (ref) {
          const c = lc[ref], w = hasWork(c, lt[ref], lq[ref]), f = {}, upd = {};
          for (const k of FIELDS) {
            if (!(k in r) || !String(r[k]).trim()) continue;          // never blank out a detail the sheet leaves empty
            if (cmp(k, r[k]) === cmp(k, c[k])) continue;
            const v = styled(k, r[k], c[k] || (anyA ? 'A' : null)); f[k] = [c[k] || '', v]; upd[k] = v;
          }
          const was = c.status || 'Active';
          if (r.status !== was) {
            if (r.status === 'Spare' && w) p.conflicts.push(lbl(c) + ': the new sheet shows SPARE but work is recorded on it, so it stays ' + was + '.');
            else { f.status = [was, r.status]; upd.status = r.status; }
          }
          if (Object.keys(upd).length) { p.changes.push({ ref, label: lbl(c), fields: f, work: w, how: how[i] }); p.payload.circuits[ref] = upd; }
          if (r.pre && !(lt[ref] && lt[ref].pre && lt[ref].pre.at)) addPre(p, ref, { ...c, ...upd }, r, c, me, now);
        } else {
          const nref = nextRef();
          const nc = { seq, circ: elp ? '' : circOf(r), status: r.status, blocker: '', note: '', load: '', addedBy: me.id, addedAt: now, st: { inst: null, bt: null, ft: null, te: null, lab: null, qa: null } };
          for (const k of FIELDS) nc[k] = r[k] ? styled(k, r[k], lb ? (anyA ? 'A' : null) : 'A') : '';
          p.payload.circuits[nref] = nc;
          p.added.push({ ref: nref, label: lbl(nc) + (r.term ? ' [' + r.term + ']' : '') });
          if (r.pre) addPre(p, nref, nc, r, null, me, now);
        }
      });
      p.changes.forEach(ch => { if (ch.fields.dev && ch.fields.dev[0] && !/^\d+(\/\d+)*$/.test(String(ch.fields.dev[0]).trim())) p.conflicts.push(ch.label + ': device number changes from "' + ch.fields.dev[0] + '" to "' + ch.fields.dev[1] + '". Check the sheet.'); });
      const finalDesc = {};
      Object.entries(lc).forEach(([ref, c]) => { if (c && !c.deleted) finalDesc[ref] = { d: (p.payload.circuits[ref] && p.payload.circuits[ref].desc) || c.desc, s: (p.payload.circuits[ref] && p.payload.circuits[ref].status) || c.status || 'Active' }; });
      Object.entries(p.payload.circuits).forEach(([ref, c]) => { if (!lc[ref]) finalDesc[ref] = { d: c.desc, s: c.status }; });
      const seenD = {};
      Object.entries(finalDesc).forEach(([ref, x]) => { if (x.s !== 'Active' || !x.d || isSpare({ desc: x.d })) return; const k = key(x.d); (seenD[k] = seenD[k] || []).push(ref); });
      if (lb) Object.values(seenD).forEach(refs => { if (refs.length > 1 && refs.some(r => p.payload.circuits[r] && (p.payload.circuits[r].desc || !lc[r]))) p.conflicts.push(refs.length + ' circuits would share the description "' + finalDesc[refs[0]].d + '" (' + refs.join(', ') + '). Check the sheet.'); });
      Object.entries(lc).forEach(([ref, c]) => { if (c && !c.deleted && !used.has(ref)) p.missing.push({ ref, label: lbl(c) + ' (' + (c.status || 'Active') + ')', work: hasWork(c, lt[ref], lq[ref]) }); });
      if (!lb) {
        const cellN = +(sb.cell || 'CE0').slice(2);
        extraOrder[cellN] = (extraOrder[cellN] || 7) + 0.1;
        p.doc = { board: id, colo, cell: sb.cell, area: sb.location || '', fed: sb.fed || '', order: placeholderOrder[id] != null ? placeholderOrder[id] : +(cellN * 10 + extraOrder[cellN]).toFixed(1), circuits: p.payload.circuits, addedBy: me.id, addedAt: now };
      } else if (sb.fed && sb.fed !== lb.fed) p.payload.fed = sb.fed;
      out.push(p);
    }
    for (const [old, nu] of Object.entries(file.retire || {})) {
      const lb = live.boards[old]; if (!lb || lb.retired) continue;
      const lt = (live.tests[old] || {}).circuits || {}, lq = (live.qa[old] || {}).circuits || {};
      const cs = Object.entries(lb.circuits || {}).filter(([, c]) => c && !c.deleted);
      const plain = c => ({ ...c, note: /^Placeholder\b/i.test(c.note || '') ? '' : c.note });
      const worked = cs.filter(([ref, c]) => hasWork(plain(c), lt[ref], lq[ref]));
      if (!worked.length) { out.push({ id: old, kind: 'retire', replacedBy: nu, worked: [] }); continue; }
      // progress that came over from the original tracker, the same on every placeholder circuit, can move to the real panel
      const stages = ['inst', 'bt', 'ft', 'te', 'lab', 'qa'];
      const sig = c => stages.filter(k => c.st && c.st[k]).join(',');
      const onlyImported = cs.every(([ref, c]) => stages.every(k => !(c.st && c.st[k]) || c.st[k].imp) && !c.blocker && !lt[ref] && !lq[ref] && !plain(c).note);
      const uniform = onlyImported && new Set(cs.map(([, c]) => sig(c))).size === 1 && sig(cs[0][1]);
      const target = out.find(x => x.id === nu);
      if (opts.carry && uniform && target && target.kind === 'new') {
        const done = sig(cs[0][1]).split(','), d0 = cs[0][1].st[done[0]].d;
        Object.values(target.payload.circuits).forEach(c => { if (c.status !== 'Active') return; done.forEach(k => { c.st[k] = { d: (cs[0][1].st[k] && cs[0][1].st[k].d) || d0, imp: true, src: 'placeholder ' + old }; }); });
        target.carried = { from: old, stages: done };
        out.push({ id: old, kind: 'retire', replacedBy: nu, worked: [], carried: done });
      } else {
        out.push({ id: old, kind: 'keep', replacedBy: nu, worked: worked.map(([, c]) => lbl(c)), uniform: !!uniform, stages: uniform ? sig(cs[0][1]) : '' });
      }
    }
    return out;
  }
  function addPre(p, ref, c, r, liveC, me, now) {
    const pre = r.pre, d = pre.d || todayIso();
    const rec = { tester: pre.tester || '', qc: pre.qc || '', kit: '', note: 'From the paper test record sheet', ring: false, pol: !!pre.pol, d, at: now, by: me.id, src: 'sheet' };
    ['r12', 'r2', 'rpp', 'rnn', 'ree', 'irpn', 'irpne', 'irppp', 'irbus'].forEach(k => { if (pre[k]) rec[k] = pre[k]; });
    const v = preVerdict({ ...c, three: three(c) }, rec);
    p.testsPayload = p.testsPayload || { circuits: {} };
    p.testsPayload.circuits[ref] = { pre: rec };
    if (pre.tester) p.testsPayload.sheet = { preA: { name: pre.tester, qc: pre.qc || '', date: fmtDMY(d) } };
    p.tests.push({ ref, label: lbl(c), verdict: v });
    if (v === 'pass' && !(liveC && liveC.st && liveC.st.te)) {
      const tgt = p.payload.circuits[ref] = p.payload.circuits[ref] || {};
      tgt.st = { ...(tgt.st || {}), te: { d, by: me.id, at: now, src: 'sheet' } };
    }
  }

  async function apply(plans, me, file, onStep) {
    const colo = file.area, done = [];
    for (const p of plans) {
      onStep(p.id);
      if (p.kind === 'new') await S.db.doc('boards/' + p.id).set(p.doc);
      else if (p.kind === 'update' && (Object.keys(p.payload.circuits).length || p.payload.fed)) await S.db.doc('boards/' + p.id).update(p.payload);
      else if (p.kind === 'retire') await S.db.doc('boards/' + p.id).update({ retired: true, replacedBy: p.replacedBy, retiredAt: Date.now(), retiredBy: me.id });
      if (p.testsPayload) {
        const ref = S.db.doc('tests/' + p.id);
        try { await ref.update(p.testsPayload); }
        catch (e) { if (e && e.code === 'invalid_argument') await ref.set(merge({ board: p.id, colo, circuits: {} }, p.testsPayload)); else throw e; }
      }
      if (p.kind !== 'keep') {
        const v = p.kind === 'new' ? 'added board, ' + p.added.length + ' circuits' : p.kind === 'retire' ? 'retired placeholder board (replaced by ' + p.replacedBy + ')' : p.changes.length + ' updated, ' + p.added.length + ' added' + (p.tests.length ? ', ' + p.tests.length + ' paper tests' : '');
        try { await S.db.collection('events').doc(uid()).set({ act: 'schedule', board: p.id, at: Date.now(), by: me.id, team: null, v }); } catch (e) {}
      }
      done.push(p.id);
    }
    return done;
  }

  function report(file, plans) {
    const L = ['HEL16 schedule update · ' + file.area + ' · from ' + (file.source || 'sheets') + ' · ' + new Date().toLocaleString('en-GB'), ''];
    for (const p of plans) {
      if (p.kind === 'retire') { L.push(p.id + ': RETIRE placeholder board, replaced by ' + p.replacedBy + (p.carried ? '; its recorded progress (' + p.carried.join(', ') + ') moved onto the active circuits of ' + p.replacedBy : ' (no work recorded)'), ''); continue; }
      if (p.kind === 'keep') { L.push(p.id + ': KEPT placeholder board because work is recorded on: ' + p.worked.join('; '), ''); continue; }
      L.push(p.id + (p.kind === 'new' ? ' (NEW BOARD)' : '') + ': ' + p.changes.length + ' circuits updated, ' + p.added.length + ' added, ' + p.missing.length + ' not on the new sheet, ' + p.tests.length + ' paper tests');
      p.changes.forEach(c => L.push('  UPDATE ' + c.ref + ' ' + c.label + ' [matched by ' + c.how + '] :: ' + Object.entries(c.fields).map(([k, [a, b]]) => LABEL[k] + ' "' + a + '" -> "' + b + '"').join('; ') + (c.work ? '  [work kept]' : '')));
      p.added.forEach(c => L.push('  ADD    ' + c.ref + ' ' + c.label));
      p.missing.forEach(c => L.push('  NOT ON SHEET (left as is) ' + c.ref + ' ' + c.label + (c.work ? '  [has work]' : '')));
      p.tests.forEach(c => L.push('  PAPER TEST ' + c.ref + ' ' + c.label + ' -> ' + c.verdict));
      p.conflicts.forEach(c => L.push('  CHECK  ' + c));
      L.push('');
    }
    return L.join('\n');
  }

  // ---------- UI inside Account (Editors) ----------
  function mount(host, me) {
    const box = host.querySelector('#schedBox'); if (!box) return;
    let file = null, plans = null;
    const msg = t => { box.querySelector('#schedMsg').innerHTML = t; };
    const inp = box.querySelector('#schedFile');
    inp.onchange = async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
      if (!navigator.onLine) { msg('Needs signal: the update is checked against the live site data.'); return; }
      try { file = JSON.parse(await f.text()); if (!file.boards || !file.area) throw new Error('not a schedule update file'); }
      catch (x) { msg('Could not read that file (' + esc(x.message || 'error') + ').'); return; }
      await preview(false);
    };
    inp._replan = () => preview(true);
    async function preview(keepCarry) {
      const was = box.querySelector('#schedCarry'), carryOn = keepCarry && was && was.checked;
      try {
        if (!keepCarry) msg('Checking against the live site data…');
        const ids = Object.keys(file.boards).concat(Object.keys(file.retire || {}));
        const live = keepCarry && S._schedLive ? S._schedLive : await liveData(ids);
        S._schedLive = live; S._schedCarry = !!carryOn;
        plans = plan(file, live, me, { carry: !!carryOn });
        const n = k => plans.filter(p => p.kind === k), sum = f => plans.reduce((a, p) => a + ((p[f] && p[f].length) || 0), 0);
        const rows = plans.map(p => {
          const row = (body, tone) => '<div class="chk" style="display:grid;gap:2px;align-items:start"><b style="font:700 15px var(--f-display);letter-spacing:.03em;overflow-wrap:anywhere">' + esc(p.id) + (p.kind === 'new' ? ' <span class="chip ok">new</span>' : '') + '</b><span style="font-size:13px;' + (tone ? 'color:' + tone : '') + '">' + body + '</span></div>';
          if (p.kind === 'retire') return row('Placeholder retired, replaced by ' + esc(p.replacedBy) + (p.carried ? '. Its progress (' + esc(p.carried.join(', ')) + ') moves onto that panel’s active circuits.' : '.'));
          if (p.kind === 'keep') return row('Placeholder kept as it is: progress recorded on ' + p.worked.length + ' circuit(s)' + (p.uniform ? ' (' + esc(p.stages) + ' on every circuit)' : '') + '.', 'var(--part)');
          const bits = p.kind === 'new' ? [p.added.length + ' circuits'] : [p.changes.length + ' updated', p.added.length + ' added', p.missing.length + ' not on sheet (kept)'];
          if (p.tests.length) bits.push(p.tests.length + ' paper tests');
          return row(bits.join(' · ') + (p.conflicts.length ? ' · <b style="color:var(--part)">' + p.conflicts.length + ' to check</b>' : ''));
        }).join('');
        msg('<p style="margin:0"><b>' + esc(file.area) + '</b>: ' + n('new').length + ' new boards, ' + n('update').length + ' existing boards, ' + sum('changes') + ' circuits with schedule changes, ' + sum('added') + ' new circuits, ' + sum('tests') + ' paper test results. ' + sum('missing') + ' circuits in the app are not on the new sheets and will be left exactly as they are.</p>' +
          '<p class="by" style="margin:0">Work already recorded (ticks, tests, QA/QC, blockers, notes, comments) is never changed.</p>' +
          '<div class="checks">' + rows + '</div><p class="by" style="margin:0">“To check” items are listed in the full report: mostly likely typos on the sheets. They don’t stop the update.</p>' +
          (plans.some(p => (p.kind === 'keep' && p.uniform) || p.carried) ? '<label class="chk"><input type="checkbox" id="schedCarry"' + (plans.some(p => p.carried) ? ' checked' : '') + '><span>Placeholder UPS boards: move their recorded progress onto the new battery panels’ active circuits, then retire the placeholders</span></label>' : '') +
          '<div class="tools"><button class="btn" data-schedrep>Download full report</button><button class="btn team" data-schedgo>Apply update</button></div>');
        const cb = box.querySelector('#schedCarry'); if (cb) cb.onchange = () => { box.querySelector('#schedFile')._replan(); };
      } catch (x) { msg('Could not check the update (' + esc(x.message || x.code || 'error') + '). Check your signal and try again.'); }
    }
    box.addEventListener('click', async e => {
      if (e.target.closest('[data-schedrep]')) { try { await S.downloads.save({ filename: 'HEL16-' + file.area + '-schedule-update-report.txt', data: report(file, plans) }); } catch (x) {} return; }
      const go = e.target.closest('[data-schedgo]'); if (!go) return;
      if (!go.dataset.armed) { go.dataset.armed = '1'; go.textContent = 'Tap again to apply'; return; }
      go.disabled = true;
      try {
        // re-check against the very latest data right before writing
        const live = await liveData(Object.keys(file.boards).concat(Object.keys(file.retire || {})));
        plans = plan(file, live, me, { carry: !!S._schedCarry });
        await apply(plans, me, file, id => { go.textContent = 'Updating ' + id + '…'; });
        msg('<p style="margin:0"><b>Done.</b> ' + esc(file.area) + ' boards are updated. Recorded work was left as it was.</p><div class="tools"><button class="btn" data-schedrep>Download full report</button></div>');
        if (typeof loadSite === 'function') { S.site = null; loadSite(); }
      } catch (x) { go.disabled = false; go.textContent = 'Apply update'; delete go.dataset.armed; msg('Stopped part way (' + esc(x.code || x.message || 'error') + '). Nothing recorded was lost; check your signal and apply again: it picks up where it stopped.'); }
    });
  }
  const panelHtml = () => '<section class="panel" id="schedBox"><h3>Update board schedules</h3><p class="by" style="margin:0">Load a schedule update file built from the board test record sheets. You see every change before anything is written. Needs signal.</p>' +
    '<div class="tools"><label class="btn">Choose update file<input type="file" id="schedFile" accept=".json,application/json" hidden></label></div><div id="schedMsg" class="by" style="display:grid;gap:8px"></div></section>';
  window.HEL16Schedule = { plan, apply, report, mount, panelHtml, liveData };
})();
