#!/usr/bin/env python3
"""tests/fixtures/cellmap.json = the workbook generator's cell addresses (CELL / QCELL / GCELLS) + conflict table."""
import sys, os, json
sys.path.insert(0, '/workspace/mirc_rfo/src')
import build_rfo as B, tree_ai as T
out = dict(CELL=B.CELL, QCELL=T.QCELL, GCELLS=T.GCELLS, CONFLICTS=[list(c[:3]) for c in T.CONFLICTS])
json.dump(out, open(os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'cellmap.json'), 'w'), indent=0)
print('cellmap: CODES', B.CELL['CODES'], 'DAYS', B.CELL['DAYS'], 'D1', T.QCELL['D1'])
