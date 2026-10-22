"""Check the live site before you push (website-sync skill, step 4):

    python tools/site_check.py

Errors (exit 1): a relative href, src or data-zoom that points at no file; a JSON-LD block that does not
parse; a For Geeks page whose top bar or footer differs from tools/geeks_shell.py; a screenshot path or size that disagrees with assets/app/shots.json (tools/shots.py); an archive/ snapshot without noindex; a Version Archive row whose state disagrees with
version-registry.json; a live page whose data-ux-version is not current in the registry.
Warnings: an indexable page whose title passes 60 characters or description 160 (README › Search), and the
count of snapshots whose stylesheets don't resolve from archive/ (no <base href="../">: they show unstyled).
Third-party links are not fetched."""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []
warnings: list[str] = []
live = sorted([*ROOT.glob("*.html"), *(ROOT / "ar").glob("*.html")])

for page in live:
    rel = page.relative_to(ROOT).as_posix()
    text = page.read_text(encoding="utf-8")
    for target in re.findall(r'(?:href|src|data-zoom)="([^"#?]+)', text):
        if re.match(r"^(?:[a-z]+:|//|/)", target):
            continue
        if not (page.parent / unquote(target)).resolve().exists():
            errors.append(f"{rel}: missing {target}")
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S):
        try:
            json.loads(block)
        except ValueError as exc:
            errors.append(f"{rel}: JSON-LD does not parse ({exc})")
    if "noindex" in text or 'http-equiv="refresh"' in text:
        continue
    title = html.unescape((re.search(r"<title>([^<]*)</title>", text) or [None, ""])[1])
    desc = html.unescape((re.search(r'<meta name="description" content="([^"]*)"', text) or [None, ""])[1])
    if len(title) > 60:
        warnings.append(f"{rel}: title {len(title)} characters")
    if not desc or len(desc) > 160:
        warnings.append(f"{rel}: description {len(desc)} characters")

unstyled = []
for snap in sorted((ROOT / "archive").glob("*.html")):
    text = snap.read_text(encoding="utf-8")
    if "noindex" not in text:
        errors.append(f"archive/{snap.name}: no noindex")
    base = ROOT if '<base href="../">' in text else snap.parent
    sheets = re.findall(r'<link rel="stylesheet" href="((?![a-z]+:|//)[^"?]+)', text)
    if any(not (base / unquote(s)).exists() for s in sheets):
        unstyled.append(snap.stem)
if unstyled:
    warnings.append(f"{len(unstyled)} archive snapshots show unstyled (no <base href=\"../\">), first {unstyled[0]}, last {unstyled[-1]}")

registry = {r["id"]: r for r in json.loads((ROOT / "version-registry.json").read_text(encoding="utf-8"))["releases"]}
versions = (ROOT / "versions.html").read_text(encoding="utf-8")
for rid, row in re.findall(r'<article class="card version-row" id="(UX-[^"]+)">(.*?)</article>', versions, re.S):
    entry = registry.get(rid)
    if entry is None:
        errors.append(f"versions.html: {rid} is not in the registry")
        continue
    shown_archived = 'class="version-state" href=' in row
    if shown_archived != (entry["status"] == "archived"):
        errors.append(f"versions.html: {rid} shows {'Archived' if shown_archived else 'Current'}, the registry says {entry['status']}")
for page in live:
    found = re.search(r'data-ux-version="([^"]+)"', page.read_text(encoding="utf-8"))
    if found and registry.get(found.group(1), {}).get("status") != "current":
        errors.append(f"{page.relative_to(ROOT).as_posix()}: {found.group(1)} is not current in the registry")

# For Geeks: one top bar and one footer on its three pages (tools/geeks_shell.py)
sys.path.insert(0, str(ROOT / "tools"))
import geeks_shell  # noqa: E402
import shots  # noqa: E402

for name, _, _ in geeks_shell.PAGES:
    text = (ROOT / name).read_text(encoding="utf-8")
    if geeks_shell.build(text, name) != text:
        errors.append(f"{name}: the For Geeks top bar or footer is out of date (run python tools/geeks_shell.py)")

errors += shots.errors()  # screenshot paths and sizes agree with assets/app/shots.json

for line in warnings:
    print("warning:", line)
for line in errors:
    print("error:", line)
print(f"{len(live)} pages, {len(errors)} errors, {len(warnings)} warnings")
sys.exit(1 if errors else 0)
