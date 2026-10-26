/** Serial bounded experiment. prepare/run/audit never writes previous experiments. */
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cpus, platform } from 'node:os';
import * as engine from '../src/domain/shogi/twoPlyAlphaBetaAi';
import type { BoardState } from '../src/types/shogi';
import { createInitialBoardState } from '../src/types/shogi';
import { getLegalActions, executeLegalAction } from '../src/domain/shogi/legalActions';
import { evaluateSearchPositionBreakdown, type SearchEvaluationConfig } from '../src/domain/shogi/twoPlyMinimaxAi';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { createTranspositionTableStatistics } from '../src/domain/shogi/transpositionTable';
import { runPairedSelfPlayMatch } from '../src/domain/shogi/pairedSelfPlayMatch';
import { pieceSafetyPositions } from './benchmarks/pieceSafetyPositions';
import { tacticalPositions, type TacticalPosition } from './benchmarks/tacticalPositions';
import { qualityReference, qualityClassify } from './benchmarks/tacticalQuality';
import { validatePosition } from './benchmarks/tacticalDiagnostics';
const BASE='e2f12e97f2d2c297b3b2ac5648bbfb12dc53faad';
const [mode,pathArg]=process.argv.slice(2),dir=resolve(pathArg??'.');
const json=(x:unknown)=>JSON.stringify(x,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v);
const parse=(s:string)=>JSON.parse(s,(_k,v)=>v==='Infinity'?Infinity:v==='-Infinity'?-Infinity:v);
const hash=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
const config=(v:string):SearchEvaluationConfig=>({pieceSafetyMode:v==='A'?'legacy':'experimental'});
const opts:engine.AlphaBetaSearchOptions={moveOrdering:'standard',killerMoves:false,usePreviousIterationPv:false,useTranspositionTable:false,
  quiescence:{maxTacticalDepth:1,moveOrdering:'original',includeQuietPromotions:false,maxCheckEvasionExtensions:0}};
type Result=ReturnType<typeof engine.analyzeAlphaBetaSearch>|ReturnType<typeof engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>;
function auditResult(state:BoardState,r:Result,variant:string) {
  if(r.selectedAction)assert.ok(getLegalActions(state).some(a=>json(a)===json(r.selectedAction)));
  let leaf=state;
  for(const a of r.principalVariation){assert.ok(getLegalActions(leaf).some(b=>json(a)===json(b)));const n=executeLegalAction(leaf,a);assert.equal(n.type,'applied');if(n.type==='applied')leaf=n.state;}
  if(r.evaluationBreakdown){assert.deepEqual(r.evaluationBreakdown,evaluateSearchPositionBreakdown(leaf,state.turn,config(variant)));assert.equal(r.selectedEvaluation,r.evaluationBreakdown.total);}
}
const sources=['src/domain/shogi/undefendedPieceSafetyEvaluation.ts','src/domain/shogi/twoPlyMinimaxAi.ts','src/domain/shogi/twoPlyAlphaBetaAi.ts',
  'scripts/measure-piece-safety.ts','scripts/benchmarks/pieceSafetyPositions.ts','scripts/benchmarks/tacticalQuality.ts','src/test/shogi-piece-safety-experiment.test.ts'];
