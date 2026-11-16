import fs,{promises as fsp} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {hash,read,inspect} from './stage-w1b-preflight.mjs';
import {inventory,saveState} from './stage-w1e-observation.mjs';
const [mode,planArg,outArg,indexArg]=process.argv.slice(2),plan=read(resolve(planArg)),out=resolve(outArg);
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
if(mode==='parent') {
  fs.mkdirSync(out);write(join(out,'plan.json'),plan);
  for(let i=0;i<2;i++) {
    const r=spawnSync(process.execPath,[resolve(process.argv[1]),'child',resolve(planArg),out,String(i)],{cwd:plan.targets[i].dir,env:{...process.env,...plan.environments[i]},encoding:'utf8',maxBuffer:64*1024*1024});
    write(join(out,`${i}-cli.json`),{exitCode:r.status,signal:r.signal,error:r.error?.message??null,stdout:r.stdout,stderr:r.stderr});if(r.status!==0)process.exitCode=1;
  }
} else {
  const i=Number(indexArg),t=plan.targets[i],root=t.dir,env=plan.environments[i],require=createRequire(join(root,'package.json')),events=[],originals=[],start=performance.now();let stage='S1',busy=false,ctx;
  const roots={dependencies:join(root,'node_modules'),temp:env.TEMP,cache:env.npm_config_cache};
  const inside=p=>{const s=resolve(String(p));return [env.TEMP,join(root,'node_modules','.vite-temp')].some(r=>s===r||s.startsWith(r+'\\')||s.startsWith(r+'/'));};
  function capture(p,operation) {
    if(busy||!inside(p))return;busy=true;
    try {const path=resolve(String(p)),s=fs.existsSync(path)?fs.lstatSync(path):null;events.push({operation,path,stage,at:new Date().toISOString(),pid:process.pid,attribution:'direct API invocation in instrumented process; does not attribute other processes',stack:new Error().stack,entries:s?.isDirectory()?inventory(path,true):s?.isFile()?[{absolute:path,type:'file',size:s.size,sha256:hash(fs.readFileSync(path)),base64:fs.readFileSync(path).toString('base64')}]:[],missing:!s});}catch(e){events.push({operation,path:String(p),error:String(e),status:'UNKNOWN'});}finally{busy=false;}
  }
  for(const [object,names] of [[fs,['rmSync','unlinkSync','rmdirSync','writeFileSync','mkdirSync']],[fsp,['rm','unlink','rmdir','writeFile','mkdir']],[fs,['rm','unlink','rmdir','writeFile','mkdir']]])for(const name of names){const original=object[name];originals.push(()=>object[name]=original);object[name]=function(p,...args){capture(p,'before-'+name);if(!name.endsWith('Sync')&&object===fs){const cb=args.at(-1);if(typeof cb==='function')args[args.length-1]=function(...v){capture(p,'after-'+name);return cb.apply(this,v);};return original.call(this,p,...args);}const result=original.call(this,p,...args);if(result?.then)return result.then(v=>{capture(p,'after-'+name);return v;});capture(p,'after-'+name);return result;};}
  const state=(name,extra={})=>saveState(out,`${i}-${name}`,roots,{stage:name,target:t,observation:inspect(t.repo,root,t.head),node:{version:process.version,executable:fs.realpathSync(process.execPath),sha256:hash(fs.readFileSync(process.execPath)),cwd:process.cwd()},...extra});
  // Serialize the complete resolved configs, including function source and explicit cycles.
  const serial=(value,seen=new Map(),path='$')=>{if(typeof value==='function')return {functionSource:String(value)};if(value instanceof RegExp)return {regexp:String(value)};if(value===undefined)return {undefined:true};if(!value||typeof value!=='object')return typeof value==='bigint'?String(value):value;if(seen.has(value))return {ref:seen.get(value)};seen.set(value,path);return Array.isArray(value)?value.map((v,j)=>serial(v,seen,`${path}[${j}]`)):Object.fromEntries(Object.keys(value).sort().map(k=>[k,serial(value[k],seen,`${path}.${k}`)]));};
  try {
    state('S1');const {createVitest}=await import(pathToFileURL(require.resolve('vitest/node')).href);const {getTests,getSuites}=await import(pathToFileURL(require.resolve('@vitest/runner/utils')).href);
    ctx=await createVitest('test',{root,watch:false,reporters:[]});if(ctx.projects.length!==1)throw Error('unsupported projects');stage='S2';
    const c=ctx.projects[0].config,settings={pool:c.pool,maxWorkers:c.maxWorkers,testTimeout:c.testTimeout,environment:c.environment,setupFiles:c.setupFiles,cache:c.cache,cacheDir:ctx.projects[0].vite.config.cacheDir};
    state('S2',{settings,fullConfig:serial({vitest:c,vite:ctx.projects[0].vite.config})});
    const collected=await ctx.collect(plan.filters),files=collected.testModules.map(m=>m.task);stage='S3';
    const items={tests:getTests(files).map(t=>({id:t.id,name:t.name,file:t.file.filepath,mode:t.mode})),suites:getSuites(files).map(t=>({id:t.id,name:t.name,file:t.file.filepath,mode:t.mode})),unhandledErrors:serial(collected.unhandledErrors)};
    write(join(out,`${i}-inventory.json`),items);state('S3',{settings});
  } finally {
    stage='close';const cleanupErrors=[];
    try {if(ctx)await ctx.close();}catch(e){cleanupErrors.push({operation:'ctx.close',error:String(e)});process.exitCode=1;}
    try {state('close',{cleanupErrors});}catch(e){cleanupErrors.push({operation:'close inventory',error:String(e)});process.exitCode=1;}
    finally {
      for(const restore of originals.reverse())restore();
      write(join(out,`${i}-events.json`),{events,cleanupErrors,interference:{elapsedMs:performance.now()-start,memory:process.memoryUsage(),wrappers:'sync, callback and promises fs APIs in this process only; recursive pre-delete byte reads; no worker/native/OS interception',limits:'unobserved actors and between-snapshot changes UNKNOWN; hard process termination may lose in-memory events; no performance equivalence claim'},comparisonSpawns:0});
    }
  }
}
