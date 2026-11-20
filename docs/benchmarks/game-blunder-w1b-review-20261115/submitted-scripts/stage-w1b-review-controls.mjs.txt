// Reproducible isolated fixtures. Never edits the old snapshots or .tmp-tests entries.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, cpSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { prepare, launch } from './stage-w1b-runner.mjs';
import { hash, read } from './stage-w1b-preflight.mjs';
const output=resolve(process.argv[2]), fixtureRoot=resolve(process.argv[3]);
mkdirSync(output);mkdirSync(fixtureRoot);
const write=(p,o)=>writeFileSync(p,JSON.stringify(o,null,2)+'\n');
const evidence=resolve('docs/benchmarks/game-blunder-w1b-review-20261115');
const baseline=join(evidence,'prototype/stage-w1b-summary.mjs');
const outcomes=[];
for(const name of ['normal','duplicates','zero-suites','false-failed-suite','runtime-errors','runtime-type','runtime-count-contradiction','zero','missing-file','unfinished-suite','malformed-json','missing-log','failure-zero-exit','success-nonzero-exit']) {
  const base=join(output,name),run=join(base,'input/run-01');mkdirSync(run,{recursive:true});
  const tests=[{file:'a.test.ts',name:'one'},...(name==='duplicates'?[{file:'a.test.ts',name:'one'}]:[])];
  const inventory={old:{verified:true,tests}};
  const r={numTotalTests:tests.length,numPassedTests:tests.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:1,numPassedTestSuites:1,numFailedTestSuites:0,numPendingTestSuites:0,success:true,testResults:[{name:'a.test.ts',status:'passed',assertionResults:tests.map(t=>({fullName:t.name,status:'passed',failureMessages:[]}))}]};
  let exitCode=0;
  if(name==='zero-suites') {r.numTotalTestSuites=0;r.numPassedTestSuites=0;}
  if(name==='false-failed-suite') {r.numPassedTestSuites=0;r.numFailedTestSuites=1;}
  if(name==='runtime-errors') {r.numRuntimeErrorTestSuites=1;r.unhandledErrors=[{message:'synthetic only'}];}
  if(name==='runtime-type') r.unhandledErrors={};
  if(name==='runtime-count-contradiction') {r.numRuntimeErrorTestSuites=0;r.unhandledErrors=[{}];}
  if(name==='zero') {r.testResults=[];r.numTotalTests=0;r.numPassedTests=0;}
  if(name==='missing-file') r.testResults=[];
  if(name==='unfinished-suite') r.testResults[0].status='running';
  if(name==='failure-zero-exit') {r.testResults[0].assertionResults[0].status='failed';r.testResults[0].status='failed';r.numPassedTests=0;r.numFailedTests=1;r.numPassedTestSuites=0;r.numFailedTestSuites=1;r.success=false;}
  if(name==='success-nonzero-exit') exitCode=1;
  write(join(base,'inventory.json'),inventory);write(join(run,'run.json'),{head:'old',exitCode});
  writeFileSync(join(run,'vitest.json'),name==='malformed-json'?'{invalid':JSON.stringify(r));
  writeFileSync(join(run,'stdout.log'),'');if(name!=='missing-log')writeFileSync(join(run,'stderr.log'),'');
  const statuses={};
  for(const [version,script] of [['before',baseline],['after',resolve('scripts/stage-w1b-summary.mjs')]]) {
    const cli=spawnSync(process.execPath,[script,join(base,'input'),join(base,'inventory.json'),join(base,version)],{encoding:'utf8'});
    write(join(base,`${version}-cli.json`),{exit:cli.status,stdout:cli.stdout,stderr:cli.stderr});
    assert.equal(cli.status,0);const summary=read(join(base,version,'comparison-summary.json')).runs[0];statuses[version]=summary.status;
    if(version==='after'&&name==='missing-log') assert.ok(summary.incomplete.some(s=>s.includes('missing logs')));
  }
  outcomes.push({name,inputSha256:hash(readFileSync(join(run,'vitest.json'))),...statuses});
  assert.notEqual(statuses.after,'PASS'); // standalone verified:true is no longer trusted
  if(['zero-suites','false-failed-suite','runtime-errors'].includes(name)) assert.equal(statuses.before,'PASS');
}
write(join(output,'synthetic-outcomes.json'),outcomes);
// A tiny versioned fixture with nested and empty describes plus duplicate names.
const bare=join(fixtureRoot,'git-source'),a=join(fixtureRoot,'a'),b=join(fixtureRoot,'b');
mkdirSync(bare);mkdirSync(a);mkdirSync(b);
write(join(bare,'package.json'),{type:'module'});
writeFileSync(join(bare,'package-lock.json'),readFileSync('package-lock.json'));
const cacheDir=join(fixtureRoot,'cache').replaceAll('\\','/');
writeFileSync(join(bare,'vitest.config.mjs'),`export default {cacheDir:${JSON.stringify(cacheDir)},test:{environment:'node',maxWorkers:2,cache:false}};\n`);
writeFileSync(join(bare,'tiny.test.js'),"import {describe,it,expect} from 'vitest';\ndescribe('outer',()=>{describe('inner',()=>{it('same',()=>expect(1).toBe(1));it('same',()=>expect(2).toBe(2));});});\n");
const git=(...args)=>execFileSync('git',['-C',bare,...args],{encoding:'utf8'}).trim();
git('init');git('add','.');git('-c','user.name=W1b fixture','-c','user.email=fixture@example.invalid','-c','core.autocrlf=false','commit','-m','isolated control');
const head=git('rev-parse','HEAD');
for(const dir of [a,b]) {for(const f of ['package.json','package-lock.json','vitest.config.mjs','tiny.test.js'])writeFileSync(join(dir,f),execFileSync('git',['-C',bare,'show',`${head}:${f}`]));symlinkSync(resolve('node_modules'),join(dir,'node_modules'),'junction');}
const plan={targets:[a,b].map(dir=>({repo:bare,dir,head})),filters:[],expected:{pool:'forks',maxWorkers:2,testTimeout:5000,cache:false}};
write(join(output,'fixture-plan.json'),plan);
const normal=join(output,'connected-normal');
const prepared=prepare(plan,normal);write(join(output,'normal-prepare.json'),prepared);
assert.equal(prepared.status,'READY',JSON.stringify(prepared));
const completed=launch(normal);write(join(output,'normal-launch.json'),completed);
assert.equal(completed.status,'PASS',JSON.stringify(completed));
console.log('synthetic CLI and connected normal controls complete');
