/** Bounded serial A/B/C comparison using the existing #210 fixtures, #204 quality
 * reference, #206 proof/verifier and pairedSelfPlayMatch. Outputs never overwrite. */
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cpus, platform, release } from 'node:os';
import * as engine from '../src/domain/shogi/twoPlyAlphaBetaAi';
import type { BoardState } from '../src/types/shogi';
import { createInitialBoardState } from '../src/types/shogi';
import { getLegalActions, executeLegalAction } from '../src/domain/shogi/legalActions';
import { evaluateSearchPositionBreakdown } from '../src/domain/shogi/twoPlyMinimaxAi';
import { SearchDiagnostics } from '../src/domain/shogi/searchDiagnostics';
import { runPairedSelfPlayMatch } from '../src/domain/shogi/pairedSelfPlayMatch';
import { exchangePositions } from './benchmarks/exchangePositions';
import { constructed, tacticalPositions } from './benchmarks/tacticalPositions';
import { qualityPositions, qualityReference, qualityClassify } from './benchmarks/tacticalQuality';
import { prove, digest, type Request } from './benchmarks/outcomeProof';
import { verifyProof } from './benchmarks/verifyOutcomeProof';
const BASE='0dd33ebe9791b2e14abdbbf6ae549c1257d97041';
const [mode, pathArg] = process.argv.slice(2), dir=resolve(pathArg??'.');
const json=(x:unknown)=>JSON.stringify(x,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?String(v):v);
const parse=(s:string)=>JSON.parse(s,(_k,v)=>v==='Infinity'?Infinity:v==='-Infinity'?-Infinity:v);
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const sources=['src/domain/shogi/quiescenceSearch.ts','src/domain/shogi/quietPromotionSelection.ts',
  'src/domain/shogi/twoPlyAlphaBetaAi.ts','src/domain/shogi/searchDiagnostics.ts','src/domain/shogi/index.ts',
  'src/test/shogi-selective-promotions.test.ts','scripts/measure-selective-promotions.ts',
  'scripts/benchmarks/exchangePositions.ts','scripts/benchmarks/tacticalQuality.ts',
  'scripts/benchmarks/outcomeProof.ts','scripts/benchmarks/verifyOutcomeProof.ts'];
const opts=(variant:string):engine.AlphaBetaSearchOptions=>({moveOrdering:'standard',killerMoves:false,
  usePreviousIterationPv:false,useTranspositionTable:false,quiescence:{maxTacticalDepth:1,moveOrdering:'original',maxCheckEvasionExtensions:0,
    ...(variant==='B'?{includeQuietPromotions:true}:variant.startsWith('C')?{selectiveQuietPromotions:{maxCandidates:Number(variant.slice(1))}}:{includeQuietPromotions:false})}});
