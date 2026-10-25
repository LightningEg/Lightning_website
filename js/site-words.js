// Main-site words (guideline B04, B10): the account, leaderboard and profile forms are shared with For Geeks, whose UI
// words are lower case like commands (D10). On a main-site page their headings, labels and buttons start with a capital,
// like every other Part B page. Only the first letter of an element's first text changes; emails and addresses never do.
(function () {
  'use strict';
  var doc = document;
  if (!doc.body || !doc.body.dataset.mainStore) return;
  var SEL = 'main h1,main h2,main h3,main h4,main button,main summary,main legend,main dt,main th,main label,main .btn,main .chip,main .lb-tab,main .pf-ranks li,main .mkt-tag,main .mkt-state,main option,dialog h2,dialog button,dialog label';
  var SKIP = /@|:\/\/|\.(com|html|eg)\b/;
  function fix(el) {
    if (el.closest('.pv,[contenteditable]')) return;
    var w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      var t = n.nodeValue;
      if (!t.trim()) continue;
      var m = /^(\s*)([a-z])/.exec(t);
      if (m && !SKIP.test(t)) n.nodeValue = m[1] + m[2].toUpperCase() + t.slice(m[0].length);
      return;
    }
  }
  function all() { Array.prototype.forEach.call(doc.querySelectorAll(SEL), fix); }
  var queued = false;
  function soon() { if (queued) return; queued = true; (window.requestAnimationFrame || setTimeout)(function () { queued = false; all(); }); }
  all();
  if (window.MutationObserver) new MutationObserver(soon).observe(doc.body, { childList: true, subtree: true, characterData: true });
})();
