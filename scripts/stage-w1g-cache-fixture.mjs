// Actual Vitest runs on generated tests outside all protected snapshots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { FIXED_HEADS, sha, digest } from './stage-w1g-gate.mjs';
import { actor, artifact, envDigest, file, physicalId } from './stage-w1g-seal.mjs';
import { contains, physical } from './stage-w1b-preflight.mjs';
import { cacheIdentity, cachePair, requireExactCache } from './stage-w1f-cache.mjs';

const script = fileURLToPath(import.meta.url);
const sources = [script, ...['stage-w1g-seal.mjs', 'stage-w1g-gate.mjs', 'stage-w1f-cache.mjs', 'stage-w1b-preflight.mjs']
  .map(name => fileURLToPath(new URL(name, import.meta.url)))];
const tests = ['a.test.mjs', 'b.test.mjs'];
const options = { config: false, watch: false, maxWorkers: 2, testTimeout: 5000, pool: 'forks',
  environment: 'node', include: tests };
const unnamedProject = createHash('sha1').update('').digest('hex');
const cacheFile = root => join(root, 'cache', 'vitest', unnamedProject, 'results.json');
const contents = path => {
  if (!fs.existsSync(path)) return null;
  const bytes = fs.readFileSync(path);
  let parsed;
  try { parsed = JSON.parse(bytes); } catch { parsed = null; }
  const normalized = Array.isArray(parsed?.results) ? [...parsed.results].sort(([a], [b]) => a.localeCompare(b)) : null;
  return { file: file(path), base64: bytes.toString('base64'), normalized, version: parsed?.version ?? null };
};
const fixtureSource = name => `
import { appendFileSync } from 'node:fs';
import { threadId, isMainThread } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { test, expect } from 'vitest';
test('${name}', () => {
  appendFileSync(process.env.W1G_WORKER_LOG, JSON.stringify({
    name: '${name}', pid: process.pid, ppid: process.ppid, threadId, isMainThread,
    timeOrigin: performance.timeOrigin, time: Date.now(), executable: process.execPath
  }) + '\\n');
  expect(2 + 2).toBe(4);
});
`;
const sourceBodies = root => tests.map(name => file(join(root, name)));
const dependencies = () => {
  const root = fileURLToPath(new URL('../node_modules/', import.meta.url));
  const entries = ['vitest/package.json', 'vitest/dist/node.js', 'vitest/dist/chunks/cli-api.CnMVyzaz.js',
    'vitest/dist/chunks/coverage.DM_a_rWm.js', 'vite/package.json', 'vite/dist/node/chunks/dep-Dm0c1Wj2.js'];
  return { root: physicalId(root), files: entries.map(path => file(join(root, path))),
    lock: file(new URL('../package-lock.json', import.meta.url)) };
};
const inputState = (root, env) => ({ observer: sources.map(file), node: file(process.execPath), versions: process.versions,
  dependencies: dependencies(), tests: sourceBodies(root), root: physicalId(root), environment: envDigest(env, Object.keys(env).sort()) });

