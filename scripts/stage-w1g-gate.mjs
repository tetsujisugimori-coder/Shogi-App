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
