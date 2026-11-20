// Features explorer (Features, 2026-10-27): six questions as tabs, one real screen each.
// Without JavaScript every panel shows, stacked. Arrow keys move between tabs and mirror in Arabic.
// A link into the list below ("#budget") opens that group, so nothing on the page is a dead end.
(function () {
  'use strict';
  var list = document.querySelector('.fx-tabs');
  if (list) {
    var tabs = [].slice.call(list.querySelectorAll('[role="tab"]'));
    var rtl = document.documentElement.dir === 'rtl';
    document.documentElement.classList.add('fx-js');
    var pick = function (t, focus) {
      tabs.forEach(function (x) {
        var on = x === t;
        x.setAttribute('aria-selected', on ? 'true' : 'false');
        x.tabIndex = on ? 0 : -1;
        var p = document.getElementById(x.getAttribute('aria-controls'));
        if (on) p.removeAttribute('data-fx-hidden'); else p.setAttribute('data-fx-hidden', '');
      });
      if (focus) t.focus();
    };
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { pick(t); });
      t.addEventListener('keydown', function (e) {
        var step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
        var n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : step ? (i + step + tabs.length) % tabs.length : -1;
        if (n < 0) return;
        e.preventDefault();
        pick(tabs[n], true);
      });
    });
  }
  var open = function () {
    var id = location.hash.slice(1);
    var d = id && document.getElementById(id);
    if (d && d.tagName === 'DETAILS') d.open = true;
  };
  window.addEventListener('hashchange', open);
  open();
})();
