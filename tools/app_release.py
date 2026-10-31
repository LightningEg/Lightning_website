"""One record of the current app release, and every page that quotes it kept in step with it.

    python tools/app_release.py            # check: every page that names the current release agrees with app-release.json
    python tools/app_release.py sync       # show what a new release changes; add --write to apply it

app-release.json is the one place the current version, date, commit and the two download files are written. After an app
release: edit it, run `sync --write`, read the diff, then add the release-log row and the version-archive rows
(tools/release.py). Older versions stay where history belongs (release-log.html, versions.html, archive/, app-feedback's
build list, which gets one new option by hand).
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


def main() -> int:
    if sys.argv[1:2] == ["sync"]:
        changed = sync("--write" in sys.argv)
        print(("wrote " if "--write" in sys.argv else "would change ") + (", ".join(changed) or "nothing"))
        print("By hand: app-feedback.html and ar/app-feedback.html get an option for the new build; release-log.html and versions.html get a row.")
        return 0
    found = problems()
    print("\n".join(found) or "the pages agree with app-release.json")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
