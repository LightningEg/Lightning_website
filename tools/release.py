"""Archive live pages and give them new UX release IDs (README › Version identity and archive).

Run from the site root BEFORE you edit the pages, or the page-specific CSS and JS you list in "snap":

    python tools/release.py spec.json

spec.json: {"date": "2026.10.15", "pages": [{"page": "index.html", "name": "Lightning · What changed",
            "desc": "One sentence for the Version Archive.", "snap": ["css/home.css", "js/wow.js"]}],
            "versions_name": "Version Archive · What changed", "versions_desc": "One sentence."}

For each page: copies it to archive/<old id>.html with <base href="../"> and noindex, copies each "snap" file to
archive/<old id>-<name>.<ext> and points the snapshot at it, marks the old id archived in version-registry.json,
gives the page the next free UX-<date>.NN, then does the same for versions.html, adds a row per new id and
sets every row's state from the registry. English pages only: Arabic pages carry no UX ids."""
import json, re, shutil, sys
from pathlib import Path

spec = json.load(open(sys.argv[1]))
reg_path = Path("version-registry.json"); reg = json.loads(reg_path.read_text())
rels = reg["releases"]
def next_id():
    nums = [int(r["id"].rsplit(".", 1)[1]) for r in rels if r["id"].startswith(f"UX-{spec['date']}.")]
    return f"UX-{spec['date']}.{max(nums, default=0) + 1:02d}"

def snapshot(page, old, snaps):
    html = Path(page).read_text(encoding="utf-8")
    html = re.sub(r"(<head[^>]*>\n)", r'\1<base href="../">\n', html, count=1)
    if "noindex" not in html:
        html = re.sub(r"(<head[^>]*>\n)", r'\1<meta name="robots" content="noindex,follow">\n', html, count=1)
    for src in snaps:
        stem = Path(src).stem; ext = Path(src).suffix
        dest = f"archive/{old}-{stem}{ext}"
        shutil.copyfile(src, dest)
        if ext == ".js":  # a script that loads files beside itself (wow.js: vendor/) looks in js/, not archive/
            body = Path(dest).read_text(encoding="utf-8").replace("new URL('vendor/", "new URL('../js/vendor/")
            Path(dest).write_text(body, encoding="utf-8")
        html, n = re.subn(rf'(href|src)="{re.escape(src)}(\?[^"]*)?"', rf'\1="{dest}"', html)
        assert n, (page, src)
    out = Path(f"archive/{old}.html"); assert not out.exists(), out
    out.write_text(html, encoding="utf-8")

def release(page, name, desc, snaps=()):
    assert not page.startswith("ar/"), f"{page}: Arabic pages carry no UX release ids"
    html = Path(page).read_text(encoding="utf-8")
    old = re.search(r'data-ux-version="([^"]+)"', html).group(1)
    snapshot(page, old, snaps)
    new = next_id()
    for r in rels:
        if r["id"] == old: r["status"], r["archive_url"] = "archived", f"archive/{old}.html"
    rels.append({"id": new, "name": name, "page": page, "status": "current", "archive_url": None})
    Path(page).write_text(html.replace(f'data-ux-version="{old}"', f'data-ux-version="{new}"'), encoding="utf-8")
    return old, new, name, desc

done = [release(p["page"], p["name"], p["desc"], p.get("snap", ())) for p in spec["pages"]]
# The version archive itself changes too: snapshot it first, then add the rows.
vold, vnew, _, _ = release("versions.html", spec["versions_name"], spec["versions_desc"])
done.append((vold, vnew, spec["versions_name"], spec["versions_desc"]))
v = Path("versions.html").read_text(encoding="utf-8")
row = '<article class="card version-row" id="{id}"><div><h2>{name}</h2><p>{desc}</p><code class="version-id">{id}</code></div><span class="version-state">Current</span></article>'
rows = "\n".join(row.format(id=n, name=nm, desc=d) for _, n, nm, d in done)
# Insert after the last row of the newest date already listed.
newest = max(re.findall(r'id="(UX-\d{4}\.\d\d\.\d\d)\.\d\d"', v))
last = [m for m in re.finditer(r'<article class="card version-row" id="(UX-[^"]+)">.*?</article>\n', v) if m.group(1).startswith(newest)][-1]
v = v[:last.end()] + rows + "\n" + v[last.end():]
# Every row's state follows the registry.
status = {r["id"]: r for r in rels}
def fix(m):
    rid = m.group(1); r = status.get(rid)
    if not r: return m.group(0)
    state = (f'<a class="version-state" href="{r["archive_url"]}">Archived</a>' if r["status"] == "archived" and r["archive_url"]
             else '<span class="version-state">Current</span>')
    return re.sub(r'<(span|a) class="version-state"[^>]*>[^<]*</(span|a)>', state, m.group(0))
v = re.sub(r'<article class="card version-row" id="(UX-[^"]+)">.*?</article>', fix, v)
Path("versions.html").write_text(v, encoding="utf-8")
reg_path.write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
for o, n, nm, _ in done: print(o, "->", n, nm)
