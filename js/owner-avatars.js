/* Owner console, Members view: take down a profile picture that breaks the rules (admin.html #admin-avatar-form).
   admin_remove_avatar() (supabase/migrations/20261027110000_profile_pictures.sql) clears the member's link at once so
   it shows nowhere, keeps the reason in the audit log and returns the member's id; this file then deletes the file
   through Storage, which only an administrator may do for someone else. The member can upload another picture. */
(function () {
  'use strict';
  var doc = document, FG = window.FG;
  var form = doc.getElementById('admin-avatar-form'), out = doc.getElementById('admin-avatar-status');
  if (!form || !out || !FG) return;
  function say(e) { return FG.say ? FG.say(e) : (e && e.message) || 'Could not complete this.'; }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var button = form.querySelector('button[type=submit]'), email = form.elements.email.value.trim(), reason = form.elements.reason.value.trim();
    button.disabled = true; out.textContent = '';
    Promise.resolve(FG.sb.rpc('admin_remove_avatar', { p_email: email, p_reason: reason })).then(function (r) {
      if (r.error) throw r.error;
      var path = r.data;
      if (path === null) { form.reset(); out.textContent = 'The link is cleared. This member had no uploaded file to delete.'; return; }
      if (typeof path !== 'string' || !/^[0-9a-f]{32}\/avatar$/.test(path)) throw new Error('The server did not answer as expected.');
      return Promise.resolve(FG.sb.storage.from('avatars').remove([path])).then(function (gone) {
        form.reset();
        out.textContent = gone && gone.error
          ? 'The picture is hidden everywhere. The file itself could not be deleted: ' + say(gone.error)
          : 'Picture removed. The member can upload another.';
      });
    }).catch(function (e) { out.textContent = say(e); })
      .then(function () { button.disabled = false; });
  });
})();
