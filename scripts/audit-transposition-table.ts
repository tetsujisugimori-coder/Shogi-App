import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { analyzeAlphaBetaSearch as fixed, analyzeIterativeDeepeningAlphaBetaSearch as iterative } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { createTranspositionTableStatistics } from '../src/domain/shogi/transpositionTable';
import { distancePositions, observePv, exhaustive, compareReference, apply } from './benchmarks/terminalDistanceReference';
import { json, parse, byteHash } from './benchmarks/partialRootMatches';

const [mode, directory] = process.argv.slice(2);
const settings = { moveOrdering: 'standard' as const, killerMoves: false, usePreviousIterationPv: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
function stripTime(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTime);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => k !== 'elapsedMilliseconds').map(([k,v]) => [k,stripTime(v)]));
  return value;
}
if (mode === 'reference') {
  const baseline = await import(pathToFileURL(resolve(process.argv[4], 'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href);
  const records = [];
  for (const p of distancePositions()) {
    for (const depth of [1,2,3,4]) {
      const before = baseline.analyzeAlphaBetaSearch(p.state, depth, undefined, () => 0, settings);
      const after = fixed(p.state, depth, undefined, () => 0, { ...settings, useTranspositionTable: false });
      assert.deepEqual(after, before);
      records.push({ kind: 'main-off', position: p.id, depth, result: after });
    }
    const conditions: [number, number | null][] = [[1,null], [1,1], [2,1]];
    if (['mixed-distance','terminal-resistance','terminal-resistance-gote','mate-three'].includes(p.id)) conditions.push([4,null], [4,1]);
    for (const [depth,q] of conditions) {
      const reference = exhaustive(p.state, depth, q);
      const reverse = exhaustive(p.state, depth, q, p.state.turn, 0, true);
      assert.equal(compareReference(reference, reverse), 0);
      const statistics = createTranspositionTableStatistics();
      const r = fixed(p.state, depth, undefined, undefined, { ...settings, useTranspositionTable: true,
        transpositionTableStatistics: statistics, quiescence: q === null ? undefined : { maxTacticalDepth: q } });
      const observed = observePv(p.state, r.principalVariation);
      assert.equal(compareReference(observed, reference), 0, `${p.id} d${depth} q${q}`);
      assert.deepEqual(r.selectedAction, reference.pv[0]);
      assert.deepEqual(r.evaluationBreakdown, observed.breakdown);
      records.push({ kind: 'independent-full-width', position: p.id, depth, q, reference, result: r, statistics });
    }
    console.log(p.id);
  }
  writeFileSync(directory, json(records)+'\n', { flag: 'wx' });
} else if (mode === 'summary') {
  const plan = parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
  const completed = parse(readFileSync(join(directory, 'completed.json'), 'utf8'));
  const raw = existsSync(join(directory, 'raw.jsonl')) ? readFileSync(join(directory, 'raw.jsonl'))
    : gunzipSync(readFileSync(join(directory, 'raw.jsonl.gz')));
  assert.equal(byteHash(raw), completed.rawSha256);
  const all = raw.toString('utf8').trim().split('\n').map(parse);
  assert.equal(all.length, 384); assert.equal(completed.rows, 384);
  assert.equal(completed.failures, 0);
  for (const [file, hash] of Object.entries(plan.sources)) {
    assert.equal(byteHash(readFileSync(file)), hash, `measured bytes changed: ${file}`);
    assert.equal(byteHash(gunzipSync(readFileSync(join(directory, 'sources', file.replaceAll('/', '__')+'.gz')))), hash);
  }
  const positions = new Map(plan.positions.map((p: any) => [p.id, p.state]));
  const rows = all.filter(r => r.phase === 'measurement');
  const groups: any[] = [];
  const percentile = (xs: number[], q: number) => [...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*q)-1];
  const metric = (r: any, field: string) => r.result[field] ?? 0;
  const histogram = (xs: any[]) => Object.fromEntries([...new Set(xs)].map(x => [x, xs.filter(v=>v===x).length]));
  let pvDifferences = 0, checkedPartial = 0;
  for (const r of all) {
    assert.ok(!r.error, r.error);
    const state = positions.get(r.position) as any;
    const pv = observePv(state, r.result.principalVariation);
    assert.equal(r.statistics.lookups, r.statistics.hits + r.statistics.misses);
    assert.ok(r.statistics.exactReuses <= r.statistics.hits);
    assert.ok(r.statistics.maxEntries <= 512);
    assert.ok(r.statistics.maxPayloadCharacters <= 512*16384);
    if (r.result.resultSource === 'fallback') {
      assert.equal(r.result.selectedEvaluation, null); assert.equal(r.result.evaluationBreakdown, null);
      assert.equal(r.result.principalVariation.length, 0);
    } else {
      assert.deepEqual(r.result.evaluationBreakdown, pv.breakdown);
      assert.equal(r.result.selectedEvaluation, pv.breakdown.total);
    }
    if (r.mode === 'fixed' || r.mode === 'iterative') {
      const other = all.find(o => o.position === r.position && o.mode === r.mode && o.repeat === r.repeat && o.enabled !== r.enabled)!;
      assert.deepEqual(r.result.selectedAction, other.result.selectedAction);
      assert.equal(r.result.selectedEvaluation, other.result.selectedEvaluation);
      assert.equal(r.terminalDistancePly, other.terminalDistancePly);
      if (json(r.result.principalVariation) !== json(other.result.principalVariation)) pvDifferences++;
    } else if (r.result.resultSource === 'completed-iteration') {
      const unlimited = all.find(o => o.position === r.position && o.mode === 'iterative' && o.enabled === r.enabled)!;
      assert.deepEqual(stripTime(r.result.iterations), stripTime(unlimited.result.iterations.slice(0,r.result.completedDepth)));
    } else if (r.result.resultSource === 'partial-root') {
      const child = apply(state, r.result.selectedAction);
      const reference = exhaustive(child, 0, 1, state.turn, 1);
      // Observe suffix with root-relative distance retained.
      assert.equal(r.result.selectedEvaluation, reference.breakdown.total);
      assert.equal(pv.breakdown.terminal, reference.breakdown.terminal);
      assert.equal(pv.terminalDistancePly, reference.terminalDistancePly);
      checkedPartial++;
    }
  }
  for (const position of ['ALL', ...plan.positions.map((p: any) => p.id)]) for (const mode of plan.modes) for (const enabled of [false,true]) {
    const g = rows.filter(r => (position === 'ALL' || r.position === position) && r.mode === mode && r.enabled === enabled);
    assert.equal(g.length, position === 'ALL' ? 36 : 3);
    const stats = Object.fromEntries(Object.keys(createTranspositionTableStatistics()).map(k => [k,
      k.startsWith('max') ? Math.max(...g.map(r=>r.statistics[k])) : g.reduce((t,r)=>t+r.statistics[k],0)]));
    groups.push({ position, mode, enabled, n: g.length,
      p50Ms: percentile(g.map(r=>r.callMs),.5), p95Ms: percentile(g.map(r=>r.callMs),.95),
      maximumOverrunMs: Math.max(...g.map(r=>r.overrunMs ?? 0)),
      ordinaryNodes: g.reduce((t,r)=>t+metric(r,'visitedPositionCount'),0),
      qNodes: g.reduce((t,r)=>t+metric(r,'quiescenceVisitedPositionCount'),0),
      totalOrdinaryNodes: g.reduce((t,r)=>t+metric(r, 'totalVisitedPositionCount'),0),
      totalQNodes: g.reduce((t,r)=>t+metric(r,'totalQuiescenceVisitedPositionCount'),0),
      cutoffs: g.reduce((t,r)=>t+metric(r,'cutoffCount')+metric(r,'quiescenceCutoffCount'),0),
      depthHistogram: histogram(g.map(r=>r.result.completedDepth ?? r.result.depth)),
      sourceHistogram: histogram(g.map(r=>r.result.resultSource ?? mode)), statistics: stats });
  }
  execFileSync('git', ['diff', '--exit-code', plan.base, '--', 'docs/benchmarks/pv-ordering-20261021',
    'docs/benchmarks/terminal-distance-20261020', 'docs/benchmarks/terminal-distance-nan-20261021']);
  const summary = { rows: all.length, warmups: all.length-rows.length, measured: rows.length, failures: 0,
    missing: 0, pvDifferenceRows: pvDifferences, independentlyCheckedPartialRows: checkedPartial, rawSha256: byteHash(raw), groups };
  const path = join(directory, 'summary.json');
  try { assert.deepEqual(parse(readFileSync(path,'utf8')),summary); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; writeFileSync(path,json(summary)+'\n',{flag:'wx'}); }
  console.log(json(summary.groups.filter((g: any)=>g.position==='ALL')));
  console.log(`Verified ${all.length} rows, source snapshots, PV leaves, fixed pairs, timed iterations, ${checkedPartial} independent partial candidates, preserved old diagnostics.`);
} else if (mode === 'manifest') {
  const output = join(directory, 'manifest.json');
  const collect = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(folder,entry.name);
    return entry.isDirectory() ? collect(path) : path === output ? [] : [path];
  });
  const files = ['src/domain/shogi/twoPlyAlphaBetaAi.ts','src/domain/shogi/transpositionTable.ts',
    'src/test/shogi-transposition-table.test.ts','scripts/measure-transposition-table.ts','scripts/audit-transposition-table.ts',
    'README.md','LOG.md', ...collect(directory)].sort();
  const manifest = { base: '519a332c36ad97dacdaae8c09a20a8e08bf511be',
    files: Object.fromEntries(files.map(f=>[f.replaceAll('\\','/'),byteHash(readFileSync(f))])) };
  try { assert.deepEqual(parse(readFileSync(output,'utf8')), manifest); }
  catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; writeFileSync(output,json(manifest)+'\n',{flag:'wx'}); }
  console.log(`Verified ${files.length} file hashes.`);
} else throw new Error('Use reference OUTPUT BASELINE_ROOT, summary RUN_DIRECTORY, or manifest EVIDENCE_DIRECTORY');
