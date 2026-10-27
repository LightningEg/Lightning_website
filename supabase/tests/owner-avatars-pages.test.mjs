// The owner's "Remove a profile picture" form (admin.html, js/owner-avatars.js) in jsdom with a fake client.
// What the database allows is tested in avatars.test.mjs.
//
//   JSDOM_PATH=/path/to/jsdom/lib/api.js node supabase/tests/owner-avatars-pages.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { JSDOM, VirtualConsole } = process.env.JSDOM_PATH ? await import(pathToFileURL(process.env.JSDOM_PATH).href).then(m => m.default ?? m) : await import('jsdom');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const html = read('admin.html').replace(/<script[\s\S]*?<\/script>/g, '');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
const PATH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90/avatar';

async function boot({ rpcResult = { data: PATH, error: null }, removeResult = { error: null } } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://lightningeg.com/admin.html#members', virtualConsole: new VirtualConsole() });
  const w = dom.window, calls = [];
  w.FG = { say: e => e.message, sb: {
    rpc: async (name, args) => { calls.push({ fn: name, args: JSON.parse(JSON.stringify(args)) }); return rpcResult; },
    storage: { from: bucket => ({ remove: async paths => { calls.push({ fn: 'remove', bucket, paths: [...paths] }); return removeResult; } }) } } };
  w.eval(read('js/owner-avatars.js'));
  w.document.getElementById('store-tools').disabled = false;
  const f = w.document.getElementById('admin-avatar-form');
  f.elements.email.value = 'ada@example.test'; f.elements.reason.value = 'offensive picture';
  f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  return { w, calls, out: w.document.getElementById('admin-avatar-status').textContent, form: f };
}

await test('it clears the link with a reason, then deletes the file the server named by its private path', async () => {
  const p = await boot();
  assert.deepEqual(p.calls, [{ fn: 'admin_remove_avatar', args: { p_email: 'ada@example.test', p_reason: 'offensive picture' } }, { fn: 'remove', bucket: 'avatars', paths: [PATH] }]);
  assert.match(p.out, /Picture removed/);
  assert.equal(p.form.elements.email.value, '', 'the form is cleared');
});

await test('a refusal is said plainly and no file is touched', async () => {
  const p = await boot({ rpcResult: { data: null, error: { message: 'no member with that email' } } });
  assert.equal(p.calls.some(c => c.fn === 'remove'), false);
  assert.match(p.out, /no member with that email/);
});

await test('if the file cannot be deleted it says the picture is hidden anyway', async () => {
  const p = await boot({ removeResult: { error: { message: 'Storage unavailable' } } });
  assert.match(p.out, /hidden everywhere.*Storage unavailable/);
});

await test('a member who never uploaded has only a link to clear', async () => {
  const p = await boot({ rpcResult: { data: null, error: null } });
  assert.equal(p.calls.some(c => c.fn === 'remove'), false);
  assert.match(p.out, /no uploaded file/);
});

await test('it never deletes a path that is not a private picture key', async () => {
  const p = await boot({ rpcResult: { data: '../../other', error: null } });
  assert.equal(p.calls.some(c => c.fn === 'remove'), false);
  assert.match(p.out, /did not answer as expected/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
