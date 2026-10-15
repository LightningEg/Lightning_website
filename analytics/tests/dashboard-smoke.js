// Dashboard smoke test: serves the site locally, answers the receiver with generated data, renders it at phone and
// desktop widths in light and dark, and checks the acceptance points of the decision dashboard.
//   node analytics/tests/gen-data.js /tmp/dash-data.json && node analytics/tests/dashboard-smoke.js /tmp/dash-data.json /tmp
// Needs Playwright (npm i -g playwright, or the preinstalled one in Claude Code cloud sessions).
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), OUT = process.argv[3] || require('os').tmpdir();
const DATA = JSON.parse(fs.readFileSync(process.argv[2]));
const types = { html: 'text/html', css: 'text/css', js: 'application/javascript', svg: 'image/svg+xml', json: 'application/json', png: 'image/png', webp: 'image/webp' };
const EXPECTED = /EXPECTED_SCRIPT_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'analytics', 'dashboard.html'), 'utf8'))[1];
let bad = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad = 1; };

// scenarios: what the receiver answers
const full = { insights: d => (d > 28 ? DATA.insights56 : DATA.insights28), counts: DATA.counts };
const stale = { insights: d => { const x = JSON.parse(JSON.stringify(d > 28 ? DATA.insights56 : DATA.insights28)); delete x.meta; delete x.daily; delete x.pages; delete x.by_release; delete x.arrivals; delete x.wrong_platform; return x; }, counts: DATA.counts };
const blank = { insights: () => ({ days: 28, views: 0, consent: { all: 0, essential: 0, undecided: 0, gpc: 0 }, scroll: {}, find: [], who: { device: [], lang: [], source: [], browser: [], os: [] }, reach: [], hesitate: { faq: [], dead: [], rage: 0 }, broken: { errors: [], speed: [] }, usage: [], download_builds: [], downloads_page: { views: 0, clicked: 0 }, meta: { script_version: EXPECTED, last_row_at: '', rows_today: 0, dropped_total: 0, sheet_rows: 0 }, daily: [], pages: [], by_release: [], arrivals: [], wrong_platform: { presses: 0, wrong: 0 } }), counts: { daily: [], events: [], downloads: [] } };

async function open(b, scenario, vp, dark) {
  const ctx = await b.newContext({ viewport: vp, colorScheme: dark ? 'dark' : 'light' });
  await ctx.route('**/*', route => { const u = new URL(route.request().url());
    if (u.hostname === 'script.google.com') { const q = u.searchParams, d = +q.get('days');
      const body = q.get('key') !== DATA.key ? { error: 'forbidden' } : q.get('what') === 'counts' ? scenario.counts : q.get('what') === 'insights' ? scenario.insights(d) : DATA.journeys;
      return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }); }
    if (u.hostname !== 'lightningeg.test') return route.fulfill({ body: '' });
    const f = path.join(ROOT, decodeURIComponent(u.pathname)); if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ body: fs.readFileSync(f), contentType: types[f.split('.').pop()] || 'application/octet-stream' }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://lightningeg.test/analytics/dashboard.html'); await p.waitForSelector('#key');
  await p.fill('#key', DATA.key); await p.click('#key-form button'); await p.waitForSelector('.dash-verdict'); await p.waitForTimeout(900);
  return { p, ctx, errs };
}

