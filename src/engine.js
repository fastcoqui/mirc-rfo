// RFO calculation engine: evaluates the workbook's own formulas (extracted to engine.json) with HyperFormula.
// Shared by the browser app and the Node test suite.
import { HyperFormula, FunctionPlugin, FunctionArgumentType, EmptyValue } from 'hyperformula';
import { formatValue } from './format.js';

const COLS = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
export const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export const parseAddr = (a) => { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(a); return { col: COLS(m[1]), row: +m[2] - 1 }; };

// TODAY()/NOW() that tests (and print stamps) can pin to a date.
let FIXED_NOW = null;
export function setNow(d) { FIXED_NOW = d; }
const nowSerial = () => {
  const d = FIXED_NOW || new Date();
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return utc / 86400000 + 25569;
};
class ClockPlugin extends FunctionPlugin {
  today(ast, state) { return this.runFunction(ast.args, state, this.metadata('TODAY'), () => Math.floor(nowSerial())); }
  now(ast, state) { return this.runFunction(ast.args, state, this.metadata('NOW'), () => nowSerial()); }
  text(ast, state) {
    return this.runFunction(ast.args, state, this.metadata('TEXT'), (v, f) => {
      if (typeof v === 'string') { const n = Number(v); if (v.trim() !== '' && !isNaN(n)) v = n; else return v; }
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return formatValue(v, f);
    });
  }
}
ClockPlugin.implementedFunctions = {
  TODAY: { method: 'today', parameters: [], isVolatile: true, returnNumberType: 'NUMBER_DATE' },
  NOW: { method: 'now', parameters: [], isVolatile: true, returnNumberType: 'NUMBER_DATETIME' },
  TEXT: { method: 'text', parameters: [{ argumentType: FunctionArgumentType.SCALAR }, { argumentType: FunctionArgumentType.STRING }] },
};
// COUNTIF / COUNTIFS with spreadsheet semantics for blank criteria (HyperFormula rejects a blank criterion;
// Excel/LibreOffice just match nothing / blanks).
const raw = (v) => (v && typeof v === 'object' && 'val' in v ? v.val : v);
const wild = (t) => new RegExp('^' + t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002')
  .replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'is');
function criterion(c) {
  c = raw(c);
  if (c === EmptyValue || c === null || c === undefined) return (v) => v === EmptyValue || v === '' || v === null;
  if (typeof c === 'number') return (v) => raw(v) === c;
  if (typeof c === 'boolean') return (v) => raw(v) === c;
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(String(c));
  const op = m[1] || '='; const t = m[2];
  const blank = (v) => v === EmptyValue || v === '' || v === null;
  if (t === '') return op === '=' ? blank : op === '<>' ? (v) => !blank(v) : () => false;
  const n = Number(t); const isNum = t.trim() !== '' && Number.isFinite(n);
  if (isNum) {
    const cmp = { '=': (a) => a === n, '<>': (a) => a !== n, '<': (a) => a < n, '>': (a) => a > n, '<=': (a) => a <= n, '>=': (a) => a >= n }[op];
    return (v) => { const r = raw(v); if (typeof r === 'number') return cmp(r); if (op === '<>') return true; if (op === '=' && typeof r === 'string') return r.trim() !== '' && Number(r) === n; return false; };
  }
  const lt = t.toLowerCase();
  if (op === '=' || op === '<>') {
    const re = /[*?]/.test(t) ? wild(t) : null;
    const eq = (v) => { const r = raw(v); if (typeof r !== 'string') return false; return re ? re.test(r) : r.toLowerCase() === lt; };
    return op === '=' ? eq : (v) => !eq(v);
  }
  const cmp = { '<': (a) => a < lt, '>': (a) => a > lt, '<=': (a) => a <= lt, '>=': (a) => a >= lt }[op];
  return (v) => { const r = raw(v); return typeof r === 'string' && cmp(r.toLowerCase()); };
}
const flat = (rng) => (rng && rng.data ? rng.data.flat() : [rng]);
class CountIfPlugin extends FunctionPlugin {
  countif(ast, state) {
    return this.runFunction(ast.args, state, this.metadata('COUNTIF'), (rng, crit) => { const f = criterion(crit); let n = 0; for (const v of flat(rng)) if (f(v)) n++; return n; });
  }
  countifs(ast, state) {
    return this.runFunction(ast.args, state, this.metadata('COUNTIFS'), (...args) => {
      const cols = []; for (let i = 0; i < args.length; i += 2) cols.push([flat(args[i]), criterion(args[i + 1])]);
      const L = cols[0][0].length; let n = 0;
      outer: for (let k = 0; k < L; k++) { for (const [vals, f] of cols) if (!f(vals[k])) continue outer; n++; }
      return n;
    });
  }
}
CountIfPlugin.implementedFunctions = {
  COUNTIF: { method: 'countif', parameters: [{ argumentType: FunctionArgumentType.RANGE }, { argumentType: FunctionArgumentType.NOERROR }] },
  COUNTIFS: { method: 'countifs', parameters: [{ argumentType: FunctionArgumentType.RANGE }, { argumentType: FunctionArgumentType.NOERROR }], repeatLastArgs: 2 },
};
let registered = false;
function registerPlugins() {
  if (registered) return; registered = true;
  try { HyperFormula.unregisterFunction('TODAY'); HyperFormula.unregisterFunction('NOW'); HyperFormula.unregisterFunction('TEXT'); } catch (e) { /* ignore */ }
  HyperFormula.registerFunctionPlugin(ClockPlugin, { enGB: { TODAY: 'TODAY', NOW: 'NOW', TEXT: 'TEXT' } });
  try { HyperFormula.unregisterFunction('COUNTIF'); HyperFormula.unregisterFunction('COUNTIFS'); } catch (e) { /* ignore */ }
  HyperFormula.registerFunctionPlugin(CountIfPlugin, { enGB: { COUNTIF: 'COUNTIF', COUNTIFS: 'COUNTIFS' } });
}

