import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SOURCE, replayPositions } from './benchmarks/timedDepthOneDiagnostics';
import { ROOT_LEGAL_TARGETS } from './benchmarks/rootLegalTargets';

const path = process.argv[2];
assert.ok(path, 'Usage: npm run audit:root-legal-context -- PATH.jsonl');
const rows = readFileSync(resolve(path), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const config = rows[0];
assert.equal(config.schema, 'root-legal-context-v1');
assert.equal(rows.at(-1)?.type, 'end');
const sourceBytes = readFileSync(SOURCE);
assert.equal(config.sourceSha256, createHash('sha256').update(sourceBytes).digest('hex'));
const sourceGames = sourceBytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line))
  .filter(row => row.type === 'game');
const storedGames = rows.filter(row => row.type === 'game');
assert.deepEqual(storedGames, sourceGames);
const samples = rows.filter(row => row.type === 'sample');
assert.equal(samples.length, sourceGames.reduce((sum, game) => sum + game.plies.length, 0));
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const { positions } = replayPositions(SOURCE, ROOT_LEGAL_TARGETS);
let index = 0;
for (const game of sourceGames) for (const ply of game.plies) {
  const sample = samples[index++];
  assert.equal(sample.id, `g${game.executionIndex}-p${ply.ply}`);
  assert.equal(sample.positionKeySha256, sha(ply.positionKey));
  const target = positions.find(position => position.id === sample.id);
  assert.equal(sample.matchesSavedPosition, target ? sample.positionKeySha256 === target.positionKeySha256 : null);
  assert.ok(sample.callElapsedMilliseconds >= 0);
  assert.equal(sample.resultSource === 'fallback', sample.completedDepth === 0);
  const root = sample.root;
  assert.ok(root);
  assert.ok(Math.abs(root.totalMilliseconds - root.pieceMilliseconds - root.dropMilliseconds - root.residualMilliseconds) < 1e-6);
  assert.ok(root.residualMilliseconds >= -0.5);
  assert.equal(Object.values(root.byType).reduce((sum: number, entry: any) => sum + entry.calls, 0), root.dropCalls);
  for (const entry of Object.values(root.byType) as any[]) {
    assert.equal(entry.candidates, entry.calls * 81);
    assert.equal(entry.candidates, entry.legal + Object.values(entry.rejected).reduce((sum: number, count: any) => sum + count, 0));
    assert.ok(entry.maxMilliseconds <= entry.milliseconds + 1);
    for (const stage of Object.values(entry.stages) as any[]) assert.equal(stage.milliseconds, 0);
  }
}
console.log(`${resolve(path)}: ${storedGames.length} saved games / ${samples.length} samples verified`);
