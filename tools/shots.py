"""One home for the app screenshots (README > App screenshots).

    python tools/shots.py apply     rewrite every screenshot path and image size on the live pages from assets/app/shots.json
    python tools/shots.py check     the same, changing nothing; exit 1 if a page is out of step or a file is missing
    python tools/shots.py figures OLD NEW [OLD NEW ...] [--write]
                                    replace whole figures (910,304 -> 912,000) on live pages and llms.txt; Arabic pages get
                                    Arabic-Indic digits (٩١٠٬٣٠٤). Shows the count per file; changes nothing without --write

A page names a screen by file (`assets/app/<any folder>/overview.webp`); the manifest says which folder holds it for that
language. After a recapture: copy the new files into one new folder, point "folders" at it, empty "shots", run `apply`.
Live pages are the root *.html and ar/*.html; archive/ is frozen and keeps its own folders. Stdlib only."""
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "assets" / "app" / "shots.json"
PATH = re.compile(r"assets/app/([a-z0-9-]+)/([a-z0-9-]+)\.webp")
IMG = re.compile(r"<img\b[^>]*>")


def live_pages() -> list[Path]:
    return sorted(ROOT.glob("*.html")) + sorted((ROOT / "ar").glob("*.html"))


def folder_for(manifest: dict, page: Path, name: str) -> str:
    lang = "ar" if page.parent.name == "ar" else "en"
    pinned = manifest.get("pages", {}).get(page.relative_to(ROOT).as_posix())
    return pinned or manifest.get("shots", {}).get(name, {}).get(lang) or manifest["folders"][lang]


def webp_size(path: Path) -> tuple[int, int]:
    """Width and height from the WebP header (lossy, lossless or extended)."""
    head = path.read_bytes()[:40]
    kind = head[12:16]
    if kind == b"VP8 ":
        w, h = struct.unpack("<HH", head[26:30])
        return w & 0x3FFF, h & 0x3FFF
    if kind == b"VP8L":
        bits = struct.unpack("<I", head[21:25])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if kind == b"VP8X":
        return int.from_bytes(head[24:27], "little") + 1, int.from_bytes(head[27:30], "little") + 1
    raise ValueError(f"{path}: not a WebP file")


def fix_page(manifest: dict, page: Path) -> tuple[str, list[str]]:
    """The page's text with paths and sizes from the manifest, and the problems found."""
    text, problems = page.read_text(encoding="utf-8"), []

    def path(m: re.Match) -> str:
        folder = folder_for(manifest, page, m.group(2))
        if not (ROOT / "assets" / "app" / folder / f"{m.group(2)}.webp").exists():
            problems.append(f"{page.relative_to(ROOT)}: assets/app/{folder}/{m.group(2)}.webp does not exist")
        return f"assets/app/{folder}/{m.group(2)}.webp"

    def size(m: re.Match) -> str:
        tag, found = m.group(0), PATH.search(m.group(0))
        file = ROOT / found.group(0) if found else None
        if not file or not file.exists():
            return tag
        w, h = webp_size(file)
        for attr, value in (("width", w), ("height", h)):
            tag, n = re.subn(rf'\b{attr}="\d+"', f'{attr}="{value}"', tag)
            if not n:
                problems.append(f"{page.relative_to(ROOT)}: <img> for {found.group(2)} has no {attr}")
        return tag

    return IMG.sub(size, PATH.sub(path, text)), problems


def run(write: bool) -> int:
    manifest, bad, changed = json.loads(MANIFEST.read_text(encoding="utf-8")), [], []
    for page in live_pages():
        text, problems = fix_page(manifest, page)
        bad += problems
        if text != page.read_text(encoding="utf-8"):
            changed.append(page.relative_to(ROOT).as_posix())
            if write and not problems:
                page.write_text(text, encoding="utf-8")
    for line in bad:
        print("error:", line)
    verb = "rewritten" if write else "out of step"
    print(f"{len(live_pages())} live pages, {len(changed)} {verb}" + (f": {', '.join(changed[:8])}" if changed else ""))
    return 1 if bad or (changed and not write) else 0


def errors() -> list[str]:
    """For site_check.py: one line per problem."""
    manifest, found = json.loads(MANIFEST.read_text(encoding="utf-8")), []
    for page in live_pages():
        text, problems = fix_page(manifest, page)
        found += problems
        if text != page.read_text(encoding="utf-8"):
            found.append(f"{page.relative_to(ROOT)}: screenshots out of step with assets/app/shots.json (python tools/shots.py apply)")
    return found


ARABIC = str.maketrans("0123456789,", "٠١٢٣٤٥٦٧٨٩٬")


def figures(pairs: list[tuple[str, str]], write: bool) -> int:
    """Whole figures only: 8,895 never matches inside 18,895 or 8,895.5."""
    for old, new in pairs:
        if old == new or not all(re.fullmatch(r"-?[\d,]+(\.\d+)?%?", v) for v in (old, new)):
            raise SystemExit(f"not a figure pair: {old!r} -> {new!r}")
    total = 0
    for page in live_pages() + [ROOT / "llms.txt"]:
        text = page.read_text(encoding="utf-8")
        arabic = page.parent.name == "ar"
        for old, new in pairs:
            a, b = (old.translate(ARABIC), new.translate(ARABIC)) if arabic else (old, new)
            if arabic:
                a, b = a.replace(".", "٫"), b.replace(".", "٫")
            text, n = re.subn(rf"(?<![\d,.٠-٩٬٫]){re.escape(a)}(?![\d٠-٩]|[,.٬٫][\d٠-٩])", b, text)
            if n:
                print(f"{page.relative_to(ROOT)}: {old} -> {new} x{n}")
                total += n
        if write:
            page.write_text(text, encoding="utf-8")
    print(f"{total} replacements" + ("" if write else " (dry run: add --write)"))
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["apply"]:
        raise SystemExit(run(True))
    if args[:1] == ["check"]:
        raise SystemExit(run(False))
    if args[:1] == ["figures"] and len([a for a in args[1:] if a != "--write"]) % 2 == 0:
        rest = [a for a in args[1:] if a != "--write"]
        raise SystemExit(figures(list(zip(rest[::2], rest[1::2])), "--write" in args))
    raise SystemExit(__doc__)
