"""Write the site footer into every page, from one source.

    python tools/footer.py          # rewrite the footer of every live page
    python tools/footer.py --check  # list the pages whose footer is out of date; change nothing

The footer is shared site chrome (like the logo and the top bar), so it is generated, not edited by hand:
change the words, links or contact details below, run this, and commit. It replaces each page's
<footer> element and makes sure the page loads css/footer.css. Archive snapshots, the brand guideline and
redirect pages (no footer) are left alone. Safe to run again.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS_VERSION = "20261015-1"

EMAIL_GENERAL = "hello@lightningeg.com"
EMAIL_FEEDBACK = "feedback@lightningeg.com"
REDDIT = "https://www.reddit.com/r/LightningEg/"
DISCORD = "https://discord.gg/fukkUs263W"
WHATSAPP = "https://chat.whatsapp.com/DNIR1vwjegeFU9dCIOp4ET"  # owner, 2026-10-15

# Lucide icons (A15): drawn at 22px with a 1.75 stroke by css/footer.css
ICONS = {
    "mail": '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    "feedback": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "community": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    "chat": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
}

WORDS = {
    "en": {
        "contact": "Contact Us",
        "intro": "Questions, ideas or something not working? Write to us.",
        "items": [
            ("mail", "General questions", f"mailto:{EMAIL_GENERAL}", EMAIL_GENERAL, False),
            ("feedback", "Feedback on the app", f"mailto:{EMAIL_FEEDBACK}", EMAIL_FEEDBACK, False),
            ("community", "Community", REDDIT, "r/LightningEg on Reddit", True),
            ("chat", "Chat with other testers", [(WHATSAPP, "WhatsApp"), (DISCORD, "Discord")], None, True),
        ],
        "about": "Made in Egypt. Your money stays on your devices.",
        "explore": "Explore",
        "more": "More",
        "explore_links": [("features", "Features"), ("how-it-works", "How It Works"), ("current-status", "Downloads"), ("guides", "Guides"), ("contribute", "Contribute")],
        "more_links": [("release-log", "Release Log"), ("survey", "Survey"), ("privacy", "Privacy"), ("forgeeks", "For Geeks"), ("account", "Account"), ("marketplace", "Marketplace")],
        "mark": "Lightning",
    },
    "ar": {
        "contact": "تواصل معانا",
        "intro": "عندك سؤال أو فكرة أو حاجة مش شغالة؟ اكتبلنا.",
        "items": [
            ("mail", "أسئلة عامة", f"mailto:{EMAIL_GENERAL}", EMAIL_GENERAL, False),
            ("feedback", "رأيك في التطبيق", f"mailto:{EMAIL_FEEDBACK}", EMAIL_FEEDBACK, False),
            ("community", "المجتمع", REDDIT, "r/LightningEg على Reddit", True),
            ("chat", "دردشة مع المجرّبين التانيين", [(WHATSAPP, "واتساب"), (DISCORD, "Discord")], None, True),
        ],
        "about": "اتعمل في مصر. وفلوسك بتفضل على أجهزتك.",
        "explore": "استكشف",
        "more": "كمان",
        "explore_links": [("features", "المزايا"), ("how-it-works", "بيشتغل إزاي"), ("current-status", "التنزيل"), ("guides", "مقالات"), ("contribute", "ساهم معانا")],  # the Arabic Contribute page, not the English one
        "more_links": [("release-log", "سجل التحديثات"), ("survey", "الاستبيان"), ("privacy", "الخصوصية"), ("../forgeeks", '<bdi lang="en">For Geeks</bdi> (بالإنجليزي)', ' hreflang="en" target="_blank" rel="noopener"')],
        "mark": "Lightning",
    },
}

FOOTER = re.compile(r"<footer\b[^>]*>.*?</footer>", re.S)


# For Geeks is its own section with its own footer (owner, 2026-10-17), and so are its earlier concepts
OWN_FOOTER = re.compile(r"^for-?geeks(-[a-z0-9]+)?\.html$")


def pages():
    for path in sorted(list(ROOT.glob("*.html")) + list(ROOT.glob("ar/*.html"))):
        if OWN_FOOTER.match(path.name):
            continue
        text = path.read_text(encoding="utf-8")
        if FOOTER.search(text):
            yield path, text


def build(path: Path) -> str:
    lang = "ar" if path.parent.name == "ar" else "en"
    w = WORDS[lang]
    up = "../" if lang == "ar" else ""
    items = []
    for icon, label, href, text, external in w["items"]:
        target = ' target="_blank" rel="noopener"' if external else ""
        links = href if isinstance(href, list) else [(href, text)]  # one row may hold several places, " · " between
        anchors = " · ".join(f'<a href="{h}"{target}>{f"<bdi>{t}</bdi>" if "@" in t or "/" in t else t}</a>' for h, t in links)
        items.append(f'<li><svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[icon]}</svg><small>{label}</small><span>{anchors}</span></li>')
    def column(title, links, name):
        # a third item adds attributes: the Arabic footer says For Geeks is English and opens it beside the Arabic page
        anchors = "".join(f'<li><a href="{p}.html"{a[0] if a else ""}>{t}</a></li>' for p, t, *a in links)
        return f'<nav class="sf-col" aria-label="{name}"><h3>{title}</h3><ul>{anchors}</ul></nav>'
    return (
        '<footer class="sf">'
        f'<section class="sf-contact" aria-labelledby="sf-contact-title"><div><h2 id="sf-contact-title">{w["contact"]}</h2><p>{w["intro"]}</p></div>'
        f'<ul>{"".join(items)}</ul></section>'
        '<div class="sf-main">'
        f'<div class="sf-brand"><a class="d-lockup" href="index.html" data-home-link><img src="{up}assets/brand/lightning-mark.svg?v=20261003-1" alt="">{w["mark"]}</a><p>{w["about"]}</p></div>'
        f'{column(w["explore"], w["explore_links"], w["explore"])}{column(w["more"], w["more_links"], w["more"])}'
        "</div></footer>"
    )


def with_css(text: str, path: Path) -> str:
    up = "../" if path.parent.name == "ar" else ""
    tag = f'<link rel="stylesheet" href="{up}css/footer.css?v={CSS_VERSION}">'
    if "css/footer.css" in text:
        return re.sub(r'<link rel="stylesheet" href="(?:\.\./)?css/footer\.css[^"]*">', tag, text, count=1)
    return text.replace("</head>", tag + "\n</head>", 1)


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for path, text in pages():
        new = with_css(FOOTER.sub(lambda _: build(path), text, count=1), path)
        if new != text:
            stale.append(path.relative_to(ROOT).as_posix())
            if not check:
                path.write_text(new, encoding="utf-8")
    verb = "out of date" if check else "rewritten"
    print(f"{len(stale)} pages {verb}." + ("" if not stale else "\n  " + "\n  ".join(stale)))
    return 1 if (check and stale) else 0


if __name__ == "__main__":
    sys.exit(main())
