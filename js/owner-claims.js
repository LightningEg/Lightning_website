/* Owner console, Members view: a member's claimed app profiles (admin.html #admin-claims-form). A theme's seat is burned
   when a profile claims it, so this is how support frees one for a member who lost the device or profile. Reads
   admin_profile_claims() and frees one with admin_release_profile_claim() (supabase/migrations/20261027130000_profile_seats.sql,
   MFA administrators only); the reason is kept in the audit log. Names and dates are set with textContent. */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var form = doc.getElementById('admin-claims-form'), list = doc.getElementById('admin-claims-list'), out = doc.getElementById('admin-claims-status');
  if (!form || !list || !out || !FG) return;
  function say(e) { return FG.say ? FG.say(e) : (e && e.message) || 'Could not complete this.'; }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function draw(rows) {
    list.textContent = '';
    if (!rows.length) { list.appendChild(el('p', 'ops-empty', 'No profile has claimed a theme for this member.')); return; }
    var ul = el('ul', 'oc-claims');
    rows.forEach(function (c) {
      var li = el('li');
      li.appendChild(el('span', null, c.name + ' · claimed ' + String(c.claimed_at).slice(0, 10) + ' · ' + c.seats + (c.seats === 1 ? ' seat' : ' seats')));
      var b = el('button', 'btn ghost', 'Free this seat'); b.type = 'button';
      b.setAttribute('aria-label', 'Free the seat of the ' + c.name + ' claim from ' + String(c.claimed_at).slice(0, 10));
      b.addEventListener('click', function () { release(c, b); });
      li.appendChild(b); ul.appendChild(li);
    });
    list.appendChild(ul);
  }
  function show() {
    var email = form.elements.email.value.trim();
    return Promise.resolve(FG.sb.rpc('admin_profile_claims', { p_email: email })).then(function (r) {
      if (r.error) throw r.error;
      draw(Array.isArray(r.data) ? r.data : []);
    });
  }
  function release(c, b) {
    var reason = form.elements.reason.value.trim();
    if (reason.length < 5) { out.textContent = 'Give a reason of at least 5 characters first.'; form.elements.reason.focus(); return; }
    b.disabled = true; out.textContent = '';
    Promise.resolve(FG.sb.rpc('admin_release_profile_claim', { p_claim_id: c.id, p_reason: reason })).then(function (r) {
      if (r.error) throw r.error;
      out.textContent = 'Seat freed. The member can claim it with another profile.';
      return show();
    }).catch(function (e) { out.textContent = say(e); b.disabled = false; });
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault(); out.textContent = '';
    show().catch(function (e) { list.textContent = ''; out.textContent = say(e); });
  });
})();
