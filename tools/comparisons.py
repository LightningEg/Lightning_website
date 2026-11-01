"""Honest comparison pages, built from one scorecard (plan item 8Z; guideline B10 and B12).

    python tools/comparisons.py            # check: every page's ratings equal comparisons.json, and the sitemap and llms.txt list them
    python tools/comparisons.py build      # write the six pages (three kinds of tool, English and Egyptian Arabic), then sitemap and llms.txt

comparisons.json holds the scorecard: six qualities, a Low, Medium or High for Lightning and for each kind of tool, one line of
evidence for each, and the source of that evidence. Pages name a kind of tool, never a product. Read the file's `rule` first.
New pages need a UX release id in version-registry.json and a row in versions.html: build adds them once. Arabic pages carry no id.
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "comparisons.json"
SITE = "https://lightningeg.com/"
TEMPLATE = "net-worth-tracker.html"
CSS = '<link rel="stylesheet" href="{up}css/compare.css?v=20261101-1">'
RATE = {"Low": 1, "Medium": 2, "High": 3}
AR_RATE = {"Low": "منخفض", "Medium": "متوسط", "High": "عالي"}
UX_DATE = "2026.11.01"

COPY = {
    "en": {
        "title": "Lightning or {name}? An Honest Comparison · Lightning",
        "desc": "Lightning against {lname}, rated Low, Medium or High on six things that matter, with a line of evidence for each. Where {lname} is better, we say so.",
        "label": "Lightning against {lname}", "h1": "Lightning or <span>{name}?</span>", "fit": "9.5",
        "line": "An honest comparison in Low, Medium and High. Where {lname} is better, we say so.",
        "free": "Free to use. Windows and Android. No bank login.",
        "glance_l": "At a glance", "glance_h": "Six Things, Rated Honestly.", "glance_p": "{what} Each rating comes with one line of why.",
        "th": ["What matters", "Lightning", "{name}"], "who": ["Lightning", "{name}"],
        "wins_l": "Where each is stronger", "wins_h": "Neither Wins Everywhere.", "wins_p": "Read the rows above, then pick what fits how you work.",
        "lw": "Lightning is stronger at", "cw": "{name} is stronger at", "none": "Nothing on this list.",
        "choose_l": "Choosing", "choose_h": "Which One Should You Pick?",
        "src": "Ratings are our honest view as of {date}, checked against the sources named in the comparison file. Tell us if one is wrong.",
        "more_l": "Keep reading", "more_h": "More Honest Answers", "more_p": "The whole picture first, then the nearest guides.",
        "crumb": "Compare",
    },
    "ar": {
        "title": "لايتنينج ولا {name}؟ مقارنة صريحة · لايتنينج",
        "desc": "لايتنينج قصاد {name}، بدرجات منخفض ومتوسط وعالي في ست حاجات مهمة، ومع كل درجة سطر دليل. ولو {name} أحسن في حاجة، بنقول كده.",
        "label": "لايتنينج قصاد {name}", "h1": "لايتنينج ولا <span>{name}؟</span>", "fit": "12",
        "line": "مقارنة صريحة بدرجات منخفض ومتوسط وعالي. ولو {name} أحسن في حاجة، بنقول كده.",
        "free": "ببلاش. ويندوز وأندرويد. من غير دخول بنك.",
        "glance_l": "في لمحة", "glance_h": "ست حاجات بدرجات صريحة.", "glance_p": "{what} وكل درجة ليها سطر بيشرحها.",
        "th": ["الحاجة المهمة", "لايتنينج", "{name}"], "who": ["لايتنينج", "{name}"],
        "wins_l": "مين أقوى فين", "wins_h": "مفيش واحد أحسن في كل حاجة.", "wins_p": "اقرا الصفوف اللي فوق، وبعدين اختار اللي يناسب طريقتك.",
        "lw": "لايتنينج أقوى في", "cw": "{name} أقوى في", "none": "مفيش حاجة في القايمة دي.",
        "choose_l": "الاختيار", "choose_h": "تختار انهي واحد؟",
        "src": "الدرجات دي رأينا الصريح لحد {date}، ومراجعة على المصادر المكتوبة في ملف المقارنة. قولنا لو درجة غلط.",
        "more_l": "كمّل قراية", "more_h": "إجابات صريحة تانية", "more_p": "الصورة الكاملة الأول، وبعدها أقرب الأدلة.",
        "crumb": "قارن",
    },
}


def data() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


def esc(t: str) -> str:
    return html.escape(t, quote=True)


def rate_html(r: str, lang: str) -> str:
    on = RATE[r]
    word = r if lang == "en" else AR_RATE[r]
    meter = "".join(f'<i class="{"on" if n < on else ""}"></i>' for n in range(3))
    return f'<span class="cmp-rate" data-rating="{r}">{word}<span class="cmp-meter" aria-hidden="true">{meter}</span></span>'


def page_path(slug: str, lang: str) -> Path:
    return ROOT / ("ar/" if lang == "ar" else "") / f"{slug}.html"


def main_html(d: dict, key: str, lang: str) -> str:
    c, t = d["comparators"][key], COPY[lang]
    name = c[lang]
    lname = name[0].lower() + name[1:] if lang == "en" else name
    what = c[f"{lang}_what"]
    rows = ""
    for q in d["qualities"]:
        l, o = q["ratings"]["lightning"], q["ratings"][key]
        ln, on = q[f"{lang}_note"]["lightning"], q[f"{lang}_note"][key]
        rows += (f'<tr data-quality="{q["id"]}"><th scope="row">{esc(q[lang])}</th>'
                 f'<td data-who="{esc(t["who"][0])}">{rate_html(l, lang)}<span class="cmp-note">{esc(ln)}</span></td>'
                 f'<td data-who="{esc(t["who"][1].format(name=name))}">{rate_html(o, lang)}<span class="cmp-note">{esc(on)}</span></td></tr>')
    head = "".join(f"<th>{esc(x.format(name=name))}</th>" for x in t["th"])
    stronger_l = [q[lang] for q in d["qualities"] if RATE[q["ratings"]["lightning"]] > RATE[q["ratings"][key]]]
    stronger_c = [q[lang] for q in d["qualities"] if RATE[q["ratings"]["lightning"]] < RATE[q["ratings"][key]]]
    lst = lambda items: "<ul>" + "".join(f"<li>{esc(i)}</li>" for i in items) + "</ul>" if items else f"<p>{esc(t['none'])}</p>"
    sec = lambda sid, label, h, p, body: (f'<section class="d-section" id="{sid}"><div class="d-head"><p class="label">{label}</p><h2>{h}</h2><p>{p}</p></div>{body}</section>')
    go = f'<a class="btn btn-vivid" href="current-status.html">{"Download free" if lang == "en" else "نزّل ببلاش"}</a>'
    see = f'<a class="btn btn-secondary" href="how-it-works.html">{"See how it works" if lang == "en" else "بيشتغل إزاي"}</a>'
    hero = (f'<header class="d-hero"><p class="label">{esc(t["label"].format(lname=lname, name=name))}</p>'
            f'<h1 style="--fit:{t["fit"]}">{t["h1"].format(name=esc(lname))}</h1>'
            f'<p class="d-hero-line">{esc(t["line"].format(lname=lname, name=name))}</p>'
            f'<div class="d-actions">{go}{see}</div><p class="c-free">{esc(t["free"])}</p></header>')
    table = (f'<div class="card card-support cmp-table-wrap"><table class="cmp-table"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>'
             f'<p class="cmp-src">{esc(t["src"].format(date=d["date"]))}</p>')
    wins = (f'<div class="cmp-two"><article class="card card-support"><h3>{esc(t["lw"])}</h3>{lst(stronger_l)}</article>'
            f'<article class="card card-support"><h3>{esc(t["cw"].format(name=name))}</h3>{lst(stronger_c)}</article></div>')
    choose = f'<div class="card card-support"><p>{esc(d["choose"][key][lang])}</p></div>'
    others = [k for k in d["comparators"] if k != key]
    cards = "".join(f'<a class="card card-support g-link" href="{d["comparators"][k]["slug"]}.html"><h3>{esc(("Lightning or " if lang == "en" else "لايتنينج ولا ") + d["comparators"][k][lang] + "?")}</h3>'
                    f'<p>{esc(d["comparators"][k][lang + "_what"])}</p></a>' for k in others)
    cards += ('<a class="card card-support g-link" href="know-what-you-own.html"><h3>Know What You Own</h3><p>Add up every place your money sits.</p></a>' if lang == "en"
              else '<a class="card card-support g-link" href="know-what-you-own.html"><h3>إنت تملك إيه</h3><p>اجمع كل مكان فلوسك قاعدة فيه.</p></a>')
    more = f'<div class="c-promise">{cards}</div>'
    return "\n  ".join([hero,
        sec("scorecard", t["glance_l"], t["glance_h"], esc(t["glance_p"].format(what=what)), table),
        sec("stronger", t["wins_l"], t["wins_h"], esc(t["wins_p"]), wins),
        sec("choose", t["choose_l"], t["choose_h"], "", choose),
        sec("more", t["more_l"], t["more_h"], esc(t["more_p"]), more)])


def build_page(d: dict, key: str, lang: str, ux: str | None) -> str:
    tpl = (ROOT / ("ar/" if lang == "ar" else "") / TEMPLATE).read_text(encoding="utf-8")
    c, t = d["comparators"][key], COPY[lang]
    name, slug = c[lang], c["slug"]
    lname = name[0].lower() + name[1:] if lang == "en" else name
    title = t["title"].format(name=name)
    desc = t["desc"].format(name=name, lname=lname)
    en_url, ar_url = f"{SITE}{slug}.html", f"{SITE}ar/{slug}.html"
    own = ar_url if lang == "ar" else en_url
    up = "../" if lang == "ar" else ""
    out = re.sub(r"<title>.*?</title>", lambda m: f"<title>{esc(title)}</title>", tpl, count=1, flags=re.S)
    out = re.sub(r'<meta name="description" content="[^"]*">', lambda m: f'<meta name="description" content="{esc(desc)}">', out, count=1)
    out = re.sub(r'<link rel="canonical" href="[^"]*">', f'<link rel="canonical" href="{own}">', out, count=1)
    out = re.sub(r'(<link rel="alternate" hreflang="en" href=")[^"]*"', rf'\g<1>{en_url}"', out, count=1)
    out = re.sub(r'(<link rel="alternate" hreflang="ar-EG" href=")[^"]*"', rf'\g<1>{ar_url}"', out, count=1)
    out = re.sub(r'(<link rel="alternate" hreflang="x-default" href=")[^"]*"', rf'\g<1>{en_url}"', out, count=1)
    out = re.sub(r'<meta property="og:type" content="[^"]*">', '<meta property="og:type" content="article">', out, count=1)
    out = re.sub(r'<meta property="og:title" content="[^"]*">', lambda m: f'<meta property="og:title" content="{esc(title)}">', out, count=1)
    out = re.sub(r'<meta property="og:description" content="[^"]*">', lambda m: f'<meta property="og:description" content="{esc(desc)}">', out, count=1)
    out = re.sub(r'<meta property="og:url" content="[^"]*">', f'<meta property="og:url" content="{own}">', out, count=1)
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": own + "#page", "url": own, "name": title, "description": desc, "inLanguage": "ar-EG" if lang == "ar" else "en",
         "isPartOf": {"@id": SITE + "#website"}, "about": {"@id": SITE + "#app"}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home" if lang == "en" else "الرئيسية", "item": SITE if lang == "en" else SITE + "ar/"},
            {"@type": "ListItem", "position": 2, "name": t["crumb"], "item": own},
            {"@type": "ListItem", "position": 3, "name": title, "item": own}]}]}
    out = re.sub(r'<script type="application/ld\+json">.*?</script>', lambda m: '<script type="application/ld+json">\n' + json.dumps(ld, ensure_ascii=False) + "\n</script>", out, count=1, flags=re.S)
    if "compare.css" not in out:
        out = out.replace(f'<link rel="stylesheet" href="{up}css/guides.css', CSS.format(up=up) + f'\n<link rel="stylesheet" href="{up}css/guides.css', 1)
    other = f"{slug}.html"
    out = re.sub(r'(<a class="lang-switch" href=")[^"]*"', rf'\g<1>{("../" if lang == "ar" else "ar/")}{other}"', out, count=1)
    if ux and lang == "en":
        out = re.sub(r'data-ux-version="[^"]*"', f'data-ux-version="{ux}"', out, count=1)
    tail = out[out.index("<!-- Signup band"):out.index("</main>")]
    body = f'<main class="wrap" id="top">\n  {main_html(d, key, lang)}\n\n  ' + tail
    out = re.sub(r'<main class="wrap" id="top">.*?</main>', lambda m: body + "</main>", out, count=1, flags=re.S)
    out = re.sub(r'<!-- Signup band', "<!-- Signup band", out)
    return out


def ensure_registry(d: dict) -> dict[str, str]:
    """A UX release id for each English page, added to version-registry.json and versions.html once."""
    reg_path, vp = ROOT / "version-registry.json", ROOT / "versions.html"
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    have = {r["page"]: r["id"] for r in reg["releases"] if r["status"] == "current"}
    ids, v = {}, vp.read_text(encoding="utf-8")
    for key, c in d["comparators"].items():
        page = f"{c['slug']}.html"
        if page in have:
            ids[key] = have[page]; continue
        nums = [int(r["id"].rsplit(".", 1)[1]) for r in reg["releases"] if r["id"].startswith(f"UX-{UX_DATE}.")]
        new = f"UX-{UX_DATE}.{max(nums, default=0) + 1:02d}"
        name = f"Lightning or {c['en']}? · Honest comparison"
        reg["releases"].append({"id": new, "name": name, "page": page, "status": "current", "archive_url": None})
        row = (f'<article class="card version-row" id="{new}"><div><h2>{esc(name)}</h2><p>An honest comparison of Lightning with {esc(c["en"][0].lower() + c["en"][1:])}, in Low, Medium and High.</p>'
               f'<code class="version-id">{new}</code></div><span class="version-state">Current</span></article>\n')
        last = [m for m in re.finditer(r'<article class="card version-row" id="UX-[^"]+">.*?</article>\n', v)][-1]
        v = v[:last.end()] + row + v[last.end():]
        ids[key] = new
    reg_path.write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    vp.write_text(v, encoding="utf-8")
    return ids


def sitemap_llms(d: dict) -> None:
    sm = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    sm = re.sub(r"\s*<url>\s*<loc>https://lightningeg.com/(ar/)?lightning-vs-[^<]*</loc>.*?</url>", "", sm, flags=re.S)
    block = ""
    for c in d["comparators"].values():
        en, ar = f"{SITE}{c['slug']}.html", f"{SITE}ar/{c['slug']}.html"
        for loc in (en, ar):
            block += (f'  <url>\n    <loc>{loc}</loc>\n    <lastmod>{d["date"]}</lastmod>\n    <xhtml:link rel="alternate" hreflang="en" href="{en}" />\n'
                      f'    <xhtml:link rel="alternate" hreflang="ar-EG" href="{ar}" />\n  </url>\n')
    sm = sm.replace("</urlset>", block + "</urlset>")
    (ROOT / "sitemap.xml").write_text(sm, encoding="utf-8")
    ll = (ROOT / "llms.txt").read_text(encoding="utf-8")
    ll = re.sub(r"\n- \[(?:Lightning or|لايتنينج ولا)[^\n]*lightning-vs-[^\n]*", "", ll)
    en_lines = "".join(f"- [Lightning or {c['en'].lower()}?]({SITE}{c['slug']}.html): an honest comparison with {c['en'].lower()}, rated Low, Medium or High with evidence.\n" for c in d["comparators"].values())
    ar_lines = "".join(f"- [لايتنينج ولا {c['ar']}؟]({SITE}ar/{c['slug']}.html)\n" for c in d["comparators"].values())
    if "## Compare" not in ll:
        ll = ll.rstrip("\n") + "\n\n## Compare\n\n" + en_lines + "\n" + ar_lines
    else:
        ll = re.sub(r"## Compare\n.*?(?=\n## |\Z)", lambda m: "## Compare\n\n" + en_lines + "\n" + ar_lines, ll, flags=re.S)
    (ROOT / "llms.txt").write_text(ll if ll.endswith("\n") else ll + "\n", encoding="utf-8")


def build() -> None:
    d = data()
    ids = ensure_registry(d)
    for key, c in d["comparators"].items():
        for lang in ("en", "ar"):
            page_path(c["slug"], lang).write_text(build_page(d, key, lang, ids[key]), encoding="utf-8")
    sitemap_llms(d)
    print("wrote", len(d["comparators"]) * 2, "pages")


def check() -> list[str]:
    d, out = data(), []
    for q in d["qualities"]:
        for who, r in q["ratings"].items():
            if r not in RATE:
                out.append(f"comparisons.json: {q['id']}/{who}: {r!r} is not Low, Medium or High")
        if not q.get("evidence_source"):
            out.append(f"comparisons.json: {q['id']} cites no evidence source")
        if set(q["ratings"]) != {"lightning", *d["comparators"]} or set(q["en_note"]) != set(q["ratings"]) or set(q["ar_note"]) != set(q["ratings"]):
            out.append(f"comparisons.json: {q['id']} lacks a rating or a line of evidence for one column, in English or Arabic")
    banned = re.compile(r"\b(YNAB|Mint|Say|Qershnat|Masarifi|Monefy|Money Manager|Wallet|Copilot|Actual Budget|Excel|Google Sheets)\b")
    for key, c in d["comparators"].items():
        for lang in ("en", "ar"):
            p = page_path(c["slug"], lang)
            if not p.exists():
                out.append(f"{p.relative_to(ROOT)} is missing: run python tools/comparisons.py build"); continue
            text = p.read_text(encoding="utf-8")
            rows = re.findall(r'<tr data-quality="([^"]+)">.*?data-rating="(\w+)".*?data-rating="(\w+)"', text, re.S)
            want = [(q["id"], q["ratings"]["lightning"], q["ratings"][key]) for q in d["qualities"]]
            if [(a, b, c2) for a, b, c2 in rows] != want:
                out.append(f"{p.relative_to(ROOT)}: the ratings differ from comparisons.json")
            body = re.search(r"<main.*?</main>", text, re.S).group(0)
            body_text = re.sub(r"<[^>]+>", " ", body)
            if lang == "en" and banned.search(body_text.replace("Lightning", "")):
                out.append(f"{p.relative_to(ROOT)}: names a product; compare kinds of tool only (guideline B10)")
    sm = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    ll = (ROOT / "llms.txt").read_text(encoding="utf-8")
    for c in d["comparators"].values():
        for loc in (f"{SITE}{c['slug']}.html", f"{SITE}ar/{c['slug']}.html"):
            if f"<loc>{loc}</loc>" not in sm:
                out.append(f"sitemap.xml lacks {loc}")
        if f"{c['slug']}.html" not in ll:
            out.append(f"llms.txt lacks {c['slug']}.html")
    return out


if __name__ == "__main__":
    if sys.argv[1:2] == ["build"]:
        build(); sys.exit(0)
    found = check()
    print("\n".join(found) or "the comparison pages match comparisons.json")
    sys.exit(1 if found else 0)
