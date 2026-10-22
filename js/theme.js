// Lightning theme: light by default, whatever the browser or system setting; dark only when the visitor picks it, then remembered.
// Load in <head> without defer so the right theme is set before the first paint.
(() => {
  const KEY = 'lightning-theme';
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  if (saved !== 'light' && saved !== 'dark') saved = null;

  const SUN = '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
  const MOON = '<svg class="i-moon" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 14.6A8.5 8.5 0 0 1 9.4 3.7a8.5 8.5 0 1 0 10.9 10.9Z"/></svg>';

  function apply(theme) {
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#08192A' : '#E3F6EC';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-checked', String(theme === 'dark'));
      button.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }
  function build(button) {
    if (button.dataset.ready) return;
    button.dataset.ready = '1';
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', 'Dark mode');
    button.classList.add('theme-toggle');
    button.innerHTML = `<span class="theme-toggle__track" aria-hidden="true">${SUN}${MOON}<span class="theme-toggle__thumb">${SUN}${MOON}</span></span>`;
  }

  apply(saved || 'light');
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-toggle]').forEach(build);
    apply(root.dataset.theme);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    saved = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, saved); } catch (_) {}
    apply(saved);
  });
  window.LightningTheme = {apply, get: () => root.dataset.theme};
})();
