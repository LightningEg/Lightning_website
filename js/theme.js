// Lightning theme: light by default, whatever the browser or system setting; dark only when the visitor picks it, then remembered.
// A member may also wear a marketplace theme across the website (a "skin", chosen on marketplace.html, remembered on
// this device). Themes are shared with For Geeks, but each site draws its own version: here a theme has a light side
// and a dark side (variant below); a light theme leaves dark mode alone, so the switch shows the plain dark site. The skin repaints surfaces, text and buttons
// only; good and bad keep their colours.
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
  const TEXTURES = ['papyrus', 'cotton', 'dendera']; // css/textures.css
  function validSkin(v) {
    if (!(v && typeof v === 'object' && /^[a-z0-9-]{1,40}$/.test(v.id || '') && Array.isArray(v.c) && v.c.length === 4 && v.c.every(c => HEX.test(c)))) return null;
    return v.tex == null || TEXTURES.includes(v.tex) ? v : null;
  }
  // The main site's version of a theme's four colours [ground, text, quiet text, accent] in light or dark mode.
  // The theme's own side keeps its colours; the other side turns it over (its ground becomes the text) on a lightly
  // tinted ground. Quiet text and the accent move toward the text until they read at 4.5:1.
  // js/theme-preview.js holds the same rule for the previews; supabase/tests/market-ui-pages.test.mjs keeps them equal.
  function variant(c, mode) {
    const [bg, ink, quiet, acc] = c, own = (lum(bg) > 0.4) === (mode === 'light');
    const ground = own ? bg : mode === 'light' ? mix(acc, '#ffffff', 0.05) : mix(acc, ink, 0.07);
    const text = own ? ink : bg;
    const readable = start => { let x = start; for (let t = 0.1; contrast(x, ground) < 4.5 && t < 1; t += 0.1) x = mix(text, start, t); return x; };
    return [ground, text, readable(own ? quiet : mix(text, ground, 0.62)), readable(acc)];
  }
  // Dark mode belongs to the visitor: a light theme (Cotton, Papyrus) never recolours it, so the switch shows the plain
  // dark site. A dark theme shows in both modes; light mode is where every worn theme appears.
  const paintsOn = (c, mode) => mode === 'light' || lum(c[0]) <= 0.4;
  // The skin, part by part (guideline/themes.md): each part names the Part B tokens it may repaint, and nothing else
  // changes. Text, surfaces and lines come from the theme's ground and text; buttons, links and focus from its accent.
  function skinParts(c) {
    const [bg, ink, quiet, acc] = c, light = lum(bg) > 0.4;
    const on = contrast(acc, bg) >= contrast(acc, ink) ? bg : ink;
    const link = contrast(acc, bg) >= 3 ? acc : ink;
    const line = mix(ink, bg, 0.14);
    return {
      colours: { '--paper': bg, '--ink': ink, '--ink2': mix(ink, quiet, 0.5), '--muted': quiet,
        '--canvas': `linear-gradient(160deg,${bg} 0%,${mix(acc, bg, 0.05)} 55%,${mix(acc, bg, 0.09)} 100%)` },
      header: { '--bar-bg': bg + 'e6' },
      hero: { '--lead': `linear-gradient(135deg,${mix(acc, bg, 0.14)},${mix(acc, bg, 0.07)})` },
      cards: { '--white': mix(ink, bg, light ? 0.02 : 0.06), '--panel': mix(ink, bg, light ? 0.03 : 0.04), '--line': line, '--track': mix(ink, bg, 0.09) },
      controls: { '--nile': acc, '--nile-2': mix(acc, ink, 0.82), '--on-nile': on, '--azure': link, '--line-ctl': mix(ink, bg, 0.42),
        '--field': mix(ink, bg, 0.07), '--field-focus': mix(ink, bg, 0.1) },
      footer: { '--sf-ink': ink, '--sf-ink2': mix(ink, quiet, 0.5), '--sf-muted': quiet, '--sf-line': line, '--sf-focus': link },
      // the consent bar and choice buttons carry their own copy of the tokens (css/consent.css)
      consent: { '--lc-ink': ink, '--lc-ink2': mix(ink, quiet, 0.5), '--lc-panel': mix(ink, bg, light ? 0.02 : 0.06), '--lc-line': line, '--lc-ctl': mix(ink, bg, 0.42), '--lc-focus': link }
    };
  }
  function skinCss(c) {
    const p = skinParts(c), list = o => Object.entries(o).map(([k, x]) => k + ':' + x).join(';');
    const page = Object.assign({}, p.colours, p.header, p.hero, p.cards, p.controls);
    return `:root[data-skin][data-theme]{${list(page)}}:root[data-skin][data-theme] body{background-color:${p.colours['--paper']}}` +
      `:root[data-skin][data-theme] .sf{${list(p.footer)}}` +
      `:root[data-skin][data-theme] .lc-bar,:root[data-skin][data-theme] .lc-choice{${list(p.consent)}}`;
  }
  // Wear a skin ({id, name, c: [ground, text, quiet text, accent]}) or none. remember: false is a try-on for this page only.
  function setSkin(next, remember) {
    skin = validSkin(next);
    let tag = document.getElementById('site-skin');
    // A theme paints only its own side: the other mode stays the plain site, so the switch never recolours it.
    if (skin && paintsOn(skin.c, saved || 'light')) {
      if (!tag) { tag = document.createElement('style'); tag.id = 'site-skin'; document.head.appendChild(tag); }
      const mode = saved || 'light';
      tag.textContent = skinCss(variant(skin.c, mode));
      root.dataset.skin = skin.id;
      if (skin.tex) root.dataset.texture = skin.tex; else delete root.dataset.texture;
      apply(mode);
    } else {
      if (tag) tag.remove();
      delete root.dataset.skin;
      delete root.dataset.texture;
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
  if (storedSkin()) setSkin(storedSkin(), false);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-theme-toggle]').forEach(build);
    apply(root.dataset.theme);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    saved = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, saved); } catch (_) {}
    if (skin) setSkin(skin, false); else apply(saved);
  });
  window.LightningTheme = {apply, get: () => root.dataset.theme, skin: setSkin, worn: () => skin, stored: storedSkin, variant, parts: skinParts, paintsOn};
})();
