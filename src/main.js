import './style.css';
import { RfoEngine, parseAddr, colName } from './engine.js';
import { Rates, computeCost, gatherInputs, RATE_FILES } from './cost.js';
import { formatValue, serialToParts, dateToSerial } from './format.js';

const BASE = import.meta.env.BASE_URL || './';
const $ = (s, el = document) => el.querySelector(s);
const DRAFT_KEY = 'mirc-rfo-draft-v1';
const FB_KEY = 'mirc-rfo-feedback-v1';
const FILE_FORMAT = 'mirc-rfo-webapp';
const S = { engine: null, ui: null, rates: null, ratesPromise: null, cells: {}, inputs: {}, defaults: {}, cfMap: {}, view: 'form', cost: {} };
window.__rfo = S;

const fetchJSON = (f) => fetch(BASE + 'data/' + f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }

// ------------------------------------------------------------------ boot
async function boot() {
  const [eng, ui, core] = await Promise.all([fetchJSON('engine.json'), fetchJSON('ui.json'), fetchJSON(RATE_FILES.core)]);
  S.ui = ui; S.rates = new Rates(core);
  S.engine = new RfoEngine(eng);
  for (const sheet of ['RFO Form', 'RFO Summary']) {
    for (const [a, c] of Object.entries(ui[sheet].cells)) if (c.input) { const k = `${sheet}!${a}`; S.defaults[k] = c.v ?? null; }
  }
  buildCfMap(eng.cf);
  renderSheet($('#formGrid'), 'RFO Form', 'B', 'K', [[2, formLastRow(ui)]]);   // CS12: the order type + cost estimate live in the SOLDIER DATA block (rows 7-28)
  renderSheet($('#statusGrid'), 'RFO Form', 'M', 'S', [[2, 50]]);
  renderSheet($('#summaryGrid'), 'RFO Summary', 'B', 'I', [[2, 76]]);
  renderHelp(); renderFeedback(); renderSources();
  // restore a draft if the user opted in on this device
  const draft = localStorage.getItem(DRAFT_KEY);
  $('#draftToggle').checked = !!draft;
  if (draft) { try { applyInputs(JSON.parse(draft).inputs || {}); toast('Draft restored from this device.'); } catch (e) { /* ignore broken draft */ } }
  refresh();
  wireChrome();
  route();
  document.body.classList.add('ready');
}

