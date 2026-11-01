import fs from 'fs';
import { RfoEngine, setNow } from '../src/engine.js';
const data = JSON.parse(fs.readFileSync(new URL('../public/data/engine.json', import.meta.url)));
const ui = JSON.parse(fs.readFileSync(new URL('../public/data/ui.json', import.meta.url)));
export function norm(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
  if (typeof v === 'string' && /^#(N\/A|VALUE!?|REF!?|NAME\??|DIV\/0!?|NUM!?|ERROR|CYCLE|SPILL|LIC)/.test(v)) return '#ERR';
  if (typeof v === 'string' && v.startsWith('Err:')) return '#ERR';
  return v;
}
export function isInput(key) {
  const [s, a] = key.split('!');
  if (s === 'Lists' || s === 'AI_Engine') return true;
  const c = ui[s] && ui[s].cells[a];
  return !!(c && c.input);
}
export function runCase(fx, engine) {
  const e = engine || new RfoEngine(data);
  const d = new Date(fx.recalculated); setNow(d);
  e.batch(() => { for (const [k, v] of Object.entries(fx.inputs)) if (isInput(k)) e.set(k, v); });
  e.setCost(fx.est);
  const bad = [];
  for (const [k, v] of Object.entries(fx.expected)) {
    const got = e.get(k);
    const a = norm(got), b = norm(v);
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6) continue;
    if (typeof b === 'boolean' && typeof a === 'number' && +b === a) continue;
    bad.push([k, got, v]);
  }
  return { e, bad };
}
if ((process.argv[1] || '').endsWith('/parity.mjs')) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : JSON.parse(fs.readFileSync(new URL('../tests/fixtures/index.json', import.meta.url)));
  let tot = 0;
  for (const n of names) {
    const fx = JSON.parse(fs.readFileSync(new URL(`../tests/fixtures/${n}.json`, import.meta.url)));
    const { bad } = runCase(fx);
    tot += bad.length;
    console.log(n, bad.length);
    for (const b of bad.slice(0, +(process.env.SHOW || 6))) console.log('   ', b[0], JSON.stringify(b[1]).slice(0, 100), '| LO:', JSON.stringify(b[2]).slice(0, 100));
  }
  console.log('TOTAL mismatches', tot);
}
