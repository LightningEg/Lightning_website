"""One record of the current app release, and every page that quotes it kept in step with it.

    python tools/app_release.py            # check: every page that names the current release agrees with app-release.json
    python tools/app_release.py sync       # show what a new release changes; add --write to apply it
    python tools/app_release.py notes      # check that Downloads and the release log show release-notes.json; add --write to render it

app-release.json is the one place the current version, date, commit and the two download files are written. After an app
release: edit it, run `sync --write`, read the diff, then add the release-log row and the version-archive rows
(tools/release.py). Older versions stay where history belongs (release-log.html, versions.html, archive/, app-feedback's
build list, which gets one new option by hand).

release-notes.json holds the current release's plain-language notes, English and Egyptian Arabic side by side (plan item 8Y).
They are shown on Downloads (a "What's new" section) and as the Highlights of the newest entry in the release log, in both
languages, between <!--notes--> markers; `notes --write` renders them, the check fails when a page differs.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORD = ROOT / "app-release.json"
# Pages whose newest version number must be the current release. History pages are not listed.
CURRENT = ("current-status.html", "ar/current-status.html", "index.html", "ar/index.html", "features.html", "ar/features.html",
           "sample-profiles.html", "ar/sample-profiles.html", "app-feedback.html", "ar/app-feedback.html", "forgeeks.html",
           "README.md", "llms.txt")
NOT_SYNCED = ("app-feedback.html", "ar/app-feedback.html")  # a list of builds: a new option is added by hand
VERSION = re.compile(r"(?<![\d.A-Za-z-])v?(1\.\d+\.\d+)(?![\d.])")
WINDOWS = re.compile(r"Lightning-v\d+\.\d+\.\d+-Windows-x64\.zip")
ANDROID = re.compile(r"Lightning-Test-[\w.]+-\d+-[0-9a-f]{8}\.apk")


def record() -> dict:
    return json.loads(RECORD.read_text(encoding="utf-8"))


def key(version: str) -> tuple:
    return tuple(int(part) for part in version.split("."))


def problems() -> list[str]:
    data, out = record(), []
    if data["windows"] != f"Lightning-v{data['version']}-Windows-x64.zip":
        out.append(f"app-release.json: windows file {data['windows']} does not name version {data['version']}")
    if not data["android"].endswith(f"-{data['commit']}.apk") or f"-{data['version']}-" not in data["android"]:
        out.append(f"app-release.json: android file {data['android']} does not match version {data['version']} and commit {data['commit']}")
    for name in CURRENT:
        text = (ROOT / name).read_text(encoding="utf-8")
        versions = {v for v in VERSION.findall(text) if v != "1.0.0"}
        if versions and max(versions, key=key) != data["version"]:
            out.append(f"{name}: newest version is {max(versions, key=key)}, the release is {data['version']}")
        if name.endswith("current-status.html"):
            for pattern, wanted in ((WINDOWS, data["windows"]), (ANDROID, data["android"])):
                wrong = {m for m in pattern.findall(text) if m != wanted}
                if wrong or not pattern.search(text):
                    out.append(f"{name}: download file {sorted(wrong) or 'missing'}, the release has {wanted}")
    return out


def sync(write: bool) -> list[str]:
    data, changes = record(), []
    for name in CURRENT:
        if name in NOT_SYNCED:
            continue
        path = ROOT / name
        text = new = path.read_text(encoding="utf-8")
        found = {v for v in VERSION.findall(text) if v != "1.0.0"}
        if found and max(found, key=key) != data["version"]:
            new = re.sub(rf"(?<![\d.A-Za-z-])(v?){re.escape(max(found, key=key))}(?![\d.])", rf"\g<1>{data['version']}", new)
        new = WINDOWS.sub(data["windows"], ANDROID.sub(data["android"], new))
        if name == "README.md":
            new = re.sub(r"(Current app release: \*\*v)[^*]+(\*\* \()[\d-]+(\))", rf"\g<1>{data['version']}\g<2>{data['date']}\g<3>", new)
            new = re.sub(r"(Android arm64 APK from `)[0-9a-f]{8}(`)", rf"\g<1>{data['commit']}\g<2>", new)
        if new != text:
            changes.append(name)
            if write:
                path.write_text(new, encoding="utf-8")
    return changes


NOTES = ROOT / "release-notes.json"
START, END = "<!--whats-new-->", "<!--/whats-new-->"
COPY = {  # the Downloads section's own words
    "en": ("What’s new", "Notes for Lightning {v}", "Plain words, from the release notes. The full list is in the release log."),
    "ar": ("الجديد", "ملاحظات لايتنينج {v}", "بكلام بسيط، من ملاحظات الإصدار. القايمة الكاملة في سجل الإصدارات."),
}


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render_notes(lang: str) -> dict[str, str]:
    """The three generated fragments of one language: the Downloads section, and the release log's Highlights list."""
    data = json.loads(NOTES.read_text(encoding="utf-8"))
    t, k = (lang + "_title"), lang
    label, head, lead = COPY[lang]
    cards = "".join(f'<article class="card card-support"><h3>{esc(i[t])}</h3><p>{esc(i[k])}</p></article>' for i in data["items"])
    section = (f'{START}<section class="d-section" id="whats-new" aria-labelledby="whats-new-title"><div class="d-head"><p class="label">{label}</p>'
               f'<h2 id="whats-new-title">{head.format(v=data["version"])}</h2><p>{lead}</p></div><div class="status-checklist">{cards}</div></section>{END}')
    log = '<ul class="log-list">' + "".join(f'<li><div><b>{esc(i[t])}</b> {esc(i[k])}</div></li>' for i in data["items"]) + "</ul>"
    return {"section": section, "log": log}


