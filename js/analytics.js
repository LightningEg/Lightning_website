// Lightning analytics, in two tiers chosen in the consent bar or on privacy.html (README › Analytics).
// Essential, for everyone: GoatCounter page views and counted events. Nothing is stored on the device.
//   Downloads keep their names ("download-app-v1.0.0-beta.1-android", "download-sample-<file>"); every
//   other event carries the page's UX release ID ("reach-trust@UX-2026.10.13.02") so releases compare.
// All, only if the visitor allows it: also one random visit number, so the pages of one visit can be
//   linked. Sent to the Apps Script receiver (form_type=event), which deletes rows after 90 days.
// Never sent: what anyone types, amounts, names, emails or IP addresses. GoatCounter ignores localhost.
(() => {
  const POLICY = 1; // raise when privacy.html changes what is counted: everyone is asked again
  const KEY = 'lightning-consent';
  const VISIT = 'lightning-visit';
  const VISITOR = 'lightning-visitor';
  const VISITOR_DAYS = 90;
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzzlE-9gmeXb-D0DZMp6gg3dxNo-9ZBhgJED-y_ca26xevvtNnDb8Vqk6vs6Y_Aei0d/exec';

  const me = document.currentScript;
  const root = new URL('..', me ? me.src : location.href);
  const arabic = (document.documentElement.lang || '').startsWith('ar');
  const privacyUrl = new URL(arabic ? 'ar/privacy.html' : 'privacy.html', root).href;
  const local = location.protocol === 'file:' || /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const gpc = navigator.globalPrivacyControl === true;

  const page = (location.pathname.replace(/^\/+/, '').replace(/\/$/, '/index').replace(/\.html$/, '') || 'index');
  const release = (document.body && document.body.dataset.uxVersion) || page;
  const slug = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const store = (area, key, value) => { try { if (value === undefined) return window[area].getItem(key); if (value === null) window[area].removeItem(key); else window[area].setItem(key, value); } catch (_) {} return null; };
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
  document.head.append(counter);

  // ---- all: one visit, linked page to page ----
  let journey = null;
  const startJourney = () => {
    if (journey || !journeysOn()) return;
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
    const params = new URLSearchParams(location.search);
    let ref = '';
    try { const from = new URL(document.referrer); if (from.hostname !== location.hostname) ref = from.hostname; } catch (_) {}
    const width = window.innerWidth;
    journey = {
      start: visit.start,
      head: {v: 1, sid: visit.id, vid: visitor.id, vn: visitor.n, pv: random(), ux: release, page,
        lang: arabic ? 'ar' : 'en', device: width <= 640 ? 'phone' : width <= 1024 ? 'tablet' : 'desktop', ref,
        us: (params.get('utm_source') || '').slice(0, 60), um: (params.get('utm_medium') || '').slice(0, 60), uc: (params.get('utm_campaign') || '').slice(0, 60)},
      events: [],
    };
    note('view');
  };
  const note = name => {
    if (!journey) return;
    journey.events.push({n: name, t: Math.max(0, Math.round((Date.now() - journey.start) / 1000))});
    if (journey.events.length >= 40) send();
  };
  const send = () => {
    if (!journey || !journey.events.length) return;
    const body = new URLSearchParams({form_type: 'event', payload: JSON.stringify({...journey.head, ev: journey.events.splice(0)})});
    if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body))) {
      fetch(ENDPOINT, {method: 'POST', mode: 'no-cors', keepalive: true, body}).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
  window.addEventListener('pagehide', send);

  // One event, both tiers. Downloads keep their own names in GoatCounter.
  const track = name => { gc(`${name}@${release}`); note(name); };
  const once = new Set();
  const trackOnce = name => { if (!once.has(name)) { once.add(name); track(name); } };

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

  document.addEventListener('click', event => {
    const el = event.target.closest('a[href], button, [data-zoom]');
    if (!el) return;
    if (el.matches('a[href]')) {
      const download = downloadFor(el.href);
      if (download) { gc(download); track(download.startsWith('download-app-') ? 'download' : 'sample'); note(download); send(); return; }
      if (el.matches('.lang-switch')) return track('lang-switch');
      if (el.matches('.btn, .sb-btn, .nav-cta')) return track(`click-${target(el.getAttribute('href'))}`);
    }
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
  document.addEventListener('toggle', event => {
    const box = event.target;
    if (box.tagName !== 'DETAILS' || !box.open || !box.closest('.d-faq, #faq')) return;
    trackOnce(`faq-${[...box.parentElement.children].filter(el => el.tagName === 'DETAILS').indexOf(box) + 1}`);
  }, true);
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      seen.unobserve(entry.target);
      trackOnce(`reach-${slug(entry.target.id)}`);
    }), {rootMargin: '0px 0px -40% 0px'});
    document.querySelectorAll('main section[id]').forEach(section => seen.observe(section));
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
    if (choice === 'all') startJourney();
    else { send(); journey = null; store('sessionStorage', VISIT, null); store('localStorage', VISITOR, null); }
    if (bar) bar.hidden = true;
    status();
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
    css.href = new URL('css/consent.css?v=20261013-1', root).href;
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
  startJourney();
})();
