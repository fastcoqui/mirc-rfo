// Explicit ports of the key workbook rules (decision tree v8 + user-approved rules, CS8 removals,
// conflicts, READY logic, cost samples). Values are computed by the web engine, not copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCase, runInputs, fixture, view, isRed, has, ready, optionsFor, codeOf, dispOf, cellmap, data, costRed } from './helpers.mjs';
const F = 'RFO Form!';
const { e: E0 } = runCase('T0_blank');

test('blank form: NOT READY, 0/11, no tree or conflict messages', () => {
  const v = view(E0);
  assert.match(v.status, /NOT READY/); assert.equal(v.pct, 0); assert.ok(!v.msgs.some((m) => m.includes('CONFLICT')));
});

test('Johnson AT example (tree slide 2): READY, 11/11, codes 12 17 21 34 47 229 247 252 253 259 260', () => {
  const { e } = runCase('T1c_AT_full_READY_johnson'); const v = view(e);
  assert.ok(ready(v), v.status); assert.ok(v.meter.endsWith('11/11'));
  assert.deepEqual(v.codes, [12, 17, 21, 34, 47, 229, 247, 252, 253, 259, 260]);
  assert.equal(e.get('C12', 'RFO Form') - e.get('C11', 'RFO Form'), 14);       // 15 days, start counts
});

test('PCS example (tree slide 3): codes 231 232 238 239 240 242, READY', () => {
  const v = view(runCase('T2_PCS_example').e);
  assert.deepEqual(v.codes, [231, 232, 238, 239, 240, 242]); assert.ok(ready(v));
});

test('AT with no codes is READY (nothing auto-included)', () => {
  const v = view(runCase('T1d_AT_full_no_codes_READY').e); assert.ok(ready(v)); assert.equal(v.codesTxt, '(answer the lanes above)');
});

test('removed codes 282 / 195 / 131 / 295 exist nowhere (code table, pick lists, generated data)', () => {
  const codes = E0.name('OPT_CODE').flat().filter((x) => x !== null && x !== '');
  for (const c of [282, 195, 131, 295]) {
    assert.ok(!codes.includes(c), `${c} in OPT_CODE`);
    const txt = JSON.stringify(data.sheets);
    assert.ok(!txt.includes(`"${c} –`), `"${c} –" option text found`);
  }
  for (const cell of Object.values(cellmap.GCELLS).flat()) {
    const opts = optionsFor(E0, cell) || [];
    assert.ok(!opts.map(codeOf).some((c) => [282, 195, 131, 295].includes(c)), cell);
  }
});

test('mileage YES adds only 272', () => {
  assert.deepEqual(view(runCase('X1_mileage_yes_only_272').e).codes, [272]);
});

test('13 with mileage NO + 250: no 13-conflict, codes 13 250 273', () => {
  const v = view(runCase('K4_13_clean_mileage_NO').e);
  assert.ok(!has(v, 'CONFLICT: 13')); assert.deepEqual(v.codes, [13, 250, 273]);
});

