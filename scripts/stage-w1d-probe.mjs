import { admitTargets } from './stage-w1h-target.mjs';
// Observation only. No admission exception, cache override, or comparison start.
import fs, { promises as fsp } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { tree, inspect, hash, read } from './stage-w1b-preflight.mjs';
const [mode,planArg,outArg,indexArg]=process.argv.slice(2),plan=read(resolve(planArg)),out=resolve(outArg);
// Historical collection entry: reject fixed identities before any output or target import.
admitTargets(plan.targets);
const write=(p,o)=>fs.writeFileSync(p,JSON.stringify(o,null,2)+'\n',{flag:'wx'});
if(mode==='parent') {
  fs.mkdirSync(out);write(join(out,'plan.json'),plan);
  const rows=[];
  for(let i=0;i<2;i++) {
    const r=spawnSync(process.execPath,[resolve(process.argv[1]),'child',resolve(planArg),out,String(i)],{cwd:plan.targets[i].dir,env:{...process.env,...plan.environment},encoding:'utf8',maxBuffer:64*1024*1024});
    write(join(out,`${i}-cli.json`),{command:[process.execPath,process.argv[1],'child',resolve(planArg),out,String(i)],exitCode:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr});rows.push({index:i,exitCode:r.status});
    if(r.status!==0)break;
  }
  write(join(out,'gate.json'),{status:'NOT_READY',comparison:'NOT_TESTED',comparisonSpawns:0,rows,reason:'No runtime cache transition exception has been implemented or validated. Preparation observations alone do not authorize a comparison.',S4:'NOT_TESTED',S5:'NOT_TESTED'});
} else {
  const i=Number(indexArg),target=plan.targets[i],root=resolve(target.dir),require=createRequire(join(root,'package.json')),transitions=[];
  const state=(stage,settings=null)=>{
    const observation=inspect(target.repo,root,target.head),entries=tree(join(root,'node_modules'));
    const paths=[...new Set(Object.values(plan.environment))];
    const record={stage,target,at:new Date().toISOString(),node:process.version,settings,observation,dependencies:entries,environment:Object.fromEntries(paths.map(p=>[p,tree(p)])),installEnvironment:Object.fromEntries(['cache','temp'].map(k=>{const p=join(resolve(root,'..'),`${i?'new':'old'}-install-${k}`);return [p,tree(p)];}))};
    fs.writeFileSync(join(out,`${i}-${stage}.json.gz`),gzipSync(JSON.stringify(record)),{flag:'wx'});return record;
  };
  state('S1-before-config');
  // Keep actual transient bytes and native paths; wrappers delegate without changing args.
  const originalWrite=fsp.writeFile,originalUnlink=fs.unlink;
  fsp.writeFile=async function(p,data,...args){if(String(p).includes('.vite-temp'))transitions.push({operation:'writeFile',path:String(p),at:new Date().toISOString(),sha256:hash(data),base64:Buffer.from(data).toString('base64')});return originalWrite.call(this,p,data,...args);};
  fs.unlink=function(p,...args){if(String(p).includes('.vite-temp'))transitions.push({operation:'unlink-request',path:String(p),at:new Date().toISOString()});return originalUnlink.call(this,p,...args);};
  let ctx;
  try {
    const {createVitest}=await import(pathToFileURL(require.resolve('vitest/node')).href);
    const {getSuites,getTests}=await import(pathToFileURL(require.resolve('@vitest/runner/utils')).href);
    ctx=await createVitest('test',{root,watch:false,reporters:[]});
    await new Promise(r=>setImmediate(r));
    if(ctx.projects.length!==1)throw Error('unsupported projects');
    const c=ctx.projects[0].config,settings={pool:c.pool,maxWorkers:c.maxWorkers,testTimeout:c.testTimeout,hookTimeout:c.hookTimeout,isolate:c.isolate,fileParallelism:c.fileParallelism??true,environment:c.environment,cache:c.cache,cacheDir:ctx.projects[0].vite.config.cacheDir,setupFiles:c.setupFiles};
    state('S2-config-loaded',settings);
    const collected=await ctx.collect(plan.filters);
    const files=collected.testModules.map(m=>m.task),inventory={tests:getTests(files).map(t=>({id:t.id,name:t.name,file:t.file.filepath,mode:t.mode})),suites:getSuites(files).map(s=>({id:s.id,name:s.name,file:s.file.filepath,mode:s.mode})),unhandledErrors:collected.unhandledErrors};
    write(join(out,`${i}-inventory.json`),inventory);
    state('S3-inventory-collected',settings);
    console.log(JSON.stringify({status:inventory.unhandledErrors.length?'UNKNOWN':'OBSERVED',tests:inventory.tests.length,suites:inventory.suites.length,comparisonSpawns:0}));
  } finally {
    if(ctx)await ctx.close();fsp.writeFile=originalWrite;fs.unlink=originalUnlink;
    write(join(out,`${i}-transient-config.json`),transitions);
    state('post-close');
  }
}
