// Client test: the `from` field is the referring page of this site, 'outside', or empty; never a URL or query string.
//   node analytics/tests/client-from.js
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const types = { html: 'text/html', css: 'text/css', js: 'application/javascript', svg: 'image/svg+xml', json: 'application/json' };
(async () => {
  const b = await chromium.launch();
  let bad = 0;
  for (const [referrer, want, label] of [['http://lightningeg.test/features.html?x=1#top', 'features', 'same-site page'], ['http://lightningeg.test/ar/features', 'ar/features', 'Arabic page'], ['https://www.google.com/search?q=secret', 'outside', 'another site'], ['', '', 'no referrer']]) {
    const ctx = await b.newContext();
    await ctx.addInitScript(() => { window.__sent = []; navigator.sendBeacon = (u, body) => { window.__sent.push(String(body)); return true; }; });
    await ctx.route('**/*', route => { const u = new URL(route.request().url());
      if (u.hostname !== 'lightningeg.test') return route.fulfill({ body: '' });
      const f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)); if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ body: fs.readFileSync(f), contentType: types[f.split('.').pop()] || 'application/octet-stream' }); });
    const p = await ctx.newPage();
    await p.goto('http://lightningeg.test/index.html', referrer ? { referer: referrer } : {});
    await p.waitForTimeout(500);
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    const sent = await p.evaluate(() => window.__sent);
    const payload = sent.length ? JSON.parse(new URLSearchParams(sent[0]).get('payload')) : null;
    const good = payload && payload.from === want && !/[?#=]|https?:/.test(payload.from);
    console.log((good ? 'PASS ' : 'FAIL ') + label + ' -> ' + JSON.stringify(payload && payload.from));
    if (!good) bad = 1;
    await ctx.close();
  }
  await b.close(); process.exitCode = bad;
})();
