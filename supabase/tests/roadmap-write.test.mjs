import assert from 'node:assert/strict';
import {roadmapWriteHandler} from '../functions/roadmap-write/handler.mjs';
function setup({owner = true, user = true, token = 'ghp_test', labels = ['when:launch', 'status:ready', 'pillar:feel'], pr = false, github = 200} = {}) {
  const calls = [];
  const gh = async (u, o) => {
    calls.push([o.method, u.replace('https://api.github.com/repos/LightningEg/Lightning', ''), o.body && JSON.parse(o.body), o.headers.Authorization]);
    if (github !== 200) return new Response('{}', {status: github});
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
console.log('Roadmap write edge: owner-only, MFA, bounded input, status label replaced, issue filing and origin checks passed');
