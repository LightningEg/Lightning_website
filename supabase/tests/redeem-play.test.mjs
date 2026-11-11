// Play purchases (NF-11B3, NF-10H1): the edge function accepts a paid purchase of a theme for any profile of the buying
// Google account, acknowledges it and returns a licence that verifies; it refuses a refunded, voided, pending or
// over-cap purchase.
// No network and no live keys: Google is a fake fetch, the service account and signing keys are made here.
//
//   node supabase/tests/redeem-play.test.mjs
import assert from 'node:assert/strict';
import {redeemPlayHandler} from '../functions/redeem-play/handler.mjs';

const rsa = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', rsa.privateKey)).toString('base64');
const account = {client_email: 'play@test.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`};
const ed = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', ed.privateKey);
const PROFILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENV = {GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(account), PLAY_PACKAGE_NAME: 'org.lightning.app',
  STORE_SIGNING_PRIVATE_JWK: JSON.stringify(jwk), STORE_SIGNING_KEY_ID: 'test-key'};

function setup({purchase = {purchaseState: 0, acknowledgementState: 0, orderId: 'GPA.1', obfuscatedExternalProfileId: PROFILE}, status = 200, env = ENV, voidedTokens = [], voidedStatus = 200} = {}) {
  const calls = [], profiles = new Map();
  const fetcher = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url)]);
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      const assertion = new URLSearchParams(init.body).get('assertion');
      const [h, c, s] = assertion.split('.');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', rsa.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(h + '.' + c));
      assert.ok(ok, 'the JWT is signed by the service account');
      assert.equal(JSON.parse(Buffer.from(c, 'base64url')).scope, 'https://www.googleapis.com/auth/androidpublisher');
      return new Response(JSON.stringify({access_token: 'ya29.test'}));
    }
    assert.equal(init.headers.Authorization, 'Bearer ya29.test');
    if (String(url).endsWith(':acknowledge')) return new Response('{}');
    if (String(url).includes('/purchases/voidedpurchases')) return new Response(JSON.stringify(
      {voidedPurchases: voidedTokens.map(purchaseToken => ({purchaseToken}))}), {status: voidedStatus});
    return new Response(JSON.stringify(purchase), {status});
  };
  const rpc = async (name, args) => {
    calls.push(['rpc', name]);
    const seen = profiles.get(args.p_token_sha256) || new Set();
    if (!seen.has(args.p_profile_id) && seen.size >= 5) return {data: null, error: {message: 'this purchase already unlocks 5 profiles'}};
    seen.add(args.p_profile_id); profiles.set(args.p_token_sha256, seen);
    assert.match(args.p_token_sha256, /^[0-9a-f]{64}$/, 'only the token hash reaches the database');
    return {data: {schema_version: 1, account_id: '00000000-0000-4000-8000-000000000009', profile_id: args.p_profile_id,
      items: [{item_id: args.p_item_id, asset_version: 1, deliveries: []}]}, error: null};
  };
  return {handler: redeemPlayHandler({env: name => env[name], fetcher, rpc}), calls};
}
const request = (body = {}, headers = {}) => new Request('https://example.test/redeem-play', {method: 'POST',
  headers: {'content-type': 'application/json', ...headers},
  body: JSON.stringify({package_name: 'org.lightning.app', product_id: 'papyrus', purchase_token: 'token-abcdefghijkl',
    profile_id: PROFILE, items: [{item_id: 'papyrus', asset_version: 1}], ...body})});

let p = setup(); let r = await p.handler(request());
assert.equal(r.status, 200);
const licence = await r.json();
assert.ok(await crypto.subtle.verify('Ed25519', ed.publicKey, Buffer.from(licence.signature, 'base64url'), new TextEncoder().encode(licence.payload)));
assert.equal(JSON.parse(licence.payload).profile_id, PROFILE);
assert.ok(p.calls.some(c => c[0] === 'POST' && c[1].endsWith('/purchases/products/papyrus/tokens/token-abcdefghijkl:acknowledge')), 'acknowledged');

p = setup({purchase: {purchaseState: 0, acknowledgementState: 1, orderId: 'GPA.1', obfuscatedExternalProfileId: PROFILE}});
assert.equal((await p.handler(request())).status, 200);
assert.equal(p.calls.some(c => c[1].endsWith(':acknowledge')), false, 'an acknowledged purchase is not acknowledged again');

// One purchase per person (case 2): another profile of the same Google account gets its own licence, no payment.
p = setup(); assert.equal((await p.handler(request())).status, 200);
r = await p.handler(request({profile_id: OTHER}));
assert.equal(r.status, 200, 'a second profile of the buyer is licensed');
assert.equal(JSON.parse((await r.json()).payload).profile_id, OTHER);
// Case 12: the sixth profile is refused with the cap named.
p = setup({purchase: {purchaseState: 0, acknowledgementState: 1, orderId: 'GPA.2'}});
const profileN = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
for (let n = 1; n <= 5; n++) assert.equal((await p.handler(request({profile_id: profileN(n)}))).status, 200);
r = await p.handler(request({profile_id: profileN(6)}));
assert.equal(r.status, 409); assert.equal((await r.json()).code, 'profile_cap');
// Case 11: a voided purchase (refund or chargeback, Voided Purchases API) mints nothing.
p = setup({voidedTokens: ['token-abcdefghijkl']});
r = await p.handler(request()); assert.equal(r.status, 410);
assert.equal(p.calls.some(c => c[0] === 'rpc'), false, 'a voided purchase never reaches the database');
p = setup({voidedStatus: 500}); assert.equal((await p.handler(request())).status, 503, 'never unlocked unchecked');

p = setup({purchase: {purchaseState: 1, acknowledgementState: 1, orderId: 'GPA.3', obfuscatedExternalProfileId: PROFILE}});
r = await p.handler(request()); assert.equal(r.status, 410); assert.equal((await r.json()).code, 'refunded');
assert.equal(p.calls.some(c => c[0] === 'rpc'), false, 'a refunded purchase never reaches the database');
p = setup({purchase: {purchaseState: 2, orderId: 'GPA.4', obfuscatedExternalProfileId: PROFILE}});
assert.equal((await p.handler(request())).status, 402);
p = setup({status: 404}); assert.equal((await p.handler(request())).status, 400, 'a made-up token');

p = setup(); assert.equal((await p.handler(request({}, {origin: 'https://evil.test'}))).status, 403);
assert.equal((await p.handler(request({package_name: 'com.other'}))).status, 400);
assert.equal((await p.handler(request({product_id: '../x'}))).status, 400);
assert.equal((await p.handler(request({profile_id: 'nope'}))).status, 400);
assert.equal((await p.handler(request({purchase_token: 'x'.repeat(5000)}))).status, 413);
assert.equal(p.calls.length, 0, 'nothing asked of Google for a bad request');
p = setup({env: {...ENV, GOOGLE_PLAY_SERVICE_ACCOUNT: undefined}}); assert.equal((await p.handler(request())).status, 503);
console.log('redeem-play: paid purchase verified, acknowledged and licensed; every profile of the buyer licensed up to 5; refunded, voided, pending and malformed requests refused');
