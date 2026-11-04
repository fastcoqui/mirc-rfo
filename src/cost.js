// Cost estimator (change set 11; CS12: PCS / TDY tour-length rules) - a line-by-line port of the workbook's hidden 'Rates' calc column (Rates!A:B).
// Rate tables come from public/data/rates-*.json, generated from that same 'Rates' tab by tools/extract.py.
import { formatValue, serialToParts } from './format.js';

const INCIDENTALS = 5;
export const RATE_FILES = { core: 'rates-core.json', bah: 'rates-bah.json', perdiem: 'rates-perdiem.json', zip: 'rates-zip.json' };

export class Rates {
  constructor(core) {
    this.core = core; this.bah = null; this.pd = null; this.zip = null;
    const r = core.ranges, col = (n) => (r[n] || []).map((x) => x[0]);
    this.rank = col('RT_RANK'); this.rankGr = col('RT_RANKGR'); this.yosMin = col('RT_YOSMIN'); this.yosLbl = col('RT_YOSLBL');
    this.grades = col('RT_GRADES'); this.basY = col('RT_BASY'); this.basE = col('RT_BASE'); this.basO = col('RT_BASO');
    this.fy = col('RT_FY'); this.fss = col('RT_FSS'); this.fmed = col('RT_FMED'); this.povY = col('RT_POVY'); this.povR = col('RT_POVR');
    this.zhdr = (r.RT_ZHDR || [[]])[0];
    this.O20 = core.yosHeaders.indexOf('Over 20');
  }
  get loaded() { return !!(this.bah && this.pd && this.zip); }
}
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pos = (v) => num(v) && v > 0;
// IF(COUNTIFS(years,y,vals,">0")>0, y, MAX(years*(vals>0)))
function pick(pairs, y) {
  if (pairs.some(([yy, v]) => yy === y && pos(v))) return y;
  return pairs.reduce((m, [yy, v]) => (pos(v) && num(yy) ? Math.max(m, yy) : m), 0);
}
const datedifY = (a, b) => {
  if (!(b >= a)) return '';
  const p = serialToParts(a), q = serialToParts(b);
  let y = q.y - p.y; if (q.m < p.m || (q.m === p.m && q.d < p.d)) y--; return y;
};
const matchApprox = (arr, v) => { let k = -1; for (let i = 0; i < arr.length; i++) { if (num(arr[i]) && arr[i] <= v) k = i; else if (num(arr[i]) && arr[i] > v) break; } return k < 0 ? '' : k + 1; };
const trimS = (v) => (v === null || v === undefined ? '' : String(v)).replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ');
const up = (v) => (v === null || v === undefined ? '' : String(v)).toUpperCase();   // spreadsheet "=" is case-insensitive

