/* For Geeks account page: download your data, delete your account (supabase/migrations/…_account_lifecycle.sql).
   Uses the shared client from js/forgeeks-auth.js. */
(function (root) {
  'use strict';
  var PHRASE = 'delete my account';

  function fileName(now) {
    var day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(now || Date.now()));
    return 'lightning-geeks-data-' + day + '.json';
  }
  function confirmed(text) { return String(text || '').trim().toLowerCase() === PHRASE; }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { fileName: fileName, confirmed: confirmed, PHRASE: PHRASE }; return; }

  var doc = root.document, FG = root.FG;
  var $ = function (id) { return doc.getElementById(id); };
  function flash(id, s, bad) { var el = $(id); el.textContent = s; el.className = 'acct-status' + (bad ? ' bad' : ''); }

  async function download() {
    var uid = FG.session() && FG.session().user.id;
    var btn = $('data-download');
    btn.disabled = true;
    flash('status-data', 'preparing…');
    var r;
    try { r = await FG.sb.rpc('export_my_data'); } catch (error) { r = {error:error}; }
    if (!FG.session() || FG.session().user.id !== uid) { btn.disabled = false; return; }
    btn.disabled = false;
    if (r.error) { flash('status-data', FG.say(r.error), true); return; }
    var blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
    var a = doc.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    doc.body.appendChild(a);
    a.click();
    a.remove();
    root.setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    flash('status-data', 'downloaded');
  }

  async function del(ev) {
    ev.preventDefault();
    var form = ev.target, btn = form.querySelector('button[type=submit]');
    if (!confirmed(form.elements.confirm.value)) { flash('status-delete', 'Type "' + PHRASE + '" to confirm.', true); return; }
    btn.disabled = true;
    var uid = FG.session() && FG.session().user.id;
    var r;
    try { r = await FG.sb.functions.invoke('delete-account', { body: { p_confirm: PHRASE } }); }
    catch (error) { r = { error: error }; }
    if (!FG.session() || FG.session().user.id !== uid) { btn.disabled = false; return; }
    if (r.error && r.error.context && typeof r.error.context.json === 'function') {
      try { var detail = await r.error.context.json(); if (detail.error) r.error = { message: detail.error }; } catch (_) {}
    }
    if (!r.error && r.data && r.data.error) r.error = { message: r.data.error };
    if (!r.error && (!r.data || r.data.deleted !== true)) r.error = { message: 'Account deletion did not complete. Please retry.' };
    if (r.error) {
      btn.disabled = false;
      flash('status-delete', /administrator/i.test(r.error.message || '') ? 'The owner account cannot be deleted here.' : FG.say(r.error), true);
      return;
    }
    // The account no longer exists, so only the copy in this browser needs clearing.
    await FG.sb.auth.signOut({ scope: 'local' });
    form.reset();
    var msg = $('acct-msg');
    msg.textContent = 'Your account is deleted. Thank you for building with us.';
    msg.className = 'acct-msg ok';
    msg.hidden = false;
  }

  function init() {
    if (!FG || !FG.sb || !$('your-data')) return;
    $('data-download').addEventListener('click', download);
    $('form-delete').addEventListener('submit', del);
    $('delete-cancel-preparation').addEventListener('click', async function () {
      try { var r = await FG.sb.rpc('cancel_account_deletion'); if (r.error) throw r.error; flash('status-delete', 'Deletion preparation cancelled. Any receipt files already removed cannot be restored.'); }
      catch (e) { flash('status-delete', FG.say(e), true); }
    });
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
