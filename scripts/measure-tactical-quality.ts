import assert from 'node:assert/strict';
import { loadPositions, qualityReference, qualityClassify, aggregateQuality, auditQualityResult, qualityPositions } from './benchmarks/tacticalQuality';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const byteHash=(s:string)=>createHash('sha256').update(s).digest('hex');

import { classify, reference, validatePosition, verifyReference, json, parse, hash, type Reference, type Result } from './benchmarks/tacticalDiagnostics';
import { observePv } from './benchmarks/terminalDistanceReference';
import { analyzeAlphaBetaSearch as fixed, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../src/domain/shogi/twoPlyAlphaBetaAi';
import { createCheckEvasionStatistics } from '../src/domain/shogi/quiescenceSearch';
import { protectSearchInput } from '../src/domain/shogi/selfPlayGame';
import { isPlayerInCheck } from '../src/domain/shogi/checkmate';
import { apply } from './benchmarks/terminalDistanceReference';
import { validatePartialRoot } from '../src/application/partialRootValidation';

const [mode, dirArg, pilotArg] = process.argv.slice(2);
const conditions = [ {id:'d1',depth:1,budget:null,repeats:2}, {id:'d4',depth:4,budget:null,repeats:2},
  {id:'100ms',depth:4,budget:100,repeats:3}, {id:'1000ms',depth:4,budget:1000,repeats:3} ];
const sources=[...execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>!f.startsWith('src/test/')), 'scripts/benchmarks/partialRootMatches.ts','scripts/benchmarks/tacticalQuality.ts','src/domain/shogi/quiescenceSearch.ts','src/domain/shogi/twoPlyAlphaBetaAi.ts',
  'src/domain/shogi/twoPlyMinimaxAi.ts','src/domain/shogi/legalActions.ts','src/domain/shogi/checkmate.ts',
  'src/domain/shogi/searchValue.ts','src/domain/shogi/transpositionTable.ts',
  'scripts/measure-tactical-quality.ts','scripts/benchmarks/tacticalDiagnostics.ts',
  'scripts/benchmarks/tacticalPositions.ts','scripts/benchmarks/terminalDistanceReference.ts',
  'scripts/benchmarks/checkEvasionPositions.ts','scripts/benchmarks/checkEvasionReference.ts'];
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
const opts=(extra:number,stats=createCheckEvasionStatistics())=>({moveOrdering:'standard' as const,killerMoves:false,
  usePreviousIterationPv:false,useTranspositionTable:false,checkEvasionStatistics:stats,
  quiescence:{maxTacticalDepth:1,moveOrdering:'original' as const,maxCheckEvasionExtensions:extra}});
