"""Write the For Geeks top bar and footer into its three pages, from one source.

    python tools/geeks_shell.py          # rewrite the top bar and footer of every For Geeks page
    python tools/geeks_shell.py --check  # list the pages whose shell is out of date; change nothing

For Geeks (guideline Part D, Coders) has its own shell, apart from the Normal site's footer (tools/footer.py):
the same top bar on every page with the current one marked, and the same footer. Change the pages, words or
links below, run this, and commit. It also sets the stylesheet and script versions, so phones drop old copies.
Each page's own sections stay its own. Safe to run again.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = "20261019-1"  # css/forgeeks.css and js/forgeeks.js; bump it when either changes

GH = "https://github.com/LightningEg/Lightning"
TASKS = f"{GH}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee"
CODESPACE = "https://codespaces.new/LightningEg/Lightning?quickstart=1"

# The pages in the top bar, in order: file, its name in the bar, its crumb.
PAGES = [
    ("forgeeks.html", "home", "~/root/<b>for-geeks</b>"),
    ("forgeeks-guide.html", "contribute", "~/root/for-geeks/<b>contribute</b>"),
    ("forgeeks-roadmap.html", "roadmap", "~/root/for-geeks/<b>roadmap</b>"),
]

FOOTER_COLUMNS = [
    ("Start here", [("forgeeks-guide.html", "Contribute in three steps"), (TASKS, "Good first issues"),
                    (CODESPACE, "Open a Codespace"), ("forgeeks-roadmap.html", "Roadmap"),
                    ("app-feedback.html", "Not a coder? Send feedback")]),
    ("System", [("forgeeks-guide.html#built", "Architecture"), (f"{GH}/blob/main/lightning/core/figures.py", "Figures registry"),
                (f"{GH}/blob/main/pyproject.toml", "Import contracts"), ("forgeeks-guide.html#terms", "Glossary"),
                (f"{GH}/blob/main/CHANGELOG.md", "Changelog")]),
    ("Rules", [("forgeeks-guide.html#product", "What Lightning is"), ("forgeeks-guide.html#rules", "Ground rules"),
               ("forgeeks-guide.html#team", "Who does what"), (f"{GH}/blob/main/LICENSE", "Licence"),
               (f"{GH}/security/advisories/new", "Report a flaw privately")]),
    ("Community", [("https://discord.gg/fukkUs263W", "Discord"), ("https://chat.whatsapp.com/DNIR1vwjegeFU9dCIOp4ET", "WhatsApp"),
                   ("https://www.reddit.com/r/LightningEg/", "r/LightningEg"), ("mailto:geeks@lightningeg.com", "geeks@lightningeg.com"),
                   ("index.html", "Lightning, the app")]),
]

MARK = ('<img class="geeks-mark-dark" src="assets/brand/lightning-mark-white.svg" alt="" width="{w}" height="{h}"{s}>'
        '<img class="geeks-mark-light" src="assets/brand/lightning-mark-nile.svg" alt="" width="{w}" height="{h}"{s}>')


def link(href: str, text: str) -> str:
    # Inside For Geeks a link stays in the tab; a Normal page, GitHub or anything outside opens a new one (D09).
    inside = href.startswith(("forgeeks", "#", "mailto:"))
    return f'<a href="{href}"{"" if inside else " target=\"_blank\" rel=\"noopener\""}>{text}</a>'


def header(current: str) -> str:
    crumb = next(c for f, _, c in PAGES if f == current)
    links = "\n".join(f'      <a href="{f}"{" aria-current=\"page\"" if f == current else ""}>{n}</a>' for f, n, _ in PAGES)
    return f'''<header class="bar" id="bar">
  <div class="wrap">
    <a class="brand" href="forgeeks.html" aria-label="Lightning, For Geeks home">
      {MARK.format(w=15, h=21, s="")}
      lightning
    </a>
    <span class="crumb" aria-hidden="true">{crumb}<span class="caret"></span></span>
    <nav class="links" aria-label="For Geeks">
{links}
      <a class="opt" href="index.html" target="_blank" rel="noopener">app</a>
    </nav>
    <div class="tools">
      <button class="chip" id="theme-btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="themes" title="Change theme (T)">
        <span class="dots" aria-hidden="true"><i style="background:var(--bg)"></i><i style="background:var(--ink)"></i><i style="background:var(--accent)"></i></span>
        <span class="t-name">theme: <span id="theme-name">mono</span></span>
      </button>
      <a class="chip src" href="{GH}" rel="noopener" target="_blank">source ↗</a>
    </div>
  </div>
  <div class="progress" id="progress" aria-hidden="true"></div>
</header>'''


def footer() -> str:
    cols = "\n".join(
        f"      <div><h4>{title}</h4><ul>\n" + "\n".join(f"        <li>{link(h, t)}</li>" for h, t in items) + "\n      </ul></div>"
        for title, items in FOOTER_COLUMNS)
    mark = MARK.format(w=10, h=14, s=' style="vertical-align:-2px;margin-right:8px"')
    return f'''<footer>
  <div class="wrap">
    <div class="cols">
{cols}
    </div>
    <div class="legal"><span>{mark}© 2026 Lightning · built in Egypt</span><span>source-available · PolyForm Noncommercial 1.0.0</span></div>
  </div>
</footer>'''


def build(text: str, name: str) -> str:
    text = re.sub(r'<header class="bar" id="bar">.*?</header>', lambda m: header(name), text, count=1, flags=re.S)
    text = re.sub(r"<footer>.*?</footer>", lambda m: footer(), text, count=1, flags=re.S)
    text = re.sub(r"css/forgeeks\.css\?v=[\w-]+", f"css/forgeeks.css?v={VERSION}", text)
    return re.sub(r"js/forgeeks\.js\?v=[\w-]+", f"js/forgeeks.js?v={VERSION}", text)


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for name, _, _ in PAGES:
        path = ROOT / name
        old = path.read_text(encoding="utf-8")
        if '<header class="bar" id="bar">' not in old or "<footer>" not in old:
            print(f"{name}: no top bar or footer to replace")
            return 1
        new = build(old, name)
        if new != old:
            stale.append(name)
            if not check:
                path.write_text(new, encoding="utf-8")
    if check and stale:
        print("out of date: " + ", ".join(stale) + " (run python tools/geeks_shell.py)")
        return 1
    print(("rewrote " + ", ".join(stale)) if stale and not check else "For Geeks shell is up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
