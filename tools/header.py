"""Write the main site's top bar links and Download button into every page, from one source.

    python tools/header.py          # rewrite the top bar of every live main-site page
    python tools/header.py --check  # list the pages whose top bar is out of date; change nothing

The top bar is shared site chrome (like the footer), so it is generated, not edited by hand. It replaces
each page's <nav class="d-links"> and the Download button in .d-bar-end. Five links, then one button:
Home · Features · Community · Marketplace · For Geeks, and Download free (README › Header).
For Geeks is English only (guideline D02), so the Arabic bar links the English page with lang="en".
The Community and Marketplace pages are English only for now, so Arabic pages link the English ones.
Archive snapshots, the guideline, For Geeks pages (tools/geeks_shell.py) and redirects are left alone.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (key, href from the English root, English label, Arabic label or None when the target is English only)
LINKS = [
    ("home", "index.html", "Home", "الرئيسية", True),
    ("features", "features.html", "Features", "المميزات", True),
    ("community", "community.html", "Community", "المجتمع", True),
    ("market", "marketplace.html", "Marketplace", "المتجر", True),
    ("geeks", "forgeeks.html", "For Geeks", None, False),
]
COMMUNITY = {"community.html", "stories.html", "leaderboard.html", "collection.html", "topup.html", "profile.html", "account.html"}
MARKET = {"marketplace.html"}

CTA = {
    "en": ("current-status.html", "Download free", "Download"),
    "ar": ("current-status.html", "نزّل ببلاش", "نزّل"),
}
# The Downloads page must not link to itself: it keeps the survey there (README › Header).
CTA_DOWNLOADS = {
    "en": ("survey.html", "Take the survey", "Survey"),
    "ar": ("survey.html", "جاوب الاستبيان", "الاستبيان"),
}


def current_key(name):
    if name == "index.html":
        return "home"
    if name == "features.html":
        return "features"
    if name in COMMUNITY:
        return "community"
    if name in MARKET:
        return "market"
    return None


def nav(lang, name):
    cur = current_key(name)
    label = "Main" if lang == "en" else "القائمة الرئيسية"
    out = [f'<nav class="d-links" aria-label="{label}">']
    for key, href, en, ar, has_ar in LINKS:
        attrs = ""
        if lang == "ar":
            if not has_ar:
                href = "../" + href
            text = ar if ar else en
            if ar is None:
                attrs = ' lang="en" dir="ltr"'
        else:
            text = en
        if key == "home":
            attrs += " data-home-link"
        if key == cur:
            attrs += ' aria-current="page"'
        out.append(f'      <a href="{href}"{attrs}>{text}</a>')
    out.append("    </nav>")
    return "\n".join(out)


def cta(lang, name):
    href, long, short = (CTA_DOWNLOADS if name == "current-status.html" else CTA)[lang]
    return (f'<a class="btn btn-primary nav-cta" href="{href}" data-nav-cta>'
            f'<span class="cta-long">{long}</span><span class="cta-short">{short}</span></a>')


NAV_RE = re.compile(r'<nav class="d-links".*?</nav>', re.S)
CTA_RE = re.compile(r'<a class="btn btn-primary nav-cta"[^>]*>.*?</a>', re.S)


def render(path):
    html = path.read_text(encoding="utf-8")
    if not NAV_RE.search(html) or 'class="d-bar-end"' not in html:
        return None
    lang = "ar" if path.parent.name == "ar" else "en"
    name = path.name
    new = NAV_RE.sub(lambda _: nav(lang, name), html, count=1)
    button = cta(lang, name)
    if CTA_RE.search(new):
        new = CTA_RE.sub(lambda _: button, new, count=1)
    else:
        new = new.replace('<div class="d-bar-end">', f'<div class="d-bar-end">\n        {button}', 1)
    return html, new


def pages():
    for p in sorted(list(ROOT.glob("*.html")) + list((ROOT / "ar").glob("*.html"))):
        if p.name.startswith(("forgeeks", "for-geeks")):
            continue
        yield p


def main():
    check = "--check" in sys.argv
    stale = []
    for p in pages():
        r = render(p)
        if not r:
            continue
        old, new = r
        if old != new:
            stale.append(str(p.relative_to(ROOT)))
            if not check:
                p.write_text(new, encoding="utf-8")
    if check:
        if stale:
            print("top bar out of date:\n  " + "\n  ".join(stale))
            sys.exit(1)
        print("top bar: every page is up to date")
    else:
        print(f"top bar written into {len(stale)} pages")


if __name__ == "__main__":
    main()