if(mode==='select-cost') {
  assert.ok(dirArg && pilotArg,'select-cost PREPARED_MAIN_DIR PILOT_DIR');
  const dir=path.resolve(dirArg),pilot=path.resolve(pilotArg),target=path.join(dir,'plan.json');
  assert.ok(!existsSync(path.join(dir,'environment.json')),'schedule must be fixed before measurement');
  const plan=parse(readFileSync(target,'utf8')),pilotPlan=parse(readFileSync(path.join(pilot,'plan.json'),'utf8'));
  assert.equal(plan.positionHash,pilotPlan.positionHash); assert.ok(!plan.costSelection,'cost schedule already frozen');
  const contents=['raw.jsonl','warmup.jsonl'].map(f=>readFileSync(path.join(pilot,f),'utf8'));
  const rows=contents.flatMap(s=>s.trim().split(/\r?\n/).map(parse));
  const positions=plan.positions.map((p:{id:string})=>{
    const rs=rows.filter(r=>r.position===p.id&&r.condition==='d4');
    const keys=rs.map(r=>`${r.extra}/${r.phase}/${r.rep}`).sort();
    const expected=[0,1,2].flatMap(extra=>[`${extra}/warmup/-1`,`${extra}/measurement/0`]).sort();
    const maxFixedD4Ms=rs.length?Math.max(...rs.map(r=>r.callMs)):null;
    return {position:p.id,samples:rs.length,maxFixedD4Ms,eligible:json(keys)===json(expected)&&maxFixedD4Ms!==null&&maxFixedD4Ms<=5000};
  });
  writeFileSync(path.join(dir,'plan-before-cost-selection.json'),readFileSync(target),{flag:'wx'});
  plan.fixedD4PositionIds=positions.filter((p:{eligible:boolean})=>p.eligible).map((p:{position:string})=>p.position);
  assert.ok(plan.fixedD4PositionIds.length>0);
  plan.costSelection={rule:'all six pilot d4 calls present and max callMs <= 5000; timing only; other conditions retain all inputs',
    pilotRawHash:hash(contents[0]),pilotWarmupHash:hash(contents[1]),selectedAt:new Date().toISOString(),positions};
  writeFileSync(target,json(plan)+'\n'); console.log('fixed d4 positions',plan.fixedD4PositionIds);
} else if(mode==='child') {
  const lines=createInterface({input:process.stdin});
  for await (const line of lines) {
    const {p,c,extra}=parse(line);
    const protectedInput=protectSearchInput(p.state), before=hash(p.state), stats=createCheckEvasionStatistics();
    const start=performance.now();
    const r=c.budget===null?fixed(protectedInput.snapshot,c.depth,undefined,undefined,opts(extra,stats)):
      timed(protectedInput.snapshot,c.depth,c.budget,undefined,undefined,opts(extra,stats));
    const callMs=performance.now()-start;
    auditQualityResult(p,r,extra);
    assert.ok(!protectedInput.wasMutated()); assert.equal(hash(p.state),before);
    if(r.selectedEvaluation!==null) {
      assert.deepEqual(observePv(p.state,r.principalVariation).breakdown,r.evaluationBreakdown);
      assert.equal(r.selectedEvaluation,r.evaluationBreakdown!.total);
      assert.deepEqual(r.selectedAction,r.principalVariation[0]);
      assert.ok(r.principalVariation.length<=c.depth+1+extra);
    } else { assert.equal('resultSource' in r?r.resultSource:null,'fallback'); assert.equal(r.principalVariation.length,0); }
    if('resultSource' in r && r.resultSource==='partial-root') assert.ok(validatePartialRoot(p.state,r,1+extra));
    process.stdout.write(json({result:r,stats,callMs,apiMs:r.elapsedMilliseconds,
      overrunMs:c.budget===null?null:Math.max(0,callMs-c.budget)})+'\n');
  }
} else {
  assert.ok(dirArg && ['prepare','run','audit','audit-partial'].includes(mode),'prepare NEW_DIR | run DIR | audit DIR');
  const dir=path.resolve(dirArg), file=(s:string)=>path.join(dir,s);
  const write=(name:string,v:unknown)=>writeFileSync(file(name),json(v)+'\n',{flag:'wx'});
  if(mode==='prepare') {
    mkdirSync(dir); const positions=qualityPositions();
    const preparedConditions=pilotArg==='pilot'?conditions.map(c=>({...c,repeats:1})):conditions;
    const validation=Object.fromEntries(positions.map(p=>[p.id,validatePosition(p)]));
    write('plan.json',{baseSha:git('rev-parse','origin/main'),positions,positionHash:hash(positions),validation,
      selectionRule:'all prior 14 plus two deterministic capture-first legal plies; no outcome filtering',referenceQuality:{depth:3,maxNodes:6000,reverse:true},conditions:preparedConditions,stage:pilotArg==='pilot'?'pilot':'main',extensions:[0,1,2],settings:opts(0),referenceLimits:{nodes:60000,milliseconds:8000},
      order:'serial position, condition, repetition; ABC/BCA/CAB rotates including warmup; one warmup per cell excluded',
      hardStopMs:60000, limitations:'timed ordinary/q counters cover completed passes; extra stats include interrupted calls. CPU affinity, power, OS/JIT/GC uncontrolled.',
      createdAt:new Date().toISOString()});
    const refs:Record<string,Reference>={};
    for(const p of positions) { refs[p.id]=reference(p); console.log('reference',p.id,refs[p.id].stopped); }
    write('references.json',refs);
    write('quality-references.json',Object.fromEntries(positions.map(p=>[p.id,qualityReference(p)]))); 
  } else {
    const plan=parse(readFileSync(file('plan.json'),'utf8'));
    loadPositions(plan.positions);
    const qualityRefs=parse(readFileSync(file('quality-references.json'),'utf8'));
    assert.equal(hash(qualityPositions()),plan.positionHash); assert.deepEqual(plan.conditions.map(({repeats,...c}:typeof conditions[number])=>c),conditions.map(({repeats,...c})=>c));
    const runConditions=plan.conditions as typeof conditions;
    const measuredPositions=plan.measurementPositionIds ? plan.positions.filter((p:{id:string})=>plan.measurementPositionIds.includes(p.id)) : plan.positions;
    assert.ok(measuredPositions.length>0);
    if(plan.measurementPositionIds) assert.deepEqual(measuredPositions.map((p:{id:string})=>p.id),plan.measurementPositionIds);
    const tasks:{p:Parameters<typeof qualityReference>[0];c:typeof conditions[number]}[]=measuredPositions.flatMap((p:Parameters<typeof qualityReference>[0])=>runConditions.filter(c=>c.id!=='d4'||!plan.fixedD4PositionIds||plan.fixedD4PositionIds.includes(p.id)).map(c=>({p,c})));
    if(plan.fixedD4PositionIds) assert.deepEqual(measuredPositions.filter((p:{id:string})=>plan.fixedD4PositionIds.includes(p.id)).map((p:{id:string})=>p.id),plan.fixedD4PositionIds);
    assert.ok(runConditions.every(c=>Number.isInteger(c.repeats)&&c.repeats>=1&&c.repeats<=3));
    const refs=parse(readFileSync(file('references.json'),'utf8')) as Record<string,Reference>;
    for(const p of plan.positions) { verifyReference(p,refs[p.id]); if(mode.startsWith('audit')) assert.deepEqual(qualityReference(p),qualityRefs[p.id]); }
    if(mode==='run') {
      assert.equal(git('diff','--name-only'),''); assert.equal(git('diff','--cached','--name-only'),'');
      assert.ok(!existsSync(file('environment.json')),'refuse overwriting measurements');
      write('sources.json',Object.fromEntries(sources.map(f=>[f,readFileSync(f,'utf8')])));
      write('environment.json',{sha:git('rev-parse','HEAD'),status:git('status','--porcelain'),planHash:hash(plan),refsHash:hash(refs),qualityRefsHash:hash(qualityRefs),
        node:process.version,npm:execFileSync('npm.cmd',['--version'],{encoding:'utf8',shell:true}).trim(),os:`${os.platform()} ${os.release()} ${os.arch()}`,
        cpu:os.cpus()[0].model,sourceHashes:Object.fromEntries(sources.map(f=>[f,byteHash(readFileSync(f,'utf8'))])),startedAt:new Date().toISOString()});
      const workers=[0,1,2].map(()=>{
        const child=spawn(process.execPath,['--import','tsx',path.resolve('scripts/measure-tactical-quality.ts'),'child'],{stdio:['pipe','pipe','inherit'],windowsHide:true});
        const lines=createInterface({input:child.stdout})[Symbol.asyncIterator](); return {child,lines};
      });
      let sequence=0; let active:unknown=null;
      try {
        for(const {p,c} of tasks) for(let rep=-1;rep<c.repeats;rep++) {
          const rotation=(sequence/3)%3;
          for(const extra of [rotation,(rotation+1)%3,(rotation+2)%3]) {
            const {child,lines}=workers[extra]; const phase=rep<0?'warmup':'measurement';
            active={position:p.id,condition:c.id,extra,rep,phase};
            child.stdin.write(json({p,c,extra})+'\n');
            let timer:ReturnType<typeof setTimeout>|undefined;
            const received=await Promise.race([lines.next(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('60s hard-stop')),plan.hardStopMs);})]).finally(()=>clearTimeout(timer));
            assert.ok(!received.done,'measurement process ended early');
            const row={sequence:sequence++,position:p.id,condition:c.id,extra,rep,phase,status:'ok',...parse(received.value)};
            appendFileSync(file(phase==='warmup'?'warmup.jsonl':'raw.jsonl'),json(row)+'\n');
            console.log(row.sequence,p.id,c.id,extra,phase,row.callMs.toFixed(1));
          }
        }
        write('completed.json',{finishedAt:new Date().toISOString(),samples:sequence,rawHash:hash(readFileSync(file('raw.jsonl'),'utf8')),
          warmupHash:hash(readFileSync(file('warmup.jsonl'),'utf8'))});
      } catch(e) { write('failure.json',{error:String(e),sequence,active,at:new Date().toISOString()}); throw e; }
      finally { for(const w of workers) w.child.kill(); }
    } else {
      const env=parse(readFileSync(file('environment.json'),'utf8'));
      const interrupted=mode==='audit-partial';
      assert.ok(!interrupted || existsSync(file('failure.json')),'partial audit requires an explicit failure record');
      const partial={status:'incomplete',failureHash:interrupted?hash(readFileSync(file('failure.json'),'utf8')):null,
        rawHash:hash(readFileSync(file('raw.jsonl'),'utf8')),warmupHash:hash(readFileSync(file('warmup.jsonl'),'utf8')),
        samples:[...readFileSync(file('raw.jsonl'),'utf8').trim().split(/\r?\n/),...readFileSync(file('warmup.jsonl'),'utf8').trim().split(/\r?\n/)].length};
      if(interrupted) { if(existsSync(file('interrupted-audit.json'))) assert.deepEqual(parse(readFileSync(file('interrupted-audit.json'),'utf8')),partial); else write('interrupted-audit.json',partial); }
      const done=interrupted?partial:parse(readFileSync(file('completed.json'),'utf8'));
      assert.equal(env.planHash,hash(plan)); assert.equal(env.refsHash,hash(refs)); assert.equal(env.qualityRefsHash,hash(qualityRefs));
      const snapshot=parse(readFileSync(file('sources.json'),'utf8'));
      for(const [name,content] of Object.entries(snapshot)) assert.equal(env.sourceHashes[name],byteHash(content as string));
      assert.equal(done.rawHash,hash(readFileSync(file('raw.jsonl'),'utf8')));
      assert.equal(done.warmupHash,hash(readFileSync(file('warmup.jsonl'),'utf8')));
      const rows=readFileSync(file('raw.jsonl'),'utf8').trim().split(/\r?\n/).map(parse);
      const warmups=readFileSync(file('warmup.jsonl'),'utf8').trim().split(/\r?\n/).map(parse);
      if(!interrupted) assert.equal(warmups.length,tasks.length*3);
      assert.equal(done.samples,rows.length+warmups.length);
      const expectedWarmups=tasks.flatMap(({p,c})=>[0,1,2].map(extra=>`${p.id}/${c.id}/${extra}/-1`)).sort();
      const warmupKeys=warmups.map(r=>`${r.position}/${r.condition}/${r.extra}/${r.rep}`).sort();
      assert.equal(new Set(warmupKeys).size,warmupKeys.length);
      assert.deepEqual(warmupKeys,interrupted?expectedWarmups.filter((k:string)=>warmupKeys.includes(k)):expectedWarmups);
      const all=[...rows,...warmups].sort((a,b)=>a.sequence-b.sequence);
      assert.deepEqual(all.map(r=>r.sequence),Array.from({length:done.samples},(_,i)=>i));
      for(const row of all) {
        const c=runConditions.find(c=>c.id===row.condition)!;
        assert.equal(row.status,'ok'); assert.ok(row.callMs>=0 && row.apiMs>=0);
        assert.equal(row.apiMs,row.result.elapsedMilliseconds);
        assert.equal(row.overrunMs,c.budget===null?null:Math.max(0,row.callMs-c.budget));
        assert.ok(row.stats.maxExtensionDepth<=row.extra);
        const p=plan.positions.find((p:{id:string})=>p.id===row.position);
        auditQualityResult(p,row.result,row.extra);
        if(row.result.resultSource==='partial-root') assert.ok(validatePartialRoot(p.state,row.result,1+row.extra));
        if(row.result.selectedEvaluation!==null) assert.deepEqual(observePv(p.state,row.result.principalVariation).breakdown,row.result.evaluationBreakdown);
      }
      const expected=tasks.flatMap(({p,c})=>[0,1,2].flatMap(extra=>Array.from({length:c.repeats},(_,rep)=>`${p.id}/${c.id}/${extra}/${rep}`))).sort();
      const rowKeys=rows.map(r=>`${r.position}/${r.condition}/${r.extra}/${r.rep}`).sort();
      assert.equal(new Set(rowKeys).size,rowKeys.length);
      assert.deepEqual(rowKeys,interrupted?expected.filter((k:string)=>rowKeys.includes(k)):expected);
      if(interrupted) {
        const missing={status:'incomplete',missingMeasurementCells:expected.filter((k:string)=>!rowKeys.includes(k)),missingWarmupCells:expectedWarmups.filter((k:string)=>!warmupKeys.includes(k))};
        if(existsSync(file('missing.json'))) assert.deepEqual(parse(readFileSync(file('missing.json'),'utf8')),missing);else write('missing.json',missing);
      }
      const summary=rows.map(row=>{
        const p=plan.positions.find((p:{id:string})=>p.id===row.position), r=row.result as Result;
        if(r.selectedEvaluation!==null) assert.deepEqual(observePv(p.state,r.principalVariation).breakdown,r.evaluationBreakdown);
        let evasion:'not-in-check'|'success'|'failure'='not-in-check';
        if(isPlayerInCheck(p.state,p.state.turn)) {
          evasion=r.selectedAction && !isPlayerInCheck(apply(p.state,r.selectedAction),p.state.turn)?'success':'failure';
        }
        return {...row,origin:p.origin,positionHash:hash(p.state),historyHash:hash(p.state.positionHistory),turn:p.state.turn,selectedActionLegal:true,settings:opts(row.extra),...qualityClassify(p,qualityRefs[p.id],r),...classify(p,refs[p.id],r),evasion,
          pvTerminalReason:r.selectedEvaluation===null?null:observePv(p.state,r.principalVariation).reason,
          terminalDiscovery:r.evaluationBreakdown?.terminal??'none',
          completedDepth:'completedDepth' in r?r.completedDepth:r.depth,
          resultSource:'resultSource' in r?r.resultSource:'fixed-depth',timedOut:'timedOut' in r?r.timedOut:false};
      });
      if(existsSync(file('summary.json'))) assert.deepEqual(parse(readFileSync(file('summary.json'),'utf8')),summary); else write('summary.json',summary);
      const table=['|condition|extra|n|match / mismatch / indeterminate|wall p50 / p95 ms|maximum overrun ms|completed depth sum|ordinary / q / extra nodes|',
        '|---|---:|---:|---|---|---:|---:|---|'];
      const quantile=(xs:number[],p:number)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
      for(const c of runConditions) for(const extra of [0,1,2]) {
        const rs=summary.filter(r=>r.condition===c.id&&r.extra===extra);
        const counts=['match','mismatch','indeterminate'].map(v=>rs.filter(r=>r.verdict===v).length).join(' / ');
        const sum=(f:(r:typeof rs[number])=>number)=>rs.reduce((n,r)=>n+f(r),0);
        table.push(`|${c.id}|${extra}|${rs.length}|${counts}|${quantile(rs.map(r=>r.callMs),.5).toFixed(3)} / ${quantile(rs.map(r=>r.callMs),.95).toFixed(3)}|${Math.max(...rs.map(r=>r.overrunMs??0)).toFixed(3)}|${sum(r=>r.completedDepth)}|${sum(r=>'totalVisitedPositionCount' in r.result?r.result.totalVisitedPositionCount:r.result.visitedPositionCount)} / ${sum(r=>'totalQuiescenceVisitedPositionCount' in r.result?r.result.totalQuiescenceVisitedPositionCount:r.result.quiescenceVisitedPositionCount)} / ${sum(r=>r.stats.visitedPositionCount)}|`);
      }
      const content=table.join('\n')+'\n';
      if(existsSync(file('results.md'))) assert.equal(readFileSync(file('results.md'),'utf8'),content);else writeFileSync(file('results.md'),content,{flag:'wx'});
      for(const c of runConditions.filter(c=>c.budget===null)) for(const p of measuredPositions) for(const extra of [0,1,2]) {
        const rs=rows.filter(r=>r.position===p.id&&r.condition===c.id&&r.extra===extra);
        for(const r of rs.slice(1)) assert.deepEqual({...r.result,elapsedMilliseconds:0},{...rs[0].result,elapsedMilliseconds:0});
      }
      const quality=aggregateQuality(plan.positions,summary);
      if(existsSync(file('quality-summary.json'))) assert.deepEqual(parse(readFileSync(file('quality-summary.json'),'utf8')),quality); else write('quality-summary.json',quality);
      console.log(`${interrupted?'INCOMPLETE partial audit: ':'Complete audit: '}Audited ${rows.length} measured samples, all PV and evaluations; summary regenerated.`);
    }
  }
}
