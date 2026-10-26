// Lightning analytics, in two tiers chosen in the consent bar or on privacy.html (README › Analytics and consent).
// Essential, for everyone: nothing is stored on the device.
//   · GoatCounter page views and counted events (downloads keep their own names, every other event carries the
//     page's release ID: "reach-trust@UX-2026.10.13.02").
//   · One anonymous record per page view, sent to Lightning's own receiver: the page, device class, what was
//     seen and pressed, how far it was scrolled, errors. Its random ID lives in memory only and links nothing.
// All, only if the visitor allows it: also a visit ID (sessionStorage) and a visitor ID (localStorage, 90 days),
//   so the pages of one visit and return visits can be linked.
// Never sent: what anyone types, amounts, names, emails, IP addresses. Nothing at all is sent from localhost, automated
// browsers, or a browser marked as the owner's (README › Analytics and consent).
(() => {
  const POLICY = 2; // raise when privacy.html changes what is counted: everyone is asked again
  const KEY = 'lightning-consent';
  const VISIT = 'lightning-visit';
  const VISITOR = 'lightning-visitor';
  const VISITOR_DAYS = 90;
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzzlE-9gmeXb-D0DZMp6gg3dxNo-9ZBhgJED-y_ca26xevvtNnDb8Vqk6vs6Y_Aei0d/exec';

  const me = document.currentScript;
  const root = new URL('..', me ? me.src : location.href);
  const arabic = (document.documentElement.lang || '').startsWith('ar');
  const privacyUrl = new URL(arabic ? 'ar/privacy.html' : 'privacy.html', root).href;
  const gpc = navigator.globalPrivacyControl === true;

  const page = (location.pathname.replace(/^\/+/, '').replace(/\/$/, '/index').replace(/\.html$/, '') || 'index');
  const release = (document.body && document.body.dataset.uxVersion) || page;
  const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const store = (area, key, value) => { try { if (value === undefined) return window[area].getItem(key); if (value === null) window[area].removeItem(key); else window[area].setItem(key, value); } catch (_) {} return null; };
  // Not counted at all: previews, automated browsers (crawlers, test robots) and the owner's own browsers. The dashboard
  // marks a browser as the owner's; so does opening any page with ?notrack (?track undoes it).
  const NOTRACK = 'lightning-notrack';
  const query = new URLSearchParams(location.search);
  if (query.has('notrack')) store('localStorage', NOTRACK, '1');
  else if (query.has('track')) store('localStorage', NOTRACK, null);
  const local = location.protocol === 'file:' || /^(localhost|127\.|\[::1\])/.test(location.hostname)
    || navigator.webdriver === true || store('localStorage', NOTRACK) === '1';
  const random = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

  const WORDS = arabic ? {
    text: 'بنستخدم كوكيز أساسية عشان الموقع يشتغل. وعايزين كمان نستخدم كوكيز إحصائيات عشان نعرف إيه اللي عاجب الناس ونظبّط اللي محتاج تظبيط. دي الوحيدة الاختيارية. هتختار مرة واحدة، ومش هنسألك تاني إلا لو حاجة اتغيّرت.',
    link: 'سياسة الخصوصية', essential: 'خليها الأساسي بس', all: 'اسمح بالكل', region: 'اختيارات الخصوصية', footer: 'الخصوصية',
    now: {essential: 'الإعداد الحالي: الإحصائيات الأساسية بس.', all: 'الإعداد الحالي: كل الإحصائيات.', gpc: 'الإعداد الحالي: الإحصائيات الأساسية بس، لأن متصفحك باعت Global Privacy Control.', none: 'ما اخترتش لسه. الإحصائيات الأساسية بس هي اللي شغالة.'},
  } : {
    text: 'We use essential cookies to make the site work. We’d also like to use analytics cookies to see what’s popular and fix rough edges. That’s the only optional one. You decide once, and we won’t ask again unless something changes.',
    link: 'Privacy policy', essential: 'Keep essential only', all: 'Allow all', region: 'Privacy choices', footer: 'Privacy',
    now: {essential: 'Current setting: essential analytics only.', all: 'Current setting: all analytics.', gpc: 'Current setting: essential analytics only, because your browser sends Global Privacy Control.', none: 'No choice made. Essential analytics only apply.'},
  };

  // ---- consent ----
  const readChoice = () => {
    try {
      const saved = JSON.parse(store('localStorage', KEY) || 'null');
      if (saved && saved.policy === POLICY && (saved.choice === 'essential' || saved.choice === 'all')) return saved.choice;
    } catch (_) {}
    return null;
  };
  let choice = readChoice();
  const journeysOn = () => choice === 'all' && !local;

  // ---- essential: GoatCounter ----
  const waiting = [];
  const gc = path => {
    if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({path, title: path, event: true});
    else waiting.push(path);
  };
  const counter = document.createElement('script');
  counter.async = true;
  counter.src = 'https://gc.zgo.at/count.js';
  counter.dataset.goatcounter = 'https://mohamedelfeki.goatcounter.com/count';
  counter.addEventListener('load', () => waiting.splice(0).forEach(gc));
  if (!local) document.head.append(counter);

  // ---- the page view: what happened on this one page. Anonymous, kept in memory, sent when the page is left ----
  const ua = navigator.userAgent || '';
  const osName = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : /windows/i.test(ua) ? 'windows' : /cros/i.test(ua) ? 'chromeos' : /mac os x|macintosh/i.test(ua) ? 'mac' : /linux/i.test(ua) ? 'linux' : 'other';
  const browserName = /edg\//i.test(ua) ? 'edge' : /opr\/|opera/i.test(ua) ? 'opera' : /samsungbrowser/i.test(ua) ? 'samsung' : /firefox|fxios/i.test(ua) ? 'firefox' : /chrome|crios/i.test(ua) ? 'chrome' : /safari/i.test(ua) ? 'safari' : 'other';
  const device = window.innerWidth <= 640 ? 'phone' : window.innerWidth <= 1024 ? 'tablet' : 'desktop';
  const params = new URLSearchParams(location.search);
  let ref = '';
  let from = ''; // the page of this site that led here (named like `page`), 'outside' for another site, '' for none. Never a URL.
  try {
    const prev = new URL(document.referrer);
    if (prev.hostname !== location.hostname) { ref = prev.hostname; from = 'outside'; }
    else from = prev.pathname.replace(/^\/+/, '').replace(/\/$/, '/index').replace(/\.html$/, '') || 'index';
  } catch (_) {}
  from = /^[A-Za-z0-9._\/-]{0,80}$/.test(from) ? from : '';
  const pv = {id: random(), start: Date.now(), tl: new Map([['view', 0]]), scroll: 0, active: 0, lcp: 0};
  const secs = () => Math.max(0, Math.round((Date.now() - pv.start) / 1000));
  const consentState = () => choice || (gpc ? 'gpc' : 'undecided');

  // ---- all: ids that link the pages of one visit (only with Allow all) ----
  let link = null;
  const pending = []; // linked events not yet sent
  const startLink = () => {
    if (link || !journeysOn()) return;
    const now = Date.now();
    let visit = null;
    try { visit = JSON.parse(store('sessionStorage', VISIT) || 'null'); } catch (_) {}
    let visitor = null;
    try { visitor = JSON.parse(store('localStorage', VISITOR) || 'null'); } catch (_) {}
    if (!visitor || !visitor.id || !(visitor.until > now)) visitor = {id: random(), n: 0, until: now + VISITOR_DAYS * 864e5};
    if (!visit || !visit.id) {
      visit = {id: random(), start: now};
      visitor.n += 1;
      store('sessionStorage', VISIT, JSON.stringify(visit));
      store('localStorage', VISITOR, JSON.stringify(visitor));
    }
    link = {sid: visit.id, vid: visitor.id, vn: visitor.n};
    pending.push({n: 'view', t: secs()});
  };
  const dropLink = () => { link = null; pending.length = 0; store('sessionStorage', VISIT, null); store('localStorage', VISITOR, null); };

  // One thing happened on this page view. Only the first time of each is kept in the page record;
  // with Allow all every time is kept as an event.
  const note = code => {
    code = String(code).slice(0, 80);
    if (!pv.tl.has(code) && pv.tl.size < 80) pv.tl.set(code, secs());
    if (link) { pending.push({n: code, t: secs()}); if (pending.length >= 40) send(); }
  };

  let lastSent = '';
  const send = () => {
    if (local) return;
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    const payload = {v: 2, pv: pv.id, consent: consentState(), ux: release, page, lang: arabic ? 'ar' : 'en', device, os: osName, br: browserName, ref, from,
      us: (params.get('utm_source') || '').slice(0, 60), um: (params.get('utm_medium') || '').slice(0, 60), uc: (params.get('utm_campaign') || '').slice(0, 60),
      scroll: pv.scroll, act: pv.active, load: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd / 100) / 10 : 0, lcp: Math.round(pv.lcp / 100) / 10,
      tl: [...pv.tl]};
    if (link) Object.assign(payload, link, {ev: pending.splice(0)});
    const snapshot = JSON.stringify({...payload, ev: undefined});
    if (snapshot === lastSent && !(payload.ev && payload.ev.length)) return;
    lastSent = snapshot;
    const body = new URLSearchParams({form_type: 'event', payload: JSON.stringify(payload)});
    if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body))) {
      fetch(ENDPOINT, {method: 'POST', mode: 'no-cors', keepalive: true, body}).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
  window.addEventListener('pagehide', send);

  // One event, both tiers: GoatCounter gets it too (these are the ones whose names GoatCounter shows).
  const track = name => { gc(`${name}@${release}`); note(name); };
  const once = new Set();
  const trackOnce = name => { if (!once.has(name)) { once.add(name); track(name); } };

  // ---- signals that need no click: scroll, time spent, speed ----
  let lastActivity = Date.now();
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(type => addEventListener(type, () => { lastActivity = Date.now(); }, {passive: true, capture: true}));
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastActivity < 8000) pv.active += 1; }, 1000);
  const measureScroll = () => {
    const height = document.documentElement.scrollHeight;
    if (height) pv.scroll = Math.max(pv.scroll, Math.min(100, Math.round((window.scrollY + window.innerHeight) / height * 100)));
  };
  addEventListener('scroll', () => requestAnimationFrame(measureScroll), {passive: true});
  measureScroll();
  try { new PerformanceObserver(list => { const last = list.getEntries().pop(); if (last) pv.lcp = last.startTime; }).observe({type: 'largest-contentful-paint', buffered: true}); } catch (_) {}

  // ---- what is counted ----
  const platform = url => ['windows', 'android', 'mac', 'linux'].find(p => url.toLowerCase().includes(p)) || 'other';
  const downloadFor = url => {
    const app = url.match(/Lightning-downloads\/.*?(v\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)/i);
    if (app && /\.(zip|exe|msi|dmg|appimage|apk)(\?|#|$)/i.test(url)) {
      return `download-app-${app[1]}-${/\.apk(\?|#|$)/i.test(url) ? 'android' : platform(url)}`;
    }
    const sample = url.match(/assets\/samples\/([^/?#]+)\.zip/);
    return sample ? `download-sample-${sample[1]}` : null;
  };
  const target = href => {
    try {
      const url = new URL(href, location.href);
      if (url.hostname !== location.hostname) return slug(url.hostname);
      return slug(url.pathname.replace(/^.*\//, '').replace(/\.html$/, '') || 'index') + (url.hash ? '-' + slug(url.hash) : '');
    } catch (_) { return 'link'; }
  };
  const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, details, [role="button"], [data-zoom], [tabindex], form, dialog';
  const recentClicks = [];
  let deadClicks = 0;

  document.addEventListener('click', event => {
    // Clicks on something that looks pressable but isn't, and repeated frustrated clicks: where the page misleads.
    const now = Date.now();
    recentClicks.push({t: now, x: event.clientX, y: event.clientY});
    while (recentClicks.length && now - recentClicks[0].t > 1000) recentClicks.shift();
    if (recentClicks.length >= 3 && recentClicks.every(c => Math.abs(c.x - event.clientX) < 40 && Math.abs(c.y - event.clientY) < 40)) note('rage-click');
    if (!event.target.closest || !event.target.closest(INTERACTIVE)) {
      if (deadClicks < 5) {
        deadClicks += 1;
        const section = event.target.closest && event.target.closest('section[id]');
        note(`dead-${String(event.target.tagName || 'x').toLowerCase().replace(/[^a-z0-9]/g, '')}-${slug(section ? section.id : 'page') || 'page'}`);
      }
      return;
    }
    const el = event.target.closest('a[href], button, [data-zoom]');
    if (!el) return;
    if (el.matches('a[href]')) {
      const download = downloadFor(el.href);
      if (download) { gc(download); track(download.startsWith('download-app-') ? 'download' : 'sample'); note(download); send(); return; }
      if (el.matches('.lang-switch, .d-menu-lang')) return track('lang-switch');
      if (el.matches('.btn, .sb-btn, .nav-cta')) return track(`click-${target(el.getAttribute('href'))}`);
      if (el.closest('.d-links')) return note(`nav-${target(el.getAttribute('href'))}`);
      if (el.closest('.sf')) return note(`foot-${target(el.getAttribute('href'))}`);
      return note(`link-${target(el.getAttribute('href'))}`);
    }
    if (el.matches('.d-menu-btn')) return note('menu-open');
    if (el.matches('[data-theme-toggle]')) return note('theme-toggle');
    if (el.matches('[data-zoom]')) return track(`screen-${slug((el.dataset.zoom || '').replace(/^.*\//, '').replace(/\.[a-z0-9]+(\?.*)?$/i, ''))}`);
    if (el.matches('[data-d-amount], [data-d-rate]') || el.closest('#calculator, .d-calc')) trackOnce('calc-used');
  });
  document.addEventListener('input', event => {
    if (event.target.closest('#calculator, .d-calc')) return trackOnce('calc-used');
    const form = event.target.form;
    const type = form && form.elements.form_type && form.elements.form_type.value;
    if (type) trackOnce(`${slug(type)}-start`); // that the form was started; never what was typed
  });
  document.addEventListener('submit', event => {
    const type = event.target.elements && event.target.elements.form_type && event.target.elements.form_type.value;
    if (type) { track(`${slug(type)}-submit`); send(); }
  });
  // A field the browser refused: its name only (email, name…), never what was typed.
  document.addEventListener('invalid', event => note(`invalid-${slug(event.target.name || event.target.type || 'field')}`), true);
  document.addEventListener('toggle', event => {
    const box = event.target;
    if (box.tagName !== 'DETAILS' || !box.open || !box.closest('.d-faq, #faq')) return;
    trackOnce(`faq-${[...box.parentElement.children].filter(el => el.tagName === 'DETAILS').indexOf(box) + 1}`);
  }, true);

  // Errors: a code made from the message and file name, never the message itself.
  let errorCount = 0;
  const hash = text => { let h = 5381; for (const ch of String(text)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return h.toString(16).slice(0, 6); };
  const fileOf = url => String(url || '').split(/[?#]/)[0].replace(/^.*\//, '');
  addEventListener('error', event => {
    if (errorCount >= 4) return;
    errorCount += 1;
    const el = event.target;
    if (el && el !== window && el.tagName) note(`res-error-${el.tagName.toLowerCase()}-${slug(fileOf(el.src || el.href))}`); // a file that failed to load, including a blocked counter
    else note(`js-error-${hash((event.message || '') + fileOf(event.filename))}`);
  }, true);
  addEventListener('unhandledrejection', event => {
    if (errorCount >= 4) return;
    errorCount += 1;
    note(`js-reject-${hash(String((event.reason && event.reason.message) || event.reason))}`);
  });

  if ('IntersectionObserver' in window) {
    // Sections reached…
    const reached = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      reached.unobserve(entry.target);
      trackOnce(`reach-${slug(entry.target.id)}`);
    }), {rootMargin: '0px 0px -40% 0px'});
    document.querySelectorAll('main section[id]').forEach(section => reached.observe(section));
    // …and buttons and links that were actually on screen. A link folded into a closed menu isn't "seen" until it opens.
    const shown = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      shown.unobserve(entry.target);
      note(`seen-${target(entry.target.getAttribute('href'))}`);
    }), {threshold: 0.6});
    document.querySelectorAll('a.btn[href], a.sb-btn[href], a.nav-cta[href], .d-links a[href]').forEach(a => shown.observe(a));
  }

  // ---- the bar, the footer link and the choice on privacy.html ----
  let bar = null;
  const status = () => {
    const now = choice || (gpc ? 'gpc' : 'none');
    document.querySelectorAll('[data-consent-status]').forEach(el => { el.textContent = WORDS.now[now]; });
    document.querySelectorAll('[data-consent]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.consent === choice)));
  };
  const choose = next => {
    choice = next;
    store('localStorage', KEY, JSON.stringify({choice, policy: POLICY, date: new Date().toISOString().slice(0, 10)}));
    gc(`consent-${choice}`);
    if (choice === 'all') startLink();
    else { send(); dropLink(); }
    send();
    if (bar) { bar.hidden = true; bar.dataset.answered = ''; }
    status();
    window.dispatchEvent(new Event('lightning:consent')); // the membership invite waits for this (js/site-membership.js)
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-consent]');
    if (button && (button.dataset.consent === 'essential' || button.dataset.consent === 'all')) choose(button.dataset.consent);
  });

  // Pages built by tools/footer.py already link Privacy; this covers any page with an older footer.
  const footer = document.querySelector('footer nav');
  if (footer && !document.querySelector('footer a[href$="privacy.html"]')) {
    const link = document.createElement('a');
    link.href = privacyUrl;
    link.textContent = WORDS.footer;
    footer.append(link);
  }

  if (!choice && !gpc && !document.querySelector("[data-consent]")) { // privacy.html has its own buttons
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('css/consent.css?v=20261021-1', root).href;
    document.head.append(css);
    bar = document.createElement('div');
    bar.className = 'lc-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', WORDS.region);
    bar.innerHTML = `<p class="lc-text"></p><div class="lc-actions"><button type="button" class="lc-btn" data-consent="essential"></button><button type="button" class="lc-btn" data-consent="all"></button></div>`;
    const text = bar.querySelector('.lc-text');
    const more = document.createElement('a');
    more.href = privacyUrl;
    more.textContent = WORDS.link;
    text.append(WORDS.text + ' ', more);
    bar.querySelector('[data-consent="essential"]').textContent = WORDS.essential;
    bar.querySelector('[data-consent="all"]').textContent = WORDS.all;
    // Hidden until the stylesheet is in, so it never flashes unstyled.
    bar.hidden = true;
    css.addEventListener('load', () => { if (!choice) bar.hidden = false; });
    document.body.append(bar);
  }
  status();
  startLink();
})();
