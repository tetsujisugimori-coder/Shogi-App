import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {POLICY,verify,gate} from './stage-w1f-contract.mjs';
import {cacheIdentity} from './stage-w1f-cache.mjs';
import {hash} from './stage-w1b-preflight.mjs';
export function normal(){return {fixture:true,policy:POLICY,request:{runId:'w1f-synthetic',trialId:'trial-1'},assessment:{status:'CANDIDATE'},identity:{node:'v24.20.0',cwd:'/work'},bindings:{source:'raw-blob',lock:'sealed',dependencies:'sealed',config:'sealed',worker:2,timeout:5000,setupFiles:['setup'],TEMP:'isolated',TMP:'isolated',inventory:'sealed'},output:{exists:false},targets:['old','new'].map((label,i)=>{
 const root=resolve('/fixture',label),metadata={root,pid:100+i,head:(i?'2':'1').repeat(40),preSeal:'prior-seal',started:'2026-11-16T00:00:00Z',finished:'2026-11-16T00:01:00Z'},settings={cache:{dir:join(root,'node_modules/.vite/vitest')},cacheDir:join(root,'node_modules/.vite/vitest')};
 const events=Array.from({length:8},(_,j)=>({seq:j+1,pid:metadata.pid,head:metadata.head,preSeal:metadata.preSeal,runId:'w1f-synthetic',trialId:'trial-1',wall:'2026-11-16T00:00:30Z',clockDomain:`pid:${metadata.pid}`,monoNs:String(j+1),operation:['writeFile','rename','readFile','unlink'][Math.floor(j/2)],phase:j%2?'complete':'invoke',path:join(root,j<4?'.tmp-a':'final'),...(j===2||j===3?{beforePath:join(root,'.tmp-a'),afterPath:join(root,'final')} :{}),base64:'YQ==',sha256:hash(Buffer.from('a'))}));
 return {metadata,settings,cache:cacheIdentity(settings,root,{fixture:true}),resultCache:{version:'4.1.11',results:[[':test.ts',{duration:3,failed:false}]]},writerCoverage:'instrumented-only',close:{ok:true},residue:{type:'absent'},events};})};}
const baseline=normal(),trusted=structuredClone(baseline),outcomes=[];
test('normal lifecycle and immutable hard stop',()=>{assert.equal(verify(baseline,trusted).status,'PASS');assert.equal(gate(baseline,trusted).status,'NOT_READY');outcomes.push({name:'normal',status:'PASS',gate:gate(baseline,trusted)});});
const both=(r,f)=>r.targets.forEach(f);
const cases=[
 ['cache-type','CACHE_SHAPE',r=>both(r,t=>t.settings.cache=true)],
 ['cache-value','SETTINGS',r=>both(r,t=>{t.settings.cache.dir=join(t.metadata.root,'different');t.settings.cacheDir=t.settings.cache.dir;})],
 ['cache-physical','CACHE_PHYSICAL',r=>{trusted.targets[0].cache.physical='substituted';}],
 ['pid','EVENT_PID',r=>r.targets[0].events[0].pid=999],
 ['operation','EVENT_OPERATION',r=>r.targets[0].events[2].operation='writeFile'],
 ['rename-source','EVENT_BEFOREPATH',r=>r.targets[0].events[2].beforePath='other'],
 ['rename-destination','EVENT_AFTERPATH',r=>r.targets[0].events[2].afterPath='other'],
 ['bytes','EVENT_BYTES_HASH',r=>r.targets[0].events[0].base64='Yg=='],
 ['hash','EVENT_BYTES_HASH',r=>r.targets[0].events[0].sha256='0'.repeat(64)],
 ['event-missing','EVENT_MISSING',r=>r.targets[0].events.pop()],
 ['event-order','EVENT_ORDER',r=>r.targets[0].events.reverse()],
 ['event-window','EVENT_WINDOW',r=>r.targets[0].events[0].wall='2026-11-17T00:00:00Z'],
 ['trial','EVENT_TRIAL',r=>r.targets[0].events[0].trialId='old'],
 ['asymmetric','EVENT_MISSING',r=>r.targets[1].events=[]],
 ['link-junction-cycle','RESIDUE',r=>r.targets[0].residue={type:'link',target:'.'}],
 ['unknown-file','RESIDUE',r=>r.targets[0].residue={type:'file'}],
 ['directory-type','RESIDUE',r=>r.targets[0].residue={type:'directory'}],
 ['cache-failed','CACHE_RESULT_CHANGED',r=>r.targets[0].resultCache.results[0][1].failed=true],
 ['duration','CACHE_RESULT_CHANGED',r=>r.targets[0].resultCache.results[0][1].duration=4],
 ['output-reuse','OUTPUT',r=>r.output.exists=true],
 ['seal','EVENT_SEAL',r=>r.targets[0].events[0].preSeal='other'],
 ['assessment','ASSESSMENT',r=>r.assessment.status='READY'],
 ['request','REQUEST',r=>r.request.trialId='edit'],
 ['node','IDENTITY',r=>r.identity.node='other'],
 ['cwd','IDENTITY',r=>r.identity.cwd='other'],
 ['pair-order','TARGET',r=>r.targets.reverse()],
 ['head','TARGET',r=>r.targets[0].metadata.head='f'.repeat(40)],
 ['close-failure','CLOSE_FAILED',r=>r.targets[0].close.ok=false],
 ['interrupted','CLOSE_INTERRUPTED',r=>r.interrupted=true],
 ['unobserved-writer','WRITER_COVERAGE',r=>r.targets[0].writerCoverage='unknown'],
 ['monotonic-domain','EVENT_CLOCK',r=>r.targets[0].events[0].clockDomain='pid:other'],
 ['coherent-bytes-edit','EVENT_CONTENT',r=>{const v=r.targets[0].events[0];v.base64='Yg==';v.sha256=hash(Buffer.from('b'));}],
];
for(const [name,reason,mutate] of cases)test(name,()=>{Object.assign(trusted,structuredClone(baseline));const r=structuredClone(baseline);mutate(r);assert.throws(()=>verify(r,trusted),e=>e.message===reason);outcomes.push({name,expectedReason:reason,actualReason:reason,status:'PASS',comparisonSpawns:0});});
process.on('exit',()=>{if(process.env.W1F_OUTCOMES)fs.writeFileSync(process.env.W1F_OUTCOMES,JSON.stringify({scope:'synthetic only, expected rejection reasons asserted',outcomes},null,2)+'\n',{flag:'wx'});});
