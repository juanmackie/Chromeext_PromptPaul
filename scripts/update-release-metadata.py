#!/usr/bin/env python3
"""Synchronize release versions from the latest changelog entry."""

import json
import re
from pathlib import Path

changelog = Path('CHANGELOG.md').read_text()
match = re.search(r'^## \[(\d+\.\d+\.\d+)\](?: - [^\n]+)?$', changelog, re.M)
if not match:
    raise SystemExit('CHANGELOG.md must start with a semantic-version release heading')
version = match.group(1)

for filename in ('package.json', 'manifest.json'):
    path = Path(filename)
    contents = path.read_text()
    data = json.loads(contents)
    if data.get('version') != version:
        contents = re.sub(r'("version"\s*:\s*)"[^"]+"', rf'\g<1>"{version}"', contents, count=1)
        path.write_text(contents)

lock_path = Path('package-lock.json')
lock_contents = lock_path.read_text()
lock = json.loads(lock_contents)
if lock.get('version') != version or lock.get('packages', {}).get('', {}).get('version') != version:
    lock_contents = re.sub(
        r'("version"\s*:\s*)"[^"]+"',
        rf'\g<1>"{version}"',
        lock_contents,
        count=2,
    )
    lock_path.write_text(lock_contents)
print(f'Synchronized release metadata to {version}')
