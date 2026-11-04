# MIRC RFO Planner (unofficial planning aid)

Static, fully client-side web version of the MIRC RFO interactive workbook (change set 13).
**Not an official Army / DoD system.** No backend, no sign-in, no analytics; the page makes no
network requests except for its own files. Optional drafts go to this browser's `localStorage`
and are deleted by **Clear form**.

## Open it locally
`dist/` is plain static files, but browsers block `fetch()` of the JSON data from `file://`, so
double-clicking `index.html` will NOT work. Serve the folder instead (local only):

```bash
mkdir -p /tmp/site && cp -r dist /tmp/site/mirc-rfo && python3 -m http.server 8080 --bind 127.0.0.1 -d /tmp/site   # open http://127.0.0.1:8080/mirc-rfo/
# or, from the project:  npm run preview   ->  http://127.0.0.1:4173/mirc-rfo/
```

## How it's built
* `tools/extract.py` reads the workbook (read-only) and writes `public/data/*.json`
  (form layout, validation lists, conditional formats, every formula, rate tables). Re-run after a
  workbook update: `npm run extract && npm run build`.
* The workbook's own formulas run in the browser through HyperFormula (GPL-3.0). The cost
  estimator (Rates sheet) is ported to JS (`src/cost.js`) and checked against the workbook.
* Big rate tables (BAH, per diem, ZIP map, ~2.3 MB) are lazy-loaded when an estimate is needed.
* Change set 12: the order type + cost estimate live in the SOLDIER DATA block at the top of the
  form (no separate cost tab). ORDER TYPE = PCS / TDY per AR 37-104-4 para 8-4, Fig 8-19 (AT/ADT/ADOS-RC
  1-30 d TDY BAH-RC; ADT/ADTS 31-139 TDY HOR BAH, 140+ PCS PDS BAH; ADOS-RC 31-180 TDY HOR, 181+ PCS PDS;
  HOR-rate exceptions for commuting distance, multiple locations, DA G1 waiver with dependents;
  amendments split TDY -> PCS). PCS = per diem only for the PCS travel days. AT max 29 days, other
  duty types max 365 days per fiscal year.

## Tests
* `npm test` - node:test (150 tests): 94 workbook scenarios x ~8,700 formula cells + every cost line vs
  LibreOffice-calculated workbook values, plus explicit rule tests (decision tree, removed
  codes, 16 approved conflicts + 196/244, READY logic, cost samples, CS12 PCS/TDY boundaries
  29/30/31, 139/140, 180/181, waiver / commuting / multi-location / amendment, AT 29 + 365-day caps,
  CS13 compact estimate box, MORE OPTIONS toggle, tooltips).
* `npm run build && npm run e2e` - headless Chromium against `dist/` on 127.0.0.1: real-control
  form filling, status, conflicts, cost, save/open, clear, drafts, feedback, print PDFs (summary =
  1 page), no external requests; writes `screenshots/`.
* `tools/py_bridge_run_tests.py` re-runs the original Python assertions against JS-computed values.

## Deploy
`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages once a repo exists and
Pages source = "GitHub Actions". `vite.config.js` uses `base: '/mirc-rfo/'` (live at https://fastcoqui.github.io/mirc-rfo/).
A GitHub Pages site is public on the internet (even from a private repo on most plans).
