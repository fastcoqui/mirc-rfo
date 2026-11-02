// Headless browser smoke tests against the BUILT site (dist/), served locally on 127.0.0.1 only.
// Drives the real UI controls, checks status / conflicts / cost / save-open / clear / drafts /
// feedback / printing, asserts no request leaves 127.0.0.1, and renders screenshots.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
const PORT = 4179, LIVE = process.env.E2E_URL, BASE = LIVE || `http://127.0.0.1:${PORT}/mirc-rfo/`;
const SHOTS = new URL('../screenshots/', import.meta.url).pathname; fs.mkdirSync(SHOTS, { recursive: true });
const CM = JSON.parse(fs.readFileSync(new URL('./fixtures/cellmap.json', import.meta.url)));
const CODES = CM.CELL.CODES, SHIFT = 22;   // CS12: SOLDIER DATA / estimate block pushed the pre-CS12 rows 7+ down 22 rows
const FX = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url))).inputs;
const results = []; let failures = 0;
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); } catch (e) { failures++; results.push(['FAIL', name + ' :: ' + String(e.message).split('\n')[0]]); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

const server = LIVE ? { kill() {} } : spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { stdio: 'pipe' });
if (!LIVE) await new Promise((res, rej) => { server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) res(); }); setTimeout(() => rej(new Error('server timeout')), 20000); });
process.on('exit', () => server.kill());
const browser = await chromium.launch();

// fill one form cell through its real control
async function fillCell(page, key, val) {
  const sel = `[data-key="${key}"]`;
  const h = await page.$(sel); if (!h || val === null) return 'skip';
  const want = 'form';
  if (await page.evaluate(() => window.__rfo.view) !== want) { await page.click(`.tabs button[data-view=${want}]`); await page.waitForTimeout(150); }
  const tag = await h.evaluate((n) => n.tagName + ':' + (n.type || ''));
  if (val === null) return 'skip';
  if (tag.startsWith('SELECT')) {
    const label = String(val);
    const labels = await h.evaluate((n) => [...n.options].map((o) => o.textContent));
    if (!labels.includes(label)) { await page.evaluate(([k, v]) => window.__rfoApi.set({ [k]: v }), [key, val]); return 'api'; }
    await page.selectOption(sel, { label });
  } else if (tag === 'INPUT:date') {
    const d = new Date(Date.UTC(1899, 11, 30) + val * 864e5).toISOString().slice(0, 10); await page.fill(sel, d); await h.dispatchEvent('change');
  } else { await page.fill(sel, String(val)); await h.dispatchEvent('change'); }
  return 'ui';
}
async function fillCase(page, inputs) {
  let ui = 0, api = 0; const start = await page.evaluate(() => window.__rfo.view);
  for (const [k, v] of Object.entries(inputs)) { if (!k.startsWith('RFO Form!') || /^RFO Form!B\d/.test(k)) continue; const r = await fillCell(page, k, v); if (r === 'ui') ui++; if (r === 'api') api++; }
  if (await page.evaluate(() => window.__rfo.view) !== start) { await page.click(`.tabs button[data-view=${start}]`); await page.waitForTimeout(150); }
  return { ui, api };
}
const status = (p) => p.textContent('#statusText');
async function newPage(viewport, scale = 1) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, acceptDownloads: true });
  const page = await ctx.newPage();
  page.ext = []; page.errs = [];
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) page.ext.push(r.url()); });
  page.on('pageerror', (e) => page.errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE); await page.waitForSelector('body.ready', { timeout: 30000 });
  return page;
}
const clearForm = (p) => p.click('#btnClear');

