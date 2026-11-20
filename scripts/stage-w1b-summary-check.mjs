import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess } from './stage-w1b-summary.mjs';
const inventory = {verified:true, tests:[{file:'a.test.ts',name:'same'},{file:'a.test.ts',name:'same'},{file:'b.test.ts',name:'other'}]};
const assertion = name => ({fullName:name,status:'passed'});
const fixture = () => ({numTotalTests:3,numPassedTests:3,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:2,numPassedTestSuites:2,numFailedTestSuites:0,numPendingTestSuites:0,success:true,testResults:[{name:'a.test.ts',status:'passed',assertionResults:[assertion('same'),assertion('same')]},{name:'b.test.ts',status:'passed',assertionResults:[assertion('other')]}]});
const old = (m,r) => m.exitCode===0 && r.numFailedTests===0 ? 'PASS' : 'NONPASS_OR_SIGNAL';
const meta=()=>({exitCode:0,provenanceVerified:true,runtime:{unhandledErrors:[],suites:[{id:'a',file:'a.test.ts',root:true,mode:'run',state:'pass'},{id:'b',file:'b.test.ts',root:true,mode:'run',state:'pass'}]}});
for (const [name,change,expected,oldExpected] of [
 ['zero',r=>{r.testResults=[];r.numTotalTests=0;r.numPassedTests=0;},'INCOMPLETE','PASS'],
 ['missing file',r=>{r.testResults.pop();r.numTotalTests=2;r.numPassedTests=2;},'INCOMPLETE','PASS'],
 ['count mismatch',r=>{r.numPassedTests=2;},'INVALID','PASS'],
 ['unfinished suite',r=>{r.testResults[0].status='running';},'INCOMPLETE','PASS'],
 ['failure with zero exit',r=>{r.testResults[0].assertionResults[0].status='failed';r.numPassedTests=2;r.numFailedTests=1;},'FAIL','NONPASS_OR_SIGNAL'],
 ['normal duplicates',()=>{},'PASS','PASS'],
]) test(name,()=>{const r=fixture();change(r);const m=meta(); assert.equal(old(m,r),oldExpected);const status=assess(m,r,inventory).status; assert.equal(status,expected);});
test('unverified inventory cannot pass',()=>assert.equal(assess({exitCode:0},fixture(),{...inventory,verified:false}).status,'INCOMPLETE'));
test('failure survives contradictory count',()=>{const r=fixture();r.testResults[0].assertionResults[0].status='failed';const a=assess({exitCode:0},r,inventory);assert.equal(a.status,'FAIL');assert.ok(a.invalid.length);});
for(const [name,change] of [
 ['zero suite counts',r=>{for(const k of ['numTotalTestSuites','numPassedTestSuites','numFailedTestSuites','numPendingTestSuites'])r[k]=0;}],
 ['false failed suite',r=>{r.numFailedTestSuites=1;r.numPassedTestSuites=1;}],
 ['runtime extensions',r=>{r.numRuntimeErrorTestSuites=1;r.unhandledErrors=[{message:'synthetic'}];}],
 ['runtime count wrong type',r=>{r.numRuntimeErrorTestSuites='0';}],
 ['runtime errors wrong type',r=>{r.unhandledErrors={};}],
 ['runtime extension contradiction',r=>{r.numRuntimeErrorTestSuites=0;r.unhandledErrors=[{}];}],
]) test(name,()=>{const r=fixture();change(r);assert.equal(assess(meta(),r,inventory).status,'INVALID');});
test('real runtime errors without JSON extensions',()=>{const m=meta();m.runtime.unhandledErrors=[{message:'real sidecar'}];assert.equal(assess(m,fixture(),inventory).status,'INVALID');});
test('external verified flag insufficient',()=>assert.equal(assess({exitCode:0},fixture(),inventory).status,'INCOMPLETE'));
test('malformed nested records rejected',()=>{const r=fixture();r.testResults[0]=null;assert.equal(assess(meta(),r,inventory).status,'INVALID');});
test('malformed inventory rejected',()=>assert.equal(assess(meta(),fixture(),{tests:[null]}).status,'INVALID'));
test('runtime suite failure survives JSON success',()=>{const m=meta();m.runtime.suites[0].state='fail';const a=assess(m,fixture(),inventory);assert.equal(a.status,'FAIL');assert.ok(a.invalid.length);});
