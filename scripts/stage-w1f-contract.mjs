import {digest,hash} from './stage-w1b-preflight.mjs';
import {cacheIdentity,cachePair,requireExactCache} from './stage-w1f-cache.mjs';
const fail=r=>{throw Error(r);};
const same=(a,b,r)=>{if(digest([a])!==digest([b]))fail(r);};
export const POLICY=Object.freeze({version:1,scope:'synthetic lifecycle validator only',operations:['writeFile','rename','readFile','unlink'],residue:'absent',native:'UNKNOWN',cache:'exact bytes only',admission:'NOT_READY'});
export function verify(record,trusted){
  same(record.policy,POLICY,'POLICY');
  for(const k of ['request','assessment','identity','bindings','output'])same(record[k],trusted[k],k.toUpperCase());
  if(record.output.exists)fail('OUTPUT_REUSE');
  if(record.interrupted)fail('CLOSE_INTERRUPTED');
  if(record.targets.length!==2)fail('PAIR');
  const caches=[];
  for(let i=0;i<2;i++){
    const t=record.targets[i],e=trusted.targets[i];same(t.metadata,e.metadata,'TARGET');
    caches.push(cacheIdentity(t.settings,t.metadata.root,{fixture:record.fixture===true}));same(t.settings,e.settings,'SETTINGS');same(caches[i],e.cache,'CACHE_PHYSICAL');
    requireExactCache(t.resultCache,e.resultCache);
    if(t.writerCoverage!=='instrumented-only')fail('WRITER_COVERAGE');
    if(!t.close.ok)fail('CLOSE_FAILED');same(t.residue,{type:'absent'},'RESIDUE');
    if(t.events.length!==8)fail('EVENT_MISSING');
    const ops=['writeFile','rename','readFile','unlink'];
    for(let j=0;j<8;j++){
      const v=t.events[j],want=e.events[j];
      if(v.seq!==j+1)fail('EVENT_ORDER');
      if(v.pid!==t.metadata.pid)fail('EVENT_PID');
      if(v.runId!==record.request.runId||v.trialId!==record.request.trialId)fail('EVENT_TRIAL');
      if(v.head!==t.metadata.head||v.preSeal!==t.metadata.preSeal)fail('EVENT_SEAL');
      if(v.operation!==ops[Math.floor(j/2)]||v.phase!==(j%2?'complete':'invoke'))fail('EVENT_OPERATION');
      if(!Number.isFinite(Date.parse(v.wall))||Date.parse(v.wall)<Date.parse(t.metadata.started)||Date.parse(v.wall)>Date.parse(t.metadata.finished))fail('EVENT_WINDOW');
      if(v.clockDomain!==`pid:${v.pid}`||!/^\d+$/.test(v.monoNs)||j&&BigInt(v.monoNs)<=BigInt(t.events[j-1].monoNs))fail('EVENT_CLOCK');
      for(const k of ['path','beforePath','afterPath'])same(v[k],want[k],`EVENT_${k.toUpperCase()}`);
      if(v.base64!==undefined&&hash(Buffer.from(v.base64,'base64'))!==v.sha256)fail('EVENT_BYTES_HASH');
      same(v,want,'EVENT_CONTENT');
    }
  }
  cachePair(...caches);
  return {status:'PASS',scope:POLICY.scope,comparisonSpawns:0,exclusiveWriter:'UNKNOWN'};
}
export function gate(record,trusted){verify(record,trusted);return {status:'NOT_READY',outcome:'B',comparison:'NOT_TESTED',comparisonSpawns:{old:0,new:0},blocking:['exclusive OS writer UNKNOWN','full effective config UNKNOWN','result cache semantic equivalence UNKNOWN','independent real admission NOT_ESTABLISHED']};}
