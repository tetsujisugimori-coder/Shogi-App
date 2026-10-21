import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { json, parse, byteHash } from './benchmarks/partialRootMatches';
import { observePv } from './benchmarks/terminalDistanceReference';
import { getLegalActions } from '../src/domain/shogi/legalActions';

export function percentile(values: number[], q: number): number {
  assert.ok(values.length && q > 0 && q <= 1);
  return [...values].sort((a,b)=>a-b)[Math.ceil(q*values.length)-1];
}
const signature = (r: any) => json([r.selectedAction,r.selectedEvaluation,r.principalVariation,r.evaluationBreakdown]);
const histogram = (values: any[]) => Object.fromEntries([...new Set(values)].map(v=>[String(v),values.filter(x=>x===v).length]));
export function summarize(plan: any, rows: any[]) {
  assert.equal(rows.length,plan.cells.length*(plan.repeats+1)*plan.variants.length);
  let fixedMatches=0, timedSameDepthMatches=0;
  const timedDifferences: any[]=[];
  for (const cell of plan.cells) for(let repeat=-1;repeat<plan.repeats;repeat++) for(const variant of plan.variants) {
    assert.equal(rows.filter(r=>r.position===cell.position&&r.kind===cell.kind&&r.repeat===repeat&&r.variant===variant).length,1);
  }
  for(const [index,r] of rows.entries()) {
    assert.equal(r.sequence,index); assert.ok(!r.failure);
    assert.ok(Number.isFinite(r.callMs)&&r.callMs>=0);
    assert.ok(r.cpuUsed.user>=0&&r.cpuUsed.system>=0);
    const s=r.statistics;
    assert.equal(s.lookups,s.hits+s.misses); assert.ok(s.exactReuses<=s.hits);
    assert.ok(s.maxEntries<=512); assert.ok(s.maxPayloadCharacters<=512*16384);
    const state=plan.positions.find((p:any)=>p.id===r.position).state;
    if(r.result.selectedAction!==null) {
      assert.ok(getLegalActions(state).some(a=>json(a)===json(r.result.selectedAction)));
      if(r.result.resultSource!=='fallback') assert.deepEqual(r.result.selectedAction,r.result.principalVariation[0]);
    }
    const leaf=observePv(state,r.result.principalVariation);
    if(r.result.resultSource==='fallback') {
      assert.equal(r.result.selectedEvaluation,null); assert.equal(r.result.evaluationBreakdown,null); assert.equal(r.result.principalVariation.length,0);
    } else { assert.equal(r.result.selectedEvaluation,leaf.breakdown.total); assert.deepEqual(r.result.evaluationBreakdown,leaf.breakdown); }
    if(r.variant==='C'||r.variant==='P') {
      assert.equal(s.identityMatches,s.exactReuses); assert.equal(s.identityMismatches,s.hits-s.exactReuses);
      assert.equal(s.safetyRejects,s.identityMismatches+s.nonExactStoreRejects+s.sizeStoreRejects);
      assert.ok(s.identityGenerations<=s.hits+s.stores+s.sizeStoreRejects);
    }
    if(r.variant==='A') continue;
    const a=rows.find(o=>o.position===r.position&&o.kind===r.kind&&o.repeat===r.repeat&&o.variant==='A');
    if(['fixed','iterative'].includes(r.kind)) {
      assert.equal(signature(r.result),signature(a.result)); fixedMatches++;
    } else {
      const sameDepth=(r.result.completedDepth===a.result.completedDepth);
      const sameResult=signature(r.result)===signature(a.result);
      if(sameDepth&&sameResult) timedSameDepthMatches++;
      else timedDifferences.push({position:r.position,kind:r.kind,repeat:r.repeat,variant:r.variant,
        category:sameDepth?'same-depth-different-result':'different-completed-depth',
        sources:[a.result.resultSource,r.result.resultSource],depths:[a.result.completedDepth,r.result.completedDepth],
        sameResult});
    }
  }
  const groups=[];
  for(const cell of plan.cells) for(const variant of plan.variants) {
    const g=rows.filter(r=>r.phase==='measurement'&&r.position===cell.position&&r.kind===cell.kind&&r.variant===variant);
    assert.equal(g.length,plan.repeats);
    const values=g.map(r=>r.callMs), keys=[...new Set<string>(g.flatMap(r=>Object.keys(r.statistics).filter(k=>typeof r.statistics[k]==='number')))];
    groups.push({...cell,variant,n:g.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),minMs:Math.min(...values),maxMs:Math.max(...values),
      distributionMs:values,totalMs:values.reduce((a,b)=>a+b,0),cpuMs:g.reduce((a,r)=>a+(r.cpuUsed.user+r.cpuUsed.system)/1000,0),
      ordinaryNodes:g.reduce((a,r)=>a+(r.result.totalVisitedPositionCount??r.result.visitedPositionCount??0),0),
      qNodes:g.reduce((a,r)=>a+(r.result.totalQuiescenceVisitedPositionCount??r.result.quiescenceVisitedPositionCount??0),0),
      completedDepth:histogram(g.map(r=>r.result.completedDepth??r.result.depth)),resultSource:histogram(g.map(r=>r.result.resultSource??r.kind)),
      overrunMs:cell.budget===null?null:g.map(r=>Math.max(0,r.callMs-cell.budget)),
      statistics:Object.fromEntries(keys.map(k=>[k,k.startsWith('max')?Math.max(...g.map(r=>r.statistics[k])):g.reduce((a,r)=>a+r.statistics[k],0)])),
      diagnostic:g.map(r=>r.diagnostic)});
  }
  return {rows:rows.length,warmups:rows.filter(r=>r.phase==='warmup').length,failures:0,missing:0,fixedMatches,
    timedSameDepthMatches,timedDifferences,groups};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const dir=resolve(process.argv[2]);
  const plan=parse(readFileSync(join(dir,'plan.json'),'utf8'));
  const completion=parse(readFileSync(join(dir,'completed.json'),'utf8'));
  const raw=existsSync(join(dir,'raw.jsonl'))?readFileSync(join(dir,'raw.jsonl')):gunzipSync(readFileSync(join(dir,'raw.jsonl.gz')));
  assert.equal(byteHash(raw),completion.rawSha256);
  assert.equal(byteHash(Buffer.from(json(plan.positions))),plan.inputHash);
  for(const [name,hash] of Object.entries(plan.sourceHashes)) assert.equal(byteHash(gunzipSync(readFileSync(join(dir,'sources',name+'.gz')))),hash);
  const rows=raw.toString().trim().split('\n').map(parse);
  assert.equal(rows.length,completion.rows); assert.equal(completion.failures,0);
  const summary=summarize(plan,rows);
  const file=join(dir,'summary.json');
  if(existsSync(file)) assert.deepEqual(parse(readFileSync(file,'utf8')),summary);
  else writeFileSync(file,json(summary)+'\n',{flag:'wx'});
  const report=['| Position | Mode | Variant | n | p50 ms | p95 ms | min–max ms | CPU total ms |',
    '|---|---|---|---:|---:|---:|---:|---:|',...summary.groups.map(g=>
      `|${g.position}|${g.kind}|${g.variant}|${g.n}|${g.p50Ms.toFixed(3)}|${g.p95Ms.toFixed(3)}|${g.minMs.toFixed(3)}–${g.maxMs.toFixed(3)}|${g.cpuMs.toFixed(3)}|`)];
  writeFileSync(join(dir,'results.md'),report.join('\n')+'\n');
  console.log(json({rows:summary.rows,fixedMatches:summary.fixedMatches,timedDifferences:summary.timedDifferences}));
}
