// Run from the actual snapshot dependency tree; retain full suite states and errors.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { read, digest } from './stage-w1b-preflight.mjs';
const [requestPath]=process.argv.slice(2), req=read(requestPath);
const require=createRequire(join(req.dir,'package.json'));
const {createVitest}=await import(pathToFileURL(require.resolve('vitest/node')).href);
const {getSuites,getTests}=await import(pathToFileURL(require.resolve('@vitest/runner/utils')).href);
let runtime;
const reporter={onTestRunEnd(modules,errors,reason) {
  runtime={runId:req.runId,trialId:req.trialId,preflightSha256:req.preflightSha256,inventorySha256:req.inventorySha256,reason,unhandledErrors:errors.map(e=>({name:String(e.name??''),message:String(e.message??''),type:String(e.type??'')})),suites:getSuites(modules.map(m=>m.task)).map(s=>({id:s.id,file:s.file.filepath,root:s===s.file,mode:s.mode,state:s.result?.state??s.mode}))};
}};
const ctx=await createVitest('test',{root:req.dir,watch:false,reporters:req.mode==='run'?['json',reporter]:[],...(req.mode==='run'?{outputFile:join(req.output,'vitest.json')}:{})});
try {
  if(ctx.projects.length!==1) throw Error('UNKNOWN: multi-project settings unsupported');
  const c=ctx.projects[0].config;
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const npmExec=args=>process.platform==='win32'?execFileSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c',`${npm} ${args.join(' ')}`],{encoding:'utf8'}).trim():execFileSync(npm,args,{encoding:'utf8'}).trim();
  const settings={pool:c.pool,maxWorkers:c.maxWorkers,testTimeout:c.testTimeout,hookTimeout:c.hookTimeout,isolate:c.isolate,fileParallelism:ctx.config.fileParallelism,environment:c.environment,cache:c.cache,cacheDir:ctx.projects[0].vite.config.cacheDir,setupFiles:c.setupFiles,node:process.version,nodePath:process.execPath,npm:npmExec(['--version']),npmCache:npmExec(['config','get','cache']),TEMP:process.env.TEMP??null,TMP:process.env.TMP??null,cwd:process.cwd(),command:req.command};
  for(const k of ['pool','maxWorkers','testTimeout','cache','cacheDir','npm','npmCache','TEMP','TMP']) if(settings[k]===undefined||settings[k]===null||settings[k]==='') throw Error(`UNKNOWN effective ${k}`);
  if(req.expectedSettings && digest(settings)!==digest(req.expectedSettings)) throw Error('effective configuration changed');
  writeFileSync(join(req.output,'settings.json'),JSON.stringify(settings,null,2));
  if(req.mode==='collect') {
    const collected=await ctx.collect(req.filters);
    if(collected.unhandledErrors.length) throw Error('collection unhandled errors');
    const files=collected.testModules.map(m=>m.task);
    const tests=getTests(files).map(t=>{const ancestors=[];let s=t.suite;while(s){ancestors.unshift(s.name);s=s.suite;}return {file:t.file.filepath,name:[...ancestors,t.name].join(' '),mode:t.mode};});
    const suites=getSuites(files).map(s=>({id:s.id,file:s.file.filepath,mode:s.mode}));
    if(!tests.length) throw Error('empty inventory');
    writeFileSync(join(req.output,'inventory.json'),JSON.stringify({tests,suites},null,2));
  } else {
    await ctx.start(req.filters);
    if(!runtime) throw Error('missing runtime completion evidence');
    writeFileSync(join(req.output,'runtime.json'),JSON.stringify(runtime,null,2));
  }
} finally {await ctx.close();}
