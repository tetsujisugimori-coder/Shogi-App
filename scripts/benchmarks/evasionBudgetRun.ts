import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {BoardState} from '../../src/types/shogi';
import type {LegalAction} from '../../src/domain/shogi/legalActions';
import {analyzeQuiescenceSearch} from '../../src/domain/shogi/quiescenceSearch';
import {evaluateSearchPositionBreakdown} from '../../src/domain/shogi/twoPlyMinimaxAi';
import {resolveSearchEvaluationPreset} from '../../src/domain/shogi/searchEvaluationPresets';
import {diagnose,aggregate,rootScore,replay,type Limits,type Diagnosis} from './evasionBoundary';
import {apply,hash,json,parse} from './tacticalDiagnostics';
import {qualityReference,qualityClassify} from './tacticalQuality';
import {observePv} from './terminalDistanceReference';
import type {TacticalPosition} from './tacticalPositions';
import {EvidenceStore,RunDeadline,executeSchedule,auditStore,utf8,type Slot,type Allowance,type TaskResult,type TaskRecord} from './evasionRunBudget';
export interface BudgetPlan {
  formatVersion:2;wholeMilliseconds:number;wholeBytes:number;closureBytes:number;hardCallMilliseconds:number;limits:Limits;
  depths:number[];extensions:number[];candidates:LegalAction[];primaryCandidates:LegalAction[];
  reference:{depth:number;nodes:number};boundary:{replies:LegalAction[]};inputHash:string;protectedHashes:Record<string,string>;
}
interface SearchSlot extends Slot {kind:'matrix'|'reference'|'q'|'ordinary'|'forced';depth?:number;extra?:number;candidate?:LegalAction|null;prefix?:LegalAction;reply?:LegalAction}
export function slotsFor(plan:BudgetPlan):SearchSlot[]{
  const slots:SearchSlot[]=[];
  for(const depth of plan.depths)for(const extra of plan.extensions)for(const candidate of [null,...plan.candidates])
    slots.push({id:`matrix-${slots.length}`,kind:'matrix',depth,extra,candidate});
  slots.push({id:'reference',kind:'reference'});
  for(const [i,prefix] of plan.primaryCandidates.entries())for(const kind of ['q','ordinary','forced'] as const)
    slots.push({id:`boundary-${i}-${kind}`,kind,prefix,reply:plan.boundary.replies[i]});
  return slots;
}
/** Only the child performs domain calls. All synchronous reference/rule work is under the parent's kill deadline. */
export function childTask(p:TacticalPosition,plan:BudgetPlan,slot:SearchSlot,a:Allowance):TaskResult {
  const milliseconds=Math.min(a.milliseconds,Math.max(0,a.deadlineEpoch-Date.now()));
  if(milliseconds<1)return {status:'missing',reason:'time',data:null};
  const budget={...plan.limits,milliseconds};
  if(slot.kind==='reference') {
    const data=qualityReference(p,plan.reference.depth,plan.reference.nodes);
    return {status:data.stopped?'incomplete':'completed',reason:data.stopped?'nodes':null,data};
  }
  if(slot.kind==='matrix') {
    const data=diagnose(p.state,slot.depth!,slot.extra!,slot.candidate??null,budget);
    return {status:data.result?'completed':'incomplete',reason:data.result?null:data.limitReason==='nodes'?'nodes':data.limitReason==='time'?'time':'exception',data};
  }
  const state=apply(p.state,slot.prefix!);
  if(Date.now()>=a.deadlineEpoch)return {status:'incomplete',reason:'time',data:null};
  if(slot.kind==='q') {
    const staticBreakdown=evaluateSearchPositionBreakdown(state,p.state.turn,resolveSearchEvaluationPreset('standard'));
    let checks=0,stop:'nodes'|'time'|null=null;
    try {
      const q=analyzeQuiescenceSearch(state,p.state.turn,1,resolveSearchEvaluationPreset('standard'),()=>{
        if(Date.now()>=a.deadlineEpoch)stop='time';else if(++checks>budget.nodes)stop='nodes';
        if(stop)throw Error(stop);
      });
      return {status:'completed',reason:null,data:{stateHash:hash(state),staticBreakdown,q}};
    }catch {return {status:'incomplete',reason:stop??'exception',data:null};}
  }
  const data=diagnose(state,1,0,slot.kind==='forced'?slot.reply!:null,
    {...budget,milliseconds:Math.min(milliseconds,Math.max(0,a.deadlineEpoch-Date.now()))});
  return {status:data.result?'completed':'incomplete',reason:data.result?null:data.limitReason==='nodes'?'nodes':data.limitReason==='time'?'time':'exception',
    data:{diagnosis:data,originalRootScore:data.result?.selectedEvaluation==null?null:rootScore(data.result.selectedEvaluation,state.turn,p.state.turn),
      pv:data.result?replay(state,data.result.principalVariation,1,0,1,1,p.state.turn):null}};
}
export function processTask(p:TacticalPosition,plan:BudgetPlan,slot:Slot,a:Allowance):TaskResult {
  const left=Math.min(a.hardMilliseconds,Math.floor(a.deadlineEpoch-Date.now()));
  if(left<1)return {status:'missing',reason:'time',data:null};
  const output=execFileSync(process.execPath,['--import','tsx',path.resolve('scripts/measure-evasion-boundary.ts'),'child'],{
    input:json({position:p,plan,task:slot,allowance:a}),encoding:'utf8',timeout:left,killSignal:'SIGKILL',maxBuffer:4194304,windowsHide:true});
  return parse(output);
}
export function deriveOutputs(plan:BudgetPlan,results:Map<string,TaskResult>){
  const slots=slotsFor(plan),complete=slots.every(s=>results.get(s.id)?.status==='completed');
  const rows=slots.map(s=>{
    const r=results.get(s.id)!;const data=r.data as any;
    const diagnosis=s.kind==='matrix'?data:s.kind==='ordinary'||s.kind==='forced'?data?.diagnosis:null;
    return {id:s.id,kind:s.kind,status:r.status,reason:r.reason,depth:s.depth??null,extra:s.extra??null,candidate:s.candidate??s.prefix??null,
      valueKind:r.status==='completed'&&s.kind!=='reference'?'exact':null,
      score:r.status!=='completed'?null:s.kind==='q'?data.q.selectedEvaluation:s.kind==='matrix'?diagnosis?.result?.selectedEvaluation??null:data?.originalRootScore??null,
      completedDepth:diagnosis?.completedDepth??null,pv:diagnosis?.result?.principalVariation??[]};
  });
  // Derived metadata only: shutdown never invokes rules, replay, reference or search.
  const summary={formatVersion:2,comparisonComplete:complete,completedCalls:rows.filter(r=>r.status==='completed').length,
    missingCalls:rows.filter(r=>r.status==='missing').length,incompleteCalls:rows.filter(r=>r.status==='incomplete').length,rows};
  const table=['|task|kind|status|root score|reason|','|---|---|---|---:|---|',...rows.map(r=>`|${r.id}|${r.kind}|${r.status}|${r.score??'N/A'}|${r.reason??''}|`)].join('\n')+'\n';
  return {'summary.json':utf8(summary),'comparison.md':Buffer.from(table,'utf8')};
}
export function runBudgeted(dir:string,p:TacticalPosition,plan:BudgetPlan,initial:Record<string,Buffer>,deadline=new RunDeadline(plan.wholeMilliseconds),
  runner=(s:Slot,a:Allowance)=>processTask(p,plan,s,a)){
  const store=new EvidenceStore(dir,plan.wholeBytes,plan.closureBytes);
  return executeSchedule(store,deadline,slotsFor(plan),plan.limits.milliseconds,plan.hardCallMilliseconds,runner,initial,r=>deriveOutputs(plan,r));
}
export function auditBudgeted(dir:string,p:TacticalPosition,plan:BudgetPlan,verifyDomain=true){
  const {manifest,total,status}=auditStore(dir);
  assert.equal(manifest.limitBytes,plan.wholeBytes);assert.equal(manifest.reservedBytes,plan.closureBytes);
  const read=(n:string)=>parse(readFileSync(path.join(dir,n),'utf8'));
  const slots=slotsFor(plan),records=status.records as TaskRecord[],results=new Map<string,TaskResult>();
  assert.equal(records.length,slots.length);
  for(const [i,slot] of slots.entries()) {
    const record=records[i];assert.equal(record.id,slot.id);assert.equal(record.kind,slot.kind);
    assert.ok(['completed','incomplete','missing'].includes(record.status));
    if(record.budget){assert.ok(record.budget.milliseconds>0&&record.budget.milliseconds<=Math.min(plan.limits.milliseconds,record.budget.remainingMilliseconds));assert.ok(record.budget.hardMilliseconds>=1&&record.budget.hardMilliseconds<=Math.min(plan.hardCallMilliseconds,record.budget.remainingMilliseconds));}
    if(record.status==='completed')assert.ok(record.budget);
    if(record.status==='missing'){assert.ok(!manifest.files[`task-${i}.json`]);assert.equal(record.file,null);assert.ok(record.reason);results.set(slot.id,{status:'missing',reason:record.reason,data:null});continue;}
    assert.equal(record.file,`task-${i}.json`);const result=read(record.file!);
    assert.equal(result.status,record.status);assert.equal(result.reason,record.reason);
    assert.equal(record.status==='completed',record.reason===null);
    results.set(slot.id,result);
    if(!verifyDomain)continue;
    if(result.status==='completed')assert.ok(result.data,'completed task requires saved result');
    if(!result.data)continue;
    if(slot.kind==='matrix') {
      const d=result.data as Diagnosis;
      assert.equal(d.requestedDepth,slot.depth);assert.equal(d.extra,slot.extra);assert.deepEqual(d.candidate,slot.candidate);
      assert.equal(Boolean(d.result),result.status==='completed');aggregate(p.state,[d]);
    } else if(slot.kind==='reference') {
      assert.equal(result.data.stopped,result.status!=='completed');assert.equal(result.data.positionHash,hash(p));
    } else {
      const state=apply(p.state,slot.prefix!);
      if(slot.kind==='q')assert.deepEqual(observePv(state,result.data.q.principalVariation,p.state.turn).breakdown,result.data.q.evaluationBreakdown);
      else {
        const d=result.data.diagnosis as Diagnosis;assert.equal(Boolean(d.result),result.status==='completed');aggregate(state,[d]);
        assert.equal(result.data.originalRootScore,d.result?.selectedEvaluation==null?null:rootScore(d.result.selectedEvaluation,state.turn,p.state.turn));
        assert.deepEqual(result.data.pv,d.result?replay(state,d.result.principalVariation,1,0,1,1,p.state.turn):null);
      }
    }
  }
  assert.ok(['completed','incomplete'].includes(status.status));
  assert.ok(status.missingArtifacts.every((n:string)=>['summary.json','comparison.md'].includes(n)));
  assert.equal(new Set(status.missingArtifacts).size,status.missingArtifacts.length);
  const allComplete=records.every(r=>r.status==='completed');
  assert.equal(status.status==='completed',allComplete&&status.missingArtifacts.length===0&&status.reason===null);
  assert.ok(status.status==='completed'||status.reason!==null||records.some(r=>r.status==='incomplete'));
  for(const [name,data] of Object.entries(deriveOutputs(plan,results))) {
    if(status.missingArtifacts.includes(name)){assert.ok(!manifest.files[name]);continue;}
    assert.deepEqual(readFileSync(path.join(dir,name)),data,'reaggregation mismatch');
  }
  const classifications=[];
  if(verifyDomain) {
    const ref=results.get('reference');
    for(const slot of slots.filter(s=>s.kind==='matrix'&&!s.candidate)) {
      const r=results.get(slot.id)!;
      classifications.push(ref?.status==='completed'&&r.status==='completed'?
        qualityClassify(p,ref.data as any,(r.data as Diagnosis).result):{quality:'Inconclusive',evidence:'incomplete matrix or reference'});
    }
    const env=read('environment.json'),sources=read('sources.json');assert.equal(env.planHash,hash(plan));
    for(const [file,h] of Object.entries(env.sourceHashes))assert.equal(hashText(sources[file]),h);
    for(const [file,h] of Object.entries(plan.protectedHashes))assert.equal(requireHash(readFileSync(file)),h);
  }
  return {valid:true,completed:status.status==='completed',totalBytes:total,limitBytes:plan.wholeBytes,classifications};
}
function hashText(text:string){return requireHash(Buffer.from(text,'utf8'));}
import {sha as requireHash} from './evasionRunBudget';
