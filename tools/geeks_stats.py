"""Recount the figures For Geeks quotes about the app's code, and write them into forgeeks.html.

    python tools/geeks_stats.py ../Lightning          # recount from an app checkout on main, rewrite the page
    python tools/geeks_stats.py ../Lightning --check  # say which figures have drifted; exit 1 if any; change nothing

The proof section's stats and the terminal replay must say what the same commands print on the current build
(guideline D10). Each count here is the command the terminal shows, done in Python so it runs on Windows too:
lines of Python (find lightning -name '*.py' | xargs cat | wc -l), test functions (grep -rhE "^\\s*(async )?def test_"
tests | wc -l), test files (tests/test_*.py), migrations (ls lightning/database/migrations | wc -l) and import
contracts (pyproject.toml). The date is the app's last commit. Run it whenever you touch For Geeks, and before a release.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "forgeeks.html"


def count(app: Path) -> dict[str, int | str]:
    test_def = re.compile(rb"^\s*(async )?def test_", re.M)
    return {
        "lines": sum(f.read_bytes().count(b"\n") for f in (app / "lightning").rglob("*.py")),
        "tests": sum(len(test_def.findall(f.read_bytes())) for f in (app / "tests").rglob("*") if f.is_file()),
        "files": len(list((app / "tests").glob("test_*.py"))),
        "migrations": sum(1 for _ in (app / "lightning/database/migrations").iterdir()),
        "contracts": (app / "pyproject.toml").read_text(encoding="utf-8").count("[[tool.importlinter.contracts]]"),
        "date": subprocess.run(["git", "-C", str(app), "log", "-1", "--format=%cd", "--date=short"],
                               capture_output=True, text=True, check=True).stdout.strip(),
    }


def write(html: str, n: dict) -> str:
    def stat(label: str, value: int) -> None:
        nonlocal html
        html, k = re.subn(rf'<b data-count="\d+">[\d,]+</b><span>{re.escape(label)}</span>',
                          f'<b data-count="{value}">{value:,}</b><span>{label}</span>', html)
        assert k == 1, label

    stat("lines of Python", n["lines"])
    stat("test functions", n["tests"])
    stat("test files", n["files"])
    stat("append-only migrations", n["migrations"])
    stat("import contracts, all kept", n["contracts"])
    html = re.sub(r"// counted \d{4}-\d{2}-\d{2} on main", f"// counted {n['date']} on main", html)
    # the terminal replay prints the same counts
    for cmd, value in (("xargs cat | wc -l\",o:['", n["lines"]), ("def test_\" tests | wc -l',o:['", n["tests"]),
                       ("migrations | wc -l',o:['", n["migrations"])):
        html, k = re.subn(rf"({re.escape(cmd)})\d+'", rf"\g<1>{value}'", html)
        assert k == 1, cmd
    html = re.sub(r"… \d+ more contracts", f"… {n['contracts'] - 1} more contracts", html)
    html = re.sub(r"Contracts: <span class=\"ok\">\d+ kept</span>", f"Contracts: <span class=\"ok\">{n['contracts']} kept</span>", html)
    return html


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--check"]
    app = Path(args[0] if args else "../Lightning").resolve()
    numbers = count(app)
    old = PAGE.read_text(encoding="utf-8")
    new = write(old, numbers)
    if "--check" in sys.argv:
        if new != old:
            print(f"forgeeks.html: the figures differ from {app} ({numbers}); run python tools/geeks_stats.py {args[0] if args else '../Lightning'}")
            sys.exit(1)
        print("forgeeks.html: figures match the app")
    else:
        PAGE.write_text(new, encoding="utf-8")
        print(numbers)
