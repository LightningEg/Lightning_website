"""Refresh the owner console Roadmap view's test fixtures from the app repository's live board.

    python tools/roadmap_fixtures.py [path-to-app-repo]     (default ../Lightning; needs the gh CLI)

Writes supabase/tests/fixtures/roadmap-*.json: a real snapshot of tools/board.py's input (bodies cut to the three lines the
board reads), board.derive()'s answer on it, and the same issues in GitHub's own shape. supabase/tests/owner-roadmap-pages.test.mjs
checks js/owner-roadmap.js agrees with them. Public issue titles only; nothing private. Run it when board.py's rules change.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

app = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / 'Lightning').resolve()
sys.path.insert(0, str(app / 'tools'))
import board  # noqa: E402

out = Path(__file__).resolve().parents[1] / 'supabase' / 'tests' / 'fixtures'
out.mkdir(parents=True, exist_ok=True)
keep = re.compile(r'^(Can|Area|Blocked by):[ \t]*.+$', re.M | re.I)
closes = re.compile(r'\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d+', re.I)
slim = lambda b: '\n'.join(m.group(0).rstrip() for m in keep.finditer(b or ''))

data = board.fetch()
for i in data['issues']:
    i['body'] = slim(i['body'])
for p in data['prs']:
    p['body'] = ' '.join(closes.findall(p['body']))
rows = board.derive(data)
expected = [{'n': r['n'], 'state': r['state'], 'when': r['when'], 'can': r['can'], 'why': r['why'], 'parent': r['parent']} for r in rows]
raw = json.loads(subprocess.run(['gh', 'api', f'repos/{board.REPO}/issues?state=open&per_page=100'], capture_output=True, text=True, check=True).stdout)
fields = ('number', 'title', 'parent_issue_url', 'sub_issues_summary', 'issue_dependencies_summary')
raw = [{**{k: i.get(k) for k in fields}, 'body': slim(i.get('body')), 'labels': [{'name': x['name']} for x in i['labels']],
        'assignees': [{'login': a['login']} for a in i['assignees']]} for i in raw if 'pull_request' not in i]
for name, value in (('roadmap-board.json', data), ('roadmap-expected.json', expected), ('roadmap-raw-issues.json', raw)):
    (out / name).write_text(json.dumps(value, indent=1) + '\n')
print(f'{len(rows)} issues written to {out}')
