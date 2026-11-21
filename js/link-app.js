/* Account page: "Link the app" (app NF-10H6, supabase/migrations/20261121120000_link_app_profile.sql). Issues a one-time
   code the Lightning app on a PC pastes in Settings › Appearance; the store then adds every theme a Google Play purchase
   unlocked on that profile to this account, owned through Play. Only this response holds the code. */
(function (root) {
  'use strict';
  var doc = root.document, FG = root.FG;
  if (!FG || !doc.getElementById('link-app-code')) return;
  var $ = function (id) { return doc.getElementById(id); };
  var SHAPE = /^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/;
  function flash(s, bad) { var el = $('status-link'); el.textContent = s; el.className = 'acct-status' + (bad ? ' bad' : ''); }

  async function issue() {
    var uid = FG.session() && FG.session().user.id, btn = $('link-app-code');
    if (!uid) return;
    btn.disabled = true; flash('making a code…');
    var r;
    try { r = await FG.sb.rpc('issue_profile_link_code'); } catch (error) { r = { error: error }; }
    btn.disabled = false;
    if (!FG.session() || FG.session().user.id !== uid) return;
    if (r.error || !r.data || !SHAPE.test(String(r.data.code || ''))) { flash('Could not make a code. Try again in a moment.', true); return; }
    var input = $('link-app-value');
    input.value = r.data.code; $('link-app-box').hidden = false; input.focus(); input.select();
    try { await root.navigator.clipboard.writeText(r.data.code); flash('copied. Paste it in the app within ten minutes.'); }
    catch (e) { flash('Copy it and paste it in the app within ten minutes.'); }
  }
  $('link-app-code').addEventListener('click', issue);
  FG.onAuth(function () { $('link-app-value').value = ''; $('link-app-box').hidden = true; flash(''); });
})(window);
