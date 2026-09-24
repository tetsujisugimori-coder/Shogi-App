import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLegalActions, getQuiescenceLegalActionsWithDiagnostics } from '../src/domain/shogi/legalActions';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS } from './benchmarks/postRootDepthOne';
import type { CheckStage } from '../src/domain/shogi/checkInternalsDiagnostics';

const path = process.argv[2];
assert.ok(path?.endsWith('.jsonl'), 'Usage: npm run audit:check-internals -- PATH.jsonl');
const rows = readFileSync(resolve(path), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const config = rows[0];
assert.equal(config.type, 'config');
assert.equal(config.schema, 'check-internals-v1');
assert.equal(config.source, SOURCE);
assert.deepEqual(config.settings, { maxDepth: 4, timeLimitMilliseconds: 100,
  evaluation: 'standard', moveOrdering: 'standard',
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' } });
assert.equal(config.warmups, config.smoke ? 1 : 2);
assert.equal(config.runs, config.smoke ? 1 : 5);
const { positions, sourceSha256 } = replayPositions(SOURCE, config.smoke ? TARGETS.slice(0, 1) : TARGETS);
assert.equal(config.sourceSha256, sourceSha256);
const stored = rows.filter(row => row.type === 'position');
const off = rows.filter(row => row.type === 'off');
const fixed = rows.filter(row => row.type === 'fixed');
assert.equal(stored.length, positions.length);
assert.equal(off.length, positions.length * (config.warmups + config.runs));
assert.equal(fixed.length, off.length);
assert.equal(rows.filter(row => row.type === 'fixed-plain-check').length, fixed.length);
assert.equal(rows.at(-1)?.type, 'end');
const near = (actual: number, expected: number, label: string, tolerance = 1) =>
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} vs ${expected}`);
const stages: readonly CheckStage[] = ['check', 'king', 'attackSearch', 'piece', 'pattern', 'step', 'ray'];
for (const position of positions) {
  const meta = stored.find(row => row.id === position.id);
  assert.ok(meta);
  for (const key of ['stateSha256', 'positionKeySha256', 'historyLength', 'sourceResult'])
    assert.equal(meta[key], position[key as keyof typeof position]);
  const legal = getLegalActions(position.state);
  const legalProbe = new SearchDiagnostics(false, false, true);
  legalProbe.begin(performance.now());
  assert.deepEqual(getQuiescenceLegalActionsWithDiagnostics(position.state, legalProbe), legal,
    `${position.id}: quiescence diagnostic action contents/order`);
  assert.equal(meta.rootCandidates, legal.length);
  const os = off.filter(row => row.positionId === position.id);
  const fs = fixed.filter(row => row.positionId === position.id);
  assert.equal(os.length, config.warmups + config.runs);
  assert.equal(fs.length, os.length);
  for (const row of os) {
    assert.equal(row.rootCandidates, legal.length);
    assert.ok(Number.isFinite(row.apiElapsedMilliseconds) && row.apiElapsedMilliseconds >= 0);
    assert.equal(row.resultSource === 'fallback', row.completedDepth === 0);
    if (row.resultSource === 'fallback') assert.deepEqual(row.action, legal[0] ?? null);
  }
  for (const row of fs) {
    assert.ok(Number.isFinite(row.apiElapsedMilliseconds) && row.apiElapsedMilliseconds >= 0);
    const p = row.diagnostics.phases;
    near(row.diagnostics.finished.totalMilliseconds, row.apiElapsedMilliseconds, 'fixed API');
    near(Object.values(p).reduce((sum: number, entry: any) => sum + entry.milliseconds, 0) +
      row.diagnostics.finished.apiOtherMilliseconds, row.diagnostics.finished.totalMilliseconds, 'phase account');
    for (const origin of ['board', 'drop'] as const) {
      const part = row[origin];
      const parent = p[origin === 'board' ? 'q-board-own-check' : 'q-drop-own-check'];
      assert.equal(part.checks, parent.calls);
      assert.equal(part.timing.check.calls, part.checks);
      assert.equal(part.timing.king.calls, part.checks);
      assert.equal(part.attackScans, part.checks);
      assert.equal(part.scannedSquares, part.attackScans * 81);
      assert.equal(part.opponentPieces, part.pieceCalls);
      assert.equal(part.timing.attackSearch.calls, part.attackScans);
      assert.equal(part.timing.piece.calls, part.pieceCalls);
      assert.equal(part.timing.pattern.calls, part.pieceCalls);
      assert.ok(part.timing.step.calls <= part.pieceCalls);
      assert.ok(part.timing.ray.calls <= part.pieceCalls);
      for (const stage of stages) {
        const t = part.timing[stage];
        assert.ok(Number.isSafeInteger(t.calls) && t.calls >= 0);
        assert.ok(t.inclusiveMilliseconds >= 0 && t.exclusiveMilliseconds >= 0);
        assert.ok(t.maxMilliseconds >= 0 && t.maxMilliseconds <= t.inclusiveMilliseconds + 1);
      }
      near(part.timing.check.inclusiveMilliseconds,
        part.timing.check.exclusiveMilliseconds + part.timing.king.inclusiveMilliseconds +
        part.timing.attackSearch.inclusiveMilliseconds, 'check partition');
      near(part.timing.attackSearch.inclusiveMilliseconds,
        part.timing.attackSearch.exclusiveMilliseconds + part.timing.piece.inclusiveMilliseconds, 'search partition');
      near(part.timing.piece.inclusiveMilliseconds,
        part.timing.piece.exclusiveMilliseconds + part.timing.pattern.inclusiveMilliseconds +
        part.timing.step.inclusiveMilliseconds + part.timing.ray.inclusiveMilliseconds, 'piece partition');
      assert.ok(part.timing.check.inclusiveMilliseconds <= parent.inclusiveMilliseconds + 1);
    }
  }
  const semantic = rows.filter(row => row.type === 'fixed-plain-check' && row.positionId === position.id);
  assert.equal(semantic.length, fs.length);
  for (const row of semantic) {
    assert.equal(row.sameAction, true);
    assert.equal(row.sameEvaluation, true);
    assert.ok(Number.isFinite(row.apiElapsedMilliseconds) && row.apiElapsedMilliseconds >= 0);
  }
}
console.log(`${resolve(path)}: ${positions.length} positions, ${off.length} OFF and ${fixed.length} fixed ON samples audited`);
