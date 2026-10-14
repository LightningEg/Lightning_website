// Dashboard smoke test: serves the site locally, answers the receiver with generated data, renders light and dark.
//   node analytics/tests/gen-data.js /tmp/dash-data.json && node analytics/tests/dashboard-smoke.js /tmp/dash-data.json /tmp
// Needs Playwright (npm i -g playwright, or the preinstalled one in Claude Code cloud sessions).
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), OUT = process.argv[3] || require('os').tmpdir();
const DATA = JSON.parse(fs.readFileSync(process.argv[2]));
const types = { html: 'text/html', css: 'text/css', js: 'application/javascript', svg: 'image/svg+xml', json: 'application/json', png: 'image/png', webp: 'image/webp' };
(async () => {
  const b = await chromium.launch();
  for (const [name, vp, dark] of [['dash-full', { width: 1280, height: 900 }, false], ['dash-full-phone', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext({ viewport: vp, colorScheme: dark ? 'dark' : 'light' });
    await ctx.route('**/*', route => { const u = new URL(route.request().url());
      if (u.hostname === 'script.google.com') { const q = u.searchParams; const body = q.get('key') !== DATA.key ? { error: 'forbidden' } : q.get('what') === 'counts' ? DATA.counts : q.get('what') === 'insights' ? DATA.insights : DATA.journeys; return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }); }
      if (u.hostname !== 'lightningeg.test') return route.fulfill({ body: '' });
      const f = path.join(ROOT, decodeURIComponent(u.pathname)); if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ body: fs.readFileSync(f), contentType: types[f.split('.').pop()] || 'application/octet-stream' }); });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://lightningeg.test/analytics/dashboard.html'); await p.waitForSelector('#key');
    await p.fill('#key', DATA.key); await p.click('#key-form button'); await p.waitForSelector('.dash-tile'); await p.waitForTimeout(900);
    console.log(name, 'errors:', errs.length ? errs : 'none', '| hscroll', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    if (name === 'dash-full') {
      console.log('FIND:\n  ' + (await p.innerText('#find')).split('\n').filter(Boolean).slice(0, 14).join('\n  '));
      console.log('HESITATE:\n  ' + (await p.innerText('#hesitate')).split('\n').filter(Boolean).slice(0, 18).join('\n  '));
      console.log('BROKEN:\n  ' + (await p.innerText('#broken')).split('\n').filter(Boolean).slice(0, 12).join('\n  '));
      console.log('REAL DOWNLOADS:\n  ' + (await p.innerText('#real-downloads')).split('\n').filter(Boolean).join(' | '));
      console.log('FUNNEL options:', await p.$$eval('#release option', o => o.map(x => x.textContent).join(' ; ')));
    }
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    await ctx.close();
  }
  await b.close();
})();
