import fs from 'fs';
import { RfoEngine, setNow } from '../src/engine.js';
import { Rates, computeCost, gatherInputs } from '../src/cost.js';
import { isInput, norm } from './parity.mjs';
const D = (f) => JSON.parse(fs.readFileSync(new URL('../public/data/' + f, import.meta.url)));
const data = D('engine.json');
const rates = new Rates(D('rates-core.json')); rates.bah = D('rates-bah.json'); rates.pd = D('rates-perdiem.json'); rates.zip = D('rates-zip.json');
const SKIP = new Set(['E_BZROW', 'E_DZROW', 'E_PDROW']);   // spreadsheet row numbers - implementation detail
const names = process.argv.slice(2).length ? process.argv.slice(2) : JSON.parse(fs.readFileSync(new URL('../tests/fixtures/index.json', import.meta.url)));
const e = new RfoEngine(data); let tot = 0;
for (const n of names) {
  const fx = JSON.parse(fs.readFileSync(new URL(`../tests/fixtures/${n}.json`, import.meta.url)));
  const d = new Date(fx.recalculated); setNow(d);
  const e2 = new RfoEngine(data);
  e2.batch(() => { for (const [k, v] of Object.entries(fx.inputs)) if (isInput(k)) e2.set(k, v); });
  const today = Math.floor(e2.calc('=TODAY()'));
  const E = computeCost(rates, gatherInputs(e2, today));
  const bad = [];
  for (const [k, v] of Object.entries(fx.est)) {
    if (SKIP.has(k) || k.startsWith('E_R_')) continue;
    const a = norm(E[k]), b = norm(v);
    if (a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6) || (typeof b === 'boolean' && a === +b)) continue;
    bad.push([k, E[k], v]);
  }
  tot += bad.length; console.log(n, bad.length, n.startsWith('E') ? 'TOTAL=' + E.E_TOTAL : '');
  for (const b of bad.slice(0, 8)) console.log('   ', b[0], JSON.stringify(b[1]).slice(0, 90), '| LO:', JSON.stringify(b[2]).slice(0, 90));
}
console.log('TOTAL cost mismatches', tot);
