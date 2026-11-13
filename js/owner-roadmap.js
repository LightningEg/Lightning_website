/* Owner console, Roadmap view (admin.html #roadmap): what needs you, what is running, what is ready next, what is blocked
   and what shipped, read live from the app repository's GitHub issues and pull requests each time the view opens.
   The repository is public, so the browser reads GitHub's public API directly: no key, no copy in Supabase, nothing to
   keep in step. The state of each issue is worked out here by the same rules as tools/board.py in the app repository
   (supabase/tests/owner-roadmap-pages.test.mjs checks the two agree on a real snapshot of the board). Nothing here
   changes anything on GitHub except through the owner's controls (Move to Ready, Blocked or Parked; Add issue; drag to order), which go through the
   roadmap-write edge function (verified owner only). Every value is set with textContent. The answer is kept for 5 minutes (GitHub allows an
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

  /* The owner's order (tools/board.py, priority): the open issue titled "[PRIORITY] ..." lists #n per line, first is first.
     data.order (set after a drag, before GitHub is read again) wins over it. */
  function priority(data) {
    var holder = null, order = [];
    data.issues.forEach(function (i) { if (!holder && String(i.title).indexOf('[PRIORITY]') === 0) holder = i; });
    if (data.order) return { order: data.order, holder: holder && holder.n };
    if (holder) String(holder.body || '').split('\n').forEach(function (line) {
      var m = /#(\d+)/.exec(line); if (m && order.indexOf(Number(m[1])) < 0) order.push(Number(m[1]));
    });
    return { order: order, holder: holder && holder.n };
  }

  function derive(data) {
    var byN = {}, parent = {}, openPrs = {}, linked = {}, now = new Date(data.now).getTime(), pr = priority(data);
    data.issues.forEach(function (i) { if (i.n === pr.holder) return; byN[i.n] = JSON.parse(JSON.stringify(i)); i.children.forEach(function (k) { parent[k] = i.n; }); });
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
    rows.forEach(function (i) { var k = pr.order.indexOf(i.n); i.rank = k < 0 ? null : k; });
    return rows.sort(function (a, b) {
      if ((a.rank === null) !== (b.rank === null)) return a.rank === null ? 1 : -1;
      if (a.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
      return (ORDER[a.when] == null ? 3 : ORDER[a.when]) - (ORDER[b.when] == null ? 3 : ORDER[b.when]) || b.blocking - a.blocking || a.n - b.n;
    });
  }

  /* The three lists (tools/board.py, bucket): a status:ready|blocked|parked label set by the owner wins; otherwise worked out. */
  function bucket(i) {
    var chosen = label(i.labels, 'status');
    if (chosen === 'ready' || chosen === 'blocked' || chosen === 'parked') return chosen;
    if (i.when !== 'launch') return 'parked';
    return i.state === 'blocked' || i.state === 'held' ? 'blocked' : 'ready';
  }

  /* What the AIs would start on "go": launch work that is ready, the most unblocking first, never two in one area. */
  function pick(rows, cap) {
    var room = cap - rows.filter(function (i) { return i.state === 'running' && PEOPLE.indexOf(i.can) < 0; }).length, out = [];
    rows.forEach(function (i) {
      if (out.length >= room || i.state !== 'ready' || i.when !== 'launch' || bucket(i) !== 'ready') return;
      if (!out.some(function (c) { return overlap(i.areas, c.areas); })) out.push(i);
    });
    return out;
  }

  /* The words to paste into an AI chat to make it take one issue. They follow the repository's own rules (AGENTS.md:
     check the board, claim by a draft pull request, own branch, hand off on the issue), so the chat needs nothing else. */
  function prompt(i) {
    var head = ['Issue #' + i.n + ' in ' + REPO + ': ' + i.title, WEB + '/issues/' + i.n, ''];
    var area = i.areas && i.areas.length ? ' Stay inside its Area: ' + i.areas.join(', ') + '.' : '';
    var close = 'Tell me only results, decisions and real risks.';
    var p = (i.prs || [])[0], state = i.state || 'ready';
    if (state === 'running' || state === 'stale') {
      return head.concat(['Someone is already on this' + (p ? ': pull request #' + p.n + ' (branch ' + (p.branch || '?') + ')' : ' (it has an assignee)') + '. Do not open a second pull request.' +
        (state === 'stale' ? ' It has had no activity for 48 hours, so it may be abandoned.' : ''),
        'Read AGENTS.md, then read the pull request: its checks, review comments and what is left. Report where it stands. ' +
        (state === 'stale' ? 'If it is clearly abandoned, say so and what picking it up would take; do not take it over without my answer. ' : 'Continue it only if I say so. ') + close]).join('\n');
    }
    if (state === 'blocked' || state === 'held') {
      return head.concat(['The board lists this as ' + state + (i.why && i.why.length ? ' because of: ' + i.why.join('; ') : '') + '.',
        'Read AGENTS.md. Run `python tools/board.py` and check whether that has cleared. If it has, take the issue the usual way: a draft pull request that says `Closes #' + i.n + '`, your own branch named who/feature.' + area +
        ' If it has not, do not start; tell me what is still in the way and the quickest way to clear it. ' + close]).join('\n');
    }
    if (state === 'person') {
      return head.concat(['This one needs me, not an AI to build it (can: ' + (i.can || 'owner') + '). Read AGENTS.md and the issue with its Read: line.',
        'Tell me what I must decide or check, why it matters, and what I need to do it. For a decision, ask me with a pick-list of 2 to 4 distinct options, each with its trade-off and your recommendation first, marked (Recommended). ' +
        'Do the safe part meanwhile, and record my answer where the next AI will read it. ' + close]).join('\n');
    }
    if (state === 'group') {
      return head.concat(['This is a parent item; its steps are sub-issues. Read AGENTS.md and the issue, run `python tools/board.py`, and tell me which step is ready to take next and what each remaining step waits on. ' + close]).join('\n');
    }
    return head.concat(['Take this issue. Read AGENTS.md first. Run `python tools/board.py` and start only if #' + i.n + ' is still listed as ready (not running, blocked or held, no assignee). ' +
      'Claim it by opening a draft pull request that says `Closes #' + i.n + '`, on your own branch named who/feature. ' +
      'Read the issue and the Read: line in it, and follow its done-when.' + area,
      'Small finished steps, tests for what you changed, commits ending with the Release-note and Detail trailers and naming the item code in the subject. ' +
      'When done, leave one comment on the issue: Done (PR links), Left, Next. ' + close]).join('\n');
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
  else if (typeof window !== 'undefined') window.FGOwnerRoadmap = { derive: derive, pick: pick, normalize: normalize, prompt: prompt, bucket: bucket, priority: priority };

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
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
      return new Promise(function (ok, no) {
        var t = el('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; doc.body.appendChild(t); t.select();
        try { doc.execCommand('copy') ? ok() : no(new Error('copy refused')); } catch (e) { no(e); } finally { doc.body.removeChild(t); }
      });
    }
    function copyButton(i) {
      var b = el('button', 'btn ghost', 'Copy prompt'); b.type = 'button';
      b.setAttribute('aria-label', 'Copy a prompt for an AI chat about issue #' + i.n);
      b.addEventListener('click', function () {
        copyText(prompt(i)).then(function () { b.textContent = 'Copied'; }, function () { b.textContent = 'Copy failed'; })
          .then(function () { setTimeout(function () { b.textContent = 'Copy prompt'; }, 1800); });
      });
      return b;
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

    var LISTS = [['ready', 'Ready', 'free to take: copy the prompt into an AI chat'], ['blocked', 'Blocked', 'waiting on another issue, a pull request, the same files, or you'],
      ['parked', 'Parked', 'not for now: waits for your pick']];
    function say(msg, bad) { var n = doc.getElementById('ops-roadmap-say'); if (n) { n.textContent = msg; n.className = 'ops-fine' + (bad ? ' ops-bad' : ''); } }
    function write(body) {
      return Promise.resolve((window.FG || FG).sb.functions.invoke('roadmap-write', { body: body })).then(function (r) {
        if (r.error) {
          var ctx = r.error.context && r.error.context.json ? r.error.context.json().catch(function () { return null; }) : Promise.resolve(null);
          return ctx.then(function (j) { throw new Error((j && j.error) || 'The change did not go through.'); });
        }
        return r.data;
      });
    }
    function mover(i) {
      var sel = el('select', 'ops-select'), cur = bucket(i);
      sel.setAttribute('aria-label', 'Move issue #' + i.n + ' to another list');
      LISTS.forEach(function (l) { var o = el('option', null, l[1]); o.value = l[0]; if (l[0] === cur) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () {
        sel.disabled = true; say('Moving #' + i.n + '…');
        write({ action: 'set_status', issue: i.n, status: sel.value }).then(function () {
          say('Moved #' + i.n + ' to ' + sel.value + '.');
          shown.issues.forEach(function (x) { if (x.n === i.n) x.labels = x.labels.filter(function (y) { return y.indexOf('status:') !== 0; }).concat('status:' + sel.value); });
          remember(shown); render(shown);
        }, function (e) { say(e.message, true); sel.value = cur; sel.disabled = false; });
      });
      return sel;
    }
    var dragging = null;
    function reorder(bucketName, from, to) {
      var rows = derive(shown).filter(function (i) { return i.state !== 'group'; });
      var mine = rows.filter(function (i) { return bucket(i) === bucketName; });
      if (from === to || from < 0 || to < 0 || from >= mine.length || to >= mine.length) return;
      var arr = mine.slice(); arr.splice(to, 0, arr.splice(from, 1)[0]);
      var slots = [], all = rows.map(function (i) { return i.n; });
      rows.forEach(function (i, k) { if (bucket(i) === bucketName) slots.push(k); });
      slots.forEach(function (idx, k) { all[idx] = arr[k].n; });
      say('Saving the new order…');
      write({ action: 'set_order', order: all }).then(function () {
        shown.order = all; remember(shown); render(shown); say('Order saved: #' + all[0] + ' is first.');
      }, function (e) { say(e.message, true); });
    }
    function grip(i, name, k, count) {
      var box = el('span', 'oc-grip'), h = el('span', 'oc-grip-h', '\u283f'), up = el('button', 'btn ghost', '\u25b2'), dn = el('button', 'btn ghost', '\u25bc');
      h.setAttribute('aria-hidden', 'true'); h.title = 'Drag to reorder';
      [[up, 'Move #' + i.n + ' up', k - 1, k === 0], [dn, 'Move #' + i.n + ' down', k + 1, k === count - 1]].forEach(function (b) {
        b[0].type = 'button'; b[0].setAttribute('aria-label', b[1]); b[0].disabled = b[3];
        b[0].addEventListener('click', function () { reorder(name, k, b[2]); });
      });
      return add(box, [h, up, dn]);
    }
    function dragRows(host2, name) {
      var trs = [].slice.call(host2.querySelectorAll('tbody tr'));
      trs.forEach(function (tr, k) {
        tr.draggable = true; tr.setAttribute('data-k', k);
        tr.addEventListener('dragstart', function (e) { dragging = { name: name, k: k }; tr.classList.add('oc-dragging'); if (e.dataTransfer) { try { e.dataTransfer.setData('text/plain', String(k)); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* optional */ } } });
        tr.addEventListener('dragend', function () { dragging = null; tr.classList.remove('oc-dragging'); });
        tr.addEventListener('dragover', function (e) { if (dragging && dragging.name === name) { e.preventDefault(); tr.classList.add('oc-dragover'); } });
        tr.addEventListener('dragleave', function () { tr.classList.remove('oc-dragover'); });
        tr.addEventListener('drop', function (e) { e.preventDefault(); tr.classList.remove('oc-dragover'); if (dragging && dragging.name === name) { var d = dragging; dragging = null; reorder(name, d.k, k); } });
      });
    }
    function addForm() {
      var f = el('form', 'oc-form'), t = el('input'), d = el('textarea'), w = el('select'), s2 = el('select'), go = el('button', 'btn', 'Add issue');
      t.type = 'text'; t.required = true; t.maxLength = 200; t.placeholder = 'What needs doing, in one line'; t.setAttribute('aria-label', 'Issue title');
      d.rows = 4; d.maxLength = 8000; d.placeholder = 'Details, the goal and how you will know it is done (optional)'; d.setAttribute('aria-label', 'Issue details');
      [['launch', 'For launch'], ['after-launch', 'After launch'], ['someday', 'Someday']].forEach(function (o) { var x = el('option', null, o[1]); x.value = o[0]; w.appendChild(x); });
      LISTS.forEach(function (l) { var x = el('option', null, l[1]); x.value = l[0]; s2.appendChild(x); });
      w.setAttribute('aria-label', 'When'); s2.setAttribute('aria-label', 'List'); go.type = 'submit';
      f.addEventListener('submit', function (e) {
        e.preventDefault(); go.disabled = true; say('Filing the issue…');
        write({ action: 'create_issue', title: t.value, body: d.value, when: w.value, status: s2.value }).then(function (r) {
          say('Filed #' + r.issue + '.'); t.value = ''; d.value = ''; go.disabled = false; load(true);
        }, function (err) { say(err.message, true); go.disabled = false; });
      });
      var box = el('details', 'oc-fold'); box.appendChild(el('summary', null, 'Add an issue'));
      box.appendChild(add(f, [t, d, add(el('div', 'oc-toolbar'), [w, s2, go])]));
      return box;
    }

    function render(data) {
      shown = data;
      var rows = derive(data), leaves = rows.filter(function (i) { return i.state !== 'group'; });
      var next = pick(rows, 2).map(function (i) { return i.n; });
      host.textContent = '';
      var refresh = el('button', 'btn ghost', 'Refresh'); refresh.type = 'button'; refresh.addEventListener('click', function () { load(true); });
      host.appendChild(add(el('div', 'oc-toolbar'), [el('p', 'ops-fine', 'Read from GitHub ' + ago(data.now) + ' · ' + num(leaves.length) + ' open issues'), refresh]));
      host.appendChild(el('p', 'ops-fine', ''));
      host.lastChild.id = 'ops-roadmap-say';
      host.appendChild(addForm());
      LISTS.forEach(function (l) {
        var mine = leaves.filter(function (i) { return bucket(i) === l[0]; });
        host.appendChild(block(l[1] + ' (' + num(mine.length) + ')', l[2],
          table(['Order', 'Issue', 'Who', 'Move to', ''], mine.map(function (i, k) {
            var p = i.prs[0], note = i.can + (next.indexOf(i.n) >= 0 ? ' · next' : '') + (p ? ' · PR #' + p.n + (i.state === 'stale' ? ' stale' : '') : '') +
              (l[0] === 'blocked' && i.why.length ? ' · waiting on ' + i.why.join('; ') : '') + (l[0] === 'parked' ? ' · ' + i.when : '');
            return [grip(i, l[0], k, mine.length), issue(i), note, mover(i), copyButton(i)];
          }), 'Nothing here.')));
        dragRows(host.lastChild, l[0]);
      });
      host.appendChild(el('p', 'ops-fine', 'Drag a row (or use the arrows) to set the order: first is first, and the AIs start on the top ready issue. Lists follow tools/board.py in the app repository; Move to sets a status label on the issue that wins over the worked-out list. Copy prompt words each prompt for the issue\u2019s state.'));
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
    window.FGOwnerRoadmap = { derive: derive, pick: pick, normalize: normalize, prompt: prompt, bucket: bucket, priority: priority, load: load };
  }
})();
