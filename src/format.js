// Small Excel number-format implementation (covers every format the workbook uses).
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function serialToParts(s) {
  const ms = Math.round((s - 25569) * 86400000);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds() };
}
export function dateToSerial(y, m, d) { return Date.UTC(y, m - 1, d) / 86400000 + 25569; }
const isDateFmt = (f) => /(^|[^"\\])[ymdhs]/i.test(f.replace(/"[^"]*"/g, '')) && !/[0#]/.test(f.replace(/"[^"]*"/g, ''));
function fmtDate(v, f) {
  const p = serialToParts(v); const pad = (n, k = 2) => String(n).padStart(k, '0');
  let out = ''; let i = 0; const L = f.length; let lastWasH = false;
  while (i < L) {
    const ch = f[i];
    if (ch === '"') { const j = f.indexOf('"', i + 1); out += f.slice(i + 1, j); i = j + 1; continue; }
    if (ch === '\\') { out += f[i + 1]; i += 2; continue; }
    const run = (c) => { let k = i; while (k < L && f[k].toLowerCase() === c) k++; return k - i; };
    const lc = ch.toLowerCase();
    if (lc === 'y') { const n = run('y'); out += n <= 2 ? pad(p.y % 100) : String(p.y); i += n; continue; }
    if (lc === 'd') { const n = run('d'); out += n === 1 ? p.d : n === 2 ? pad(p.d) : n === 3 ? DAY[p.wd].slice(0, 3) : DAY[p.wd]; i += n; lastWasH = false; continue; }
    if (lc === 'h') { const n = run('h'); out += n === 1 ? p.H : pad(p.H); i += n; lastWasH = true; continue; }
    if (lc === 's') { const n = run('s'); out += n === 1 ? p.S : pad(p.S); i += n; continue; }
    if (lc === 'm') {
      const n = run('m');
      const minute = lastWasH || /^[^a-z]*s/i.test(f.slice(i + n).replace(/"[^"]*"/g, ''));
      if (minute && n <= 2) out += n === 1 ? p.M : pad(p.M);
      else out += n === 1 ? p.m + 1 : n === 2 ? pad(p.m + 1) : n === 3 ? MON[p.m].slice(0, 3) : n === 4 ? MON[p.m] : MON[p.m][0];
      i += n; lastWasH = false; continue;
    }
    out += ch; i++;
  }
  return out;
}
function fmtNumber(v, f) {
  let pre = '', post = '', core = '';
  // split literal prefix / suffix from the digit pattern
  const m = /^((?:"[^"]*"|\\.|[^0#?,.%])*)([0#?,.]+)((?:"[^"]*"|\\.|[^0#?,.])*)$/.exec(f);
  if (!m) return String(v);
  const lit = (s) => s.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1');
  pre = lit(m[1]); core = m[2]; post = lit(m[3]);
  let x = v; if (post.includes('%')) x *= 100;
  const dot = core.indexOf('.');
  const dec = dot < 0 ? 0 : core.slice(dot + 1).replace(/[^0#]/g, '').length;
  const intPat = (dot < 0 ? core : core.slice(0, dot));
  const minInt = (intPat.match(/0/g) || []).length;
  const comma = intPat.includes(',');
  const neg = x < 0; x = Math.abs(x);
  let s = (Math.round(x * 10 ** dec + 1e-9) / 10 ** dec).toFixed(dec);
  let [ip, fp] = s.split('.');
  if (ip === '0' && minInt === 0) ip = '';
  ip = ip.padStart(minInt, '0');
  if (comma) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + pre + ip + (dec ? '.' + fp : '') + post;
}
export function formatValue(v, f) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number' || !f || f === 'General' || f === '@') {
    if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10);
    return String(v);
  }
  const secs = f.split(';');
  let fm = secs[0];
  if (v < 0 && secs[1]) { fm = secs[1]; v = -v; } else if (v === 0 && secs[2]) fm = secs[2];
  if (isDateFmt(fm)) return fmtDate(v, fm);
  return fmtNumber(v, fm);
}
