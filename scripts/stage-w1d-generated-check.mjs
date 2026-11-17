// Strict-seal controls. The .vite-temp directory is included, never excluded.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { inspect, environment, hash, read } from './stage-w1b-preflight.mjs';
const out=resolve(process.argv[2]);mkdirSync(out);
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n');
const sha=p=>hash(readFileSync(p)),runner=resolve('scripts/stage-w1b-runner.mjs');
const rows=[];
const cases=[
 ['unexpected-empty-directory',(a,b,p)=>mkdirSync(join(a,'node_modules/unplanned'))],
 ['unknown-file-in-vite-temp',a=>writeFileSync(join(a,'node_modules/.vite-temp/unknown.mjs'),'unknown')],
 ['existing-file-content',a=>writeFileSync(join(a,'node_modules/vitest/package.json'),'{"version":"4.1.11","changed":true}')],
 ['directory-to-file',a=>{renameSync(join(a,'node_modules/.vite-temp'),join(a,'node_modules/saved-vite-temp'));writeFileSync(join(a,'node_modules/.vite-temp'),'file');}],
 ['link-cycle',a=>symlinkSync(join(a,'node_modules'),join(a,'node_modules/.vite-temp/cycle'),process.platform==='win32'?'junction':'dir')],
 ['outside-vite-temp-cache',(a,b,p)=>writeFileSync(join(p.environment.npm_config_cache,'unknown'),'changed')],
 ['outside-vite-temp-TEMP',(a,b,p)=>mkdirSync(join(p.environment.TEMP,'unknown-empty'))],
 ['wrong-time-creation',(a,b)=>{for(const d of [a,b])mkdirSync(join(d,'node_modules/.vite-temp'));}],
 ['different-target-generated-output',(a,b)=>writeFileSync(join(b,'node_modules/.vite-temp/different'),'new only')],
 ['output-reuse',(a,b,p,o)=>mkdirSync(join(o,'trial-1'))],
 ['verification-record-tamper',(a,b,p,o)=>{const v=read(join(o,'ready.json'));v.trials[0].inventorySha256='0'.repeat(64);write(join(o,'ready.json'),v);}],
 ['allowance-condition-tamper',(a,b,p,o)=>{const v=read(join(o,'preflight.json'));v.allowance={path:'node_modules',ignoreEverything:true};write(join(o,'preflight.json'),v);}],
];
for(const [name,mutate] of cases) {
 const root=join(out,name),repo=join(root,'git'),a=join(root,'old'),b=join(root,'new'),record=join(root,'record');for(const p of [root,repo,a,b,record])mkdirSync(p);
 for(const f of ['package.json','package-lock.json'])writeFileSync(join(repo,f),f==='package.json'?'{"type":"module"}\n':'{}\n');
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();git('init');git('-c','core.autocrlf=false','add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','generated-seal-fixture');const head=git('rev-parse','HEAD');
 for(const d of [a,b]){for(const f of ['package.json','package-lock.json'])writeFileSync(join(d,f),execFileSync('git',['-C',repo,'show',`${head}:${f}`]));mkdirSync(join(d,'node_modules/vitest'),{recursive:true});write(join(d,'node_modules/vitest/package.json'),{version:'4.1.11'});if(name!=='wrong-time-creation')mkdirSync(join(d,'node_modules/.vite-temp'));}
 const temp=join(root,'temp'),cache=join(root,'cache');mkdirSync(temp);mkdirSync(cache);
 const plan={targets:[a,b].map(dir=>({dir,repo,head})),filters:[],expected:{pool:'forks',maxWorkers:2,testTimeout:5000,cache:true},environment:{TEMP:temp,TMP:temp,npm_config_cache:cache}},observations=plan.targets.map(t=>inspect(repo,t.dir,head)),sealed={observations,environment:environment(plan)},runId=randomUUID();
 const tooling=Object.fromEntries(['runner','worker','preflight','summary'].map(n=>[n,sha(resolve(`scripts/stage-w1b-${n}.mjs`))]));
 tooling.w1gGate=sha(resolve('scripts/stage-w1g-gate.mjs'));
 write(join(record,'preflight.json'),{runId,output:record,plan,observations,sealed,tooling});const preflightSha256=sha(join(record,'preflight.json'));
 const trials=plan.targets.map((target,i)=>{const output=join(record,`collect-${i}`);mkdirSync(output);write(join(output,'inventory.json'),{tests:[],suites:[]});const settings={cacheDir:join(target.dir,'node_modules/.vite')};write(join(output,'settings.json'),settings);const trialId=randomUUID(),request={target,dir:target.dir,output,observation:observations[i],environment:plan.environment,runId,trialId,preflightSha256};return {trialId,request,settings,inventorySha256:sha(join(output,'inventory.json')),settingsSha256:sha(join(output,'settings.json'))};});
 write(join(record,'ready.json'),{runId,preflightSha256,trials});write(join(record,'ready.sha256.json'),{sha256:sha(join(record,'ready.json'))});
 mutate(a,b,plan,record);
 const r=spawnSync(process.execPath,[runner,'launch',record],{encoding:'utf8'}),events=readdirSync(record).filter(f=>f.startsWith('event-')).map(f=>read(join(record,f))),result=JSON.parse(r.stdout);
 const row={name,expected:'UNKNOWN / exit 1 / comparisonSpawns 0',actual:result,exitCode:r.status,comparisonSpawns:events.filter(e=>e.action==='spawn'&&e.phase==='run').length,stdout:r.stdout,stderr:r.stderr,command:[process.execPath,runner,'launch',record],scope:'Synthetic prepared admission record; no claim of real product comparison equivalence.'};write(join(root,'outcome.json'),row);rows.push(row);
 assert.equal(result.status,'UNKNOWN',name);assert.equal(r.status,1,name);assert.equal(row.comparisonSpawns,0,name);
}
write(join(out,'outcomes.json'),rows);console.log(JSON.stringify(rows.map(({name,exitCode,comparisonSpawns,actual})=>({name,exitCode,comparisonSpawns,actual}))));
