import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, platform, release, arch } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { distancePositions, observePv } from './benchmarks/terminalDistanceReference';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { json } from './benchmarks/partialRootMatches';

const [baseline, candidate, output] = process.argv.slice(2).map(p=>resolve(p));
assert.ok(baseline && candidate && output);
mkdirSync(output); // new directory only; never overwrite a run
const digest = (x: string) => createHash('sha256').update(x).digest('hex');
const engines = await Promise.all([baseline,candidate].map(async root => ({
  root, sha: execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  trackedDiffHash: digest(execFileSync('git',['diff','--binary'],{cwd:root,encoding:'utf8'})),
  status: execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}),
  sources: Object.fromEntries(['twoPlyAlphaBetaAi','twoPlyMinimaxAi','quiescenceSearch',...(root===candidate?['searchValue']:[])].map(f=>
    [f,digest(readFileSync(join(root,`src/domain/shogi/${f}.ts`),'utf8'))])),
  api: await import(pathToFileURL(join(root,'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href)
})));
const positions = distancePositions();
const plan = { startedAt: new Date().toISOString(), node:process.version, platform:platform(),release:release(),arch:arch(),cpu:cpus()[0].model,
  engines:engines.map(({api,...e})=>e), measurementSourceHash:digest(readFileSync(import.meta.filename,'utf8')), referenceSourceHash:digest(readFileSync(resolve('scripts/benchmarks/terminalDistanceReference.ts'),'utf8')), positionHashes: positions.map(p=>({id:p.id,hash:digest(json(p.state))})),
  positions: positions.map(p=>({id:p.id,state:p.state})), fixed:{depth:4,q:1}, timed:{budgets:[100,1000],maxDepth:4,q:1,repeats:5},
  order:'position, budget, warmup then repeats; baseline/candidate order alternates by repeat',
  limits:'synchronous cooperative deadlines; OS load, GC, CPU affinity and power not fixed; no general strength inference' };
writeFileSync(join(output,'plan.json'),json(plan)+'\n',{flag:'wx'});
const rows: unknown[] = [];
const options = {quiescence:{maxTacticalDepth:1}};
function run(engineIndex:number, p:typeof positions[number], phase:string, budget:number|null, repeat:number) {
  const inputHash = digest(json(p.state));
  const input = protectSearchInput(p.state);
  const api = engines[engineIndex].api;
  const start = performance.now();
  const result = budget===null ? api.analyzeAlphaBetaSearch(input.snapshot,4,undefined,undefined,options)
    : api.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot,4,budget,undefined,undefined,options);
  const callMs=performance.now()-start;
  assert.equal(input.wasMutated(),false);
  assert.equal(digest(json(p.state)),inputHash);
  const pv=observePv(p.state,result.principalVariation);
  if (result.resultSource==='fallback') {
    assert.equal(result.selectedEvaluation,null); assert.equal(result.evaluationBreakdown,null);
    assert.equal(result.principalVariation.length,0);
  } else assert.deepEqual(result.evaluationBreakdown,pv.breakdown);
  rows.push({engine:engineIndex===0?'main':'candidate',position:p.id,phase,budget,repeat,callMs,apiMs:result.elapsedMilliseconds,
    overrunMs:budget===null?null:Math.max(0,callMs-budget),result,
    terminalReason:pv.reason,terminalDistancePly:pv.terminalDistancePly});
}
for (const p of positions) {
  for (const budget of [null,100,1000]) {
    for (const e of [0,1]) run(e,p,'warmup',budget,-1);
    for (let repeat=0;repeat<(budget===null?1:5);repeat++)
      for (const e of repeat%2?[1,0]:[0,1]) run(e,p,'measurement',budget,repeat);
  }
  console.log(p.id);
}
writeFileSync(join(output,'raw.json'),json(rows)+'\n',{flag:'wx'});
writeFileSync(join(output,'completed.json'),json({finishedAt:new Date().toISOString(),rows:rows.length,rawHash:digest(json(rows))})+'\n',{flag:'wx'});
