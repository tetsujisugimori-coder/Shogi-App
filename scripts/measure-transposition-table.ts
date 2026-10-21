import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { analyzeAlphaBetaSearch, analyzeIterativeDeepeningAlphaBetaSearch,
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { createTranspositionTableStatistics, TRANSPOSITION_TABLE_CAPACITY } from '../src/domain/shogi/transpositionTable';
import { distancePositions, observePv } from './benchmarks/terminalDistanceReference';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { json, hash, byteHash } from './benchmarks/partialRootMatches';

const output = resolve(process.argv[2]);
mkdirSync(output); // never overwrite evidence
mkdirSync(join(output, 'sources'));
const positions = distancePositions();
const modes = ['fixed', 'iterative', '100ms', '1000ms'] as const;
const settings = { moveOrdering: 'standard' as const, killerMoves: false, usePreviousIterationPv: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
const sources = ['src/domain/shogi/twoPlyAlphaBetaAi.ts', 'src/domain/shogi/transpositionTable.ts',
  'src/domain/shogi/searchValue.ts', 'src/domain/shogi/quiescenceSearch.ts',
  'scripts/measure-transposition-table.ts', 'scripts/audit-transposition-table.ts',
  'scripts/benchmarks/terminalDistanceReference.ts', 'scripts/benchmarks/tacticalPositions.ts'];
for (const file of sources) writeFileSync(join(output, 'sources', file.replaceAll('/', '__') + '.gz'), gzipSync(readFileSync(file)), { flag: 'wx' });
const plan = { startedAt: new Date().toISOString(), sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  base: execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(),
  diff: execFileSync('git', ['diff', '--binary'], { encoding: 'utf8' }),
  status: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }),
  node: process.version, npm: execFileSync('npm.cmd', ['--version'], { encoding: 'utf8', shell: true }).trim(),
  platform: platform(), release: release(), arch: arch(), cpu: cpus()[0].model,
  settings, maxDepth: 4, modes, repeats: 3, warmupPerCondition: 1, capacity: TRANSPOSITION_TABLE_CAPACITY,
  order: 'position, mode, warmup pair then three measurement pairs; OFF/ON alternates every pair',
  sources: Object.fromEntries(sources.map(f => [f, byteHash(readFileSync(f))])),
  positions: positions.map(p => ({ ...p, hash: hash(p.state) })),
  limits: 'Serial synchronous calls, no concurrent tests/build. OS/JIT/GC/power/affinity uncontrolled. Three measured pairs per cell are exploratory.' };
writeFileSync(join(output, 'plan.json'), json(plan) + '\n', { flag: 'wx' });
writeFileSync(join(output, 'raw.jsonl'), '', { flag: 'wx' });
let pair = 0, sequence = 0, failures = 0;
for (const p of positions) {
  for (const mode of modes) {
    for (let repeat = -1; repeat < 3; repeat++) {
      for (const enabled of pair++ % 2 ? [true, false] : [false, true]) {
        const input = protectSearchInput(p.state), before = hash(p.state);
        const statistics = createTranspositionTableStatistics();
        const options = { ...settings, useTranspositionTable: enabled, transpositionTableStatistics: statistics };
        const budget = mode === '100ms' ? 100 : mode === '1000ms' ? 1000 : null;
        const start = performance.now();
        try {
          const result = mode === 'fixed' ? analyzeAlphaBetaSearch(input.snapshot, 4, undefined, undefined, options)
            : mode === 'iterative' ? analyzeIterativeDeepeningAlphaBetaSearch(input.snapshot, 4, undefined, undefined, options)
            : analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, 4, budget!, undefined, undefined, options);
          const callMs = performance.now() - start;
          assert.equal(input.wasMutated(), false); assert.equal(hash(p.state), before);
          const pv = observePv(p.state, result.principalVariation);
          if ('resultSource' in result && result.resultSource === 'fallback') {
            assert.equal(result.selectedEvaluation, null); assert.equal(result.evaluationBreakdown, null);
            assert.equal(result.principalVariation.length, 0);
          } else {
            assert.deepEqual(result.evaluationBreakdown, pv.breakdown);
            assert.equal(result.selectedEvaluation, pv.breakdown.total);
          }
          appendFileSync(join(output, 'raw.jsonl'), json({ sequence: sequence++, position: p.id,
            phase: repeat < 0 ? 'warmup' : 'measurement', repeat, enabled, mode, budget, callMs,
            overrunMs: budget === null ? null : Math.max(0, callMs - budget), result, statistics,
            reason: pv.reason, terminalDistancePly: pv.terminalDistancePly }) + '\n');
        } catch (error) {
          failures++;
          appendFileSync(join(output, 'raw.jsonl'), json({ sequence: sequence++, position: p.id,
            phase: repeat < 0 ? 'warmup' : 'measurement', repeat, enabled, mode, budget,
            callMs: performance.now() - start, statistics, error: String(error) }) + '\n');
        }
      }
    }
    console.log(`${p.id} ${mode}`);
  }
}
writeFileSync(join(output, 'completed.json'), json({ finishedAt: new Date().toISOString(), rows: sequence, failures,
  rawSha256: byteHash(readFileSync(join(output, 'raw.jsonl'))) }) + '\n', { flag: 'wx' });
assert.equal(failures, 0);
