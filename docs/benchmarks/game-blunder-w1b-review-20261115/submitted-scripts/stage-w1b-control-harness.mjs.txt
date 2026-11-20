import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const root=resolve(process.argv[2]); mkdirSync(root);
const cases=['zero','missing-file','count-mismatch','unfinished-suite','malformed-json','failure-zero-exit','normal','duplicates'];
const outcome=[];
for (const name of cases) {
 const base=join(root,name), run=join(base,'input','run-01'); mkdirSync(run,{recursive:true});
 const dup=name==='duplicates';
 const inventory={old:{verified:true,tests:[{file:'a.test.ts',name:'one'},...(dup?[{file:'a.test.ts',name:'one'}]:[]),{file:'b.test.ts',name:'two'}]}};
 const tests=inventory.old.tests.map(x=>({fullName:x.name,status:'passed',failureMessages:[]}));
 const r={numTotalTests:tests.length,numPassedTests:tests.length,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:2,numPassedTestSuites:2,numFailedTestSuites:0,numPendingTestSuites:0,success:true,testResults:[{name:'a.test.ts',status:'passed',assertionResults:tests.slice(0,dup?2:1)},{name:'b.test.ts',status:'passed',assertionResults:[tests.at(-1)]}]};
 if(name==='zero'){r.testResults=[];r.numTotalTests=0;r.numPassedTests=0;}
 if(name==='missing-file'){r.testResults.pop();r.numTotalTests--;r.numPassedTests--;}
 if(name==='count-mismatch')r.numPassedTests--;
 if(name==='unfinished-suite')r.testResults[0].status='running';
 if(name==='failure-zero-exit'){r.testResults[0].status='failed';r.testResults[0].assertionResults[0].status='failed';r.numPassedTests--;r.numFailedTests++;r.numPassedTestSuites--;r.numFailedTestSuites++;}
 writeFileSync(join(run,'run.json'),JSON.stringify({sequence:1,head:'old',exitCode:0}));
 writeFileSync(join(run,'vitest.json'),name==='malformed-json'?'{invalid':JSON.stringify(r));
 for(const f of ['stdout.log','stderr.log'])writeFileSync(join(run,f),'');
 writeFileSync(join(base,'inventory.json'),JSON.stringify(inventory));
 const old=spawnSync(process.execPath,['scripts/stage-w1-summary.mjs',join(base,'input'),join(base,'old-output')],{encoding:'utf8'});
 const newer=spawnSync(process.execPath,['scripts/stage-w1b-summary.mjs',join(base,'input'),join(base,'inventory.json'),join(base,'new-output')],{encoding:'utf8'});
 const readStatus=p=>JSON.parse(readFileSync(p)).runs[0].status;
 const oldStatus=old.status===0?readStatus(join(base,'old-output','comparison-summary.json')):'ERROR';
 const newStatus=newer.status===0?readStatus(join(base,'new-output','comparison-summary.json')):'ERROR';
 writeFileSync(join(base,'old-stderr.txt'),old.stderr); writeFileSync(join(base,'new-stderr.txt'),newer.stderr);
 outcome.push({name,old:oldStatus,new:newStatus,oldExit:old.status,newExit:newer.status});
}
writeFileSync(join(root,'outcomes.json'),JSON.stringify(outcome,null,2)+'\n'); console.log(outcome);
