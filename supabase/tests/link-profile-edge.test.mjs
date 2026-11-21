// The link-profile edge function (NF-10H6): native clients only, a bounded body, the code and profile id checked before
// the database is asked, and each refusal worded for the app. The database function has its own test
// (link-profile.test.mjs).
//
//   node supabase/tests/link-profile-edge.test.mjs
import assert from 'node:assert/strict';
import {linkProfileHandler} from '../functions/link-profile/handler.mjs';

const PROFILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const request = (body = {}, headers = {}) => new Request('https://example.test/link-profile', {method: 'POST',
  headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify({code: 'ABCDEF01-ABCDEF01-ABCDEF01-ABCDEF01', profile_id: PROFILE, ...body})});
function setup(answer = {data: {linked: true, items: ['nile']}, error: null}) {
  const calls = [];
  return {calls, handler: linkProfileHandler({rpc: async (name, args) => { calls.push([name, args]); if (answer instanceof Error) throw answer; return answer; }})};
}

let p = setup(); let r = await p.handler(request());
assert.equal(r.status, 200); assert.deepEqual(await r.json(), {linked: true, items: ['nile']});
assert.deepEqual(p.calls, [['link_app_profile', {p_code: 'ABCDEF01-ABCDEF01-ABCDEF01-ABCDEF01', p_profile_id: PROFILE}]]);

p = setup({data: null, error: {message: 'this profile belongs to another account'}});
r = await p.handler(request()); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'other_account');
p = setup({data: null, error: {message: 'invalid or expired link code'}});
assert.equal((await p.handler(request())).status, 400);
p = setup(new Error('down')); assert.equal((await p.handler(request())).status, 503);

p = setup();
assert.equal((await p.handler(request({}, {origin: 'https://evil.test'}))).status, 403);
assert.equal((await p.handler(new Request('https://example.test/link-profile'))).status, 405);
assert.equal((await p.handler(request({profile_id: 'nope'}))).status, 400);
assert.equal((await p.handler(request({code: 7}))).status, 400);
assert.equal((await p.handler(request({code: 'x'.repeat(2000)}))).status, 413);
assert.equal(p.calls.length, 0, 'nothing asked of the database for a bad request');
assert.equal((await linkProfileHandler({rpc: null})(request())).status, 503);
console.log('link-profile: native only, bounded, validated; links, and words another account, a used code and an outage');
