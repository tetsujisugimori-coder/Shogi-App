// Real tiny Vitest runs; explicitly not an old/new product comparison.
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { read } from './stage-w1b-preflight.mjs';
const [outArg,rootArg]=process.argv.slice(2),out=resolve(outArg),root=resolve(rootArg);mkdirSync(out);mkdirSync(root);
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n'),runner=resolve('scripts/stage-w1b-runner.mjs'),rows=[];
for(const [name,body,expected] of [
 ['normal-duplicates',"describe('outer',()=>{it('same',()=>expect(1).toBe(1));it('same',()=>expect(2).toBe(2));});",'PASS'],
 ['runtime-error',"it('pass with runtime error',async()=>{setTimeout(()=>{throw Error('W1d intentional runtime error');},0);await new Promise(r=>setTimeout(r,100));expect(1).toBe(1);});",'INVALID'],
 ['assertion-failure',"it('fails',()=>expect(1).toBe(2));",'FAIL'],
]){
 const base=join(root,name),evidence=join(out,name),source=join(base,'source');mkdirSync(source,{recursive:true});mkdirSync(evidence);
 const cache=join(base,'cache'),temp=join(base,'temp'),npm=join(base,'npm-cache');for(const p of [cache,temp,npm])mkdirSync(p);
 write(join(source,'package.json'),{type:'module'});writeFileSync(join(source,'package-lock.json'),readFileSync('package-lock.json'));
 writeFileSync(join(source,'vitest.config.mjs'),`export default {cacheDir:${JSON.stringify(cache)},test:{environment:'node',maxWorkers:2,cache:false}};\n`);
 writeFileSync(join(source,'tiny.test.js'),"import {it,describe,expect} from 'vitest';\n"+body+'\n');
 const git=(...args)=>execFileSync('git',['-C',source,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();git('init');git('-c','core.autocrlf=false','add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','runtime fixture');const head=git('rev-parse','HEAD');
 const targets=['a','b'].map(n=>{const dir=join(base,n);mkdirSync(dir);for(const f of ['package.json','package-lock.json','vitest.config.mjs','tiny.test.js'])writeFileSync(join(dir,f),execFileSync('git',['-C',source,'show',`${head}:${f}`]));symlinkSync(resolve('node_modules'),join(dir,'node_modules'),process.platform==='win32'?'junction':'dir');return {repo:source,dir,head};});
 const plan={targets,filters:[],expected:{pool:'forks',maxWorkers:2,testTimeout:5000,cache:false},environment:{TEMP:temp,TMP:temp,npm_config_cache:npm},isolationPaths:[cache]},planPath=join(evidence,'plan.json'),record=join(evidence,'record');write(planPath,plan);
 const run=(mode,arg,extra=[])=>{const args=[runner,mode,arg,...extra],r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:64*1024*1024});const v={command:[process.execPath,...args],exitCode:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,result:JSON.parse(r.stdout)};write(join(evidence,mode+'-cli.json'),v);return v;};
 assert.equal(run('prepare',planPath,[record]).result.status,'READY');
 const launch=run('launch',record),verify=run('verify',record),assessments=[0,1].map(i=>read(join(record,`trial-${i}/assessment.json`)).assessment);
 for(const a of assessments)assert.equal(a.status,expected,JSON.stringify(a));assert.equal(verify.result.status,name==='normal-duplicates'?'PASS':'NONPASS');assert.equal(verify.exitCode,name==='normal-duplicates'?0:1);
 rows.push({name,expected,launch,verify,assessments});
 if(name==='normal-duplicates'){
   const interrupted=join(evidence,'interrupted');cpSync(record,interrupted,{recursive:true});writeFileSync(join(interrupted,'trial-0/runtime.json'),'{');const r=spawnSync(process.execPath,[runner,'verify',interrupted],{encoding:'utf8'});write(join(evidence,'interrupted-cli.json'),{exitCode:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).status,'INVALID');
 }
}
write(join(out,'outcomes.json'),rows);console.log(JSON.stringify(rows.map(({name,expected,verify})=>({name,expected,actual:verify.result.status,exitCode:verify.exitCode}))));
