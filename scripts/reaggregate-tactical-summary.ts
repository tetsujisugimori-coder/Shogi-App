import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {summarize,json,parse,type Reference,type Sample} from './benchmarks/tacticalDiagnostics';
import type {TacticalPosition} from './benchmarks/tacticalPositions';

// Reclassify SAVED raw only. Never prepares positions, solves a reference, or
// invokes a search engine. Existing summary must equal the archived old version
// or the regenerated version; unexplained edits are rejected before writing.
const [dirArg,previousArg,reportArg]=process.argv.slice(2);
assert.ok(dirArg&&previousArg&&reportArg,'DIR PREVIOUS_SUMMARY NEW_DIFF_REPORT');
const dir=path.resolve(dirArg),previous=path.resolve(previousArg),reportPath=path.resolve(reportArg);
const summaryPath=path.join(dir,'summary.json');
assert.notEqual(summaryPath,previous);assert.notEqual(reportPath,previous);assert.notEqual(reportPath,summaryPath);
const read=(p:string)=>parse(readFileSync(p,'utf8'));
const positions=read(path.join(dir,'plan.json')).positions as TacticalPosition[];
const refs=read(path.join(dir,'references.json')) as Record<string,Reference>;
const rows=readFileSync(path.join(dir,'raw.jsonl'),'utf8').trim().split(/\r?\n/).map(parse) as Sample[];
const regenerated=summarize(positions,refs,rows);
const old=read(previous) as typeof regenerated;
assert.deepEqual(old.map(x=>[x.position,x.condition]),regenerated.map(x=>[x.position,x.condition]));
const counts=(data:typeof regenerated,mode:string)=>Object.fromEntries(['match','mismatch','indeterminate'].map(v=>
  [v,data.filter(x=>(mode==='all'||x.mode===mode)&&x.verdict===v).length]));
const report={
  schema:2,reviewedSha:'2aab5c61296a2f88a80c92af31eabc6929ec2f0a',
  source:'existing raw.jsonl; no new measurements; original checkmate-only references',
  previousSummary:path.basename(previous),
  previousByteSha256:createHash('sha256').update(readFileSync(previous)).digest('hex'),
  before:Object.fromEntries(['fixed','timed','all'].map(mode=>[mode,counts(old,mode)])),
  after:Object.fromEntries(['fixed','timed','all'].map(mode=>[mode,counts(regenerated,mode)])),
  reasons:{shortestWin:'checkmate-only scope; no-force-within-bound cannot refute other winning endings; scores are not proofs',
    longestResistance:'actual all-terminal distance unproved; checkmateOnly distance comparison is a separate metric'},
  verdictChanges:regenerated.flatMap((row,i)=>row.verdict===old[i].verdict?[]:[{position:row.position,condition:row.condition,
    before:old[i].verdict,after:row.verdict,reason:row.reason}]),
  classificationChanges:regenerated.flatMap((row,i)=>json(row)===json(old[i])?[]:[{before:old[i],after:row}]),
};
const current=read(summaryPath);
assert.ok(json(current)===json(old)||json(current)===json(regenerated),'unexpected current summary; refuse overwrite');
if(existsSync(reportPath)) assert.deepEqual(read(reportPath),report); // Validate prior report before any mutation.
else writeFileSync(reportPath,json(report)+'\n',{flag:'wx'});
if(json(current)!==json(regenerated)) writeFileSync(summaryPath,json(regenerated)+'\n');
console.log(json({before:report.before,after:report.after,verdictChanges:report.verdictChanges.length,classificationChanges:report.classificationChanges.length}));
