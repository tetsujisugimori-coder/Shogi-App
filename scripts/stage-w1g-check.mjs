import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assess, digest, FIXED_HEADS, requireNonFixedTargets, sha } from './stage-w1g-gate.mjs';
import { inspectFixed } from './stage-w1g-seal.mjs';

const gate = new URL('./stage-w1g-gate.mjs', import.meta.url);
const invoke = (script, ...args) => spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...args],
  { encoding: 'utf8' });
function healthy() {
  const now = 1_800_000_000_000;
  const inputs = { environment: sha('env'), sources: sha('remote trusted source bytes') };
  const seal = { at: now - 100, challenge: 'one-use-nonce', inputs };
  const expected = { ...inputs, sealDigest: digest(seal), challenge: seal.challenge,
    actor: 'pid=22,start=1799999999800,exe=sha256', usedChallenge: false, freshOutput: true };
  const start = { at: now - 80, seal: expected.sealDigest, challenge: expected.challenge, actor: expected.actor };
  return { now, seal, expected, transcript: { start, finish: { ...start, at: now - 50, status: 'closed' } },
    checks: { cleanExit: true, authentication: true, os: true, workers: true, writer: true, atomic: true,
      chain: ['request', 'create', 'write', 'write-complete', 'rename-request', 'rename-complete',
        'final-identity', 'read', 'use', 'end-state'], consumer: 'application-use', cacheSeparate: true,
      cacheUnchanged: true, tokens: true, closure: true, strict: true, review: true } };
}
test('synthetic normal proof set reaches READY', () => {
  const result = assess(healthy());
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.reasons, []);
});

