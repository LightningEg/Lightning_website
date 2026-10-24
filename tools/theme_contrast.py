"""Check the contrast of every For Geeks theme in css/forgeeks.css (WCAG 2.x), and the theme lists agree.

    python tools/theme_contrast.py          # table of every theme; exit 1 if any rule fails
    python tools/theme_contrast.py --quiet  # only failures

Rules (a new theme passes all of them before it ships):
    ink  / bg      >= 7     headline and value text
    ink  / panel   >= 4.5   windows, the picker, the toast
    dim  / bg      >= 4.5   body text and labels
    dim  / panel   >= 4.5
    dim  / well    >= 4.5   terminal, code, wells
    accent / bg    >= 3     prompt, caret, current state (never body text on its own)
    accent / panel >= 3
    btn-ink / btn  >= 4.5   the primary button and its words
Also: every theme sets all fourteen tokens, and the ids in css/forgeeks.css, js/forgeeks.js (THEMES) and
tools/geeks_shell.py (THEME_IDS) are the same list.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ["bg", "panel", "well", "ink", "dim", "faint", "line", "line-strong", "accent", "accent2", "btn", "btn-ink", "particle", "glow"]
RULES = [("ink", "bg", 7), ("ink", "panel", 4.5), ("dim", "bg", 4.5), ("dim", "panel", 4.5), ("dim", "well", 4.5),
         ("accent", "bg", 3), ("accent", "panel", 3), ("btn-ink", "btn", 4.5)]


def lum(h: str) -> float:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    ch = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    ch = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def ratio(a: str, b: str) -> float:
    la, lb = lum(a), lum(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)


def themes(css: str) -> dict:
    out = {}
    m = re.search(r"^:root\{(.*?)\n", css, re.M)
    out["mono"] = m.group(1)
    for m in re.finditer(r'^:root\[data-theme="([a-z0-9-]+)"\]\{(.*?)\}$', css, re.M):
        out[m.group(1)] = m.group(2)
    return out


def main() -> int:
    quiet = "--quiet" in sys.argv
    css = (ROOT / "css/forgeeks.css").read_text(encoding="utf-8")
    blocks = themes(css)
    bad = 0
    head = "theme       " + "".join(f"{a}/{b}".rjust(14) for a, b, _ in RULES)
    if not quiet:
        print(head)
        print("minimum     " + "".join(str(t).rjust(14) for _, _, t in RULES))
    for name, body in blocks.items():
        got = dict(re.findall(r"--([a-z0-9-]+):\s*([^;}]+)", body))
        missing = [t for t in TOKENS if t not in got]
        if missing:
            print(f"FAIL {name}: missing tokens {', '.join(missing)}")
            bad += 1
            continue
        cells, fails = [], []
        for a, b, need in RULES:
            r = ratio(got[a].strip(), got[b].strip())
            cells.append(f"{r:.1f}".rjust(14))
            if r < need:
                fails.append(f"{a}/{b} {r:.2f} < {need}")
        if fails:
            bad += 1
            print(f"FAIL {name}: " + "; ".join(fails))
        if not quiet:
            print(name.ljust(12) + "".join(cells) + ("   FAIL" if fails else ""))
    # the three lists of theme ids agree
    js = (ROOT / "js/forgeeks.js").read_text(encoding="utf-8")
    js_ids = re.findall(r"\{id:'([a-z0-9-]+)',name:", js)
    py = (ROOT / "tools/geeks_shell.py").read_text(encoding="utf-8")
    py_ids = re.findall(r'"([a-z0-9-]+)"', re.search(r"THEME_IDS = \[(.*?)\]", py, re.S).group(1))
    for label, ids in (("js/forgeeks.js THEMES", js_ids), ("tools/geeks_shell.py THEME_IDS", py_ids)):
        if sorted(ids) != sorted(blocks):
            print(f"FAIL {label} differs from css/forgeeks.css: {sorted(set(ids) ^ set(blocks))}")
            bad += 1
    print(f"{len(blocks)} themes, {bad} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
