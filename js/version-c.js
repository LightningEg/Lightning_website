// Lightning Version C: calculator, email signup, product tour, screenshot lightbox and step map.
(() => {
  // Arabic pages (ar/, lang="ar-EG") write Arabic-Indic digits and read either kind.
  const ar = document.documentElement.lang.startsWith('ar');
  const latin = text => text.replace(/[\u200e\u200f\u061c]/g, '').replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632).replace(/٬/g, ',');
  const format = new Intl.NumberFormat(ar ? 'ar-EG' : 'en-EG', {maximumFractionDigits: 0});
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- calculator ----
  const amount = document.getElementById('monthly-amount');
  if (amount) {
    const target = document.getElementById('freedom-number');
    const income = document.getElementById('monthly-income');
    const annual = document.getElementById('annual-savings');
    const tenYear = document.getElementById('ten-year');
    const presets = document.querySelectorAll('.presets button');
    const formatCapital = value => format.format(value).replaceAll(',', '<span class="number-comma">,</span>');
    const monthlyRate = 0.20 / 12;
    const growth = (Math.pow(1 + monthlyRate, 120) - 1) / monthlyRate;
    const update = () => {
      const digits = latin(amount.value).replace(/[^0-9]/g, '').slice(0, 9);
      presets.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.amount === digits)));
      if (!digits) { amount.value = ''; [target, income, annual, tenYear].forEach(el => { el.textContent = '—'; }); return; }
      const monthly = Number(digits);
      amount.value = format.format(monthly);
      target.innerHTML = formatCapital(monthly * 12 / 0.20);
      income.textContent = `${format.format(monthly)} EGP`;
      annual.textContent = `${format.format(monthly * 12)} EGP`;
      tenYear.textContent = `${format.format(Math.round(monthly * growth))} EGP`;
    };
    amount.addEventListener('input', update);
    presets.forEach(button => button.addEventListener('click', () => { amount.value = button.dataset.amount; update(); amount.focus(); }));
    update();
  }

  // ---- email signup (same receiver as Versions A and B) ----
  const signup = document.getElementById('email-signup');
  if (signup) {
    const status = document.getElementById('signup-status');
    signup.addEventListener('submit', async event => {
      event.preventDefault();
      if (!signup.reportValidity()) return;
      const button = signup.querySelector('button[type="submit"]');
      button.disabled = true; status.textContent = (ar ? 'بنبعت…' : 'Sending…');
      try {
        signup.querySelector('[name="page_url"]').value = window.location.href;
        await window.LightningForms.send(signup.dataset.endpoint, new URLSearchParams(new FormData(signup)), signup);
        signup.reset(); status.textContent = (ar ? 'اتسجلت معانا. هنكلمك قريب.' : 'You’re on the list. We’ll be in touch.');
      } catch (_) { status.textContent = (ar ? 'معرفناش نحفظ إيميلك. جرّب تاني.' : 'We could not save your email. Please try again.'); }
      finally { button.disabled = false; }
    });
  }

  // ---- lightbox ----
  const lightbox = document.getElementById('lightbox');
  const openZoom = button => {
    if (!lightbox || typeof lightbox.showModal !== 'function') { window.open(button.dataset.zoom, '_blank'); return; }
    const img = lightbox.querySelector('img');
    img.removeAttribute('src');
    img.src = button.dataset.zoom;
    img.alt = button.querySelector('img')?.alt || '';
    lightbox.querySelector('p').textContent = button.dataset.caption || '';
    lightbox.showModal();
  };
  document.addEventListener('click', event => {
    const zoom = event.target.closest('[data-zoom]');
    if (zoom) openZoom(zoom);
  });
  if (lightbox) {
    lightbox.querySelector('[data-close]').addEventListener('click', () => lightbox.close());
    lightbox.addEventListener('click', event => { if (event.target === lightbox) lightbox.close(); });
  }

  // ---- product tour ----
  const frame = (img, label, alt, caption) => `<div class="frame"><div class="frame-bar" aria-hidden="true"><i></i><i></i><i></i><span>Lightning · ${label}</span></div><button class="zoom" type="button" data-zoom="assets/app/${img}.webp" data-caption="${caption}"><img src="assets/app/${img}.webp" width="2000" height="1250" loading="lazy" alt="${alt}"></button></div>`;
  function tour(tabList, stage, steps) {
    if (!tabList || !stage) return;
    const DURATION = 7000;
    let index = 0, elapsed = 0, last = 0, stopped = false, hovering = false, visible = false;
    steps.forEach((step, i) => {
      const tab = document.createElement('button');
      tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.id = `tab-${step.id}`;
      tab.setAttribute('aria-controls', `panel-${step.id}`);
      tab.innerHTML = `${step.label}<span class="bar" aria-hidden="true"><i></i></span>`;
      tab.addEventListener('click', () => { stopped = true; select(i); });
      tab.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        const next = (i + (event.key === 'ArrowRight' ? 1 : steps.length - 1)) % steps.length;
        stopped = true; select(next); tabList.children[next].focus();
      });
      tabList.append(tab);
      const panel = document.createElement('div');
      panel.className = 'tour-panel'; panel.setAttribute('role', 'tabpanel'); panel.id = `panel-${step.id}`;
      panel.setAttribute('aria-labelledby', tab.id);
      panel.innerHTML = `<div class="tour-shot">${frame(step.img, step.label, step.alt || step.title, step.title)}</div><div class="tour-copy"><span class="step">${String(i + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')} · ${step.label}</span><h3>${step.title}</h3><p>${step.body}</p><ul>${step.points.map(p => `<li>${p}</li>`).join('')}</ul><a class="text-link" href="how-it-works.html">How it works, step by step →</a></div>`;
      stage.append(panel);
    });
    const tabs = [...tabList.children], panels = [...stage.children];
    const bar = i => tabs[i].querySelector('.bar i');
    function select(i) {
      index = i; elapsed = 0;
      tabs.forEach((tab, n) => { tab.setAttribute('aria-selected', String(n === i)); tab.tabIndex = n === i ? 0 : -1; bar(n).style.width = '0'; });
      panels.forEach((panel, n) => { panel.hidden = n !== i; });
    }
    select(0);
    if (reduceMotion) return;
    const section = stage.closest('section') || stage;
    section.addEventListener('pointerenter', () => { hovering = true; });
    section.addEventListener('pointerleave', () => { hovering = false; });
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, {threshold: .35}).observe(section);
    const frameStep = now => {
      const delta = last ? now - last : 0; last = now;
      if (!stopped && !hovering && visible && !document.hidden) {
        elapsed += delta;
        bar(index).style.width = `${Math.min(100, elapsed / DURATION * 100)}%`;
        if (elapsed >= DURATION) select((index + 1) % steps.length);
      }
      if (!stopped) requestAnimationFrame(frameStep); else bar(index).style.width = '0';
    };
    requestAnimationFrame(frameStep);
  }

  // ---- how-it-works step map ----
  const map = document.querySelector('.hw-map');
  if (map && 'IntersectionObserver' in window) {
    const links = [...map.querySelectorAll('a')];
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        links.forEach(link => link.classList.toggle('is-active', link.hash === `#${entry.target.id}`));
      });
    }, {rootMargin: '-45% 0px -50% 0px'});
    links.forEach(link => { const step = document.querySelector(link.hash); if (step) observer.observe(step); });
  }

  window.LightningC = {tour};
})();
