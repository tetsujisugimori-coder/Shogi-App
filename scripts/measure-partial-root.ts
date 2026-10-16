import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import * as product from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { analyzeQuiescenceSearch } from '../src/domain/shogi/quiescenceSearch';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import { resolveSearchEvaluationPreset } from '../src/domain/shogi/searchEvaluationPresets';
import { executeLegalAction, getLegalActions, type LegalAction } from '../src/domain/shogi/legalActions';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { validatePartialRoot } from '../src/application/partialRootValidation';
import type { BoardState } from '../src/types/shogi';

const [baselineDir, outputDir] = process.argv.slice(2);
assert.ok(baselineDir && outputDir, 'usage: tsx scripts/measure-partial-root.ts BASELINE NEW_OUTPUT');
mkdirSync(outputDir); // Refuse to overwrite any previous raw run.
const baseline = await import(pathToFileURL(path.resolve(baselineDir, 'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href) as typeof product;
const git = (args: string[], cwd = process.cwd()) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const json = (v: unknown) => JSON.stringify(v, (_key, n: unknown) =>
  typeof n === 'number' && !Number.isFinite(n) ? n === Infinity ? '+Infinity' : n === -Infinity ? '-Infinity' : 'NaN' : n);
const write = (name: string, v: unknown) => appendFileSync(path.join(outputDir, name), json(v) + '\n');
const inputPath = 'docs/benchmarks/fallback-quality-20261014/positions.json.gz';
const inputBytes = readFileSync(inputPath);
const document = JSON.parse(gunzipSync(inputBytes).toString()) as { positions: { id: string; state: BoardState; positionKeySha256: string }[] };
assert.equal(document.positions.length, 10);
assert.equal(new Set(document.positions.map(p => p.positionKeySha256)).size, 10);
const options = { moveOrdering: 'standard' as const, killerMoves: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
const evaluation = resolveSearchEvaluationPreset('standard');
const config = { startedAt: new Date().toISOString(), baselineSha: git(['rev-parse','HEAD'],baselineDir),
  productSha: git(['rev-parse','HEAD']), dirty: git(['status','--porcelain']),
  diff: git(['diff']), baselineDirty: git(['status','--porcelain'],baselineDir),
  platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model,
  node: process.version, npm: execFileSync('npm.cmd', ['--version'], { encoding: 'utf8', shell: true }).trim(),
  runnerSha256: createHash('sha256').update(readFileSync('scripts/measure-partial-root.ts')).digest('hex'),
  positionsByteSha256: createHash('sha256').update(inputBytes).digest('hex'),
  positions: document.positions.map(p => ({ id:p.id, stateSha256:hash(p.state), positionHash:p.positionKeySha256 })),
  budgets: [100,1000], warmup: 2, samples: 5, maxDepth: 4, options, evaluation: 'standard', diagnostics: false,
  order: 'position, budget, round(-2..4); alternate baseline/product first by position+round parity; synchronous one process',
  acceptance: { timing: 'C minus baseline pooled p50 and p95 <= max(5ms, 1% budget); inspect maximum outliers and per-position depth shifts',
    quality: 'all partial exact scores match independent unbounded q1; no score below original first action',
    fixed: 'depth1 action, score, PV, all node/cutoff statistics identical across 10 saved positions' } };
write('environment.jsonl', config);
const rows: { version: string; position: string; budget: number; phase: string; run: number; callMs: number;
  apiMs: number; overrunMs: number; result: product.TimeLimitedIterativeDeepeningAlphaBetaSearchResult }[] = [];
// No diagnostics hook, validation, or output inside either measured interval.
for (const [positionIndex, position] of document.positions.entries()) {
  for (const budget of [100,1000]) {
    for (let round = -2; round < 5; round++) {
      const order = (positionIndex + round + 2) % 2 ? ['product','baseline'] : ['baseline','product'];
      for (const version of order) {
        const input = protectSearchInput(position.state);
        const search = version === 'baseline' ? baseline : product;
        const before = performance.now();
        const result = search.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot, 4, budget, evaluation, undefined, options);
        const callMs = performance.now() - before;
        const row = { version, position: position.id, budget, phase: round < 0 ? 'warmup' : 'sample',
          run: round, callMs, apiMs:result.elapsedMilliseconds, overrunMs:callMs-budget, result };
        assert.equal(input.wasMutated(),false);
        assert.ok(result.selectedAction && getLegalActions(position.state).some(a => product.areLegalActionsEqual(a,result.selectedAction!)));
        if (result.resultSource === 'partial-root') assert.ok(validatePartialRoot(position.state,result,1));
        rows.push(row); write('raw.jsonl',row);
      }
    }
  }
  process.stdout.write(`timed ${position.id}\n`);
}
write('events.jsonl',{event:'timing-complete',at:new Date().toISOString(),calls:rows.length});
// Independent quality evaluation starts only after ALL timed calls have ended.
const quality: { position:string; budget:number; run:number; selected:number; fallback:number; improvement:number|null; comparison:'improved'|'equal'|'worsened' }[] = [];
for (const position of document.positions) {
  const cache = new Map<string,number>();
  const evaluateAction = (action: LegalAction) => {
    const key = JSON.stringify(action);
    if (cache.has(key)) return cache.get(key)!;
    const next = executeLegalAction(position.state,action);
    assert.equal(next.type,'applied'); if (next.type !== 'applied') throw new Error('action');
    const score = next.state.status === 'ended' ? evaluateSearchPositionBreakdown(next.state,position.state.turn,evaluation).total
      : analyzeQuiescenceSearch(next.state,position.state.turn,1,evaluation,undefined,'original').selectedEvaluation;
    cache.set(key,score); return score;
  };
  const fallback = evaluateAction(getLegalActions(position.state)[0]);
  for (const row of rows.filter(r => r.position === position.id && r.version === 'product' && r.phase === 'sample' && r.result.resultSource === 'partial-root')) {
    const score = evaluateAction(row.result.selectedAction!);
    assert.equal(score,row.result.selectedEvaluation,'partial candidate is exact');
    assert.ok(score >= fallback,'partial does not worsen first action');
    const entry = {position:position.id,budget:row.budget,run:row.run,selected:score,fallback,
      improvement:Number.isFinite(score)&&Number.isFinite(fallback)?score-fallback:null,
      comparison:score>fallback?'improved' as const:score===fallback?'equal' as const:'worsened' as const};
    quality.push(entry);write('quality.jsonl',entry);
  }
  const fixedA = baseline.analyzeAlphaBetaSearch(position.state,1,evaluation,()=>0,options);
  const fixedC = product.analyzeAlphaBetaSearch(position.state,1,evaluation,()=>0,options);
  assert.deepEqual(fixedC,fixedA);
  write('fixed.jsonl',{position:position.id,depth:1,identical:true,baseline:fixedA,product:fixedC});
  assert.equal(hash(position.state),config.positions.find(p=>p.id===position.id)!.stateSha256);
}
const quantile = (xs:number[],p:number) => [...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
const group = (rs:typeof rows) => ({ calls:rs.length,
  sources:Object.fromEntries([...new Set(rs.map(r=>r.result.resultSource))].map(s=>[s,rs.filter(r=>r.result.resultSource===s).length])),
  depths:Object.fromEntries([...new Set(rs.map(r=>r.result.completedDepth))].map(d=>[d,rs.filter(r=>r.result.completedDepth===d).length])),
  apiP50:quantile(rs.map(r=>r.apiMs),.5),callP50:quantile(rs.map(r=>r.callMs),.5),callP95:quantile(rs.map(r=>r.callMs),.95),
  maxOverrun:Math.max(...rs.map(r=>r.overrunMs)),overrunCount:rs.filter(r=>r.overrunMs>0).length });
const samples = rows.filter(r=>r.phase==='sample');
const summary = { endedAt:new Date().toISOString(),calls:rows.length,samples:samples.length,distinctPositions:10,
  conditions:[100,1000].map(budget=>({ budget,baseline:group(samples.filter(r=>r.budget===budget&&r.version==='baseline')),
    product:group(samples.filter(r=>r.budget===budget&&r.version==='product')),
    quality:{calls:quality.filter(q=>q.budget===budget).length,
      improved:quality.filter(q=>q.budget===budget&&q.comparison==='improved').length,
      equal:quality.filter(q=>q.budget===budget&&q.comparison==='equal').length,
      worsened:quality.filter(q=>q.budget===budget&&q.comparison==='worsened').length} })),
  byPosition:document.positions.flatMap(p=>[100,1000].map(budget=>({position:p.id,budget,
    baseline:group(samples.filter(r=>r.position===p.id&&r.budget===budget&&r.version==='baseline')),
    product:group(samples.filter(r=>r.position===p.id&&r.budget===budget&&r.version==='product'))}))),fixedIdentical:10 };
writeFileSync(path.join(outputDir,'summary.json'),json(summary)+'\n');
write('events.jsonl',{event:'complete',at:new Date().toISOString()});
process.stdout.write(json(summary.conditions)+'\n');
