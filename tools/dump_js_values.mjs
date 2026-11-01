// Compute every formula cell of every workbook test scenario with the WEB engine (+ JS cost engine) and dump them,
// so the original Python assertion suite can be re-run against web-app results (tools/py_bridge.py).
import fs from 'fs';
import { RfoEngine, setNow } from '../src/engine.js';
import { Rates, computeCost, gatherInputs } from '../src/cost.js';
import { isInput } from './parity.mjs';
const D = (f) => JSON.parse(fs.readFileSync(new URL('../public/data/' + f, import.meta.url)));
const data = D('engine.json'); const core = D('rates-core.json');
const rates = new Rates(core); rates.bah = D('rates-bah.json'); rates.pd = D('rates-perdiem.json'); rates.zip = D('rates-zip.json');
const names = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/index.json', import.meta.url)));
for (const n of names) {
  const fx = JSON.parse(fs.readFileSync(new URL(`../tests/fixtures/${n}.json`, import.meta.url)));
  setNow(new Date(fx.recalculated));
  const e = new RfoEngine(data);
  e.batch(() => { for (const [k, v] of Object.entries(fx.inputs)) if (isInput(k)) e.set(k, v); });
  const E = computeCost(rates, gatherInputs(e, Math.floor(e.calc('=TODAY()'))));
  e.setCost(E);
  for (const [k, f] of Object.entries(core.calcFormulas)) if (k.startsWith('E_R_')) E[k] = e.calc(f);
  const cells = {}; for (const k of Object.keys(fx.expected)) cells[k] = e.get(k);
  fs.writeFileSync(new URL(`../tests/js_values/${n}.json`, import.meta.url), JSON.stringify({ cells, est: E }));
  process.stdout.write('.');
}
console.log('\ndumped', names.length);
