import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distancePositions, observePv } from './benchmarks/terminalDistanceReference';
import { json, hash } from './benchmarks/partialRootMatches';
import { createInitialBoardState } from '../src/types/shogi';

const [before,after,output]=process.argv.slice(2);
const load=async (root:string)=>({
  alpha:await import(pathToFileURL(join(resolve(root),'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href),
  mini:await import(pathToFileURL(join(resolve(root),'src/domain/shogi/twoPlyMinimaxAi.ts')).href),
  q:await import(pathToFileURL(join(resolve(root),'src/domain/shogi/quiescenceSearch.ts')).href),
});
const engines=await Promise.all([load(before),load(after)]);
const qOptions={quiescence:{maxTacticalDepth:1}};
const deterministic=(r:any):any=>{
  const {elapsedMilliseconds:_time,...value}=r;
  return {...value,...(r.iterations?{iterations:r.iterations.map(deterministic)}:{})};
};
const samples=[];
for (const p of distancePositions()) {
  const original=hash(p.state);
  for (const mode of ['alpha-zero','alpha-two','alpha-four-q','minimax','iterative-q','quiescence','timed-completed-q']) {
    const results=engines.map(e=>deterministic(mode==='alpha-zero'?e.alpha.analyzeAlphaBetaSearch(p.state,0)
      : mode==='alpha-two'?e.alpha.analyzeAlphaBetaSearch(p.state,2)
      : mode==='alpha-four-q'?e.alpha.analyzeAlphaBetaSearch(p.state,4,undefined,()=>0,qOptions)
      : mode==='minimax'?e.mini.analyzeTwoPlyMinimaxSearch(p.state)
      : mode==='iterative-q'?e.alpha.analyzeIterativeDeepeningAlphaBetaSearch(p.state,3,undefined,()=>0,qOptions)
      : mode==='quiescence'?e.q.analyzeQuiescenceSearch(p.state,p.state.turn,2)
      : e.alpha.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(p.state,3,100,undefined,()=>0,qOptions)));
    assert.deepEqual(results[1],results[0],`${p.id}/${mode}`);
    assert.equal(hash(p.state),original);
    const r=results[1];
    const pv=r.principalVariation?observePv(p.state,r.principalVariation):null;
    if (pv&&r.evaluationBreakdown) assert.deepEqual(r.evaluationBreakdown,pv.breakdown);
    samples.push({position:p.id,mode,terminalDistancePly:pv?.terminalDistancePly??null,before:results[0],after:results[1]});
  }
  console.log(p.id);
}
for (const expireAt of [4,7,9]) {
  const results=engines.map(e=>{
    let reads=0;
    return deterministic(e.alpha.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(createInitialBoardState(),1,100,
      undefined,()=>++reads>=expireAt?100:0));
  });
  assert.deepEqual(results[0],results[1]);
  assert.equal(results[1].resultSource,expireAt===4?'fallback':'partial-root');
  samples.push({position:'initial-controlled-deadline',mode:`expire-${expireAt}`,terminalDistancePly:null,before:results[0],after:results[1]});
}
writeFileSync(output,json({baseSha:'96803e3db338855ae5ea7d1ac82d8add275fc3df',
  excludedFields:['elapsedMilliseconds (top-level and iterations)'],samples})+'\n',{flag:'wx'});
console.log(`All ${samples.length} deterministic before/after results match, including PV, depth, public evaluation and statistics.`);
