import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { TimeLimitedIterativeDeepeningAlphaBetaSearchResult } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { getLegalActions, executeLegalAction } from '../src/domain/shogi/legalActions';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import type { BoardState } from '../src/types/shogi';

const dir=resolve(process.argv[2]);
type Sample = {type:string;id:string;ordering:string;variant:string;limit:number|null;phase:string;run:number;
  actualMilliseconds:number;result:TimeLimitedIterativeDeepeningAlphaBetaSearchResult};
const rows=readFileSync(resolve(dir,'raw.jsonl'),'utf8').trim().split('\n').map(s => JSON.parse(s));
assert.equal(rows.filter(r=>r.type==='end').length,1);
assert.equal(rows.at(-1).type,'exit'); assert.equal(rows.at(-1).code,0);assert.equal(rows.at(-1).ended,true);
assert.equal(rows.filter(r=>r.type==='failure').length,0);
const config=rows[0];
const sha=(b:Uint8Array) => createHash('sha256').update(b).digest('hex');
if (existsSync(resolve(dir,'manifest.json'))) {
  const previous = JSON.parse(readFileSync(resolve(dir,'manifest.json'),'utf8'));
  for (const [name,hash] of Object.entries(previous)) assert.equal(sha(readFileSync(resolve(dir,name))),hash,`Manifest mismatch: ${name}`);
}
for(const [name,hash] of Object.entries(config.sourceHashes)) {
  assert.equal(sha(gunzipSync(readFileSync(resolve(dir,name.replaceAll('/','__')+'.gz')))),hash);
}
assert.equal(sha(gunzipSync(readFileSync(resolve(dir,'baseline-src.tar.gz')))),config.baselineArchiveSha256);
const positions=rows.filter(r=>r.type==='position');assert.equal(positions.length,10);
const samples:Sample[]=rows.filter(r=>r.type==='sample');
assert.equal(samples.length,560);
assert.equal(rows.filter(r=>r.type==='compatibility'&&r.passed===true).length,20);
const diagnostics=rows.filter(r=>r.type==='diagnostic');assert.equal(diagnostics.length,40);
const stable=({elapsedMilliseconds:_ms,...r}: {elapsedMilliseconds:number}) => r;
for(const p of positions) for(const ordering of ['standard','static-exchange']) {
  for(const limit of [null,100,1000]) for(const variant of limit===null?['before','off','on']:['before','on']) {
    const cell=samples.filter(s=>s.id===p.id&&s.ordering===ordering&&s.limit===limit&&s.variant===variant);
    assert.deepEqual(cell.map(s=>s.run).sort(),[0,1,2,3]);
    assert.equal(cell.filter(s=>s.phase==='warmup').length,1);
  }
  for(const s of samples.filter(s=>s.id===p.id&&s.ordering===ordering)) {
    assert.ok(Number.isFinite(s.actualMilliseconds)&&s.actualMilliseconds>=0);
    let leaf:BoardState=structuredClone(p.state);
    for(const a of s.result.principalVariation) {
      assert.ok(getLegalActions(leaf).some(x=>JSON.stringify(x)===JSON.stringify(a)));
      const next=executeLegalAction(leaf,a); assert.equal(next.type,'applied');if(next.type==='applied')leaf=next.state;
    }
    if(s.result.evaluationBreakdown) assert.deepEqual(s.result.evaluationBreakdown,evaluateSearchPositionBreakdown(leaf,p.state.turn));
    if(s.variant==='off') {
      const before=samples.find(b=>b.id===s.id&&b.ordering===s.ordering&&b.limit===s.limit&&b.variant==='before'&&b.run===s.run)!;
      assert.deepEqual(stable(s.result),stable(before.result));
    }
  }
}
const measurement=samples.filter(s=>s.phase==='measurement');assert.equal(measurement.length,420);
const median=(a:number[]) => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const summary=[];
for(const ordering of ['standard','static-exchange']) for(const limit of [null,100,1000]) {
  const metrics=['before','on'].map(variant=>{
    const ss=measurement.filter(s=>s.ordering===ordering&&s.limit===limit&&s.variant===variant);
    return {variant,n:ss.length,elapsedSum:ss.reduce((n,s)=>n+s.actualMilliseconds,0),
      maxOverrun:limit===null?null:Math.max(...ss.map(s=>s.actualMilliseconds-limit)),
      completedDepthSum:limit===null?null:ss.reduce((n,s)=>n+s.result.completedDepth,0),
      normal:ss.reduce((n,s)=>n+s.result.visitedPositionCount,0),q:ss.reduce((n,s)=>n+s.result.quiescenceVisitedPositionCount,0),
      totalNormal:limit===null?null:ss.reduce((n,s)=>n+s.result.totalVisitedPositionCount,0),
      totalQ:limit===null?null:ss.reduce((n,s)=>n+s.result.totalQuiescenceVisitedPositionCount,0),
      sources:limit===null?null:Object.fromEntries(['completed-iteration','partial-root','fallback'].map(v=>[v,ss.filter(s=>s.result.resultSource===v).length]))};
  });
  const pairs=measurement.filter(s=>s.ordering===ordering&&s.limit===limit&&s.variant==='on').map(s=>{
    const b=measurement.find(b=>b.id===s.id&&b.ordering===ordering&&b.limit===limit&&b.variant==='before'&&b.run===s.run)!;
    return {id:s.id,run:s.run,depthDelta:limit===null?0:s.result.completedDepth-b.result.completedDepth,
      actionChanged:JSON.stringify(s.result.selectedAction)!==JSON.stringify(b.result.selectedAction),
      evaluationBefore:b.result.selectedEvaluation,evaluationAfter:s.result.selectedEvaluation};
  });
  summary.push({ordering,limit,metrics,pairs});
}
const lines=['# 非捕獲成りq比較（保存rawから再集計）','',
  '基準main '+config.baseHead+'。10局面・最大通常深さ4・q1/original・evasion追加0・標準評価。各cell warmup1/本3、before/onはAB/BA交代、直列、計測中は診断OFF。固定d1ではoffも測定。',
  '通常/qノードは最後の完了反復。totalは完了反復合計で、中断分を含まない。実時間は中断作業を含む。SEE callsは別の診断付きd2の並べ替えバッチ数で、時限測定のSEE個別捕獲数ではない。','',
  '|順序|予算|条件|n|実時間合計ms|最大超過ms|完了深さ合計|通常/q（最終）|通常/q（完了合計）|',
  '|---|---|---|---:|---:|---:|---:|---|---|'];
