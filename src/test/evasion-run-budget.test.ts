import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {EvidenceStore,RunDeadline,CapacityError,utf8,inventory,auditStore,executeSchedule,type Slot} from '../../scripts/benchmarks/evasionRunBudget';
import {runBudgeted,auditBudgeted,slotsFor,type BudgetPlan} from '../../scripts/benchmarks/evasionBudgetRun';
import {parse} from '../../scripts/benchmarks/tacticalDiagnostics';
import {diagnose,limits} from '../../scripts/benchmarks/evasionBoundary';
const base='docs/benchmarks/evasion-boundary-20261022/run1/';
const p=parse(readFileSync(base+'input.json','utf8'));
const original=parse(readFileSync(base+'plan.json','utf8'));
const dir=()=>{mkdirSync('.diagnostic-temp',{recursive:true});return mkdtempSync(path.resolve('.diagnostic-temp/p2-test-'));};
const bytes=(d:string)=>Object.values(inventory(d)).reduce((n,f)=>n+f.bytes,0);
const simple:Slot[]=['matrix','reference','q','ordinary','forced'].map(kind=>({id:kind,kind}));
const derived=(r:Map<string,unknown>)=>({'summary.json':utf8([...r])});
const done={status:'completed' as const,reason:null,data:null};
const fixture=(changes:Partial<BudgetPlan>={})=>({...original,formatVersion:2,depths:[1],extensions:[0],candidates:[],primaryCandidates:[original.primaryCandidates[0]],
  wholeMilliseconds:100,wholeBytes:100000,closureBytes:20000,...changes} as BudgetPlan);
