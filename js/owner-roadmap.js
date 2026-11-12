/* Owner console, Roadmap view (admin.html #roadmap): what needs you, what is running, what is ready next, what is blocked
   and what shipped, read live from the app repository's GitHub issues and pull requests each time the view opens.
   The repository is public, so the browser reads GitHub's public API directly: no key, no copy in Supabase, nothing to
   keep in step. The state of each issue is worked out here by the same rules as tools/board.py in the app repository
   (supabase/tests/owner-roadmap-pages.test.mjs checks the two agree on a real snapshot of the board). Nothing here
   changes anything on GitHub. Every value is set with textContent. The answer is kept for 5 minutes (GitHub allows an
   address 60 reads an hour; one load takes about a dozen) and Refresh asks again. */
(function () {
  'use strict';
  var doc = document;
  var REPO = 'LightningEg/Lightning', API = 'https://api.github.com/repos/' + REPO, WEB = 'https://github.com/' + REPO;
  var KEEP = 5 * 60 * 1000, KEY = 'lightning-owner-roadmap-v1';
  var CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  var GENERIC = ['tests', 'none', 'see item file', 'ai', 'docs', 'tools', 'lightning', 'lightning/ui', 'guideline'];
  var ORDER = { launch: 0, 'after-launch': 1, someday: 2, unsorted: 3 };
  var PEOPLE = ['owner', 'human'];

  /* ---------- the board's rules (tools/board.py, derive and pick) ---------- */
  function label(labels, key) {
    for (var i = 0; i < labels.length; i++) if (labels[i].indexOf(key + ':') === 0) return labels[i].slice(key.length + 1);
    return null;
  }
  function line(body, key) {
    var m = new RegExp('^' + key + ':[ \\t]*(.+)$', 'mi').exec(body || '');
    return m ? m[1].trim() : null;
  }
  function areas(text) {
    var out = [];
    (text || '').split(',').forEach(function (a) {
      a = a.trim().replace(/^`+|`+$/g, '').replace(/\/+$/, '');
      if (a && GENERIC.indexOf(a) < 0 && out.indexOf(a) < 0) out.push(a);
    });
    return out;
  }
  function overlap(a, b) {
    return a.some(function (x) { return b.some(function (y) { return x === y || x.indexOf(y + '/') === 0 || y.indexOf(x + '/') === 0; }); });
  }
  function hours(ts, now) { return (now - new Date(ts).getTime()) / 36e5; }

  function derive(data) {
    var byN = {}, parent = {}, openPrs = {}, linked = {}, now = new Date(data.now).getTime();
    data.issues.forEach(function (i) { byN[i.n] = JSON.parse(JSON.stringify(i)); i.children.forEach(function (k) { parent[k] = i.n; }); });
    data.prs.forEach(function (p) {
      openPrs[p.n] = p;
      var seen = {}, m; CLOSES.lastIndex = 0;
      while ((m = CLOSES.exec(p.body || ''))) { var n = Number(m[1]); if (!seen[n]) { seen[n] = 1; (linked[n] = linked[n] || []).push(p); } }
    });
    var rows = Object.keys(byN).map(function (k) {
      var i = byN[k], up = byN[parent[i.n]] || { labels: [], body: '', blocked_by: [] };
      i.parent = parent[i.n] == null ? null : parent[i.n];
      i.when = label(i.labels, 'when') || label(up.labels, 'when') || 'unsorted';
      i.can = (line(i.body, 'Can') || label(i.labels, 'can') || label(up.labels, 'can') || 'any-ai').toLowerCase();
      var own = areas(line(i.body, 'Area'));
      i.areas = own.length ? own : areas(line(up.body, 'Area'));
      i.prs = linked[i.n] || [];
      var said = line(i.body, 'Blocked by') || '';
      var why = i.blocked_by.concat(up.blocked_by.filter(function (b) { return i.blocked_by.indexOf(b) < 0; }))
        .map(function (b) { return b ? '#' + b : 'an open issue'; });
      var re = /PR #(\d+)/g, pm;
      while ((pm = re.exec(said))) if (openPrs[Number(pm[1])]) why.push('PR #' + pm[1]);
      var outside = said.replace(/(PR )?#\d+( \([^)]*\))?/g, '').replace(/^[ ,;.]+|[ ,;.]+$/g, '').toLowerCase();
      if (outside && outside.indexOf('none') !== 0 && !/^(and|for|the|,|\s)*$/.test(outside) && !/#\d+/.test(said)) why.push(said);
      i.why = why;
      return i;
    });
    rows.forEach(function (i) {
      var stale = i.prs.length && i.prs.every(function (p) { return hours(p.updated, now) > 48; });
      if (i.children.length) i.state = 'group';
      else if (i.prs.length || i.assignees.length) i.state = stale ? 'stale' : 'running';
      else if (i.why.length) i.state = 'blocked';
      else if (PEOPLE.indexOf(i.can) >= 0) i.state = 'person';
      else i.state = 'ready';
    });
    var busy = rows.filter(function (i) { return i.state === 'running' || i.state === 'stale'; });
    rows.forEach(function (i) {
      if (i.state !== 'ready') return;
      var clash = busy.filter(function (b) { return overlap(i.areas, b.areas); }).map(function (b) { return b.n; });
      if (clash.length) { i.state = 'held'; i.why = clash.map(function (c) { return 'same area as #' + c; }); }
    });
    return rows.sort(function (a, b) { return (ORDER[a.when] == null ? 3 : ORDER[a.when]) - (ORDER[b.when] == null ? 3 : ORDER[b.when]) || b.blocking - a.blocking || a.n - b.n; });
  }

  /* What the AIs would start on "go": launch work that is ready, the most unblocking first, never two in one area. */
  function pick(rows, cap) {
    var room = cap - rows.filter(function (i) { return i.state === 'running' && PEOPLE.indexOf(i.can) < 0; }).length, out = [];
    rows.forEach(function (i) {
      if (out.length >= room || i.state !== 'ready' || i.when !== 'launch') return;
      if (!out.some(function (c) { return overlap(i.areas, c.areas); })) out.push(i);
    });
    return out;
  }

  /* ---------- GitHub's answer into the board's input ---------- */
  function normalize(rawIssues, rawOpen, rawClosed, blockers, now) {
    var issues = rawIssues.filter(function (i) { return !i.pull_request; });
    var kids = {};
    issues.forEach(function (i) {
      var m = /\/issues\/(\d+)$/.exec(i.parent_issue_url || '');
      if (m) (kids[m[1]] = kids[m[1]] || []).push(i.number);
    });
    return {
      now: now,
      issues: issues.map(function (i) {
        var dep = i.issue_dependencies_summary || {};
        return { n: i.number, title: i.title, body: i.body || '', labels: (i.labels || []).map(function (l) { return l.name; }),
          assignees: (i.assignees || []).map(function (a) { return a.login; }), children: kids[i.number] || [],
          blocked_by: dep.blocked_by ? (blockers[i.number] || [0]) : [], blocking: dep.blocking || 0 };
      }),
      prs: rawOpen.map(function (p) { return { n: p.number, title: p.title, body: p.body || '', branch: p.head && p.head.ref, draft: !!p.draft, updated: p.updated_at }; }),
      merged: rawClosed.filter(function (p) { return p.merged_at; }).map(function (p) { return { n: p.number, title: p.title, merged: p.merged_at }; })
    };
  }

  /* ---------- reading GitHub ---------- */
  var ask = function (path) {
    return fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) {
      if (r.status === 403 || r.status === 429) throw new Error('GitHub is limiting reads from this address for a while. Try again in a few minutes.');
      if (!r.ok) throw new Error('GitHub answered ' + r.status + '.');
      return r.json();
    });
  };
  function fetchAll() {
    return Promise.all([ask('/issues?state=open&per_page=100'), ask('/pulls?state=open&per_page=100'),
      ask('/pulls?state=closed&sort=updated&direction=desc&per_page=40')]).then(function (a) {
      var need = a[0].filter(function (i) { return !i.pull_request && (i.issue_dependencies_summary || {}).blocked_by; });
      var got = {};
      // The names of the blockers are a nicety: when GitHub refuses them the issue still reads as blocked.
      return Promise.all(need.map(function (i) {
        return ask('/issues/' + i.number + '/dependencies/blocked_by').then(function (b) {
          got[i.number] = b.filter(function (x) { return x.state === 'open'; }).map(function (x) { return x.number; });
        }).catch(function () {});
      })).then(function () { return normalize(a[0], a[1], a[2], got, new Date().toISOString()); });
    });
  }
  function remembered() {
    try { var s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return s && Date.now() - s.at < KEEP ? s : null; } catch (e) { return null; }
  }
  function remember(data) { try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { /* the view works without it */ } }

  /* ---------- the page ---------- */
  var host = doc.getElementById('ops-roadmap');
  if (host) start();
  else if (typeof window !== 'undefined') window.FGOwnerRoadmap = { derive: derive, pick: pick, normalize: normalize };

  function start() {
    var verified = false, loading = false, shown = null, FG = window.FG || {};
    function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function add(p, kids) { kids.forEach(function (k) { if (k) p.appendChild(k); }); return p; }
    function num(n) { return Math.round(Number(n || 0)).toLocaleString('en-US'); }
    function link(text, href) { var a = el('a', null, text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; }
    function issue(i) { return link('#' + i.n + ' ' + i.title.replace(/^(\[[^\]]+\]\s*)+/, ''), WEB + '/issues/' + i.n); }
    function ago(ts) {
      var m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
      return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
    }
    function kpi(labelText, value, sub) {
      return add(el('article', 'ops-kpi'), [el('span', 'ops-kpi-l', labelText), el('strong', null, num(value)), sub ? el('p', 'ops-sub', sub) : null]);
    }
    function table(head, rows, empty) {
      if (!rows.length) return el('p', 'ops-empty', empty);
      var t = el('table', 'oc-table'), tr = el('tr');
      head.forEach(function (h) { tr.appendChild(el('th', null, h)); });
      t.appendChild(add(el('thead'), [tr]));
      var body = el('tbody');
      rows.forEach(function (r) {
        var row = el('tr');
        r.forEach(function (c) { var td = el('td'); if (typeof c === 'string') td.textContent = c; else td.appendChild(c); row.appendChild(td); });
        body.appendChild(row);
      });
      t.appendChild(body);
      return add(el('div', 'oc-table-wrap'), [t]);
    }
    function block(title, note, node) {
      return add(el('section', 'ops-block'), [add(el('div', 'ops-card-h'), [el('h3', null, title), note ? el('span', 'ops-fine', note) : null]), node]);
    }

    function render(data) {
      var rows = derive(data), now = new Date(data.now).getTime();
      var leaves = rows.filter(function (i) { return i.state !== 'group'; });
      var launch = leaves.filter(function (i) { return i.when === 'launch'; });
      var by = function (s, all) { return (all ? leaves : launch).filter(function (i) { return s.indexOf(i.state) >= 0; }); };
      var person = by(['person'], true), running = by(['running', 'stale'], true), ready = by(['ready']), stuck = by(['blocked', 'held'], true);
      var next = pick(rows, 2);
      host.textContent = '';
      var refresh = el('button', 'btn ghost', 'Refresh'); refresh.type = 'button'; refresh.addEventListener('click', function () { load(true); });
      host.appendChild(add(el('div', 'oc-toolbar'), [el('p', 'ops-fine', 'Read from GitHub ' + ago(data.now) + ' · ' + num(launch.length) + ' launch issues open, ' + num(leaves.length) + ' in all'), refresh]));

      host.appendChild(add(el('div', 'ops-kpis'), [
        kpi('Needs you', person.length, person.length ? 'a choice or a check only you can make' : 'nothing is waiting on you'),
        kpi('Running now', running.length, running.length ? 'pull requests being built' : 'no one is building'),
        kpi('Ready to start', ready.length, next.length ? 'next on go: ' + next.map(function (i) { return '#' + i.n; }).join(', ') : ready.length ? 'two builds already running, so none starts yet' : 'nothing is free to start'),
        kpi('Blocked or held', stuck.length, num(stuck.filter(function (i) { return i.when === 'launch'; }).length) + ' of them for launch')]));

      host.appendChild(block('Needs you', 'a choice or a check only you can make',
        table(['Issue', 'When'], person.map(function (i) { return [issue(i), i.when]; }), 'Nothing is waiting on you.')));

      host.appendChild(block('Running now', 'an open pull request says Closes it',
        table(['Issue', 'Pull request', 'Last activity'], running.map(function (i) {
          var p = i.prs[0];
          return [issue(i), p ? add(el('span'), [link('#' + p.n, WEB + '/pull/' + p.n), el('small', 'ops-sub', (p.draft ? ' draft · ' : ' ') + (p.branch || ''))]) : (i.assignees.join(', ') || 'assigned'),
            p ? ago(p.updated) + (i.state === 'stale' ? ' · stale' : '') : ''];
        }), 'Nothing is running.')));

      host.appendChild(block('Ready next', 'launch work free to start, the most unblocking first', add(el('div'), [
        table(['Issue', 'Who', ''], ready.slice(0, 12).map(function (i) {
          return [issue(i), i.can, next.indexOf(i) >= 0 ? 'starts on go' : ''];
        }), 'Nothing is ready.'),
        ready.length > 12 ? el('p', 'ops-fine', 'and ' + num(ready.length - 12) + ' more launch issues ready. The board on GitHub lists the rest.') : null])));

      host.appendChild(block('Blocked or held', 'waiting on another issue, a pull request or the same files',
        table(['Issue', 'Waiting on'], stuck.map(function (i) { return [issue(i), i.why.join('; ')]; }), 'Nothing is blocked.')));

      var shipped = data.merged.slice(0, 8);
      host.appendChild(block('Shipped lately', 'the last merged pull requests',
        table(['Pull request', 'Merged'], shipped.map(function (p) { return [link('#' + p.n + ' ' + p.title.replace(/^(\[[^\]]+\]\s*)+/, ''), WEB + '/pull/' + p.n), ago(p.merged)]; }), 'Nothing merged yet.')));

      var later = leaves.filter(function (i) { return i.when !== 'launch'; });
      var cnt = function (w) { return later.filter(function (i) { return i.when === w; }).length; };
      host.appendChild(el('p', 'ops-fine', 'Not for launch: ' + num(cnt('after-launch')) + ' after launch, ' + num(cnt('someday')) + ' someday, ' + num(cnt('unsorted')) + ' not sorted yet. States follow tools/board.py in the app repository. To start work, tell Claude go.'));
      shown = now;
    }

    function fail(e) {
      if (shown) return; // keep what is on screen
      host.textContent = '';
      host.appendChild(el('p', 'ops-empty', 'The roadmap did not load. ' + ((e && e.message) || 'Try Refresh.')));
    }
    function load(force) {
      if (!verified || loading) return Promise.resolve();
      var kept = force ? null : remembered();
      if (kept) { render(kept.data); return Promise.resolve(); }
      loading = true;
      if (!shown) { host.textContent = ''; host.appendChild(el('p', 'ops-empty', 'Reading the board from GitHub…')); }
      return fetchAll().then(function (d) { remember(d); render(d); }).catch(fail).then(function () { loading = false; });
    }
    var open = function () { var v = doc.getElementById('roadmap'); return v && !v.hidden; };
    window.addEventListener('lightning:owner-access', function (e) {
      verified = !!(e.detail && e.detail.verified);
      if (verified && open()) load(); else if (!verified) { shown = null; host.textContent = ''; host.appendChild(el('p', 'ops-empty', 'Verify your session to load the roadmap.')); }
    });
    window.addEventListener('lightning:owner-view', function (e) { if (verified && e.detail && e.detail.view === 'roadmap') load(); });
    // Left open on a second screen it keeps itself current.
    setInterval(function () { if (verified && open() && !doc.hidden) load(); }, KEEP);
    window.FGOwnerRoadmap = { derive: derive, pick: pick, normalize: normalize, load: load };
  }
})();
