import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPositions, summarizeSamples, type Sample } from './benchmarks/timedDepthOneDiagnostics';

const path = process.argv[2];
if (!path) throw new Error('Usage: npm run audit:timed-depth-one -- PATH.jsonl');
const rows = readFileSync(resolve(path), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const config = rows[0];
assert.equal(config.type, 'config');
const { positions, sourceSha256 } = replayPositions();
assert.equal(config.sourceSha256, sourceSha256);
const storedPositions = rows.filter(row => row.type === 'position');
for (const stored of storedPositions) {
  const original = positions.find(position => position.id === stored.id);
  assert.ok(original);
  assert.equal(stored.stateSha256, original.stateSha256);
  assert.equal(stored.historyLength, original.historyLength);
}
const samples = rows.filter(row => row.type === 'sample') as Sample[];
assert.equal(samples.length, storedPositions.length * 2 * 2 * (config.warmups + config.measurements));
for (const sample of samples) {
  assert.ok(storedPositions.some(position => position.id === sample.positionId));
  assert.ok(sample.actualElapsedMilliseconds >= sample.apiElapsedMilliseconds - 0.2);
  if (!sample.probe) { assert.equal(sample.diagnostics, null); continue; }
  assert.ok(sample.diagnostics);
  const diagnostic = sample.diagnostics!;
  const measured = Object.values(diagnostic.phases as Record<string, { milliseconds: number }>).reduce(
    (sum, row) => sum + row.milliseconds, 0);
  assert.ok(Math.abs(diagnostic.totalMilliseconds - measured - diagnostic.apiOtherMilliseconds) < 1);
  if (sample.mode === 'timed' && sample.resultSource === 'fallback') assert.equal(sample.completedDepth, 0);
}
const summary = rows.find(row => row.type === 'summary');
assert.ok(summary);
assert.deepEqual(summary.rows, summarizeSamples(samples));
assert.equal(rows.at(-1)?.type, 'end');
console.log(`${resolve(path)}: ${storedPositions.length} positions / ${samples.length} samples / summary reproduced`);
