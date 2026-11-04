#!/usr/bin/env python3
"""Extract the MIRC RFO workbook (read-only) into JSON for the web app.
usage: python3 tools/extract.py [path/to/MIRC_RFO_Interactive.xlsx] [outdir]
Re-run after any workbook update; nothing in the workbook is modified."""
import sys, os, json, re, datetime, hashlib
import openpyxl
from openpyxl.utils import get_column_letter, range_boundaries

SRC = sys.argv[1] if len(sys.argv) > 1 else '/workspace/mirc_rfo/MIRC_RFO_Interactive.xlsx'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
os.makedirs(OUT, exist_ok=True)
ENGINE_SHEETS = ['RFO Form', 'RFO Summary', 'Lists', 'AI_Engine']
UI_SHEETS = ['RFO Form', 'RFO Summary']
EPOCH = datetime.datetime(1899, 12, 30)

def serial(v):
    if isinstance(v, datetime.datetime): return (v - EPOCH).total_seconds() / 86400
    if isinstance(v, datetime.date): return (datetime.datetime(v.year, v.month, v.day) - EPOCH).days
    if isinstance(v, datetime.time): return (v.hour * 3600 + v.minute * 60 + v.second) / 86400
    return v

def clean_f(f):
    return f.replace('_xlfn.', '').replace('_xlws.', '')

def rgb(c):
    try:
        if c is None or c.type != 'rgb' or c.rgb is None: return None
        s = str(c.rgb)
        return '#' + s[-6:] if len(s) >= 6 and s != '00000000' else None
    except Exception: return None

def cell_value(c):
    v = c.value
    if v is None: return None
    if isinstance(v, str) and v.startswith('='): return clean_f(v)
    if type(v).__name__ == 'ArrayFormula': return clean_f(v.text)
    return serial(v)

wb = openpyxl.load_workbook(SRC)
src_md5 = hashlib.md5(open(SRC, 'rb').read()).hexdigest()

# ---------- engine: cells + names
engine = dict(source=os.path.basename(SRC), md5=src_md5, sheets={}, names={}, offsetLists={}, costNames=[])
for sn in ENGINE_SHEETS:
    ws = wb[sn]; cells = {}
    for row in ws.iter_rows():
        for c in row:
            v = cell_value(c)
            if v is not None and v != '': cells[c.coordinate] = v
    engine['sheets'][sn] = dict(cells=cells, maxRow=ws.max_row, maxCol=ws.max_column)

rates_calc = {}
rs = wb['Rates']
for r in range(2, 400):
    n = rs[f'A{r}'].value
    if not n: continue
    rates_calc[n] = r
for n, d in wb.defined_names.items():
    t = clean_f(d.attr_text)
    m = re.match(r"^OFFSET\((\w+)!\$([A-Z]+)\$(\d+),0,0,(.+),1\)$", t)
    if m:
        engine['offsetLists'][n] = dict(sheet=m.group(1), col=m.group(2), row=int(m.group(3)), count=m.group(4))
        continue
    if t.startswith('Rates!') or t.startswith("'Rates'!"):
        if n in rates_calc: engine['costNames'].append(n)     # E_* values supplied by the JS cost engine
        continue
    if 'Admin Dashboard' in t or 'Feedback Log' in t: continue
    engine['names'][n] = t
engine['costNames'].sort(key=lambda n: rates_calc[n])
_ml = re.search(r"'RFO Form'!\$?([A-Z]+)\$?(\d+)", str(rs[f"B{rates_calc['E_MLOC']}"].value or '')) if 'E_MLOC' in rates_calc else None
engine['costRefs'] = dict(VAR=f"RFO Form!{_ml.group(1)}{_ml.group(2)}") if _ml else {}

# ---------- UI layout (form + summary)
def font_d(f):
    return dict(b=bool(f.b), i=bool(f.i), sz=f.sz, color=rgb(f.color)) if f else None

def merges(ws):
    out = {}
    for m in ws.merged_cells.ranges:
        out[m.coord.split(':')[0]] = dict(c0=m.min_col, r0=m.min_row, c1=m.max_col, r1=m.max_row)
    return out

def dvs(ws):
    out = {}
    for d in ws.data_validations.dataValidation:
        for rg in str(d.sqref).split():
            c0, r0, c1, r1 = range_boundaries(rg)
            for r in range(r0, r1 + 1):
                for c in range(c0, c1 + 1):
                    a = f'{get_column_letter(c)}{r}'
                    f1 = d.formula1 or ''
                    e = dict(type=d.type or 'any', strict=(d.errorStyle in (None, 'stop')) and bool(d.showErrorMessage),
                             prompt=d.prompt, promptTitle=d.promptTitle, error=d.error, operator=d.operator)
                    if d.type == 'list':
                        if f1.startswith('"'): e['options'] = f1.strip('"').split(',')
                        else: e['listName'] = f1.lstrip('=')
                    elif f1: e['formula1'] = clean_f(f1)
                    out[a] = e
    return out

