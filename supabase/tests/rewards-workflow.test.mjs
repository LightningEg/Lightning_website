// The rewards workflow (8Q part 1): every merge counts and the safety rules stay. The app repository's
// tests/test_rewards_workflow.py checks its twin the same way.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = readFileSync(new URL('../../.github/workflows/rewards.yml', import.meta.url), 'utf8');
const job = text.slice(text.indexOf('\n  merged:'));
const body = job.slice(job.indexOf('      - run: |'));
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
}

test('a merge with no issue still reaches record_merge; coins only follow when an issue was closed', () => {
  const other = body.slice(body.indexOf('          else\n'));
  assert.ok(other.includes('rpc record_merge'));
  assert.ok(!other.slice(0, other.indexOf('rpc record_merge')).includes('exit 0'), 'no early exit before the merge is recorded');
  assert.ok(other.indexOf('rpc record_merge') < other.indexOf('rpc award_merge'));
  assert.ok(other.slice(other.indexOf('rpc record_merge'), other.indexOf('rpc award_merge')).includes('"$issues" == "[]"'));
  assert.ok(!body.slice(0, body.indexOf('if [[ "$AUTHOR_TYPE"')).includes('exit 0'), 'no early exit at the top');
});

test('the size is additions plus deletions from the file list, without lockfiles and generated files', () => {
  assert.ok(body.includes('gh pr view "$PR" --json files'));
  for (const p of ['\\\\.lock$', 'lock\\\\.json$', '\\\\.generated\\\\.', '\\\\.min\\\\.']) assert.ok(body.includes(p), p);
  assert.ok(body.includes('p_lines:$lines'));
});

test('bots and the owner never reach record_merge; the safety rules stay', () => {
  const owner = body.slice(body.indexOf('if [[ "$AUTHOR_TYPE"'), body.indexOf('          else\n'));
  assert.ok(!owner.includes('record_merge') && !owner.includes('award_merge') && owner.includes('close_rewarded_issues'));
  assert.ok(!text.includes('actions/checkout'));
  assert.ok(!body.includes('${{'), 'values reach the shell through env, never through ${{ }} in the script');
  assert.ok(text.includes('pull_request_target') && body.includes('jq -nc'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
