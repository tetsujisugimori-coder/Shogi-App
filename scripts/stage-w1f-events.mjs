import {hash,digest} from './stage-w1b-preflight.mjs';
// Reconstruct actual invoke/complete pairs. This never asserts exclusive OS ownership.
export function analyzeEvents(events,expected){
 const reasons=[],calls=new Map(),known=new Set(['mkdir','writeFile','appendFile','write','rename','unlink','rmdir','rm','open','close','readFile','read','truncate','copyFile','link','symlink','sync']);let previous=0n;
 const check=(ok,reason)=>{if(!ok)reasons.push(reason);};
 for(let i=0;i<events.length;i++){
  const v=events[i];check(v.seq===i+1,'EVENT_ORDER');
  check(known.has(v.operation),'UNKNOWN_OPERATION');
  check(['invoke','complete','observer-close'].includes(v.phase),'UNKNOWN_PHASE');
  for(const [k,reason] of [['runId','EVENT_RUN'],['trialId','EVENT_TRIAL'],['head','EVENT_HEAD'],['preSeal','EVENT_SEAL']])check(v[k]===expected[k],reason);
  check(v.pid===expected.pid,'EVENT_PID');check(v.clockDomain===`pid:${expected.pid}`,'CLOCK_DOMAIN');
  const n=/^\d+$/.test(v.monoNs??'')?BigInt(v.monoNs):0n;check(n>previous,'MONOTONIC_ORDER');previous=n;
  check(Number.isFinite(Date.parse(v.wall))&&Date.parse(v.wall)>=Date.parse(expected.started)&&Date.parse(v.wall)<=Date.parse(expected.finished),'EVENT_WINDOW');
  for(const s of [v.state,v.destination]){if(s?.type==='file')check(typeof s.base64==='string'&&hash(Buffer.from(s.base64,'base64'))===s.sha256&&Buffer.from(s.base64,'base64').length===s.size,'RAW_BYTES_HASH');if(s?.type==='UNKNOWN'||s?.type==='link'||s?.type==='unsupported')check(false,'UNSUPPORTED_STATE');}
  if(v.phase==='observer-close'){check(v.operation==='close','CLOSE_OPERATION');check(Array.isArray(v.openDescriptors)&&v.openDescriptors.length===0,'OPEN_DESCRIPTORS');check(!v.cleanupErrors?.length,'CLOSE_ERRORS');check(Array.isArray(v.residue),'RESIDUE_MISSING');}
  if(v.phase==='invoke'){check(!calls.has(v.callId),'DUPLICATE_CALL');calls.set(v.callId,{invoke:v});}
  else if(v.phase==='complete'){const c=calls.get(v.callId);check(c&&!c.complete,'MISSING_INVOKE');if(c){check(['operation','api','path','beforePath','afterPath'].every(k=>v[k]===c.invoke[k]),'OPERATION_BINDING');c.complete=v;check(v.ok===true,'OPERATION_FAILED');}}
 }
 check(events.at(-1)?.phase==='observer-close','CLOSE_MISSING');
 for(const c of calls.values())check(!!c.complete,'MISSING_COMPLETE');
 const list=[...calls.values()],renames=list.filter(c=>c.invoke.operation==='rename').map(c=>{
  const a=c.invoke,b=c.complete;
  const writes=list.filter(w=>w.invoke.operation==='writeFile'&&w.invoke.path===a.beforePath&&w.complete?.seq<a.seq&&w.complete.ok);
  const reads=list.filter(w=>w.invoke.operation==='readFile'&&w.invoke.path===a.afterPath&&w.invoke.seq>(b?.seq??Infinity));
  const readOrigin=w=>!w.invoke.stack?'UNKNOWN':/stage-w1e-observation|stage-w1b-preflight|saveState/.test(w.invoke.stack)?'evidence-sampler':'application-public-api';
  const consumerReads=reads.filter(r=>readOrigin(r)==='application-public-api');
  const deletes=list.filter(w=>w.invoke.operation==='unlink'&&w.invoke.path===a.afterPath&&w.invoke.seq>(b?.seq??Infinity)&&w.complete?.ok);
  const bytesBound=a.state?.type==='file'&&b?.ok&&b?.state?.type==='absent'&&b?.destination?.sha256===a.state.sha256&&writes.at(-1)?.complete?.state?.sha256===a.state.sha256;
  const observedChain=!!(bytesBound&&consumerReads.some(r=>r.complete?.ok&&r.invoke.state?.type==='file'&&r.complete.state?.type==='file'&&r.invoke.state.sha256===a.state.sha256&&r.complete.state.sha256===a.state.sha256&&deletes.some(d=>r.complete.seq<d.invoke.seq&&d.invoke.state?.type==='file'&&d.invoke.state.sha256===a.state.sha256&&d.complete?.state?.type==='absent')));
  if(!observedChain)check(false,'LIFECYCLE_INCOMPLETE');
  return {callId:a.callId,from:a.beforePath,to:a.afterPath,invokeSeq:a.seq,completeSeq:b?.seq,writeCalls:writes.map(w=>w.invoke.callId),readCalls:reads.map(w=>({callId:w.invoke.callId,origin:readOrigin(w)})),deleteCalls:deletes.map(w=>w.invoke.callId),bytesBound,observedChain,'readMeaning':'API and stack only; semantic consumption not proven','atomicOSRename':'UNKNOWN','exclusiveWriter':'UNKNOWN'};
 });
 return {status:reasons.length?'UNKNOWN':'PASS',scope:'instrumented PID public-API consistency only',reasons:[...new Set(reasons)],calls:list.length,events:events.length,renames,exclusiveWriter:'UNKNOWN',atomicOSRename:'UNKNOWN',comparisonSpawns:0};
}
