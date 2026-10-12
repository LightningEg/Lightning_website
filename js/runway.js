// The runway: a dot rides along the cash line. GSAP + ScrollTrigger from js/vendor/.
// Plays on its own in about 2 s when it scrolls into view and resets when you scroll back above it; small motion, so it also plays with reduced motion on (README).
// Illustrative path between two real month ends (184,976 at 2026-09 and 165,937 at 2026-11); events carry no amounts.
(() => {
  const root = document.querySelector('[data-runway]');
  if (!root) return;
  const here = document.currentScript.src;
  const load = f => new Promise((ok, no) => { const s = document.createElement('script'); s.src = new URL('vendor/' + f, here).href; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  load('gsap.min.js?v=3.15.0').then(() => load('ScrollTrigger.min.js?v=3.15.0')).then(run, () => {});
  function run() {
    const {gsap, ScrollTrigger} = window; gsap.registerPlugin(ScrollTrigger);
    const line = root.querySelector('.rw-line'), area = root.querySelector('.rw-area'), dot = root.querySelector('.rw-dot');
    const fig = root.querySelector('.rw-fig b'), cap = root.querySelector('.rw-cap'), safe = root.querySelector('.rw-safe');
    const lows = root.querySelectorAll('.rw-low,.rw-lowdot'), items = [...root.querySelectorAll('.rw-events li')];
    const len = line.getTotalLength(), LOW = 0.74, FROM = 184976, TO = 165937;
    root.classList.add('is-live');
    line.style.strokeDasharray = len;
    const fmt = n => Math.round(n).toLocaleString(document.documentElement.lang.startsWith('ar') ? 'ar-EG' : 'en-US');
    const set = p => {
      const at = Math.min(p / LOW, 1), t = Math.min(p / LOW, 1);
      line.style.strokeDashoffset = len * (1 - Math.min(p / 0.95, 1));
      const pt = line.getPointAtLength(len * Math.min(p / 0.95, 1));
      dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
      area.style.clipPath = `inset(0 ${100 - (pt.x / 800) * 100}% 0 0)`;
      const e = 1 - Math.pow(1 - t, 2);
      fig.textContent = fmt(FROM + (TO - FROM) * e);
      items.forEach((li, i) => li.classList.toggle('on', p > 0.12 + i * 0.17));
      cap.textContent = p >= LOW ? cap.dataset.low : cap.dataset.go;
      lows.forEach(n => n.classList.toggle('on', p >= LOW));
      safe.classList.toggle('on', p >= LOW + 0.1);
    };
    set(0);
    // Plays by itself in about 2 seconds when the section comes into view; scrolling back above it resets it to play again.
    const state = {p: 0};
    const tween = gsap.to(state, {p: 1, duration: 2.2, ease: 'power1.inOut', paused: true, onUpdate: () => set(state.p)});
    const play = () => { tween.restart(); };
    const reset = () => { tween.pause(0); set(0); };
    ScrollTrigger.create({trigger: root, start: 'top 72%', end: 'bottom top', onEnter: play, onEnterBack: play, onLeaveBack: reset});
  }
})();