// ---- the 16 user-approved conflict pairs + the tree's 196 ✖ 244 ----
const APPROVED = cellmap.CONFLICTS.filter(([, , w]) => w.includes('user-approved')).map(([a, b]) => [a, b]);
test('there are exactly 16 user-approved conflict pairs in the workbook data', () => {
  assert.equal(APPROVED.length, 16);
  const A = E0.name('CONF_A').flat(), B = E0.name('CONF_B').flat();
  for (const [a, b] of [...APPROVED, [196, 244]]) assert.ok(A.some((x, i) => (x === a && B[i] === b) || (x === b && B[i] === a)), `${a}/${b} missing from AI_Engine`);
});
// scenario that triggers each pair (from the workbook test set; 3 extra CBA/IBA combos built from C1)
const C1 = fixture('C1_cba_iba_conflict').inputs;
const cba = (a, b) => ({ ...C1, [F + 'C71']: dispOf(E0, a), [F + 'H71']: dispOf(E0, b) });
const PAIR_CASE = {
  '89+264': () => cba(89, 264), '89+290': 'C1_cba_iba_conflict', '259+264': () => cba(259, 264), '259+290': () => cba(259, 290),
  '13+253': 'K2_13_vs_253_267_other_notes', '13+267': 'K2_13_vs_253_267_other_notes', '13+272': 'K1_13_vs_mileage_272',
  '291+35': 'G1_291_vs_35_GTCC', '291+264': 'G2_291_vs_iba', '291+290': 'G2_291_vs_iba',
  '244+240': 'H1_244_vs_240_248', '244+248': 'H1_244_vs_240_248', '315+316': 'Y1_315_vs_316',
  '120+239': 'Y3_120_239_258', '120+258': 'Y3_120_239_258', '239+258': 'Y4_239_vs_258', '196+244': 'H2_244_vs_196_still',
};
for (const [a, b] of [...APPROVED, [196, 244]]) {
  test(`conflict ${a} ✖ ${b}: both red, CONFLICT message, NOT READY, conflict tile > 0`, () => {
    const src = PAIR_CASE[`${a}+${b}`]; assert.ok(src, 'no scenario');
    const { e } = typeof src === 'string' ? runCase(src) : runInputs(src());
    const v = view(e);
    assert.ok(has(v, `CONFLICT: ${a} + ${b}`), v.msgs.join(' | '));
    assert.match(v.status, /NOT READY/); assert.ok(v.tiles[1] >= 1);
    // the cells holding (or answering) each code are red
    const slots = Object.values(cellmap.GCELLS).flat().concat(Object.values(cellmap.QCELL));
    const red = slots.filter((c) => isRed(e, c));
    for (const code of [a, b]) {
      const holder = slots.filter((c) => codeOf(e.get(c, 'RFO Form')) === code);
      if (holder.length) assert.ok(holder.some((c) => red.includes(c)), `${code} cell not red`);
    }
    assert.ok(red.length >= 2, 'expected at least two red cells');
  });
}
test('pick lists hide conflicting codes (242 hides 315; 196 hides 244; 120 hides 239; 258 leaves only 294; 264 hides 89/259/291)', () => {
  const ids = (n, cell) => (optionsFor(runCase(n).e, cellmap.CELL[cell]) || []).map(codeOf);
  assert.ok(!ids('T3b_lists_hide', 'DN1').includes(315)); assert.ok(!ids('T3b_lists_hide', 'PM2').includes(244));
  assert.ok(!ids('X2_pcs_dependents_120', 'PD2').includes(239)); assert.deepEqual(ids('Y5_258_alone_ok', 'PD1').filter(Boolean), [294]);
  assert.deepEqual(ids('C2_iba_list', 'TA2').filter(Boolean), [260, 290, 293, 320]);
});
test('tree-inferred (not approved) pairs are not enforced → READY', () => assert.ok(ready(view(runCase('T6b_inferred_not_enforced').e))));
test('DTS rule: route 12 + travel blank → red + "Required: DTS", NOT READY', () => {
  const { e } = runCase('R1_route_out_dts_blank'); const v = view(e);
  assert.ok(isRed(e, cellmap.CELL.T1)); assert.ok(has(v, 'Required: DTS (outside commuting distance)')); assert.match(v.status, /NOT READY/);
});

// ---- cost estimator samples (June 5 2027 start) ----
for (const [n, total] of [['E1_sample1_E5_bragg_15d', 5944.54], ['E2_sample2_O3_huachuca_30d', 15177.16]]) {
  test(`cost sample ${n} = $${total}`, () => {
    const { e, est } = runCase(n);
    assert.equal(Math.round(est.E_TOTAL * 100) / 100, total);
    assert.equal(Math.round(e.calc('=E_TOTAL') * 100) / 100, total);           // value the form/summary formulas see
  });
}
test('cost: 2027 pay/BAS/BAH not published → 2026 used with ⚠ flags; FY2027 per diem', () => {
  const { est } = runCase('E1_sample1_E5_bragg_15d');
  for (const t of ['2027 basic pay not published', '2027 BAS not published', '2027 BAH RC/T not published']) assert.ok(est.E_FLAGS.includes(t), t);
  assert.equal(est.E_BPYR, 2026); assert.equal(est.E_PDFY, 2027);
});
test('cost: missing YOS/DEPENDENTS/DUTY ZIP + bad HOME ZIP turn red; samples have no red', () => {
  const r = (n, k) => costRed(runCase(n).e, k);
  for (const k of ['E_R_YOS', 'E_R_DEPS', 'E_R_DZIP', 'E_R_HZIP']) assert.equal(r('E4_missing_inputs_red', k), true, k);
  for (const k of ['E_R_YOS', 'E_R_DEPS', 'E_R_DZIP', 'E_R_HZIP', 'E_R_PEBD']) assert.equal(r('E1_sample1_E5_bragg_15d', k), false, k);
});
test('cost: ESTIMATE ONLY + sources footnote present on form and summary', () => {
  const { e } = runCase('E1_sample1_E5_bragg_15d');
  const all = JSON.stringify([...Array(30)].map((_, i) => [e.get('B' + (150 + i), 'RFO Form'), e.get('G' + (150 + i), 'RFO Form')]));
  assert.match(all, /ESTIMATE ONLY/); assert.match(all, /RATES AS OF/);
});