def cfs(ws):
    out = []
    for rng in ws.conditional_formatting:
        for r in rng.rules:
            if r.type != 'expression' or not r.formula: continue
            dx = r.dxf
            out.append(dict(ranges=str(rng.sqref).split(), priority=r.priority, stop=bool(r.stopIfTrue), formula=clean_f(r.formula[0]),
                            fill=rgb(dx.fill.fgColor) if dx and dx.fill and dx.fill.fgColor is not None else None,
                            font=rgb(dx.font.color) if dx and dx.font and dx.font.color is not None else None,
                            bold=bool(dx.font.b) if dx and dx.font else False))
    out.sort(key=lambda x: x['priority'])
    return out

from openpyxl.formula.tokenizer import Tokenizer
from openpyxl.formula.translate import Translator
CELLRE = re.compile(r'^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$')
def qualify(formula, sheet):
    """make every plain cell/range reference absolute and sheet-qualified so the formula can live anywhere"""
    tok = Tokenizer('=' + formula); out = ''
    for t in tok.items:
        v = t.value
        if t.type == 'OPERAND' and t.subtype == 'RANGE':
            m = CELLRE.match(v)
            if m:
                a = f'${m.group(1)}${m.group(2)}' + (f':${m.group(3)}${m.group(4)}' if m.group(3) else '')
                v = f"'{sheet}'!" + a
        out += v
    return out
def has_rel(formula):
    tok = Tokenizer('=' + formula)
    full_abs = re.compile(r'^\$[A-Z]{1,3}\$\d+(:\$[A-Z]{1,3}\$\d+)?$')
    return 'ROW()' in formula or 'COLUMN()' in formula or any(t.type == 'OPERAND' and t.subtype == 'RANGE' and CELLRE.match(t.value) and not full_abs.match(t.value) for t in tok.items)
