import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openSync, writeSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS } from './benchmarks/postRootDepthOne';

const path = process.argv[2];
assert.ok(path?.endsWith('.jsonl'), 'Usage: tsx scripts/snapshot-check-shortcircuit-legal.ts PATH.jsonl');
const { positions, sourceSha256 } = replayPositions(SOURCE, TARGETS);
const fd = openSync(resolve(path), 'wx');
try {
  const emit = (value: object) => writeSync(fd, JSON.stringify(value) + '\n');
  emit({ type: 'config', head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceSha256 });
  for (const position of positions) {
    const before = JSON.stringify(position.state);
    const actions = getLegalActions(position.state);
    assert.equal(JSON.stringify(position.state), before);
    emit({ type: 'position', id: position.id, stateSha256: position.stateSha256,
      positionKeySha256: position.positionKeySha256, historyLength: position.historyLength,
      sourceResult: position.sourceResult, legalCount: actions.length,
      legalActionsSha256: createHash('sha256').update(JSON.stringify(actions)).digest('hex') });
  }
} finally {
  closeSync(fd);
}
