import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { cpus, release } from 'node:os';
import { gzipSync } from 'node:zlib';
// Keep worker bootstrap free of any product/fixture import from this checkout.
const json = (v: unknown) => JSON.stringify(v, (_k, n: unknown) => typeof n === 'number' && !Number.isFinite(n)
  ? n === Infinity ? '+Infinity' : n === -Infinity ? '-Infinity' : 'NaN' : n);
const parse = (s: string): any => JSON.parse(s, (_k, n: unknown) => n === '+Infinity' ? Infinity : n === '-Infinity' ? -Infinity : n === 'NaN' ? NaN : n);
const byteHash = (v: Buffer) => createHash('sha256').update(v).digest('hex');

const settings = { moveOrdering: 'standard' as const, killerMoves: false, usePreviousIterationPv: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
const sha = (root: string) => execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const [mode, destination, oldArg, currentArg, selection] = process.argv.slice(2);
if (mode === 'worker') {
  const root = resolve(destination), variant = oldArg;
  const ai = await import(pathToFileURL(join(root, 'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href);
  const tt = await import(pathToFileURL(join(root, 'src/domain/shogi/transpositionTable.ts')).href);
  const { protectSearchInput } = await import(pathToFileURL(join(root, 'src/domain/shogi/selfPlayGame.ts')).href);
  for await (const line of createInterface({ input: process.stdin })) {
    const task = parse(line);
    try {
      const stats = tt.createTranspositionTableStatistics();
      const input = protectSearchInput(task.state);
      const options = { ...settings, useTranspositionTable: variant !== 'A', transpositionTableStatistics: stats };
      const cpu = process.cpuUsage(), start = performance.now();
      const result = task.kind === 'fixed' ? ai.analyzeAlphaBetaSearch(input.snapshot, 4, undefined, undefined, options)
        : task.kind === 'iterative' ? ai.analyzeIterativeDeepeningAlphaBetaSearch(input.snapshot, 4, undefined, undefined, options)
        : ai.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, 4, task.budget, undefined, undefined, options);
      const callMs = performance.now() - start, cpuUsed = process.cpuUsage(cpu);
      assert.equal(input.wasMutated(), false);
      // PR196 eagerly generates once per lookup; do not claim a measured counter.
      if (variant === 'B') Object.assign(stats, { identityGenerations: stats.lookups, identityGenerationsInferred: true,
        storeRejectsInferredIncludingSize: stats.safetyRejects - (stats.hits - stats.exactReuses) });
      process.stdout.write(json({ callMs, cpuUsed, result, statistics: stats,
        diagnostic: (globalThis as any).__ttProfile ?? null }) + '\n');
      (globalThis as any).__ttProfile = {};
    } catch (e) { process.stdout.write(json({ failure: String(e), stack: (e as Error).stack }) + '\n'); }
  }
} else {
  const { distancePositions, observePv } = await import('./benchmarks/terminalDistanceReference');
  assert.ok(['pilot', 'run', 'diagnostic'].includes(mode));
  assert.ok(destination && oldArg && currentArg);
  const out = resolve(destination), old = resolve(oldArg), current = resolve(currentArg);
  assert.equal(sha(old), 'f5fdb17c777f34e4db34d903135f6a5dc88e93c9');
  assert.equal(sha(current), 'b031decd02ed32a036e43d88829a217cc385b70d');
  for(const root of [old,current]) {
    execFileSync('git',['-C',root,'diff','--exit-code','HEAD','--','src','package.json','package-lock.json']);
    assert.equal(execFileSync('git',['-C',root,'ls-files','--others','--exclude-standard','src'],{encoding:'utf8'}).trim(),'');
  }
  mkdirSync(out); mkdirSync(join(out, 'sources'));
  const ids = (selection ?? 'mate-sente,resistance,evasion,capture,terminal-resistance-gote,recapture,mixed-distance').split(',');
  const positions = ids.map(id => { const p = distancePositions().find(p => p.id === id); assert.ok(p, id); return p; });
  const variants = ['A','B','C'];
  const roots: Record<string,string> = { A: current, B: old, C: current };
  if (mode === 'diagnostic') { variants.push('P'); roots.P = resolve(current, '../tt-profile'); }
  const collect = (dir: string): string[] => readdirSync(join(current,dir),{withFileTypes:true})
    .flatMap(e=>e.isDirectory()?collect(dir+'/'+e.name):[dir+'/'+e.name]);
  const files = [...collect('src'), 'package.json','package-lock.json',
    'scripts/benchmarks/terminalDistanceReference.ts','scripts/benchmarks/tacticalPositions.ts',
    'scripts/benchmarks/partialRootMatches.ts','scripts/measure-tt-bottleneck.ts','scripts/prepare-tt-profile.ts'];
  const sources: Record<string,string> = {};
  for (const v of variants) for (const file of files) {
    const bytes = readFileSync(join(file.startsWith('scripts/') || file==='package-lock.json' ? process.cwd() : roots[v], file));
    const name = v + '__' + file.replaceAll('/','__'); sources[name] = byteHash(bytes);
    writeFileSync(join(out, 'sources', name+'.gz'), gzipSync(bytes), { flag: 'wx' });
  }
  const repeats = mode === 'run' ? 7 : 1;
  const cells = positions.flatMap(p => (mode === 'diagnostic' ? ['fixed'] : ['fixed','iterative','100ms','1000ms'])
    .map(kind => ({ position: p.id, kind, budget: kind === '100ms' ? 100 : kind === '1000ms' ? 1000 : null })));
  writeFileSync(join(out,'plan.json'), json({ mode, startedAt: new Date().toISOString(), main: sha(current), old: sha(old),
    runnerHead: sha(process.cwd()), roots, settings, node: process.version, os: release(), cpu: cpus()[0].model,
    sourceHashes: sources, inputHash: byteHash(Buffer.from(json(positions))), positions, variants, cells, repeats,
    warmups: 1, order: 'serial; rotate variants every repeat including warmup; independent persistent process per variant',
    limitations: 'OS scheduling, affinity, power, JIT and GC uncontrolled; n=7 p95 is maximum; no build/tests during timing' })+'\n');
  const workers = new Map(variants.map(v => {
    const profiler = mode==='diagnostic'&&v==='C'?['--cpu-prof',`--cpu-prof-dir=${out}`,'--cpu-prof-name=C.cpuprofile']:[];
    const child = spawn(process.execPath, [...profiler,'--import', import.meta.resolve('tsx'), fileURLToPath(import.meta.url), 'worker', roots[v], v],
      { cwd: roots[v], stdio: ['pipe','pipe','inherit'] });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    return [v, { child, lines }];
  }));
  let sequence = 0, rotation = 0;
  try {
    for (const cell of cells) {
      const p = positions.find(p => p.id === cell.position)!;
      for (let repeat = -1; repeat < repeats; repeat++) {
        const offset = rotation++ % variants.length;
        for (const variant of [...variants.slice(offset),...variants.slice(0,offset)]) {
          const worker = workers.get(variant)!;
          worker.child.stdin.write(json({ ...cell, state: p.state })+'\n');
          const answer = await worker.lines.next(); assert.equal(answer.done,false);
          const row = { sequence: sequence++, ...cell, variant, repeat, phase: repeat < 0 ? 'warmup' : 'measurement', ...parse(answer.value) };
          appendFileSync(join(out,'raw.jsonl'),json(row)+'\n');
          assert.ok(!row.failure, row.failure);
          const pv = observePv(p.state,row.result.principalVariation);
          if (row.result.resultSource === 'fallback') {
            assert.equal(row.result.selectedEvaluation,null); assert.equal(row.result.evaluationBreakdown,null); assert.equal(row.result.principalVariation.length,0);
          } else { assert.deepEqual(row.result.evaluationBreakdown,pv.breakdown); assert.equal(row.result.selectedEvaluation,pv.breakdown.total); }
        }
      }
      console.log(`${cell.position} ${cell.kind}: complete`);
    }
    writeFileSync(join(out,'completed.json'),json({ rows: sequence, failures: 0, finishedAt: new Date().toISOString(),
      rawSha256: byteHash(readFileSync(join(out,'raw.jsonl'))) })+'\n');
  } finally { for (const w of workers.values()) w.child.stdin.end(); }
}
