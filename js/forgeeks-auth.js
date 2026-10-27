/* For Geeks: one sign-in for every page. Loaded by tools/geeks_shell.py after js/vendor/supabase-*.js and
   js/forgeeks-config.js. Creates the single Supabase client (window.FG.sb) and turns the top bar's
   "sign in" chip into an account menu once someone is signed in. Without script the chip stays a plain
   link to the account page. Member text is only ever set with textContent. */
(function (root) {
  'use strict';

  /* ---------- pure helpers (tested in node: supabase/tests/auth.test.mjs) ---------- */
  var ACCOUNT = root.document && root.document.body && root.document.body.dataset.accountPage === 'account.html' ? 'account.html' : 'forgeeks-account.html';
  var MAIN_ACCOUNT = ACCOUNT === 'account.html';
  var NEXT_RE = /^(?:forgeeks[a-z0-9-]*|marketplace|leaderboard|stories|topup|admin|index|features|guides|how-it-works|current-status)\.html(\?[^#\s<>"']*)?(#[^\s<>"']*)?$/;

  // Return only to explicitly supported main-site/For Geeks routes; never another origin or an account page.
  function safeNext(next) {
    if (typeof next !== 'string') return null;
    next = next.replace(/^\/+/, '');
    if (!NEXT_RE.test(next) || ['account.html', 'forgeeks-account.html'].indexOf(next.split(/[?#]/)[0]) >= 0) return null;
    return next;
  }

  function signInHref(pathname, search, hash) {
    var page = String(pathname || '').split('/').pop() || '';
    var next = safeNext(page + (search || '') + (hash || ''));
    return next ? ACCOUNT + '?next=' + encodeURIComponent(next) : ACCOUNT;
  }

  function initial(name) {
    var c = String(name || '').trim().charAt(0);
    return c ? c.toUpperCase() : '?';
  }

  /* Plain words for what Supabase and Postgres report. Never shows raw internals. */
  function say(err) {
    var m = String((err && (err.message || err.error_description)) || err || '');
    var c = err && err.code;
    if (/price changed/i.test(m)) return 'The price changed. Reload the market and check the new price before buying.';
    // supporter release: gifts, sets, earned badges, seasonal drops and the vote
    if (/no member with that display name/i.test(m)) return 'No member has that display name. Check it on their profile.';
    if (/they already have it/i.test(m)) return 'They already have it. Pick something else for them.';
    if (/buy it for yourself/i.test(m)) return 'That is you. Buy it from the market instead.';
    if (/cannot be given now|gift limit/i.test(m)) return /gift limit/i.test(m) ? 'You have sent 20 gifts today. Send more tomorrow.' : 'This item cannot be given right now.';
    if (/earned, not sold/i.test(m)) return 'Supporter badges are earned by topping up, never sold.';
    if (/not on sale now|part of this set is not on sale/i.test(m)) return 'This is not on sale right now.';
    if (/already own every part/i.test(m)) return 'You already own every part of this set.';
    if (/supporters vote/i.test(m)) return 'Supporters choose the next theme. Top up once to earn a supporter badge and a vote.';
    if (/receipt changed/i.test(m)) return 'The payment evidence changed. Reload the queue and review it again.';
    if (/pending payments/i.test(m)) return 'Resolve pending payments with support before deleting your account.';
    if (/deletion in progress/i.test(m)) return 'Finish or cancel account deletion before making more changes.';
    if (/Deletion did not complete|Account deletion did not complete|Account deletion is unavailable|More receipt cleanup/i.test(m)) return 'Account deletion did not complete. Retry, or cancel deletion preparation from your account.';
    if (/receipt upload limit/i.test(m)) return 'Receipt upload limit reached. Contact support before trying more uploads.';
    if (/daily checkout limit/i.test(m)) return 'Today’s checkout limit is reached. Use an existing request or try again tomorrow.';
    if (/checkout is not configured/i.test(m)) return 'New top-ups are currently closed. Existing requests remain available.';
    if (/payment amount mismatch/i.test(m)) return 'The received amount does not match this checkout. Leave it pending and reconcile the transfer.';
    if (/payment reference required/i.test(m)) return 'Enter the bank transaction reference, using 6–100 letters, digits or hyphens.';
    if (/receipt submitted/i.test(m)) return 'A receipt was submitted. Contact support to review this payment.';
    if (/Open the receipt|Add a reconciliation note|clear rejection reason|Enter an EGP price|Invalid price/i.test(m)) return 'Open and review the receipt, enter the exact EGP amount and bank reference, and add a clear note.';
    if (/session ended/i.test(m)) return 'Your session ended. Sign in again and verify MFA if you are using owner controls.';
    if (/community access is restricted/i.test(m)) return 'Your community access is restricted. Contact hello@lightningeg.com to request a review.';
    if (/post changed/i.test(m)) return 'This post changed after you opened it. Reload it and verify the current links and code.';
    if (/MFA/i.test(m)) return 'Verify your administrator session with an authenticator code first.';
    if (/public adult profile/i.test(m)) return 'Set your profile to public before publishing.';
    if (/sharing consent/i.test(m)) return 'Add a title, a summary of 20–400 characters, and confirm sharing consent.';
    if (/source already accepted/i.test(m)) return 'That social post has already been accepted for another story.';
    if (/account not found/i.test(m)) return 'No account matches that email.';
    if (/member_profiles_display_name_key/.test(m)) return 'That display name is taken. Try another.';
    if (/at most 12/.test(m)) return 'You can keep up to 12 links.';
    if (/insufficient coins/i.test(m)) return 'Not enough coins for that yet.';
    if (/already owned/i.test(m)) return 'You already own that.';
    if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.';
    if (/Email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you.';
    if (/rate limit|too many/i.test(m) || (err && err.status === 429)) return 'Too many tries. Wait a few minutes and try again.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Cannot reach the server. Check your connection.';
    if (/JWT expired|session.*(missing|expired)/i.test(m)) return 'Your session ended. Sign in again.';
    if (c === '42501' || /permission denied|row-level security|administrator only/i.test(m)) return 'That is not allowed for your account.';
    if (c === '23514') return 'One of the values is not allowed. Check the form.';
    if (c === '23505') return 'That already exists.';
    return 'Something went wrong. Try again.';
  }

  var pure = { safeNext: safeNext, signInHref: signInHref, initial: initial, say: say };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }

  /* ---------- browser ---------- */
  var doc = root.document;
  var cfg = root.FORGEEKS;
  var listeners = [];
  var current = null, meCache = null, meFor = null, resolveReady, ownerRole = false, roleFor = null;
  var ready = new Promise(function (r) { resolveReady = r; });

  var FG = root.FG = {
    sb: null,
    ready: ready,
    coinName: 'Lightning Coins',
    session: function () { return current; },
    onAuth: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    me: function () {
      if (!FG.sb || !current) return Promise.resolve(null);
      var uid = current.user.id;
      if (meCache && meFor === uid) return meCache;
      meFor = uid;
      meCache = FG.sb.from('member_profiles').select('user_id,display_name,avatar_url').eq('user_id', uid).maybeSingle()
        .then(function (r) { return r.error ? null : r.data; }, function () { return null; });
      return meCache;
    },
    refreshMe: function () { meCache = null; return FG.me().then(function (m) { render(m); return m; }); },
    signInHref: function () { return (MAIN_ACCOUNT && root.location.pathname.indexOf('/ar/') >= 0 ? '../' : '') + signInHref(root.location.pathname, root.location.search, root.location.hash); },
    say: say,
    safeNext: safeNext,
    available: false
  };

  /* ---------- the account chip and menu in the top bar ---------- */
  var slot, menu, btn;

  function closeMenu(focusBack) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (focusBack) btn.focus();
  }

  function openMenu() {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    var first = menu.querySelector('[role=menuitem]');
    if (first) first.focus();
  }

  function items() { return Array.prototype.slice.call(menu.querySelectorAll('[role=menuitem]')); }

  function signedOutChip() {
    var a = doc.createElement('a');
    a.className = 'chip me';
    a.id = 'me';
    a.href = FG.signInHref();
    if (MAIN_ACCOUNT) {
      a.setAttribute('aria-label', 'Sign in to your account');
      a.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg>';
    } else a.textContent = 'sign in';
    return a;
  }

  function avatar(m) {
    var av = doc.createElement('span');
    av.className = 'me-av';
    av.setAttribute('aria-hidden', 'true');
    var name = (m && m.display_name) || (current && current.user.email) || '';
    var url = m && m.avatar_url;
    if (url && /^https:\/\//.test(url)) {
      var img = doc.createElement('img');
      img.alt = ''; img.src = url; img.referrerPolicy = 'no-referrer'; img.decoding = 'async';
      img.addEventListener('error', function () { av.textContent = initial(name); });
      av.appendChild(img);
    } else {
      av.textContent = initial(name);
    }
    return av;
  }

  function signedInChip(m) {
    var wrap = doc.createElement('div');
    wrap.className = MAIN_ACCOUNT ? 'me-wrap site-account-slot' : 'me-wrap';
    wrap.id = 'me';
    var name = (m && m.display_name) || 'account';
    btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'chip me in';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'me-menu');
    btn.setAttribute('aria-label', 'Account menu for ' + name);
    btn.appendChild(avatar(m));
    var label = doc.createElement('span');
    label.className = 'me-name';
    label.textContent = name;
    btn.appendChild(label);

    menu = doc.createElement('div');
    menu.className = 'me-menu';
    menu.id = 'me-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Account');
    menu.hidden = true;
    var head = doc.createElement('div');
    head.className = 'me-head';
    var b = doc.createElement('b'); b.textContent = name;
    var e = doc.createElement('span'); e.textContent = (current && current.user.email) || '';
    head.appendChild(b); head.appendChild(e);
    menu.appendChild(head);
    (ownerRole ? MENU.concat([{label:'Owner console',href:'admin.html'}]) : MENU).forEach(function (it) {
      var a = doc.createElement('a');
      a.setAttribute('role', 'menuitem');
      a.href = (MAIN_ACCOUNT && root.location.pathname.indexOf('/ar/') >= 0 ? '../' : '') + (typeof it.href === 'function' ? it.href(m) : it.href);
      a.textContent = it.label;
      menu.appendChild(a);
    });
    var out = doc.createElement('button');
    out.type = 'button';
    out.setAttribute('role', 'menuitem');
    out.className = 'me-out';
    out.textContent = 'sign out';
    out.addEventListener('click', function () {
      closeMenu(false);
      FG.sb.auth.signOut().then(function () {
        if (root.location.pathname.split('/').pop() !== ACCOUNT) root.location.reload();
      });
    });
    menu.appendChild(out);

    btn.addEventListener('click', function () { if (menu.hidden) openMenu(); else closeMenu(true); });
    btn.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); openMenu(); }
    });
    menu.addEventListener('keydown', function (ev) {
      var list = items(), i = list.indexOf(doc.activeElement);
      if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(true); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (ev.key === 'Home') { ev.preventDefault(); list[0].focus(); }
      else if (ev.key === 'End') { ev.preventDefault(); list[list.length - 1].focus(); }
      else if (ev.key === 'Tab') { closeMenu(false); }
    });
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  // Menu entries. Pages that are not live yet are added here when they ship.
  var MENU = [
    { label: 'my profile', href: function (m) { return m && m.display_name ? (MAIN_ACCOUNT ? 'profile.html' : 'forgeeks-profile.html') + '?u=' + encodeURIComponent(m.display_name) : ACCOUNT; } },
    { label: 'tasks', href: 'forgeeks-tasks.html' },
    { label: MAIN_ACCOUNT ? 'Marketplace' : 'market', href: MAIN_ACCOUNT ? 'marketplace.html' : 'forgeeks-market.html' },
    { label: 'community stories', href: 'stories.html' },
    { label: 'top up wallet', href: 'topup.html' },
    { label: 'leaderboard', href: MAIN_ACCOUNT ? 'leaderboard.html' : 'forgeeks-leaderboard.html' },
    { label: 'profile settings', href: ACCOUNT }
  ];
  // The looks you own, one tap from the account menu (the main site only; For Geeks equips from its market).
  if (MAIN_ACCOUNT) MENU.splice(3, 0, { label: 'my collection', href: 'collection.html' });
  FG.menu = MENU;

  function render(m) {
    if(m && current && m.user_id && m.user_id !== current.user.id) return;
    slot = doc.getElementById('me');
    if (!slot) return;
    var next = current ? signedInChip(m) : signedOutChip();
    slot.replaceWith(next);
  }

  doc.addEventListener('click', function (ev) {
    if (menu && !menu.hidden && !ev.target.closest('#me')) closeMenu(false);
  });

  function emit(s) {
    listeners.slice().forEach(function (fn) { try { fn(s); } catch (e) { root.console && console.error(e); } });
  }

  function init() {
    if (!cfg || !root.supabase || !root.supabase.createClient) { resolveReady({ session: null }); return; }
    FG.sb = root.supabase.createClient(cfg.supabaseUrl, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
    FG.available = true;
    var first = true;
    FG.sb.auth.onAuthStateChange(function (event, s) {
      var before = current && current.user.id;
      current = s;
      // Supabase advises against awaiting other calls inside this callback, so hand off on the next tick.
      root.setTimeout(function () {
        if (first) { first = false; resolveReady({ session: s }); }
        var changed = before !== (s && s.user.id);
        // Token refreshes and the repeat SIGNED_IN on returning to a tab change nothing on screen.
        if (event === 'INITIAL_SESSION' || changed || event === 'USER_UPDATED') {
          if (changed) { meCache = null; ownerRole = false; roleFor = null; }
          if (s) {
            FG.me().then(render);
            if (roleFor !== s.user.id && typeof FG.sb.rpc === 'function') {
              roleFor = s.user.id;
              (function (uid) { Promise.resolve(FG.sb.rpc('is_admin')).then(function(r) {
                if (!current || current.user.id !== uid || roleFor !== uid) return;
                ownerRole = !!r && !r.error && r.data === true;
                Promise.resolve(FG.me()).then(function(m) { if (current && current.user.id === uid && roleFor === uid) render(m); });
              }, function () {}); })(s.user.id);
            }
          } else render(null);
        }
        if (changed && event !== 'INITIAL_SESSION') emit(s);
      }, 0);
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
