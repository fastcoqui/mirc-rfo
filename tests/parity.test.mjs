// Port of the workbook test suite at the value level: every one of the 71 scenarios used by the
// 162 Excel tests is run through the web engine (+ JS cost engine) and every formula cell on the
// RFO Form / Summary / Lists / AI_Engine sheets (8,700+ per case) must equal LibreOffice's result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { caseNames, runCase, costRed } from './helpers.mjs';
import { norm } from '../tools/parity.mjs';
const SKIP = new Set(['E_BZROW', 'E_HZROW', 'E_DZROW', 'E_PDROW', 'E_STDROW']);   // spreadsheet row numbers (implementation detail)
const same = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6) || (typeof b === 'boolean' && a === +b);

for (const n of caseNames) {
  test(`scenario ${n}: all formula cells + cost lines match the workbook`, () => {
    const { fx, e, est } = runCase(n);
    const bad = [];
    for (const [k, v] of Object.entries(fx.expected)) { const a = norm(e.get(k)), b = norm(v); if (!same(a, b)) bad.push(`${k}: web=${JSON.stringify(a)} xlsx=${JSON.stringify(b)}`); }
    for (const [k, v] of Object.entries(fx.est)) {
      if (SKIP.has(k)) continue;
      const a = norm(k.startsWith('E_R_') ? costRed(e, k) : est[k]), b = norm(v);
      if (!same(a, b)) bad.push(`cost ${k}: web=${JSON.stringify(a)} xlsx=${JSON.stringify(b)}`);
    }
    assert.deepEqual(bad.slice(0, 10), [], `${bad.length} mismatches`);
  });
}
