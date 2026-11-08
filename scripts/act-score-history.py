#!/usr/bin/env python3
"""Build a compact score history and SVG chart from benchmark artifacts."""

import json
from pathlib import Path

root = Path('artifacts/act-benchmark')
report_path = root / 'results.json'
if not report_path.exists():
    raise SystemExit('Missing artifacts/act-benchmark/results.json')

history_path = Path('prior-score-history.json')
history = json.loads(history_path.read_text()).get('runs', []) if history_path.exists() else []
report = json.loads(report_path.read_text())
point = {
    'date': report['createdAt'],
    'model': report['model'],
    'passRate': report['overallPassRate'],
    'endStatePassRate': report['endStatePassRate'],
}
history = [run for run in history if run.get('date') != point['date']]
history.append(point)
history = history[-60:]
(root / 'score-history.json').write_text(json.dumps({'runs': history}, indent=2) + '\n')

width, height, pad = 800, 320, 48
plot_width, plot_height = width - 2 * pad, height - 2 * pad
def coords(key):
    if len(history) == 1:
        xs = [pad + plot_width / 2]
    else:
        xs = [pad + i * plot_width / (len(history) - 1) for i in range(len(history))]
    return [(x, pad + (1 - max(0, min(1, item[key]))) * plot_height) for x, item in zip(xs, history)]

def polyline(key, color):
    return ' '.join(f'{x:.1f},{y:.1f}' for x, y in coords(key))

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
<rect width="100%" height="100%" fill="#fff"/>
<text x="{pad}" y="24" font-family="sans-serif" font-size="16">Act local-fixture model evaluation (last {len(history)} runs)</text>
<line x1="{pad}" y1="{height-pad}" x2="{width-pad}" y2="{height-pad}" stroke="#777"/>
<line x1="{pad}" y1="{pad}" x2="{pad}" y2="{height-pad}" stroke="#777"/>
<polyline fill="none" stroke="#1456a0" stroke-width="3" points="{polyline('passRate', '#1456a0')}"/>
<polyline fill="none" stroke="#25915a" stroke-width="2" points="{polyline('endStatePassRate', '#25915a')}"/>
<text x="{pad}" y="{height-12}" font-family="sans-serif" font-size="12">0</text>
<text x="8" y="{pad+4}" font-family="sans-serif" font-size="12">100%</text>
<text x="{width-pad-160}" y="{pad+15}" font-family="sans-serif" font-size="12" fill="#1456a0">Task pass rate</text>
<text x="{width-pad-160}" y="{pad+32}" font-family="sans-serif" font-size="12" fill="#25915a">End-state pass rate</text>
</svg>'''
(root / 'score-history.svg').write_text(svg)
