import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {observe} from './stage-w1f-observer.mjs';
import {analyzeEvents} from './stage-w1f-events.mjs';
import {cacheIdentity} from './stage-w1f-cache.mjs';
test('real sync callback promise FileHandle APIs and raw-event mutation reasons',async()=>{
 const root=fs.mkdtempSync(join(process.env.W1F_WORK_ROOT??tmpdir(),'w1f-observer-')),scope=join(root,'scope'),out=join(root,'events.jsonl');fs.mkdirSync(scope);
 const started=new Date().toISOString(),expected={pid:process.pid,runId:'self-test',trialId:'one',head:'1'.repeat(40),preSeal:'pre',started};
 const o=observe({out,roots:[scope],...expected});
 for(const kind of ['sync','callback','promise']){
  const a=join(scope,kind+'.tmp'),b=join(scope,kind+'.final');
  if(kind==='sync'){fs.writeFileSync(a,'bytes');fs.renameSync(a,b);assert.equal(fs.readFileSync(pathToFileURL(b),'utf8'),'bytes');fs.unlinkSync(b);}
  if(kind==='callback')for(const [name,args] of [['writeFile',[a,'bytes']],['rename',[a,b]],['readFile',[b]],['unlink',[b]]])await new Promise((yes,no)=>fs[name](...args,(e,v)=>e?no(e):yes(v)));
  if(kind==='promise'){await fs.promises.writeFile(a,'bytes');await fs.promises.rename(a,b);assert.equal(await fs.promises.readFile(b,'utf8'),'bytes');await fs.promises.unlink(b);}
 }
 const h=await fs.promises.open(join(scope,'handle'),'w+');await h.writeFile('handle');await h.close();
 fs.mkdirSync(join(scope,'dir'));fs.rmdirSync(join(scope,'dir'));
 o.finish();expected.finished=new Date().toISOString();
 const events=fs.readFileSync(out,'utf8').trim().split('\n').map(JSON.parse),result=analyzeEvents(events,expected);
 assert.deepEqual(result.reasons,[]);assert.equal(result.renames.length,3);assert.ok(result.renames.every(r=>r.observedChain));
 assert.deepEqual(events.at(-1).openDescriptors,[]);
 for(const [reason,mutate] of [['EVENT_PID',e=>e[0].pid++],['EVENT_TRIAL',e=>e[0].trialId='other'],['EVENT_ORDER',e=>e.reverse()],['RAW_BYTES_HASH',e=>e.find(v=>v.state?.type==='file').state.base64='eA=='],['MISSING_COMPLETE',e=>e.splice(e.findIndex(v=>v.phase==='complete'),1)],['OPERATION_BINDING',e=>e.find(v=>v.phase==='complete').operation='fake'],['UNKNOWN_OPERATION',e=>e.filter(v=>v.operation==='rename').forEach(v=>v.operation='invented')],['CLOSE_ERRORS',e=>e.at(-1).cleanupErrors=['failed']],['OPEN_DESCRIPTORS',e=>e.at(-1).openDescriptors=[3]],['LIFECYCLE_INCOMPLETE',e=>e.find(v=>v.operation==='readFile'&&v.phase==='complete').state={type:'absent'}],['LIFECYCLE_INCOMPLETE',e=>e.find(v=>v.operation==='unlink'&&v.phase==='invoke').state={type:'absent'}]]){const copy=structuredClone(events);mutate(copy);assert.ok(analyzeEvents(copy,expected).reasons.includes(reason),reason);}
});
test('live cache directory substitution and type',()=>{const root=fs.mkdtempSync(join(process.env.W1F_WORK_ROOT??tmpdir(),'w1f-cache-')),p=join(root,'cache');fs.mkdirSync(p);const settings={cache:{dir:p},cacheDir:p};assert.equal(cacheIdentity(settings,root).enabled,true);assert.throws(()=>cacheIdentity({...settings,cacheDir:join(root,'other')},root),/CACHE_PATH/);fs.writeFileSync(join(root,'file'),'x');assert.throws(()=>cacheIdentity({cache:{dir:join(root,'file')},cacheDir:join(root,'file')},root),/CACHE_TYPE/);});
test('live junction including dangling target', {skip:process.platform==='win32'&&process.env.W1F_LINK_TEST!=='1'},()=>{const root=fs.mkdtempSync(join(process.env.W1F_WORK_ROOT??tmpdir(),'w1f-link-')),target=join(root,'target'),p=join(root,'cache');fs.mkdirSync(target);fs.symlinkSync(target,p,process.platform==='win32'?'junction':'dir');const s={cache:{dir:p},cacheDir:p};assert.throws(()=>cacheIdentity(s,root),/CACHE_LINK/);fs.renameSync(target,join(root,'target-retained'));assert.throws(()=>cacheIdentity(s,root),/CACHE_LINK/);});