// Legacy-Excel array context: SUMPRODUCT evaluates its arguments element-wise.
export function prepFormula(v) {
  if (typeof v === 'string' && !v.startsWith('=')) return "'" + v;   // text stays text ("0800", "336")
  if (typeof v !== 'string') return v;
  // ROWS(X$6:X6) is a position counter, not a dependency (HyperFormula would see a self-reference cycle)
  v = v.replace(/ROWS\((?:[A-Za-z_]+!)?\$?[A-Z]{1,3}\$?(\d+):\$?[A-Z]{1,3}\$?(\d+)\)/g, (m, a, b) => String(Math.abs(+b - +a) + 1));
  if (v.includes('SUMPRODUCT(')) return '=ARRAYFORMULA(' + v.slice(1) + ')';
  return v;
}
export class RfoEngine {
  constructor(data) {
    registerPlugins();
    this.data = data;
    const sheets = {};
    for (const [name, s] of Object.entries(data.sheets)) {
      const rows = Array.from({ length: s.maxRow }, () => []);
      for (const [a, v] of Object.entries(s.cells)) { const { col, row } = parseAddr(a); rows[row][col] = prepFormula(v); }
      sheets[name] = rows;
    }
    sheets.__COST = data.costNames.map((n) => [n, null]);
    // conditional-format rules of the UI sheets live as formulas on a scratch sheet so they recalc incrementally
    this.cfIndex = [];
    if (data.cf) { sheets.__CF = data.cf.map((r, i) => { this.cfIndex.push(r); return [prepFormula('=' + r.formula)]; }); }
    this.hf = HyperFormula.buildFromSheets(sheets, {
      licenseKey: 'gpl-v3', useArrayArithmetic: false, smartRounding: true, caseSensitive: false,
      dateFormats: ['MM/DD/YYYY', 'YYYY-MM-DD'], useColumnIndex: false, evaluateNullToZero: false,
      leapYear1900: false, nullDate: { year: 1899, month: 12, day: 30 }, accentSensitive: true, maxRows: 50000,
    });
    this.sid = Object.fromEntries(this.hf.getSheetNames().map((n) => [n, this.hf.getSheetId(n)]));
    this.hf.suspendEvaluation();
    data.costNames.forEach((n, i) => this.hf.addNamedExpression(n, `='__COST'!$B$${i + 1}`));
    const bad = [];
    for (const [n, expr] of Object.entries(data.names)) {
      try { this.hf.addNamedExpression(n, '=' + expr); } catch (e) { bad.push([n, String(e.message || e)]); }
    }
    this.hf.resumeEvaluation();
    this.badNames = bad;
  }
  ref(addr, sheet = 'RFO Form') {
    if (addr.includes('!')) { const [s, a] = addr.split('!'); sheet = s.replace(/^'|'$/g, ''); addr = a; }
    const { col, row } = parseAddr(addr.replace(/\$/g, ''));
    return { sheet: this.sid[sheet], col, row };
  }
  get(addr, sheet) { const v = this.hf.getCellValue(this.ref(addr, sheet)); return v && typeof v === 'object' && 'type' in v ? `#${v.type}` : v; }
  set(addr, value, sheet) {
    if (value === undefined || value === '') value = null;
    if (typeof value === 'string') value = value.startsWith('=') ? "'" + value : "'" + value;   // user text is never a formula
    this.hf.setCellContents(this.ref(addr, sheet), [[value]]);
  }
  batch(fn) { return this.hf.batch(fn); }
  setMany(map) { this.hf.batch(() => { for (const [a, v] of Object.entries(map)) this.set(a, v); }); }
  calc(formula, sheet = 'RFO Form') {
    const v = this.hf.calculateFormula(formula.startsWith('=') ? formula : '=' + formula, this.sid[sheet]);
    return v && typeof v === 'object' && 'type' in v && !Array.isArray(v) ? `#${v.type}` : v;
  }
  name(n) { return this.calc('=' + n); }
  cfValues() { const sid = this.sid.__CF; return this.cfIndex.map((r, i) => this.hf.getCellValue({ sheet: sid, col: 0, row: i })); }
  setCost(values) {
    const sid = this.sid.__COST;
    this.hf.batch(() => this.data.costNames.forEach((n, i) => {
      const v = values[n];
      this.hf.setCellContents({ sheet: sid, col: 1, row: i }, [[v === undefined ? null : v]]);
    }));
  }
  // values for a dropdown: literal list, a plain range name, or an OFFSET(...) list
  listOptions(name) {
    const off = this.data.offsetLists[name];
    let vals = [];
    if (off) {
      const n = Number(this.calc(off.count, off.sheet)) || 1;
      const c = COLS(off.col);
      for (let i = 0; i < n; i++) vals.push(this.hf.getCellValue({ sheet: this.sid[off.sheet], col: c, row: off.row - 1 + i }));
    } else if (this.data.names[name]) {
      const [s, rg] = this.data.names[name].split('!');
      const [a, b] = rg.replace(/\$/g, '').split(':');
      const p = parseAddr(a), q = parseAddr(b || a), sid = this.sid[s.replace(/^'|'$/g, '')];
      for (let r = p.row; r <= q.row; r++) for (let c = p.col; c <= q.col; c++) vals.push(this.hf.getCellValue({ sheet: sid, col: c, row: r }));
    }
    return vals.filter((v) => v !== null && v !== '' && !(typeof v === 'object'));
  }
}
