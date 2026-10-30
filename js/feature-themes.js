/* Features › App themes: each app theme on sale, drawn as the PC app's Overview in its own palette, with a link to the
   marketplace. Illustration only: the palettes come from cosmetics/<id>.json (checked hexes, through
   LightningPreview.clean), the figures are Mohab's sample year as fixed words, and nothing here buys or equips. */
(function (root) {
  'use strict';
  var doc = root.document, PV = root.LightningPreview;
  var AR = /^ar/.test(doc.documentElement.lang || '');
  var THEMES = [
    { id: 'dendera', ar: 'دندرة', line: 'Temple pigments on aged papyrus by day, the star ceiling by night.', arLine: 'ألوان المعبد على بردي قديم بالنهار، وسقف النجوم بالليل.' },
    { id: 'papyrus', ar: 'بردي', line: 'Lapis lacquer and gold foil over papyrus fibres.', arLine: 'لازورد ورقائق دهب فوق ألياف البردي.' },
    { id: 'cotton', ar: 'قطن', line: 'Warm paper and linen, embossed terracotta, ink tabs.', arLine: 'ورق وكتان دافيين، وطين محروق بارز، وعلامات حبر.' },
    { id: 'nile', ar: 'النيل', line: 'Nile night and gold, on every screen you use.', arLine: 'ليل النيل والدهب، على كل شاشة بتستعملها.' }
  ];
  var list = doc.getElementById('themes-list');
  var base = (list && list.getAttribute('data-base')) || '';
  if (!list || !PV || !root.fetch) return;
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  Promise.all(THEMES.map(function (t) {
    return root.fetch(base + 'cosmetics/' + t.id + '.json').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { return m && m.parts && m.parts.palette ? { t: t, m: m } : null; }, function () { return null; });
  })).then(function (found) {
    found.filter(Boolean).forEach(function (f) {
      var card = el('a', 'ft-card');
      card.href = base + 'marketplace.html';
      var pv = el('div', 'ft-pv');
      pv.appendChild(PV.pc(PV.clean(Object.assign({}, PV.DEFAULT, f.m.parts.palette))));
      card.appendChild(pv);
      card.appendChild(el('h3', 'ft-name', AR ? f.t.ar : f.m.name));
      card.appendChild(el('p', 'ft-line', AR ? f.t.arLine : f.t.line));
      list.appendChild(card);
    });
    list.closest('section').hidden = !list.children.length;
  });
})(window);
