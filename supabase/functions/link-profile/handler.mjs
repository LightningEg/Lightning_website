// App profile → website account (app repo NF-10H6). The PC app (or the GitHub APK; the Play build never names the
// website) sends the one-time code from the account page's "Link the app" with its profile id. link_app_profile records
// the profile under that account and adds every theme a Google Play purchase unlocked on it to the account, owned
// through Play, inside the cap of 5. Deploy with verify_jwt=false: native clients have no website session; the one-time
// code is the authority, as in redeem-purchase.
const PROFILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIMIT = 1024;

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

export function linkProfileHandler({rpc}) {
  return async req => {
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};
    const reply = (status, data) => new Response(JSON.stringify(data), {status, headers});
    if (req.method !== 'POST') return reply(405, {error: 'Use POST'});
    if (req.headers.get('origin')) return reply(403, {error: 'Use the Lightning app'});
    if (!rpc) return reply(503, {error: 'Linking is not configured'});
    let body;
    try { body = await boundedJson(req); } catch { return reply(400, {error: 'Invalid code'}); }
    if (body === null) return reply(413, {error: 'Request too large'});
    if (!body || typeof body.code !== 'string' || body.code.length > 64) return reply(400, {error: 'Invalid code'});
    if (typeof body.profile_id !== 'string' || !PROFILE.test(body.profile_id)) return reply(400, {error: 'Update Lightning: the app did not say which profile this is.'});
    try {
      const {data, error} = await rpc('link_app_profile', {p_code: body.code, p_profile_id: body.profile_id});
      if (error && /another account/.test(String(error.message))) return reply(409, {code: 'other_account', error: 'This profile is linked to another website account.'});
      if (error) return reply(400, {error: 'That code is used or expired. Get a fresh one from your account page.'});
      return reply(200, {linked: true, items: Array.isArray(data?.items) ? data.items : []});
    } catch {
      return reply(503, {error: 'Linking is not available right now. Try again in a few minutes.'});
    }
  };
}
