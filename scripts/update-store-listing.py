#!/usr/bin/env python3
"""Sync the first five release notes into the Chrome Web Store What's new section."""

from pathlib import Path
import re

changelog = Path('CHANGELOG.md').read_text()
listing_path = Path('docs/STORE_LISTING.md')
listing = listing_path.read_text()
match = re.search(r'^## \[(\d+\.\d+\.\d+)\](?: - [^\n]+)?\n(.*?)(?=^## |\Z)', changelog, re.M | re.S)
if not match:
    raise SystemExit('No release section found in CHANGELOG.md')

version, body = match.groups()
entries = [line[2:].strip() for line in body.splitlines() if line.startswith('- ')]
notes = '\n'.join(entry for entry in entries[:5] if entry)
if not notes:
    raise SystemExit(f'No release notes found for {version}')

section = f'## What\'s new (version {version})\n\n{notes}'
listing, count = re.subn(r'^## What\'s new \(version [^)]+\)\n.*?(?=^## |\Z)', section + '\n\n', listing, count=1, flags=re.M | re.S)
if count != 1:
    raise SystemExit('Could not find the existing What\'s new section')
listing_path.write_text(listing)