/** inputs: { SEL_RANK, X_START, SEL_DAYS, X_ROUTE_OUT, today, E_IN_*: raw cell values } -> { E_*: value } */
export function computeCost(rates, inp) {
  const E = {}; const I = (k) => inp['E_IN_' + k];
  const blank = (v) => v === null || v === undefined || v === '';
  E.E_ON = !blank(inp.SEL_RANK) && num(inp.X_START) && num(inp.SEL_DAYS);
  const ri = rates.rank.indexOf(trimS(inp.SEL_RANK));
  E.E_BASEGR = ri >= 0 ? rates.rankGr[ri] : '';
  E.E_GRADE = ['O-1', 'O-2', 'O-3'].includes(E.E_BASEGR) && up(I('PRIOR')) === 'YES' ? E.E_BASEGR + 'E' : E.E_BASEGR;
  const gi = rates.grades.indexOf(E.E_GRADE); E.E_GIX = gi >= 0 ? gi + 1 : '';
  E.E_DAYS = num(inp.SEL_DAYS) ? inp.SEL_DAYS : 0;
  E.E_REF = num(inp.X_START) ? inp.X_START : inp.today;
  const ref = serialToParts(E.E_REF);
  E.E_YR = ref.y;
  E.E_FYEAR = ref.y + (ref.m + 1 >= 10 ? 1 : 0);
  // ---- tour length -> PCS / TDY (AR 37-104-4 para 8-4, Figure 8-19) - change set 12
  const dt = up(inp.X_DTYPE);
  E.E_PCSMIN = dt === 'ADT' || dt === 'ADTS' ? 140 : dt === 'ADOS-RC' ? 181 : 0;
  const am = I('AMEND');
  E.E_AMD = num(am) && num(inp.X_START) && num(inp.X_END) ? (am > inp.X_START && am <= inp.X_END ? Math.floor(am) : '') : '';
  E.E_REM = num(E.E_AMD) ? inp.X_END - E.E_AMD + 1 : E.E_DAYS;
  E.E_PCS = E.E_ON && E.E_PCSMIN > 0 && E.E_REM >= E.E_PCSMIN;
  E.E_PCSD = E.E_PCS ? E.E_REM : 0;
  E.E_TDYD = E.E_DAYS - E.E_PCSD;
  E.E_SPLIT = E.E_PCS && E.E_TDYD > 0;
  E.E_OTYPE = !E.E_ON ? '' : E.E_SPLIT ? 'TDY → PCS' : E.E_PCS ? 'PCS' : 'TDY';
  E.E_COMM = !!inp.X_ROUTE_IN;
  E.E_MLOC = up(inp.VAR) === 'YES';
  E.E_DEPS = ['YES', 'NO'].includes(up(I('DEPS'))) ? I('DEPS') : '';
  E.E_WAIVOK = up(E.E_DEPS) === 'YES' && up(I('WAIV')) === 'YES';
  E.E_HOREX = E.E_COMM || E.E_MLOC || E.E_WAIVOK;
  E.E_BAHT1 = E.E_TDYD <= 0 ? '' : E.E_TDYD <= 30 ? 'RC/T' : 'HOR';
  E.E_BAHT2 = E.E_PCSD <= 0 ? '' : E.E_HOREX ? 'HOR' : 'PDS';
  E.E_BAHT = E.E_BAHT2 === '' ? E.E_BAHT1 : E.E_BAHT1 === '' ? E.E_BAHT2 : E.E_BAHT1 + ' → ' + E.E_BAHT2;
  E.E_BAHTXT = E.E_BAHT.replace('RC/T', 'BAH-RC (RC/T)').replace(/HOR/g, 'BAH at the HOR rate').replace('PDS', 'BAH at the PDS rate') + (E.E_DEPS === '' ? '' : ' · ' + (up(E.E_DEPS) === 'YES' ? 'with' : 'without') + ' deps');
  E.E_YOSY = num(I('PEBD')) ? datedifY(Math.floor(I('PEBD')), Math.floor(E.E_REF)) : '';
  if (num(E.E_YOSY)) E.E_YOSIX = matchApprox(rates.yosMin, E.E_YOSY);
  else { const k = rates.yosLbl.findIndex((l) => up(l) === up(I('YOS')) && !blank(I('YOS'))); E.E_YOSIX = k >= 0 ? k + 1 : ''; }
  E.E_YOSLBL = num(E.E_YOSIX) ? rates.yosLbl[E.E_YOSIX - 1] : '';
  const basic = rates.core.basic;
  E.E_BPYR = pick(basic.map((r) => [r[0], r[2 + rates.O20]]), E.E_YR);
  const bpRow = basic.find((r) => r[0] === E.E_BPYR && up(r[1]) === up(E.E_GRADE));
  const bpv = bpRow && num(E.E_YOSIX) ? bpRow[1 + E.E_YOSIX] : undefined;
  E.E_BPMO = pos(bpv) ? bpv : '';
  E.E_BASIC = E.E_ON && num(E.E_BPMO) ? round2(E.E_BPMO / 30 * E.E_DAYS) : 0;
  const rct = rates.core.rct;
  E.E_RCYR = pick(rct.map((r) => [r[0], r[2]]), E.E_YR);
  const rcRow = rct.find((r) => r[0] === E.E_RCYR && up(r[1]) === up(E.E_GRADE));
  E.E_RCMO = rcRow ? (num(rcRow[up(E.E_DEPS) === 'YES' ? 3 : 2]) ? rcRow[up(E.E_DEPS) === 'YES' ? 3 : 2] : 0) : '';
  const zip5 = (v) => { const t = trimS(blank(v) ? '' : (typeof v === 'number' ? String(v) : v)); if (t.length !== 5) return ''; const n = Number(t); return t.trim() !== '' && Number.isFinite(n) ? n : ''; };
  E.E_DZIP = zip5(I('DZIP')); E.E_HZIP = zip5(I('HZIP'));
  const zrow = (z) => (num(z) && rates.zip ? rates.zip.zips[String(z).padStart(5, '0')] : undefined);
  const bahYears = rates.bah ? Object.entries(rates.bah).map(([y, m]) => [+y, Math.max(0, ...Object.values(m).map((x) => (x.W || [])[0] || 0))]) : [];
  E.E_BHYR = pick(bahYears, E.E_YR);
  const zcol = (label) => rates.zip ? rates.zip.hdr.indexOf(label) : -1;
  const bahY = rates.bah && rates.bah[String(E.E_BHYR)];
  const loc = (z, P) => {
    const zr = zrow(z); E[`E_${P}ZOK`] = !!zr;
    const mhaV = zr ? zr[zcol('MHA ' + E.E_BHYR)] : undefined;
    const mha = zr && zcol('MHA ' + E.E_BHYR) >= 0 ? (blank(mhaV) ? '' : String(mhaV)) : '';
    E[`E_${P}MHA`] = mha;
    const mrec = mha && bahY ? bahY[mha] : undefined;
    E[`E_${P}MHANAME`] = mha === '' ? '' : (mrec && mrec.W ? mrec.name : '');
    const arr = mrec ? mrec[up(E.E_DEPS) === 'YES' ? 'W' : 'WO'] : undefined;
    const lv = arr && num(E.E_GIX) ? arr[E.E_GIX - 1] : undefined;
    E[`E_${P}LOCMO`] = arr && num(E.E_GIX) ? (num(lv) ? lv : 0) : '';
    return zr;
  };
  loc(E.E_HZIP, 'H');
  const dz = loc(E.E_DZIP, 'D');
  E.E_MO1 = E.E_BAHT1 === 'RC/T' ? E.E_RCMO : E.E_BAHT1 === 'HOR' ? E.E_HLOCMO : '';
  E.E_MO2 = E.E_BAHT2 === 'PDS' ? E.E_DLOCMO : E.E_BAHT2 === 'HOR' ? E.E_HLOCMO : '';
  E.E_BAHMO = E.E_PCS ? E.E_MO2 : E.E_MO1;
  E.E_BAH = E.E_ON && E.E_DEPS !== '' ? round2((E.E_TDYD > 0 && num(E.E_MO1) ? E.E_MO1 / 30 * E.E_TDYD : 0) + (E.E_PCSD > 0 && num(E.E_MO2) ? E.E_MO2 / 30 * E.E_PCSD : 0)) : 0;
  E.E_BASYR = pick(rates.basY.map((y, i) => [y, rates.basE[i]]), E.E_YR);
  const bi = rates.basY.indexOf(E.E_BASYR);
  const basArr = String(E.E_GRADE).charAt(0).toUpperCase() === 'E' ? rates.basE : rates.basO;
  E.E_BASMO = bi >= 0 ? (num(basArr[bi]) ? basArr[bi] : 0) : '';
  E.E_BAS = E.E_ON && E.E_GRADE !== '' && num(E.E_BASMO) ? round2(E.E_BASMO / 30 * E.E_DAYS) : 0;
  E.E_FYR = pick(rates.fy.map((y, i) => [y, rates.fss[i]]), E.E_YR);
  const fi = rates.fy.indexOf(E.E_FYR);
  E.E_FICAR = fi >= 0 ? (rates.fss[fi] || 0) + (rates.fmed[fi] || 0) : 0;
  E.E_FICA_EE = round2(E.E_BASIC * E.E_FICAR);
  E.E_FICA_ER = up(I('FICAO')) === 'NONE' ? 0 : round2(E.E_BASIC * E.E_FICAR);
  E.E_PDON = !!inp.X_ROUTE_OUT;
  const pdYears = rates.pd ? Object.entries(rates.pd).map(([y, d]) => [+y, Math.max(0, ...Object.values(d).map((x) => x.mie || 0))]) : [];
  E.E_PDFY = pick(pdYears, E.E_FYEAR);
  const dv = dz ? dz[zcol('PD FY' + E.E_PDFY)] : undefined;
  E.E_DEST = dz ? (num(dv) ? dv : 0) : 0;
  const mv = dz ? dz[zcol('MULTI FY' + E.E_PDFY)] : undefined;
  E.E_MULTI = dz ? (num(mv) ? mv : 0) === 1 : false;
  const pdT = rates.pd && rates.pd[String(E.E_PDFY)];
  const pdrec = pdT ? pdT[String(E.E_DEST)] : undefined;
  E.E_PDNAME = pdrec ? (E.E_DEST === 0 ? 'Standard CONUS rate' : pdrec.name) + (blank(pdrec.st) ? '' : ' ' + pdrec.st) : '';
  const mi = ((ref.m + 1 - 10) % 12 + 12) % 12;
  E.E_LRATE = pdrec ? (pdrec.lodg[mi] || 0) : 0;
  E.E_MRATE = pdrec ? (pdrec.mie || 0) : 0;
  E.E_MIED = up(I('MEALP')) === 'YES' ? INCIDENTALS : E.E_MRATE;
  E.E_NIGHTS = E.E_SPLIT ? E.E_TDYD : Math.max(E.E_TDYD - 1, 0);
  E.E_PDOK = E.E_ON && E.E_PDON && E.E_DZIP !== '' && E.E_TDYD > 0;
  E.E_LODGT = E.E_PDOK && up(I('LODGP')) !== 'YES' ? round2(E.E_NIGHTS * E.E_LRATE) : 0;
  E.E_MIET = E.E_PDOK ? round2(E.E_SPLIT ? 0.75 * E.E_MIED + (E.E_TDYD - 1) * E.E_MIED : E.E_TDYD === 1 ? 0.75 * E.E_MIED : (E.E_TDYD - 2) * E.E_MIED + 2 * 0.75 * E.E_MIED) : 0;
  const tv = I('TRAV'); const tn = typeof tv === 'number' ? tv : (typeof tv === 'boolean' ? +tv : 0);
  E.E_TRAV = Math.max(0, Math.floor(tn));
  E.E_LEGS = E.E_PCS ? (E.E_SPLIT ? 1 : 2) : 0;
  E.E_TRVON = E.E_PCS && E.E_PDON && E.E_TRAV > 0;
  const std = pdT ? pdT['0'] : undefined;
  E.E_SLRATE = std ? (std.lodg[mi] || 0) : 0;
  E.E_SMRATE = std ? (std.mie || 0) : 0;
  E.E_LODGTR = E.E_TRVON ? round2(E.E_LEGS * Math.max(E.E_TRAV - 1, 0) * E.E_SLRATE) : 0;
  E.E_MIETR = E.E_TRVON ? round2(E.E_LEGS * (E.E_TRAV === 1 ? 0.75 * E.E_SMRATE : (E.E_TRAV - 2) * E.E_SMRATE + 2 * 0.75 * E.E_SMRATE)) : 0;
  E.E_LODG = E.E_LODGT + E.E_LODGTR;
  E.E_MIE = E.E_MIET + E.E_MIETR;
  E.E_MILES = num(I('MILES')) ? Math.max(0, I('MILES')) : 0;
  E.E_POVYR = pick(rates.povY.map((y, i) => [y, rates.povR[i]]), E.E_YR);
  const pi = rates.povY.indexOf(E.E_POVYR);
  E.E_POVR = pi >= 0 ? (num(rates.povR[pi]) ? rates.povR[pi] : 0) : '';
  E.E_MILE = E.E_ON && num(E.E_POVR) ? round2(E.E_MILES * E.E_POVR) : 0;
  E.E_TOTAL = E.E_ON ? E.E_BASIC + E.E_BAH + E.E_BAS + E.E_FICA_ER + E.E_LODG + E.E_MIE + E.E_MILE : 0;
  E.E_ONOTE = onote(E, dt);
  E.E_FLAGS = flags(E);
  E.E_ASOF = 'ESTIMATE ONLY - finance (DFAS / JTR) determines entitlements.  RATES AS OF / SOURCE: DFAS pay & BAS ' + E.E_BPYR + ' · DTMO BAH ' + E.E_BHYR + ' (RC/T ' + E.E_RCYR + ') · GSA per diem FY' + E.E_PDFY +
    ' · SSA FICA ' + E.E_FYR + ' · GSA POV ' + E.E_POVYR + " · PCS/TDY: AR 37-104-4 Fig 8-19. Sources: hidden 'Rates' tab.";   // change set 13 (shorter)
  return E;
}
function round2(x) { const s = Math.sign(x); return s * Math.round(Math.abs(x) * 100 + 1e-9) / 100; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ddmmm = (v) => { const p = serialToParts(v); return String(p.d).padStart(2, '0') + '-' + MON[p.m] + '-' + p.y; };
function onote(E, dt) {                       // change set 13: one short line (TRIM like the workbook)
  if (!E.E_ON) return '';
  let s = '';
  if (dt === '') s += '⚠ Pick ① assignment type to apply the PCS / TDY rule. ';
  if (E.E_SPLIT) s += '⚠ AMENDED: ' + E.E_REM + ' days remain from ' + ddmmm(E.E_AMD) + ' → PCS from that date, PDS BAH (Note ' + (E.E_PCSMIN === 140 ? 1 : 2) + '). ';
  if (num(E.E_AMD) && !E.E_PCS && E.E_PCSMIN > 0) s += 'Amended: ' + E.E_REM + ' days left (< ' + E.E_PCSMIN + ') → stays TDY. ';
  if (E.E_PCS && E.E_COMM) s += 'Commuting distance → HOR BAH (Note 5). ';
  if (E.E_PCS && E.E_MLOC) s += 'Several locations (Variation Authorized) → HOR BAH (Notes 3, 5). ';
  if (E.E_PCS && E.E_WAIVOK) s += 'DA G1 waiver → HOR BAH (Note 4). ';
  if (E.E_PCS && up(E.E_DEPS) === 'YES' && !E.E_HOREX) s += 'With dependents a DA G1 waiver can keep HOR BAH. ';
  if (E.E_PCS) s += 'PCS: no per diem except travel days.';
  return s.trim().replace(/ {2,}/g, ' ');
}
function flags(E) {
  if (!E.E_ON) return '';
  let s = '';
  if (E.E_GRADE === '') s += '⚠ No pay grade for this rank. ';
  s += !num(E.E_YOSIX) ? '⚠ Enter PEBD or pick YEARS OF SERVICE. ' : (E.E_GRADE !== '' && !num(E.E_BPMO) ? '⚠ DFAS has no ' + E.E_GRADE + ' rate at ' + E.E_YOSLBL + '. ' : '');
  if (E.E_BPYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' basic pay not published - ' + E.E_BPYR + ' table used. ';
  if (E.E_BASYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' BAS not published - ' + E.E_BASYR + ' used. ';
  if (E.E_BAHT1 === 'RC/T' && E.E_RCYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' BAH RC/T not published - ' + E.E_RCYR + ' used. ';
  if ((E.E_BAHT1 === 'HOR' || E.E_BAHT2 !== '') && E.E_BHYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' BAH not published - ' + E.E_BHYR + ' used. ';
  if (E.E_DEPS === '') s += '⚠ Pick DEPENDENTS for BAH. ';
  if ((E.E_BAHT1 === 'HOR' || E.E_BAHT2 === 'HOR') && E.E_HMHA === '') s += '⚠ BAH at the HOR rate needs a valid HOME OF RECORD ZIP. ';
  if (E.E_BAHT2 === 'PDS' && E.E_DMHA === '') s += '⚠ BAH at the PDS rate needs a valid DUTY LOCATION ZIP. ';
  if (E.E_PDON && E.E_TDYD > 0 && E.E_DZIP === '') s += '⚠ Enter the DUTY LOCATION ZIP for per diem. ';
  if (E.E_PCS && E.E_PDON && E.E_TRAV === 0) s += '⚠ Enter PCS TRAVEL DAYS for the travel per diem. ';
  if ((E.E_PDOK || E.E_TRVON) && E.E_PDFY !== E.E_FYEAR) s += '⚠ FY' + E.E_FYEAR + ' per diem not loaded - FY' + E.E_PDFY + ' used. ';
  if (E.E_PDOK && E.E_MULTI) s += '⚠ ZIP spans more than one GSA per diem area - the higher rate is used; check gsa.gov. ';
  if (E.E_MILES > 0 && E.E_POVYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' POV rate not published - ' + E.E_POVYR + ' used. ';
  return s;
}
// what the cost engine reads from the form engine
export const COST_INPUT_NAMES = ['SEL_RANK', 'X_START', 'X_END', 'SEL_DAYS', 'X_ROUTE_OUT', 'X_ROUTE_IN', 'X_DTYPE'];
export function gatherInputs(engine, today) {
  const o = { today };
  for (const n of COST_INPUT_NAMES) o[n] = engine.name(n);
  for (const n of Object.keys(engine.data.names).filter((k) => k.startsWith('E_IN_'))) o[n] = engine.name(n);
  if (engine.data.costRefs && engine.data.costRefs.VAR) o.VAR = engine.get(engine.data.costRefs.VAR);   // Variation Authorized (multi-location)
  return o;
}
