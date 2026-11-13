"""One honest comparison table on the home page, built from one scorecard (guideline B10 and B12).

    python tools/comparisons.py            # check: both home pages' tables equal comparisons.json, retired pages redirect, sitemap and llms.txt agree
    python tools/comparisons.py build      # write the table into index.html and ar/index.html, then the llms.txt line

comparisons.json holds the scorecard: six qualities, a Low, Medium or High for Lightning and for each kind of tool, one line of
evidence for each, and the source of that evidence. The table names a kind of tool, never a product. Read the file's `rule` first.
The four lightning-vs-*.html pages (and ar/) were folded into this table (owner, 2026-11-13); they stay as redirects to #compare.
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
CSS = '<link rel="stylesheet" href="{up}css/compare.css?v=20261113-1">'
RATE = {"Low": 1, "Medium": 2, "High": 3}
AR_RATE = {"Low": "منخفض", "Medium": "متوسط", "High": "عالي"}
HOME = {"en": ROOT / "index.html", "ar": ROOT / "ar" / "index.html"}
SECTION = re.compile(r'(<section class="d-section" id="compare">).*?(</section>)', re.S)

COPY = {
    "en": {
        "label": "Compare", "h": "How Does It Compare?",
        "p": "One table, rated Low, Medium or High, with a line of why. Where another way is better, we say so.",
        "th": "What matters", "who": "Lightning", "best": "Pick it when",
        "src": "Ratings are our honest view as of {date}, checked against the sources named in the comparison file. Tell us if one is wrong.",
        "mine": "Lightning is the pick when you want your money kept on your own devices, with Egyptian banks, gold, loans and dollars in one traceable net worth. Quick one-tap logging and bank feeds are where others lead today.",
    },
    "ar": {
        "label": "قارن", "h": "بيقارن بإيه؟",
        "p": "جدول واحد بدرجات منخفض ومتوسط وعالي، وسطر بيشرح كل درجة. ولو طريقة تانية أحسن في حاجة، بنقول كده.",
        "th": "الحاجة المهمة", "who": "لايتنينج", "best": "اختاره لو",
        "src": "الدرجات دي رأينا الصريح لحد {date}، ومراجعة على المصادر المكتوبة في ملف المقارنة. قولنا لو درجة غلط.",
        "mine": "لايتنينج هو الاختيار لو عايز فلوسك تفضل على أجهزتك، ومعاها البنوك المصرية والدهب والقروض والدولار في صافي ثروة واحد تقدر تتتبعه. التسجيل السريع بلمسة والربط البنكي لسه غيرنا بيسبق فيهم.",
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


def section_html(d: dict, lang: str) -> str:
    t, cols = COPY[lang], list(d["comparators"])
    head = f'<th scope="col">{esc(t["th"])}</th><th scope="col" class="cmp-us">{esc(t["who"])}</th>' + "".join(
        f'<th scope="col" title="{esc(d["comparators"][k][lang + "_what"])}">{esc(d["comparators"][k][lang])}</th>' for k in cols)
    rows = ""
    for q in d["qualities"]:
        cells = ""
        for k in ["lightning", *cols]:
            who = t["who"] if k == "lightning" else d["comparators"][k][lang]
            cls = ' class="cmp-us"' if k == "lightning" else ""
            cells += f'<td{cls} data-who="{esc(who)}" data-col="{k}">{rate_html(q["ratings"][k], lang)}<span class="cmp-note">{esc(q[lang + "_note"][k])}</span></td>'
        rows += f'<tr data-quality="{q["id"]}"><th scope="row">{esc(q[lang])}</th>{cells}</tr>'
    best = f'<td class="cmp-us" data-who="{esc(t["who"])}"><span class="cmp-note">{esc(t["mine"])}</span></td>' + "".join(
        f'<td data-who="{esc(d["comparators"][k][lang])}"><span class="cmp-note">{esc(d["choose"][k][lang])}</span></td>' for k in cols)
    rows += f'<tr class="cmp-pick"><th scope="row">{esc(t["best"])}</th>{best}</tr>'
    table = (f'<div class="card card-support cmp-table-wrap"><table class="cmp-table cmp-all"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>'
             f'<p class="cmp-src">{esc(t["src"].format(date=d["date"]))}</p>')
    return (f'<section class="d-section" id="compare">\n    <div class="d-head"><p class="label">{t["label"]}</p><h2>{t["h"]}</h2><p>{esc(t["p"])}</p></div>\n'
            f'    {table}\n  </section>')


def build() -> None:
    d = data()
    for lang, path in HOME.items():
        text = path.read_text(encoding="utf-8")
        up = "../" if lang == "ar" else ""
        if "compare.css" not in text:
            text = text.replace(f'<link rel="stylesheet" href="{up}css/home.css', CSS.format(up=up) + f'\n<link rel="stylesheet" href="{up}css/home.css', 1)
        sec = section_html(d, lang)
        text = SECTION.sub(lambda m: sec, text, count=1)
        path.write_text(text, encoding="utf-8")
    sitemap_llms()
    print("wrote the comparison table into", len(HOME), "home pages")


def retired() -> list[Path]:
    return [ROOT / ("ar/" if lang == "ar" else "") / f"{c['slug']}.html" for c in data()["comparators"].values() for lang in ("en", "ar")]


def sitemap_llms() -> None:
    sm = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    sm = re.sub(r"\s*<url>\s*<loc>https://lightningeg.com/(ar/)?lightning-vs-[^<]*</loc>.*?</url>", "", sm, flags=re.S)
    (ROOT / "sitemap.xml").write_text(sm, encoding="utf-8")
    ll = (ROOT / "llms.txt").read_text(encoding="utf-8")
    body = (f"## Compare\n\n- [How does Lightning compare?]({SITE}#compare): one table rating Lightning, a spreadsheet, a traditional expense tracker, "
            f"a cloud budgeting app and an AI assistant, Low, Medium or High, with a line of evidence for each.\n")
    ll = re.sub(r"## Compare\n.*?(?=\n## |\Z)", lambda m: body, ll, flags=re.S)
    (ROOT / "llms.txt").write_text(ll if ll.endswith("\n") else ll + "\n", encoding="utf-8")


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
    for lang, path in HOME.items():
        rel = path.relative_to(ROOT)
        text = path.read_text(encoding="utf-8")
        if section_html(d, lang) not in text:
            out.append(f"{rel}: the comparison table differs from comparisons.json: run python tools/comparisons.py build")
            continue
        sec = SECTION.search(text).group(0)
        if lang == "en" and banned.search(re.sub(r"<[^>]+>", " ", sec).replace("Lightning", "")):
            out.append(f"{rel}: names a product; compare kinds of tool only (guideline B10)")
    for p in retired():
        if not p.exists() or 'http-equiv="refresh"' not in p.read_text(encoding="utf-8"):
            out.append(f"{p.relative_to(ROOT)} should be a redirect to the home page's #compare table")
    sm = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
    if "lightning-vs-" in sm:
        out.append("sitemap.xml still lists a retired lightning-vs page")
    ll = (ROOT / "llms.txt").read_text(encoding="utf-8")
    if "lightning-vs-" in ll or f"{SITE}#compare" not in ll:
        out.append("llms.txt must link the #compare table and no retired page")
    return out


if __name__ == "__main__":
    if sys.argv[1:2] == ["build"]:
        build(); sys.exit(0)
    found = check()
    print("\n".join(found) or "the comparison table matches comparisons.json")
    sys.exit(1 if found else 0)
