import assert from 'node:assert/strict';
import {readdirSync,readFileSync,lstatSync,writeFileSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {json,parse} from './tacticalDiagnostics';
export const CLOSURE_BYTES=262144;
export const utf8=(value:unknown)=>Buffer.from(json(value)+'\n','utf8');
export const sha=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
export class CapacityError extends Error {}
export type Reason='time'|'capacity'|'exception'|'nodes'|'parent-timeout'|'child-error';
export interface Slot {id:string;kind:string;[key:string]:unknown}
export interface TaskRecord {id:string;kind:string;status:'completed'|'incomplete'|'missing';reason:Reason|null;file:string|null;budget:Allowance|null}
export interface TaskResult {status:'completed'|'incomplete'|'missing';reason:Reason|null;data:unknown}
export interface Allowance {milliseconds:number;hardMilliseconds:number;deadlineEpoch:number;remainingMilliseconds:number}
export function inventory(dir:string):Record<string,{bytes:number;sha256:string}> {
  const files:Record<string,{bytes:number;sha256:string}>={};
  const walk=(sub:string)=>{for(const name of readdirSync(path.join(dir,sub)).sort()) {
    const rel=sub?sub+'/'+name:name, f=path.join(dir,rel),stat=lstatSync(f);
    assert.ok(!stat.isSymbolicLink(),'evidence symlinks are not supported');
    if(stat.isDirectory())walk(rel);else {assert.ok(stat.isFile());const data=readFileSync(f);files[rel]={bytes:data.length,sha256:sha(data)};}
  }};walk('');return files;
}
export class EvidenceStore {
  readonly files:ReturnType<typeof inventory>;
  constructor(readonly dir:string,readonly limit:number,readonly reserve:number) {
    assert.ok(Number.isSafeInteger(limit)&&limit>0&&Number.isSafeInteger(reserve)&&reserve>0);
    this.files=inventory(dir);
    if(this.used+reserve>limit)throw new CapacityError('existing evidence and shutdown reserve exceed capacity');
  }
  get used(){return Object.values(this.files).reduce((n,f)=>n+f.bytes,0);}
  private data(entries:Record<string,Buffer>){
    for(const name of Object.keys(entries)) {
      assert.match(name,/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);assert.ok(!this.files[name]&&!existsSync(path.join(this.dir,name)),'refuse overwrite');
    }
    return Object.values(entries).reduce((n,b)=>n+b.length,0);
  }
  preflight(entries:Record<string,Buffer>) {
    if(this.used+this.data(entries)+this.reserve>this.limit)throw new CapacityError('mandatory evidence/next whole file exceeds capacity');
  }
  writeBatch(entries:Record<string,Buffer>){
    this.preflight(entries);for(const [name,data] of Object.entries(entries))this.put(name,data);
  }
  write(name:string,value:unknown){this.writeBatch({[name]:utf8(value)});}
  private put(name:string,data:Buffer){
    const target=path.join(this.dir,name),tmp=target+'.pending';assert.ok(!existsSync(tmp));
    try {writeFileSync(tmp,data,{flag:'wx'});renameSync(tmp,target);}
    catch(e){if(existsSync(tmp))unlinkSync(tmp);throw e;}
    this.files[name]={bytes:data.length,sha256:sha(data)};
  }
  assertReserve(slots:Slot[],names:string[]){
    const worstRecords=slots.map(s=>({id:s.id,kind:s.kind,status:'incomplete',reason:'parent-timeout',file:'task-999999.json',budget:{milliseconds:1e20,hardMilliseconds:1e20,deadlineEpoch:1e20,remainingMilliseconds:1e20}}));
    const files={...this.files,...Object.fromEntries(names.map(n=>[n,{bytes:this.limit,sha256:'f'.repeat(64)}]))};
    const bytes=utf8({formatVersion:2,status:'incomplete',reason:'capacity',records:worstRecords,elapsedMs:1e20,searchDeadline:1e20,missingArtifacts:names}).length+
      utf8({formatVersion:2,limitBytes:this.limit,reservedBytes:this.reserve,totalBytes:this.limit,files:{...files,'status.json':{bytes:this.reserve,sha256:'f'.repeat(64)}}}).length;
    if(bytes>this.reserve)throw new CapacityError('shutdown record/manifest do not fit reserved bytes');
  }
  finish(status:unknown){
    const statusData=utf8(status);let total=this.used+statusData.length;
    let manifest:Buffer;
    for(;;){
      manifest=utf8({formatVersion:2,limitBytes:this.limit,reservedBytes:this.reserve,totalBytes:total,
        files:{...this.files,'status.json':{bytes:statusData.length,sha256:sha(statusData)}}});
      const next=this.used+statusData.length+manifest.length;if(next===total)break;total=next;
    }
    assert.ok(statusData.length+manifest!.length<=this.reserve,'shutdown reserve invariant');
    assert.ok(total<=this.limit,'directory capacity invariant');
    this.data({'status.json':statusData,'manifest.json':manifest!});
    this.put('status.json',statusData);this.put('manifest.json',manifest!);
    return total;
  }
}
export class RunDeadline {
  readonly began:number;readonly deadline:number;halt:Reason|null=null;lastAllowance:Allowance|null=null;
  constructor(readonly milliseconds:number,readonly now=()=>performance.now(),readonly epoch=()=>Date.now()){
    assert.ok(Number.isFinite(milliseconds)&&milliseconds>=0);this.began=now();this.deadline=this.began+milliseconds;
  }
  remaining(){return Math.max(0,this.deadline-this.now());}
  execute(slot:Slot,individual:number,hard:number,run:(s:Slot,a:Allowance)=>TaskResult):TaskResult {
    this.lastAllowance=null;
    if(this.halt)return {status:'missing',reason:this.halt,data:null};
    const left=this.remaining();if(left<1){this.halt='time';return {status:'missing',reason:'time',data:null};}
    const ms=Math.min(left,individual,hard);
    const allowance={milliseconds:ms,hardMilliseconds:Math.floor(ms),deadlineEpoch:this.epoch()+ms,remainingMilliseconds:left};
    if(allowance.hardMilliseconds<1){this.halt='time';return {status:'missing',reason:'time',data:null};}
    this.lastAllowance=allowance;const callDeadline=this.now()+allowance.hardMilliseconds;
    let result:TaskResult;
    try{result=run(slot,allowance);}catch(e){
      const timeout=(e as {code?:string}).code==='ETIMEDOUT';
      result={status:'incomplete',reason:timeout?'parent-timeout':'exception',data:null};
      if(!timeout)this.halt='exception';
    }
    if(this.remaining()<=0){this.halt='time';return {status:'incomplete',reason:'time',data:null};}
    if(this.now()>=callDeadline)return {status:'incomplete',reason:'time',data:null};
    return result;
  }
}
/** No domain calls in shutdown: missing slots are plain metadata, never diagnose(nodes=0). */
export function executeSchedule(store:EvidenceStore,deadline:RunDeadline,slots:Slot[],individual:number,hard:number,
  run:(s:Slot,a:Allowance)=>TaskResult,initial:Record<string,Buffer>,derive:(results:Map<string,TaskResult>)=>Record<string,Buffer>) {
  const plannedNames=slots.map((_,i)=>`task-${i}.json`).concat(Object.keys(initial),['summary.json','comparison.md']);
  store.assertReserve(slots,plannedNames);store.preflight(initial);store.writeBatch(initial);
  const records:TaskRecord[]=[],results=new Map<string,TaskResult>();
  for(const [index,slot] of slots.entries()) {
    const result=deadline.execute(slot,individual,hard,run);
    let file:string|null=null;
    if(result.status!=='missing') {
      try {file=`task-${index}.json`;store.write(file,result);}
      catch(e){deadline.halt=e instanceof CapacityError?'capacity':'exception';file=null;result.status='missing';result.reason=deadline.halt;result.data=null;}
    }
    results.set(slot.id,result);records.push({id:slot.id,kind:slot.kind,status:result.status,reason:result.reason,file,budget:deadline.lastAllowance});
  }
  const missingArtifacts:string[]=[];
  let artifacts:Record<string,Buffer>={};
  try{artifacts=derive(results);}catch{deadline.halt='exception';missingArtifacts.push('summary.json','comparison.md');}
  for(const [name,data] of Object.entries(artifacts)) {
    try{store.writeBatch({[name]:data});}
    catch(e){deadline.halt=e instanceof CapacityError?'capacity':'exception';missingArtifacts.push(name);}
  }
  const complete=records.every(r=>r.status==='completed')&&missingArtifacts.length===0&&!deadline.halt;
  const status={formatVersion:2,status:complete?'completed':'incomplete',reason:deadline.halt??records.find(r=>r.reason)?.reason??null,
    records,missingArtifacts,elapsedMs:deadline.now()-deadline.began,searchDeadline:deadline.deadline};
  store.finish(status);return status;
}
export function auditStore(dir:string){
  const actual=inventory(dir),read=(n:string)=>parse(readFileSync(path.join(dir,n),'utf8'));
  const manifest=read('manifest.json');assert.equal(manifest.formatVersion,2);
  const total=Object.values(actual).reduce((n,f)=>n+f.bytes,0);
  assert.equal(total,manifest.totalBytes);assert.ok(total<=manifest.limitBytes);
  const withoutSelf={...actual};delete withoutSelf['manifest.json'];assert.deepEqual(withoutSelf,manifest.files);
  return {manifest,total,status:read('status.json')};
}
