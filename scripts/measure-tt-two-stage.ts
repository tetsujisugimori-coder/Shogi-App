import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release, arch } from 'node:os';
import { gzipSync } from 'node:zlib';
import * as current from '../src/domain/shogi/twoPlyAlphaBetaAi';
import * as tt from '../src/domain/shogi/transpositionTable';
import { distancePositions, observePv, apply } from './benchmarks/terminalDistanceReference';
import { constructed } from './benchmarks/tacticalPositions';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { createPositionKey } from '../src/domain/shogi/repetition';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { json, byteHash } from './benchmarks/partialRootMatches';

const [mode, destination, baselineRoot] = process.argv.slice(2);
assert.ok(['probe', 'run', 'diagnostic'].includes(mode));
assert.ok(destination && baselineRoot);
const base = resolve(baselineRoot);
const sha = 'f5fdb17c777f34e4db34d903135f6a5dc88e93c9';
assert.equal(execFileSync('git', ['-C', base, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha);
const old = await import(pathToFileURL(join(base, 'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href) as typeof current;
const oldTt = await import(pathToFileURL(join(base, 'src/domain/shogi/transpositionTable.ts')).href) as typeof tt;
const settings = { moveOrdering: 'standard' as const, killerMoves: false, usePreviousIterationPv: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const positions = distancePositions();

// A real 120-ply legal replay. Avoid fourth occurrences; preserve complete
// history, snapshots, IDs and hand order. No synthetic history records.
let long = constructed('long-legal-history', [[8,8,'king','sente'], [0,0,'king','gote']]);
let seed = 197;
const frequencies = new Map<string, number>([[createPositionKey(long), 1]]);
for (let ply = 0; ply < 120; ply++) {
  const actions = getLegalActions(long);
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  let found = false;
  for (let n = 0; n < actions.length; n++) {
    const child = apply(long, actions[(seed % actions.length + n) % actions.length]);
    const key = createPositionKey(child), count = frequencies.get(key) ?? 0;
    if (child.status === 'ended' || count >= 3) continue;
    long = child; frequencies.set(key, count + 1); found = true; break;
  }
  assert.ok(found, `legal replay exhausted at ${ply}`);
}
assert.equal(long.history.length, 120);
positions.push({ ...positions[0], id: 'long-legal-history', state: long });
const cells = positions.flatMap(p => (['fixed', 'iterative', '100ms', '1000ms'] as const)
  .map(kind => ({ position: p.id, kind, depth: 4, budget: kind === '100ms' ? 100 : kind === '1000ms' ? 1000 : null })));
for (const id of ['mixed-distance', 'terminal-resistance', 'long-legal-history']) {
  cells.push({ position: id, kind: 'fixed', depth: 5, budget: null });
}
const output = resolve(destination);
mkdirSync(output); mkdirSync(join(output, 'sources'));
const sourceFiles = ['src/domain/shogi/twoPlyAlphaBetaAi.ts', 'src/domain/shogi/transpositionTable.ts',
  'src/domain/shogi/searchValue.ts', 'src/domain/shogi/quiescenceSearch.ts',
  'src/test/shogi-transposition-table.test.ts', 'scripts/measure-tt-two-stage.ts', 'scripts/audit-tt-two-stage.ts',
  'scripts/benchmarks/terminalDistanceReference.ts', 'scripts/benchmarks/tacticalPositions.ts'];
const sources: Record<string, string> = {};
for (const [label, root] of [['baseline', base], ['candidate', process.cwd()]]) {
  for (const file of sourceFiles) {
    if (label === 'baseline' && (file.includes('tt-two-stage'))) continue;
    const bytes = readFileSync(join(root, file));
    const name = `${label}__${file.replaceAll('/', '__')}`;
    sources[name] = byteHash(bytes);
    writeFileSync(join(output, 'sources', name + '.gz'), gzipSync(bytes), { flag: 'wx' });
    if (label === 'baseline') {
      const committed = execFileSync('git', ['-C', base, 'show', `${sha}:${file}`], { maxBuffer: 32 * 1024 * 1024 });
      assert.equal(bytes.toString().replaceAll('\r\n', '\n'), committed.toString().replaceAll('\r\n', '\n'));
    }
  }
}
writeFileSync(join(output, 'plan.json'), json({ mode, startedAt: new Date().toISOString(), base: sha,
  candidateHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  diff: execFileSync('git', ['diff', '--binary'], { encoding: 'utf8' }),
  node: process.version, npm: execFileSync('npm.cmd', ['--version'], { shell: true, encoding: 'utf8' }).trim(),
  platform: platform(), release: release(), arch: arch(), cpu: cpus()[0].model,
  settings, positions, cells, sources, repeats: mode === 'run' ? 3 : 1,
  warmups: mode === 'probe' ? 0 : 1, order: 'cell then repeat; ABC/BCA/CAB, rotation continues across cells',
  instrumentation: mode === 'diagnostic' ? 'prototype wrappers: key, probe (lazy identity included), store (JSON/capacity/Map); nested callback measures hit identity' : 'none; B identityGenerations=lookups inferred after timing',
  limits: 'Serial calls; OS/JIT/GC/power/affinity uncontrolled; 3 measured samples/cell exploratory; RSS outside timed call; CPU usage outside timed call.' }) + '\n', { flag: 'wx' });

let sequence = 0, rotation = 0;
const rows: unknown[] = [];
let diagnostic: Record<string, number> = {};
if (mode === 'diagnostic') {
  for (const module of [oldTt, tt]) for (const name of ['key', 'probe', 'store'] as const) {
    const proto = module.ExactTranspositionTable.prototype;
    const original = proto[name] as (...args: any[]) => any;
    (proto as any)[name] = function(...args: any[]) {
      if (name === 'probe' && typeof args[1] === 'function') {
        const identity = args[1];
        args[1] = () => { const start = performance.now(); try { return identity(); }
          finally { diagnostic.hitIdentityMs = (diagnostic.hitIdentityMs ?? 0) + performance.now() - start; } };
      }
      const start = performance.now();
      try { return original.apply(this, args); }
      finally { diagnostic[name + 'Ms'] = (diagnostic[name + 'Ms'] ?? 0) + performance.now() - start; }
    };
  }
}
const selectedCells = mode === 'probe' ? cells.filter(c => c.depth === 5) : mode === 'diagnostic'
  ? cells.filter(c => ['mixed-distance', 'hirate-exchange', 'long-legal-history'].includes(c.position) && c.kind === 'fixed' && c.depth === 4) : cells;
for (const cell of selectedCells) {
  const p = positions.find(p => p.id === cell.position)!;
  for (let repeat = mode === 'probe' ? 0 : -1; repeat < (mode === 'run' ? 3 : 1); repeat++) {
    const offset = rotation++ % 3;
    for (const variant of [...variants.slice(offset), ...variants.slice(0, offset)] as Variant[]) {
      const engine = variant === 'C' ? current : old;
      const statistics = (variant === 'C' ? tt : oldTt).createTranspositionTableStatistics();
      const options = { ...settings, useTranspositionTable: variant !== 'A', transpositionTableStatistics: statistics };
      const input = protectSearchInput(p.state), before = byteHash(Buffer.from(json(p.state)));
      diagnostic = {};
      const rssBefore = process.memoryUsage().rss, cpu = process.cpuUsage();
      const start = performance.now();
      const result = cell.kind === 'fixed' ? engine.analyzeAlphaBetaSearch(input.snapshot, cell.depth, undefined, undefined, options)
        : cell.kind === 'iterative' ? engine.analyzeIterativeDeepeningAlphaBetaSearch(input.snapshot, cell.depth, undefined, undefined, options)
        : engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, cell.depth, cell.budget!, undefined, undefined, options);
      const callMs = performance.now() - start;
      const cpuUsed = process.cpuUsage(cpu), rssAfter = process.memoryUsage().rss;
      assert.equal(input.wasMutated(), false);
      assert.equal(byteHash(Buffer.from(json(p.state))), before);
      const pv = observePv(p.state, result.principalVariation);
      if ('resultSource' in result && result.resultSource === 'fallback') {
        assert.equal(result.selectedEvaluation, null); assert.equal(result.evaluationBreakdown, null);
        assert.equal(result.principalVariation.length, 0);
      } else { assert.deepEqual(result.evaluationBreakdown, pv.breakdown); assert.equal(result.selectedEvaluation, pv.breakdown.total); }
      const inferred = variant === 'B' ? { identityGenerations: statistics.lookups,
        identityMatches: statistics.exactReuses, identityMismatches: statistics.hits - statistics.exactReuses } : {};
      const row = { sequence: sequence++, ...cell, repeat, variant, phase: repeat < 0 ? 'warmup' : 'measurement',
        callMs, overrunMs: cell.budget === null ? null : Math.max(0, callMs - cell.budget),
        rssBefore, rssAfter, cpuUsed, result, statistics: { ...statistics, ...inferred },
        terminalDistancePly: pv.terminalDistancePly, reason: pv.reason,
        ...(mode === 'diagnostic' ? { diagnostic } : {}) };
      appendFileSync(join(output, 'raw.jsonl'), json(row) + '\n'); rows.push(row);
    }
  }
  console.log(`${cell.position} ${cell.kind} d${cell.depth}`);
}
writeFileSync(join(output, 'completed.json'), json({ finishedAt: new Date().toISOString(), rows: rows.length,
  failures: 0, rawSha256: byteHash(readFileSync(join(output, 'raw.jsonl'))) }) + '\n', { flag: 'wx' });