def cf_entries(ws, sheet):
    out = []
    for r in cfs(ws):
        cells = []
        for rg in r['ranges']:
            c0, r0, c1, r1 = range_boundaries(rg)
            cells += [f'{get_column_letter(c)}{rr}' for rr in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
        top = r['ranges'][0].split(':')[0]
        base = dict(priority=r['priority'], fill=r['fill'], font=r['font'], bold=r['bold'], stop=r['stop'])
        if has_rel(r['formula']) and len(cells) > 1:
            for c in cells:
                f = Translator('=' + r['formula'], origin=top).translate_formula(c)[1:]
                f = f.replace('ROW()', str(range_boundaries(c + ':' + c)[1])).replace('COLUMN()', str(range_boundaries(c + ':' + c)[0]))
                out.append(dict(base, cells=[c], formula=qualify(f, sheet)))
        else:
            out.append(dict(base, cells=cells, formula=qualify(r['formula'], sheet)))
    return out

ui = {}
for sn in UI_SHEETS:
    ws = wb[sn]; cells = {}
    for row in ws.iter_rows(max_col=24):
        for c in row:
            v = cell_value(c); locked = c.protection.locked
            fill = rgb(c.fill.fgColor) if c.fill and c.fill.fill_type == 'solid' else None
            if v is None and locked and not fill and not c.comment: continue
            b = c.border
            cells[c.coordinate] = dict(v=v if not (isinstance(v, str) and v.startswith('=')) else None, f=isinstance(v, str) and v.startswith('='),
                                       fill=fill, font=font_d(c.font), al=dict(h=c.alignment.horizontal, v=c.alignment.vertical, wrap=bool(c.alignment.wrap_text)),
                                       fmt=c.number_format if c.number_format != 'General' else None, input=(locked is False),
                                       bd=''.join(k for k, s in (('t', b.top), ('r', b.right), ('b', b.bottom), ('l', b.left)) if s and s.style))
            if c.comment: cells[c.coordinate]['note'] = c.comment.text.strip()
            if c.hyperlink: cells[c.coordinate]['link'] = c.hyperlink.location or c.hyperlink.target
    dv = dvs(ws)
    for a, d in dv.items():
        if d.get('formula1') and d['type'] == 'custom': d['check'] = qualify(d['formula1'], sn)
    ui[sn] = dict(cells=cells, merges=merges(ws), dv=dv, cf=cf_entries(ws, sn), printArea=str(ws.print_area) if ws.print_area else None,
                  colWidths={k: v.width for k, v in ws.column_dimensions.items() if v.width},
                  rowHeights={k: v.height for k, v in ws.row_dimensions.items() if v.height},
                  maxRow=ws.max_row, hidden=[k for k, v in ws.column_dimensions.items() if v.hidden])

# instructions text (for the Help page)
ins = wb['Instructions']
ui['Instructions'] = [[ins.cell(r, c).value for c in range(1, 5)] for r in range(1, ins.max_row + 1)]
ru = wb['Rules']
ui['Rules'] = [[ru.cell(r, c).value for c in range(1, ru.max_column + 1)] for r in range(1, ru.max_row + 1)]

engine['cf'] = [dict(r, sheet=sn) for sn in UI_SHEETS for r in ui[sn]['cf']]
for sn in UI_SHEETS: ui[sn]['cf'] = None       # the engine copy is the one the app uses
json.dump(engine, open(os.path.join(OUT, 'engine.json'), 'w'), separators=(',', ':'), default=str)
json.dump(ui, open(os.path.join(OUT, 'ui.json'), 'w'), separators=(',', ':'), default=str)

# ---------- rates (from the hidden Rates tab - same tables the workbook uses)
R = {}
def col(c, r0, r1): return [rs[f'{c}{r}'].value for r in range(r0, r1 + 1)]
def table(c0, c1, r0, r1):
    i0, i1 = openpyxl.utils.column_index_from_string(c0), openpyxl.utils.column_index_from_string(c1)
    return [[serial(rs.cell(r, c).value) for c in range(i0, i1 + 1)] for r in range(r0, r1 + 1)]
dn = {n: clean_f(d.attr_text) for n, d in wb.defined_names.items() if n.startswith('RT_')}
def rng(n):
    t = dn[n].split('!')[1].replace('$', '')
    a, b = t.split(':') if ':' in t else (t, t)
    c0, r0, c1, r1 = range_boundaries(f'{a}:{b}')
    return [[serial(rs.cell(r, c).value) for c in range(c0, c1 + 1)] for r in range(r0, r1 + 1)]
from openpyxl.utils import column_index_from_string as ci
def rows(c0, c1, r0, r1, keycol=None):
    i0, i1 = ci(c0), ci(c1); out = []
    for r in range(r0, r1 + 1):
        row = [serial(rs.cell(r, c).value) for c in range(i0, i1 + 1)]
        if row[0] in (None, ''): continue
        out.append(row)
    return out
SMALL = ['RT_RANK', 'RT_RANKGR', 'RT_YOSMIN', 'RT_YOSLBL', 'RT_GRADES', 'RT_BASY', 'RT_BASE', 'RT_BASO', 'RT_FY', 'RT_FSS', 'RT_FMED', 'RT_POVY', 'RT_POVR', 'RT_ZHDR']
core = dict(ranges={n: [[c for c in row] for row in rng(n)] for n in SMALL if n in dn})
for n in list(core['ranges']):     # trim blank tails (the workbook leaves empty rows for next year's paste-in)
    v = core['ranges'][n]
    while v and all(x in (None, '') for x in v[-1]): v.pop()
core['fica_wage_base'] = rows('V', 'Y', 2, 20)
core['basic'] = rows('AG', 'BD', 2, 300)          # [year, grade, 22 YOS columns]
core['rct'] = rows('BG', 'BJ', 2, 300)            # [year, grade, without, with]
core['yosHeaders'] = [rs.cell(1, c).value for c in range(ci('AI'), ci('BD') + 1)]
core['sources'] = [[rs.cell(r, c).value for c in range(4, 9)] for r in range(1, 60) if any(rs.cell(r, c).value for c in range(4, 9))]
core['calcFormulas'] = {rs[f'A{r}'].value: rs[f'B{r}'].value for r in range(2, 400) if rs[f'A{r}'].value}
core['headers'] = {c: rs[f'{c}1'].value for c in ('J','K','M','N','P','R','S','T','V','W','X','Y','AA','AB')}
json.dump(core, open(os.path.join(OUT, 'rates-core.json'), 'w'), separators=(',', ':'), default=str)
bah = {}
for y, mha, t, name, *vals in rows('BM', 'CQ', 2, 3000):
    bah.setdefault(str(int(y)), {}).setdefault(mha, {'name': name})[t] = vals
json.dump(bah, open(os.path.join(OUT, 'rates-bah.json'), 'w'), separators=(',', ':'), default=str)
pd = {}
for fy, did, name, st, county, *rest in rows('CT', 'DK', 2, 2000):
    pd.setdefault(str(int(fy)), {})[str(int(did))] = dict(name=name, st=st, county=county, lodg=rest[:12], mie=rest[12])
json.dump(pd, open(os.path.join(OUT, 'rates-perdiem.json'), 'w'), separators=(',', ':'), default=str)
zips = {}
hdr = [rs.cell(1, c).value for c in range(ci('DN'), ci('DU') + 1)]
for z, *v in rows('DM', 'DU', 2, 44021):
    zips[str(int(z)).zfill(5)] = v
json.dump(dict(hdr=hdr, zips=zips), open(os.path.join(OUT, 'rates-zip.json'), 'w'), separators=(',', ':'), default=str)
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(os.path.join(OUT, f)))
print('names', len(engine['names']), 'offset lists', len(engine['offsetLists']), 'cost names', len(engine['costNames']))
