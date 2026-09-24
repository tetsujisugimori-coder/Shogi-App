import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayPositions } from './benchmarks/timedDepthOneDiagnostics';
import { summarizeLongTail, type LongTailSample } from './benchmarks/timedLongTail';

const path = process.argv[2];
if (!path) throw new Error('Usage: npm run audit:timed-long-tail -- PATH.jsonl');
const rows = readFileSync(resolve(path), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
const config = rows[0];
assert.equal(config.type, 'config');
assert.equal(config.schema, 'long-tail-v1');
assert.equal(rows.at(-1)?.type, 'end');
const { positions, sourceSha256 } = replayPositions();
assert.equal(config.sourceSha256, sourceSha256);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const games = rows.filter(row => row.type === 'game');
assert.equal(games.length, config.config.pairCount * 2);
for (const game of games) {
  assert.ok(game.plies.length <= config.config.maxPlies);
  if (game.status === 'max_plies') {
    assert.equal(game.plies.length, config.config.maxPlies);
    assert.equal(game.detail.reason, 'max_plies');
  }
}
const gamePlies = games.flatMap(game => game.plies.map((ply: { ply: number; positionKey: string }) => ({
  id: `g${game.executionIndex}-p${ply.ply}`, key: sha(ply.positionKey), ply,
})));
const samples = rows.filter(row => row.type === 'sample') as LongTailSample[];
const fromGames = samples.filter(sample => sample.source === 'game');
assert.equal(fromGames.length, gamePlies.length);
for (let index = 0; index < fromGames.length; index++) {
  assert.equal(fromGames[index].id, gamePlies[index].id);
  assert.equal(fromGames[index].positionKeySha256, gamePlies[index].key);
  assert.equal(fromGames[index].resultSource, (gamePlies[index].ply as { resultSource: string }).resultSource);
  assert.deepEqual(fromGames[index].action, (gamePlies[index].ply as { action: unknown }).action);
}
const storedPositions = rows.filter(row => row.type === 'position');
assert.equal(storedPositions.length, 3);
for (const stored of storedPositions) {
  const original = positions.find(position => position.id === stored.id);
  assert.ok(original);
  assert.equal(stored.stateSha256, original.stateSha256);
  assert.equal(stored.positionKeySha256, original.positionKeySha256);
}
assert.equal(samples.length, gamePlies.length + 3 * 2 * (config.warmups + config.runs));
const replay = samples.filter(sample => sample.source === 'replay');
assert.equal(new Set(replay.map(sample => `${sample.id}:${sample.phase}:${sample.run}:${sample.probe}`)).size, replay.length);
for (const sample of replay) {
  const original = positions.find(position => position.id === sample.id);
  assert.ok(original);
  assert.equal(sample.positionKeySha256, original.positionKeySha256);
  assert.equal(sample.historyLength, original.historyLength);
}
for (const sample of samples) {
  assert.ok(sample.callElapsedMilliseconds >= sample.apiElapsedMilliseconds - 0.5);
  assert.ok(Math.abs(sample.excessMilliseconds - (sample.callElapsedMilliseconds - config.config.timeLimitMilliseconds)) < 1e-6);
  assert.equal(sample.interval.end - sample.interval.start, sample.callElapsedMilliseconds);
  assert.equal(sample.resultSource === 'fallback', sample.completedDepth === 0);
  if (!sample.probe) assert.equal(sample.diagnostics, null);
  else {
    assert.ok(sample.diagnostics);
    const diagnostic = sample.diagnostics!;
    const sum = Object.values(diagnostic.phases).reduce((total, phase) => total + phase.milliseconds, 0);
    assert.ok(Math.abs(sum + diagnostic.apiOtherMilliseconds - diagnostic.totalMilliseconds) < 0.5);
    assert.ok(Math.abs(diagnostic.totalMilliseconds - sample.apiElapsedMilliseconds) < 0.5);
  }
  for (const gc of sample.gc.events) assert.equal(gc.overlapsSearch,
    gc.start < sample.interval.end && gc.start + gc.duration > sample.interval.start);
  if (sample.heap.status === 'available') {
    assert.ok(sample.heap.before && sample.heap.after);
    assert.ok(sample.heap.before.at <= sample.interval.start);
    assert.ok(sample.heap.after.at >= sample.interval.end);
  } else assert.ok(sample.heap.reason);
  if (sample.gc.status === 'unavailable') assert.ok(sample.gc.reason);
}
const summary = rows.find(row => row.type === 'summary');
assert.ok(summary);
assert.deepEqual(summary, { type: 'summary', ...summarizeLongTail(samples) });
console.log(`${resolve(path)}: ${games.length} games / ${samples.length} samples / summary reproduced`);