for(const s of summary) for(const m of s.metrics) lines.push(`|${s.ordering}|${s.limit??'d1'}|${m.variant}|${m.n}|${m.elapsedSum.toFixed(3)}|${m.maxOverrun?.toFixed(3)??'N/A'}|${m.completedDepthSum??'N/A'}|${m.normal}/${m.q}|${m.totalNormal??'N/A'}/${m.totalQ??'N/A'}|`);
lines.push('','|順序|予算|深さ改善/悪化/同じ（対数）|選択手変化|','|---|---|---|---:|');
for(const s of summary) lines.push(`|${s.ordering}|${s.limit??'d1'}|${s.pairs.filter(p=>p.depthDelta>0).length}/${s.pairs.filter(p=>p.depthDelta<0).length}/${s.pairs.filter(p=>p.depthDelta===0).length}|${s.pairs.filter(p=>p.actionChanged).length}|`);
lines.push('','## 局面別（3本の中央値、最大超過は3本の最大）','','|局面|順序|予算|実ms 前→後|完了深さ 前→後|最大超過 前→後|','|---|---|---|---|---|---|');
for(const p of positions) for(const ordering of ['standard','static-exchange']) for(const limit of [100,1000]) {
  const cells=['before','on'].map(v=>measurement.filter(s=>s.id===p.id&&s.ordering===ordering&&s.limit===limit&&s.variant===v));
  lines.push(`|${p.id}|${ordering}|${limit}|${cells.map(c=>median(c.map(s=>s.actualMilliseconds)).toFixed(3)).join('→')}|${cells.map(c=>median(c.map(s=>s.result.completedDepth))).join('→')}|${cells.map(c=>Math.max(...c.map(s=>s.actualMilliseconds-limit)).toFixed(3)).join('→')}|`);
}
lines.push('','固定・時限の選択手/評価/PV/内訳/全統計はraw.jsonlへ完全保存。時間差・深さ差はOS/JIT/GCの影響を含み、対局全体の棋力向上や厳密期限の保証とはしない。','');
writeFileSync(resolve(dir,'summary.json'),JSON.stringify({valid:true,measurementCount:420,warmupCount:140,compatibilityCount:20,summary,diagnostics:diagnostics.map(({result:_result,...d})=>d)},null,2)+'\n');
writeFileSync(resolve(dir,'results.md'),lines.join('\n'));
// Include all immutable inputs/raw/snapshots; report regeneration is deterministic.
const manifest=Object.fromEntries(readdirSync(dir).filter(f=>f!=='manifest.json').sort().map(f=>[f,sha(readFileSync(resolve(dir,f)))]));
writeFileSync(resolve(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({valid:true,samples:samples.length,measurement:420,warmup:140,compatibility:20,diagnostics:40}));