describe('shared evasion run deadline',()=>{
 it('starts no reference/q/ordinary/forced after the matrix reaches the single deadline',()=>{
  const d=dir(),s=new EvidenceStore(d,100000,20000);let now=0;const calls:string[]=[];
  const status=executeSchedule(s,new RunDeadline(10,()=>now,()=>1000),simple,100,200,slot=>{calls.push(slot.kind);now=10;return done;},{},derived);
  expect(calls).toEqual(['matrix']);expect(status.status).toBe('incomplete');
  expect(status.records[0].status).toBe('incomplete');expect(status.records.slice(1).every(r=>r.status==='missing'&&r.reason==='time')).toBe(true);
  expect(auditStore(d).status.status).toBe('incomplete');
 });
 it('clips cooperative, parent and child epoch limits to the same remaining time',()=>{
  let now=0;const budget=new RunDeadline(80,()=>now,()=>5000);now=55;
  const seen:any[]=[];budget.execute(simple[1],10000,12000,(_s,a)=>{seen.push(a);return done;});
  expect(seen).toEqual([{milliseconds:25,hardMilliseconds:25,deadlineEpoch:5025,remainingMilliseconds:25}]);
 });
 it('applies the deadline to the reference itself, discarding a late complete value',()=>{
  let now=0;const b=new RunDeadline(20,()=>now);const result=b.execute(simple[1],100,100,()=>{now=21;return {status:'completed',reason:null,data:{stopped:false}};});
  expect(result).toEqual({status:'incomplete',reason:'time',data:null});expect(b.halt).toBe('time');
 });
 it('does not accept a result delivered after its individual deadline while global time remains',()=>{
  let now=0;const budget=new RunDeadline(100,()=>now);
  const r=budget.execute(simple[1],10,20,()=>{now=11;return done;});
  expect(r.status).toBe('incomplete');expect(r.reason).toBe('time');expect(budget.halt).toBe(null);
 });
 it('marks subsequent local tasks missing and audit never promotes incomplete comparisons',()=>{
  const d=dir(),plan=fixture();let now=0;const calls:string[]=[];
  const status=runBudgeted(d,p,plan,{},new RunDeadline(100,()=>now),slot=>{
    calls.push(slot.kind);if(slot.kind==='q')now=100;
    return {status:'completed',reason:null,data:slot.kind==='matrix'?{result:{selectedEvaluation:1},completedDepth:1}:null};
  });
  expect(calls).toEqual(['matrix','reference','q']);expect(status.records.slice(-2).every(r=>r.status==='missing')).toBe(true);
  const summary=parse(readFileSync(path.join(d,'summary.json'),'utf8'));
  expect(summary.comparisonComplete).toBe(false);expect(summary.rows.slice(-3).every((r:any)=>r.score===null&&r.valueKind===null)).toBe(true);
  expect(auditBudgeted(d,p,plan,false).completed).toBe(false);
 });
 it('can exhaust the deadline during ordinary without starting forced',()=>{
  const d=dir(),plan=fixture();let now=0;const calls:string[]=[];
  const status=runBudgeted(d,p,plan,{},new RunDeadline(100,()=>now),slot=>{
    calls.push(slot.kind);if(slot.kind==='ordinary')now=100;
    return {status:'completed',reason:null,data:slot.kind==='q'?{q:{selectedEvaluation:0}}:null};
  });
  expect(calls).toEqual(['matrix','reference','q','ordinary']);expect(status.records.at(-1)!.status).toBe('missing');
  expect(auditBudgeted(d,p,plan,false).completed).toBe(false);
 });
 it('does no work at an already expired deadline and makes missing records without domain calls',()=>{
  const d=dir(),plan=fixture({wholeMilliseconds:0});let called=0;
  const status=runBudgeted(d,p,plan,{},new RunDeadline(0,()=>0),()=>{called++;return done;});
  expect(called).toBe(0);expect(status.records.every(r=>r.status==='missing')).toBe(true);expect(auditBudgeted(d,p,plan,false).completed).toBe(false);
 });
 it('records parent timeouts separately and can kill synchronous child work',()=>{
  const b=new RunDeadline(500,()=>0);const r=b.execute(simple[1],100,100,()=>{throw Object.assign(Error('timeout'),{code:'ETIMEDOUT'});});
  expect(r.reason).toBe('parent-timeout');expect(r.status).toBe('incomplete');
  expect(()=>execFileSync(process.execPath,['-e','while(true){}'],{timeout:25,killSignal:'SIGKILL',windowsHide:true})).toThrow();
 });
 it('distinguishes executor exceptions from timeouts and stops further search',()=>{
  const b=new RunDeadline(500,()=>0);expect(b.execute(simple[0],10,10,()=>{throw Error('failure');}).reason).toBe('exception');
  expect(b.execute(simple[1],10,10,()=>{throw Error('must not run');}).status).toBe('missing');
 });
});
describe('all-evidence UTF-8 capacity',()=>{
 it.each([-1,0,1])('checks real bytes including Japanese and newline at boundary delta=%i',delta=>{
  const d=dir(),data=utf8({text:'日本語'}),reserve=2000,s=new EvidenceStore(d,reserve+data.length+delta,reserve);
  expect(data.length).toBe(Buffer.byteLength('{"text":"日本語"}\n','utf8'));
  if(delta<0){expect(()=>s.write('raw.json',{text:'日本語'})).toThrow(CapacityError);expect(existsSync(path.join(d,'raw.json'))).toBe(false);}
  else {s.write('raw.json',{text:'日本語'});expect(bytes(d)).toBe(data.length);}
 });
 it('accounts prepared, nested and every non-raw artifact before writing',()=>{
  const d=dir();mkdirSync(path.join(d,'nested'));writeFileSync(path.join(d,'input.json'),utf8({input:'将棋'}));
  writeFileSync(path.join(d,'plan.json'),utf8({plan:true}));writeFileSync(path.join(d,'nested','extra.txt'),'追加\n');
  const before=bytes(d),s=new EvidenceStore(d,before+4000+50,4000);
  expect(s.used).toBe(before);s.write('environment.json',{});
  expect(()=>s.write('sources.json',{text:'x'.repeat(100)})).toThrow(CapacityError);
  expect(bytes(d)).toBe(before+utf8({}).length);
 });
 it('preflights a mandatory batch before any search or partial initial writes',()=>{
  const d=dir(),s=new EvidenceStore(d,10000,9000);let calls=0;
  expect(()=>executeSchedule(s,new RunDeadline(100,()=>0),simple,20,20,()=>{calls++;return done;},
    {'sources.json':utf8('x'.repeat(1500)),'environment.json':utf8({})},derived)).toThrow(CapacityError);
  expect(calls).toBe(0);expect(bytes(d)).toBe(0);
 });
 it('fails before search if existing evidence or required shutdown reservation cannot fit',()=>{
  const d=dir();writeFileSync(path.join(d,'input.json'),'x'.repeat(20));
  expect(()=>new EvidenceStore(d,30,20)).toThrow(CapacityError);
  const s=new EvidenceStore(dir(),5000,10);let calls=0;
  expect(()=>executeSchedule(s,new RunDeadline(10,()=>0),simple,1,1,()=>{calls++;return done;},{},derived)).toThrow(CapacityError);
  expect(calls).toBe(0);
 });
 it('uses the reserved space for capacity shutdown, includes manifest/status in the actual total',()=>{
  const d=dir(),plan=fixture({wholeBytes:25000,closureBytes:20000});let calls=0;
  const status=runBudgeted(d,p,plan,{},new RunDeadline(100,()=>0),()=>{calls++;return {status:'completed',reason:null,data:'x'.repeat(6000)};});
  expect(calls).toBe(1);expect(status.reason).toBe('capacity');expect(status.status).toBe('incomplete');
  expect(status.records.every(r=>r.status==='missing'&&r.reason==='capacity')).toBe(true);
  const audit=auditBudgeted(d,p,plan,false);expect(audit.totalBytes).toBe(bytes(d));expect(bytes(d)).toBeLessThanOrEqual(plan.wholeBytes);
  expect(existsSync(path.join(d,'task-0.json'))).toBe(false);
 });
 it('saves an exception shutdown if deriving a report throws',()=>{
  const d=dir(),store=new EvidenceStore(d,30000,20000);
  const status=executeSchedule(store,new RunDeadline(10,()=>0),simple,1,1,()=>done,{},()=>{throw Error('report failure');});
  expect(status.reason).toBe('exception');expect(auditStore(d).status.missingArtifacts).toEqual(['summary.json','comparison.md']);
 });
 it('detects extra files, altered total and forged completion in audit',()=>{
  const d=dir(),plan=fixture({wholeMilliseconds:0});runBudgeted(d,p,plan,{},new RunDeadline(0,()=>0),()=>done);
  writeFileSync(path.join(d,'extra.txt'),'未計上');expect(()=>auditBudgeted(d,p,plan,false)).toThrow();
 });
 it('keeps complete diagnosis values, original root depth and exact/bound under the wrapper',()=>{
  const d=dir(),plan=fixture();const diagnosis=diagnose(p.state,1,0,null,{...limits,traceEvents:1});
  const status=runBudgeted(d,p,plan,{},new RunDeadline(100,()=>0),slot=>({status:'completed',reason:null,
    data:slot.kind==='matrix'?diagnosis:slot.kind==='q'?{q:{selectedEvaluation:-1005}}:null}));
  expect(status.status).toBe('completed');expect(auditBudgeted(d,p,plan,false).completed).toBe(true);
  const stored=parse(readFileSync(path.join(d,'task-0.json'),'utf8')).data;
  expect(stored.result).toEqual(diagnosis.result);expect(stored.depthIncludesCandidate).toBe(true);expect(stored.valueKind).toBe('exact');
  expect(stored.rootCandidates.some((c:any)=>c.bound==='upper')).toBe(true);
 });
});
