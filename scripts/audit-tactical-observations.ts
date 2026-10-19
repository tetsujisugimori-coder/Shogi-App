import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {json,parse} from './benchmarks/tacticalDiagnostics';
import {observations} from './benchmarks/tacticalObservations';
const dir=process.argv[2];assert.ok(dir,'audit-tactical-observations.ts DIR');
const read=(file:string)=>parse(readFileSync(path.join(dir,file),'utf8'));
const rows=readFileSync(path.join(dir,'raw.jsonl'),'utf8').trim().split(/\r?\n/).map(parse);
const data=observations(read('plan.json').positions,read('references.json'),rows,
  Object.fromEntries(['mixed-distance','resistance'].map(id=>[id,read(`candidate-probe-${id}.json`)])));
const target=path.join(dir,'observations.json');
if(existsSync(target)) assert.deepEqual(read('observations.json'),data);
else writeFileSync(target,json(data)+'\n',{flag:'wx'});
console.log('Replayed all saved PVs and positive certificates; independently verified terminal legal-response absence.');
