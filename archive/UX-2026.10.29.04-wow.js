// The wow moment (home UX-2026.10.06.05, test.html): the places Mohab keeps money pour into one figure.
// Each money tile, as it scrolls up to the sticky "In your accounts" card, shrinks into it and its amount
// is added; scrolling back takes it out again. GSAP + ScrollTrigger, hosted here in js/vendor/ and fetched
// only once the page has loaded. <body data-wow-always> (the home page, owner's choice 2026-10-06, and
// test.html) plays it even with reduce motion on; any other page skips it then and downloads nothing.
// Without it, the card shows the total and the tiles stay still. The line shown once every tile has landed is the
// counter's data-t-done (home: nine places since UX-2026.10.21; three named and six more in one tile since 2026-10-29); pages without it keep the six-places line.
(() => {
  const here = document.currentScript.src; // vendor/ sits beside this file, also for ar/ pages
  const ar = document.documentElement.lang.startsWith('ar');
  const stage = document.querySelector('.t-stage');
  // Search and AI crawlers read the page as written: no counting from zero, nothing hidden, no library.
  if (/bot|crawl|spider|slurp|inspectiontool|bingpreview|facebookexternalhit/i.test(navigator.userAgent)) return;
  if (!stage || (matchMedia('(prefers-reduced-motion: reduce)').matches && !('wowAlways' in document.body.dataset))) return;
  const load = src => new Promise((ok, fail) => {
    const script = Object.assign(document.createElement('script'), {src, onload: ok, onerror: fail});
    document.head.append(script);
  });
  const start = () => load(new URL('../js/vendor/gsap.min.js?v=3.15.0', here).href)
    .then(() => load(new URL('../js/vendor/ScrollTrigger.min.js?v=3.15.0', here).href)).then(play, () => {});
  if (document.readyState === 'complete') start(); else addEventListener('load', start, {once: true});

  function play() {
  const {gsap, ScrollTrigger} = window;
  gsap.registerPlugin(ScrollTrigger);
  stage.classList.add('is-live');
  const counter = stage.querySelector('.t-count');
  const sumEl = counter.querySelector('[data-t-sum]'), line = counter.querySelector('[data-t-line]');
  const bar = document.querySelector('.d-bar');
  const format = new Intl.NumberFormat(ar ? 'ar-EG' : 'en-EG', {maximumFractionDigits: 0});
  const tiles = [...stage.querySelectorAll('.kpi')].map(el => ({
    el, p: 0,
    name: el.querySelector('.lbl').textContent,
    value: Number(el.querySelector('.fig').firstChild.textContent.replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632).replace(/[^0-9]/g, '')),
  }));
  const top = () => (bar ? bar.offsetHeight : 0) + 10;
  const land = () => top() + counter.offsetHeight; // the counter's lower edge once it sticks
  const setTop = () => stage.style.setProperty('--t-top', `${top()}px`);
  setTop();
  ScrollTrigger.addEventListener('refreshInit', setTop);

  const first = line.textContent; // 'The seven places, in EGP', as the page wrote it
  const all = counter.dataset.tDone || (ar ? 'الست أماكن، محسوبين كأنهم واحد' : 'All six places, counted as one');
  let landed = -1;
  const paint = () => {
    // Before the first tile moves the sum is 0, and a sticky "0 EGP" reads as a broken page: show a dash (2026-10-29)
    const sum = Math.round(tiles.reduce((total, t) => total + t.value * t.p, 0));
    sumEl.textContent = sum ? format.format(sum) : '—';
    const done = tiles.filter(t => t.p >= 1);
    if (done.length === landed) return;
    const last = done[done.length - 1];
    line.textContent = !last ? first
      : done.length === tiles.length ? all
      : `+${format.format(last.value)} · ${last.name}`;
    if (done.length > landed && landed >= 0) gsap.fromTo(counter, {scale: 1.03}, {scale: 1, duration: .4, ease: 'back.out(3)'});
    landed = done.length;
  };

  // Paced so the eye can follow: each tile takes 420px of scroll to fly in, the figure trails the scroll
  // by about a second, and tiles side by side go one after another, left to right, 160px of scroll apart.
  // On a phone (one or two columns) the rows sit closer than 420px, so tiles from several rows flew at once,
  // crossed to the middle and piled over each other: there each tile rises straight up its own column, faster.
  const row = el => tiles.filter(t => t.el.offsetTop === el.offsetTop);
  const narrow = () => row(tiles[0].el).length < 3;
  const DISTANCE = () => (narrow() ? 200 : 420), APART = () => (narrow() ? 80 : 160);
  const lead = el => APART() * row(el).filter(t => t.el.offsetLeft > el.offsetLeft).length; // left goes first
  tiles.forEach(t => {
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: t.el, scrub: 1.2, invalidateOnRefresh: true,
        start: () => `top ${land() + lead(t.el) + DISTANCE()}px`, end: () => `top ${land() + lead(t.el)}px`,
      },
      onUpdate() { t.p = this.progress(); paint(); },
    });
    tl.to(t.el, {
      x: () => (narrow() ? 0 : counter.offsetLeft + counter.offsetWidth / 2 - (t.el.offsetLeft + t.el.offsetWidth / 2)),
      y: () => -(lead(t.el) + 50), scale: .3, ease: 'power1.in', transformOrigin: '50% 0',
    }, 0).to(t.el, {opacity: 0, ease: 'power3.in'}, 0);
  });
  paint();
  }
})();
