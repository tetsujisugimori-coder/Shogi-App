/** Supplemental read-only auditor: replay saved matches and check every planned
 * cell independently of the measurement child. Does not rewrite measurement raw. */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,readdirSync,statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { BoardState } from '../src/types/shogi';
import { getLegalActions,executeLegalAction } from '../src/domain/shogi/legalActions';
import { createPositionKey } from '../src/domain/shogi/repetition';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import { verifyProof } from './benchmarks/verifyOutcomeProof';
import { qualityClassify } from './benchmarks/tacticalQuality';
const dir=resolve(process.argv[2]);
const json=(v:unknown)=>JSON.stringify(v,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v);
const parse=(s:string)=>JSON.parse(s,(_k,v)=>v==='Infinity'?Infinity:v==='-Infinity'?-Infinity:v);
const read=(f:string)=>parse(readFileSync(resolve(dir,f),'utf8'));
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const manifest=read('manifest.json');for(const [f,h] of Object.entries(manifest))assert.equal(sha(readFileSync(resolve(dir,f))),h);
const plan=read('plan.json'), rows=readFileSync(resolve(dir,'raw.jsonl'),'utf8').trim().split('\n').map(parse);
assert.equal(rows.at(-1).code,0);assert.equal(rows.at(-1).ended,true);
const records=rows.filter(r=>r.type==='record'), starts=rows.filter(r=>r.type==='started');
const identity=(r:Record<string,unknown>)=>json(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='type'&&k!=='data')));
assert.deepEqual(starts.map(identity),records.map(identity));assert.equal(new Set(records.map(identity)).size,records.length);
const counts=Object.fromEntries(['compatibility','pilot','performance','diagnostic','local','quality','proof','match'].map(stage=>[stage,records.filter(r=>r.stage===stage).length]));
assert.deepEqual(counts,{compatibility:20,pilot:120,performance:360,diagnostic:90,local:plan.local.length*6,quality:16,proof:4,match:5});
for(const p of plan.performance)for(const limit of [null,100])for(const run of [0,1])for(const variant of ['C1','C2','C4'])assert.equal(records.filter(r=>r.stage==='pilot'&&r.id===p.id&&r.limit===limit&&r.run===run&&r.variant===variant).length,1);
for(const p of plan.performance)for(const limit of [null,100,1000])for(const variant of plan.mainVariants)assert.equal(records.filter(r=>r.stage==='diagnostic'&&r.id===p.id&&r.limit===limit&&r.variant===variant).length,1);
// Deterministic fixed d1 results must not depend on instrumentation.
const strip=({elapsedMilliseconds:_ms,...r}:Record<string,unknown>)=>r;
for(const d of records.filter(r=>r.stage==='diagnostic'&&r.limit===null)) {
  const plain=records.find(r=>r.stage==='performance'&&r.limit===null&&r.depth===1&&r.run===1&&r.id===d.id&&r.variant===d.variant)!;
  assert.deepEqual(strip(d.data.result),strip(plain.data.result));
}
let games=0,plies=0;
for(const m of records.filter(r=>r.stage==='match')) {
  const p=plan.matches.find((p:{id:string})=>p.id===m.id);assert.ok(p);
  for(const g of m.data.games) {
    games++;let state:BoardState=p.state;
    for(const ply of g.result.plies) {
      plies++;assert.equal(ply.positionKey,createPositionKey(state));
      let leaf=state;
      for(const a of ply.principalVariation) {
        assert.ok(getLegalActions(leaf).some(x=>json(x)===json(a)));
        const next=executeLegalAction(leaf,a);assert.equal(next.type,'applied');if(next.type==='applied')leaf=next.state;
      }
      if(ply.evaluationBreakdown)assert.deepEqual(ply.evaluationBreakdown,evaluateSearchPositionBreakdown(leaf,state.turn));
      assert.ok(getLegalActions(state).some(x=>json(x)===json(ply.action)));
      const next=executeLegalAction(state,ply.action);assert.equal(next.type,'applied');if(next.type==='applied')state=next.state;
    }
    // JSON evidence omits undefined optional members in nested snapshots.
    assert.deepEqual(parse(json(state)),g.result.finalState);
    assert.notEqual(g.result.status,'failed');
    if(g.result.status==='ended') {
      assert.equal(state.status,'ended');assert.deepEqual(state.result,g.result.gameResult);
      if(state.result!.winner===null)assert.equal(g.outcome,'draw');
      else assert.equal(g.outcome,g[state.result!.winner]==='A'?'a_win':'b_win');
    } else {assert.equal(g.result.status,'max_plies');assert.equal(g.outcome,'max_plies');assert.equal(g.result.plies.length,m.maxPlies);}
  }
}
for(const q of records.filter(r=>r.stage==='quality')) {
  const p=plan.quality.find((p:{id:string})=>p.id===q.id)!;
  for(const row of q.data.rows)assert.deepEqual(qualityClassify(p,q.data.reference,row.result),row.classification);
}
for(const proof of records.filter(r=>r.stage==='proof'))if(proof.data.result.certificate)assert.ok(verifyProof(proof.data.result.certificate,proof.data.requestHash).valid);
const total=readdirSync(dir).reduce((n,f)=>n+statSync(resolve(dir,f)).size,0);assert.ok(total<=plan.maxBytes);
const report={valid:true,counts,games,plies,bytes:total,maxBytes:plan.maxBytes,manifestFiles:Object.keys(manifest).length};
// Audit evidence saved alongside validation, outside immutable measurement dir.
if(process.argv[3])writeFileSync(resolve(process.argv[3]),json(report)+'\n',{flag:'wx'});
console.log(json(report));
