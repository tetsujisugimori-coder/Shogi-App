import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {diagnose,aggregate,limits,settings,rootScore,replay} from './benchmarks/evasionBoundary';
import {json,parse,hash,apply,validatePosition} from './benchmarks/tacticalDiagnostics';
import {getLegalActions} from '../src/domain/shogi/legalActions';
import {compareSearchValues} from '../src/domain/shogi/searchValue';
import {observePv} from './benchmarks/terminalDistanceReference';
import {loadPositions,qualityReference,qualityClassify} from './benchmarks/tacticalQuality';
import {analyzeQuiescenceSearch} from '../src/domain/shogi/quiescenceSearch';
import {evaluateSearchPositionBreakdown} from '../src/domain/shogi/twoPlyMinimaxAi';
import {resolveSearchEvaluationPreset} from '../src/domain/shogi/searchEvaluationPresets';
import type {TacticalPosition} from './benchmarks/tacticalPositions';
import type {Diagnosis} from './benchmarks/evasionBoundary';
const [mode,dir]=process.argv.slice(2);
if(mode==='child') {
 const req=parse(readFileSync(0,'utf8'));
 process.stdout.write(json(diagnose(req.state,req.depth,req.extra,req.candidate,req.limits,{},req.q??1)));
} else {
 assert.ok(dir&&['prepare','run','audit'].includes(mode),'prepare NEW_DIR | run DIR | audit DIR');
 const file=(name:string)=>path.join(dir,name);
 const read=(name:string)=>parse(readFileSync(file(name),'utf8'));
 const write=(name:string,data:unknown)=>writeFileSync(file(name),json(data)+'\n',{flag:'wx'});
 const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
 const bytes=(f:string)=>createHash('sha256').update(readFileSync(f)).digest('hex');
 const old='docs/benchmarks/outcome-proof-20261022/run1';
 if(mode==='prepare') {
  assert.ok(!existsSync(dir)); mkdirSync(dir,{recursive:true});
  const original=parse(readFileSync(`${old}/plan.json`,'utf8'));
  const p=original.positions.find((p:TacticalPosition)=>p.id==='evasion') as TacticalPosition;
  loadPositions([p]); validatePosition(p);
  const prior=parse(readFileSync(`${old}/candidates.json`,'utf8')).filter((c:any)=>c.position==='evasion');
  assert.equal(prior.length,2);
  for(const c of prior) {assert.equal(hash(c.request.state),hash(p.state));assert.equal(c.result.status,'unknown');}
  const previous=parse(readFileSync('docs/benchmarks/tactical-quality-20261022/run1/plan.json','utf8'));
  assert.equal(hash(previous.positions.find((x:TacticalPosition)=>x.id==='evasion')),hash(p));
  const protectedFiles=git('ls-files','docs/benchmarks/outcome-proof-20261022','docs/benchmarks/tactical-quality-20261022').split(/\r?\n/);
  const ref=parse(readFileSync('docs/benchmarks/tactical-quality-20261022/run1/quality-references.json','utf8')).evasion;
  write('input.json',p);
  write('plan.json',{baseSha:'40b811dbaf685cd7fc86a3ef3a1defc5dadf14f0',pr206:{mergedAt:'2026-10-22T07:49:30Z',mergeSha:'40b811dbaf685cd7fc86a3ef3a1defc5dadf14f0'},
   inputHash:hash(p),stateHash:hash(p.state),origin:p.origin,historyLength:p.state.history.length,
   primaryCandidates:prior.map((c:any)=>c.request.candidate),candidates:[...prior.map((c:any)=>c.request.candidate),...getLegalActions(p.state).filter(a=>!prior.some((c:any)=>json(c.request.candidate)===json(a)))],priorOutcomes:prior.map((c:any)=>c.result.status),
   depths:[1,2,3,4],extensions:[0,1,2],settings:settings(0),limits,
   wholeMilliseconds:300000,wholeBytes:41943040,hardCallMilliseconds:12000,
   order:'serial depth, extra, root then candidates in saved #206 order; one call per cell; no repeats/warmups; diagnostic timings only',
   reference:{depth:3,nodes:6000,q:false,method:'existing qualityReference with forward/reverse full width'},
   boundary:{prefixPly:1,replies:prior.map((c:any)=>ref.candidates.find((r:any)=>json(r.action)===json(c.request.candidate)).value.pv[1]),
    conditions:['static','q1 captures/evasions','normal1+q1','forced saved reference reply normal1+q1'],
    limit:'same per-call node/time/trace cap; q1 public uses cooperative time check; boundary exact only if completed'},
   protectedHashes:Object.fromEntries(protectedFiles.map(f=>[f,bytes(f)])),createdAt:new Date().toISOString()});
 } else {
  const plan=read('plan.json'), p=read('input.json') as TacticalPosition;
  assert.equal(hash(p),plan.inputHash); assert.equal(hash(p.state),plan.stateHash); loadPositions([p]);
  if(mode==='run') {
   assert.ok(!existsSync(file('environment.json')),'refuse overwriting measurement');
   assert.equal(git('diff','--name-only'),'','commit code before measuring');
   assert.equal(git('diff','--cached','--name-only'),'');
   const files=git('ls-files','src','scripts','package.json','package-lock.json').split(/\r?\n/).filter(f=>!f.startsWith('src/test/'));
   write('sources.json',Object.fromEntries(files.map(f=>[f,readFileSync(f,'utf8')])));
   write('environment.json',{sourceSha:git('rev-parse','HEAD'),sourceHashes:Object.fromEntries(files.map(f=>[f,bytes(f)])),
    node:process.version,os:`${os.platform()} ${os.release()} ${os.arch()}`,cpu:os.cpus()[0].model,startedAt:new Date().toISOString(),planHash:hash(plan)});
   const began=performance.now(); let totalBytes=0;
   const rows:Diagnosis[]=[];
   for(const depth of plan.depths) for(const extra of plan.extensions) for(const candidate of [null,...plan.candidates]) {
    let row:Diagnosis;
    if(performance.now()-began>=plan.wholeMilliseconds||totalBytes>=plan.wholeBytes) {
     row={...diagnose(p.state,depth,extra,candidate,{...plan.limits,nodes:0}),limitReason:'whole-run-budget'};
    } else {
     try {
      const output=execFileSync(process.execPath,['--import','tsx',path.resolve('scripts/measure-evasion-boundary.ts'),'child'],{
       input:json({state:p.state,depth,extra,candidate,limits:plan.limits}),encoding:'utf8',timeout:Math.min(plan.hardCallMilliseconds,Math.max(1,plan.wholeMilliseconds-(performance.now()-began))),maxBuffer:4194304,windowsHide:true});
      row=parse(output);
     } catch(e) {row={...diagnose(p.state,depth,extra,candidate,{...plan.limits,nodes:0}),limitReason:'parent-hard-stop-or-child-error',error:String(e)};}
    }
    const name=`raw-${rows.length}.json`;write(name,row);totalBytes+=Buffer.byteLength(json(row));rows.push(row);
    console.log(depth,extra,candidate?.to??'root',row.result?.selectedEvaluation??row.limitReason,row.nodes);
   }
   // Existing bounded reference is computed after diagnostic calls, never in parallel.
   write('reference.json',qualityReference(p,plan.reference.depth,plan.reference.nodes));
   const boundary=[];
   for(let i=0;i<plan.primaryCandidates.length;i++) {
    const prefix=plan.candidates[i], state=apply(p.state,prefix), perspective=p.state.turn;
    const staticBreakdown=evaluateSearchPositionBreakdown(state,perspective,resolveSearchEvaluationPreset('standard'));
    let checks=0;const qb=performance.now(); let qr=null,qe=null;
    try {qr=analyzeQuiescenceSearch(state,perspective,1,resolveSearchEvaluationPreset('standard'),()=>{
      if(++checks>plan.limits.nodes||performance.now()-qb>=plan.limits.milliseconds) throw Error('boundary q cap');});}catch(e){qe=String(e);}
    const run=(candidate:any)=>performance.now()-began>=plan.wholeMilliseconds ? null : diagnose(state,1,0,candidate,plan.limits);
    const ordinary=run(null),forced=run(plan.boundary.replies[i]);
    boundary.push({prefix,stateHash:hash(state),staticBreakdown,q:qr,qError:qe,ordinary,forced,
     originalRootScore:ordinary?.result?.selectedEvaluation==null?null:rootScore(ordinary.result.selectedEvaluation,state.turn,perspective),
     ordinaryReplay:ordinary?.result?replay(state,ordinary.result.principalVariation,1,0,1,1,perspective):null,
     forcedReplay:forced?.result?replay(state,forced.result.principalVariation,1,0,1,1,perspective):null});
   }
   write('boundary.json',boundary);
   write('completed.json',{rows:rows.length,finishedAt:new Date().toISOString(),elapsedMs:performance.now()-began});
  }
  const rows=Array.from({length:plan.depths.length*plan.extensions.length*(1+plan.candidates.length)},(_,i)=>read(`raw-${i}.json`)) as Diagnosis[];
  assert.deepEqual(rows.map(r=>[r.requestedDepth,r.extra,r.candidate]),plan.depths.flatMap((d:number)=>plan.extensions.flatMap((e:number)=>[null,...plan.candidates].map(c=>[d,e,c]))));
  const summary=aggregate(p.state,rows), ref=read('reference.json');
  const classifications=rows.filter(r=>r.candidate===null).map(r=>({depth:r.requestedDepth,extra:r.extra,...qualityClassify(p,ref,r.result)}));
  const comparisons=plan.depths.flatMap((depth:number)=>plan.extensions.map((extra:number)=>{
    const group=rows.filter(r=>r.requestedDepth===depth&&r.extra===extra), candidates=group.filter(r=>r.candidate);
    const completed=candidates.every(c=>c.result!==null);
    const values=candidates.map(c=>({action:c.candidate!,score:c.result?.selectedEvaluation??null,
      kind:c.valueKind,value:c.rootCandidates[0]?.value??null,originalIndex:getLegalActions(p.state).findIndex(a=>json(a)===json(c.candidate))}));
    const best=completed?values.reduce((a,b)=>compareSearchValues(a.value!,b.value!)>=0?a:b):null;
    const ties=best?values.filter(v=>compareSearchValues(v.value!,best.value!)===0).sort((a,b)=>a.originalIndex-b.originalIndex):[];
    if(completed&&group[0].result)assert.deepEqual(group[0].result.selectedAction,ties[0].action,'root must choose first original exact tie');
    return {depth,extra,completed,values,ties:ties.map(t=>t.action),rootSelected:group[0].result?.selectedAction??null};
  }));
  for(const b of read('boundary.json')) {
    const state=apply(p.state,b.prefix);assert.equal(hash(state),b.stateHash);
    assert.deepEqual(b.staticBreakdown,evaluateSearchPositionBreakdown(state,p.state.turn,resolveSearchEvaluationPreset('standard')));
    if(b.q)assert.deepEqual(observePv(state,b.q.principalVariation,p.state.turn).breakdown,b.q.evaluationBreakdown);
    for(const key of ['ordinary','forced']) if(b[key]) {
      aggregate(state,[b[key]]);
      if(b[key].result)assert.deepEqual(b[key+'Replay'],replay(state,b[key].result.principalVariation,1,0,1,1,p.state.turn));
    }
    assert.equal(b.originalRootScore,b.ordinary?.result?.selectedEvaluation==null?null:rootScore(b.ordinary.result.selectedEvaluation,state.turn,p.state.turn));
  }
  const result={summary,classifications,comparisons,completeCalls:rows.filter(r=>r.result).length,missingCalls:rows.filter(r=>!r.result).length};
  const env=read('environment.json'); assert.equal(env.planHash,hash(plan));
  for(const [f,h] of Object.entries(plan.protectedHashes))assert.equal(bytes(f),h,'old evidence modified');
  const snapshot=read('sources.json');
  for(const [f,h] of Object.entries(env.sourceHashes))assert.equal(createHash('sha256').update(snapshot[f]).digest('hex'),h);
  if(mode==='run') {
   write('summary.json',result);
   const names=['input.json','plan.json','environment.json','sources.json','reference.json','boundary.json','completed.json',...rows.map((_,i)=>`raw-${i}.json`)];
   write('manifest.json',Object.fromEntries(names.map(f=>[f,bytes(file(f))])));
  } else {
   for(const [f,h] of Object.entries(read('manifest.json')))assert.equal(bytes(file(f)),h,'saved raw hash mismatch');
   assert.deepEqual(read('summary.json'),result,'saved reaggregation mismatch');
  }
  const report=['|depth (root ply)|extra|root/forced destination|score|state|PV|leaf|','|---:|---:|---|---:|---|---|---|',...summary.map(r=>`|${r.depth}|${r.extra}|${r.candidate?json(r.candidate.to):'root'}|${r.score??'N/A'}|${r.source}|${r.pv.map(a=>a.kind==='move'?`${a.pieceType}(${a.from.row},${a.from.col})->(${a.to.row},${a.to.col}) ${a.promotion}`:`drop ${a.pieceType}`).join('; ')}|${r.leafReason??r.stop}|`)].join('\n')+'\n';
  if(mode==='run')writeFileSync(file('comparison.md'),report,{flag:'wx'});else assert.equal(readFileSync(file('comparison.md'),'utf8'),report);
  console.log(json({valid:true,summaryHash:hash(result),completeCalls:result.completeCalls,missingCalls:result.missingCalls}));
 }
}