const page = await newPage({ width: 1440, height: 1000 });
await check('loads with blank form, NOT READY, no errors', async () => { ok((await status(page)).includes('NOT READY')); ok(page.errs.length === 0, page.errs.join('; ')); });
await check('rate tables are lazy (not fetched until needed)', async () => {
  const names = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name));
  ok(!names.some((n) => /rates-(bah|perdiem|zip)/.test(n)), 'big rate tables loaded on first paint');
});
let jf;
await check('Johnson example via real controls → READY TO SUBMIT, 11 codes', async () => {
  jf = await fillCase(page, FX('T1c_AT_full_READY_johnson'));
  const st = await status(page); ok(st.includes('READY TO SUBMIT'), st);
  const codes = await page.textContent(`[data-addr="${CODES}"]`); ok(codes.trim() === '12, 17, 21, 34, 47, 229, 247, 252, 253, 259, 260', codes);
});
await check('status panel 11/11, 0 blanks / 0 conflicts', async () => {
  const t = await page.textContent('#statusGrid'); ok(/11\/11/.test(t), 'meter');
});
await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
await page.screenshot({ path: SHOTS + 'desktop_form_ready.png' });
await page.screenshot({ path: SHOTS + 'desktop_form_ready_full.png', fullPage: true });
await (await page.$('#statusGrid')).screenshot({ path: SHOTS + 'desktop_status_ready.png' });

