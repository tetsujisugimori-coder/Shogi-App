import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { ROOT_LEGAL_TARGETS } from './benchmarks/rootLegalTargets';

const path = process.argv[2];
assert.ok(path, 'Usage: npm run audit:root-legal-breakdown -- PATH.jsonl');
const rows = readFileSync(resolve(path), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const config = rows[0];
assert.equal(config.type, 'config');
assert.equal(config.schema, 'root-legal-breakdown-v1');
assert.equal(rows.at(-1)?.type, 'end');
const stored = rows.filter(row => row.type === 'position');
const requested = stored.map(row => {
  const found = ROOT_LEGAL_TARGETS.find(item => `g${item.game}-p${item.ply}` === row.id);
  assert.ok(found);
  return found;
});
const { positions, sourceSha256 } = replayPositions(SOURCE, requested);
assert.equal(config.sourceSha256, sourceSha256);
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
for (const [index, position] of positions.entries()) {
  const row = stored[index];
  assert.equal(row.id, position.id);
  assert.equal(row.stateSha256, position.stateSha256);
  assert.equal(row.positionKeySha256, position.positionKeySha256);
  assert.equal(row.historyLength, position.historyLength);
  const plain = getLegalActions(position.state);
  assert.equal(row.legalActionCount, plain.length);
  assert.equal(row.legalActionsSha256, sha(plain));
  const diagnostic = new SearchDiagnostics();
  assert.deepEqual(getLegalActions(position.state, diagnostic), plain);
}
const samples = rows.filter(row => row.type === 'sample');
assert.equal(samples.length, stored.length * 2 * (config.warmups + config.runs));
assert.equal(new Set(samples.map(row => `${row.positionId}:${row.phase}:${row.run}:${row.probe}`)).size, samples.length);
for (const row of samples) {
  assert.ok(stored.some(position => position.id === row.positionId));
  assert.ok(row.callElapsedMilliseconds >= 0);
  assert.ok(Math.abs(row.excessMilliseconds - (row.callElapsedMilliseconds - config.config.timeLimitMilliseconds)) < 1e-6);
  assert.equal(row.resultSource === 'fallback', row.completedDepth === 0);
  if (!row.probe) { assert.equal(row.root, null); assert.equal(row.diagnostics, null); continue; }
  const root = row.root;
  assert.ok(root);
  assert.equal(row.diagnostics.phases['root-legal'].calls, 1);
  assert.ok(Math.abs(root.totalMilliseconds - row.diagnostics.phases['root-legal'].maxMilliseconds) < 1e-6);
  assert.ok(Math.abs(root.residualMilliseconds - (root.totalMilliseconds - root.pieceMilliseconds - root.dropMilliseconds)) < 1e-6);
  assert.ok(root.residualMilliseconds >= -0.5);
  assert.equal(root.pieceCalls, row.diagnostics.phases['root-piece-moves'].calls);
  assert.equal(root.dropCalls, row.diagnostics.phases['root-hand-drops'].calls);
  assert.ok(Math.abs(root.pieceMilliseconds - row.diagnostics.phases['root-piece-moves'].milliseconds) < 1e-6);
  assert.ok(Math.abs(root.dropMilliseconds - row.diagnostics.phases['root-hand-drops'].milliseconds) < 1e-6);
  assert.equal(Object.values(root.byType).reduce((sum: number, entry: any) => sum + entry.calls, 0), root.dropCalls);
  const state = positions.find(position => position.id === row.positionId)!.state;
  assert.equal(Object.values(root.byType).reduce((sum: number, entry: any) => sum + entry.legal, 0),
    getLegalActions(state).filter(action => action.kind === 'drop').length);
  assert.equal(root.pieceCalls, state.squares.flat().filter(square => square.piece?.player === state.turn).length);
  for (const [type, entry] of Object.entries(root.byType) as Array<[string, any]>) {
    assert.equal(entry.candidates, entry.calls * 81);
    assert.equal(entry.candidates, entry.legal + Object.values(entry.rejected).reduce((sum: number, count: any) => sum + count, 0));
    assert.ok(entry.maxMilliseconds <= entry.milliseconds + 1);
    for (const reason of Object.keys(entry.rejected))
      assert.ok(['occupied_drop_square', 'dead_piece_drop', 'nifu', 'self_check_unresolved', 'pawn_drop_mate'].includes(reason));
    const cloned = entry.candidates - (entry.rejected.occupied_drop_square ?? 0) -
      (entry.rejected.dead_piece_drop ?? 0) - (entry.rejected.nifu ?? 0);
    assert.equal(entry.stages['board-clone'].calls, cloned);
    assert.equal(entry.stages['own-check'].calls, cloned);
    assert.equal(entry.stages['pawn-drop-mate'].calls,
      type === 'pawn' ? cloned - (entry.rejected.self_check_unresolved ?? 0) : 0);
    for (const stage of Object.values(entry.stages) as any[]) {
      assert.ok(stage.calls <= entry.candidates);
      if (config.stageTiming === 'off') assert.equal(stage.milliseconds, 0);
      else if (stage.calls) assert.ok(stage.maxMilliseconds <= stage.milliseconds + 1);
    }
  }
  assert.ok(Math.abs(Object.values(row.diagnostics.phases).reduce((sum: number, phase: any) => sum + phase.milliseconds, 0) +
    row.diagnostics.apiOtherMilliseconds - row.diagnostics.totalMilliseconds) < 0.5);
}
console.log(`${resolve(path)}: ${stored.length} positions / ${samples.length} samples verified`);
