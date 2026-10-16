import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const root = process.argv[2]; assert.ok(root, 'usage: tsx scripts/audit-partial-root.ts OUTPUT');
const lines = (file: string): Record<string, unknown>[] => readFileSync(path.join(root,file),'utf8').trim().split('\n').map(s=>JSON.parse(s,(_key,value)=>value==='+Infinity'?Infinity:value==='-Infinity'?-Infinity:value));
const environment = lines('environment.jsonl'); assert.equal(environment.length,1);
const raw = lines('raw.jsonl') as unknown as { version:string;position:string;budget:number;phase:string;run:number;
  callMs:number;apiMs:number;overrunMs:number;result:{resultSource:string;completedDepth:number;selectedEvaluation:number|null;partialRoot?:unknown} }[];
const summary = JSON.parse(readFileSync(path.join(root,'summary.json'),'utf8'));
const quality = lines('quality.jsonl') as unknown as {position:string;budget:number;run:number;selected:number;fallback:number;improvement:number|null;comparison:string}[];
const fixed = lines('fixed.jsonl'); const events = lines('events.jsonl');
assert.equal(raw.length,280);assert.equal(summary.calls,280);assert.equal(summary.samples,200);
assert.equal(events.at(-1)?.event,'complete');assert.equal(fixed.length,10);
assert.equal(new Set(raw.map(r=>r.position)).size,10);
assert.equal(new Set(raw.map(r=>`${r.version}:${r.position}:${r.budget}:${r.run}`)).size,280);
for(const row of raw) {
  assert.ok(Number.isFinite(row.callMs)&&row.callMs>=0&&Number.isFinite(row.apiMs)&&row.apiMs>=0);
  assert.ok(Math.abs(row.overrunMs-(row.callMs-row.budget))<1e-9);
  assert.equal(row.phase,row.run<0?'warmup':'sample');
  if(row.result.resultSource==='partial-root') { assert.equal(row.version,'product');assert.equal(row.result.completedDepth,0);assert.ok(row.result.partialRoot); }
}
const samples=raw.filter(r=>r.phase==='sample');
const partial=samples.filter(r=>r.result.resultSource==='partial-root');assert.equal(quality.length,partial.length);
for(const entry of quality) {
  const row=partial.find(r=>r.position===entry.position&&r.budget===entry.budget&&r.run===entry.run);assert.ok(row);
  assert.equal(entry.selected,row.result.selectedEvaluation);assert.ok(entry.selected>=entry.fallback);
  assert.equal(entry.improvement,Number.isFinite(entry.selected)&&Number.isFinite(entry.fallback)?entry.selected-entry.fallback:null);
}
for(const row of fixed) {assert.equal(row.identical,true);assert.deepEqual(row.baseline,row.product);}
for(const budget of [100,1000]) {
  const condition=summary.conditions.find((s:{budget:number})=>s.budget===budget);assert.ok(condition);
  for(const version of ['baseline','product']) {
    const rows=samples.filter(r=>r.version===version&&r.budget===budget);assert.equal(rows.length,50);
    const group=condition[version];assert.equal(group.calls,50);
    const sources:Record<string,number>={},depths:Record<string,number>={};
    for(const row of rows){sources[row.result.resultSource]=(sources[row.result.resultSource]??0)+1;const d=row.result.completedDepth;depths[d]=(depths[d]??0)+1;}
    assert.deepEqual(group.sources,sources);assert.deepEqual(group.depths,depths);
    const sorted=rows.map(r=>r.callMs).sort((a,b)=>a-b);
    assert.equal(group.callP50,sorted[24]);assert.equal(group.callP95,sorted[47]);
    assert.equal(group.maxOverrun,Math.max(...rows.map(r=>r.overrunMs)));
  }
  const qs=quality.filter(q=>q.budget===budget);
  assert.equal(condition.quality.calls,qs.length);assert.equal(condition.quality.improved,qs.filter(q=>q.comparison==='improved').length);
  assert.equal(condition.quality.equal,qs.filter(q=>q.comparison==='equal').length);assert.equal(condition.quality.worsened,0);
}
console.log('PASS: 280 calls (200 measured), 10 distinct positions, exact candidate quality and 10 fixed comparisons; raw/summary consistent');
