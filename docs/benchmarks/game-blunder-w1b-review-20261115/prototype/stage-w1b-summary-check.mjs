import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess } from './stage-w1b-summary.mjs';
const inventory = {verified:true, tests:[{file:'a.test.ts',name:'same'},{file:'a.test.ts',name:'same'},{file:'b.test.ts',name:'other'}]};
const assertion = name => ({fullName:name,status:'passed'});
const fixture = () => ({numTotalTests:3,numPassedTests:3,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:2,numPassedTestSuites:2,numFailedTestSuites:0,numPendingTestSuites:0,success:true,testResults:[{name:'a.test.ts',status:'passed',assertionResults:[assertion('same'),assertion('same')]},{name:'b.test.ts',status:'passed',assertionResults:[assertion('other')]}]});
const old = (m,r) => m.exitCode===0 && r.numFailedTests===0 ? 'PASS' : 'NONPASS_OR_SIGNAL';
for (const [name,change,expected,oldExpected] of [
 ['zero',r=>{r.testResults=[];r.numTotalTests=0;r.numPassedTests=0;},'INCOMPLETE','PASS'],
 ['missing file',r=>{r.testResults.pop();r.numTotalTests=2;r.numPassedTests=2;},'INCOMPLETE','PASS'],
 ['count mismatch',r=>{r.numPassedTests=2;},'INVALID','PASS'],
 ['unfinished suite',r=>{r.testResults[0].status='running';},'INCOMPLETE','PASS'],
 ['failure with zero exit',r=>{r.testResults[0].assertionResults[0].status='failed';r.numPassedTests=2;r.numFailedTests=1;},'FAIL','NONPASS_OR_SIGNAL'],
 ['normal duplicates',()=>{},'PASS','PASS'],
]) test(name,()=>{const r=fixture();change(r);const m={exitCode:0}; assert.equal(old(m,r),oldExpected);assert.equal(assess(m,r,inventory).status,expected);});
test('unverified inventory cannot pass',()=>assert.equal(assess({exitCode:0},fixture(),{...inventory,verified:false}).status,'INCOMPLETE'));
test('failure survives contradictory count',()=>{const r=fixture();r.testResults[0].assertionResults[0].status='failed';const a=assess({exitCode:0},r,inventory);assert.equal(a.status,'FAIL');assert.ok(a.invalid.length);});
