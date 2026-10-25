/** Standalone same-input evaluation cost; never run alongside performance/self-play. */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import { evaluateUndefendedPieceSafety } from '../src/domain/shogi/undefendedPieceSafetyEvaluation';
import { createAttackCountMaps } from '../src/domain/shogi/attacks';
import { DEFAULT_MATERIAL_VALUE_TABLE } from '../src/domain/shogi/materialEvaluation';
const plan=JSON.parse(readFileSync(process.argv[2],'utf8')),rows=[];
let sink=0;
for(const p of plan.performance)for(const term of ['full-evaluation','shared-map-safety'])for(let run=0;run<4;run++)for(const mode of run%2?['experimental','legacy'] as const:['legacy','experimental'] as const){
  const before=JSON.stringify(p.state),maps=createAttackCountMaps(p.state.squares),began=performance.now();
  for(let call=0;call<1000;call++)sink+=term==='full-evaluation'?evaluateSearchPositionBreakdown(p.state,p.state.turn,{pieceSafetyMode:mode}).total:
    evaluateUndefendedPieceSafety(p.state,p.state.turn,DEFAULT_MATERIAL_VALUE_TABLE,maps,mode);
  const ms=performance.now()-began;assert.equal(JSON.stringify(p.state),before);rows.push({id:p.id,term,mode,run,warmup:run===0,calls:1000,ms});
}
const result={sink,description:'Isolated same inputs, 1000 calls/cell, warmup1 plus3, AB/BA; separate from product search performance',rows};
writeFileSync(process.argv[3],JSON.stringify(result)+'\n',{flag:'wx'});
console.log(JSON.stringify({rows:rows.length,measurements:rows.filter(r=>!r.warmup).length}));
