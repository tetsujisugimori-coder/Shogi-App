import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspect, requirePair, requireUnchanged, read, hash, digest, contains, environment, physical } from './stage-w1b-preflight.mjs';
import { assess } from './stage-w1b-summary.mjs';
const worker=fileURLToPath(new URL('./stage-w1b-worker.mjs',import.meta.url));
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n',{flag:'wx'});
const fileHash=p=>hash(readFileSync(p));
const tooling=()=>Object.fromEntries(['runner','worker','preflight','summary'].map(n=>[n,fileHash(fileURLToPath(new URL('./stage-w1b-'+n+'.mjs',import.meta.url)))]));
function event(out,e) {write(join(out,`event-${randomUUID()}.json`),{at:new Date().toISOString(),...e});}
function validatePlan(plan,out) {
  if(!plan || !Array.isArray(plan.targets)||plan.targets.length!==2||!Array.isArray(plan.filters)||!plan.filters.every(s=>typeof s==='string')) throw Error('invalid comparison plan');
  for(const t of plan.targets) if(!t.dir||!t.repo||!t.head) throw Error('missing target configuration');
  for(const k of ['pool','maxWorkers','testTimeout','cache']) if(!Object.hasOwn(plan.expected??{},k)) throw Error(`UNKNOWN expected ${k}`);
  if(plan.expected.testTimeout!==5000) throw Error('only existing 5000ms timeout supported');
  for(const t of plan.targets) if(contains(physical(t.dir),physical(out))||contains(physical(join(t.dir,'node_modules')),physical(out))) throw Error('output must be outside snapshots');
  for(const p of Object.values(plan.environment??{})) for(const t of plan.targets) if(contains(t.dir,p)||contains(p,t.dir)) throw Error('isolation directory overlaps snapshot');
}
function inspectAll(plan) {const cache=new Map();const rows=plan.targets.map(t=>inspect(t.repo,t.dir,t.head,cache));requirePair(rows);return rows;}
const state=plan=>({observations:inspectAll(plan),environment:environment(plan)});
function child(out,request) {
  const requestPath=join(request.output,'request.json');write(requestPath,request);
  const args=[worker,requestPath];
  event(out,{phase:request.mode,trialId:request.trialId,action:'spawn',executable:process.execPath,args,cwd:request.dir});
  const r=spawnSync(process.execPath,args,{cwd:request.dir,env:{...process.env,...request.environment,npm_config_logs_max:'0'},encoding:'utf8',maxBuffer:64*1024*1024});
  writeFileSync(join(request.output,'stdout.log'),r.stdout??'');
  writeFileSync(join(request.output,'stderr.log'),r.stderr??'');
  write(join(request.output,'exit.json'),{exitCode:r.status,signal:r.signal,error:r.error?.message??null});
  return r;
}
export function prepare(plan,out) {
  out=resolve(out);mkdirSync(out);const runId=randomUUID();
  try {
    validatePlan(plan,out);
    const sealed=state(plan),observations=sealed.observations;
    write(join(out,'preflight.json'),{runId,at:new Date().toISOString(),output:out,plan,observations,sealed,tooling:tooling(),execution:{node:process.version,nodePath:process.execPath,cwd:process.cwd()},status:'SOURCE_DEPENDENCIES_VERIFIED',limitations:['Point-in-time raw bytes; hashes do not prove authenticity or historical execution.','Selected cache/TEMP trees are sealed; arbitrary external writes and concurrent adversarial changes are not OS-sandboxed.']});
    const preflightSha256=fileHash(join(out,'preflight.json')),trials=[];
    for(let i=0;i<2;i++) {
      const t=plan.targets[i],output=join(out,`collect-${i}`);mkdirSync(output);
      const trialId=randomUUID(),command=['createVitest','test',resolve(t.dir),...plan.filters];
      requireUnchanged(sealed,state(plan));
      const request={mode:'collect',runId,trialId,preflightSha256,target:t,observation:observations[i],environment:plan.environment,isolationPlan:{environment:plan.environment,isolationPaths:plan.isolationPaths},environmentTrees:sealed.environment.trees,dir:resolve(t.dir),output,filters:plan.filters,command};
      const r=child(out,request);
      if(r.status!==0||r.error) throw Error(`collection ${i} unsuccessful`);
      const settings=read(join(output,'settings.json'));
      if(!contains(join(t.dir,'node_modules'),settings.cacheDir) && !Object.keys(sealed.environment.trees).some(p=>contains(p,settings.cacheDir))) throw Error('UNKNOWN unsealed Vite cache directory');
      for(const [k,v] of Object.entries(plan.expected)) if(digest(k==='cache'&&typeof v==='boolean'?settings[k]!==false:settings[k])!==digest(v)) throw Error(`effective setting mismatch: ${k}`);
      const inventory=read(join(output,'inventory.json'));
      requireUnchanged(sealed,state(plan));
      if(inventory.tests.some(t=>t.mode!=='run')||inventory.suites.some(s=>s.mode!=='run')) throw Error('UNKNOWN planned skipped/todo status');
      trials.push({trialId,request,settings,inventorySha256:fileHash(join(output,'inventory.json')),settingsSha256:fileHash(join(output,'settings.json'))});
    }
    requireUnchanged(sealed,state(plan));
    // Only snapshot-relative paths are mapped. External cache paths remain exact values.
    const comparable=(s,root)=>{const path=p=>contains(root,p)?'<snapshot>/'+p.slice(root.length+1).replaceAll('\\','/'):p;return {...s,cwd:contains(root,s.cwd)?'<snapshot>':s.cwd,command:['createVitest','test','<snapshot>',...plan.filters],cache:s.cache===false?false:{...s.cache,dir:path(s.cache.dir)},cacheDir:path(s.cacheDir),setupFiles:s.setupFiles.map(path)};};
    if(digest(comparable(trials[0].settings,resolve(plan.targets[0].dir)))!==digest(comparable(trials[1].settings,resolve(plan.targets[1].dir)))) throw Error('effective settings differ across targets');
    write(join(out,'ready.json'),{runId,preflightSha256,trials});
    write(join(out,'ready.sha256.json'),{sha256:fileHash(join(out,'ready.json'))});
    return {status:'READY',runId};
  } catch(e) {write(join(out,'blocked-prepare.json'),{runId,status:'UNKNOWN',reason:String(e)});return {status:'UNKNOWN',reason:String(e)};}
}
export function launch(out) {
  out=resolve(out);
  try {
    if(fileHash(join(out,'ready.json'))!==read(join(out,'ready.sha256.json')).sha256) throw Error('ready record changed');
    const ready=read(join(out,'ready.json')),preflight=read(join(out,'preflight.json'));
    if(ready.preflightSha256!==fileHash(join(out,'preflight.json'))||preflight.runId!==ready.runId) throw Error('preflight binding mismatch');
    validatePlan(preflight.plan,out);
    if(preflight.output!==out) throw Error('execution output binding mismatch');
    if(digest(preflight.tooling)!==digest(tooling())) throw Error('execution tooling changed');
    if(digest(preflight.observations)!==digest(preflight.sealed.observations)) throw Error('preflight observation binding mismatch');
    if(ready.trials.length!==2||new Set(ready.trials.map(t=>t.trialId)).size!==2) throw Error('invalid trial count/identity');
    for(const [i,trial] of ready.trials.entries()) {
      if(digest(trial.request.target)!==digest(preflight.plan.targets[i]) || trial.request.dir!==resolve(preflight.plan.targets[i].dir) || trial.request.output!==join(out,`collect-${i}`)) throw Error('target binding mismatch');
      if(digest(trial.request.observation)!==digest(preflight.observations[i]) || digest(trial.request.environment)!==digest(preflight.plan.environment)) throw Error('source/environment binding mismatch');
      for(const [f,k] of [['inventory.json','inventorySha256'],['settings.json','settingsSha256']]) if(fileHash(join(trial.request.output,f))!==trial[k]) throw Error(`${f} changed`);
      if(trial.request.runId!==ready.runId||trial.request.trialId!==trial.trialId||trial.request.preflightSha256!==ready.preflightSha256) throw Error('trial binding mismatch');
    }
    // Refuse ANY planned result directory before spawning the first comparison.
    for(let i=0;i<ready.trials.length;i++) if(existsSync(join(out,`trial-${i}`))) throw Error(`reused trial output: trial-${i}`);
    requireUnchanged(preflight.sealed,state(preflight.plan));
    if(existsSync(join(out,'launched.json'))) throw Error('run already launched');
    write(join(out,'launched.json'),{runId:ready.runId});
    const results=[];
    for(let i=0;i<ready.trials.length;i++) {
      requireUnchanged(preflight.sealed,state(preflight.plan));
      const trial=ready.trials[i],output=join(out,`trial-${i}`);mkdirSync(output);
      const request={...trial.request,mode:'run',output,inventorySha256:trial.inventorySha256,expectedSettings:trial.settings};
      const r=child(out,request),runtime=read(join(output,'runtime.json'));
      if(runtime.runId!==ready.runId||runtime.trialId!==trial.trialId||runtime.inventorySha256!==trial.inventorySha256||runtime.preflightSha256!==ready.preflightSha256) throw Error('result from another trial');
      const meta={runId:ready.runId,trialId:trial.trialId,exitCode:r.status,provenanceVerified:true,runtime};
      const inventory=read(join(trial.request.output,'inventory.json'));
      if(digest(inventory.suites.map(s=>s.id).sort())!==digest(runtime.suites.map(s=>s.id).sort())) throw Error('runtime suite inventory mismatch');
      const logs=['stdout.log','stderr.log'].flatMap(f=>readFileSync(join(output,f),'utf8').split(/\r?\n/).filter(l=>/unhandled (?:rejection|error)|AbortError|worker.*(?:crash|exit)/i.test(l)));
      const assessment=assess(meta,read(join(output,'vitest.json')),inventory,logs);
      requireUnchanged(preflight.sealed,state(preflight.plan));
      const bindings=Object.fromEntries(['vitest.json','runtime.json','settings.json','request.json','stdout.log','stderr.log','exit.json'].map(f=>[f,fileHash(join(output,f))]));
      write(join(output,'assessment.json'),{...meta,runtime:undefined,assessment,bindings,preflightSha256:ready.preflightSha256,inventorySha256:trial.inventorySha256});
      results.push({trialId:trial.trialId,status:assessment.status});
    }
    write(join(out,'comparison.json'),{runId:ready.runId,results,status:results.every(r=>r.status==='PASS')?'PASS':'NONPASS'});
    return read(join(out,'comparison.json'));
  } catch(e) {event(out,{action:'blocked',phase:'launch',reason:String(e)});return {status:'UNKNOWN',reason:String(e)};}
}
// Offline integrity check of an already recorded execution, not a historical preflight.
export function verify(out) {
  try {
    const ready=read(join(out,'ready.json')),preflight=read(join(out,'preflight.json'));
    if(fileHash(join(out,'ready.json'))!==read(join(out,'ready.sha256.json')).sha256 || fileHash(join(out,'preflight.json'))!==ready.preflightSha256 || ready.runId!==preflight.runId) throw Error('changed execution record');
    if(ready.trials.length!==2||new Set(ready.trials.map(t=>t.trialId)).size!==2) throw Error('invalid trial count/identity');
    const results=ready.trials.map((trial,i)=>{
      const dir=join(out,`trial-${i}`),record=read(join(dir,'assessment.json'));
      if(record.runId!==ready.runId||record.trialId!==trial.trialId||record.inventorySha256!==trial.inventorySha256||record.preflightSha256!==ready.preflightSha256) throw Error('another trial assessment');
      for(const f of ['vitest.json','runtime.json','settings.json','request.json','stdout.log','stderr.log','exit.json']) if(fileHash(join(dir,f))!==record.bindings[f]) throw Error(`changed or missing ${f}`);
      if(fileHash(join(trial.request.output,'inventory.json'))!==trial.inventorySha256 || fileHash(join(trial.request.output,'settings.json'))!==trial.settingsSha256) throw Error('changed collection');
      const runtime=read(join(dir,'runtime.json'));
      if(runtime.runId!==ready.runId||runtime.trialId!==trial.trialId||runtime.inventorySha256!==trial.inventorySha256||runtime.preflightSha256!==ready.preflightSha256) throw Error('another trial runtime');
      const request=read(join(dir,'request.json')),settings=read(join(dir,'settings.json'));
      if(digest(request.target)!==digest(preflight.plan.targets[i])||request.runId!==ready.runId||request.trialId!==trial.trialId||digest(settings)!==digest(trial.settings)) throw Error('request/settings binding mismatch');
      const signals=['stdout.log','stderr.log'].flatMap(f=>readFileSync(join(dir,f),'utf8').split(/\r?\n/).filter(l=>/unhandled (?:rejection|error)|AbortError|worker.*(?:crash|exit)/i.test(l)));
      const assessed=assess({exitCode:read(join(dir,'exit.json')).exitCode,runtime,provenanceVerified:true},read(join(dir,'vitest.json')),read(join(trial.request.output,'inventory.json')),signals);
      return {trialId:trial.trialId,status:assessed.status};
    });
    const result={status:results.every(r=>r.status==='PASS')?'PASS':'NONPASS',runId:ready.runId,results};
    const completion=read(join(out,'comparison.json'));
    if(completion.runId!==result.runId||completion.status!==result.status||digest(completion.results)!==digest(results)) throw Error('missing or inconsistent comparison completion');
    return result;
  } catch(e) {return {status:'INVALID',reason:String(e)};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [mode,input,out]=process.argv.slice(2);
  const result=mode==='prepare'?prepare(read(input),out):mode==='launch'?launch(input):mode==='verify'?verify(input):(()=>{throw Error('usage: prepare <plan.json> <new-output> | launch <prepared-output> | verify <recorded-output>');})();
  console.log(JSON.stringify(result));process.exitCode=['READY','PASS'].includes(result.status)?0:1;
}
