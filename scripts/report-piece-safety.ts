/** Recompute review tables only from sealed run data; incomplete stays explicit. */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { compareReference } from './benchmarks/terminalDistanceReference';
const dir=resolve(process.argv[2]),parse=(s:string)=>JSON.parse(s,(_k,v)=>v==='Infinity'?Infinity:v==='-Infinity'?-Infinity:v);
const json=(x:unknown)=>JSON.stringify(x,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v);
const report=parse(readFileSync(resolve(dir,'summary.json'),'utf8'));
assert.equal(typeof report.complete,'boolean','explicit completion status required');
const plan=parse(readFileSync(resolve(dir,'plan.json'),'utf8'));
const raw=readFileSync(resolve(dir,'raw.jsonl'),'utf8').trim().split('\n').map(parse).filter(r=>r.type==='record');
const rows=raw.filter(r=>r.task.stage==='performance'&&r.task.run>0);
const conditions=['d1','d3','100ms','1000ms'];
const quality=[];
for(const c of conditions)for(const v of ['A','B']){
  const rs=report.quality.flatMap((p:typeof report.quality[number])=>p.rows).filter((r:typeof rows[number])=>r.task.condition===c&&r.task.variant===v);
  quality.push({condition:c,variant:v,counts:Object.fromEntries(['ProvenError','QualityGap','Inconclusive','NoObservedDifference'].map(q=>[q,rs.filter((r:typeof rs[number])=>r.classification.quality===q).length]))});
}
function direction(d:typeof report.differences[number]){
  const av=d.aClass?.selectedReference,bv=d.bClass?.selectedReference;
  if(!av||!bv||d.aClass.quality==='Inconclusive'||d.bClass.quality==='Inconclusive')return 'unavailable';
  const value=compareReference(bv.value,av.value);return value>0?'better':value<0?'worse':'equal';
}
const comparisons=conditions.map(c=>{
  const ds=report.differences.filter((d:typeof report.differences[number])=>d.condition===c);
  return{condition:c,pairs:ds.length,changed:ds.filter((d:typeof ds[number])=>d.changed).length,
    depthBetter:ds.filter((d:typeof ds[number])=>d.depthDelta>0).length,depthWorse:ds.filter((d:typeof ds[number])=>d.depthDelta<0).length,
    quality:Object.fromEntries(['better','worse','equal','unavailable'].map(v=>[v,ds.filter((d:typeof ds[number])=>direction(d)===v).length]))};
});
const examples=report.differences.filter((d:typeof report.differences[number])=>['better','worse'].includes(direction(d))).map((d:typeof report.differences[number])=>({
  id:d.id,condition:d.condition,run:d.run,direction:direction(d),a:d.aClass.selectedReference,b:d.bClass.selectedReference,
}));
const games=raw.filter(r=>r.task.stage==='match').flatMap(r=>r.data.games.map((g:typeof r.data.games[number])=>({limit:r.task.limit,start:r.task.id,...g})));
const totals=[100,1000].map(limit=>({limit,...(Object.fromEntries(['a_win','b_win','draw','max_plies','failed'].map(k=>[k,games.filter(g=>g.limit===limit&&g.outcome===k).length])) as Record<'a_win'|'b_win'|'draw'|'max_plies'|'failed',number>),
  incomplete:plan.tasks.filter((t:{stage:string;limit:number})=>t.stage==='match'&&t.limit===limit).length*2-games.filter(g=>g.limit===limit).length,
  plies:games.filter(g=>g.limit===limit).reduce((n,g)=>n+g.result.plies.length,0),
  bSenteWins:games.filter(g=>g.limit===limit&&g.sente==='B'&&g.outcome==='b_win').length,bGoteWins:games.filter(g=>g.limit===limit&&g.gote==='B'&&g.outcome==='b_win').length}));
const diagnostics=['A','B'].map(v=>{
  const ss=report.diagnostics.filter((r:typeof report.diagnostics[number])=>r.task.variant===v);
  return{variant:v,calls:ss.reduce((n:number,r:typeof ss[number])=>n+r.data.diagnostics.evaluationCalls,0),
    evaluationMs:ss.reduce((n:number,r:typeof ss[number])=>n+r.data.diagnostics.phases['normal-evaluate'].milliseconds+r.data.diagnostics.phases['q-evaluate'].milliseconds,0)};
});
const completedWorkTotals=conditions.flatMap(condition=>['A','B'].map(variant=>{
  const ss=rows.filter(r=>r.task.condition===condition&&r.task.variant===variant);
  return{condition,variant,normal:ss.reduce((n,r)=>n+(r.data.result.totalVisitedPositionCount??r.data.result.visitedPositionCount),0),
    q:ss.reduce((n,r)=>n+(r.data.result.totalQuiescenceVisitedPositionCount??r.data.result.quiescenceVisitedPositionCount),0)};
}));
const result={base:plan.base,complete:report.complete,compatibility:raw.filter(r=>r.task.stage==='compatibility'&&r.data.passed).length,
  summary:report.summary,completedWorkTotals,quality,comparisons,examples,matches:report.matches,totals,diagnostics};