// ------------------------------------------------------------------ sheet rendering
// last form row = print area end - 1 (the workbook's print area stops one row under the approvals block)
function formLastRow(ui) { const m = /:\$?[A-Z]+\$?(\d+)/.exec(ui['RFO Form'].printArea || ''); return m ? +m[1] - 1 : 157; }
const PX = (w) => Math.round((w || 8.43) * 7 + 5);
function renderSheet(host, sheet, c0, c1, ranges) {
  const ui = S.ui[sheet];
  const ci0 = parseAddr(c0 + '1').col, ci1 = parseAddr(c1 + '1').col;
  const widths = []; for (let c = ci0; c <= ci1; c++) widths.push(PX(ui.colWidths[colName(c)]));
  host.style.gridTemplateColumns = widths.map((w) => `minmax(0, ${w}fr)`).join(' ');
  host.dataset.sheet = sheet;
  const covered = new Set();
  for (const [a, m] of Object.entries(ui.merges)) for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (!(r === m.r0 && c === m.c0)) covered.add(colName(c - 1) + r);
  let gridRow = 0;
  for (const [r0, r1] of ranges) {
    for (let r = r0; r <= r1; r++) {
      gridRow++;
      const h = ui.rowHeights[r];
      let any = false;
      for (let c = ci0; c <= ci1; c++) {
        const a = colName(c) + r;
        if (covered.has(a)) continue;
        const info = ui.cells[a]; const m = ui.merges[a];
        if (!info) continue;
        const isEmpty = !info.input && !info.f && (info.v === null || info.v === undefined || info.v === '');
        if (isEmpty && !info.fill) continue;
        any = true;
        const el = document.createElement('div');
        el.className = 'cell' + (isEmpty ? ' fillonly' : '');
        el.dataset.addr = a;
        const cs = m ? Math.min(m.c1, ci1 + 1) - m.c0 + 1 : 1, rs = m ? m.r1 - m.r0 + 1 : 1;
        el.style.gridColumn = `${c - ci0 + 1} / span ${cs}`;
        el.style.gridRow = `${gridRow} / span ${rs}`;
        styleBase(el, info);
        if (info.note) { el.title = info.note; el.classList.add('has-note'); }
        const key = `${sheet}!${a}`;
        const rec = { el, info, sheet, addr: a, key };
        if (info.input) buildInput(rec, ui.dv[a], labelFor(ui, r, c, ci0));
        else if (info.f) { rec.kind = 'f'; el.classList.add('calc'); }
        else { rec.kind = 'c'; el.textContent = formatValue(info.v, info.fmt); if (/^\s*[◆▍]/.test(String(info.v || '')) || (info.fill && /^#(1F3864|2F5496|1D4ED8|15803D|7E22CE|0369A1|C2410C|0F766E|A16207|4338CA|4D7C0F)$/i.test(info.fill))) el.classList.add('hdr'); }
        if (info.link) { el.classList.add('link'); el.tabIndex = 0; el.setAttribute('role', 'link'); const go = () => followLink(info.link); el.addEventListener('click', go); el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); }); }
        (S.cells[key] = S.cells[key] || []).push(rec);
        host.appendChild(el);
      }
      if (!any) { const sp = document.createElement('div'); sp.className = 'spacer'; sp.style.gridRow = `${gridRow}`; sp.style.gridColumn = '1 / -1'; sp.style.height = Math.max(4, Math.min(18, (h || 6))) + 'px'; host.appendChild(sp); }
    }
  }
}
function styleBase(el, info) {
  const f = info.font || {};
  if (info.fill && info.fill.toUpperCase() !== '#FFFFFF') el.style.background = info.fill;
  if (f.color && f.color !== '#000000') el.style.color = f.color;
  if (f.b) el.style.fontWeight = '700';
  if (f.i) el.style.fontStyle = 'italic';
  if (f.sz) el.style.fontSize = Math.max(10, Math.min(22, f.sz * 1.18)) + 'px';
  if (info.al && info.al.h) el.style.textAlign = info.al.h === 'centerContinuous' ? 'center' : info.al.h;
  if (info.al && info.al.wrap) el.classList.add('wrap');
  if (info.bd) for (const s of info.bd) el.classList.add('bd-' + s);
  el._base = { bg: el.style.background, color: el.style.color, weight: el.style.fontWeight };
}
function labelFor(ui, r, c, ci0) {
  for (let k = c - 1; k >= ci0; k--) {
    const v = ui.cells[colName(k) + r]; if (v && !v.input && !v.f && v.v) return String(v.v).replace(/[*:]+\s*$/, '').trim();
  }
  for (let rr = r - 1; rr >= r - 3; rr--) { const v = ui.cells['B' + rr]; if (v && !v.input && v.v) return String(v.v).trim() + ' (continued)'; }
  return 'Field ' + colName(c) + r;
}
function followLink(link) {
  const m = /^#?'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)/.exec(link || '');
  if (!m) return;
  if (m[1] === 'RFO Summary') return go('summary');
  go('form');
  const target = S.cells[`RFO Form!${m[2]}${m[3]}`]?.[0]?.el; if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ------------------------------------------------------------------ inputs
function buildInput(rec, dv, label) {
  const { el, key } = rec; rec.kind = 'in'; rec.dv = dv; el.classList.add('input');
  let ctl;
  if (dv && dv.type === 'list') {
    const strict = dv.strict !== false;
    if (strict) { ctl = document.createElement('select'); rec.ctlType = 'select'; }
    else {
      ctl = document.createElement('input'); ctl.type = 'text'; rec.ctlType = 'combo';
      const dl = document.createElement('datalist'); dl.id = 'dl-' + key.replace(/[^A-Za-z0-9]/g, '-'); ctl.setAttribute('list', dl.id); el.appendChild(dl); rec.datalist = dl;
      ctl.autocomplete = 'off';
    }
  } else if (dv && dv.type === 'date') { ctl = document.createElement('input'); ctl.type = 'date'; rec.ctlType = 'date'; }
  else if (dv && (dv.type === 'whole' || dv.type === 'decimal')) { ctl = document.createElement('input'); ctl.type = 'number'; ctl.min = '0'; ctl.step = dv.type === 'whole' ? '1' : 'any'; ctl.inputMode = 'numeric'; rec.ctlType = 'number'; }
  else {
    const wide = (S.ui[rec.sheet].merges[rec.addr] || {}).c1 - (S.ui[rec.sheet].merges[rec.addr] || {}).c0 >= 4;
    ctl = document.createElement(wide ? 'textarea' : 'input'); if (!wide) ctl.type = 'text'; else ctl.rows = 1; rec.ctlType = 'text';
    if (dv && dv.type === 'custom' && /--/.test(dv.formula1 || '')) ctl.inputMode = 'numeric';
  }
  ctl.className = 'ctl'; ctl.setAttribute('aria-label', label); ctl.dataset.key = key;
  if (dv && (dv.prompt || dv.promptTitle)) ctl.title = [dv.promptTitle, dv.prompt].filter(Boolean).join(' - ');
  rec.ctl = ctl; el.appendChild(ctl);
  const commit = () => onUserInput(rec);
  if (rec.ctlType === 'select') ctl.addEventListener('change', commit);
  else { ctl.addEventListener('change', commit); ctl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ctl.tagName !== 'TEXTAREA') { ev.preventDefault(); commit(); } }); }
}
function readControl(rec) {
  const v = rec.ctl.value;
  if (rec.ctlType === 'select') { if (v === '') return null; const o = rec.optValues && rec.optValues[+v]; return o === undefined ? rec.current : o; }
  if (v === '') return null;
  if (rec.ctlType === 'date') { const [y, m, d] = v.split('-').map(Number); return dateToSerial(y, m, d); }
  if (rec.ctlType === 'number') { const n = Number(v); return Number.isFinite(n) ? n : v; }
  if (rec.ctlType === 'combo' && rec.optValues) { const hit = rec.optValues.find((o) => String(o) === v); if (hit !== undefined) return hit; }
  return v;
}
function onUserInput(rec) {
  const val = readControl(rec);
  const prev = S.engine.get(rec.addr, rec.sheet);
  setInput(rec.key, val);
  // custom / numeric validation (same rule the workbook's Data Validation uses)
  const dv = rec.dv; let ok = true, msg = '';
  if (dv && val !== null) {
    if (dv.check) ok = S.engine.calc('=' + dv.check) === true;
    else if (dv.type === 'whole') ok = typeof val === 'number' && Number.isInteger(val) && val >= 0;
    else if (dv.type === 'date') ok = typeof val === 'number' && val >= dateToSerial(1960, 1, 1);
    msg = dv.error || 'That value isn\'t allowed here.';
  }
  if (!ok) { setInput(rec.key, prev === '' ? null : prev); toast('⚠ ' + msg); }
  afterChange();
  if (!ok) { rec._sig = null; const a = document.activeElement; if (a === rec.ctl) rec.ctl.blur(); syncControl(rec, S.engine.get(rec.addr, rec.sheet)); }
}
export function setInput(key, val) {
  const [sheet, a] = key.split('!');
  S.engine.set(a, val, sheet);
  if (val === null || val === undefined || val === '') S.inputs[key] = null; else S.inputs[key] = val;
}
function applyInputs(map) {
  S.engine.batch(() => { for (const [k, v] of Object.entries(map)) { const c = S.cells[k]; if (c && c[0].kind === 'in') setInput(k, v); } });
}
function resetInputs() {
  S.engine.batch(() => { for (const [k, v] of Object.entries(S.defaults)) setInput(k, v); });
  S.inputs = {};
}
function changedInputs() {
  const out = {};
  for (const k of Object.keys(S.defaults)) { const v = S.engine.get(k.split('!')[1], k.split('!')[0]); const d = S.defaults[k]; if ((v ?? '') !== (d ?? '')) out[k] = v === '' ? null : v; }
  return out;
}
function afterChange() {
  refresh();
  if ($('#draftToggle').checked) saveDraft();
}
function saveDraft() { localStorage.setItem(DRAFT_KEY, JSON.stringify({ saved: new Date().toISOString(), inputs: changedInputs() })); }