async function child(record, expectedSha) {
  if (file(record).sha256 !== expectedSha) throw Error('SOURCE_SEAL_CHANGED');
  const seal = JSON.parse(fs.readFileSync(record));
  const root = fs.realpathSync(process.cwd());
  assert.equal(root, seal.root, 'WORKER_TARGET_MISMATCH');
  assert.deepEqual(inputState(root, process.env), seal.inputs, 'SEALED_INPUT_CHANGED');
  assert.deepEqual(contents(cacheFile(root)), seal.cache, 'CACHE_SEED_CHANGED');
  for (const name of tests) assert.equal(fs.readFileSync(name, 'utf8'), fixtureSource(name));
  const identity = actor();
  assert.equal(identity.ppid, seal.parent.pid, 'PARENT_IDENTITY_MISMATCH');
  const journal = join(dirname(record), 'events.jsonl');
  const recordEvent = (event, details = {}) => fs.appendFileSync(journal,
    JSON.stringify({ event, seal: expectedSha, challenge: seal.challenge, actor: identity, at: Date.now(), ...details }) + '\n');
  if (Date.now() < seal.at || Date.now() - seal.at > 5 * 60_000) throw Error('ATTESTATION_STALE');
  fs.writeFileSync(journal, '', { flag: 'wx' });
  recordEvent('start');

  const { createVitest, BaseSequencer } = await import('vitest/node');
  class ObserveOrder extends BaseSequencer {
    async sort(specs) {
      const sorted = await super.sort(specs);
      recordEvent('sequenced', { order: sorted.map(spec => basename(spec.moduleId)) });
      if (seal.interrupt) process.exit(84);
      return sorted;
    }
  }
  const reporter = {
    onTestModuleStart(module) { recordEvent('module-start', { name: module.relativeModuleId }); },
    onTestModuleEnd(module) { recordEvent('module-end', { name: module.relativeModuleId, state: module.state() }); },
    onTestRunEnd(modules, errors, reason) {
      recordEvent('run-end', { reason, errors: errors.map(String),
        modules: modules.map(module => ({ name: module.relativeModuleId, state: module.state() })) });
    },
  };
  const ctx = await createVitest('test', { ...options, root, ...(seal.enabled ? {} : { cache: false }),
    sequence: { sequencer: ObserveOrder }, reporters: [reporter] }, { cacheDir: join(root, 'cache') });
  try {
    const resultPath = ctx.cache.results.getCachePath();
    assert.equal(resultPath === null ? null : resolve(resultPath), seal.enabled ? cacheFile(root) : null, 'CACHE_PATH');
    recordEvent('effective-config', { maxWorkers: ctx.config.maxWorkers, testTimeout: ctx.config.testTimeout,
      pool: ctx.config.pool, cache: ctx.config.cache, resultPath: ctx.cache.results.getCachePath(),
      viteTokenSha256: sha(ctx.projects[0].vite.config.webSocketToken),
      vitestTokenSha256: sha(ctx.config.api.token) });
    await ctx.start();
    if (seal.label === 'clear') {
      const before = contents(cacheFile(root));
      await ctx.cache.results.clearCache();
      recordEvent('cache-cleared', { before, after: contents(cacheFile(root)) });
    }
  } finally {
    await ctx.close();
    recordEvent('closed');
  }
}
function runCase(out, label, { seed, enabled = true, interrupt = false, reuse } = {}) {
  const evidence = join(out, label);
  fs.mkdirSync(evidence);
  const root = reuse ?? join(evidence, 'fixture');
  if (!reuse) {
    fs.mkdirSync(root);
    for (const name of tests) fs.writeFileSync(join(root, name), fixtureSource(name), { flag: 'wx' });
  }
  if (seed !== undefined) {
    fs.mkdirSync(dirname(cacheFile(root)), { recursive: true });
    fs.writeFileSync(cacheFile(root), seed, { flag: 'wx' });
  }
  const temp = join(evidence, 'temp');
  fs.mkdirSync(temp);
  const env = { ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec, Path: process.env.Path,
    ...Object.fromEntries(['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN',
      'USERNAME', 'USERPROFILE', 'WINDIR'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])) } : { PATH: process.env.PATH }),
    TEMP: temp, TMP: temp, TMPDIR: temp, NODE_DISABLE_COMPILE_CACHE: '1', W1G_WORKER_LOG: join(evidence, 'worker.jsonl') };
  const inputs = inputState(root, env);
  const seal = { root, enabled, interrupt, label, options, inputs, cache: contents(cacheFile(root)),
    parent: actor(), challenge: randomUUID(), at: Date.now(), scope: 'observation-fixture-only' };
  const planPath = join(evidence, 'pre-seal.json');
  artifact(planPath, seal);
  const sealSha = file(planPath).sha256;
  assert.equal(sealSha, sha(JSON.stringify(seal, null, 2) + '\n'));
  const args = [script, 'child', planPath, sealSha];
  const start = performance.now();
  const proc = spawnSync(process.execPath, args, { cwd: root, env });
  const elapsedMs = performance.now() - start;
  for (const [name, bytes] of [['stdout', proc.stdout], ['stderr', proc.stderr]]) {
    fs.writeFileSync(join(evidence, name + '.txt'), bytes ?? '', { flag: 'wx' });
  }
  const journal = join(evidence, 'events.jsonl');
  const events = fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const after = contents(cacheFile(root));
  const workers = join(evidence, 'worker.jsonl');
  const workerEvents = fs.existsSync(workers) ? fs.readFileSync(workers, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const result = { label, command: [process.execPath, ...args], seal: sealSha, elapsedMs,
    exitCode: proc.status, signal: proc.signal, error: proc.error?.message ?? null,
    events, workers: workerEvents, before: seal.cache, after, residual: fs.readdirSync(root).sort(),
    cacheUnchanged: digest(seal.cache) === digest(after), inputsUnchanged: digest(inputs) === digest(inputState(root, env)),
    sealUnchanged: file(planPath).sha256 === sealSha, root };
  artifact(join(evidence, 'result.json'), result);
  assert.equal(result.sealUnchanged && result.inputsUnchanged, true, 'SOURCE_READBACK_CHANGED');
  assert.equal(events[0]?.event, 'start', proc.stderr?.toString());
  assert.equal(events.every(event => event.seal === sealSha && event.challenge === seal.challenge
    && digest(event.actor) === digest(events[0].actor) && event.at >= seal.at), true, 'EVENT_BINDING_CHANGED');
  return result;
}
const seed = (a, b, failed = false, fileA = ':a.test.mjs', version = '4.1.11') =>
  JSON.stringify({ version, results: [[fileA, { duration: a, failed }], [':b.test.mjs', { duration: b, failed: false }]] });
const sort = result => result.events.find(event => event.event === 'sequenced')?.order;

