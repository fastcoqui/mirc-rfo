// Shared helpers for the node:test suites: load the generated JSON, run a scenario through the
// workbook-formula engine + the JS cost engine exactly like the browser does.
import fs from 'fs';
import { RfoEngine, setNow } from '../src/engine.js';
import { Rates, computeCost, gatherInputs } from '../src/cost.js';
import { isInput } from '../tools/parity.mjs';
const J = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
export const data = J('../public/data/engine.json');
export const ui = J('../public/data/ui.json');
export const rates = new Rates(J('../public/data/rates-core.json'));
rates.bah = J('../public/data/rates-bah.json'); rates.pd = J('../public/data/rates-perdiem.json'); rates.zip = J('../public/data/rates-zip.json');
export const cellmap = J('./fixtures/cellmap.json');
export const caseNames = J('./fixtures/index.json');
export const fixture = (n) => J(`./fixtures/${n}.json`);
export { isInput, setNow };

/** Run inputs ({'RFO Form!C5': ..}) through engine + JS cost (the real app pipeline). */
export function runInputs(inputs, now = new Date('2026-10-31T22:00:00')) {
  setNow(now);
  const e = new RfoEngine(data);
  e.batch(() => { for (const [k, v] of Object.entries(inputs)) if (isInput(k)) e.set(k, v); });
  const today = Math.floor(e.calc('=TODAY()'));
  const est = computeCost(rates, gatherInputs(e, today));
  e.setCost(est);
  return { e, est };
}
export const runCase = (n) => { const fx = fixture(n); return { fx, ...runInputs(fx.inputs, new Date(fx.recalculated)) }; };

const F = 'RFO Form';
export function view(e) {
  const g = (a, s = F) => e.get(a, s);
  const msgs = []; for (let r = 10; r <= 30; r++) { const m = g('M' + r); if (m) msgs.push(String(m)); }
  const codesTxt = String(g(cellmap.CELL.CODES) ?? '');
  const codes = codesTxt.split(', ').filter((x) => /^\d+$/.test(x.trim())).map(Number);
  return { status: String(g('M4') ?? ''), msgs, codes, codesTxt, tiles: [g('M8'), g('O8'), g('Q8')], meter: String(g('M6') ?? ''), pct: g('S6') };
}
/** red flag for a form cell: helper columns U (for C), V (for H), W (for E) = 1 */
export function isRed(e, cell) { const fc = { C: 'U', H: 'V', E: 'W' }[cell[0]]; return e.get(fc + cell.slice(1), F) === 1; }
export const has = (v, s) => v.msgs.some((m) => m.includes(s));
export const ready = (v) => v.status.includes('READY') && !v.status.includes('NOT');
/** dropdown options for a form cell as the UI builds them (ui.json DV + engine list) */
export function optionsFor(e, cell) {
  const dv = ui[F].dv[cell]; if (!dv) return null;
  if (dv.options) return dv.options;
  return e.listOptions(dv.listName);
}
export const codeOf = (opt) => { const m = /^(\d+) –/.exec(String(opt)); return m ? +m[1] : null; };
export function dispOf(e, code) {
  const c = e.name('OPT_CODE'), d = e.name('OPT_DISP');
  for (let i = 0; i < c.length; i++) if (c[i][0] === code) return d[i][0];
  throw new Error('no display for ' + code);
}
/** cost-input red flags (Rates!E_R_* formulas) evaluated against the live engine */
export const costRed = (e, k) => e.calc(rates.core.calcFormulas[k]);
