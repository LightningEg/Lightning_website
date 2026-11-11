// Google Play purchase → signed theme licence (app repo NF-11B3). The Play build buys a theme with Play Billing, then sends
// the purchase token here. This asks Google (Play Developer API, purchases.products.get) whether the token is a paid
// purchase of that theme, not refunded or voided, keeps it (redeem_play_purchase: one purchase unlocks every profile of
// that Google account, up to 5; NF-10H1, owner 2026-11-09, cap 2026-11-11), acknowledges it so Google does not refund it after three
// days, and returns the same signed licence redeem-purchase returns, naming the profile that asked.
// Deploy with verify_jwt=false: native clients have no website account; Google's answer is the authority.
//
// Secrets: GOOGLE_PLAY_SERVICE_ACCOUNT (the service account JSON with access to the app in Play Console),
// PLAY_PACKAGE_NAME (org.lightning.app), STORE_SIGNING_PRIVATE_JWK and STORE_SIGNING_KEY_ID (as redeem-purchase).
import {signInventory} from '../restore-purchases/license.mjs';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PROFILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRODUCT = /^[a-z0-9][a-z0-9._-]{0,59}$/;
const LIMIT = 4096;

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const text64 = s => b64url(new TextEncoder().encode(s));

/** An OAuth access token for the Play Developer API from the service account (RS256 JWT bearer grant). */
export async function googleAccessToken(account, fetcher, now = Date.now()) {
  const pem = String(account.private_key || '').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const claims = {iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: TOKEN_URL, iat, exp: iat + 600};
  const unsigned = text64(JSON.stringify({alg: 'RS256', typ: 'JWT'})) + '.' + text64(JSON.stringify(claims));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetcher(TOKEN_URL, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + b64url(signature)})});
  if (!response.ok) throw new Error('google token');
  return (await response.json()).access_token;
}

/** Whether Google lists this token as voided (refunded, charged back or revoked) in its Voided Purchases API, which
 *  keeps the last 30 days. Reads at most 5 pages; a failure throws, so a purchase is never unlocked unchecked. */
export async function voided(pkg, token, auth, fetcher) {
  let page = '';
  for (let i = 0; i < 5; i++) {
    const url = `${API}/${encodeURIComponent(pkg)}/purchases/voidedpurchases?maxResults=1000${page ? '&token=' + encodeURIComponent(page) : ''}`;
    const response = await fetcher(url, {headers: auth});
    if (!response.ok) throw new Error('voided purchases');
    const body = await response.json();
    if ((body.voidedPurchases || []).some(v => v && v.purchaseToken === token)) return true;
    page = body.tokenPagination?.nextPageToken || '';
    if (!page) return false;
  }
  return false;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function boundedJson(req) {
  if (Number(req.headers.get('content-length') || 0) > LIMIT) return null;
  const reader = req.body?.getReader();
  if (!reader) return undefined;
  let bytes = 0; const chunks = [];
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > LIMIT) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const raw = new Uint8Array(bytes); let at = 0;
  for (const c of chunks) { raw.set(c, at); at += c.length; }
  return JSON.parse(new TextDecoder().decode(raw));
}

export function redeemPlayHandler({env, fetcher = fetch, rpc}) {
  return async req => {
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};
    const reply = (status, data) => new Response(JSON.stringify(data), {status, headers});
    if (req.method !== 'POST') return reply(405, {error: 'Use POST'});
    if (req.headers.get('origin')) return reply(403, {error: 'Use the Lightning app'});
    const accountJson = env('GOOGLE_PLAY_SERVICE_ACCOUNT'), pkg = env('PLAY_PACKAGE_NAME');
    const secret = env('STORE_SIGNING_PRIVATE_JWK'), keyId = env('STORE_SIGNING_KEY_ID');
    if (!accountJson || !pkg || !secret || !keyId || !/^[a-zA-Z0-9._-]{1,80}$/.test(keyId)) return reply(503, {error: 'Play purchases are not configured'});
    let body;
    try { body = await boundedJson(req); } catch { return reply(400, {error: 'Invalid purchase'}); }
    if (body === null) return reply(413, {error: 'Request too large'});
    if (!body || body.package_name !== pkg || typeof body.product_id !== 'string' || !PRODUCT.test(body.product_id)
        || typeof body.purchase_token !== 'string' || body.purchase_token.length < 10 || body.purchase_token.length > 1000)
      return reply(400, {error: 'Invalid purchase'});
    if (typeof body.profile_id !== 'string' || !PROFILE.test(body.profile_id)) return reply(400, {error: 'Update Lightning: the app did not say which profile this is.'});
    const items = Array.isArray(body.items) && body.items.length >= 1 && body.items.length <= 50
      && body.items.every(i => i && typeof i.item_id === 'string' && i.item_id.length <= 60 && Number.isInteger(i.asset_version))
      ? body.items.map(i => ({item_id: i.item_id, asset_version: i.asset_version})) : null;
    if (!items) return reply(400, {error: 'Invalid purchase'});
    try {
      const jwk = JSON.parse(secret);
      await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['sign']);
      const access = await googleAccessToken(JSON.parse(accountJson), fetcher);
      const at = `${API}/${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(body.product_id)}/tokens/${encodeURIComponent(body.purchase_token)}`;
      const auth = {Authorization: `Bearer ${access}`};
      const google = await fetcher(at, {headers: auth});
      if (google.status === 404 || google.status === 400 || google.status === 410) return reply(400, {error: 'Google Play does not know this purchase.'});
      if (!google.ok) return reply(502, {error: 'Google Play is not answering right now. Try again in a few minutes.'});
      const purchase = await google.json();
      // 0 purchased, 1 cancelled (refunded or revoked), 2 pending (not paid yet).
      if (purchase.purchaseState === 2) return reply(402, {code: 'pending', error: 'The payment is not finished yet. It unlocks when Google Play confirms it.'});
      if (purchase.purchaseState !== 0) return reply(410, {code: 'refunded', error: 'This purchase was refunded or cancelled.'});
      // One purchase per person: any profile opened with the buying Google account may ask (its Play app reports the
      // token owned); Play's obfuscated profile id names only the first. The cap below stops a shared token.
      if (await voided(pkg, body.purchase_token, auth, fetcher)) return reply(410, {code: 'refunded', error: 'This purchase was refunded or cancelled.'});
      const {data, error} = await rpc('redeem_play_purchase', {p_token_sha256: await sha256Hex(body.purchase_token),
        p_order_id: String(purchase.orderId || '').slice(0, 80) || 'no-order', p_item_id: body.product_id, p_profile_id: body.profile_id, p_items: items});
      if (error && /unsupported bundled item/.test(String(error.message))) return reply(422, {code: 'update_app', error: 'Update Lightning to wear this theme.'});
      if (error && /unlocks \d+ profiles/.test(String(error.message))) return reply(409, {code: 'profile_cap', error: 'This purchase already unlocks 5 profiles.'});
      if (error) return reply(400, {error: 'Could not unlock this purchase.'});
      if (purchase.acknowledgementState !== 1) {
        const ack = await fetcher(`${at}:acknowledge`, {method: 'POST', headers: {...auth, 'Content-Type': 'application/json'}, body: '{}'});
        if (!ack.ok) return reply(502, {error: 'Google Play is not answering right now. Try again in a few minutes.'});
      }
      return reply(200, await signInventory(data, jwk, keyId));
    } catch {
      return reply(503, {error: 'Play purchases are not available right now. Try again in a few minutes.'});
    }
  };
}