function auditResult(state:BoardState,r:ReturnType<typeof engine.analyzeAlphaBetaSearch>|ReturnType<typeof engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>) {
  assert.ok(getLegalActions(state).some(a=>json(a)===json(r.selectedAction)));
  let leaf=state;
  for(const action of r.principalVariation) {
    assert.ok(getLegalActions(leaf).some(a=>json(a)===json(action)));
    const next=executeLegalAction(leaf,action);assert.equal(next.type,'applied');if(next.type==='applied')leaf=next.state;
  }
  if(r.evaluationBreakdown) assert.deepEqual(r.evaluationBreakdown,evaluateSearchPositionBreakdown(leaf,state.turn));
}
if(mode==='prepare') {
  mkdirSync(dir,{recursive:false});
  const archive=execFileSync('git',['archive',BASE,'src'],{maxBuffer:20*1024*1024});
  writeFileSync(resolve(dir,'baseline-src.tar.gz'),gzipSync(archive));
  const sourceHashes=Object.fromEntries(sources.map(f=>{const b=readFileSync(f);writeFileSync(resolve(dir,f.replaceAll('/','__')+'.gz'),gzipSync(b));return[f,hash(b)];}));
  const extra=[
    {id:'unsafe-pawn',state:constructed('unsafe-pawn',[[8,8,'king','sente'],[0,8,'king','gote'],[3,4,'pawn','sente'],[1,4,'gold','gote']]),reason:'q1 unsafe promotion; immediate recapture'},
    {id:'minor-safe',state:constructed('minor-safe',[[8,8,'king','sente'],[0,8,'king','gote'],[3,4,'pawn','sente']]),reason:'safe minor promotion'},
  ];
  const initial=createInitialBoardState();initial.recordId='selective-hirate';
  const p=exchangePositions(), quality=qualityPositions();
  const plan={version:1,base:BASE,sourceHashes,archiveHash:hash(archive),createdAt:new Date().toISOString(),
    globalMs:900000,maxBytes:40*1024*1024,reserveBytes:256*1024,perTaskMs:30000,
    performance:p,pilotCaps:[1,2,4],mainVariants:['A','B','C1'],fixedDepths:[1,4],timedMs:[100,1000],warmups:1,repeats:3,
    selectionReason:'C1 fixed before timing: smallest cap retaining the known evasion regression and safe/unsafe promotion tests. C2/C4 exploratory only; no post-hoc validation tuning.',
    quality,local:[...p.filter(x=>x.id.includes('evasion-promotion')||x.id==='exchange-chain'||x.id==='promotion-capture'),...extra],
    matches:[{id:'hirate',state:initial},{id:'hirate-exchange',state:quality.find(p=>p.id==='hirate-exchange')!.state},{id:'evasion',state:p.find(p=>p.id==='evasion-promotion')!.state}],
    matchConditions:[{limit:100,maxPlies:120,starts:['hirate','hirate-exchange','evasion']},{limit:1000,maxPlies:80,starts:['hirate','evasion']}],
    proofLimits:{depth:5,nodes:6000,milliseconds:1500,bytes:1024*1024},
    nodeCounters:'Engine counters are completed work only; diagnostics include attempted work. Timings OFF in main; selection time/counts in separate probes, not comparable as identical work to interrupted main samples.'};
  writeFileSync(resolve(dir,'plan.json'),json(plan)+'\n',{flag:'wx'});
  console.log(json({prepared:dir,planHash:hash(json(plan)+'\n')}));
} else if(mode==='child') {
  const plan=parse(readFileSync(resolve(dir,'plan.json'),'utf8'));
  const baseline:typeof engine=await import(pathToFileURL(resolve('.diagnostic-temp/selective-baseline/src/domain/shogi/twoPlyAlphaBetaAi.ts')).href);
  const send=(x:unknown)=>process.send?.(JSON.parse(json(x)));
  const began=performance.now();
  const task=<T>(meta:Record<string,unknown>,f:()=>T):T=>{assert.ok(performance.now()-began<plan.globalMs-1000);send({type:'started',...meta});const r=f();send({type:'record',...meta,data:r});return r;};
  for(const p of plan.performance) for(const variant of ['A','B']) task({stage:'compatibility',id:p.id,variant},()=>{
    const a=engine.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,opts(variant));
    const b=baseline.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,opts(variant));
    const strip=({elapsedMilliseconds:_ms,...r}:typeof a)=>r;assert.deepEqual(strip(a),strip(b));return{passed:true};
  });
  const sample=(stage:string,p:{id:string;state:BoardState},variant:string,limit:number|null,depth:number,run:number,diagnostic=false)=>task({stage,id:p.id,variant,limit,depth,run,phase:run===0?'warmup':'measurement'},()=>{
    const saved=json(p.state), diag=diagnostic?new SearchDiagnostics():undefined;
    const start=performance.now();
    const result=limit===null?engine.analyzeAlphaBetaSearch(p.state,depth,undefined,undefined,opts(variant),diag)
      :engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(p.state,depth,limit,undefined,()=>performance.now(),opts(variant),diag);
    const actualMs=performance.now()-start;
    auditResult(p.state,result);assert.equal(json(p.state),saved);
    return {actualMs,overrunMs:limit===null?null:Math.max(0,actualMs-limit),result,
      selection:diag?{...diag.quietPromotions,...diag.phases['q-select-promotions']}:null};
  });
  for(const p of plan.performance) for(const limit of [null,100]) for(let run=0;run<2;run++) {
    const vs=run%2?['C4','C2','C1']:['C1','C2','C4'];for(const v of vs)sample('pilot',p,v,limit,limit===null?1:4,run);
  }
  for(const p of plan.performance) for(const depth of plan.fixedDepths) for(let run=0;run<2;run++) {
    const vs=run%2?['C1','B','A']:['A','B','C1'];for(const v of vs)sample('performance',p,v,null,depth,run);
  }
  for(const p of plan.performance) for(const limit of plan.timedMs) for(let run=0;run<=plan.repeats;run++) {
    const offset=run%3,vs=[...plan.mainVariants.slice(offset),...plan.mainVariants.slice(0,offset)];
    for(const v of run%2?vs.reverse():vs)sample('performance',p,v,limit,4,run);
  }
  // Instrumentation separated from main timing: same fixed d1 plus timed probes.
  for(const p of plan.performance) for(const limit of [null,100,1000]) for(const variant of plan.mainVariants) sample('diagnostic',p,variant,limit,limit===null?1:4,1,true);
  for(const p of plan.local) for(const depth of [1,2]) for(const variant of plan.mainVariants)sample('local',p,variant,null,depth,1);
  for(const p of plan.quality) task({stage:'quality',id:p.id},()=>{
    const reference=qualityReference(p,3,6000);
    const rows=plan.mainVariants.map((variant:string)=>{
      const result=engine.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,opts(variant));auditResult(p.state,result);
      return {variant,result,classification:qualityClassify(p,reference,result)};
    });return {reference,rows};
  });
  for(const p of plan.local.filter((p:{id:string})=>p.id.includes('evasion-promotion'))) for(const variant of ['A','C1'])task({stage:'proof',id:p.id,variant},()=>{
    const selected=engine.analyzeAlphaBetaSearch(p.state,1,undefined,undefined,opts(variant)).selectedAction;
    const request:Request={state:p.state,candidate:selected,perspective:p.state.turn,source:{sha:BASE,filesHash:hash(json(plan.sourceHashes))},limits:plan.proofLimits,order:'forward'};
    const requestHash=digest(request),result=prove(request);const verification=result.certificate?verifyProof(result.certificate,requestHash):null;
    if(verification) assert.ok(verification.valid);return {requestHash,request,result,verification};
  });
  for(const c of plan.matchConditions) for(const id of c.starts) {
    const p=plan.matches.find((p:{id:string})=>p.id===id)!;
    task({stage:'match',id,limit:c.limit,maxPlies:c.maxPlies},()=>{
      const participant=(variant:string)=>({settings:opts(variant),search:(state:BoardState,options:engine.AlphaBetaSearchOptions)=>{
        const start=performance.now();const r=engine.analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state,4,c.limit,undefined,()=>performance.now(),options);
        return {...r,actualElapsedMilliseconds:performance.now()-start};}});
      const result=runPairedSelfPlayMatch({initialState:p.state,a:participant('A'),b:participant('C1'),maxPlies:c.maxPlies});
      for(const g of result.games) {assert.notEqual(g.result.status,'failed',json(g.result));let state=p.state;for(const ply of g.result.plies) {
        assert.ok(getLegalActions(state).some(a=>json(a)===json(ply.action)));const next=executeLegalAction(state,ply.action);assert.equal(next.type,'applied');if(next.type==='applied')state=next.state;
      }assert.deepEqual(state,g.result.finalState);}
      return result;
    });
  }
  send({type:'end',at:new Date().toISOString()});
} else if(mode==='run') {
  const planBytes=readFileSync(resolve(dir,'plan.json')),plan=parse(planBytes.toString());
  for(const [f,h] of Object.entries(plan.sourceHashes))assert.equal(hash(readFileSync(f)),h,'source changed since prepare: '+f);
  const files=readdirSync(dir);let bytes=files.reduce((n,f)=>n+statSync(resolve(dir,f)).size,0);
  const fd=openSync(resolve(dir,'raw.jsonl'),'wx');let stopped=false,ended=false,pending:unknown=null,stderr='';
  const emit=(x:unknown,reserved=false)=>{const line=json(x)+'\n';assert.ok(bytes+Buffer.byteLength(line)<=plan.maxBytes-(reserved?0:plan.reserveBytes),'storage budget');writeSync(fd,line);bytes+=Buffer.byteLength(line);};
  emit({type:'environment',planHash:hash(planBytes),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}),node:process.version,cpu:cpus()[0]?.model,os:`${platform()} ${release()}`,at:new Date().toISOString()});
  const child=fork(fileURLToPath(import.meta.url),['child',dir],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
  const stop=(reason:string)=>{if(stopped)return;stopped=true;emit({type:'failure',reason,pending},true);child.kill('SIGKILL');};
  let watchdog=setTimeout(()=>stop('startup timeout'),plan.perTaskMs);
  const global=setTimeout(()=>stop('global time budget'),plan.globalMs);
  child.stderr?.on('data',d=>{stderr=(stderr+String(d)).slice(-32000);});
  child.on('message',(raw:unknown)=>{if(stopped)return;const m=raw as {type:string;stage?:string};clearTimeout(watchdog);
    try{emit(m);}catch{stop('storage budget');return;}
    pending=m.type==='started'?m:null;
    if(m.type==='end')ended=true;
    watchdog=setTimeout(()=>stop('task watchdog'),m.stage==='match'?200000:plan.perTaskMs);
  });
  await new Promise<void>((done,reject)=>{child.on('error',e=>{stop('spawn: '+e.message);});child.on('exit',(code,signal)=>{
    clearTimeout(global);clearTimeout(watchdog);emit({type:'exit',code,signal,stderr,ended,bytesBeforeExit:bytes,at:new Date().toISOString()},true);closeSync(fd);
    console.log(json({ended,code,bytes}));if(!ended||code!==0)reject(Error('incomplete run; raw retained'));else done();});});
} else if(mode==='audit') {
  const prior=readdirSync(dir).includes('manifest.json')?parse(readFileSync(resolve(dir,'manifest.json'),'utf8')):null;
  if(prior)for(const [f,h] of Object.entries(prior))assert.equal(hash(readFileSync(resolve(dir,f))),h,'manifest mismatch: '+f);
  const planBytes=readFileSync(resolve(dir,'plan.json')),plan=parse(planBytes.toString());
  const raw=readFileSync(resolve(dir,'raw.jsonl'),'utf8').trim().split('\n').map(parse);
  assert.equal(raw[0].planHash,hash(planBytes));assert.equal(raw.at(-1).code,0);assert.ok(raw.at(-1).ended);
  assert.equal(raw.filter(x=>x.type==='failure').length,0);assert.equal(raw.filter(x=>x.type==='end').length,1);
  for(const [f,h] of Object.entries(plan.sourceHashes))assert.equal(hash(gunzipSync(readFileSync(resolve(dir,f.replaceAll('/','__')+'.gz')))),h);
  assert.equal(hash(gunzipSync(readFileSync(resolve(dir,'baseline-src.tar.gz')))),plan.archiveHash);
  const rows=raw.filter(x=>x.type==='record'),performanceRows=rows.filter(x=>x.stage==='performance');
  assert.equal(rows.filter(x=>x.stage==='compatibility'&&x.data.passed).length,20);
  const expectedPerformance=plan.performance.length*3*(plan.fixedDepths.length*2+plan.timedMs.length*4);
  assert.equal(performanceRows.length,expectedPerformance);
  for(const stage of ['performance','pilot','diagnostic','local'])for(const r of rows.filter(x=>x.stage===stage)) {
    const p=[...plan.performance,...plan.local].find(p=>p.id===r.id)!;auditResult(p.state,r.data.result);
  }
  for(const p of plan.performance)for(const [limit,depth,runs] of [[null,1,2],[null,4,2],[100,4,4],[1000,4,4]] as const)for(const v of plan.mainVariants) {
    assert.deepEqual(performanceRows.filter(r=>r.id===p.id&&r.limit===limit&&r.depth===depth&&r.variant===v).map(r=>r.run).sort(),Array.from({length:runs},(_,i)=>i));
  }
  for(const row of rows.filter(x=>x.stage==='proof')) if(row.data.result.certificate)assert.ok(verifyProof(row.data.result.certificate,row.data.requestHash).valid);
  const summary=[];
  for(const stage of ['pilot','performance','diagnostic'])for(const condition of ['d1','d4','100ms','1000ms'])for(const variant of stage==='pilot'?['C1','C2','C4']:plan.mainVariants) {
    const ss=rows.filter(r=>r.stage===stage&&r.phase==='measurement'&&r.variant===variant&&(r.limit===null?'d'+r.depth:r.limit+'ms')===condition);
    if(!ss.length)continue;
    const result=(s:typeof ss[number])=>s.data.result;
    summary.push({stage,condition,variant,n:ss.length,actualMs:ss.reduce((n,s)=>n+s.data.actualMs,0),maxOverrunMs:Math.max(...ss.map(s=>s.data.overrunMs??0)),
      completedDepth:ss.reduce((n,s)=>n+(result(s).completedDepth??result(s).depth),0),normal:ss.reduce((n,s)=>n+result(s).visitedPositionCount,0),q:ss.reduce((n,s)=>n+result(s).quiescenceVisitedPositionCount,0),
      sources:Object.fromEntries(['completed-iteration','partial-root','fallback'].map(k=>[k,ss.filter(s=>result(s).resultSource===k).length])),
      selection:ss[0].data.selection?{considered:ss.reduce((n,s)=>n+s.data.selection.considered,0),added:ss.reduce((n,s)=>n+s.data.selection.added,0),milliseconds:ss.reduce((n,s)=>n+s.data.selection.milliseconds,0)}:null});
  }
  const pairs=plan.timedMs.flatMap((limit:number)=>['B','C1'].map(variant=>{
    const ss=performanceRows.filter(r=>r.limit===limit&&r.variant===variant&&r.phase==='measurement');
    const deltas=ss.map(s=>{const a=performanceRows.find(r=>r.limit===limit&&r.variant==='A'&&r.run===s.run&&r.id===s.id)!;return{id:s.id,run:s.run,depth:s.data.result.completedDepth-a.data.result.completedDepth,actionChanged:json(s.data.result.selectedAction)!==json(a.data.result.selectedAction)};});
    return{limit,variant,better:deltas.filter(d=>d.depth>0).length,worse:deltas.filter(d=>d.depth<0).length,same:deltas.filter(d=>d.depth===0).length,deltas};
  }));
  const quality=rows.filter(r=>r.stage==='quality').map(r=>({id:r.id,referenceStopped:r.data.reference.stopped,rows:r.data.rows.map((x:{variant:string;classification:unknown})=>({variant:x.variant,classification:x.classification}))}));
  const matches=rows.filter(r=>r.stage==='match').map(r=>({id:r.id,limit:r.limit,summary:r.data.summary,games:r.data.games.map((g:{outcome:string;result:{plies:unknown[];status:string;gameResult?:unknown}})=>({outcome:g.outcome,status:g.result.status,plies:g.result.plies.length,result:g.result.gameResult??null}))}));
  assert.equal(quality.length,plan.quality.length);assert.equal(matches.length,5);
  const report={complete:true,baseline:BASE,summary,pairs,quality,matches,proofs:rows.filter(r=>r.stage==='proof').map(r=>({id:r.id,variant:r.variant,status:r.data.result.status,stops:r.data.result.stops,verified:r.data.verification}))};
  writeFileSync(resolve(dir,'summary.json'),json(report)+'\n');
  const lines=['# 保存rawから再集計したA/B/C比較','',`基準 ${BASE}。C1はmaxCandidates=1、計測前固定。全${performanceRows.length} performance呼出し。`,'',
    '|段階|条件|方式|n|API合計ms|最大超過ms|深さ合計|通常/qノード|対象/追加候補|選別ms|','|---|---|---|---:|---:|---:|---:|---|---|---:|'];
  for(const s of summary)lines.push(`|${s.stage}|${s.condition}|${s.variant}|${s.n}|${s.actualMs.toFixed(3)}|${s.maxOverrunMs.toFixed(3)}|${s.completedDepth}|${s.normal}/${s.q}|${s.selection?s.selection.considered+'/'+s.selection.added:'別診断参照'}|${s.selection?.milliseconds.toFixed(3)??'別診断参照'}|`);
  lines.push('','|ms|方式|A比 深さ改善/悪化/同じ|','|---|---|---|');for(const p of pairs)lines.push(`|${p.limit}|${p.variant}|${p.better}/${p.worse}/${p.same}|`);
  lines.push('','対局: A=OFF、B参加者=選択C1。規則上の引分とmax_plies打切りは別。','',...matches.map(m=>json(m)),'','品質（有限参照・勝敗証明と別）:','',...quality.map(q=>json({id:q.id,stopped:q.referenceStopped,classes:q.rows.map((r:{variant:string;classification:{quality:string}})=>[r.variant,r.classification.quality])})));
  writeFileSync(resolve(dir,'results.md'),lines.join('\n')+'\n');
  const manifest=Object.fromEntries(readdirSync(dir).filter(f=>f!=='manifest.json').sort().map(f=>[f,hash(readFileSync(resolve(dir,f)))]));
  const manifestBytes=json(manifest)+'\n';assert.ok(readdirSync(dir).filter(f=>f!=='manifest.json').reduce((n,f)=>n+statSync(resolve(dir,f)).size,Buffer.byteLength(manifestBytes))<=plan.maxBytes);
  writeFileSync(resolve(dir,'manifest.json'),manifestBytes);console.log(json({valid:true,rows:rows.length,performance:performanceRows.length,summaryHash:hash(json(report)+'\n')}));
} else throw Error('prepare|run|audit NEW_DIR');