(async () => {
  const b = await chromium.launch();
  for (const [name, vp, dark] of [['desktop-light', { width: 1280, height: 900 }, false], ['desktop-dark', { width: 1280, height: 900 }, true], ['phone-light', { width: 390, height: 844 }, false], ['phone-dark', { width: 390, height: 844 }, true]]) {
    const { p, ctx, errs } = await open(b, full, vp, dark);
    ok(errs.length === 0, `${name}: no page errors ${errs.join(' | ')}`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `${name}: no horizontal page scroll`);
    if (name === 'desktop-light') {
      const t = s => p.innerText(s);
      const health = await t('#health');
      ok(/Script is current/.test(health) && /Last page view/.test(health) && /Full records since/.test(health) && /This browser is not counted/.test(health), 'health strip: script current, last page view, full records since, this browser not counted');
      const cards = await p.$$('.dash-verdict'); ok(cards.length >= 1 && cards.length <= 5, `verdicts: ${cards.length} cards`);
      ok(await p.$$eval('.dash-verdict', c => c.every(x => /^(Clear|Early sign|Too early)/.test(x.innerText) && x.querySelector('a[href^="#"]') && x.querySelectorAll('li').length)), 'every verdict has a certainty label, options and an evidence link');
      ok(await p.$$eval('.dash-verdict a', a => a.every(x => document.getElementById(x.getAttribute('href').slice(1)))), 'every evidence link points at a block on the page');
      const tiles = await p.$$eval('.dash-tile', x => x.map(e => e.innerText));
      ok(tiles.length === 5 && tiles.every(x => /(Up|Down|Same as before|No earlier period)/.test(x) || /Appears after|Snapshots start/.test(x)) && (await p.$$('.dash-tile svg')).length >= 4, 'five key numbers with previous-period words and sparklines');
      const path_ = await t('#path-box'); ok(/Downloads link was on screen/.test(path_) && /Pressed the Downloads link/.test(path_) && /On the Downloads page/.test(path_) && /Phone/.test(path_) && /Computer/.test(path_) && /another device/.test(path_), 'path: two places, per device, wrong platform');
      ok((path_.match(/\b(\d+)%/g) || []).every(x => parseInt(x, 10) <= 100), 'path: no share passes 100%');
      ok(/Allow-all visitors/.test(await t('#numbers-note')) && /fair comparison/.test(await t('#numbers-note')), 'key numbers: says the period is partly before full records and when a fair comparison starts');
      ok((await p.$$('#check-box code')).length >= 4 && /COUNTIFS\('Page views'!A:A|COUNTIFS\(/.test(await p.$eval('#check-box', e => e.textContent)), 'check: spreadsheet formulas for the key numbers');
      ok(await p.$eval('#check-box', e => /848|\d/.test(e.textContent)) && await p.$$eval('#check-box tbody tr', r => r[0].children[1].textContent) === await p.$eval('#tiles .dash-tile b', e => e.textContent), 'check: the page-view count beside its formula is the tile number');
      ok((await p.$$('#charts svg')).length === 4 && (await p.$$('#charts .tick')).length >= 1 && (await p.$$('#charts rect.bar')).length >= 100 && (await p.$$('#charts rect.bar.pre')).length >= 1, 'four bar charts, release ticks, grey days before full records');
      await p.hover('#charts svg rect.hit >> nth=5'); ok(await p.$eval('#charts .dash-tip', e => e.style.display === 'block' && /: \d+/.test(e.textContent)), 'chart hover shows a tooltip');
      await p.click('#charts button >> nth=0'); ok(await p.$eval('#charts table', e => !e.hidden), 'chart can be shown as a table');
      ok(/Reddit/.test(await t('#channels-box')) && /Arrivals/.test(await t('#channels-box')) && /Better|Worse|No clear difference/.test(await t('#channels-box')), 'channels list with a verdict');
      ok(/broken file|looks clickable|speed/.test(await t('#fix-box')), 'fix list has kinds of fix');
      ok(/biggest drop/i.test(await t('#drop-note')) && /\w+\?/.test(await t('#faq-box')), 'content: biggest drop in words, FAQ by question text');
      const rel = await t('#rel-box'); ok(/Before/.test(rel) && /Now/.test(rel) && /Higher|Lower|No clear difference/.test(rel), 'release comparison with verdicts');
      ok(await p.$eval('#details', e => !e.open), 'details are collapsed');
      const chips = await p.$$eval('#path-box .dash-chip, #channels-box .dash-chip, #rel-box .dash-chip', c => c.length); ok(chips > 10, `percentages carry a certainty label (${chips})`);
      const text = await p.innerText('body'); ok(!/[A-Z]{4,}/.test(text.replace(/GoatCounter|GitHub|FAQ|EGP|OWNER|UX-[\d.]+|APK|PC|URL/g, '')), 'no all-caps words on the page');
      ok(!/download button/i.test(text.replace(/pressed a download button/gi, '')), 'no card suggests adding a download button');
    }
    await p.screenshot({ path: `${OUT}/dash-${name}.png`, fullPage: true });
    await ctx.close();
  }
  { // an outdated receiver: the strip says so and the page still renders
    const { p, ctx, errs } = await open(b, stale, { width: 1280, height: 900 }, false);
    ok(/out of date/.test(await p.innerText('#health')) && await p.$eval('#health', e => e.classList.contains('dash-bad')), 'outdated script: the health strip is rose and says to update');
    ok(errs.length === 0 && (await p.$$('.dash-tile')).length >= 2 && (await p.$$('.dash-verdict')).length >= 1, 'outdated script: the page still renders from what exists');
    await ctx.close();
  }
  { // no data at all
    const { p, ctx, errs } = await open(b, blank, { width: 1280, height: 900 }, false);
    const cards = await p.$$eval('.dash-verdict', c => c.map(x => x.innerText));
    ok(errs.length === 0 && cards.length === 1 && /No page views yet|Nothing is clear yet/.test(cards[0]), 'no data: one honest card');
    ok((await p.$$('#path-box table, #channels-box table, #fix-box table')).length === 0, 'no data: no empty tables');
    const all = await p.innerText('body');
    ok(!/out of date|needs the latest receiver/.test(all) && /No page views recorded yet/.test(all) && !(await p.$eval('#health', e => e.classList.contains('dash-bad'))), 'no data from a current script: says none recorded yet, never "out of date"');
    await ctx.close();
  }
  await b.close(); process.exitCode = bad;
})();