function suite(out) {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const parent = dirname(fs.realpathSync(repo));
  const roots = fs.readdirSync(parent).filter(name => /^stage-w1(?!g)/.test(name)).map(name => join(parent, name));
  if ([repo, ...roots].some(root => contains(physical(root), physical(out)))) throw Error('OUTPUT_IN_PROTECTED_ROOT');
  fs.mkdirSync(out);
  const first = runCase(out, 'first');
  const runs = [first, runCase(out, 'reuse', { reuse: first.root }),
    runCase(out, 'seed-baseline', { seed: seed(10, 50) }),
    runCase(out, 'failed', { seed: seed(10, 50, true) }),
    runCase(out, 'duration', { seed: seed(90, 50) }),
    runCase(out, 'file-id', { seed: seed(10, 50, true, ':retired.test.mjs') }),
    runCase(out, 'corrupt', { seed: '{ invalid json' }),
    runCase(out, 'old', { seed: seed(10, 50, false, ':retired.test.mjs', '4.0.0') }),
    runCase(out, 'interrupt', { seed: seed(10, 50), interrupt: true }),
    runCase(out, 'disabled', { seed: seed(10, 50, true), enabled: false }),
    runCase(out, 'clear', { seed: seed(10, 50) })];
  const rows = Object.fromEntries(runs.map(row => [row.label, row]));
  const sorted = (name, firstTest) => assert.deepEqual(sort(rows[name]), firstTest === 'a' ? tests : [...tests].reverse(), name);
  sorted('seed-baseline', 'b'); sorted('failed', 'a'); sorted('duration', 'a');
  assert.equal(first.before, null);
  assert.deepEqual(first.after.normalized.map(([key]) => key), [':a.test.mjs', ':b.test.mjs']);
  assert.equal(rows.reuse.before.file.sha256, first.after.file.sha256);
  for (const key of ['file-id', 'old']) assert.equal(rows[key].after.normalized.some(([id]) => id === ':retired.test.mjs'), true);
  // Vitest catches parse errors during server initialization and replaces the bad cache afterwards.
  assert.equal(rows.corrupt.exitCode, 0);
  assert.equal(rows.corrupt.before.normalized, null);
  assert.equal(rows.corrupt.after.normalized.length, 2);
  assert.equal(rows.corrupt.cacheUnchanged, false);
  assert.equal(rows.clear.events.find(row => row.event === 'cache-cleared').before.normalized.length, 2);
  assert.equal(rows.clear.after, null);
  assert.equal(rows.interrupt.exitCode, 84);
  assert.equal(rows.interrupt.cacheUnchanged, true);
  assert.equal(rows.interrupt.events.some(({ event }) => event === 'closed'), false);
  assert.equal(rows.disabled.cacheUnchanged, true);
  assert.equal(rows.disabled.events.find(event => event.event === 'effective-config').resultPath, null);
  for (const row of runs.filter(r => r.label !== 'interrupt')) {
    assert.equal(row.exitCode, 0, row.label);
    assert.equal(row.events.at(-1)?.event, 'closed', row.label);
    assert.deepEqual(row.events.find(event => event.event === 'run-end').modules.map(m => m.state).sort(), ['passed', 'passed']);
    assert.equal(row.workers.length, 2);
  }
  assert.throws(() => requireExactCache(rows['seed-baseline'].before.normalized, rows.failed.before.normalized), /CACHE_RESULT_CHANGED/);
  assert.throws(() => requireExactCache(rows['seed-baseline'].before.normalized, rows.duration.before.normalized), /CACHE_RESULT_CHANGED/);
  const identity = root => cacheIdentity({ cache: { dir: join(root, 'cache') }, cacheDir: join(root, 'cache') }, root);
  assert.throws(() => cachePair(identity(first.root), identity(first.root)), /CACHE_SHARED/);
  const linkRoot = join(out, 'link-control');
  fs.mkdirSync(linkRoot);
  let link;
  try {
    fs.symlinkSync(join(first.root, 'cache'), join(linkRoot, 'cache'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) { link = { status: 'BLOCKED', error: error.code, message: error.message }; }
  if (!link) {
    assert.throws(() => identity(linkRoot), /CACHE_LINK/);
    link = { status: 'PASS', reason: 'CACHE_LINK' };
  }
  const summary = { status: link.status === 'PASS' ? 'PASS' : 'PARTIAL', scope: 'actual isolated Vitest fixture',
    cacheSafety: 'NOT_ESTABLISHED', directoryLink: link, sharing: 'CACHE_SHARED',
    orders: Object.fromEntries(runs.map(r => [r.label, sort(r) ?? null])),
    runs: runs.map(({ label, exitCode, elapsedMs, workers, cacheUnchanged }) => ({ label, exitCode, elapsedMs,
      workerStartsInJournalOrder: workers.map(w => w.name), cacheUnchanged })),
    comparisonSpawns: { targets: FIXED_HEADS, old: 0, new: 0 } };
  artifact(join(out, 'summary.json'), summary);
  console.log(JSON.stringify(summary));
}

const [mode, arg, hash] = process.argv.slice(2);
if (mode === 'child') await child(arg, hash);
else if (mode === 'fixture' && arg && !hash) suite(resolve(arg));
else throw Error('usage: fixture <new observation output directory>');
