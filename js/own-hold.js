// Own versus hold (Home): when the card is in view, one 100,000 balance splits in three steps (someone else's,
// still owed, yours) and the figure rolls down to what is yours. It ends on the page's own text; it resets once the
// whole scene leaves the screen, so it plays again. Small motion: it plays with reduce motion on (owner's rule).
(() => {
  const root = document.querySelector('[data-oh]');
  if (!root || !('IntersectionObserver' in window)) return;
  const card = root.querySelector('.oh-card'), fig = root.querySelector('[data-oh-fig]'), lbl = root.querySelector('[data-oh-lbl]');
  const FROM = Number(fig.dataset.from), MID = Number(fig.dataset.mid), TO = Number(fig.dataset.to);
  const END = fig.textContent, END_LBL = lbl.textContent;
  const fmt = new Intl.NumberFormat(document.documentElement.lang.startsWith('ar') ? 'ar-EG' : 'en-US');
  let timers = [], frame = 0, phase = 'idle';
  const roll = (a, b, ms) => {
    cancelAnimationFrame(frame);
    let t0 = 0;
    const step = now => {
      if (!t0) t0 = now;
      const t = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - t, 3);
      fig.textContent = t < 1 ? fmt.format(Math.round(a + (b - a) * e)) : (b === TO ? END : fmt.format(b));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  };
  const arm = () => {
    timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(frame);
    root.classList.remove('s1', 's2', 's3'); root.classList.add('is-armed');
    fig.textContent = fmt.format(FROM); lbl.textContent = lbl.dataset.start; phase = 'armed';
  };
  const play = () => {
    phase = 'played';
    timers.push(setTimeout(() => { root.classList.add('s1'); lbl.textContent = END_LBL; roll(FROM, MID, 700); }, 500));
    timers.push(setTimeout(() => { root.classList.add('s2'); roll(MID, TO, 900); }, 1500));
    timers.push(setTimeout(() => { root.classList.add('s3'); }, 2600));
  };
  const inView = () => { const r = root.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  // Nothing on screen at load is hidden: arm only a scene that starts below or above the fold.
  if (!inView()) arm();
  const check = () => {
    if (!inView()) { if (phase !== 'armed') arm(); return; }
    const r = card.getBoundingClientRect(), vh = innerHeight;
    const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (phase === 'armed' && visible >= Math.min(r.height, vh) * 0.6) play();
  };
  addEventListener('scroll', check, { passive: true }); addEventListener('resize', check);
})();
