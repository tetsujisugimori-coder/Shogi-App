import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { analyzeAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS } from './benchmarks/postRootDepthOne';
import { CHILD_PHASES, summarizeQLegal, type FixedProbe, type QLegalSample } from './benchmarks/qLegalBreakdown';

const path = process.argv[2];
assert.ok(path?.endsWith('.jsonl'), 'Usage: npm run audit:q-legal-breakdown -- PATH.jsonl');
const rows = readFileSync(resolve(path), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const config = rows[0];
assert.equal(config?.type, 'config');
assert.equal(config.schema, 'q-legal-breakdown-v2');
assert.equal(config.source, SOURCE);
assert.deepEqual(config.settings, { maxDepth: 4, timeLimitMilliseconds: 100,
  evaluation: 'standard', moveOrdering: 'standard',
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' } });
assert.equal(config.warmups, config.smoke ? 1 : 2);
assert.equal(config.runs, config.smoke ? 1 : 5);
const { positions, sourceSha256 } = replayPositions(SOURCE, config.smoke ? TARGETS.slice(0, 1) : TARGETS);
assert.equal(config.sourceSha256, sourceSha256);
const storedPositions = rows.filter(row => row.type === 'position');
assert.equal(storedPositions.length, positions.length);
const legal = new Map(positions.map(position => [position.id, getLegalActions(position.state)]));
for (const position of positions) {
  const stored = storedPositions.find(row => row.id === position.id);
  assert.ok(stored);
  for (const name of ['stateSha256', 'positionKeySha256', 'historyLength', 'sourceResult'])
    assert.equal(stored[name], position[name as keyof typeof position], `${position.id}: ${name}`);
}
const samples = rows.filter(row => row.type === 'sample') as QLegalSample[];
const fixed = rows.filter(row => row.type === 'fixed-probe') as FixedProbe[];
assert.equal(samples.length, positions.length * 2 * (config.warmups + config.runs));
assert.equal(fixed.length, positions.length * (config.warmups + config.runs));
const near = (a: number, b: number, label: string, tolerance = 0.5) =>
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance,
    `${label}: ${a} vs ${b}`);
for (const position of positions) {
  const own = samples.filter(row => row.positionId === position.id);
  assert.equal(own.length, 2 * (config.warmups + config.runs));
  for (const phase of ['warmup', 'measurement'] as const) {
    const count = phase === 'warmup' ? config.warmups : config.runs;
    for (let run = 1; run <= count; run++) {
      const pair = own.filter(row => row.phase === phase && row.run === run);
      assert.equal(pair.length, 2);
      assert.deepEqual(pair.map(row => row.probe), (run - 1 + (phase === 'measurement' ? config.warmups : 0)) % 2
        ? [true, false] : [false, true]);
      assert.deepEqual(pair[0].action, pair[1].action, `${position.id}: selection changed`);
    }
  }
}
for (const sample of samples) {
  assert.ok(Number.isFinite(sample.apiElapsedMilliseconds) && sample.apiElapsedMilliseconds >= 0);
  assert.ok(Number.isFinite(sample.callElapsedMilliseconds) &&
    sample.callElapsedMilliseconds >= sample.apiElapsedMilliseconds - 0.5);
  assert.equal(sample.resultSource === 'fallback', sample.completedDepth === 0);
  if (sample.resultSource === 'fallback') assert.deepEqual(sample.action,
    legal.get(sample.positionId)?.[0] ?? null, `${sample.positionId}: fallback order`);
  if (!sample.probe) { assert.equal(sample.diagnostics, null); continue; }
  const d = sample.diagnostics;
  assert.ok(d);
  assert.ok(d.depthOne);
  // The root total comes from a fresh public legal-action enumeration of the replayed state.
  assert.equal(d.depthOne.rootCandidates, legal.get(sample.positionId)!.length,
    `${sample.positionId}: independent root candidates`);
  assert.ok(d.depthOne.completedCandidates >= 0 && d.depthOne.completedCandidates <= d.depthOne.rootCandidates);
  assert.equal(d.phases['root-piece-moves'].calls, 0);
  assert.equal(d.phases['root-hand-drops'].calls, 0);
  near(d.finished.totalMilliseconds, sample.apiElapsedMilliseconds, 'API time');
  const phaseSum = Object.values(d.phases).reduce((sum, entry) => {
    assert.ok(Number.isSafeInteger(entry.calls) && entry.calls >= 0);
    assert.ok(Number.isFinite(entry.milliseconds) && entry.milliseconds >= 0);
    if (entry.inclusiveMilliseconds !== undefined) {
      assert.ok(Number.isFinite(entry.inclusiveMilliseconds) && entry.inclusiveMilliseconds >= 0);
      assert.ok(entry.milliseconds <= entry.inclusiveMilliseconds + 0.5);
    }
    if (entry.maxMilliseconds !== undefined) {
      assert.ok(Number.isFinite(entry.maxMilliseconds) && entry.maxMilliseconds >= 0);
      assert.ok(entry.maxMilliseconds <= (entry.inclusiveMilliseconds ?? 0) + 0.5);
    }
    return sum + entry.milliseconds;
  }, 0);
  near(phaseSum + d.finished.apiOtherMilliseconds, d.finished.totalMilliseconds, 'exclusive API phases');
  const p = d.phases;
  const children = CHILD_PHASES.reduce((sum, name) => sum + p[name].milliseconds, 0);
  near(p['q-legal'].milliseconds + children, p['q-legal'].inclusiveMilliseconds ?? 0,
    'q-legal parent and children');
  const boardChildren = p['q-board-pseudo'].milliseconds + p['q-board-simulate'].milliseconds +
    p['q-board-own-check'].milliseconds;
  near(p['q-board-moves'].milliseconds + boardChildren,
    p['q-board-moves'].inclusiveMilliseconds ?? 0, 'board parent and children');
  const dropChildren = p['q-drop-board-setup'].milliseconds + p['q-drop-own-check'].milliseconds +
    p['q-drop-pawn-mate'].milliseconds;
  near(p['q-hand-drops'].milliseconds + dropChildren,
    p['q-hand-drops'].inclusiveMilliseconds ?? 0, 'drop parent and children');
  const c = d.qLegalCounts;
  for (const [name, value] of Object.entries(c))
    assert.ok(Number.isSafeInteger(value) && value >= 0, `${name}: count`);
  assert.equal(p['q-board-moves'].calls, c.boardSources);
  assert.equal(p['q-board-pseudo'].calls, c.boardSources);
  assert.equal(p['q-board-simulate'].calls, c.boardPseudo);
  assert.equal(p['q-board-own-check'].calls, c.boardPseudo);
  assert.ok(c.boardLegal <= c.boardPseudo);
  assert.ok(c.boardActions >= c.boardLegal && c.boardActions <= 2 * c.boardLegal);
  assert.equal(p['q-hand-drops'].calls, c.dropTypes);
  assert.equal(c.dropCandidates, 81 * c.dropTypes);
  assert.equal(c.dropActions, c.dropLegal);
  assert.ok(c.dropLegal <= c.dropCandidates);
  assert.equal(p['q-drop-board-setup'].calls, p['q-drop-own-check'].calls);
  assert.ok(p['q-drop-board-setup'].calls <= c.dropCandidates);
  assert.ok(p['q-drop-pawn-mate'].calls <= p['q-drop-own-check'].calls);
  assert.equal(c.actions, c.boardActions + c.dropActions);
  if (p['q-legal'].calls === 0) {
    assert.equal(c.actions, 0);
    assert.equal(c.boardSources, 0);
    assert.equal(c.dropTypes, 0);
  } else {
    assert.ok(c.boardSources >= p['q-legal'].calls);
  }
}
for (const position of positions) {
  const own = fixed.filter(row => row.positionId === position.id);
  assert.equal(own.length, config.warmups + config.runs);
  const plain = analyzeAlphaBetaSearch(position.state, 1, resolveSearchEvaluationPreset('standard'),
    undefined, { moveOrdering: 'standard', quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' } });
  for (let index = 0; index < own.length; index++) {
    const row = own[index];
    assert.equal(row.phase, index < config.warmups ? 'warmup' : 'measurement');
    assert.equal(row.run, index < config.warmups ? index + 1 : index - config.warmups + 1);
    assert.ok(Number.isFinite(row.apiElapsedMilliseconds) && row.apiElapsedMilliseconds >= 0);
    assert.deepEqual(row.action, plain.selectedAction, `${position.id}: fixed selected action`);
    assert.equal(row.evaluation, plain.selectedEvaluation, `${position.id}: fixed evaluation`);
    const d = row.diagnostics;
    near(d.finished.totalMilliseconds, row.apiElapsedMilliseconds, 'fixed API');
    const all = Object.values(d.phases).reduce((sum, entry) => {
      assert.ok(Number.isSafeInteger(entry.calls) && entry.calls >= 0);
      assert.ok(Number.isFinite(entry.milliseconds) && entry.milliseconds >= 0);
      assert.ok(entry.milliseconds <= (entry.inclusiveMilliseconds ?? 0) + 0.5);
      assert.ok((entry.maxMilliseconds ?? 0) <= (entry.inclusiveMilliseconds ?? 0) + 0.5);
      return sum + entry.milliseconds;
    }, 0);
    near(all + d.finished.apiOtherMilliseconds, d.finished.totalMilliseconds, 'fixed exclusive API');
    const p = d.phases;
    const children = CHILD_PHASES.reduce((sum, name) => sum + p[name].milliseconds, 0);
    near(p['q-legal'].milliseconds + children, p['q-legal'].inclusiveMilliseconds ?? 0,
      'fixed q-legal containment');
    near(p['q-board-moves'].milliseconds + p['q-board-pseudo'].milliseconds +
      p['q-board-simulate'].milliseconds + p['q-board-own-check'].milliseconds,
    p['q-board-moves'].inclusiveMilliseconds ?? 0, 'fixed board containment');
    near(p['q-hand-drops'].milliseconds + p['q-drop-board-setup'].milliseconds +
      p['q-drop-own-check'].milliseconds + p['q-drop-pawn-mate'].milliseconds,
    p['q-hand-drops'].inclusiveMilliseconds ?? 0, 'fixed drop containment');
    const c = d.qLegalCounts;
    assert.ok(p['q-legal'].calls > 0);
    assert.equal(p['q-board-moves'].calls, c.boardSources);
    assert.equal(p['q-board-pseudo'].calls, c.boardSources);
    assert.equal(p['q-board-simulate'].calls, c.boardPseudo);
    assert.equal(p['q-board-own-check'].calls, c.boardPseudo);
    assert.ok(c.boardLegal <= c.boardPseudo);
    assert.ok(c.boardActions >= c.boardLegal && c.boardActions <= 2 * c.boardLegal);
    assert.equal(p['q-hand-drops'].calls, c.dropTypes);
    assert.equal(c.dropCandidates, 81 * c.dropTypes);
    assert.equal(c.dropActions, c.dropLegal);
    assert.ok(c.dropLegal <= c.dropCandidates);
    assert.equal(p['q-drop-board-setup'].calls, p['q-drop-own-check'].calls);
    assert.ok(p['q-drop-board-setup'].calls <= c.dropCandidates);
    assert.ok(p['q-drop-pawn-mate'].calls <= p['q-drop-own-check'].calls);
    assert.equal(c.actions, c.boardActions + c.dropActions);
  }
}
if (!config.smoke) assert.deepEqual(rows.find(row => row.type === 'summary')?.rows, summarizeQLegal(samples, fixed));
assert.equal(rows.at(-1)?.type, 'end');
console.log(`${resolve(path)}: ${positions.length} positions / ${samples.length} timed samples / ${fixed.length} fixed probes / q-legal accounting and independent root totals audited`);
