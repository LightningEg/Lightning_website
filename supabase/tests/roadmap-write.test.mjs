import assert from 'node:assert/strict';
import {roadmapWriteHandler} from '../functions/roadmap-write/handler.mjs';
function setup({existing = [], owner = true, user = true, token = 'ghp_test', labels = ['when:launch', 'status:ready', 'pillar:feel'], pr = false, github = 200} = {}) {
  const calls = [];
  const gh = async (u, o) => {
    calls.push([o.method, u.replace('https://api.github.com/repos/LightningEg/Lightning', ''), o.body && JSON.parse(o.body), o.headers.Authorization]);
    if (github !== 200) return new Response('{}', {status: github});
    if (o.method === 'GET' && u.includes('state=open')) return Response.json(existing);
    if (o.method === 'PATCH') return Response.json({});
    if (o.method === 'GET') return Response.json({labels: labels.map(name => ({name})), pull_request: pr ? {} : undefined});
    if (o.method === 'POST') return Response.json({number: 700, html_url: 'https://github.com/LightningEg/Lightning/issues/700'});
    return Response.json([]);
  };
  const handler = roadmapWriteHandler({url: 'https://example.test', anonKey: 'public', token, fetch: gh,
    createClient: () => ({auth: {getUser: async () => ({data: {user: user ? {id: 'u'} : null}, error: null})}, rpc: async name => { calls.push([name]); return {data: owner, error: null}; }})});
  return {handler, calls};
}
const req = (body, headers = {}) => new Request('https://example.test/roadmap-write', {method: 'POST', headers: {authorization: 'Bearer jwt', 'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
let p = setup(); assert.equal((await p.handler(req({}, {authorization: ''}))).status, 401); assert.equal(p.calls.length, 0);
p = setup(); assert.equal((await p.handler(req({}, {origin: 'https://evil.test'}))).status, 403);
p = setup({user: false}); assert.equal((await p.handler(req({action: 'set_status', issue: 1, status: 'parked'}))).status, 401);
p = setup({owner: false}); assert.equal((await p.handler(req({action: 'set_status', issue: 1, status: 'parked'}))).status, 403); assert.equal(p.calls.some(c => c[0] === 'PUT'), false, 'a non-owner never reaches GitHub');
p = setup({token: ''}); assert.equal((await p.handler(req({action: 'set_status', issue: 1, status: 'parked'}))).status, 503);
p = setup(); assert.equal((await p.handler(req({action: 'set_status', issue: 1, status: 'done'}))).status, 400); assert.equal(p.calls.some(c => c[0] === 'PUT'), false);
p = setup(); let r = await p.handler(req({action: 'set_status', issue: 614, status: 'parked'}));
assert.equal(r.status, 200); assert.deepEqual(p.calls.find(c => c[0] === 'PUT')[2], {labels: ['when:launch', 'pillar:feel', 'status:parked']}, 'the old status label is replaced, the others kept');
assert.equal(p.calls.find(c => c[0] === 'PUT')[3], 'Bearer ghp_test');
p = setup({pr: true}); assert.equal((await p.handler(req({action: 'set_status', issue: 616, status: 'ready'}))).status, 400);
p = setup(); r = await p.handler(req({action: 'create_issue', title: ' Fix the thing ', body: 'Details', when: 'launch', status: 'ready', labels: ['admin']}));
assert.equal(r.status, 200); assert.deepEqual(await r.json(), {issue: 700, url: 'https://github.com/LightningEg/Lightning/issues/700'});
assert.deepEqual(p.calls.find(c => c[0] === 'POST')[2], {title: 'Fix the thing', body: 'Details', labels: ['when:launch', 'status:ready']}, 'only known labels are ever sent');
p = setup(); assert.equal((await p.handler(req({action: 'create_issue', title: 'x'}))).status, 400);
p = setup({github: 500}); assert.equal((await p.handler(req({action: 'create_issue', title: 'A real title'}))).status, 502);
p = setup(); r = await p.handler(req({action: 'set_order', order: [614, 615, 3]}));
assert.equal(r.status, 200);
let post = p.calls.find(c => c[0] === 'POST');
assert.equal(post[2].title, '[PRIORITY] Order'); assert.match(post[2].body, /1\. #614\n2\. #615\n3\. #3\n/, 'no order issue yet, so one is made');
p = setup({existing: [{number: 700, title: '[PRIORITY] Order'}, {number: 5, title: 'x'}]}); assert.equal((await p.handler(req({action: 'set_order', order: [2, 1]}))).status, 200);
assert.equal(p.calls.find(c => c[0] === 'PATCH')[1], '/issues/700'); assert.equal(p.calls.some(c => c[0] === 'POST'), false, 'the existing order issue is edited, not duplicated');
for (const bad of [[], [1, 1], [0], ['x'], 'no', Array.from({length: 401}, (_, i) => i + 1)]) { p = setup(); assert.equal((await p.handler(req({action: 'set_order', order: bad}))).status, 400); assert.equal(p.calls.some(c => c[0] === 'POST' || c[0] === 'PATCH'), false); }
p = setup({owner: false}); assert.equal((await p.handler(req({action: 'set_order', order: [1]}))).status, 403);
console.log('Roadmap write edge: owner-only, MFA, bounded input, status label replaced, issue filing and origin checks passed');