if(mode==='prepare'){
  mkdirSync(dir,{recursive:false});
  const ps=pieceSafetyPositions(),performance=ps;
  const quality:TacticalPosition[]=ps.map(p=>({...p,purpose:'piece safety bounded reference',referenceWinner:p.state.turn,referenceDepth:3,expectation:'avoid-loss'}));
  quality.forEach(validatePosition);
  const initial=createInitialBoardState();initial.recordId='piece-safety-hirate';
  const replay=tacticalPositions().find(p=>p.id==='hirate-exchange')!.state;
  const hashes=Object.fromEntries(sources.map(f=>{const b=readFileSync(f);writeFileSync(resolve(dir,f.replaceAll('/','__')+'.gz'),gzipSync(b));return[f,hash(b)];}));
  const archive=execFileSync('git',['archive',BASE,'src'],{maxBuffer:30*1024*1024});writeFileSync(resolve(dir,'baseline-src.tar.gz'),gzipSync(archive));
  const tasks:Record<string,unknown>[]=[];
  for(const p of performance)tasks.push({stage:'compatibility',id:p.id});
  for(const p of performance)for(const condition of ['d1','d3','100ms','1000ms'])for(let run=0;run<=3;run++)for(const variant of run%2?['B','A']:['A','B'])tasks.push({stage:'performance',id:p.id,condition,run,variant});
  for(const p of performance)for(const variant of ['A','B'])tasks.push({stage:'diagnostic',id:p.id,condition:'d1',run:1,variant});
  for(const p of quality)tasks.push({stage:'reference',id:p.id});
  for(const limit of [100,1000])for(const id of limit===100?['hirate','replay','evasion']:['hirate','replay'])tasks.push({stage:'match',id,limit,maxPlies:120});
  const plan={base:BASE,createdAt:new Date().toISOString(),hashes,archiveHash:hash(archive),globalMs:900000,maxBytes:64*1024*1024,reserveBytes:256*1024,taskMs:30000,
    performance,quality,tasks,opts,matches:[{id:'hirate',state:initial},{id:'replay',state:replay},{id:'evasion',state:ps.find(p=>p.id==='evasion-promotion')!.state}]};
  writeFileSync(resolve(dir,'plan.json'),json(plan)+'\n',{flag:'wx'});console.log(json({prepared:dir,tasks:tasks.length,positions:performance.length}));
}else if(mode==='child'){
  const plan=parse(readFileSync(resolve(dir,'plan.json'),'utf8'));
  const baseline:typeof engine=await import(pathToFileURL(resolve('.diagnostic-temp/piece-safety-baseline/src/domain/shogi/twoPlyAlphaBetaAi.ts')).href);
  const send=(x:unknown)=>process.send?.(JSON.parse(json(x))); // Keep non-finite values as strings through JSON IPC.
  for(let index=0;index<plan.tasks.length;index++){
    const t=plan.tasks[index];send({type:'started',index,task:t});let data:unknown;
    const p=plan.performance.find((p:{id:string})=>p.id===t.id);
    if(t.stage==='compatibility'){
      const strip=({elapsedMilliseconds:_ms,...r}:Result)=>r;
      const old=baseline.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,opts);
      const omitted=engine.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,opts);
      const explicit=engine.analyzeAlphaBetaSearch(p.state,1,config('A'),undefined,opts);
      assert.deepEqual(strip(old),strip(omitted));assert.deepEqual(strip(old),strip(explicit));
      const oldStats=createTranspositionTableStatistics(),newStats=createTranspositionTableStatistics();
      const oldTt=baseline.analyzeAlphaBetaSearch(p.state,2,undefined,undefined,{...opts,useTranspositionTable:true,transpositionTableStatistics:oldStats});
      const newTt=engine.analyzeAlphaBetaSearch(p.state,2,config('A'),undefined,{...opts,useTranspositionTable:true,transpositionTableStatistics:newStats});
      assert.deepEqual(strip(oldTt),strip(newTt));assert.deepEqual(oldStats,newStats);
      data={passed:true,old,explicit,oldTt,newTt,oldStats,newStats};
    }else if(t.stage==='performance'||t.stage==='diagnostic'){
      const diag=t.stage==='diagnostic'?new SearchDiagnostics():undefined,start=performance.now(),before=json(p.state);
      const limit=t.condition.endsWith('ms')?parseInt(t.condition):null;
      const r=limit===null?engine.analyzeAlphaBetaSearch(p.state,Number(t.condition.slice(1)),config(t.variant),undefined,opts,diag)
        :engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(p.state,4,limit,config(t.variant),()=>performance.now(),opts,diag);
      const ms=performance.now()-start;auditResult(p.state,r,t.variant);assert.equal(json(p.state),before);
      data={result:r,actualMs:ms,overrunMs:limit===null?null:Math.max(0,ms-limit),
        diagnostics:diag?{evaluationCalls:diag.phases['normal-evaluate'].calls+diag.phases['q-evaluate'].calls,phases:diag.phases}:null};
    }else if(t.stage==='reference'){
      data=qualityReference(plan.quality.find((p:{id:string})=>p.id===t.id),3,6000);
    }else{
      const state=plan.matches.find((p:{id:string})=>p.id===t.id).state;
      const participant=(variant:string)=>({settings:variant,search:(s:BoardState,v:string)=>{
        const start=performance.now();const r=engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(s,4,t.limit,config(v),()=>performance.now(),opts);
        const actualElapsedMilliseconds=performance.now()-start;
        auditResult(s,r,v);return {...r,actualElapsedMilliseconds};}});
      data=runPairedSelfPlayMatch({initialState:state,a:participant('A'),b:participant('B'),maxPlies:t.maxPlies});
    }
    send({type:'record',index,task:t,data});
  }send({type:'end'});
}else if(mode==='run'){
  const planBytes=readFileSync(resolve(dir,'plan.json')),plan=parse(planBytes.toString());
  for(const [f,h] of Object.entries(plan.hashes))assert.equal(hash(readFileSync(f)),h,'source changed '+f);
  let bytes=readdirSync(dir).reduce((n,f)=>n+statSync(resolve(dir,f)).size,0),stopped=false,ended=false,pending:unknown=null,stderr='';
  const fd=openSync(resolve(dir,'raw.jsonl'),'wx');
  const emit=(x:unknown,reserved=false)=>{const b=json(x)+'\n';assert.ok(bytes+Buffer.byteLength(b)<=plan.maxBytes-(reserved?0:plan.reserveBytes),'storage budget');writeSync(fd,b);bytes+=Buffer.byteLength(b);};
  emit({type:'environment',at:new Date().toISOString(),planHash:hash(planBytes),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cpu:cpus()[0]?.model,node:process.version,os:platform()});
  const child=fork(fileURLToPath(import.meta.url),['child',dir],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
  const stop=(reason:string)=>{if(stopped)return;stopped=true;emit({type:'failure',reason,pending},true);child.kill('SIGKILL');};
  let watchdog=setTimeout(()=>stop('startup timeout'),plan.taskMs);const global=setTimeout(()=>stop('global budget'),plan.globalMs);
  child.stderr?.on('data',b=>{stderr=(stderr+String(b)).slice(-24000);});
  child.on('message',(m:unknown)=>{if(stopped)return;clearTimeout(watchdog);try{emit(m);}catch{stop('capacity budget');return;}const r=m as {type:string;task?:{stage:string}};
    pending=r.type==='started'?m:null;if(r.type==='end')ended=true;watchdog=setTimeout(()=>stop('task watchdog'),r.task?.stage==='match'?260000:plan.taskMs);});
  await new Promise<void>(done=>{child.on('error',e=>stop('spawn '+e.message));child.on('exit',(code,signal)=>{clearTimeout(global);clearTimeout(watchdog);
    emit({type:'exit',code,signal,ended,stderr,at:new Date().toISOString()},true);closeSync(fd);console.log(json({ended,code,bytes}));if(!ended||code!==0)process.exitCode=1;done();});});
}else if(mode==='audit'){
  if(readdirSync(dir).includes('manifest.json'))for(const [f,h] of Object.entries(parse(readFileSync(resolve(dir,'manifest.json'),'utf8'))))assert.equal(hash(readFileSync(resolve(dir,f))),h,'manifest mismatch: '+f);
  const planBytes=readFileSync(resolve(dir,'plan.json')),plan=parse(planBytes.toString()),raw=readFileSync(resolve(dir,'raw.jsonl'),'utf8').trim().split('\n').map(parse);
  assert.equal(hash(planBytes),raw[0].planHash);
  for(const [f,h] of Object.entries(plan.hashes))assert.equal(hash(gunzipSync(readFileSync(resolve(dir,f.replaceAll('/','__')+'.gz')))),h);
  assert.equal(hash(gunzipSync(readFileSync(resolve(dir,'baseline-src.tar.gz')))),plan.archiveHash);
  const rows=raw.filter(r=>r.type==='record'),indices=new Set(rows.map(r=>r.index));assert.equal(indices.size,rows.length);
  for(const row of rows){assert.deepEqual(row.task,plan.tasks[row.index]);const t=row.task;
    if(t.stage==='performance'||t.stage==='diagnostic')auditResult(plan.performance.find((p:{id:string})=>p.id===t.id).state,row.data.result,t.variant);
    if(t.stage==='compatibility')assert.equal(row.data.passed,true);
    if(t.stage==='match')for(const g of row.data.games){
      let state=plan.matches.find((p:{id:string})=>p.id===t.id).state;
      for(const ply of g.result.plies){const v=g[ply.player];auditResult(state,{...ply,selectedAction:ply.action} as Result,v);
        assert.ok(getLegalActions(state).some(a=>json(a)===json(ply.action)));const n=executeLegalAction(state,ply.action);assert.equal(n.type,'applied');if(n.type==='applied')state=n.state;}
      assert.deepEqual(JSON.parse(json(state)),g.result.finalState);if(g.result.status==='ended')assert.deepEqual(state.result,g.result.gameResult);
    }
  }
  const performanceRows=rows.filter(r=>r.task.stage==='performance'&&r.task.run>0),summary=[];
  for(const condition of ['d1','d3','100ms','1000ms'])for(const variant of ['A','B']){
    const ss=performanceRows.filter(r=>r.task.condition===condition&&r.task.variant===variant);
    summary.push({condition,variant,n:ss.length,ms:ss.reduce((n,s)=>n+s.data.actualMs,0),maxOverrunMs:ss.length?Math.max(...ss.map(s=>s.data.overrunMs??0)):null,
      depth:ss.reduce((n,s)=>n+(s.data.result.completedDepth??s.data.result.depth),0),normal:ss.reduce((n,s)=>n+s.data.result.visitedPositionCount,0),q:ss.reduce((n,s)=>n+s.data.result.quiescenceVisitedPositionCount,0),
      partial:ss.filter(s=>s.data.result.resultSource==='partial-root').length,fallback:ss.filter(s=>s.data.result.resultSource==='fallback').length});
  }
  const quality=rows.filter(r=>r.task.stage==='reference').map(ref=>{
    const p=plan.quality.find((p:{id:string})=>p.id===ref.task.id);
    return {id:p.id,reference:ref.data,rows:performanceRows.filter(r=>r.task.id===p.id).map(r=>({task:r.task,classification:qualityClassify(p,ref.data,r.data.result)}))};
  });
  const differences=performanceRows.filter(r=>r.task.variant==='B').flatMap(b=>{
    const a=performanceRows.find(r=>r.task.variant==='A'&&r.task.id===b.task.id&&r.task.condition===b.task.condition&&r.task.run===b.task.run);
    if(!a)return[];const same=json(a.data.result.selectedAction)===json(b.data.result.selectedAction);
    const p=plan.quality.find((p:{id:string})=>p.id===b.task.id),ref=rows.find(r=>r.task.stage==='reference'&&r.task.id===p.id);
    return[{id:p.id,condition:b.task.condition,run:b.task.run,changed:!same,depthDelta:(b.data.result.completedDepth??b.data.result.depth)-(a.data.result.completedDepth??a.data.result.depth),
      aClass:ref?qualityClassify(p,ref.data,a.data.result):null,bClass:ref?qualityClassify(p,ref.data,b.data.result):null}];
  });
  const missing=plan.tasks.flatMap((task:unknown,index:number)=>indices.has(index)?[]:[{index,task}]);
  const complete=missing.length===0&&raw.at(-1).code===0&&raw.at(-1).ended&&!raw.some(r=>r.type==='failure');
  const result={complete,completed:rows.length,planned:plan.tasks.length,missing,failures:raw.filter(r=>r.type==='failure'||r.type==='exit'),summary,quality,differences,
    matches:rows.filter(r=>r.task.stage==='match').map(r=>({task:r.task,summary:r.data.summary,games:r.data.games.map((g:{outcome:string;result:{status:string;plies:unknown[]}})=>({outcome:g.outcome,status:g.result.status,plies:g.result.plies.length}))})),
    diagnostics:rows.filter(r=>r.task.stage==='diagnostic').map(r=>({task:r.task,data:r.data}))};
  const bytes=json(result)+'\n';
  const retained=readdirSync(dir).filter(f=>f!=='manifest.json'&&f!=='summary.json');
  const manifest=Object.fromEntries([...retained.map(f=>[f,hash(readFileSync(resolve(dir,f)))]),['summary.json',hash(bytes)]].sort((a,b)=>a[0].localeCompare(b[0])));
  const manifestBytes=json(manifest)+'\n';assert.ok(retained.reduce((n,f)=>n+statSync(resolve(dir,f)).size,Buffer.byteLength(bytes)+Buffer.byteLength(manifestBytes))<=plan.maxBytes);
  writeFileSync(resolve(dir,'summary.json'),bytes);writeFileSync(resolve(dir,'manifest.json'),manifestBytes);console.log(json({complete,rows:rows.length,missing:missing.length,summaryHash:hash(bytes)}));
}else throw Error('prepare|run|audit DIR');
