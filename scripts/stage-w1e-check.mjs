import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import fs from 'node:fs';
import {CONTRACT,validate,identity,gate} from './stage-w1e-contract.mjs';
import {digest,requireUnchanged} from './stage-w1b-preflight.mjs';
export function normal() {
  return {contract:CONTRACT,request:{trialId:'fixture-1'},assessment:{status:'CANDIDATE'},usedTrialIds:[],interrupted:false,targets:['old','new'].map((name,i)=>({root:resolve('/fixture',name),pid:100+i,started:'2026-11-16T00:00:00Z',finished:'2026-11-16T00:01:00Z',transitions:[{path:CONTRACT.path,absolute:resolve('/fixture',name,CONTRACT.path),before:null,after:{type:'directory',entries:[]},from:'S1',to:'S2',trialId:'fixture-1',actor:CONTRACT.actor,pid:100+i,at:'2026-11-16T00:00:30Z',residue:{type:'directory',entries:[]}}]}))};
}
const baseline=normal(),seals={request:digest(baseline.request),assessment:digest(baseline.assessment),targets:baseline.targets.map(({transitions,...metadata})=>metadata)};
const outcomes=[];
test('same normal input existing strict RED then candidate GREEN',()=>{const bytes=JSON.stringify(baseline),before=[],after=baseline.targets[0].transitions.map(c=>({path:c.path,type:c.after.type}));assert.throws(()=>requireUnchanged(before,after),/^Error: snapshot changed after collection or execution$/);assert.throws(()=>validate(baseline,seals,{strict:true}),/^Error: STRICT_SEAL$/);assert.equal(validate(baseline,seals).status,'PASS');assert.equal(JSON.stringify(baseline),bytes);outcomes.push({name:'normal',input:baseline,seals,before,after,red:'existing requireUnchanged: snapshot changed after collection or execution',green:'PASS',comparisonSpawns:0});});
const both=(r,fn)=>r.targets.forEach(t=>fn(t.transitions[0],t));
const mutations=[
 ['outside-new-file','OUTSIDE_ALLOWANCE',r=>both(r,c=>{c.path='node_modules/unknown';c.after={type:'file'};})],
 ['unknown-empty-directory','OUTSIDE_ALLOWANCE',r=>both(r,c=>c.path='node_modules/unknown')],
 ['existing-content','EXISTING_MODIFIED',r=>both(r,c=>{c.before={type:'file'};c.after={type:'file',sha256:'bad'};})],
 ['directory-to-file','TYPE_CHANGE',r=>both(r,c=>{c.before={type:'directory'};c.after={type:'file'};})],
 ['symlink-junction-cycle','LINK',r=>both(r,c=>c.after={type:'link',target:'.'})],
 ['asymmetric','ASYMMETRIC',r=>r.targets[1].transitions=[]],
 ['wrong-phase','PHASE',r=>both(r,c=>c.to='S3')],
 ['residue','RESIDUE',r=>both(r,c=>c.residue.entries.push('unexpected'))],
 ['outside-temp-cache','OUTSIDE_SCOPE',r=>both(r,c=>c.path='src/engine.ts')],
 ['other-trial-reuse','ARTIFACT_REUSE',r=>both(r,c=>c.trialId='previous')],
 ['contract-edit','CONTRACT_MODIFIED',r=>r.contract.filesAllowed=1],
 ['request-edit','REQUEST_MODIFIED',r=>r.request.trialId='edited'],
 ['assessment-edit','ASSESSMENT_MODIFIED',r=>r.assessment.status='PASS'],
 ['content-substitution','CONTENT',r=>both(r,c=>c.after.entries.push('malicious.mjs'))],
 ['wrong-producer','ACTOR',r=>both(r,c=>c.actor='unknown-worker')],
 ['wrong-pid','ACTOR',r=>both(r,c=>c.pid=999)],
 ['coherent-pid-edit','TARGET_METADATA',r=>both(r,(c,t)=>{c.pid=999;t.pid=999;})],
 ['interrupted-cleanup','INTERRUPTED_CLEANUP',r=>r.interrupted=true],
 ['output-trial-reuse','TRIAL_REUSE',r=>r.usedTrialIds.push('fixture-1')],
 ['time-outside-window','TIME',r=>both(r,c=>c.at='2026-11-17T00:00:00Z')],
 ['absolute-path-escape','ABSOLUTE_PATH',r=>both(r,c=>c.absolute=resolve('/elsewhere'))],
 ['unknown-content-field','CONTENT',r=>both(r,c=>c.after.extra=true)],
];
for(const [name,reason,mutate] of mutations)test(name,()=>{const r=structuredClone(baseline);mutate(r);assert.throws(()=>validate(r,seals),new RegExp(`^Error: ${reason}$`));outcomes.push({name,reason,input:r,comparisonSpawns:0,scope:'pure-validator; no child process API'});});
const id={actor:{node:'v24.20.0',executable:'/node',executableSha256:'hash',cwd:'/work'},targets:['old','new'].map((label,i)=>({head:String(i).repeat(40),root:`/${label}`,physical:`/${label}`,dependencyPhysical:`/${label}/node_modules`})),bindings:{source:'raw-source-seal',lock:'lock-seal',dependencies:'tree-seal',config:'full-config-seal',inventory:'inventory-seal',versions:{npm:'11.17.0',vitest:'4.1.11'},settings:{maxWorkers:2,testTimeout:5000,environment:'jsdom',cache:true,setupFiles:['/setup.ts']},isolation:['/old-temp','/new-temp']},outputExists:false};
for(const [name,reason,mutate] of [
 ['node-body','IDENTITY_executableSha256',v=>v.actor.executableSha256='changed'],
 ['node-version','IDENTITY_node',v=>v.actor.node='v25'],
 ['node-path','IDENTITY_executable',v=>v.actor.executable='/other-node'],
 ['cwd','IDENTITY_cwd',v=>v.actor.cwd='/other'],
 ['target-order','TARGET_ORDER_OR_HEAD',v=>v.targets.reverse()],
 ['target-head','TARGET_ORDER_OR_HEAD',v=>v.targets[1].head='f'.repeat(40)],
 ['config','ENVIRONMENT_CHANGED',v=>v.bindings.config='edit'],
 ['used-output','OUTPUT_REUSE',v=>v.outputExists=true],
 ])test(name,()=>{const v=structuredClone(id);mutate(v);assert.throws(()=>identity(id,v,{fixture:true}),new RegExp(`^Error: ${reason}$`));outcomes.push({name,reason,comparisonSpawns:0});});
