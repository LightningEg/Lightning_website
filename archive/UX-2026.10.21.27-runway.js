// The runway: a dot rides the cash line in 2.2 s once the chart is in view.
// Keep one clock for the line, dot, figure and highlights; no animation-library loading race.
// Illustrative path between real month ends: the chart's data-from (September) and data-to (November),
// so the figure always ends on the page's own text; pages without them keep 184,976 and 165,937.
(() => {
  const root = document.querySelector('[data-runway]');
  if (!root || !('IntersectionObserver' in window)) return;
  const line = root.querySelector('.rw-line'), area = root.querySelector('.rw-area'), dot = root.querySelector('.rw-dot');
  const fig = root.querySelector('.rw-fig b'), cap = root.querySelector('.rw-cap'), safe = root.querySelector('.rw-safe');
  const lows = root.querySelectorAll('.rw-low,.rw-lowdot'), items = [...root.querySelectorAll('.rw-events li')];
  const card = root.querySelector('.rw-card');
  const len = line.getTotalLength(), FROM = Number(root.dataset.from) || 184976, TO = Number(root.dataset.to) || 165937;
  // Locate November on the actual SVG path instead of guessing a fraction of the animation.
  const lowX = Number(root.querySelector('.rw-lowdot').getAttribute('cx'));
  let left = 0, right = len;
  for (let i = 0; i < 24; i++) {
    const mid = (left + right) / 2;
    if (line.getPointAtLength(mid).x < lowX) left = mid;
    else right = mid;
  }
  const lowProgress = (left + right) / (2 * len);
  const fmt = new Intl.NumberFormat(document.documentElement.lang.startsWith('ar') ? 'ar-EG' : 'en-US');
  function render(p) {
    const pt = line.getPointAtLength(len * p);
    line.style.strokeDashoffset = len * (1 - p);
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
    area.style.clipPath = `inset(0 ${Math.max(0, 100 - pt.x / 8)}% 0 0)`;
    const t = Math.min(p / lowProgress, 1);
    fig.textContent = fmt.format(Math.round(FROM + (TO - FROM) * t));
    items.forEach((li, i) => li.classList.toggle('on', p >= 0.12 + i * 0.17));
    cap.textContent = p >= lowProgress ? cap.dataset.low : cap.dataset.go;
    lows.forEach(n => n.classList.toggle('on', p >= lowProgress));
    safe.classList.toggle('on', p >= lowProgress + 0.1);
  }
  let phase = 'idle', frame = 0, began = 0;
  function play(now) {
    if (!began) began = now;
    const t = Math.max(0, Math.min(1, (now - began - 600) / 2200));
    // Smooth acceleration and deceleration, with exactly one progress value for every element.
    render(t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    if (t < 1) frame = requestAnimationFrame(play);
    else { frame = 0; phase = 'played'; }
  }
  function check() {
    const scene = root.getBoundingClientRect(), r = card.getBoundingClientRect(), vh = innerHeight;
    // Reset only after the whole scene leaves, so its event cards never flicker while still visible.
    if (scene.bottom <= 0 || scene.top >= vh) {
      cancelAnimationFrame(frame); frame = 0; began = 0; phase = 'idle';
      root.classList.remove('is-live');
      line.style.strokeDasharray = ''; line.style.strokeDashoffset = '';
      area.style.clipPath = '';
      return;
    }
    const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    // A tall chart can play on a short or landscape screen without fitting entirely inside it.
    if (phase === 'idle' && visible >= Math.min(r.height, vh) * 0.6) {
      phase = 'playing'; began = 0;
      root.classList.add('is-live'); line.style.strokeDasharray = len;
      render(0); frame = requestAnimationFrame(play);
    }
  }
  let queued = false;
  function scheduleCheck() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; check(); });
  }
  const observer = new IntersectionObserver(scheduleCheck, {threshold: [0, 0.25, 0.5, 0.75, 1]});
  observer.observe(root);
  addEventListener('scroll', scheduleCheck, {passive: true});
  addEventListener('resize', scheduleCheck);
  check();
})();
