/* For Geeks account page (forgeeks-account.html): sign in, sign up, reset, profile, links.
   Talks to Supabase with the publishable key only. Every write goes through a column the database
   lets a member change (supabase/migrations). Member text is only ever shown with textContent.
   The rules in `rules` are also tested in supabase/tests/account.test.mjs. */
(function (root) {
  'use strict';

  /* ---------- rules: pure, no DOM ---------- */
  var HTTPS = /^https:\/\/[^\s<>"']{1,290}$/;
  var PHONE = /^\+?[0-9 ()-]{6,24}$/;
  var VIS = ['private', 'members', 'public'];

  function text(s) { return typeof s === 'string' ? s.trim() : ''; }
  function orNull(s) { s = text(s); return s === '' ? null : s; }

  function ageOn(dob, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || '');
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    now = now || new Date();
    var age = now.getUTCFullYear() - y;
    if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
    return age;
  }

  function list(s, label) {
    var parts = text(s).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!parts.length) return { value: null };
    if (parts.length > 20) return { error: label + ': at most 20 items' };
    for (var i = 0; i < parts.length; i++) if (parts[i].length > 40) return { error: label + ': each item up to 40 characters' };
    return { value: parts };
  }

  function url(s, label) {
    var v = orNull(s);
    if (v === null) return { value: null };
    return HTTPS.test(v) ? { value: v } : { error: label + ' must start with https://' };
  }

  /* The public profile and setup form. `dob` is the saved birth date, used for the 18+ rule. */
  function memberUpdate(f, dob, now) {
    var name = text(f.display_name);
    if (name.length < 2 || name.length > 40) return { error: 'Display name: 2 to 40 characters' };
    if (/[@<>]/.test(name)) return { error: 'Display name cannot contain @, < or >' };
    var bio = text(f.bio);
    if (bio.length > 500) return { error: 'Bio: at most 500 characters' };
    if (VIS.indexOf(f.visibility) < 0) return { error: 'Choose who can see your profile' };
    var notes = text(f.setup_notes);
    if (notes.length > 500) return { error: 'Setup notes: at most 500 characters' };
    var out = {
      display_name: name, bio: bio || null, visibility: f.visibility,
      show_work: !!f.show_work, show_setup: !!f.show_setup, show_on_leaderboard: !!f.show_on_leaderboard,
      adult_confirmed: !!f.adult_confirmed, setup_notes: notes || null,
      setup_editor: orNull(f.setup_editor), setup_os: orNull(f.setup_os)
    };
    if ((out.setup_editor || '').length > 80 || (out.setup_os || '').length > 80) return { error: 'Editor and OS: at most 80 characters' };
    var parts = [['avatar_url', url(f.avatar_url, 'Avatar link')], ['dotfiles_url', url(f.dotfiles_url, 'Dotfiles link')],
                 ['portfolio_url', url(f.portfolio_url, 'Portfolio link')],
                 ['setup_languages', list(f.setup_languages, 'Languages')], ['setup_tools', list(f.setup_tools, 'Tools')]];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i][1].error) return { error: parts[i][1].error };
      out[parts[i][0]] = parts[i][1].value;
    }
    var age = ageOn(dob, now);
    var wantsPublic = out.visibility === 'public' || out.show_on_leaderboard;
    if (wantsPublic && !out.adult_confirmed) return { error: 'Confirm you are 18 or older to be public or on the leaderboard' };
    if (age !== null && age < 18 && (out.adult_confirmed || out.visibility !== 'private' || out.show_on_leaderboard)) {
      return { error: 'A profile for someone under 18 stays private' };
    }
    return { data: out };
  }

  /* The private details form: only you see these. */
  function privateUpdate(f, now) {
    var full = text(f.full_name);
    if (full.length > 120) return { error: 'Name: at most 120 characters' };
    var phone = orNull(f.phone);
    if (phone !== null && !PHONE.test(phone)) return { error: 'Phone: digits, spaces, + ( ) - only, 6 to 24 characters' };
    var dob = orNull(f.birth_date);
    if (dob !== null) {
      var age = ageOn(dob, now);
      if (age === null) return { error: 'Birth date: use yyyy-mm-dd' };
      if (age < 0 || age > 120) return { error: 'Birth date is out of range' };
    }
    return { data: { full_name: full || null, phone: phone, birth_date: dob, marketing_consent: !!f.marketing_consent } };
  }

  function linkUpdate(label, link) {
    label = text(label);
    if (label.length < 1 || label.length > 60) return { error: 'Link name: 1 to 60 characters' };
    var u = url(link, 'Link');
    if (u.error) return u;
    if (u.value === null) return { error: 'Link must start with https://' };
    return { data: { label: label, url: u.value } };
  }

  function credentials(email, password, mode) {
    email = text(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address' };
    if (mode === 'reset') return { data: { email: email } };
    if (mode === 'up' && (password || '').length < 8) return { error: 'Password: at least 8 characters' };
    if (!password) return { error: 'Enter your password' };
    return { data: { email: email, password: password } };
  }

  /* Plain words for errors: one wording for every page, kept in js/forgeeks-auth.js. */
  var shared = (typeof module !== 'undefined' && module.exports) ? require('./forgeeks-auth.js') : root.FG;
  function say(err) { return shared && shared.say ? shared.say(err) : 'Something went wrong. Try again.'; }

  var rules = { ageOn: ageOn, memberUpdate: memberUpdate, privateUpdate: privateUpdate, linkUpdate: linkUpdate, credentials: credentials, say: say };
  if (typeof module !== 'undefined' && module.exports) { module.exports = rules; return; }

  /* ---------- page ---------- */
  var doc = root.document;
  var $ = function (id) { return doc.getElementById(id); };
  var PAGE = root.location.origin + root.location.pathname;
  var NEXT_KEY = 'lightning-geeks-next';
  var sb, session, loadedUid = null, recovering = false, birthDate = null, mode = 'in';

  function show(view) {
    ['loading', 'out', 'recover', 'in'].forEach(function (v) { $('view-' + v).hidden = v !== view; });
  }
  function note(s, kind) {
    var el = $('acct-msg');
    el.textContent = s || '';
    el.hidden = !s;
    el.className = 'acct-msg' + (kind ? ' ' + kind : '');
  }
  function flash(id, s, bad) {
    var el = $(id);
    el.textContent = s;
    el.className = 'acct-status' + (bad ? ' bad' : '');
  }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); }
  function val(form, name) { var e = form.elements[name]; return e.type === 'checkbox' ? e.checked : e.value; }
  function fill(form, row) {
    Object.keys(row).forEach(function (k) {
      var e = form.elements[k];
      if (!e) return;
      var v = row[k];
      if (e.type === 'checkbox') e.checked = !!v;
      else e.value = Array.isArray(v) ? v.join(', ') : (v == null ? '' : v);
    });
  }
  function formData(form, names) {
    var o = {}; names.forEach(function (n) { o[n] = val(form, n); }); return o;
  }

  function setMode(m) {
    mode = m;
    var up = m === 'up';
    $('auth-title').textContent = up ? 'create an account' : 'sign in';
    $('auth-submit').textContent = up ? 'create account' : 'sign in';
    $('auth-switch').textContent = up ? 'I already have an account' : 'I need an account';
    $('auth-password').autocomplete = up ? 'new-password' : 'current-password';
    $('auth-hint').hidden = !up;
    $('auth-forgot').hidden = up;
    note('');
  }

  function readUrlError() {
    var h = new URLSearchParams(root.location.hash.replace(/^#/, ''));
    var s = new URLSearchParams(root.location.search);
    var e = h.get('error_description') || s.get('error_description');
    if (e) {
      note(/expired|invalid/i.test(e) ? 'That link has expired or was already used. Request a new one.' : 'Sign-in did not finish. Try again.', 'bad');
      root.history.replaceState(null, '', PAGE);
    }
  }

  async function loadAccount() {
    var uid = session.user.id;
    var res = await Promise.all([
      sb.from('profiles').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('member_profiles').select('*').eq('user_id', uid).maybeSingle(),
      sb.from('profile_links').select('id,label,url').eq('user_id', uid).order('id'),
      sb.from('wallets').select('balance,contribution_score').eq('user_id', uid).maybeSingle()
    ]);
    for (var i = 0; i < res.length; i++) if (res[i].error) { note(say(res[i].error), 'bad'); return; }
    var priv = res[0].data, pub = res[1].data;
    if (!priv || !pub) { note('Your account is not ready yet. Reload in a minute.', 'bad'); return; }
    birthDate = priv.birth_date;
    fill($('form-public'), pub);
    fill($('form-setup'), pub);
    fill($('form-private'), priv);
    $('who').textContent = session.user.email || '';
    var w = res[3].data || { balance: 0, contribution_score: 0 };
    $('coins').textContent = String(w.balance);
    $('score').textContent = String(w.contribution_score);
    renderLinks(res[2].data || []);
    syncVisibilityNote();
    if (recovering) return;
    show('in');
    loadedUid = uid;
  }

  function renderLinks(rows) {
    var ul = $('links-list');
    ul.textContent = '';
    $('links-empty').hidden = rows.length > 0;
    rows.forEach(function (r) {
      var li = doc.createElement('li');
      var a = doc.createElement('a');
      a.href = r.url; a.textContent = r.label; a.target = '_blank'; a.rel = 'noopener noreferrer';
      var b = doc.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = 'remove';
      b.setAttribute('aria-label', 'Remove link ' + r.label);
      b.addEventListener('click', async function () {
        busy(b, true);
        var d = await sb.from('profile_links').delete().eq('id', r.id);
        if (d.error) { flash('status-links', say(d.error), true); busy(b, false); return; }
        li.remove();
        $('links-empty').hidden = ul.children.length > 0;
        flash('status-links', 'removed');
      });
      li.appendChild(a); li.appendChild(b); ul.appendChild(li);
    });
  }

  function syncVisibilityNote() {
    var v = $('form-public').elements.visibility.value;
    $('vis-note').textContent = v === 'public' ? 'Anyone can see the parts you switch on below. Your email, phone, birth date and coins stay private.'
      : v === 'members' ? 'Only signed-in For Geeks members can see the parts you switch on below.'
      : 'Only you can see your profile. Nothing is shown to anyone else.';
  }

  async function savePublic(ev) {
    ev.preventDefault();
    var form = ev.target, btn = form.querySelector('button[type=submit]');
    var sid = form.id === 'form-setup' ? 'status-setup' : 'status-public';
    var all = formData($('form-public'), ['display_name', 'bio', 'avatar_url', 'visibility', 'adult_confirmed', 'show_on_leaderboard']);
    var setup = formData($('form-setup'), ['setup_editor', 'setup_os', 'setup_languages', 'setup_tools', 'setup_notes', 'dotfiles_url', 'portfolio_url', 'show_work', 'show_setup']);
    var r = memberUpdate(Object.assign({}, setup, all), birthDate);
    if (r.error) { flash(sid, r.error, true); return; }
    busy(btn, true);
    var u = await sb.from('member_profiles').update(r.data).eq('user_id', session.user.id);
    busy(btn, false);
    flash(sid, u.error ? say(u.error) : 'saved', !!u.error);
    if (!u.error && shared.refreshMe) shared.refreshMe();
  }

  async function savePrivate(ev) {
    ev.preventDefault();
    var form = ev.target, btn = form.querySelector('button[type=submit]');
    var r = privateUpdate(formData(form, ['full_name', 'phone', 'birth_date', 'marketing_consent']));
    if (r.error) { flash('status-private', r.error, true); return; }
    busy(btn, true);
    var u = await sb.from('profiles').update(r.data).eq('user_id', session.user.id);
    busy(btn, false);
    if (u.error) { flash('status-private', say(u.error), true); return; }
    birthDate = r.data.birth_date;
    flash('status-private', 'saved');
  }

  async function addLink(ev) {
    ev.preventDefault();
    var form = ev.target, btn = form.querySelector('button[type=submit]');
    var r = linkUpdate(val(form, 'label'), val(form, 'url'));
    if (r.error) { flash('status-links', r.error, true); return; }
    busy(btn, true);
    var ins = await sb.from('profile_links').insert(Object.assign({ user_id: session.user.id }, r.data));
    busy(btn, false);
    if (ins.error) { flash('status-links', say(ins.error), true); return; }
    form.reset();
    var l = await sb.from('profile_links').select('id,label,url').eq('user_id', session.user.id).order('id');
    renderLinks(l.data || []);
    flash('status-links', 'added');
  }

  async function submitAuth(ev) {
    ev.preventDefault();
    var form = ev.target, btn = $('auth-submit');
    var r = credentials(val(form, 'email'), val(form, 'password'), mode);
    if (r.error) { note(r.error, 'bad'); return; }
    busy(btn, true); note('');
    var out;
    if (mode === 'up') out = await sb.auth.signUp({ email: r.data.email, password: r.data.password, options: { emailRedirectTo: PAGE } });
    else out = await sb.auth.signInWithPassword(r.data);
    busy(btn, false);
    if (out.error) { note(say(out.error), 'bad'); return; }
    if (mode === 'up' && !out.data.session) {
      form.reset();
      note('Check your inbox. Open the link we sent, then sign in here.', 'ok');
    }
  }

  async function google() {
    note('');
    var out = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: PAGE } });
    if (out.error) note(say(out.error), 'bad');
  }

  async function forgot() {
    var r = credentials($('auth-email').value, '', 'reset');
    if (r.error) { note('Enter your email above first.', 'bad'); return; }
    var out = await sb.auth.resetPasswordForEmail(r.data.email, { redirectTo: PAGE });
    if (out.error) { note(say(out.error), 'bad'); return; }
    note('If that email has an account, a reset link is on its way.', 'ok');
  }

  async function newPassword(ev) {
    ev.preventDefault();
    var form = ev.target, pw = val(form, 'password');
    if (pw.length < 8) { note('Password: at least 8 characters', 'bad'); return; }
    var out = await sb.auth.updateUser({ password: pw });
    if (out.error) { note(say(out.error), 'bad'); return; }
    form.reset();
    recovering = false;
    note('Password changed.', 'ok');
    if (session) loadAccount();
  }

  async function signOut() {
    await sb.auth.signOut();
    loadedUid = null;
    show('out');
    note('Signed out.', 'ok');
  }

  /* After signing in, go back to the For Geeks page that sent you here (?next=, kept across the Google round trip). */
  function store(k, v) { try { if (v == null) root.sessionStorage.removeItem(k); else root.sessionStorage.setItem(k, v); } catch (_) {} }
  function stored(k) { try { return root.sessionStorage.getItem(k); } catch (_) { return null; } }
  function keepNext() {
    var q = new URLSearchParams(root.location.search);
    var next = shared.safeNext ? shared.safeNext(q.get('next')) : null;
    if (next) { store(NEXT_KEY, next); q.delete('next'); var rest = q.toString(); root.history.replaceState(null, '', PAGE + (rest ? '?' + rest : '') + root.location.hash); }
    else if (!q.has('code')) store(NEXT_KEY, null);
  }
  function goNext() {
    var next = shared.safeNext ? shared.safeNext(stored(NEXT_KEY)) : null;
    store(NEXT_KEY, null);
    if (next) { root.location.replace(next); return true; }
    return false;
  }

  function init() {
    sb = shared && shared.sb;
    if (!sb) { show('out'); note('Sign-in is not available right now.', 'bad'); return; }
    keepNext();
    readUrlError();
    $('auth-form').addEventListener('submit', submitAuth);
    $('auth-switch').addEventListener('click', function () { setMode(mode === 'up' ? 'in' : 'up'); });
    $('auth-google').addEventListener('click', google);
    $('auth-forgot').addEventListener('click', forgot);
    $('recover-form').addEventListener('submit', newPassword);
    $('form-public').addEventListener('submit', savePublic);
    $('form-setup').addEventListener('submit', savePublic);
    $('form-private').addEventListener('submit', savePrivate);
    $('form-link').addEventListener('submit', addLink);
    $('form-public').elements.visibility.addEventListener('change', syncVisibilityNote);
    $('sign-out').addEventListener('click', signOut);
    setMode(new URLSearchParams(root.location.search).get('signup') === '1' ? 'up' : 'in');
    // Supabase advises not to call it from inside this callback, so hand off on the next tick.
    sb.auth.onAuthStateChange(function (event, s) {
      session = s;
      root.setTimeout(function () {
        if (event === 'PASSWORD_RECOVERY') { recovering = true; show('recover'); return; }
        if (!s) { recovering = false; loadedUid = null; show('out'); return; }
        if (recovering) return;
        if (goNext()) return;
        // Returning to the tab fires SIGNED_IN again: keep the form as it is so nothing typed is lost.
        if (loadedUid === s.user.id) return;
        loadAccount();
      }, 0);
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