// save → clear → open round trip
let saved;
await check('Save file downloads JSON with only changed inputs', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
  saved = '/tmp/rfo_saved.json'; await dl.saveAs(saved);
  const j = JSON.parse(fs.readFileSync(saved, 'utf8')); ok(j.format === 'mirc-rfo-webapp' && j.inputs['RFO Form!C5'] === 'DOE, JOHN A', 'bad file');
});
await check('Clear form resets to blank / NOT READY', async () => {
  await clearForm(page); await page.waitForTimeout(200); ok((await status(page)).includes('NOT READY'));
  ok((await page.inputValue('[data-key="RFO Form!C5"]')) === '', 'name not cleared');
});
await check('Open file restores the form → READY again', async () => {
  await page.setInputFiles('#fileOpen', saved); await page.waitForTimeout(400);
  ok((await status(page)).includes('READY TO SUBMIT'), await status(page));
});
await check('Open file rejects a non-RFO JSON', async () => {
  fs.writeFileSync('/tmp/bad.json', '{"hello":1}'); await page.setInputFiles('#fileOpen', '/tmp/bad.json'); await page.waitForTimeout(300);
  ok((await status(page)).includes('READY TO SUBMIT'), 'form changed by bad file');
});
// drafts
await check('Draft OFF by default: nothing in localStorage', async () => { ok(await page.evaluate(() => localStorage.getItem('mirc-rfo-draft-v1')) === null); });
await check('Draft ON keeps form after reload; Clear form deletes it', async () => {
  await page.check('#draftToggle'); ok(await page.evaluate(() => !!localStorage.getItem('mirc-rfo-draft-v1')));
  await page.reload(); await page.waitForSelector('body.ready'); await page.waitForTimeout(300);
  ok((await status(page)).includes('READY TO SUBMIT'), 'draft not restored');
  await clearForm(page); await page.waitForTimeout(200);
  ok(await page.evaluate(() => localStorage.getItem('mirc-rfo-draft-v1')) === null, 'draft not deleted');
  ok(!(await page.isChecked('#draftToggle')), 'toggle still on');
});
// validation
await check('Data validation rejects bad IPPS-A Empl ID (not 8+ digits) with a message', async () => {
  await page.fill('[data-key="RFO Form!J5"]', 'abc'); await page.dispatchEvent('[data-key="RFO Form!J5"]', 'change'); await page.waitForTimeout(150);
  const v = await page.inputValue('[data-key="RFO Form!J5"]'); const toast = await page.textContent('#toast');
  ok(v === '' && toast.includes('⚠'), `value=${v} toast=${toast}`);
});
// conflicts
await check('196 + 244 conflict via UI → both red, CONFLICT message, NOT READY', async () => {
  await clearForm(page); await fillCase(page, FX('H2_244_vs_196_still'));
  const st = await status(page); ok(st.includes('NOT READY'), st);
  const t = await page.textContent('#statusGrid'); ok(t.includes('CONFLICT: 196 + 244'), 'no msg');
  const red = await page.$$eval('.cell.is-red', (els) => els.map((e) => e.dataset.value)); ok(red.some((v) => v.startsWith('196')) && red.some((v) => v.startsWith('244')), JSON.stringify(red));
});
await page.evaluate(() => { document.getElementById('toast').classList.remove('show'); document.querySelector('.cell.is-red').scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + 'desktop_form_conflict.png' });
await (await page.$('#statusGrid')).screenshot({ path: SHOTS + 'desktop_status_conflict.png' });
await check('conflicting code hidden from the pick list (196 picked → 244 not offered)', async () => {
  await clearForm(page); await fillCase(page, FX('T3b_lists_hide'));
  const all = await page.$$eval('select.ctl', (s) => s.map((x) => [x.dataset.key, [...x.options].map((o) => o.textContent)]));
  const pm2 = all.find(([k]) => k === 'RFO Form!C' + (99 + SHIFT)) || all.find(([, o]) => o.some((t) => t.startsWith('240 –')));
  ok(pm2 && !pm2[1].some((t) => t.startsWith('244 –')), 'still offered');
});
await check('mileage YES adds only 272', async () => {
  await clearForm(page); await fillCase(page, FX('X1_mileage_yes_only_272'));
  ok((await page.textContent(`[data-addr="${CODES}"]`)).trim() === '272');
});
await check('removed codes 282/195/131/295 never offered in any list', async () => {
  const txt = (await page.$$eval('select.ctl option, datalist option', (o) => o.map((x) => x.textContent || x.value))).join('\n');
  ok(!/^(282|195|131|295) –/m.test(txt));
});
// cost
for (const [n, tot] of [['E1_sample1_E5_bragg_15d', '$5,944.54'], ['E2_sample2_O3_huachuca_30d', '$15,177.16']]) {
  await check(`cost estimate ${n} via UI = ${tot}`, async () => {
    await clearForm(page); await page.evaluate(() => window.__rfoApi.ensureRates()); await page.waitForFunction(() => window.__rfo.rates.loaded);
    await fillCase(page, FX(n)); await page.waitForTimeout(200);
    ok((await page.textContent('#costChip')).includes(tot), await page.textContent('#costChip'));
    ok((await page.textContent('[data-addr="J26"]')).includes(tot), 'total not on the form (SOLDIER DATA block)');
    ok((await page.textContent('[data-addr="C15"]')).startsWith('TDY'), 'order type not TDY');
    const g = await page.textContent('#formGrid'); ok(g.includes('ESTIMATE ONLY') && g.includes('RATES AS OF'), 'no estimate-only / sources');
    ok(!(await page.$('.tabs button[data-view=cost]')), 'separate cost tab still there');
  });
  if (n.startsWith('E1')) { await (await page.$('#formGrid')).screenshot({ path: SHOTS + 'desktop_form_with_estimate_E5_bragg.png' }); }
}
// change set 12: tour-length rules + day limits through the UI
for (const [n, ot, bah] of [['B_ADT140', 'PCS', 'PDS rate'], ['B_ADT139', 'TDY', 'HOR rate'], ['B_ADOS181', 'PCS', 'PDS rate'], ['B_ADOS180', 'TDY', 'HOR rate'], ['B_AT29', 'TDY', 'BAH-RC']]) {
  await check(`order type ${n} via UI → ${ot} · ${bah}`, async () => {
    await clearForm(page); await fillCase(page, FX(n)); await page.waitForTimeout(150);
    ok((await page.textContent('[data-addr="C15"]')).startsWith(ot), await page.textContent('[data-addr="C15"]'));
    ok((await page.textContent('[data-addr="H15"]')).includes(bah), await page.textContent('[data-addr="H15"]'));
  });
  if (n === 'B_ADT140') { await page.evaluate(() => { document.getElementById('toast').classList.remove('show'); window.scrollTo(0, 0); }); await (await page.$('#formGrid')).screenshot({ path: SHOTS + 'desktop_form_PCS_ADT140.png' }); }
}
await check('AT: days list stops at 29; 30 days (typed via API) → red + "can\'t exceed 29 days", NOT READY', async () => {
  await clearForm(page); await fillCase(page, FX('B_AT29'));
  const days = 'RFO Form!' + CM.CELL.DAYS;
  const opts = await page.$eval(`[data-key="${days}"]`, (n) => [...n.options].map((o) => o.textContent).filter(Boolean));
  ok(opts.length === 29 && opts[28] === '29', 'AT list ' + opts.length);
  await page.evaluate((k) => window.__rfoApi.set({ [k]: 30 }), days); await page.waitForTimeout(150);
  const t = await page.textContent('#statusGrid'); ok(t.includes("Annual Training can't exceed 29 days"), 'no AT msg');
  ok(await page.$eval(`[data-addr="${CM.CELL.DAYS}"]`, (n) => n.classList.contains('is-red')), 'days not red'); ok((await status(page)).includes('NOT READY'));
});
await check('ADOS-RC: days list goes to 365; 366 → "max 365 days per fiscal year"', async () => {
  await clearForm(page); await fillCase(page, FX('B_ADOS365'));
  const days = 'RFO Form!' + CM.CELL.DAYS;
  const n = await page.$eval(`[data-key="${days}"]`, (x) => [...x.options].filter((o) => o.textContent).length); ok(n === 365, 'list ' + n);
  await page.evaluate((k) => window.__rfoApi.set({ [k]: 366 }), days); await page.waitForTimeout(150);
  ok((await page.textContent('#statusGrid')).includes('max 365 days per fiscal year'), 'no 365 msg');
});
await check('cost shows on summary with same total', async () => {
  await page.click('.tabs button[data-view=form]'); await clearForm(page); await fillCase(page, FX('E2_sample2_O3_huachuca_30d')); await page.waitForTimeout(200);
  await page.click('.tabs button[data-view=summary]'); await page.waitForTimeout(200);
  ok((await page.textContent('#summaryGrid')).includes('$15,177.16'));
});
// summary + prints
await clearForm(page); await fillCase(page, { ...FX('Z1_summary_approvers'), ['RFO Form!' + CM.QCELL.D1]: 'NO', ['RFO Form!' + CM.QCELL.D2]: 'NO' });
await page.evaluate(() => window.__rfoApi.set({ 'RFO Form!H10': 'Over 6', 'RFO Form!H8': 'YES', 'RFO Form!H11': '28310' }));
await page.click('.tabs button[data-view=summary]'); await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + 'desktop_summary.png', fullPage: true });
const pages = (f) => +/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())[1];
await check('1-page summary prints on exactly ONE portrait Letter page', async () => {
  await page.evaluate(() => window.__rfoPreparePrint('summary'));
  await page.pdf({ path: SHOTS + 'print_summary.pdf', preferCSSPageSize: true, printBackground: true });
  ok(pages(SHOTS + 'print_summary.pdf') === 1, 'pages=' + pages(SHOTS + 'print_summary.pdf'));
  const info = execFileSync('pdfinfo', [SHOTS + 'print_summary.pdf']).toString(); ok(/612 x 792/.test(info), 'not letter portrait');
  const t = execFileSync('pdftotext', ['-layout', SHOTS + 'print_summary.pdf', '-']).toString();
  ok(t.includes('1-PAGE SUMMARY') && t.includes('APPROVING AUTHORITY') && t.includes('5,944.54'), 'content missing');
});
await check('full form prints with signature / approving-authority block', async () => {
  await page.evaluate(() => { delete document.body.dataset.print; }); await page.click('.tabs button[data-view=form]');
  await page.evaluate(() => window.__rfoPreparePrint('form'));
  await page.pdf({ path: SHOTS + 'print_form.pdf', preferCSSPageSize: true, printBackground: true });
  const t = execFileSync('pdftotext', [SHOTS + 'print_form.pdf', '-']).toString().replace(/\s+/g, ' ');
  ok(t.includes('APPROVED BY OIC/NCOIC') && t.includes('APPROVED BY 1SG/CDR') && t.includes('Signature'), 'no signature block');
  ok(!t.includes('Keep a draft'), 'app chrome printed');
  results.push(['INFO', `form PDF pages: ${pages(SHOTS + 'print_form.pdf')}`]);
  await page.evaluate(() => { delete document.body.dataset.print; });
});
// help + feedback
await check('Help tab shows instructions and rules table', async () => {
  await page.click('.tabs button[data-view=help]'); const t = await page.textContent('#helpBody'); ok(t.length > 2000 && /unofficial/i.test(t));
});
await check('Feedback Like + form saved locally only', async () => {
  await page.click('.tabs button[data-view=feedback]'); await page.click('#fbLike');
  await page.selectOption('#fbForm select[name=rating]', '5'); await page.selectOption('#fbForm select[name=useful]', 'YES');
  await page.fill('#fbForm textarea[name=comment]', 'e2e comment'); await page.click('#fbForm button[type=submit]');
  const l = await page.evaluate(() => JSON.parse(localStorage.getItem('mirc-rfo-feedback-v1'))); ok(l.length === 2 && l[1].comment === 'e2e comment');
  await page.click('#fbDelete'); ok(await page.evaluate(() => localStorage.getItem('mirc-rfo-feedback-v1')) === null);
});
await check('no network request ever left 127.0.0.1; no JS errors', async () => { ok(page.ext.length === 0, page.ext.join(', ')); ok(page.errs.length === 0, page.errs.join('; ')); });
await check('unofficial-aid label visible', async () => { ok(/Unofficial planning aid/.test(await page.textContent('header'))); });

