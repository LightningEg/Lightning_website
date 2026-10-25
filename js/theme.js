// Lightning theme: light by default, whatever the browser or system setting; dark only when the visitor picks it, then remembered.
// A member may also wear a marketplace theme across the website (a "skin": four colours, chosen on marketplace.html,
// remembered on this device). The skin repaints surfaces, text and buttons only; good and bad keep their colours.
// Load in <head> without defer so the right theme is set before the first paint.
(() => {
  const KEY = 'lightning-theme';
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (_) {}
  if (saved !== 'light' && saved !== 'dark') saved = null;

  const SUN = '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
  const MOON = '<svg class="i-moon" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 14.6A8.5 8.5 0 0 1 9.4 3.7a8.5 8.5 0 1 0 10.9 10.9Z"/></svg>';

  const SKIN_KEY = 'lightning-site-skin';
  const HEX = /^#[0-9a-f]{6}$/i;
  let skin = null;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, share) => '#' + rgb(a).map((v, i) => Math.round(v * share + rgb(b)[i] * (1 - share)).toString(16).padStart(2, '0')).join('');
  const lum = h => rgb(h).map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function validSkin(v) {
    return v && typeof v === 'object' && /^[a-z0-9-]{1,40}$/.test(v.id || '') && Array.isArray(v.c) && v.c.length === 4 && v.c.every(c => HEX.test(c)) ? v : null;
  }
  function skinCss(c) {
    const [bg, ink, quiet, acc] = c, light = lum(bg) > 0.4;
    const on = contrast(acc, bg) >= contrast(acc, ink) ? bg : ink;
    const link = contrast(acc, bg) >= 3 ? acc : ink;
    const v = {
      '--ink': ink, '--ink2': mix(ink, quiet, 0.5), '--muted': quiet,
      '--nile': acc, '--nile-2': mix(acc, ink, 0.82), '--on-nile': on, '--azure': link,
      '--paper': bg, '--white': mix(ink, bg, light ? 0.02 : 0.06), '--panel': mix(ink, bg, light ? 0.03 : 0.04),
      '--line': mix(ink, bg, 0.14), '--line-ctl': mix(ink, bg, 0.42), '--track': mix(ink, bg, 0.09),
      '--field': mix(ink, bg, 0.07), '--field-focus': mix(ink, bg, 0.1),
      '--canvas': `linear-gradient(160deg,${bg} 0%,${mix(acc, bg, 0.05)} 55%,${mix(acc, bg, 0.09)} 100%)`,
      '--lead': `linear-gradient(135deg,${mix(acc, bg, 0.14)},${mix(acc, bg, 0.07)})`,
      '--bar-bg': bg + 'e6'
    };
    const tokens = Object.entries(v).map(([k, x]) => k + ':' + x).join(';');
    return `:root[data-skin][data-theme]{${tokens}}:root[data-skin][data-theme] body{background-color:${bg}}` +
      `:root[data-skin][data-theme] .sf{--sf-ink:${ink};--sf-ink2:${mix(ink, quiet, 0.5)};--sf-muted:${quiet};--sf-line:${v['--line']};--sf-focus:${link}}`;
  }
  // Wear a skin ({id, name, c: [ground, text, quiet text, accent]}) or none. remember: false is a try-on for this page only.
  function setSkin(next, remember) {
    skin = validSkin(next);
    let tag = document.getElementById('site-skin');
    if (skin) {
      if (!tag) { tag = document.createElement('style'); tag.id = 'site-skin'; document.head.appendChild(tag); }
      tag.textContent = skinCss(skin.c);
      root.dataset.skin = skin.id;
      apply(lum(skin.c[0]) > 0.4 ? 'light' : 'dark');
    } else {
      if (tag) tag.remove();
      delete root.dataset.skin;
      apply(saved || 'light');
    }
    if (remember !== false) {
      try { if (skin) localStorage.setItem(SKIN_KEY, JSON.stringify(skin)); else localStorage.removeItem(SKIN_KEY); } catch (_) {}
    }
    document.dispatchEvent(new CustomEvent('lightning:skin', { detail: skin }));
  }
  function storedSkin() {
    try { return validSkin(JSON.parse(localStorage.getItem(SKIN_KEY) || 'null')); } catch (_) { return null; }
  }

  function apply(theme) {
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#08192A' : '#E3F6EC';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-checked', String(theme === 'dark'));
      button.title = skin ? 'Back to the standard look' : theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
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
  if (storedSkin()) setSkin(storedSkin(), false);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-toggle]').forEach(build);
    apply(root.dataset.theme);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    saved = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, saved); } catch (_) {}
    if (skin) setSkin(null); else apply(saved);
  });
  window.LightningTheme = {apply, get: () => root.dataset.theme, skin: setSkin, worn: () => skin, stored: storedSkin};
})();