test('real same HEAD rejected; explicit fixture retained',()=>{const v=structuredClone(id);v.targets[1].head=v.targets[0].head;assert.throws(()=>identity(v,v),/^Error: SAME_HEAD$/);assert.equal(identity(v,v,{fixture:true}).status,'PASS');outcomes.push({name:'same-head',reason:'SAME_HEAD',fixture:'PASS',comparisonSpawns:0});});
test('same physical snapshot rejected',()=>{const v=structuredClone(id);v.targets[1].physical=v.targets[0].physical;assert.throws(()=>identity(v,v,{fixture:true}),/^Error: SHARED_SNAPSHOT$/);outcomes.push({name:'same-physical',reason:'SHARED_SNAPSHOT',comparisonSpawns:0});});
test('even complete candidate controls cannot open real admission',()=>{const result=gate({expected:id,current:id,fixture:true,record:baseline,seals});assert.equal(result.status,'NOT_READY');assert.equal(result.comparisonSpawns,0);outcomes.push({name:'gate',result});});
process.on('exit',()=>{if(process.env.W1E_OUTCOMES)fs.writeFileSync(process.env.W1E_OUTCOMES,JSON.stringify({scope:'synthetic controls, not Windows runtime provenance',outcomes},null,2)+'\n',{flag:'wx'});});