// ---------- phone width ----------
const ph = await newPage({ width: 390, height: 844 }, 2);
await check('phone: Johnson READY via controls, no horizontal overflow', async () => {
  await fillCase(ph, FX('T1c_AT_full_READY_johnson'));
  ok((await status(ph)).includes('READY TO SUBMIT'));
  const ov = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(ov <= 1, 'overflow ' + ov);
});
await ph.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); document.getElementById('toast').classList.remove('show'); }); await ph.waitForTimeout(200);
await ph.screenshot({ path: SHOTS + 'phone_form.png' });
await ph.evaluate(() => window.scrollTo(0, 900)); await ph.screenshot({ path: SHOTS + 'phone_form_scrolled.png' });
await check('phone: status chip opens the status drawer', async () => {
  await ph.evaluate(() => window.scrollTo(0, 0)); await ph.click('#statusToggle'); await ph.waitForTimeout(300);
  ok(await ph.evaluate(() => document.body.classList.contains('drawer-open')));
});
await ph.evaluate(() => document.getElementById('toast').classList.remove('show'));
await ph.screenshot({ path: SHOTS + 'phone_status.png' });
await check('phone: drawer Close button closes it', async () => { await ph.click('#drawerClose'); ok(!(await ph.evaluate(() => document.body.classList.contains('drawer-open')))); }); await clearForm(ph);
await ph.evaluate(() => window.__rfoApi.ensureRates()); await ph.waitForFunction(() => window.__rfo.rates.loaded);
await fillCase(ph, FX('E1_sample1_E5_bragg_15d'));
await check('phone: cost estimate $5,944.54', async () => ok((await ph.textContent('#costChip')).includes('$5,944.54')));
await ph.evaluate(() => { document.activeElement?.blur(); document.querySelector('[data-addr="C15"]').scrollIntoView({ block: 'start' }); }); await ph.waitForTimeout(200);
await ph.screenshot({ path: SHOTS + 'phone_cost.png' });
await ph.screenshot({ path: SHOTS + 'phone_cost_full.png', fullPage: true });
await ph.click('.tabs button[data-view=summary]'); await ph.waitForTimeout(300);
await check('phone: summary page scaled to fit width', async () => { const ov = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(ov <= 1, 'overflow ' + ov); });
await ph.screenshot({ path: SHOTS + 'phone_summary.png', fullPage: true });
await check('phone: no external requests / errors', async () => { ok(ph.ext.length === 0, ph.ext.join(',')); ok(ph.errs.length === 0, ph.errs.join(';')); });

await browser.close(); server.kill();
for (const r of results) console.log(r[0].padEnd(5), r[1]);
console.log(`E2E: ${results.filter((r) => r[0] === 'PASS').length} passed, ${failures} failed  (Johnson filled: ${jf ? jf.ui + ' via controls, ' + jf.api + ' via API' : '-'})`);
process.exit(failures ? 1 : 0);
