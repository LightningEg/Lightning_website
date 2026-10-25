// Main-site banner strip (account, marketplace): shows the banner the signed-in member has equipped.
// Reads their own equipped_items row (row-level security) and follows the market's lightning:banner event.
(function () {
  'use strict';
  var FG = window.FG, doc = document;
  var strip = doc.querySelector('[data-banner-strip]');
  if (!FG || !strip) return;
  var ID = /^banner-[a-z0-9-]{1,40}$/;
  function show(id) {
    var ok = typeof id === 'string' && ID.test(id);
    strip.hidden = !ok;
    if (ok) strip.setAttribute('data-item', id); else strip.removeAttribute('data-item');
  }
  doc.addEventListener('lightning:banner', function (e) { show(e.detail); });
  function load(session) {
    if (!session || !FG.sb) { show(null); return; }
    Promise.resolve(FG.sb.from('equipped_items').select('item_id').eq('slot', 'banner').maybeSingle())
      .then(function (r) { show(r && !r.error && r.data ? r.data.item_id : null); }, function () { show(null); });
  }
  FG.ready.then(function (r) { load(r && r.session); }).catch(function () {});
  FG.onAuth(load);
})();
