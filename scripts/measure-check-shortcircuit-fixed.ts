import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, writeSync } from 'node:fs';
import { arch, cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyzeAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { replayPositions, SOURCE } from './benchmarks/timedDepthOneDiagnostics';
import { TARGETS } from './benchmarks/postRootDepthOne';

const out = process.argv[2];
assert.ok(out?.endsWith('.jsonl'), 'Usage: tsx scripts/measure-check-shortcircuit-fixed.ts OUT.jsonl');
const { positions, sourceSha256 } = replayPositions(SOURCE, TARGETS);
const evaluation = resolveSearchEvaluationPreset('standard');
const options = { moveOrdering: 'standard' as const,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
const fd = openSync(resolve(out), 'wx');
const emit = (value: object) => writeSync(fd, JSON.stringify(value) + '\n');
try {
  emit({ type: 'config', schema: 'check-shortcircuit-fixed-v1',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    startedAt: new Date().toISOString(), source: SOURCE, sourceSha256,
    node: process.version, os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    settings: { depth: 1, evaluation: 'standard', moveOrdering: 'standard',
      quiescence: options.quiescence }, warmups: 2, runs: 5,
    execution: 'one process, synchronous serial, no diagnostics; rotate four positions each run' });
  for (const position of positions) emit({ type: 'position', id: position.id,
    stateSha256: position.stateSha256, positionKeySha256: position.positionKeySha256,
    historyLength: position.historyLength, sourceResult: position.sourceResult });
  for (let index = 0; index < 7; index++) for (const position of positions) {
    const input = protectSearchInput(position.state);
    const start = performance.now();
    const result = analyzeAlphaBetaSearch(input.snapshot, 1, evaluation, undefined, options);
    const elapsedMilliseconds = performance.now() - start;
    assert.equal(input.wasMutated(), false);
    emit({ type: 'sample', positionId: position.id,
      phase: index < 2 ? 'warmup' : 'measurement', run: index < 2 ? index + 1 : index - 1,
      elapsedMilliseconds, action: result.selectedAction, evaluation: result.selectedEvaluation });
  }
  emit({ type: 'end', endedAt: new Date().toISOString() });
} finally { closeSync(fd); }
console.log(`${out}: ${positions.length} positions, 5 measured runs`);
