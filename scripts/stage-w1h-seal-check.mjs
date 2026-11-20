import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as gate from './stage-w1g-gate.mjs';
const {sha,digest}=gate;
export function fixture(){
 const at=1800000000000;
 const input={scope:'synthetic',challenge:'nonce-01',at,actor:{id:'actor-A',instance:'session-A'},
  targets:[{head:'a'.repeat(40),tree:'b'.repeat(40)}],source:sha('source'),dependency:sha('dependency'),environment:sha('environment')};
 const seal=gate.createSourceSeal(input); const bytes=Buffer.from(JSON.stringify(seal,null,2)+'\n');
 const expected={...input,rawSha256:sha(bytes),structuredDigest:digest(seal),usedChallenge:false,freshOutput:true};
 const start={stage:'start',at:at+1,seal:sha(bytes),challenge:input.challenge,actor:input.actor};
 const finish={...start,stage:'close',at:at+2,status:'PASS',cleanExit:true};
 return {bytes,expected,transcript:{start,finish},now:at+3};
}
const evaluate=f=>gate.assessSealed(f);
test('generated source seal roundtrip uses shared raw-byte contract',()=>{const f=fixture();assert.equal(evaluate(f).status,'PASS');assert.equal(evaluate(f).permit,false);});
const cases=[
 ['JSON changed',f=>{const s=JSON.parse(f.bytes);s.source=sha('edited');f.bytes=Buffer.from(JSON.stringify(s));},'SOURCE_SEAL_CHANGED'],
 ['raw whitespace changed',f=>{f.bytes=Buffer.concat([f.bytes,Buffer.from(' ')]);},'SOURCE_SEAL_CHANGED'],
 ['schema mismatch',f=>change(f,s=>s.schema='other'),'SEAL_SCHEMA_INVALID'],
 ['missing field',f=>change(f,s=>delete s.environment),'SEAL_SCHEMA_INVALID'],
 ['null field',f=>change(f,s=>s.dependency=null),'SEAL_SCHEMA_INVALID'],
 ['wrong type',f=>change(f,s=>s.at='1800000000000'),'SEAL_SCHEMA_INVALID'],
 ['source rebind',f=>f.expected.source=sha('another'),'SOURCE_READBACK_CHANGED'],
 ['dependency rebind',f=>f.expected.dependency=sha('another'),'DEPENDENCY_CHANGED'],
 ['environment rebind',f=>f.expected.environment=sha('another'),'ENVIRONMENT_CHANGED'],
 ['HEAD rebind',f=>f.expected.targets=[{head:'c'.repeat(40),tree:'b'.repeat(40)}],'TARGET_CHANGED'],
 ['tree rebind',f=>f.expected.targets=[{head:'a'.repeat(40),tree:'c'.repeat(40)}],'TARGET_CHANGED'],
 ['challenge reuse',f=>f.expected.usedChallenge=true,'PRESEAL_REUSED'],
 ['stale seal',f=>f.now+=300000,'ATTESTATION_STALE'],
 ['actor rebind',f=>f.expected.actor={id:'actor-B',instance:'session-A'},'PROCESS_IDENTITY_MISMATCH'],
 ['time order',f=>f.transcript.finish.at=f.transcript.start.at-1,'INCOMPLETE_CLOSE'],
 ['incomplete close',f=>delete f.transcript.finish,'INCOMPLETE_CLOSE'],
 ['synthetic carried to live',f=>f.expected.scope='inspection','SCOPE_CHANGED'],
 ['digest confused with raw hash',f=>f.expected.rawSha256=f.expected.structuredDigest,'SOURCE_SEAL_CHANGED'],
 ['start rebound',f=>f.transcript.start.seal=sha('other'),'SEAL_EVENT_ORDER'],
 ['finish actor rebound',f=>f.transcript.finish.actor={id:'other',instance:'other'},'PROCESS_IDENTITY_MISMATCH'],
 ['output reused',f=>f.expected.freshOutput=false,'OUTPUT_REUSED'],
 ['expected missing',f=>{f.expected=null;},'EXPECTED_CONTRACT_INVALID'],
 ['bytes missing',f=>{f.bytes=null;},'SOURCE_SEAL_MISSING'],
];
function change(f,fn){const s=JSON.parse(f.bytes);fn(s);f.bytes=Buffer.from(JSON.stringify(s));f.expected.rawSha256=sha(f.bytes);f.expected.structuredDigest=digest(s);}
for(const [name,mutate,reason]of cases)test(name,()=>{const f=fixture();mutate(f);const r=evaluate(f);assert.notEqual(r.status,'PASS');assert.ok(r.reasons.includes(reason),JSON.stringify(r));assert.equal(r.permit,false);});
test('production gate remains blocked after synthetic success',()=>{assert.equal(evaluate(fixture()).status,'PASS');const g=gate.fixedComparisonGate({status:'READY',authorized:true});assert.equal(g.status,'BLOCKED');assert.equal(g.comparison.authorized,false);});

test('target OID arrays must not coerce to valid string hashes',()=>{
  for(const key of ['head','tree']) {
    const f=fixture();const seal=JSON.parse(f.bytes);seal.targets[0][key]=[seal.targets[0][key]];
    assert.throws(()=>gate.createSourceSeal(seal),/SEAL_SCHEMA_INVALID/);
    f.bytes=Buffer.from(JSON.stringify(seal));f.expected.rawSha256=sha(f.bytes);f.expected.structuredDigest=digest(seal);
    f.expected.targets=seal.targets;
    const r=evaluate(f);assert.equal(r.status,'INVALID');assert.ok(r.reasons.includes('SEAL_SCHEMA_INVALID'));
  }
});