const failures = [
  ['modified source manifest', 'SOURCE_SEAL_CHANGED', f => { f.seal.inputs.sources = sha('edited'); }],
  ['missing seal', 'SOURCE_SEAL_MISSING', f => { f.seal = null; }],
  ['preSeal replay', 'PRESEAL_REUSED', f => { f.expected.usedChallenge = true; }],
  ['PID reuse with different process start', 'PROCESS_IDENTITY_MISMATCH', f => { f.transcript.start.actor = f.expected.actor.replace('99800', '99810'); }],
  ['missing worker', 'WORKER_COVERAGE_UNKNOWN', f => { delete f.checks.workers; }],
  ['external writer', 'WRITER_EXCLUSIVITY_UNKNOWN', f => { f.checks.writer = false; }],
  ['OS event loss', 'OS_EVENTS_MISSING', f => { f.checks.os = false; }],
  ['incomplete rename', 'CONSUMER_CHAIN_INCOMPLETE', f => { f.checks.chain.splice(5, 1); }],
  ['API read without use', 'SEMANTIC_CONSUMER_MISSING', f => { f.checks.consumer = 'application-read'; }],
  ['sampler read', 'SEMANTIC_CONSUMER_MISSING', f => { f.checks.consumer = 'sampler'; }],
  ['cache failed changed', 'CACHE_RESULT_CHANGED', f => { f.checks.cacheUnchanged = digest({failed:true}) === digest({failed:false}); }],
  ['cache duration changed', 'CACHE_RESULT_CHANGED', f => { f.checks.cacheUnchanged = digest({duration:1}) === digest({duration:2}); }],
  ['cache physical sharing', 'CACHE_PHYSICAL_SHARING', f => { f.checks.cacheSeparate = false; }],
  ['token changed', 'CONFIG_TOKEN_CHANGED', f => { f.checks.tokens = false; }],
  ['closure missing', 'CONFIG_CLOSURE_UNKNOWN', f => { delete f.checks.closure; }],
  ['interrupted close', 'INCOMPLETE_CLOSE', f => { delete f.transcript.finish; }],
  ['exited uncleanly', 'INCOMPLETE_CLOSE', f => { f.checks.cleanExit = false; }],
  ['capture before seal', 'SEAL_EVENT_ORDER', f => { f.transcript.start.at = f.seal.at - 1; }],
  ['future capture', 'SEAL_EVENT_ORDER', f => { f.transcript.start.at = f.now + 1; }],
  ['future close', 'INCOMPLETE_CLOSE', f => { f.transcript.finish.at = f.now + 1; }],
  ['close bound to different seal', 'INCOMPLETE_CLOSE', f => { f.transcript.finish.seal = sha('other'); }],
  ['environment changed', 'ENVIRONMENT_CHANGED', f => { f.expected.environment = sha('different environment'); }],
  ['review incomplete', 'INDEPENDENT_REVIEW_MISSING', f => { delete f.checks.review; }],
  ['old READY', 'ATTESTATION_STALE', f => { f.now += 300_000; }],
  ['output reused', 'OUTPUT_REUSED', f => { f.expected.freshOutput = false; }],
  ['seal authentication missing', 'INDEPENDENT_SEAL_MISSING', f => { delete f.checks.authentication; }],
];
for (const [name, reason, change] of failures) {
  test(name + ' → ' + reason, () => {
    const input = healthy();
    change(input);
    const result = assess(input);
    assert.notEqual(result.status, 'READY');
    assert.ok(result.reasons.includes(reason), JSON.stringify(result));
  });
}
test('missing bindings cannot match themselves', () => {
  const f = healthy();
  delete f.seal.inputs;
  for (const key of ['environment', 'sources', 'challenge', 'actor']) delete f.expected[key];
  for (const tuple of [f.transcript.start, f.transcript.finish]) { delete tuple.challenge; delete tuple.actor; }
  delete f.seal.challenge;
  f.expected.sealDigest = f.transcript.start.seal = f.transcript.finish.seal = digest(f.seal);
  const result = assess(f);
  for (const reason of ['PRESEAL_REUSED', 'ENVIRONMENT_CHANGED', 'SOURCE_READBACK_CHANGED', 'PROCESS_IDENTITY_MISMATCH']) {
    assert.ok(result.reasons.includes(reason));
  }
  assert.equal(result.status, 'INVALID');
});
test('single-condition mutation gives a false READY on the identical fixture', async () => {
  const original = readFileSync(gate, 'utf8');
  const changed = original.replace("checks.consumer === 'application-use'", 'true');
  assert.notEqual(original, changed);
  const mutant = await import('data:text/javascript;base64,' + Buffer.from(changed).toString('base64'));
  const input = healthy();
  input.checks.consumer = 'sampler';
  assert.equal(mutant.assess(input).status, 'READY');
  assert.deepEqual(assess(input).reasons, ['SEMANTIC_CONSUMER_MISSING']);
});
test('operational gate ignores saved READY and rejects any gate-file argument', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w1g-gate-'));
  const ready = join(tmp, 'ready.json');
  writeFileSync(ready, JSON.stringify({ status: 'READY', authorized: true }));
  const rejected = invoke('./stage-w1g-gate.mjs', ready);
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stdout).reason, 'SAVED_GATE_INPUT_REFUSED');
  const gateResult = invoke('./stage-w1g-gate.mjs');
  assert.equal(gateResult.status, 1);
  const result = JSON.parse(gateResult.stdout);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.comparison.authorized, false);
  assert.deepEqual([result.comparison.old, result.comparison.new], [0,0]);
});
test('legacy runner and worker refuse both fixed Git identities', () => {
  assert.doesNotThrow(() => requireNonFixedTargets(['a'.repeat(40)]));
  for (const head of FIXED_HEADS) {
    assert.throws(() => requireNonFixedTargets([head]), /W1G_FIXED_COMPARISON_BLOCKED/);
    assert.throws(() => requireNonFixedTargets([[head]]), /INVALID_TARGET_HEAD/);
    const top = mkdtempSync(join(tmpdir(), 'w1g-launch-'));
    const out = join(top, 'record');
    mkdirSync(out);
    const target = { dir: join(top, 'input'), repo: top, head };
    const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(data));
    write('preflight.json', { runId: 'fixture', plan: { targets: [target, target], filters: [],
      expected: { pool: 'forks', maxWorkers: 2, testTimeout: 5000, cache: true } } });
    write('ready.json', { runId: 'fixture', preflightSha256: sha(readFileSync(join(out, 'preflight.json'))) });
    write('ready.sha256.json', { sha256: sha(readFileSync(join(out, 'ready.json'))) });
    const blocked = invoke('./stage-w1b-runner.mjs', 'launch', out);
    assert.equal(blocked.status, 1, blocked.stderr);
    assert.match(JSON.parse(blocked.stdout).reason, /W1G_FIXED_COMPARISON_BLOCKED/);
    assert.equal(existsSync(join(out, 'launched.json')), false);
    write('request.json', { mode: 'run', target });
    const worker = invoke('./stage-w1b-worker.mjs', join(out, 'request.json'));
    assert.equal(worker.status, 1);
    assert.match(worker.stderr, /W1G_FIXED_COMPARISON_BLOCKED/);
    write('request.json', { mode: 'unexpected', target });
    assert.match(invoke('./stage-w1b-worker.mjs', join(out, 'request.json')).stderr, /INVALID_WORKER_MODE/);
  }
});
test('seal inspection refuses an output inside its input before any write', () => {
  const top = mkdtempSync(join(tmpdir(), 'w1g-seal-'));
  mkdirSync(join(top, 'snapshots', 'old', 'node_modules'), { recursive: true });
  mkdirSync(join(top, 'snapshots', 'new', 'node_modules'), { recursive: true });
  mkdirSync(join(top, 'repo'));
  const out = join(top, 'snapshots', 'old', 'evidence');
  assert.throws(() => inspectFixed(resolve(top, 'repo'), resolve(top, 'snapshots'), out), /OUTPUT_IN_PROTECTED_ROOT/);
  assert.equal(existsSync(out), false);
});
