// Cost estimator (change set 11) - a line-by-line port of the workbook's hidden 'Rates' calc column (Rates!A:B).
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
  E.E_YR = ref.y; E.E_FYEAR = ref.y + (ref.m + 1 >= 10 ? 1 : 0);
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
  E.E_DEPS = ['YES', 'NO'].includes(up(I('DEPS'))) ? I('DEPS') : '';
  const bt = up(I('BAHT'));
  E.E_BAHT = bt === 'NONE' ? 'NONE' : bt === 'LOCALITY' ? 'LOCALITY' : bt === 'RC/T' ? 'RC/T' : (E.E_DAYS <= 30 ? 'RC/T' : 'LOCALITY');
  const rct = rates.core.rct;
  E.E_RCYR = pick(rct.map((r) => [r[0], r[2]]), E.E_YR);
  const rcRow = rct.find((r) => r[0] === E.E_RCYR && up(r[1]) === up(E.E_GRADE));
  E.E_RCMO = rcRow ? (num(rcRow[up(E.E_DEPS) === 'YES' ? 3 : 2]) ? rcRow[up(E.E_DEPS) === 'YES' ? 3 : 2] : 0) : '';
  const zip5 = (v) => { const t = trimS(blank(v) ? '' : (typeof v === 'number' ? String(v) : v)); if (t.length !== 5) return ''; const n = Number(t); return t.trim() !== '' && Number.isFinite(n) ? n : ''; };
  E.E_DZIP = zip5(I('DZIP')); E.E_HZIP = zip5(I('HZIP'));
  E.E_BZIP = num(E.E_HZIP) ? E.E_HZIP : E.E_DZIP;
  const zrow = (z) => (num(z) && rates.zip ? rates.zip.zips[String(z).padStart(5, '0')] : undefined);
  const bz = zrow(E.E_BZIP); E.E_BZOK = !!bz;
  const bahYears = rates.bah ? Object.entries(rates.bah).map(([y, m]) => [+y, Math.max(0, ...Object.values(m).map((x) => (x.W || [])[0] || 0))]) : [];
  E.E_BHYR = pick(bahYears, E.E_YR);
  const zcol = (label) => rates.zip ? rates.zip.hdr.indexOf(label) : -1;
  const mhaV = bz ? bz[zcol('MHA ' + E.E_BHYR)] : undefined;
  E.E_MHA = bz && zcol('MHA ' + E.E_BHYR) >= 0 ? (blank(mhaV) ? '' : String(mhaV)) : '';
  const bahY = rates.bah && rates.bah[String(E.E_BHYR)];
  const mrec = E.E_MHA && bahY ? bahY[E.E_MHA] : undefined;
  E.E_MHANAME = E.E_MHA === '' ? '' : (mrec && mrec.W ? mrec.name : '');
  const lv = mrec && num(E.E_GIX) ? (mrec[up(E.E_DEPS) === 'YES' ? 'W' : 'WO'] || [])[E.E_GIX - 1] : undefined;
  E.E_LOCMO = mrec && num(E.E_GIX) && mrec[up(E.E_DEPS) === 'YES' ? 'W' : 'WO'] ? (num(lv) ? lv : 0) : '';
  E.E_BAHMO = E.E_BAHT === 'NONE' ? 0 : E.E_BAHT === 'RC/T' ? E.E_RCMO : E.E_LOCMO;
  E.E_BAH = E.E_ON && E.E_DEPS !== '' && num(E.E_BAHMO) ? round2(E.E_BAHMO / 30 * E.E_DAYS) : 0;
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
  const pdq = up(I('PD'));
  E.E_PDON = pdq === 'YES' ? true : pdq === 'NO' ? false : !!inp.X_ROUTE_OUT;
  const pdYears = rates.pd ? Object.entries(rates.pd).map(([y, d]) => [+y, Math.max(0, ...Object.values(d).map((x) => x.mie || 0))]) : [];
  E.E_PDFY = pick(pdYears, E.E_FYEAR);
  const dz = zrow(E.E_DZIP); E.E_DZOK = !!dz;
  const dv = dz ? dz[zcol('PD FY' + E.E_PDFY)] : undefined;
  E.E_DEST = dz ? (num(dv) ? dv : 0) : 0;
  const mv = dz ? dz[zcol('MULTI FY' + E.E_PDFY)] : undefined;
  E.E_MULTI = dz ? (num(mv) ? mv : 0) === 1 : false;
  const pdrec = rates.pd && rates.pd[String(E.E_PDFY)] ? rates.pd[String(E.E_PDFY)][String(E.E_DEST)] : undefined;
  E.E_PDNAME = pdrec ? (E.E_DEST === 0 ? 'Standard CONUS rate' : pdrec.name) + (blank(pdrec.st) ? '' : ' ' + pdrec.st) : '';
  const mi = ((ref.m + 1 - 10) % 12 + 12) % 12;
  E.E_LRATE = pdrec ? (pdrec.lodg[mi] || 0) : 0;
  E.E_MRATE = pdrec ? (pdrec.mie || 0) : 0;
  E.E_MIED = up(I('MEALP')) === 'YES' ? INCIDENTALS : E.E_MRATE;
  E.E_NIGHTS = Math.max(E.E_DAYS - 1, 0);
  E.E_PDOK = E.E_ON && E.E_PDON && E.E_DZIP !== '';
  E.E_LODG = E.E_PDOK && up(I('LODGP')) !== 'YES' ? round2(E.E_NIGHTS * E.E_LRATE) : 0;
  E.E_MIE = E.E_PDOK ? round2(E.E_DAYS === 1 ? 0.75 * E.E_MIED : (E.E_DAYS - 2) * E.E_MIED + 2 * 0.75 * E.E_MIED) : 0;
  E.E_MILES = num(I('MILES')) ? Math.max(0, I('MILES')) : 0;
  E.E_POVYR = pick(rates.povY.map((y, i) => [y, rates.povR[i]]), E.E_YR);
  const pi = rates.povY.indexOf(E.E_POVYR);
  E.E_POVR = pi >= 0 ? (num(rates.povR[pi]) ? rates.povR[pi] : 0) : '';
  E.E_MILE = E.E_ON && num(E.E_POVR) ? round2(E.E_MILES * E.E_POVR) : 0;
  E.E_TOTAL = E.E_ON ? E.E_BASIC + E.E_BAH + E.E_BAS + E.E_FICA_ER + E.E_LODG + E.E_MIE + E.E_MILE : 0;
  E.E_FLAGS = flags(E);
  E.E_ASOF = 'RATES AS OF / SOURCE:  Basic pay & BAS - DFAS, eff. 1 Jan ' + E.E_BPYR + '  ·  BAH - DTMO ' + (E.E_BAHT === 'RC/T' ? E.E_RCYR + ' Non-Locality (RC/T)' : E.E_BHYR + ' locality (ZIP→MHA)') +
    ', eff. 1 Jan  ·  Per diem - GSA FY' + E.E_PDFY + ' (eff. 1 Oct ' + (E.E_PDFY - 1) + ')  ·  FICA - SSA ' + E.E_FYR + ' (6.2% SS + 1.45% Medicare, basic pay only)  ·  POV - GSA/JTR ' + E.E_POVYR +
    ".  URLs + update steps: hidden 'Rates' tab.  ESTIMATE ONLY - finance (DFAS / JTR) determines actual entitlements.";
  return E;
}
function round2(x) { const s = Math.sign(x); return s * Math.round(Math.abs(x) * 100 + 1e-9) / 100; }
function flags(E) {
  if (!E.E_ON) return 'Fill RANK, START DATE and NUMBER OF DAYS on the form to start the estimate.';
  let s = '';
  if (E.E_GRADE === '') s += '⚠ No pay grade for this rank. ';
  s += !num(E.E_YOSIX) ? '⚠ Enter PEBD or pick YEARS OF SERVICE. ' : (E.E_GRADE !== '' && !num(E.E_BPMO) ? '⚠ DFAS has no ' + E.E_GRADE + ' rate at ' + E.E_YOSLBL + '. ' : '');
  if (E.E_BPYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' basic pay not published - ' + E.E_BPYR + ' table used. ';
  if (E.E_BASYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' BAS not published - ' + E.E_BASYR + ' used. ';
  if (E.E_BAHT === 'RC/T' && E.E_RCYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' BAH RC/T not published - ' + E.E_RCYR + ' used. ';
  if (E.E_BAHT === 'LOCALITY' && E.E_BHYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' BAH not published - ' + E.E_BHYR + ' used. ';
  if (E.E_BAHT !== 'NONE' && E.E_DEPS === '') s += '⚠ Pick DEPENDENTS for BAH. ';
  if (E.E_BAHT === 'LOCALITY' && E.E_MHA === '') s += '⚠ No BAH MHA for ZIP ' + (E.E_BZIP === '' ? '(blank)' : formatValue(E.E_BZIP, '00000')) + ' - enter a valid home / duty ZIP. ';
  if (E.E_BAHT === 'LOCALITY' && !num(E.E_HZIP) && E.E_MHA !== '') s += 'Locality BAH uses the duty ZIP (no home ZIP). ';
  if (E.E_PDON && E.E_DZIP === '') s += '⚠ Enter the DUTY LOCATION ZIP for per diem. ';
  if (E.E_PDOK && E.E_PDFY !== E.E_FYEAR) s += '⚠ FY' + E.E_FYEAR + ' per diem not loaded - FY' + E.E_PDFY + ' used. ';
  if (E.E_PDOK && E.E_MULTI) s += '⚠ ZIP spans more than one GSA per diem area - the higher rate is used; check gsa.gov. ';
  if (E.E_PDOK && E.E_DAYS > 30) s += 'Orders over 30 days: JTR long-term TDY (flat-rate) per diem may apply - full rate shown. ';
  if (E.E_PDOK) s += "Lodging rate = start month; seasonal changes later in the order aren't applied. ";
  if (E.E_MILES > 0 && E.E_POVYR !== E.E_YR) s += '⚠ ' + E.E_YR + ' POV rate not published - ' + E.E_POVYR + ' used. ';
  return s + 'OCONUS / COLA / special pays not included.';
}
// what the cost engine reads from the form engine
export const COST_INPUT_NAMES = ['SEL_RANK', 'X_START', 'SEL_DAYS', 'X_ROUTE_OUT'];
export function gatherInputs(engine, today) {
  const o = { today };
  for (const n of COST_INPUT_NAMES) o[n] = engine.name(n);
  for (const n of Object.keys(engine.data.names).filter((k) => k.startsWith('E_IN_'))) o[n] = engine.name(n);
  return o;
}
