// Owner-only writes to the app repository's issues. Two actions: set_status (ready|blocked|parked) and create_issue.
const REPO = 'LightningEg/Lightning', API = 'https://api.github.com/repos/' + REPO;
const STATUS = ['ready', 'blocked', 'parked'], WHEN = ['launch', 'after-launch', 'someday'];
export function roadmapWriteHandler({createClient, url, anonKey, token, fetch: gh, allowedOrigins = ['https://lightningeg.com', 'https://www.lightningeg.com']}) {
  return async req => {
    const origin = req.headers.get('origin');
    const headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS'};
    const reply = (status, body) => new Response(JSON.stringify(body), {status, headers});
    if (origin && !allowedOrigins.includes(origin)) return reply(403, {error: 'Origin not allowed'});
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (req.method !== 'POST') return reply(405, {error: 'Use POST'});
    const authorization = req.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return reply(401, {error: 'Sign in required'});
    if (!url || !anonKey) return reply(503, {error: 'The roadmap is unavailable'});
    if (!token) return reply(503, {error: 'The GitHub token is not set on the server yet'});
    let body;
    try {
      const text = await req.text();
      if (text.length > 20000) return reply(413, {error: 'Request too large'});
      body = JSON.parse(text);
    } catch { return reply(400, {error: 'Invalid request'}); }
    try {
      const db = createClient(url, anonKey, {global: {headers: {Authorization: authorization}}, auth: {persistSession: false, autoRefreshToken: false}});
      const who = await db.auth.getUser(authorization.slice(7));
      if (who.error || !who.data?.user) return reply(401, {error: 'Sign in required'});
      const ok = await db.rpc('admin_roadmap_access');
      if (ok.error || ok.data !== true) return reply(403, {error: 'Only the verified owner can change the roadmap'});
      const call = (path, method, payload) => gh(API + path, {method, headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'lightning-roadmap', 'Content-Type': 'application/json'}, body: payload ? JSON.stringify(payload) : undefined});
      if (body.action === 'set_status') {
        const n = Number(body.issue);
        if (!Number.isInteger(n) || n < 1 || !STATUS.includes(body.status)) return reply(400, {error: 'Pick an issue and ready, blocked or parked'});
        const cur = await call('/issues/' + n, 'GET');
        if (!cur.ok) return reply(502, {error: 'GitHub answered ' + cur.status});
        const issue = await cur.json();
        if (issue.pull_request) return reply(400, {error: 'That is a pull request'});
        const names = (issue.labels || []).map(l => l.name).filter(name => !name.startsWith('status:'));
        const put = await call('/issues/' + n + '/labels', 'PUT', {labels: names.concat('status:' + body.status)});
        return put.ok ? reply(200, {issue: n, status: body.status}) : reply(502, {error: 'GitHub answered ' + put.status});
      }
      if (body.action === 'create_issue') {
        const title = String(body.title || '').trim(), text = String(body.body || '').trim();
        if (title.length < 3 || title.length > 200) return reply(400, {error: 'Give the issue a title of 3 to 200 characters'});
        if (text.length > 8000) return reply(400, {error: 'Details are too long'});
        const labels = [];
        if (WHEN.includes(body.when)) labels.push('when:' + body.when);
        if (STATUS.includes(body.status)) labels.push('status:' + body.status);
        const made = await call('/issues', 'POST', {title, body: text, labels});
        if (!made.ok) return reply(502, {error: 'GitHub answered ' + made.status});
        const issue = await made.json();
        return reply(200, {issue: issue.number, url: issue.html_url});
      }
      return reply(400, {error: 'Unknown action'});
    } catch { return reply(503, {error: 'The roadmap change did not complete. Try again.'}); }
  };
}