def notes_sync(write: bool) -> list[str]:
    """Pages whose generated notes differ from release-notes.json (rewritten when write)."""
    data, out = json.loads(NOTES.read_text(encoding="utf-8")), []
    if data["version"] != record()["version"]:
        out.append(f"release-notes.json is for {data['version']}, the release is {record()['version']}")
    for lang, prefix in (("en", ""), ("ar", "ar/")):
        frag = render_notes(lang)
        status, log = ROOT / f"{prefix}current-status.html", ROOT / f"{prefix}release-log.html"
        text = new = status.read_text(encoding="utf-8")
        if START in text:
            new = re.sub(re.escape(START) + ".*?" + re.escape(END), lambda _: frag["section"], text, flags=re.S)
        else:  # first time: after the intro note, before the install steps
            new = re.sub(r'(</header>\n)', lambda m: m.group(1) + "\n  " + frag["section"] + "\n", text, count=1)
        if new != text:
            out.append(f"{status.relative_to(ROOT)}: the What’s new section differs from release-notes.json")
            if write:
                status.write_text(new, encoding="utf-8")
        text = new = log.read_text(encoding="utf-8")
        new = re.sub(r"<!--notes-->.*?<!--/notes-->", lambda _: "<!--notes-->" + frag["log"] + "<!--/notes-->", text, count=1, flags=re.S)
        if new != text:
            out.append(f"{log.relative_to(ROOT)}: the newest entry's highlights differ from release-notes.json")
            if write:
                log.write_text(new, encoding="utf-8")
    return out


def main() -> int:
    if sys.argv[1:2] == ["notes"]:
        found = notes_sync("--write" in sys.argv)
        print(("wrote: " if "--write" in sys.argv else "") + ("\n".join(found) or "Downloads and the release log show release-notes.json"))
        return 0 if "--write" in sys.argv or not found else 1
    if sys.argv[1:2] == ["sync"]:
        changed = sync("--write" in sys.argv)
        print(("wrote " if "--write" in sys.argv else "would change ") + (", ".join(changed) or "nothing"))
        print("By hand: app-feedback.html and ar/app-feedback.html get an option for the new build; release-log.html and versions.html get a row.")
        return 0
    found = problems() + notes_sync(False)
    print("\n".join(found) or "the pages agree with app-release.json and release-notes.json")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
