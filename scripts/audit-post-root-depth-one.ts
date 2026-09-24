import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { summarize, TARGETS, type PostRootSample } from './benchmarks/postRootDepthOne';

const arg = process.argv[2];
assert.ok(arg?.endsWith('.jsonl'), 'Usage: npm run audit:post-root-depth-one -- PATH.jsonl');
const rows = readFileSync(resolve(arg), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const config = rows[0];
assert.equal(config.schema, 'post-root-depth-one-v1');
assert.equal(config.settings.timeLimitMilliseconds, 100);
const { positions, sourceSha256 } = replayPositions(SOURCE, config.smoke ? TARGETS.slice(0, 1) : TARGETS);
assert.equal(config.sourceSha256, sourceSha256);
const storedPositions = rows.filter(row => row.type === 'position');
assert.equal(storedPositions.length, positions.length);
for (const position of positions) {
  const stored = storedPositions.find(row => row.id === position.id);
  assert.ok(stored);
  for (const key of ['stateSha256', 'positionKeySha256', 'historyLength'])
    assert.equal(stored[key], position[key as keyof typeof position], `${position.id}: ${key}`);
}
const fallbackActions = new Map(positions.map(position => [position.id, getLegalActions(position.state)[0] ?? null]));
const samples = rows.filter(row => row.type === 'sample') as PostRootSample[];
assert.equal(samples.length, positions.length * 2 * (config.warmups + config.runs));
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 0.5, `${label}: ${a} vs ${b}`);
for (const position of positions) {
  const own = samples.filter(row => row.positionId === position.id);
  assert.equal(own.length, 2 * (config.warmups + config.runs));
  for (const phase of ['warmup', 'measurement'] as const) {
    const count = phase === 'warmup' ? config.warmups : config.runs;
    for (let run = 1; run <= count; run++) {
      const pair = own.filter(row => row.phase === phase && row.run === run);
      assert.deepEqual(pair.map(row => row.probe).sort(), [false, true]);
      assert.deepEqual(pair.map(row => row.action), [pair[0].action, pair[0].action], `${position.id}: selection changed`);
    }
  }
}
for (const sample of samples) {
  assert.ok(Number.isFinite(sample.apiElapsedMilliseconds) && sample.apiElapsedMilliseconds >= 0);
  assert.ok(Number.isFinite(sample.callElapsedMilliseconds) && sample.callElapsedMilliseconds >= sample.apiElapsedMilliseconds - 0.5);
  assert.equal(sample.resultSource === 'fallback', sample.completedDepth === 0);
  if (sample.resultSource === 'fallback')
    assert.deepEqual(sample.action, fallbackActions.get(sample.positionId), `${sample.positionId}: fallback order`);
  if (!sample.probe) { assert.equal(sample.diagnostics, null); continue; }
  const diagnostic = sample.diagnostics!;
  assert.ok(diagnostic);
  const depth = diagnostic.depthOne!;
  assert.ok(depth);
  assert.ok(Number.isSafeInteger(depth.rootCandidates) && depth.rootCandidates > 0);
  assert.ok(Number.isSafeInteger(depth.completedCandidates) && depth.completedCandidates >= 0 &&
    depth.completedCandidates <= depth.rootCandidates);
  assert.ok(depth.currentCandidate === null ||
    (depth.currentCandidate > depth.completedCandidates && depth.currentCandidate <= depth.rootCandidates));
  assert.ok(depth.visitedNodes >= depth.completedCandidates && depth.quiescenceCalls >= 0);
  assert.ok(depth.finishedAt !== null && depth.finishedAt >= depth.rootGeneratedAt);
  assert.ok(depth.rootGeneratedAt >= diagnostic.startedAt);
  assert.ok(depth.finishedAt! <= diagnostic.startedAt + sample.apiElapsedMilliseconds + 0.5);
  assert.equal(diagnostic.phases['root-piece-moves'].calls, 0);
  assert.equal(diagnostic.phases['root-hand-drops'].calls, 0);
  near(depth.postRootMilliseconds!, depth.finishedAt! - depth.rootGeneratedAt, 'post-root interval');
  const phases = depth.postRootPhases!;
  for (const [name, value] of Object.entries(phases)) {
    assert.ok(Number.isFinite(value) && value >= -0.001, `${name}: negative`);
    assert.ok(value <= diagnostic.phases[name as keyof typeof diagnostic.phases].milliseconds + 0.001);
  }
  const sum = Object.values(phases).reduce((a, b) => a + b, 0);
  assert.ok(depth.postRootOtherMilliseconds! >= -0.001);
  near(sum + depth.postRootOtherMilliseconds!, depth.postRootMilliseconds!, 'exclusive depth-one phases');
  assert.ok(depth.postRootMilliseconds! <= diagnostic.finished.totalMilliseconds + 0.5);
  const allPhaseSum = Object.values(diagnostic.phases).reduce((a, b) => a + b.milliseconds, 0);
  near(allPhaseSum + diagnostic.finished.apiOtherMilliseconds, diagnostic.finished.totalMilliseconds, 'API phases');
  const quiescence = diagnostic.phases.quiescence;
  const quiescenceChildren = (['q-evaluate', 'q-check', 'q-legal', 'q-order', 'q-execute'] as const)
    .reduce((sum, name) => sum + diagnostic.phases[name].milliseconds, 0);
  assert.ok(quiescence.milliseconds + quiescenceChildren <=
    (quiescence.inclusiveMilliseconds ?? 0) + 0.5, 'quiescence containment');
  assert.ok(diagnostic.phases['root-legal'].milliseconds <=
    (diagnostic.phases['root-legal'].inclusiveMilliseconds ?? 0) + 0.5, 'root containment');
  near(diagnostic.finished.totalMilliseconds, sample.apiElapsedMilliseconds, 'API time');
  if (depth.status === 'completed') {
    assert.equal(depth.completedCandidates, depth.rootCandidates);
    assert.equal(depth.currentCandidate, null);
    assert.equal(depth.interruptedStage, null);
    assert.ok(sample.completedDepth >= 1);
  } else {
    assert.equal(depth.status, 'interrupted');
    assert.ok(depth.interruptedStage);
    assert.equal(sample.resultSource, 'fallback');
  }
  const deadline = diagnostic.deadline;
  if (sample.timedOut) {
    assert.ok(deadline);
    near(deadline!.deadlineAt, diagnostic.startedAt + 100, 'deadline instant');
    near(deadline!.milliseconds, deadline!.checkedAt - deadline!.deadlineAt, 'deadline gap');
    assert.ok(deadline!.milliseconds >= 0);
    const observed = Object.values(deadline!.activities).reduce((a, b) => a + b, 0);
    near(observed, deadline!.milliseconds, 'deadline activities');
    assert.ok(deadline!.checkedAt <= depth.finishedAt! + 0.5 || depth.status === 'completed');
  }
}
if (!config.smoke) assert.deepEqual(rows.find(row => row.type === 'summary')?.rows, summarize(samples));
assert.equal(rows.at(-1)?.type, 'end');
console.log(`${resolve(arg)}: ${positions.length} positions / ${samples.length} samples / timing and progress audited`);
