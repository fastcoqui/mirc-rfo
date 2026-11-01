# MIRC RFO Planner (unofficial planning aid)

Static, fully client-side web version of the MIRC RFO interactive workbook (change set 11).
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

## Tests
* `npm test` - node:test: 71 workbook scenarios x ~8,700 formula cells + every cost line vs
  LibreOffice-calculated workbook values, plus 33 explicit rule tests (decision tree, removed
  codes, 16 approved conflicts + 196/244, READY logic, cost samples).
* `npm run build && npm run e2e` - headless Chromium against `dist/` on 127.0.0.1: real-control
  form filling, status, conflicts, cost, save/open, clear, drafts, feedback, print PDFs (summary =
  1 page), no external requests; writes `screenshots/`.
* `tools/py_bridge_run_tests.py` re-runs the original 162 Python assertions against JS-computed values.

## Deploy
`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages once a repo exists and
Pages source = "GitHub Actions". `vite.config.js` uses `base: '/mirc-rfo/'` (live at https://fastcoqui.github.io/mirc-rfo/).
A GitHub Pages site is public on the internet (even from a private repo on most plans).
