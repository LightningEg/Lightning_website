// Now With Animated Themes: a picker over three real screens. The shown theme turns by itself while the
// section is on screen (never with reduced motion), and stops for good once someone picks one.
(() => {
  const stage = document.querySelector('[data-th]');
  if (!stage) return;
  const tabs = [...stage.querySelectorAll('[data-th-tab]')];
  const frames = [...stage.querySelectorAll('[data-th-frame]')];
  const caps = [...stage.querySelectorAll('[data-th-cap]')];
  const bar = stage.querySelector('[data-th-bar]');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0, timer = 0, picked = false;

  function show(next) {
    index = (next + tabs.length) % tabs.length;
    const id = tabs[index].dataset.thTab;
    stage.dataset.thOn = id;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    frames.forEach(frame => frame.classList.toggle('is-on', frame.dataset.thFrame === id));
    caps.forEach(cap => { cap.hidden = cap.dataset.thCap !== id; });
    if (bar) bar.textContent = tabs[index].dataset.bar;
  }
  const stop = () => { clearInterval(timer); timer = 0; };
  const play = () => { if (!timer && !picked && !reduce) timer = setInterval(() => show(index + 1), 5200); };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => { picked = true; stop(); show(i); });
    tab.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault(); picked = true; stop(); show(index + step); tabs[index].focus();
    });
  });
  stage.querySelector('.th-tabs').hidden = false;  // without the script only the first theme shows, with no dead buttons
  stage.addEventListener('pointerenter', stop);
  stage.addEventListener('pointerleave', play);
  stage.addEventListener('focusin', stop);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => entry.isIntersecting ? play() : stop(), { threshold: .4 }).observe(stage);
  }
})();
