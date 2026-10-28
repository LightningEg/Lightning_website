// Client test: store pages also send their page view to Lightning's database (site_track), without the linked-visit
// ids; every other page sends only to the receiver. Try it, Details and a short wallet are counted by name.
//   node analytics/tests/client-store.js
let pw; try { pw = require('playwright'); } catch (_) { pw = require(process.env.PLAYWRIGHT_MODULE || require('child_process').execSync('npm root -g').toString().trim() + '/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const types = { html: 'text/html', css: 'text/css', js: 'application/javascript', svg: 'image/svg+xml', json: 'application/json' };
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {});
  let bad = 0;
  const check = (ok, label) => { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) bad = 1; };
  async function visit(page, consent, act) {
    const ctx = await b.newContext();
    await ctx.addInitScript(c => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      if (c) localStorage.setItem('lightning-consent', JSON.stringify({ choice: c, policy: 2, date: '2026-10-28' }));
      navigator.sendBeacon = () => true;
    }, consent);
    const db = [];
    await ctx.route('**/*', route => {
      const req = route.request(), u = new URL(req.url());
      if (u.pathname.endsWith('/rest/v1/rpc/site_track')) { db.push({ body: JSON.parse(req.postData() || '{}'), key: req.headers().apikey }); return route.fulfill({ status: 204, body: '' }); }
      if (u.hostname !== 'lightningeg.test') return route.fulfill({ body: '' });
      const f = path.join(ROOT, decodeURIComponent(u.pathname));
      route.fulfill({ body: fs.existsSync(f) ? fs.readFileSync(f) : '', contentType: types[f.split('.').pop()] || 'application/octet-stream' });
    });
    const p = await ctx.newPage();
    await p.goto('http://lightningeg.test/' + page);
    await p.waitForTimeout(400);
    if (act) await p.evaluate(act);
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(300);
    await ctx.close();
    return db;
  }

  const store = await visit('marketplace.html', 'all', () => { window.LightningTrack('store-try-nile'); window.LightningTrack('store-short', true); window.LightningTrack('<b>x</b>'); });
  const rec = store.length && store[store.length - 1].body.p;
  check(store.length > 0 && rec.page === 'marketplace', 'the marketplace sends its page view to site_track');
  check(store.length > 0 && store[0].key && store[0].key.startsWith('sb_publishable_'), 'with the publishable key only');
  check(rec && !('sid' in rec) && !('vid' in rec) && !('vn' in rec) && !('ev' in rec), 'never the linked-visit ids, even with Allow all');
  const codes = rec ? rec.tl.map(e => e[0]) : [];
  check(codes.includes('store-try-nile') && codes.includes('store-short'), 'Try it and a short wallet are counted by name');
  check(codes.includes('b-x-b'), 'a name is reduced to letters, digits and hyphens');
  check((await visit('index.html', 'all')).length === 0, 'Home sends nothing to site_track');
  check((await visit('ar/index.html', 'essential')).length === 0, 'Arabic Home sends nothing to site_track');
  for (const page of ['stories.html', 'leaderboard.html', 'account.html', 'topup.html', 'collection.html', 'ar/marketplace.html'])
    check(fs.readFileSync(path.join(ROOT, page), 'utf8').includes('js/analytics.js'), page + ' loads analytics');
  check(!fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8').includes('js/analytics.js'), 'the owner console loads no analytics');
  await b.close();
  process.exit(bad);
})();
