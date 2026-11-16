// Candidate allowance is deliberately narrower than a real Vitest lifecycle.
// This module never spawns a process. Production runner seals are unchanged.
import fs from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {digest,hash,physical} from './stage-w1b-preflight.mjs';
import {cacheIdentity} from './stage-w1f-cache.mjs';
export const CONTRACT=Object.freeze({version:1,path:'node_modules/.vite-temp',type:'directory',from:'S1',to:'S2',operation:'mkdir',content:'empty',actor:'instrumented-node-api',residue:'empty-directory-at-close',reuse:false,asymmetry:false,filesAllowed:0});
export const CONTRACT_SHA=digest(CONTRACT);
export function actor() {return {node:process.version,executable:fs.realpathSync(process.execPath),executableSha256:hash(fs.readFileSync(process.execPath)),cwd:fs.realpathSync(process.cwd())};}
const fail=code=>{throw Error(code);};
const same=(a,b,code)=>{if(digest(a)!==digest(b))fail(code);};
export function validate(record,seals,{strict=false}={}) {
  same(record.contract,CONTRACT,'CONTRACT_MODIFIED');same(digest(record.request),seals.request,'REQUEST_MODIFIED');same(digest(record.assessment),seals.assessment,'ASSESSMENT_MODIFIED');
  if(record.interrupted)fail('INTERRUPTED_CLEANUP');
  const {trialId}=record.request;if(!trialId||record.usedTrialIds.includes(trialId))fail('TRIAL_REUSE');
  if(record.targets.length!==2)fail('PAIR_COUNT');
  same(record.targets.map(({transitions,...metadata})=>metadata),seals.targets,'TARGET_METADATA');
  const [a,b]=record.targets;
  const symmetric=t=>t.transitions.map(({absolute,pid,at,...v})=>v);
  same(symmetric(a),symmetric(b),'ASYMMETRIC');
  for(const target of record.targets) {
    for(const change of target.transitions) {
      if(change.before!==null)fail(change.before.type!==change.after?.type?'TYPE_CHANGE':'EXISTING_MODIFIED');
      if(change.after?.type==='link')fail('LINK');
      if(change.path!==CONTRACT.path)fail(change.path.startsWith('node_modules/')?'OUTSIDE_ALLOWANCE':'OUTSIDE_SCOPE');
      if(strict)fail('STRICT_SEAL');
      if(change.after?.type!=='directory')fail('CONTENT');
      same(change.after,{type:'directory',entries:[]},'CONTENT');
      if(change.from!=='S1'||change.to!=='S2')fail('PHASE');
      if(change.trialId!==trialId)fail('ARTIFACT_REUSE');
      if(change.actor!==CONTRACT.actor||change.pid!==target.pid||!Number.isSafeInteger(change.pid)||change.pid<=0)fail('ACTOR');
      if(![change.at,target.started,target.finished].every(v=>Number.isFinite(Date.parse(v)))||Date.parse(target.started)>Date.parse(target.finished)||Date.parse(change.at)<Date.parse(target.started)||Date.parse(change.at)>Date.parse(target.finished))fail('TIME');
      same(change.residue,{type:'directory',entries:[]},'RESIDUE');
      const r=relative(resolve(target.root),resolve(change.absolute));if(isAbsolute(r)||r.replaceAll('\\','/')!==CONTRACT.path)fail('ABSOLUTE_PATH');
      same(Object.keys(change).sort(),['path','absolute','before','after','from','to','trialId','actor','pid','at','residue'].sort(),'UNKNOWN_FIELD');
    }
    if(target.transitions.length!==1)fail('TRANSITION_COUNT');
  }
  return {status:'PASS',scope:'candidate endpoint-directory allowance only; not production admission',comparisonSpawns:0};
}
export function identity(expected,current,{fixture=false}={}) {
  for(const k of ['node','executable','executableSha256','cwd'])same(expected.actor[k],current.actor[k],`IDENTITY_${k}`);
  same(expected.targets,current.targets,'TARGET_ORDER_OR_HEAD');
  const [a,b]=current.targets;if(!a||!b||current.targets.length!==2)fail('PAIR_COUNT');
  if(!fixture&&a.head===b.head)fail('SAME_HEAD');
  if(a.root===b.root||a.physical===b.physical||a.dependencyPhysical===b.dependencyPhysical)fail('SHARED_SNAPSHOT');
  for(const [left,right] of [[a.physical,b.physical],[a.dependencyPhysical,b.dependencyPhysical]])if(left.startsWith(right+'/')||right.startsWith(left+'/'))fail('NESTED_SNAPSHOT');
  if(!fixture)for(const t of current.targets) {
    if(fs.lstatSync(t.root).isSymbolicLink()||fs.lstatSync(join(t.root,'node_modules')).isSymbolicLink())fail('SNAPSHOT_LINK');
    same(physical(t.root).replaceAll('\\','/'),t.physical,'PHYSICAL_CHANGED');same(physical(join(t.root,'node_modules')).replaceAll('\\','/'),t.dependencyPhysical,'PHYSICAL_CHANGED');
  }
  same(expected.bindings,current.bindings,'ENVIRONMENT_CHANGED');
  const s=current.bindings.settings;if(s.maxWorkers!==2||s.testTimeout!==5000||s.environment!=='jsdom'||!s.setupFiles?.length)fail('SETTINGS');
  // Boolean true is retained only for legacy synthetic fixtures. A live resolved
  // cache must provide its directory and be checked against the physical snapshot.
  if(!(fixture&&s.cache===true))cacheIdentity(s,a.root,{fixture});
  if(current.outputExists)fail('OUTPUT_REUSE');
  return {status:'PASS',fixture};
}
export function gate(input) {
  // Even verified directory creation cannot excuse transformed TEMP files or result caches.
  // No READY or spawn implementation exists in W1e. An independently reviewed future
  // implementation is required to bind live OS provenance and all cache semantics.
  identity(input.expected,input.current,{fixture:input.fixture===true});
  validate(input.record,input.seals);
  return {status:'NOT_READY',comparison:'NOT_TESTED',comparisonSpawns:0,S4:'NOT_TESTED',S5:'NOT_TESTED',blocking:['TEMP producer attribution/lifecycle completeness UNKNOWN','Vitest duration/result cache allowance NOT_ESTABLISHED','independent real admission validation required']};
}
