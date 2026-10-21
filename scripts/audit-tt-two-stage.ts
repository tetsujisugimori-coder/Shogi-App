import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as current from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { createTranspositionTableStatistics } from '../src/domain/shogi/transpositionTable';
import { distancePositions, observePv, exhaustive, compareReference, apply } from './benchmarks/terminalDistanceReference';
import { json, parse, byteHash } from './benchmarks/partialRootMatches';

const [mode, output, baselineRoot] = process.argv.slice(2);
const baseSha = 'f5fdb17c777f34e4db34d903135f6a5dc88e93c9';
const textHash = (bytes: Buffer) => byteHash(Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n')));
const settings = { moveOrdering: 'standard' as const, killerMoves: false, usePreviousIterationPv: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
function stripTime(value: any): any {
  if (Array.isArray(value)) return value.map(stripTime);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => k !== 'elapsedMilliseconds').map(([k,v]) => [k,stripTime(v)]));
  return value;
}
function saveOrVerify(file: string, value: unknown) {
  if (existsSync(file)) assert.deepEqual(parse(readFileSync(file, 'utf8')), value);
  else writeFileSync(file, json(value) + '\n', { flag: 'wx' });
}
if (mode === 'reference') {
  const old = await import(pathToFileURL(resolve(baselineRoot, 'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href) as typeof current;
  const records = [];
  for (const p of distancePositions()) {
    for (const depth of [1,2,3,4]) {
      const before = old.analyzeAlphaBetaSearch(p.state, depth, undefined, () => 0, settings);
      const off = current.analyzeAlphaBetaSearch(p.state, depth, undefined, () => 0, settings);
      assert.deepEqual(off, before);
      const oldStats = {} as ReturnType<typeof createTranspositionTableStatistics>;
      const newStats = createTranspositionTableStatistics();
      const b = old.analyzeAlphaBetaSearch(p.state, depth, undefined, () => 0,
        { ...settings, useTranspositionTable: true, transpositionTableStatistics: oldStats });
      const c = current.analyzeAlphaBetaSearch(p.state, depth, undefined, () => 0,
        { ...settings, useTranspositionTable: true, transpositionTableStatistics: newStats });
      assert.deepEqual(c, b);
      for (const key of Object.keys(oldStats)) assert.equal((newStats as any)[key], (oldStats as any)[key]);
      records.push({ kind: 'deterministic-old-new', position: p.id, depth, off, on: c, oldStats, newStats });
    }
    // Independent full width in bounded cases, both ordering directions.
    const conditions: [number, number | null][] = [[1,null], [1,1], [2,1]];
    if (['mixed-distance', 'terminal-resistance', 'terminal-resistance-gote', 'mate-three'].includes(p.id)) conditions.push([4,null], [4,1]);
    for (const [depth,q] of conditions) {
      const reference = exhaustive(p.state, depth, q);
      assert.equal(compareReference(reference, exhaustive(p.state, depth, q, p.state.turn, 0, true)), 0);
      const result = current.analyzeAlphaBetaSearch(p.state, depth, undefined, undefined,
        { ...settings, useTranspositionTable: true, quiescence: q === null ? undefined : { maxTacticalDepth: q } });
      const leaf = observePv(p.state, result.principalVariation);
      assert.equal(compareReference(leaf, reference), 0); assert.deepEqual(result.selectedAction, reference.pv[0]);
      assert.deepEqual(result.evaluationBreakdown, leaf.breakdown);
      records.push({ kind: 'independent-full-width', position: p.id, depth, q, result, reference });
    }
    console.log(p.id);
  }
  const s = distancePositions().find(p => p.id === 'mixed-distance')!.state;
  for (const pv of [false,true]) for (const killer of [false,true]) {
    const options = { ...settings, usePreviousIterationPv: pv, killerMoves: killer, useTranspositionTable: true };
    const b = old.analyzeIterativeDeepeningAlphaBetaSearch(s, 4, undefined, () => 0, options);
    const c = current.analyzeIterativeDeepeningAlphaBetaSearch(s, 4, undefined, () => 0, options);
    assert.deepEqual(c,b); records.push({ kind: 'pv-killer', pv, killer, result: c });
  }
  for (const limit of [0,1,5,20,50,100,250]) {
    const run = (engine: typeof current) => { let clock = 0; return engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(
      s, 4, limit, undefined, () => clock++, { ...settings, useTranspositionTable: true }); };
    const b = run(old), c = run(current); assert.deepEqual(c,b);
    records.push({ kind: 'controlled-clock', limit, result: c });
  }
  writeFileSync(output, gzipSync(json(records) + '\n'), { flag: 'wx' });
  console.log(`Verified ${records.length} reference cases.`);
} else if (mode === 'summary') {
  const directory = resolve(output);
  const plan = parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
  const completion = parse(readFileSync(join(directory, 'completed.json'), 'utf8'));
  const raw = existsSync(join(directory,'raw.jsonl')) ? readFileSync(join(directory,'raw.jsonl')) : gunzipSync(readFileSync(join(directory,'raw.jsonl.gz')));
  assert.equal(byteHash(raw), completion.rawSha256);
  for (const [name, hash] of Object.entries(plan.sources)) {
    const measured = gunzipSync(readFileSync(join(directory,'sources',name+'.gz')));
    assert.equal(byteHash(measured), hash);
    if (name.startsWith('candidate__')) {
      const file = name.slice('candidate__'.length).replaceAll('__','/');
      // Historical probe snapshots may precede improvements to the audit CLI.
      // The offline auditor may receive post-measurement portability fixes;
      // its measured snapshot remains verified above. Timed code and helpers
      // must still match the measured text (allow checkout EOL conversion).
      if (plan.mode === 'run' && file !== 'scripts/audit-tt-two-stage.ts') {
        assert.equal(textHash(readFileSync(file)),textHash(measured),`measured candidate changed: ${file}`);
      }
    }
  }
  const rows = raw.toString().trim().split('\n').map(parse);
  assert.equal(rows.length, completion.rows); assert.equal(completion.failures,0);
  assert.equal(rows.length, plan.mode === 'run' ? plan.cells.length*12 : plan.mode === 'probe' ? 9 : 18);
  if (plan.mode === 'run') for (const cell of plan.cells) for (const repeat of [-1,0,1,2]) for (const variant of ['A','B','C']) {
    assert.equal(rows.filter(r=>r.position===cell.position && r.kind===cell.kind && r.depth===cell.depth && r.repeat===repeat && r.variant===variant).length,1);
  }
  const positions = new Map(plan.positions.map((p: any) => [p.id, p.state]));
  const legacy = ['lookups','hits','exactReuses','misses','safetyRejects','stores','evictions','maxEntries','maxPayloadCharacters'];
  let deterministicPairs = 0, timedIterations = 0, partialCandidates = 0;
  for (const [index,r] of rows.entries()) {
    assert.equal(r.sequence,index);
    assert.ok(Number.isFinite(r.callMs) && r.callMs >= 0);
    const s = r.statistics;
    assert.equal(s.lookups,s.hits+s.misses); assert.ok(s.exactReuses <= s.hits);
    assert.ok(s.maxEntries<=512); assert.ok(s.maxPayloadCharacters<=512*16384);
    const leaf = observePv(positions.get(r.position) as any,r.result.principalVariation);
    if (r.result.resultSource === 'fallback') { assert.equal(r.result.selectedEvaluation,null); assert.equal(r.result.evaluationBreakdown,null); assert.equal(r.result.principalVariation.length,0); }
    else { assert.deepEqual(r.result.evaluationBreakdown,leaf.breakdown); assert.equal(r.result.selectedEvaluation,leaf.breakdown.total); }
    assert.equal(r.terminalDistancePly,leaf.terminalDistancePly); assert.equal(r.reason,leaf.reason);
    if (r.variant === 'C') {
      assert.equal(s.identityMatches,s.exactReuses); assert.equal(s.identityMismatches,s.hits-s.exactReuses);
      assert.equal(s.safetyRejects,s.identityMismatches+s.nonExactStoreRejects+s.sizeStoreRejects);
      assert.ok(s.identityGenerations<=s.hits+s.stores+s.sizeStoreRejects);
    }
    if (r.kind === 'fixed' || r.kind === 'iterative') {
      const b = rows.find(o => o.position===r.position && o.kind===r.kind && o.depth===r.depth && o.repeat===r.repeat && o.variant==='B');
      if (r.variant==='C') {
        assert.deepEqual(stripTime(r.result),stripTime(b.result));
        for (const k of legacy) assert.equal(s[k],b.statistics[k]);
        deterministicPairs++;
      }
      assert.deepEqual(r.result.selectedAction,b.result.selectedAction);
      assert.equal(r.result.selectedEvaluation,b.result.selectedEvaluation);
      assert.deepEqual(r.result.principalVariation,b.result.principalVariation);
      assert.equal(r.terminalDistancePly,b.terminalDistancePly);
    } else if (r.result.resultSource==='completed-iteration') {
      const unlimited = rows.find(o=>o.position===r.position && o.kind==='iterative' && o.variant===r.variant);
      assert.deepEqual(stripTime(r.result.iterations),stripTime(unlimited.result.iterations.slice(0,r.result.completedDepth)));
      timedIterations++;
    } else if (r.result.resultSource==='partial-root') {
      const reference = exhaustive(apply(positions.get(r.position) as any,r.result.selectedAction),0,1,(positions.get(r.position) as any).turn,1);
      assert.equal(r.result.selectedEvaluation,reference.breakdown.total);
      assert.equal(leaf.breakdown.terminal,reference.breakdown.terminal); assert.equal(leaf.terminalDistancePly,reference.terminalDistancePly); partialCandidates++;
    }
  }
  const measured = rows.filter(r=>r.phase==='measurement');
  const percentile = (values: number[], q: number) => [...values].sort((a,b)=>a-b)[Math.ceil(q*values.length)-1];
  const histogram = (values: any[]) => Object.fromEntries([...new Set(values)].map(v=>[v,values.filter(x=>x===v).length]));
  const groups = [];
  for (const position of ['ALL',...plan.positions.map((p:any)=>p.id)]) for (const kind of ['fixed','iterative','100ms','1000ms']) for (const depth of [4,5]) for (const variant of ['A','B','C']) {
    const g = measured.filter(r=>(position==='ALL'||r.position===position) && r.kind===kind && r.depth===depth && r.variant===variant);
    if (!g.length) continue;
    if (position!=='ALL') assert.equal(g.length,plan.repeats);
    const keys = [...new Set(g.flatMap(r=>Object.keys(r.statistics)))];
    groups.push({ position,kind,depth,variant,n:g.length,totalMs:g.reduce((t,r)=>t+r.callMs,0),
      p50Ms:percentile(g.map(r=>r.callMs),.5),p95Ms:percentile(g.map(r=>r.callMs),.95),
      maxOverrunMs:Math.max(...g.map(r=>r.overrunMs??0)),maxRss:Math.max(...g.map(r=>r.rssBefore),...g.map(r=>r.rssAfter)),
      cpuUserMs:g.reduce((t,r)=>t+r.cpuUsed.user/1000,0),cpuSystemMs:g.reduce((t,r)=>t+r.cpuUsed.system/1000,0),
      ordinaryNodes:g.reduce((t,r)=>t+(r.result.visitedPositionCount??0),0),qNodes:g.reduce((t,r)=>t+(r.result.quiescenceVisitedPositionCount??0),0),
      totalOrdinaryNodes:g.reduce((t,r)=>t+(r.result.totalVisitedPositionCount??r.result.visitedPositionCount??0),0),
      totalQNodes:g.reduce((t,r)=>t+(r.result.totalQuiescenceVisitedPositionCount??r.result.quiescenceVisitedPositionCount??0),0),
      completedDepth:histogram(g.map(r=>r.result.completedDepth??r.result.depth)),source:histogram(g.map(r=>r.result.resultSource??kind)),
      statistics:Object.fromEntries(keys.map(k=>[k,k.startsWith('max')?Math.max(...g.map(r=>r.statistics[k]??0)):g.reduce((t,r)=>t+(r.statistics[k]??0),0)])) });
  }
  execFileSync('git',['diff','--exit-code',baseSha,'--','docs/benchmarks/transposition-table-20261021']);
  const summary = { rows:rows.length,warmups:rows.length-measured.length,measured:measured.length,
    deterministicPairs,timedIterations,partialCandidates,rawSha256:byteHash(raw),groups };
  saveOrVerify(join(directory,'summary.json'),summary);
  console.log(json({ ...summary,groups:groups.filter(g=>g.position==='ALL') }));
} else if (mode==='manifest') {
  const root=resolve(output), target=join(root,'manifest.json');
  const collect=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?collect(join(dir,e.name)):join(dir,e.name)===target?[]:[join(dir,e.name)]);
  const files=[...collect(root),'src/domain/shogi/twoPlyAlphaBetaAi.ts','src/domain/shogi/transpositionTable.ts',
    'src/test/shogi-transposition-table.test.ts','scripts/measure-tt-two-stage.ts','scripts/audit-tt-two-stage.ts','README.md','LOG.md'].sort();
  saveOrVerify(target,{ base:baseSha, textHash: 'SHA-256 of UTF-8 text normalized CRLF to LF; .gz uses original bytes',
    files:Object.fromEntries(files.map(f=>[relative(process.cwd(),resolve(f)).replaceAll('\\','/'),
      f.endsWith('.gz') ? byteHash(readFileSync(f)) : textHash(readFileSync(f))])) });
  console.log(`Verified ${files.length} hashes.`);
} else throw Error('Use reference OUTPUT.gz BASELINE_ROOT, summary RUN_DIRECTORY, or manifest EVIDENCE_DIRECTORY');
