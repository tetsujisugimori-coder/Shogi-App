import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadPositions,qualityReference,qualityClassify,aggregateQuality,auditQualityResult,type QualityReference } from './tacticalQuality';
import { classify,verifyReference,json,parse,hash,type Reference,type Result } from './tacticalDiagnostics';
import { observePv,apply } from './terminalDistanceReference';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';
import { validatePartialRoot } from '../../src/application/partialRootValidation';
import type { TacticalPosition } from './tacticalPositions';

const byteHash=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Missing files are legal only for interrupted runs. Blank streams have zero records. */
export function readMeasurementStream(filename:string,allowMissing:boolean) {
  const exists=existsSync(filename);
  assert.ok(exists||allowMissing,'missing completed measurement stream: '+filename);
  const content=exists?readFileSync(filename,'utf8'):'';
  return {exists,content,rows:content.trim()?content.trim().split(/\r?\n/).map(parse):[]};
}
export interface QualityCondition {id:string;depth:number;budget:number|null;repeats:number}
export interface QualityTask {p:TacticalPosition;c:QualityCondition}
export interface QualityAuditContext {
  dir:string;interrupted:boolean;plan:{positions:TacticalPosition[];positionHash:string};
  refs:Record<string,Reference>;qualityRefs:Record<string,QualityReference>;
  tasks:QualityTask[];runConditions:QualityCondition[];settings:(extra:number)=>unknown;
}
/** Re-audits saved results; never invokes the product search or rewrites v2 evidence. */
export function auditTacticalQuality({dir,interrupted,plan,refs,qualityRefs,tasks,runConditions,settings:opts}:QualityAuditContext) {
  const file=(name:string)=>path.join(dir,name);
  const write=(name:string,value:unknown)=>writeFileSync(file(name),json(value)+'\n',{flag:'wx'});
  assert.ok(tasks.length>0,'nonempty planned tasks required');
  loadPositions(plan.positions,plan.positionHash);
  for(const p of plan.positions) { verifyReference(p,refs[p.id]); assert.deepEqual(qualityReference(p),qualityRefs[p.id]); }
  const measuredPositions=plan.positions;
  const env=parse(readFileSync(file('environment.json'),'utf8'));

  assert.ok(interrupted ? existsSync(file('failure.json')) && !existsSync(file('completed.json'))
    : existsSync(file('completed.json')) && !existsSync(file('failure.json')),
    'audit requires completed data; audit-partial requires an interrupted run');
  const measurement=readMeasurementStream(file('raw.jsonl'),interrupted);
  const warmup=readMeasurementStream(file('warmup.jsonl'),interrupted);
  const rows=measurement.rows, warmups=warmup.rows;
  const failure=interrupted?readFileSync(file('failure.json'),'utf8'):null;
  const partial={status:'incomplete',failureHash:failure===null?null:hash(failure),
    rawHash:hash(measurement.content),warmupHash:hash(warmup.content),samples:rows.length+warmups.length};
  if(interrupted) { if(existsSync(file('interrupted-audit.json'))) assert.deepEqual(parse(readFileSync(file('interrupted-audit.json'),'utf8')),partial); else write('interrupted-audit.json',partial); }
  const done=interrupted?partial:parse(readFileSync(file('completed.json'),'utf8'));
  assert.equal(env.planHash,hash(plan)); assert.equal(env.refsHash,hash(refs)); assert.equal(env.qualityRefsHash,hash(qualityRefs));
  const snapshot=parse(readFileSync(file('sources.json'),'utf8'));
  for(const [name,content] of Object.entries(snapshot)) assert.equal(env.sourceHashes[name],byteHash(content as string));
  assert.equal(done.rawHash,hash(measurement.content));
  assert.equal(done.warmupHash,hash(warmup.content));
  assert.ok(rows.every(r=>r.phase==='measurement') && warmups.every(r=>r.phase==='warmup'),'raw/warmup phase mismatch');
  if(!interrupted) assert.equal(warmups.length,tasks.length*3);
  assert.equal(done.samples,rows.length+warmups.length);
  const expectedWarmups=tasks.flatMap(({p,c})=>[0,1,2].map(extra=>`${p.id}/${c.id}/${extra}/-1`)).sort();
  const warmupKeys=warmups.map(r=>`${r.position}/${r.condition}/${r.extra}/${r.rep}`).sort();
  assert.equal(new Set(warmupKeys).size,warmupKeys.length);
  assert.deepEqual(warmupKeys,interrupted?expectedWarmups.filter((k:string)=>warmupKeys.includes(k)):expectedWarmups);
  const all=[...rows,...warmups].sort((a,b)=>a.sequence-b.sequence);
  if(failure!==null) assert.equal(parse(failure).sequence,all.length,'failure sequence must match saved prefix');
  assert.deepEqual(all.map(r=>r.sequence),Array.from({length:done.samples},(_,i)=>i));
  for(const row of all) {
    const c=runConditions.find(c=>c.id===row.condition)!;
    assert.equal(row.status,'ok'); assert.ok(Number.isFinite(row.callMs) && row.callMs>=0 && Number.isFinite(row.apiMs) && row.apiMs>=0);
    assert.equal(row.apiMs,row.result.elapsedMilliseconds);
    assert.equal(row.overrunMs,c.budget===null?null:Math.max(0,row.callMs-c.budget));
    assert.ok(row.stats.maxExtensionDepth<=row.extra);
    const p=plan.positions.find((p:{id:string})=>p.id===row.position); assert.ok(p,'unknown position');
    auditQualityResult(p,row.result,row.extra);
    if(row.result.resultSource==='partial-root') assert.ok(validatePartialRoot(p.state,row.result,1+row.extra));
    if(row.result.selectedEvaluation!==null) assert.deepEqual(observePv(p.state,row.result.principalVariation).breakdown,row.result.evaluationBreakdown);
  }
  const expected=tasks.flatMap(({p,c})=>[0,1,2].flatMap(extra=>Array.from({length:c.repeats},(_,rep)=>`${p.id}/${c.id}/${extra}/${rep}`))).sort();
  const rowKeys=rows.map(r=>`${r.position}/${r.condition}/${r.extra}/${r.rep}`).sort();
  assert.equal(new Set(rowKeys).size,rowKeys.length);
  assert.deepEqual(rowKeys,interrupted?expected.filter((k:string)=>rowKeys.includes(k)):expected);
  if(interrupted) {
    const missing={status:'incomplete',missingMeasurementCells:expected.filter((k:string)=>!rowKeys.includes(k)),missingWarmupCells:expectedWarmups.filter((k:string)=>!warmupKeys.includes(k))};
    if(existsSync(file('missing.json'))) assert.deepEqual(parse(readFileSync(file('missing.json'),'utf8')),missing);else write('missing.json',missing);
  }
  const coverage={status:interrupted?'incomplete':'complete',
    measurement:{planned:expected,observed:rowKeys,missing:expected.filter(k=>!rowKeys.includes(k))},
    warmup:{planned:expectedWarmups,observed:warmupKeys,missing:expectedWarmups.filter(k=>!warmupKeys.includes(k))},
    streams:{measurement:{exists:measurement.exists,n:rows.length},warmup:{exists:warmup.exists,n:warmups.length}},
    failure:failure===null?null:parse(failure)};
  if(existsSync(file('coverage-v3.json'))) assert.deepEqual(parse(readFileSync(file('coverage-v3.json'),'utf8')),coverage);else write('coverage-v3.json',coverage);
  const summary=rows.map(row=>{
    const p=plan.positions.find((p:{id:string})=>p.id===row.position), r=row.result as Result; assert.ok(p,'unknown position');
    if(r.selectedEvaluation!==null) assert.deepEqual(observePv(p.state,r.principalVariation).breakdown,r.evaluationBreakdown);
    let evasion:'not-in-check'|'success'|'failure'='not-in-check';
    if(isPlayerInCheck(p.state,p.state.turn)) {
      evasion=r.selectedAction && !isPlayerInCheck(apply(p.state,r.selectedAction),p.state.turn)?'success':'failure';
    }
    return {...row,origin:p.origin,positionHash:hash(p.state),historyHash:hash(p.state.positionHistory),turn:p.state.turn,selectedActionLegal:true,settings:opts(row.extra),...qualityClassify(p,qualityRefs[p.id],r),...classify(p,refs[p.id],r),evasion,
      pvTerminalReason:r.selectedEvaluation===null?null:observePv(p.state,r.principalVariation).reason,
      pvTerminalDistancePly:r.selectedEvaluation===null?null:observePv(p.state,r.principalVariation).terminalDistancePly,
      terminalDiscovery:r.evaluationBreakdown?.terminal??'none',
      completedDepth:'completedDepth' in r?r.completedDepth:r.depth,
      resultSource:'resultSource' in r?r.resultSource:'fixed-depth',timedOut:'timedOut' in r?r.timedOut:false};
  });
  if(existsSync(file('summary-v3.json'))) assert.deepEqual(parse(readFileSync(file('summary-v3.json'),'utf8')),summary); else write('summary-v3.json',summary);
  const table=['|condition|extra|n|match / mismatch / indeterminate|wall p50 / p95 ms|maximum overrun ms|completed depth sum|ordinary / q / extra nodes|',
    '|---|---:|---:|---|---|---:|---:|---|'];
  const quantile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1]??null;
  const format=(n:number|null)=>n===null?'N/A':n.toFixed(3);
  for(const c of runConditions) for(const extra of [0,1,2]) {
    const rs=summary.filter(r=>r.condition===c.id&&r.extra===extra);
    const counts=['match','mismatch','indeterminate'].map(v=>rs.filter(r=>r.verdict===v).length).join(' / ');
    const sum=(f:(r:typeof rs[number])=>number)=>rs.reduce((n,r)=>n+f(r),0);
    table.push(`|${c.id}|${extra}|${rs.length}|${counts}|${format(quantile(rs.map(r=>r.callMs),.5))} / ${format(quantile(rs.map(r=>r.callMs),.95))}|${format(rs.length?Math.max(...rs.map(r=>r.overrunMs??0)):null)}|${sum(r=>r.completedDepth)}|${sum(r=>'totalVisitedPositionCount' in r.result?r.result.totalVisitedPositionCount:r.result.visitedPositionCount)} / ${sum(r=>'totalQuiescenceVisitedPositionCount' in r.result?r.result.totalQuiescenceVisitedPositionCount:r.result.quiescenceVisitedPositionCount)} / ${sum(r=>r.stats.visitedPositionCount)}|`);
  }
  const content=table.join('\n')+'\n';
  if(existsSync(file('results-v3.md'))) assert.equal(readFileSync(file('results-v3.md'),'utf8'),content);else writeFileSync(file('results-v3.md'),content,{flag:'wx'});
  for(const c of runConditions.filter(c=>c.budget===null)) for(const p of measuredPositions) for(const extra of [0,1,2]) {
    const rs=rows.filter(r=>r.position===p.id&&r.condition===c.id&&r.extra===extra);
    for(const r of rs.slice(1)) assert.deepEqual({...r.result,elapsedMilliseconds:0},{...rs[0].result,elapsedMilliseconds:0});
  }
  const quality=aggregateQuality(plan.positions,summary,tasks.flatMap(({p,c})=>[0,1,2].map(extra=>({position:p.id,condition:c.id,extra}))));
  if(existsSync(file('quality-summary-v3.json'))) assert.deepEqual(parse(readFileSync(file('quality-summary-v3.json'),'utf8')),quality); else write('quality-summary-v3.json',quality);
  return {coverage,summary,quality};
}
