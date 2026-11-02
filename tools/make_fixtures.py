#!/usr/bin/env python3
"""Golden fixtures for the JS parity tests: for every workbook test case built by the Excel project's test suite
(/workspace/mirc_rfo/tests/<case>.xlsx = workbook + inputs, tests/calc/<case>.xlsx = LibreOffice-recalculated),
write the inputs (cells that differ from the shipped workbook) and the expected value of every formula cell."""
import os, sys, json, glob, datetime
import openpyxl
T = os.environ.get('RFO_TESTS', '/workspace/mirc_rfo/tests'); MAIN = '/workspace/mirc_rfo/MIRC_RFO_Interactive.xlsx'
OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures')
SHEETS = ['RFO Form', 'RFO Summary', 'Lists', 'AI_Engine']
EPOCH = datetime.datetime(1899, 12, 30)
def ser(v):
    if isinstance(v, datetime.datetime): return round((v - EPOCH).total_seconds() / 86400, 6)
    if isinstance(v, datetime.date): return (datetime.datetime(v.year, v.month, v.day) - EPOCH).days
    if isinstance(v, datetime.time): return round((v.hour * 3600 + v.minute * 60 + v.second) / 86400, 6)
    return v
def consts(wb):
    out = {}
    for s in SHEETS:
        for row in wb[s].iter_rows():
            for c in row:
                v = c.value
                if isinstance(v, str) and v.startswith('='): continue
                out[f'{s}!{c.coordinate}'] = ser(v)
    return out
base = consts(openpyxl.load_workbook(MAIN))
cases = sorted(os.path.basename(p)[:-5] for p in glob.glob(f'{T}/calc/*.xlsx') if os.path.exists(f'{T}/{os.path.basename(p)}'))
# only cases recalculated after the inputs file was built (stale leftovers from older runs are skipped)
cases = [c for c in cases if os.path.getmtime(f'{T}/calc/{c}.xlsx') >= os.path.getmtime(f'{T}/{c}.xlsx')]
os.makedirs(OUT, exist_ok=True); idx = []
for c in cases:
    wi = openpyxl.load_workbook(f'{T}/{c}.xlsx')
    if 'Rates' not in wi.sheetnames: continue          # pre-change-set-11 leftovers
    ci = consts(wi)
    inputs = {k: v for k, v in ci.items() if base.get(k) != v}
    inputs.update({k: None for k in base if k not in ci and base[k] is not None})
    wc = openpyxl.load_workbook(f'{T}/calc/{c}.xlsx', data_only=True)
    exp = {}
    for s in SHEETS:
        ws = wi[s]
        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                if isinstance(v, str) and v.startswith('='):
                    exp[f'{s}!{cell.coordinate}'] = ser(wc[s][cell.coordinate].value)
    rs = wc['Rates']; est = {rs[f'A{r}'].value: ser(rs[f'B{r}'].value) for r in range(2, 400) if rs[f'A{r}'].value}
    stamp = datetime.datetime.fromtimestamp(os.path.getmtime(f'{T}/calc/{c}.xlsx')).isoformat()
    json.dump(dict(case=c, recalculated=stamp, inputs=inputs, expected=exp, est=est), open(f'{OUT}/{c}.json', 'w'), default=str, separators=(',', ':'))
    idx.append(c); print(c, len(inputs), len(exp))
json.dump(idx, open(f'{OUT}/index.json', 'w'))
print(len(idx), 'cases')
