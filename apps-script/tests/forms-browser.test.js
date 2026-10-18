// Local browser integration; the remote receiver is mocked, never receives test data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../..');
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {});
  try {
    for (const url of (process.argv[2] ? [process.argv[2]] : ['index.html', 'survey.html', 'ar/survey.html', 'app-feedback.html'])) {
      const ctx = await browser.newContext(); let reply = { ok: true }, submitted;
      await ctx.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.hostname === 'script.google.com') {
          if (route.request().method() !== 'POST') return route.fulfill({ body: '' });
          const params = new URLSearchParams(route.request().postData() || '');
          if (params.get('form_type') === 'event') return route.fulfill({ body: 'ok', headers: { 'access-control-allow-origin': '*' } });
          assert.equal(route.request().method(), 'POST'); assert.equal(u.search, '');
          assert.match(params.get('form_session'), /^[a-f0-9]{32}$/); assert.ok(Number(params.get('started_at')) > 0);
          assert.equal(params.get('website'), ''); submitted = params;
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(reply), headers: { 'access-control-allow-origin': '*' } });
        }
        if (u.hostname !== 'lightningeg.test') return route.fulfill({ body: '' });
        const file = path.join(ROOT, decodeURIComponent(u.pathname));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const types = { html: 'text/html', js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml' };
        return route.fulfill({ body: fs.readFileSync(file), contentType: types[file.split('.').pop()] || 'application/octet-stream' });
      });
      const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://lightningeg.test/' + url);
      await page.waitForFunction(() => window.LightningForms);
      if (url.includes('survey')) {
        await page.fill('[name=biggest_problem]', '=1+1');
        await page.click('#finance-survey [type=submit]');
        await page.waitForFunction(() => !/Sending|بنبعت/.test(document.querySelector('#survey-status').textContent) && document.querySelector('#survey-status').textContent.length > 0);
        assert.equal(submitted.get('form_type'), 'survey'); assert.equal(submitted.get('biggest_problem'), '=1+1');
      } else if (url === 'app-feedback.html') {
        await page.selectOption('[name=app_build]', '1.3.0-windows');
        await page.selectOption('[name=section]', 'Overview');
        await page.check('input[value=Bug]'); await page.check('input[value=Technical]');
        await page.fill('textarea[name=description]', '=1+1');
        await page.click('#app-feedback-form [type=submit]');
        await page.waitForFunction(() => /Thank you/.test(document.querySelector('.status-feedback__status').textContent));
        assert.equal(submitted.get('form_type'), 'app_feedback');
      } else {
        await page.fill('#signup-email', 'test@example.invalid');
        await page.click('#email-signup [type=submit]');
        await page.waitForFunction(() => /on the list/.test(document.querySelector('#signup-status').textContent));
        assert.equal(submitted.get('form_type'), 'signup');
        reply = { ok: false, error: 'rate_limit' };
        await page.fill('#signup-email', 'another@example.invalid');
        await page.click('#email-signup [type=submit]');
        await page.waitForFunction(() => document.querySelector('#signup-status').classList.contains('is-error'));
        assert.equal(await page.inputValue('#signup-email'), 'another@example.invalid');
        // UX uses the same confirmed delivery path even though it is not an HTML form.
        reply = { ok: true };
        await page.evaluate(async () => window.LightningForms.send(document.body.dataset.uxEndpoint,
          new URLSearchParams({ form_type: 'ux_test', feedback_json: '[{"reaction":"liked"}]' }), document.querySelector('.ux-rail')));
        assert.equal(submitted.get('form_type'), 'ux_test');
      }
      assert.deepEqual(errors, []); console.log('PASS confirmed form delivery:', url);
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
