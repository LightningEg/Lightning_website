/* For Geeks roadmap: filter the items by stack. Items with no stack (the finished ones and the open-source workflow lane) show under "all". */
(function () {
  var box = document.querySelector('.stack-filter'); if (!box) return;
  var items = document.querySelectorAll('.items li');
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-stack]'); if (!b) return;
    var want = b.getAttribute('data-stack');
    box.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    items.forEach(function (li) {
      var st = (li.getAttribute('data-stack') || '').split(' ');
      li.hidden = want !== 'all' && st.indexOf(want) < 0;
    });
  });
})();
