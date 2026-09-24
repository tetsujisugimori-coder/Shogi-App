import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { ROOT_LEGAL_TARGETS } from './benchmarks/rootLegalTargets';

const out = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2]?.endsWith('.jsonl'), 'Usage: tsx scripts/measure-drop-copy-root.ts PATH.jsonl');
assert.ok(!existsSync(out), 'output already exists');
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const positions = replayPositions(SOURCE, ROOT_LEGAL_TARGETS.slice(0, 4)).positions;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' }).trim();
const warmups = 2;
const runs = 12;
const rows: object[] = [{ type: 'config', schema: 'drop-copy-root-v1', startedAt: new Date().toISOString(),
  head, dirty: status !== '', node: process.version, os: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model ?? 'unknown', warmups, runs,
  timing: 'diagnostics OFF; protected input; synchronous getLegalActions call; round-robin positions with alternating order' }];
for (const position of positions) {
  const input = protectSearchInput(position.state);
  const actions = getLegalActions(input.snapshot);
  assert.equal(input.wasMutated(), false);
  rows.push({ type: 'position', id: position.id, stateSha256: position.stateSha256,
    actionCount: actions.length, actionsSha256: sha(actions) });
}
for (let round = 0; round < warmups + runs; round++) {
  const ordered = round % 2 ? [...positions].reverse() : positions;
  for (const position of ordered) {
    const input = protectSearchInput(position.state);
    const start = performance.now();
    const actions = getLegalActions(input.snapshot);
    const elapsedMilliseconds = performance.now() - start;
    assert.equal(input.wasMutated(), false);
    rows.push({ type: 'sample', positionId: position.id,
      phase: round < warmups ? 'warmup' : 'measurement', run: round < warmups ? round + 1 : round - warmups + 1,
      elapsedMilliseconds, actionsSha256: sha(actions) });
  }
}
rows.push({ type: 'end', endedAt: new Date().toISOString() });
writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
console.log(`${out}: ${positions.length} positions, ${positions.length * runs} measurements`);
