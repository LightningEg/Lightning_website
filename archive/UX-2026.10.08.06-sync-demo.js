// Test page only. Show the phone lending its ledger to the PC once on entry;
// the button runs the real reverse action. Without JS the captured lent state remains visible.
(() => {
  const section = document.querySelector('.sync-demo');
  if (!section) return;
  const action = section.querySelector('.sync-action');
  const status = section.querySelector('.sync-state');
  const pcZoom = section.querySelector('.sync-pc .zoom');
  const phoneZoom = section.querySelector('.sync-phone .zoom');
  const phoneShot = phoneZoom.querySelector('img');
  const phoneCaption = section.querySelector('.sync-phone figcaption');
  const pcCaption = section.querySelector('.sync-pc figcaption');
  const base = 'assets/app/mohab-year-2026-10-07/';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let state = 'lent';
  let started = false;
  let timer;

  function show(next) {
    state = next;
    section.classList.remove('is-home', 'is-lending', 'is-lent', 'is-returning');
    section.classList.add(`is-${next}`);
    const moving = next === 'lending' || next === 'returning';
    const home = next === 'home' || next === 'lending';
    pcZoom.disabled = home || moving;
    phoneZoom.disabled = moving;
    phoneZoom.dataset.zoom = base + (home ? 'phone-overview.webp' : 'sync-phone.webp');
    phoneZoom.dataset.caption = home
      ? 'The phone holds Mohab’s ledger and can edit it.'
      : 'The phone while the PC borrows: Lent to Office PC, read only.';
    phoneShot.alt = home
      ? 'Lightning on the phone, Overview year to date, while the phone holds the ledger and can edit it.'
      : 'Lightning on the phone while the PC borrows: Lent to Office PC, read only, with the same Overview figures.';
    pcCaption.innerHTML = home ? 'On the PC: <b>Waiting for Mohab’s phone</b>'
      : 'On the PC: <b>Borrowed from Mohab’s phone</b> · Hand back';
    phoneCaption.innerHTML = home ? 'On the phone: <b>Holds the ledger</b> · ready to edit'
      : 'On the phone: <b>Lent to Office PC</b> · read only';
    status.textContent = next === 'lending' ? 'Encrypted handoff to the PC over your Wi-Fi.'
      : next === 'returning' ? 'Handing the ledger back to your phone.'
      : home ? 'Your phone has the ledger. The PC is waiting.'
      : 'The PC has the ledger. Your phone can read it.';
    action.textContent = home ? 'Borrow on PC' : 'Hand back to phone';
    action.disabled = moving;
  }

  function travel(next) {
    clearTimeout(timer);
    if (reduceMotion) { show(next); return; }
    show(next === 'lent' ? 'lending' : 'returning');
    timer = setTimeout(() => show(next), 2800);
  }

  action.addEventListener('click', () => {
    if (state === 'home') travel('lent');
    else if (state === 'lent') travel('home');
  });

  if (reduceMotion || !('IntersectionObserver' in window)) {
    show('lent');
    action.hidden = false;
    return;
  }
  show('home');
  const observer = new IntersectionObserver(entries => {
    if (started || !entries.some(entry => entry.isIntersecting)) return;
    started = true;
    observer.disconnect();
    travel('lent');
    action.hidden = false;
  }, {threshold: .25});
  observer.observe(section.querySelector('.sync-stage'));
})();
