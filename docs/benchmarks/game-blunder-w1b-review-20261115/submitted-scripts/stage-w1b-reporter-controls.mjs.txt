import { mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { assess } from './stage-w1b-summary.mjs';
import { read } from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]),root=resolve(process.argv[3]);mkdirSync(out);mkdirSync(root);
const rows=[];
for(const [name,body,expected] of [
 ['unhandled',"it('passes',async()=>{setTimeout(()=>{throw new Error('W1b real unhandled fixture');},0);await new Promise(r=>setTimeout(r,100));expect(1).toBe(1);});",'INVALID'],
 ['assertion-failure',"it('fails',()=>expect(1).toBe(2));",'FAIL'],
 ['empty-describe',"describe('empty',()=>{});it('passes',()=>expect(1).toBe(1));",'FAIL'],
 ['normal',"describe('outer',()=>{describe('inner',()=>{it('same',()=>expect(1).toBe(1));it('same',()=>expect(2).toBe(2));});});",'PASS'],
]) {
 const dir=join(root,name),output=join(out,name);mkdirSync(dir);mkdirSync(output);
 writeFileSync(join(dir,'package.json'),'{"type":"module"}');
 writeFileSync(join(dir,'vitest.config.mjs'),`export default {cacheDir:${JSON.stringify(join(root,'cache'))},test:{environment:'node',maxWorkers:2,cache:false}};`);
 writeFileSync(join(dir,'tiny.test.js'),"import {it,describe,expect} from 'vitest';\n"+body+'\n');
 symlinkSync(resolve('node_modules'),join(dir,'node_modules'),'junction');
 const request={mode:'run',dir,output,filters:[],command:['createVitest','test',dir],runId:`reporter-${name}`,trialId:name,preflightSha256:'DIRECT-REPORTER-OBSERVATION-NO-PREFLIGHT',inventorySha256:'NOT-A-COMPARISON'};
 const reqPath=join(output,'request.json');writeFileSync(reqPath,JSON.stringify(request,null,2));
 const r=spawnSync(process.execPath,[resolve('scripts/stage-w1b-worker.mjs'),reqPath],{cwd:dir,encoding:'utf8',maxBuffer:8*1024*1024});
 writeFileSync(join(output,'stdout.log'),r.stdout??'');writeFileSync(join(output,'stderr.log'),r.stderr??'');
 const result=read(join(output,'vitest.json')),runtime=read(join(output,'runtime.json'));
 const inventory={tests:result.testResults.flatMap(s=>s.assertionResults.map(t=>({file:s.name,name:t.fullName})))};
 // Diagnostic assessor test only: inventory comes from result and is NOT provenance.
 const assessment=assess({exitCode:r.status,provenanceVerified:true,runtime},result,inventory);
 assert.equal(assessment.status,expected,JSON.stringify(assessment));
 assert.ok(!('unhandledErrors' in result));assert.ok(!('numRuntimeErrorTestSuites' in result));
 if(name==='unhandled')assert.ok(runtime.unhandledErrors.length);
 rows.push({name,exitCode:r.status,jsonSuccess:result.success,jsonFiles:result.testResults.length,jsonSuites:result.numTotalTestSuites,runtimeErrors:runtime.unhandledErrors.length,status:assessment.status,note:'Direct real reporter observation; not a preflight-authorized comparison'});
 writeFileSync(join(output,'assessment.json'),JSON.stringify(assessment,null,2));
}
writeFileSync(join(out,'outcomes.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
