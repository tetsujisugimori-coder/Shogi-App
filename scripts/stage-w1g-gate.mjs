// Fixed comparison admission. This module does not execute a comparison.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FIXED_HEADS = Object.freeze([
  'e1ccb1a2412e7faa86c2c1f60fdad1dca154023a',
  '2a8a57b6ff207831c77ce62d27d3151eba7c1dc3',
]);
const fixedTrees = Object.freeze(['5ced08e0036f955833ca2e12722bfbd595a00afd', '3d06ccd81473b78bc3eb721c516693042ae2c118']);
export function requireNonFixedTargetTrees(targets) {
  for (const { repo, head } of targets) {
    for (const flags of [[], ['--no-replace-objects']]) {
      const tree = execFileSync('git', [...flags, '-C', repo, 'rev-parse', '--verify', head + '^{tree}'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      if (fixedTrees.includes(tree)) throw Error('W1G_FIXED_COMPARISON_BLOCKED: fixed tree');
    }
  }
}
const version = 'stage-w1g/1';
const nonempty = value => typeof value === 'string' && value.length > 0;
const sha256 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const maxAgeMs = 5 * 60_000;
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = value => sha(JSON.stringify(value));

// W1h shared producer/readback contract. No caller-provided evidence grants execution.
export const SOURCE_SEAL_SCHEMA = 'stage-w1h-source-seal/1';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const actorValid = x => object(x) && nonempty(x.id) && nonempty(x.instance);
const targetValid = x => Array.isArray(x) && x.length > 0 && x.every(t => object(t)
  && typeof t.head === 'string' && /^[0-9a-f]{40}$/.test(t.head)
  && typeof t.tree === 'string' && /^[0-9a-f]{40}$/.test(t.tree));
function validSeal(s) {
  return object(s) && s.schema === SOURCE_SEAL_SCHEMA && ['synthetic','inspection'].includes(s.scope)
    && nonempty(s.challenge) && Number.isSafeInteger(s.at) && s.at >= 0 && actorValid(s.actor)
    && targetValid(s.targets) && ['source','dependency','environment'].every(k => sha256(s[k]));
}
export function createSourceSeal(input) {
  const seal = { ...input, schema: SOURCE_SEAL_SCHEMA };
  if (!validSeal(seal)) throw Error('SEAL_SCHEMA_INVALID');
  return seal;
}
export function validateSourceSeal(bytes, expected, now) {
  const reasons = [];
  const check = (ok, reason) => { if (!ok) reasons.push(reason); };
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return {status:'INVALID',reasons:['SOURCE_SEAL_MISSING'],permit:false};
  if (!object(expected)) return {status:'INVALID',reasons:['EXPECTED_CONTRACT_INVALID'],permit:false};
  let seal;
  try { seal = JSON.parse(bytes.toString('utf8')); } catch { return {status:'INVALID',reasons:['SEAL_SCHEMA_INVALID'],permit:false}; }
  check(sha256(expected.rawSha256) && sha(bytes) === expected.rawSha256, 'SOURCE_SEAL_CHANGED');
  check(sha256(expected.structuredDigest) && digest(seal) === expected.structuredDigest, 'STRUCTURED_DIGEST_CHANGED');
  if (!validSeal(seal)) return {status:'INVALID',reasons:[...reasons,'SEAL_SCHEMA_INVALID'],permit:false};
  check(seal.scope === expected.scope, 'SCOPE_CHANGED');
  check(nonempty(expected.challenge) && seal.challenge === expected.challenge && expected.usedChallenge === false, 'PRESEAL_REUSED');
  check(Number.isSafeInteger(now) && now >= seal.at && now-seal.at <= maxAgeMs && seal.at === expected.at, 'ATTESTATION_STALE');
  check(actorValid(expected.actor) && digest(seal.actor) === digest(expected.actor), 'PROCESS_IDENTITY_MISMATCH');
  check(targetValid(expected.targets) && digest(seal.targets) === digest(expected.targets), 'TARGET_CHANGED');
  for(const [key,reason] of [['source','SOURCE_READBACK_CHANGED'],['dependency','DEPENDENCY_CHANGED'],['environment','ENVIRONMENT_CHANGED']])
    check(sha256(expected[key]) && seal[key] === expected[key],reason);
  check(expected.freshOutput === true,'OUTPUT_REUSED');
  return {status:reasons.length?'INVALID':'PASS',reasons,permit:false,seal};
}
export function assessSealed({bytes,expected,transcript,now} = {}) {
  const result=validateSourceSeal(bytes,expected,now);
  if (!result.seal) return result;
  const {seal}=result;
  const reasons=[...result.reasons];
  const start=transcript?.start, finish=transcript?.finish;
  const actorMatches = x => actorValid(x) && digest(x) === digest(seal.actor);
  if (!(object(start) && start.stage==='start' && start.seal===expected.rawSha256 && start.challenge===seal.challenge
    && Number.isSafeInteger(start.at) && start.at>=seal.at && start.at<=now)) reasons.push('SEAL_EVENT_ORDER');
  if (!(actorMatches(start?.actor) && actorMatches(finish?.actor))) reasons.push('PROCESS_IDENTITY_MISMATCH');
  if (!(object(start) && object(finish) && finish.stage==='close' && finish.seal===expected.rawSha256
    && finish.challenge===seal.challenge && Number.isSafeInteger(finish.at) && finish.at>=start.at
    && finish.at<=now && finish.status==='PASS' && finish.cleanExit===true)) reasons.push('INCOMPLETE_CLOSE');
  return {status:reasons.length?'INVALID':'PASS',reasons,permit:false,scope:seal.scope,
    authentication:'UNKNOWN',proof:'raw-byte and structured-contract integrity only'};
}

export function requireNonFixedTargets(heads) {
  for (const head of heads) {
    if (typeof head !== 'string' || !/^[a-f0-9]{40}$/.test(head)) throw Error('INVALID_TARGET_HEAD');
    if (FIXED_HEADS.includes(head)) {
      const gate = fixedComparisonGate();
      throw Error('W1G_FIXED_COMPARISON_BLOCKED: ' + gate.status);
    }
  }
}

const chain = Object.freeze([
  'request', 'create', 'write', 'write-complete', 'rename-request', 'rename-complete',
  'final-identity', 'read', 'use', 'end-state',
]);

// Legacy W1g synthetic-only contract, retained for regression and old evidence.
// New producer/readback records must use assessSealed; this function is not admission.
// Pure contract used by the synthetic controls. Its inputs are verdicts from
// trusted verifiers, not claims a caller can supply to the operational gate.
export function assess({ seal, expected, transcript, checks, now }) {
  const rows = [];
  function test(condition, ok, reason, status = 'INVALID') {
    rows.push({ condition, status: ok === true ? 'PASS' : status, reason: ok === true ? null : reason });
  }
  test('source seal exists', !!seal && typeof seal === 'object', 'SOURCE_SEAL_MISSING', 'NOT_TESTED');
  if (seal) {
    test('retained seal bytes', digest(seal) === expected.sealDigest, 'SOURCE_SEAL_CHANGED');
    test('fresh challenge', nonempty(expected.challenge) && seal.challenge === expected.challenge && expected.usedChallenge === false, 'PRESEAL_REUSED');
    test('time window', Number.isSafeInteger(seal.at) && Number.isSafeInteger(now)
      && now >= seal.at && now - seal.at <= maxAgeMs, 'ATTESTATION_STALE');
    test('environment reread', sha256(expected.environment) && seal.inputs?.environment === expected.environment, 'ENVIRONMENT_CHANGED');
    test('source reread', sha256(expected.sources) && seal.inputs?.sources === expected.sources, 'SOURCE_READBACK_CHANGED');
    test('output reservation', expected.freshOutput === true, 'OUTPUT_REUSED');
  }
  if (transcript) {
    const { start, finish } = transcript;
    test('log starts at seal', !!seal && start?.seal === expected.sealDigest
      && start.challenge === expected.challenge && Number.isSafeInteger(start.at)
      && start.at >= seal.at && start.at <= now, 'SEAL_EVENT_ORDER');
    test('same process instance', !!start && nonempty(expected.actor) && start.actor === expected.actor
      && (!finish || finish.actor === start.actor), 'PROCESS_IDENTITY_MISMATCH');
    test('completed log', !!start && !!finish && Number.isSafeInteger(finish.at)
      && finish.at >= start.at && finish.at <= now && finish.seal === expected.sealDigest
      && finish.challenge === expected.challenge && finish.status === 'closed' && checks.cleanExit === true, 'INCOMPLETE_CLOSE');
  } else test('completed log', false, 'TRANSCRIPT_MISSING', 'NOT_TESTED');
  test('independent seal authentication', checks.authentication, 'INDEPENDENT_SEAL_MISSING', 'BLOCKED');
  test('kernel events complete', checks.os, 'OS_EVENTS_MISSING', 'BLOCKED');
  test('worker mapping', checks.workers, 'WORKER_COVERAGE_UNKNOWN', 'UNKNOWN');
  test('writer exclusion', checks.writer, 'WRITER_EXCLUSIVITY_UNKNOWN', 'UNKNOWN');
  test('atomic transition', checks.atomic, 'OS_ATOMIC_RENAME_UNKNOWN', 'UNKNOWN');
  test('operation sequence', Array.isArray(checks.chain) && checks.chain.length === chain.length
    && chain.every((step, i) => checks.chain[i] === step), 'CONSUMER_CHAIN_INCOMPLETE', 'UNKNOWN');
  test('semantic use', checks.consumer === 'application-use', 'SEMANTIC_CONSUMER_MISSING', 'UNKNOWN');
  test('cache physically separate', checks.cacheSeparate, 'CACHE_PHYSICAL_SHARING', 'UNKNOWN');
  test('cache results invariant', checks.cacheUnchanged, 'CACHE_RESULT_CHANGED', 'NOT_READY');
  test('tokens accepted', checks.tokens, 'CONFIG_TOKEN_CHANGED', 'UNKNOWN');
  test('opaque config verified', checks.closure, 'CONFIG_CLOSURE_UNKNOWN', 'UNKNOWN');
  test('strict admission', checks.strict, 'STRICT_ADMISSION_MISSING', 'NOT_TESTED');
  test('independent review of current inputs', checks.review, 'INDEPENDENT_REVIEW_MISSING', 'NOT_TESTED');
  const unmet = rows.filter(row => row.status !== 'PASS');
  const status = ['INVALID', 'BLOCKED'].find(s => unmet.some(row => row.status === s))
    ?? (unmet.length ? 'NOT_READY' : 'READY');
  return { status, rows, reasons: unmet.map(row => row.reason) };
}

// No independently provisioned verifier for these live inputs exists yet.
// Recompute on invocation, accept no proof/approval/previous-result argument.
export function fixedComparisonGate() {
  const outcome = assess({ checks: {}, expected: {}, now: Date.now() });
  return {
    ...outcome, version, targets: FIXED_HEADS, at: new Date().toISOString(),
    verifierSha256: sha(readFileSync(new URL(import.meta.url))),
    preSeal: null, independentReview: 'NOT_TESTED_FOR_ADMISSION',
    evidence: [
      'docs/benchmarks/game-blunder-w1f-20261116/gate-physical.json',
      'docs/benchmarks/game-blunder-w1g-20261118/README.md',
    ],
    comparison: { approval: 'REQUIRED_SEPARATELY', authorized: false, old: 0, new: 0 },
    s4: 'NOT_TESTED', s5: 'NOT_TESTED',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.log(JSON.stringify({ status: 'INVALID', reason: 'SAVED_GATE_INPUT_REFUSED' }));
  } else {
    console.log(JSON.stringify(fixedComparisonGate(), null, 2));
  }
  process.exitCode = 1;
}