// ------------------------------------------------------------------ cost (lazy rate tables)
function ensureRates() {
  if (S.rates.loaded) return Promise.resolve();
  if (!S.ratesPromise) {
    $('#costLoading').classList.add('show');
    S.ratesPromise = Promise.all([fetchJSON(RATE_FILES.bah), fetchJSON(RATE_FILES.perdiem), fetchJSON(RATE_FILES.zip)]).then(([b, p, z]) => {
      S.rates.bah = b; S.rates.pd = p; S.rates.zip = z; $('#costLoading').classList.remove('show'); refresh();
    }).catch((e) => { $('#costLoading').textContent = 'Could not load the rate tables (' + e.message + ').'; });
  }
  return S.ratesPromise;
}
function updateCost() {
  const today = Math.floor(S.engine.calc('=TODAY()'));
  const inp = gatherInputs(S.engine, today);
  const wantsEstimate = inp.SEL_RANK && typeof inp.X_START === 'number' && typeof inp.SEL_DAYS === 'number';
  if (!S.rates.loaded) { if (wantsEstimate || S.view === 'summary') ensureRates(); S.engine.setCost({}); S.cost = {}; return; }
  S.cost = computeCost(S.rates, inp);
  S.engine.setCost(S.cost);
}

// ------------------------------------------------------------------ refresh
function buildCfMap(rules) {
  S.cfRules = rules;
  rules.forEach((r, i) => { for (const c of r.cells) (S.cfMap[`${r.sheet}!${c}`] = S.cfMap[`${r.sheet}!${c}`] || []).push(i); });
  for (const k in S.cfMap) S.cfMap[k].sort((a, b) => rules[a].priority - rules[b].priority);
}
function refresh() {
  updateCost();
  const E = S.engine; const cf = E.cfValues();
  for (const [key, recs] of Object.entries(S.cells)) {
    for (const rec of recs) {
      const v = rec.kind === 'c' ? null : E.get(rec.addr, rec.sheet);
      if (rec.kind === 'f') { const t = formatValue(v, rec.info.fmt); if (rec.el.textContent !== t) rec.el.textContent = t; rec.el.classList.toggle('blank', t === '' && !rec.info.fill); }
      else if (rec.kind === 'in') syncControl(rec, v);
      // conditional formatting
      const idx = S.cfMap[key]; let bg = null, color = null, bold = null;
      if (idx) for (const i of idx) { if (cf[i] !== true) continue; const r = S.cfRules[i]; if (!bg && r.fill) bg = r.fill; if (!color && r.font) color = r.font; if (bold === null && r.bold) bold = true; if (r.stop) break; }
      const b = rec.el._base;
      rec.el.style.background = bg || b.bg; rec.el.style.color = color || b.color; rec.el.style.fontWeight = bold ? '700' : b.weight;
      const red = bg && /^#FFC7CE$/i.test(bg);
      rec.el.classList.toggle('is-red', !!red);
      rec.el.classList.toggle('cf-hidden', !!(bg && /^#FEFEFE$/i.test(bg)));   // workbook sentinel: 'not relevant now' (MORE OPTIONS = HIDE, PCS-only inputs)
      rec.el.classList.toggle('is-muted', !!(bg && /^#EDEDED$/i.test(bg)) || !!(color && /^#A6A6A6$/i.test(color)));
      if (rec.ctl) { rec.ctl.style.background = bg || ''; rec.ctl.setAttribute('aria-invalid', red ? 'true' : 'false'); }
    }
  }
  // chrome
  const st = String(E.get('M4') || '');
  $('#statusText').textContent = st || '…';
  $('#statusToggle').classList.toggle('ok', st.includes('READY TO SUBMIT'));
  $('#statusToggle').classList.toggle('bad', st.includes('NOT READY'));
  $('#costChip').textContent = S.cost.E_ON ? 'Est. cost ' + formatValue(S.cost.E_TOTAL, '"$"#,##0.00') : '';
  $('#costChip').onclick = () => followLink("#'RFO Form'!C17");
}
function syncControl(rec, v) {
  const ctl = rec.ctl; rec.current = v === '' ? null : v;
  if (rec.ctlType === 'select' || rec.ctlType === 'combo') {
    const dv = rec.dv; const opts = dv.options ? dv.options : /^RT_/.test(dv.listName) ? (S.rates.core.ranges[dv.listName] || []).map((x) => x[0]).filter((x) => x !== null && x !== '') : S.engine.listOptions(dv.listName);
    const sig = opts.join('\u0001') + '\u0002' + (v ?? '');
    if (rec._sig !== sig) {
      rec._sig = sig; rec.optValues = opts.slice();
      if (rec.ctlType === 'select') {
        ctl.textContent = '';
        const blank = document.createElement('option'); blank.value = ''; blank.textContent = ''; ctl.appendChild(blank);
        opts.forEach((o, i) => { const op = document.createElement('option'); op.value = String(i); op.textContent = formatValue(o); ctl.appendChild(op); });
        if (v !== null && v !== '' && !opts.some((o) => String(o) === String(v))) {
          rec.optValues.push(v); const op = document.createElement('option'); op.value = String(rec.optValues.length - 1); op.textContent = formatValue(v) + '  (not in list)'; ctl.appendChild(op);
        }
      } else {
        rec.datalist.textContent = '';
        for (const o of opts) { const op = document.createElement('option'); op.value = formatValue(o); rec.datalist.appendChild(op); }
      }
    }
    if (rec.ctlType === 'select') { const i = v === null || v === '' ? '' : String(rec.optValues.findIndex((o) => String(o) === String(v))); if (ctl.value !== i) ctl.value = i; }
    else if (document.activeElement !== ctl) ctl.value = v === null ? '' : formatValue(v);
  } else if (rec.ctlType === 'date') {
    const s = typeof v === 'number' ? (() => { const p = serialToParts(v); return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; })() : '';
    if (ctl.value !== s && document.activeElement !== ctl) ctl.value = s;
  } else if (document.activeElement !== ctl) {
    const s = v === null || v === '' ? '' : String(v); if (ctl.value !== s) ctl.value = s;
  }
  rec.el.dataset.value = v === null ? '' : String(v);
  // plain-text copy of the value for printing (form controls are hidden on paper)
  let pt = '';
  if (v !== null && v !== '') pt = rec.ctlType === 'date' ? formatValue(v, rec.info.fmt && /[dy]/i.test(rec.info.fmt) ? rec.info.fmt : 'dd-mmm-yyyy') : formatValue(v, rec.ctlType === 'select' || rec.ctlType === 'combo' ? undefined : rec.info.fmt);
  if (rec.el.dataset.ptext !== pt) rec.el.dataset.ptext = pt;
}

// ------------------------------------------------------------------ views / chrome
function go(view) { location.hash = '#' + view; }
function route() {
  const v = (location.hash || '#form').slice(1); const prevView = S.view;
  S.view = ['form', 'summary', 'help', 'feedback'].includes(v) ? v : 'form';   // (CS12: no separate cost tab - #cost opens the form)
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + S.view));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  if (v === 'cost') setTimeout(() => followLink("#'RFO Form'!C17"), 0);
  if (S.view === 'summary') { ensureRates(); refresh(); }
  if (S.view === 'summary') fitSummary();
  if (prevView !== S.view) { document.body.classList.remove('drawer-open'); window.scrollTo(0, 0); }
}
function wireChrome() {
  window.addEventListener('hashchange', route);
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
  $('#statusToggle').addEventListener('click', () => { if (window.matchMedia('(max-width: 1100px)').matches) { go('form'); document.body.classList.toggle('drawer-open'); } else { $('#sidecol').scrollIntoView({ behavior: 'smooth' }); } });
  $('#drawerClose').addEventListener('click', () => document.body.classList.remove('drawer-open'));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') document.body.classList.remove('drawer-open'); });
  $('#btnSave').addEventListener('click', saveFile);
  $('#fileOpen').addEventListener('change', openFile);
  $('#btnClear').addEventListener('click', () => {
    if (!confirm('Clear every field on the form and the cost estimate? (Any draft saved on this device is deleted too.)')) return;
    resetInputs(); localStorage.removeItem(DRAFT_KEY); $('#draftToggle').checked = false; refresh(); toast('Form cleared (draft on this device deleted).');
  });
  $('#draftToggle').addEventListener('change', (e) => { if (e.target.checked) { saveDraft(); toast('Draft will be kept in this browser on this device.'); } else { localStorage.removeItem(DRAFT_KEY); toast('Draft deleted from this device.'); } });
  $('#btnPrint').addEventListener('click', () => doPrint(S.view === 'summary' ? 'summary' : 'form'));
  $('#btnPrintSummary').addEventListener('click', () => doPrint('summary'));
  window.addEventListener('beforeprint', () => { if (!document.body.dataset.print) document.body.dataset.print = S.view === 'summary' ? 'summary' : 'form'; preparePrint(); });
  window.addEventListener('afterprint', () => { delete document.body.dataset.print; fitSummary(); });
}
function preparePrint() {
  const mode = document.body.dataset.print;
  if (mode === 'summary') {
    const pg = $('#summaryGrid'); pg.style.zoom = ''; const h = pg.scrollHeight, w = pg.scrollWidth;
    const z = Math.min(1, 955 / h, 718 / w); pg.style.zoom = String(z.toFixed(3));
  }
}
function doPrint(mode) {
  if (mode === 'summary' && S.view !== 'summary') go('summary');
  document.body.dataset.print = mode;
  refresh();
  setTimeout(() => { preparePrint(); window.print(); }, 50);
}
function fitSummary() {
  const pg = $('#summaryGrid'); if (!pg) return; pg.style.zoom = '';
  if (document.body.dataset.print || S.view !== 'summary') return;
  const wrap = pg.closest('.page-wrap'); const avail = wrap.clientWidth - 12; const w = pg.scrollWidth;
  if (w > avail && avail > 0) pg.style.zoom = String(Math.max(0.4, avail / w));
}
window.addEventListener('resize', () => { if (S.view === 'summary') fitSummary(); });
// test / automation hooks (used by the Playwright suite)
window.__rfoApi = {
  set: (map) => { applyInputs(map); afterChange(); },
  get: (key) => { const [sh, a] = key.includes('!') ? key.split('!') : ['RFO Form', key]; return S.engine.get(a, sh); },
  cost: () => S.cost, ensureRates: () => ensureRates(), changed: () => changedInputs(), reset: () => { resetInputs(); refresh(); },
};
window.__rfoPreparePrint = (mode) => { document.body.dataset.print = mode; refresh(); preparePrint(); };

function saveFile() {
  const name = String(S.engine.get('C5') || 'RFO').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'RFO';
  const blob = new Blob([JSON.stringify({ format: FILE_FORMAT, version: 1, workbook: S.engine.data.md5, saved: new Date().toISOString(), inputs: changedInputs() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `RFO_${name}_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Saved to your downloads. Open it here later with 📂 Open file.');
}
function openFile(ev) {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  if (f.size > 2e6) return toast('⚠ That file is too big to be an RFO save file.');
  f.text().then((t) => {
    let j; try { j = JSON.parse(t); } catch (e) { return toast('⚠ Not a valid JSON file.'); }
    if (!j || j.format !== FILE_FORMAT || typeof j.inputs !== 'object') return toast('⚠ Not an RFO save file from this app.');
    const known = Object.keys(j.inputs).filter((k) => S.defaults.hasOwnProperty(k));
    const clean = {}; for (const k of known) { const v = j.inputs[k]; if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) clean[k] = typeof v === 'string' ? v.slice(0, 2000) : v; }
    resetInputs(); applyInputs(clean); afterChange();
    toast(`Loaded ${known.length} field(s) from ${f.name}` + (j.workbook && j.workbook !== S.engine.data.md5 ? ' (saved with a different version - double-check picks).' : '.'));
  });
}

// ------------------------------------------------------------------ help / sources / feedback
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderHelp() {
  const rows = S.ui.Instructions; let h = '<div class="banner info">This web app is an <b>unofficial planning aid</b> rebuilt from the MIRC RFO Excel workbook. It runs entirely in your browser: no server, no sign-in, no tracking. Your entries stay on this device unless you save a file yourself.</div>';
  h += '<h2>How to use this RFO</h2><p class="muted">Adapted from the workbook\'s Instructions tab (Excel-only steps such as macros, Alt+F8 or tab un-hiding don\'t apply here: use the buttons at the top).</p>';
  for (const r of rows.slice(2)) {
    const b = r[1], c = r[2];
    if (b && !c) h += `<h3>${esc(b)}</h3>`;
    else if (c && !b && /^[A-Z][^.]{0,60}$/.test(c) && !/^\d/.test(c)) h += `<h3>${esc(c)}</h3>`;
    else if (c) h += `<p>${esc(c)}</p>`;
  }
  h += '<h2>Rules the form enforces</h2><div class="tablewrap"><table class="rules"><thead><tr>';
  const R = S.ui.Rules; const hi = R.findIndex((r) => r[1] === '#');
  for (const x of R[hi].slice(1, 6)) h += `<th>${esc(x)}</th>`;
  h += '</tr></thead><tbody>';
  for (const r of R.slice(hi + 1)) { if (!r.slice(1, 6).some(Boolean)) continue; h += '<tr>' + r.slice(1, 6).map((x) => `<td>${esc(x)}</td>`).join('') + '</tr>'; }
  h += '</tbody></table></div>';
  h += `<h2>About this app</h2><ul><li>Built from <code>${esc(S.engine.data.source)}</code> (change set 13, md5 <code>${esc(S.engine.data.md5.slice(0, 12))}</code>) by a repeatable extraction script; the workbook's own formulas run in the browser through a spreadsheet engine (HyperFormula, GPL-3.0).</li><li>Saved files (💾) are plain JSON on your computer. "Keep a draft" uses this browser's local storage only; <b>Clear form</b> wipes it.</li><li>The order type (PCS / TDY, AR 37-104-4 Fig 8-19) and cost estimate sit in a compact box in the SOLDIER DATA block at the top of the form (rarely-needed inputs open with MORE OPTIONS = SHOW; hover a label with a dotted underline for its help) and use the official rate tables listed under the form. They are estimates, not entitlement determinations.</li></ul>`;
  $('#helpBody').innerHTML = h;
}
function renderSources() {
  const src = S.rates.core.sources; if (!src || !src.length) return;
  let h = '<div class="tablewrap"><table class="rules"><thead><tr>' + src[0].map((x) => `<th>${esc(x)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of src.slice(1)) h += '<tr>' + r.map((x, i) => `<td>${i === 2 ? String(x || '').split(/\s+·\s+|\s{2,}/).map((u) => /^https?:/.test(u) ? `<a href="${esc(u.split(' ')[0])}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u)).join('<br>') : esc(x)}</td>`).join('') + '</tr>';
  $('#sourcesTable').innerHTML = h + '</tbody></table></div>';
}
function fbLoad() { try { return JSON.parse(localStorage.getItem(FB_KEY) || '[]'); } catch (e) { return []; } }
function fbSave(list) { localStorage.setItem(FB_KEY, JSON.stringify(list)); }
function renderFeedback() {
  const list = fbLoad(); const likes = list.filter((x) => x.type === 'Like').length;
  $('#feedbackBody').innerHTML = `
  <h2>Feedback</h2>
  <div class="banner info">Feedback is stored <b>only in this browser</b> (local storage). Nothing is sent anywhere. To share it with the RFO owner, use <b>Download my feedback</b> and email the file.</div>
  <div class="fb-row"><button id="fbLike" class="like">👍 This form was useful</button><span class="muted">You've liked it ${likes} time(s) on this device.</span></div>
  <form id="fbForm" class="fb-form">
    <label>Rating (1-5) <select name="rating" required><option value="">pick</option>${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('')}</select></label>
    <label>Was the form useful? <select name="useful"><option></option><option>YES</option><option>NO</option></select></label>
    <label class="full">Comments <textarea name="comment" maxlength="1000" rows="3"></textarea></label>
    <label class="full">Suggested improvement <textarea name="suggest" maxlength="1000" rows="3"></textarea></label>
    <div class="full"><button type="submit">Save feedback on this device</button></div>
  </form>
  <h3>Saved on this device (${list.length})</h3>
  <div class="tablewrap"><table class="rules"><thead><tr><th>When</th><th>Type</th><th>Rating</th><th>Useful</th><th>Comment</th><th>Suggestion</th></tr></thead><tbody>
  ${list.slice().reverse().map((x) => `<tr><td>${esc(x.when.replace('T', ' ').slice(0, 16))}</td><td>${esc(x.type)}</td><td>${esc(x.rating)}</td><td>${esc(x.useful)}</td><td>${esc(x.comment)}</td><td>${esc(x.suggest)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing yet.</td></tr>'}
  </tbody></table></div>
  <div class="fb-row"><button id="fbDownload">⬇ Download my feedback (CSV)</button><button id="fbDelete" class="danger">Delete my feedback</button></div>
  <h3>Usage statistics</h3>
  <p class="muted">A static site can't collect central usage counts or feedback by itself. Options if the owner wants them later: a free Google Form (responses land in a Google Sheet) linked from this page; a privacy-friendly counter such as GoatCounter; or a small serverless endpoint. None is wired in: this build makes no network requests beyond its own files.</p>`;
  $('#fbLike').onclick = () => { const l = fbLoad(); l.push({ when: new Date().toISOString(), type: 'Like', rating: '', useful: 'YES', comment: '', suggest: '' }); fbSave(l); renderFeedback(); toast('Thanks! 👍 saved on this device.'); };
  $('#fbForm').onsubmit = (ev) => { ev.preventDefault(); const f = new FormData(ev.target); const l = fbLoad(); l.push({ when: new Date().toISOString(), type: 'Feedback', rating: f.get('rating'), useful: f.get('useful'), comment: String(f.get('comment') || '').trim(), suggest: String(f.get('suggest') || '').trim() }); fbSave(l); renderFeedback(); toast('Feedback saved on this device.'); };
  $('#fbDownload').onclick = () => {
    const l = fbLoad(); const q = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const csv = 'when,type,rating,useful,comment,suggestion\n' + l.map((x) => [x.when, x.type, x.rating, x.useful, x.comment, x.suggest].map(q).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'RFO_feedback.csv'; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
  };
  $('#fbDelete').onclick = () => { if (confirm('Delete all feedback saved on this device?')) { localStorage.removeItem(FB_KEY); renderFeedback(); } };
}

boot().catch((e) => { console.error(e); document.body.classList.add('ready'); $('#statusText').textContent = 'Failed to load: ' + e.message; });