const lines=['# 駒安全度の保存原本からの再集計','',`基準 ${plan.base}。A=legacy / B=experimental。全${plan.performance.length}局面、warmup1＋本3、q1/original、通常standard、TT/PV/killer OFF。`,
  '',`全体${report.complete?'完走':'未完了'}：取得 ${report.completed}/${report.planned}、欠測 ${report.missing.length}。旧mainとの互換 ${result.compatibility}局面（d1全結果およびTT d2全結果/統計）。`,
  '', '|条件|方式|本数|API合計ms|最大超過ms|深さ合計|採用反復 通常/qノード|partial/fallback|','|---|---|---:|---:|---:|---:|---|---|'];
for(const s of report.summary)lines.push(`|${s.condition}|${s.variant}|${s.n}|${s.ms.toFixed(3)}|${s.maxOverrunMs?.toFixed(3)}|${s.depth}|${s.normal}/${s.q}|${s.partial}/${s.fallback}|`);
lines.push('','反復全体の完了作業（中断反復の未完了作業を含まない）:',...completedWorkTotals.map(s=>`- ${s.condition}/${s.variant}: 通常 ${s.normal} / q ${s.q}`),
  '','|条件|選択手変化|深さ改善/悪化|有限参照better/worse/equal/不足|','|---|---:|---|---|');
for(const c of comparisons)lines.push(`|${c.condition}|${c.changed}/${c.pairs}|${c.depthBetter}/${c.depthWorse}|${c.quality.better}/${c.quality.worse}/${c.quality.equal}/${c.quality.unavailable}|`);
lines.push('','深さ差は性能指標。有限参照のbetter/worseは同じ旧評価のd3全幅/正逆参照による候補比較で、実戦勝敗や一般棋力の証明ではない。参照のルール・静的評価を製品と共有する制約がある。',
  '','|条件|方式|ProvenError|QualityGap|Inconclusive|NoObservedDifference|','|---|---|---:|---:|---:|---:|');
for(const q of quality)lines.push(`|${q.condition}|${q.variant}|${q.counts.ProvenError}|${q.counts.QualityGap}|${q.counts.Inconclusive}|${q.counts.NoObservedDifference}|`);
lines.push('','|ms|B勝|B負|規則引分|120ply打切り|失敗|未保存/未完了|総ply|B先手勝/後手勝|','|---|---:|---:|---:|---:|---:|---:|---:|---|');
for(const t of totals)lines.push(`|${t.limit}|${t.b_win}|${t.a_win}|${t.draw}|${t.max_plies}|${t.failed}|${t.incomplete}|${t.plies}|${t.bSenteWins}/${t.bGoteWins}|`);
lines.push('',`保存済み${games.length}局の全棋譜・各手PV・内訳・最終局面・終局理由はrun2/raw.jsonlで監査。${report.complete?'':'親停止したペアの途中棋譜は未保存で監査対象外。'}少数対局から一般棋力は断定しない。`,
  '','診断ON（主性能表とは別。異なるleaf集合なので一回当たりを直接の同一仕事比較にしない）:',...diagnostics.map(d=>`- ${d.variant}: 評価 ${d.calls}回 / ${d.evaluationMs.toFixed(3)}ms`),
  '','## 改善と悪化の例（各方向最大6件、全件はreport.json）','',...[...examples.filter((e:{direction:string})=>e.direction==='better').slice(0,6),...examples.filter((e:{direction:string})=>e.direction==='worse').slice(0,6)].map((e:unknown)=>json(e)),
  '','## 対局別','',...report.matches.map((m:typeof report.matches[number])=>JSON.stringify(m)));
const bytes=json(result)+'\n';writeFileSync(resolve(dir,'../report.json'),bytes);writeFileSync(resolve(dir,'../results.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({reportHash:createHash('sha256').update(bytes).digest('hex'),comparisons,totals}));
