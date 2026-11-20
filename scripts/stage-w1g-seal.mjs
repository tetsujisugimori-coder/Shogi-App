// Point-in-time seal for a read-only inspection of the fixed Git snapshots.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { FIXED_HEADS, sha, digest, createSourceSeal, validateSourceSeal, assessSealed } from './stage-w1g-gate.mjs';
import { contains, inspect, physical } from './stage-w1b-preflight.mjs';

export const artifact = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export function file(path) {
  const bytes = readFileSync(path);
  return { path: realpathSync(path), size: bytes.length, sha256: sha(bytes) };
}

export function physicalId(path) {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink()) throw Error('PHYSICAL_LINK: ' + path);
  return { realpath: realpathSync(path), dev: String(stat.dev), ino: String(stat.ino),
    birthtimeNs: String(stat.birthtimeNs) };
}

export const actor = () => ({ pid: process.pid, ppid: process.ppid, startTimeOrigin: performance.timeOrigin,
  executable: realpathSync(process.execPath), cwd: realpathSync(process.cwd()) });

const configFacts = ['NODE_OPTIONS', 'NODE_PATH', 'NODE_COMPILE_CACHE', 'NODE_DISABLE_COMPILE_CACHE',
  'NODE_ENV', 'DISABLE_HMR', 'CI', 'TZ', 'TEMP', 'TMP', 'NPM_CONFIG_CACHE', 'PATH'];
export const envDigest = (env, keys = configFacts) => Object.fromEntries(keys.map(k => [k, env[k] === undefined ? null : sha(env[k])]));

function snapshot(repo, dir, head) {
  const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', repo, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const tree = git('rev-parse', head + '^{tree}').trim();
  const entries = git('ls-tree', '-r', '-z', tree).split('\0').filter(Boolean);
  const blobs = new Map(entries.map(line => {
    const split = line.indexOf('\t');
    return [line.slice(split + 1), line.slice(0, split).split(' ')[2]];
  }));
  const view = inspect(repo, dir, head);
  const source = view.source.map(row => ({ ...row, blob: blobs.get(row.path) }));
  // inspect checks the worktree blob ID. Recheck against the replacement-disabled tree.
  for (const row of source) {
    const bytes = readFileSync(join(dir, row.path));
    const actual = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (row.blob !== actual || sha(bytes) !== row.sha256) throw Error('SOURCE_READBACK_CHANGED: ' + row.path);
  }
  if (source.length !== entries.length) throw Error('SOURCE_SET_CHANGED');
  return { ...view, source, tree, physical: physicalId(dir), dependencies: physicalId(view.dependencyRoot) };
}

export function inspectFixed(repo, snapshots, output) {
  const protectedRoots = [repo, snapshots, ...['old', 'new'].map(name => realpathSync(join(snapshots, name, 'node_modules')))];
  if (protectedRoots.some(root => contains(realpathSync(root), physical(output)))) throw Error('OUTPUT_IN_PROTECTED_ROOT');
  mkdirSync(output);
  const plan = { scope: 'fixed Git snapshots, read-only; no Vitest import or run', repo, snapshots, output,
    targets: FIXED_HEADS, plannedSettings: { maxWorkers: 2, testTimeout: 5000 },
    effectiveSettings: 'NOT_TESTED_IN_THIS_RUN' };
  const files = ['stage-w1g-seal.mjs', 'stage-w1g-gate.mjs', 'stage-w1b-preflight.mjs']
    .map(name => file(new URL(name, import.meta.url)));
  const context = { plan, files, node: file(process.execPath), version: process.version,
    environment: envDigest(process.env), actor: actor() };
  const before = FIXED_HEADS.map((head, i) => snapshot(repo, join(snapshots, i ? 'new' : 'old'), head));
  const processActor = { id: digest(actor()), instance: String(performance.timeOrigin) };
  const seal = createSourceSeal({ scope: 'inspection', context, before,
    challenge: randomUUID(), at: Date.now(), actor: processActor,
    targets: before.map((view, i) => ({ head: FIXED_HEADS[i], tree: view.tree })),
    source: digest(before.map(view => view.source)),
    dependency: digest(before.map(view => ({ physical: view.dependencies, content: view.dependenciesSha256, lock: view.lockSha256 }))), environment: digest(context.environment) });
  const sealPath = join(output, 'pre-seal.json');
  artifact(sealPath, seal);
  const sealedHash = file(sealPath).sha256;
  if (sealedHash !== sha(JSON.stringify(seal, null, 2) + '\n')) throw Error('SOURCE_SEAL_CHANGED');
  const expected = { ...seal, rawSha256: sealedHash, structuredDigest: digest(seal),
    usedChallenge: false, freshOutput: true };
  const initial = validateSourceSeal(readFileSync(sealPath), expected, Date.now());
  if (initial.status !== 'PASS') throw Error(initial.reasons.join(','));
  const events = [{ stage: 'start', actor: processActor, at: Date.now(), seal: sealedHash, challenge: seal.challenge }];
  artifact(join(output, 'start.json'), events[0]);
  const after = FIXED_HEADS.map((head, i) => snapshot(repo, join(snapshots, i ? 'new' : 'old'), head));
  const reasons = [];
  if (file(sealPath).sha256 !== sealedHash) reasons.push('SOURCE_SEAL_CHANGED');
  if (!isDeepStrictEqual(before, after)) reasons.push('SOURCE_READBACK_CHANGED');
  if (!isDeepStrictEqual(context.environment, envDigest(process.env))) reasons.push('ENVIRONMENT_CHANGED');
  if (!isDeepStrictEqual(context.files, files.map(({ path }) => file(path)))
      || !isDeepStrictEqual(context.node, file(process.execPath))) reasons.push('OBSERVER_CHANGED');
  const finish = { stage: 'close', actor: processActor, at: Date.now(), seal: sealedHash,
    challenge: seal.challenge, status: reasons.length ? 'INVALID' : 'PASS', cleanExit: reasons.length === 0 };
  const contract = assessSealed({ bytes: readFileSync(sealPath), expected,
    transcript: { start: events[0], finish }, now: Date.now() });
  reasons.push(...contract.reasons);
  const result = { ...finish, status: reasons.length ? 'INVALID' : 'PASS', reasons, seal: sealedHash,
    schema: seal.schema, rawSha256: sealedHash, structuredDigest: expected.structuredDigest, contract,
    permit: false,
    proof: 'point-in-time raw byte equality; same principal and process holds seal and read access',
    historicalAuthenticity: 'UNKNOWN', independentAuthentication: 'BLOCKED',
    afterDigest: digest(after), actor: processActor, challenge: seal.challenge, stage: 'close', at: finish.at };
  artifact(join(output, 'finish.json'), result);
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url))) {
  const [repo, snapshots, out] = process.argv.slice(2);
  const result = inspectFixed(resolve(repo), resolve(snapshots), resolve(out));
  console.log(JSON.stringify(result));
  if (result.status !== 'PASS') process.exitCode = 1;
}
