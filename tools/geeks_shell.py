"""Write the For Geeks top bar and footer into its pages, from one source.

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
VERSION = "20261027-coders-3"  # css/forgeeks.css, js/forgeeks.js, js/forgeeks-auth.js, js/forgeeks-config.js; bump it when any changes
SUPABASE_JS = "js/vendor/supabase-2.118.0.js"  # pinned; a new version is a new file name

# Themes the head script may apply before first paint (js/forgeeks.js lists their names and colours).
THEME_IDS = ["mono", "paper", "meadow", "nile", "ocean", "tokyo", "dracula", "rose", "synthwave", "phosphor", "amber", "solarized", "moss", "garnet", "frost", "papyrus", "cotton", "dendera"]

GH = "https://github.com/LightningEg/Lightning"
TASKS = f"{GH}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee"
CODESPACE = "https://codespaces.new/LightningEg/Lightning?quickstart=1"

# The pages in the top bar, in order: file, its name in the bar, its crumb.
PAGES = [
    ("forgeeks.html", "home", "~/root/<b>for-geeks</b>"),
    ("forgeeks-guide.html", "contribute", "~/root/for-geeks/<b>contribute</b>"),
    ("forgeeks-roadmap.html", "roadmap", "~/root/for-geeks/<b>roadmap</b>"),
]

# Pages that wear the same shell but are not in the top bar yet (not linked or indexed until launch).
EXTRA = [
    ("forgeeks-account.html", "~/root/for-geeks/<b>account</b>"),
    ("forgeeks-leaderboard.html", "~/root/for-geeks/<b>leaderboard</b>"),
    ("forgeeks-profile.html", "~/root/for-geeks/<b>profile</b>"),
    ("forgeeks-market.html", "~/root/for-geeks/<b>market</b>"),
    ("forgeeks-tasks.html", "~/root/for-geeks/<b>tasks</b>"),
    ("forgeeks-admin.html", "~/root/for-geeks/<b>admin</b>"),
]

FOOTER_COLUMNS = [
    ("Start here", [("forgeeks-guide.html", "Contribute in three steps"), (TASKS, "Good first issues"),
                    (CODESPACE, "Open a Codespace"), ("forgeeks-roadmap.html", "Roadmap"),
                    ("app-feedback.html", "Not a coder? Send feedback")]),
    ("System", [("forgeeks-guide.html#built", "Architecture"), (f"{GH}/blob/main/lightning/core/figures.py", "Figures registry"),
                (f"{GH}/blob/main/pyproject.toml", "Import contracts"), (f"{GH}/blob/main/docs/GLOSSARY.md", "Glossary"),
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
    crumb = next(c for f, c in [(f, c) for f, _, c in PAGES] + EXTRA if f == current)
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
      <a class="chip me" id="me" href="forgeeks-account.html">sign in</a>
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
    <div class="legal"><span>{mark}© 2026 Lightning · built in Egypt</span><span><a href="{GH}/blob/main/LICENSE" target="_blank" rel="noopener">PolyForm Noncommercial 1.0.0</a></span></div>
  </div>
</footer>'''


def build(text: str, name: str) -> str:
    text = re.sub(r'<header class="bar" id="bar">.*?</header>', lambda m: header(name), text, count=1, flags=re.S)
    text = re.sub(r"<footer>.*?</footer>", lambda m: footer(), text, count=1, flags=re.S)
    text = re.sub(r"css/forgeeks\.css\?v=[\w-]+", f"css/forgeeks.css?v={VERSION}", text)
    # The theme boot script in <head> applies a saved theme before first paint; it knows every theme id.
    text = re.sub(r"(localStorage\.getItem\('lightning-geeks-theme'\);if\(/\^\()[a-z0-9|-]+(\)\$/)",
                  lambda m: m.group(1) + "|".join(THEME_IDS) + m.group(2), text, count=1)
    # the shared cosmetics and market files: one version with the shell, so a release reaches every page at once
    text = re.sub(r'((?:css/(?:forgeeks-cosmetics|market-ui|forgeeks-leaderboard)[.]css|js/(?:market-ui|forgeeks-showcase|forgeeks-profile|theme-preview|forgeeks-leaderboard)[.]js))(?:[?]v=[\w-]+)?(")', lambda m: m[1] + '?v=' + VERSION + m[2], text)
    text = re.sub(r'(js/(?:forgeeks-market|forgeeks-account|forgeeks-account-data|admin-operations)[.]js)(?:[?]v=[\w-]+)?', lambda m: m[1] + '?v=' + ('20261027-mfa-2' if m[1]=='js/admin-operations.js' else VERSION), text)
    # Every page loads the same scripts, in this order: page behaviour, Supabase, its settings, the sign-in.
    bundle = (f'<script src="js/forgeeks.js?v={VERSION}"></script>\n<script src="{SUPABASE_JS}"></script>\n'
              f'<script src="js/forgeeks-config.js?v={VERSION}"></script>\n<script src="js/forgeeks-auth.js?v={VERSION}"></script>')
    return re.sub(r'<script src="js/forgeeks\.js\?v=[\w-]+"></script>'
                  r'(\n<script src="js/(?:vendor/supabase-[\d.]+|forgeeks-config|forgeeks-auth)\.js(?:\?v=[\w-]+)?"></script>)*',
                  lambda m: bundle, text, count=1)


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for name in [f for f, _, _ in PAGES] + [f for f, _ in EXTRA]:
        path = ROOT / name
        old = path.read_text(encoding="utf-8")
        if '<header class="bar" id="bar">' not in old or "<footer>" not in old or "lightning-geeks-theme" not in old:
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
