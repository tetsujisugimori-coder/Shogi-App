// Observes public Node APIs in this PID. Native/worker/other-process writers remain UNKNOWN.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {resolve,join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {hash} from './stage-w1b-preflight.mjs';
export function observe({out,roots,runId,trialId,head,preSeal}) {
  const append=fs.appendFileSync.bind(fs),read=fs.readFileSync.bind(fs),stat=fs.lstatSync.bind(fs),exists=fs.existsSync.bind(fs),real=fs.realpathSync.bind(fs);
  fs.writeFileSync(out,'',{flag:'wx'});
  let seq=0,busy=false,ioMs=0,bytesRead=0;const restores=[],fds=new Map();
  const pathOf=p=>typeof p==='number'?fds.get(p):p instanceof URL?fileURLToPath(p):typeof p==='string'||Buffer.isBuffer(p)?resolve(String(p)):undefined;
  const inside=p=>p&&roots.some(r=>p===resolve(r)||p.startsWith(resolve(r)+(process.platform==='win32'?'\\':'/')));
  function snapshot(p){const prev=busy;busy=true;try{return snapshotRaw(p);}finally{busy=prev;}}
  function snapshotRaw(p){if(!p)return null;try{const s=stat(p);if(s.isSymbolicLink())return {type:'link'};if(s.isDirectory())return {type:'directory',entries:fs.readdirSync(p).sort()};if(!s.isFile())return {type:'unsupported'};const b=read(p);bytesRead+=b.length;return {type:'file',size:b.length,sha256:hash(b),base64:b.toString('base64')};}catch(e){return {type:e.code==='ENOENT'?'absent':'UNKNOWN',error:e.code};}}
  function log(v){if(busy)return;busy=true;const start=performance.now();try{append(out,JSON.stringify({seq:++seq,runId,trialId,head,pid:process.pid,wall:new Date().toISOString(),monoNs:process.hrtime.bigint().toString(),clockDomain:`pid:${process.pid}`,preSeal,method:'public-node-api',limits:'not OS-wide; previously captured bindings/native/worker APIs may bypass wrappers; snapshots non-atomic',...v})+'\n');}finally{ioMs+=performance.now()-start;busy=false;}}
  function wrap(obj,name,kind){const original=obj[name];if(typeof original!=='function')return;restores.push(()=>obj[name]=original);obj[name]=function(...args){if(busy)return original.apply(this,args);const p=pathOf(args[0]),q=name.startsWith('rename')||name.startsWith('copyFile')||name.startsWith('link')?pathOf(args[1]):undefined;if(!inside(p)&&!inside(q))return original.apply(this,args);const callId=seq+1,op=name.replace(/Sync$/,'');log({phase:'invoke',callId,api:kind,operation:op,path:p,beforePath:q?p:undefined,afterPath:q,state:snapshot(p),destination:q?snapshot(q):undefined,stack:new Error().stack});
    const done=(err,value)=>{if(!err&&op==='open'){const fd=typeof value==='number'?value:value?.fd;if(fd!==undefined)fds.set(fd,p);if(value&&typeof value==='object')for(const method of ['write','writeFile','appendFile','read','readFile','truncate','sync','close']){const fn=value[method];if(typeof fn!=='function')continue;value[method]=async function(...a){const id=seq+1;log({phase:'invoke',callId:id,api:'FileHandle',operation:method,path:p,state:snapshot(p),stack:new Error().stack});try{const handleFd=value.fd;const v=await fn.apply(this,a);if(method==='close')fds.delete(handleFd);log({phase:'complete',callId:id,api:'FileHandle',operation:method,path:p,state:snapshot(p),ok:true});return v;}catch(e){log({phase:'complete',callId:id,api:'FileHandle',operation:method,path:p,ok:false,error:String(e)});throw e;}};}}
      log({phase:'complete',callId,api:kind,operation:op,path:p,beforePath:q?p:undefined,afterPath:q,state:snapshot(p),destination:q?snapshot(q):undefined,ok:!err,error:err?String(err):undefined});if(!err&&op==='close')fds.delete(args[0]);};
    try{if(kind==='callback'&&typeof args.at(-1)==='function'){const cb=args.at(-1);args[args.length-1]=function(err,v,...rest){done(err,v);return cb.call(this,err,v,...rest);};return original.apply(this,args);}const v=original.apply(this,args);if(kind==='promise')return v.then(r=>{done(null,r);return r;},e=>{done(e);throw e;});done(null,v);return v;}catch(e){done(e);throw e;}
  };}
  for(const n of ['mkdir','writeFile','appendFile','write','rename','unlink','rmdir','rm','open','close','readFile','read','truncate','copyFile','link','symlink']){wrap(fs,n+'Sync','sync');wrap(fs,n,'callback');wrap(fs.promises,n,'promise');}
  syncBuiltinESMExports();
  return {finish(extra={}){log({phase:'observer-close',operation:'close',openDescriptors:[...fds],residue:roots.map(path=>({path,state:snapshot(path)})),...extra});for(const restore of restores.reverse())restore();syncBuiltinESMExports();return {ioMs,bytesRead,memory:process.memoryUsage(),observer:'instrumented only; overhead has no uninstrumented baseline',physicalRoots:roots.map(p=>exists(p)?real(p):null)};}};
}
