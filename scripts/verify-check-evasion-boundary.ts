import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { checkEvasionPositions } from './benchmarks/checkEvasionPositions';
import { evasionReference } from './benchmarks/checkEvasionReference';
import { compareReference, observePv } from './benchmarks/terminalDistanceReference';
import { json, parse } from './benchmarks/tacticalDiagnostics';
import { analyzeQuiescenceSearchWithInternalBounds, createCheckEvasionStatistics } from '../src/domain/shogi/quiescenceSearch';
import { SEARCH_BOTTOM, SEARCH_TOP } from '../src/domain/shogi/searchValue';
const baseline=parse(readFileSync('docs/benchmarks/check-evasion-20261021/baseline.json','utf8'));
const rows=[];
for(const p of checkEvasionPositions()) for(const q of [0,1]) for(const extra of [0,1,2]) {
  const before=json(p.state),stats=createCheckEvasionStatistics();
  const r=analyzeQuiescenceSearchWithInternalBounds(p.state,p.state.turn,q,{},undefined,SEARCH_BOTTOM,SEARCH_TOP,'original',undefined,0,extra,stats);
  const ref=evasionReference(p.state,0,q,extra), reverse=evasionReference(p.state,0,q,extra,p.state.turn,0,true);
  const observed=observePv(p.state,r.principalVariation);
  assert.equal(compareReference(observed,ref),0); assert.equal(compareReference(observed,reverse),0);
  assert.deepEqual(r.evaluationBreakdown,observed.breakdown);assert.equal(json(p.state),before);
  const old=baseline.rows.find((row:{id:string})=>row.id===p.id).q[q];
  rows.push({position:p.id,q,extra,oldScore:old.selectedEvaluation,result:r,stats,reference:ref,
    reverseReference:reverse,interpretation:'bounded q value agreement; not a proof that a root selected action was wrong'});
}
writeFileSync(process.argv[2],json(rows)+'\n',{flag:'wx'});
console.log(`Verified ${rows.length} boundary conditions against full-width and reversed enumeration.`);
