import {readFileSync,mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import * as main from './baseline/src/domain/shogi/twoPlyAlphaBetaAi.ts';
import * as product from './repo/src/domain/shogi/twoPlyAlphaBetaAi.ts';
import {resolveSearchEvaluationPreset} from './repo/src/domain/shogi/searchEvaluationPresets.ts';
import {protectSearchInput} from './repo/src/domain/shogi/selfPlayGame.ts';
const directory='../../outputs/product-c-followup-20261015';mkdirSync(directory);
const positions=JSON.parse(gunzipSync(readFileSync('docs/benchmarks/fallback-quality-20261014/positions.json.gz'))).positions;
const options={moveOrdering:'standard',killerMoves:false,quiescence:{maxTacticalDepth:1,moveOrdering:'original'}};
const write=(name,value)=>appendFileSync(directory+'/'+name,JSON.stringify(value)+'\n');
const strip=result=>JSON.parse(JSON.stringify(result,(key,value)=>key==='elapsedMilliseconds'?undefined:value));
write('environment.jsonl',{purpose:'Investigate two depth distribution shifts using complete depth-one passes, not a replacement for 100/1000ms results',
  node:process.version,startedAt:new Date().toISOString(),warmup:2,samples:5,budget:10000,maxDepth:1,options,diagnostics:false,
  clocks:'one wrapper increment per existing read; no additional reads',
  productSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  baselineSha:execFileSync('git',['-C','../baseline','rev-parse','HEAD'],{encoding:'utf8'}).trim()});
const rows=[];
for(const id of ['g1-p5','g4-p89']) {
 const state=positions.find(p=>p.id===id).state;
 let reference=null,referenceReads=null;
 for(let round=-2;round<5;round++) for(const version of round%2?['product','baseline']:['baseline','product']) {
  const input=protectSearchInput(state);let reads=0;
  const clock=()=>{reads++;return performance.now()};
  const before=performance.now();
  const result=(version==='product'?product:main).analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(input.snapshot,1,10000,resolveSearchEvaluationPreset('standard'),clock,options);
  const callMs=performance.now()-before;
  assert.equal(result.completedDepth,1);assert.equal(input.wasMutated(),false);
  if(reference===null){reference=strip(result);referenceReads=reads;}
  assert.deepEqual(strip(result),reference);assert.equal(reads,referenceReads);
  const row={position:id,phase:round<0?'warmup':'sample',run:round,version,callMs,reads,result};rows.push(row);write('raw.jsonl',row);
 }
}
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const summary=['g1-p5','g4-p89'].map(position=>({position,baselineMedian:median(rows.filter(r=>r.position===position&&r.phase==='sample'&&r.version==='baseline').map(r=>r.callMs)),
 productMedian:median(rows.filter(r=>r.position===position&&r.phase==='sample'&&r.version==='product').map(r=>r.callMs)),
 identicalCompletedResults:true,identicalClockReadCount:rows.find(r=>r.position===position).reads}));
writeFileSync(directory+'/summary.json',JSON.stringify(summary,null,2)+'\n');write('events.jsonl',{event:'complete',at:new Date().toISOString()});console.log(summary);
