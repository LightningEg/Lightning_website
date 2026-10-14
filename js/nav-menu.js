// Phone menu: below 980px the top bar's page links fold into one Menu button, so the bar stays calm.
(() => {
  const bar = document.querySelector('.d-bar');
  const links = bar && bar.querySelector('.d-links');
  const end = bar && bar.querySelector('.d-bar-end');
  if (!links || !end) return;
  const ar = document.documentElement.lang.startsWith('ar');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'd-menu-btn';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'd-links');
  button.setAttribute('aria-label', ar ? 'القائمة' : 'Menu');
  button.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  links.id = 'd-links';
  end.appendChild(button);
  const lang = end.querySelector('.lang-switch');
  if (lang) {
    const copy = lang.cloneNode(true);
    copy.className = 'd-menu-lang';
    links.appendChild(copy);
  }
  const set = open => {
    bar.classList.toggle('d-menu-open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => set(!bar.classList.contains('d-menu-open')));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  document.addEventListener('click', e => { if (!bar.contains(e.target)) set(false); });
  links.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
})();
