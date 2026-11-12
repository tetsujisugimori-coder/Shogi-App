import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const repo=resolve(process.argv[2]),output=resolve(process.argv[3]);
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
assert.equal(head,'07db466b6f11558c9eb257a49c21f1dd6f3a4753');
execFileSync('git',['diff','--exit-code','1edc169cc9ff27b7c77e825e95b893e5b0252ed1',head,
  '--','scripts','src','package.json','package-lock.json','tsconfig.json','vite.config.ts','.github'],{cwd:repo});
const {summarizeV4}=await import(pathToFileURL(join(repo,'scripts/summarize-game-blunders.ts')).href);
const {json,repeatKey}=await import(pathToFileURL(join(repo,'scripts/benchmarks/gameBlunderInvestigation.ts')).href);
const input=join(repo,'docs/benchmarks/game-blunder-review-20261111/fixed-run/observations.jsonl');
const source=readFileSync(input,'utf8'),rows=source.trim().split('\n').map(JSON.parse);
assert.equal(rows[0].schema,3);
const id=rows.find(r=>r.type==='candidates').id;
const modified=rows.filter(r=>r.type==='pair-fixed'&&r.id===id&&r.condition.name==='baseline'&&r.kind==='actual');
assert.equal(modified.length,2);
assert.deepEqual(modified.map(r=>r.rep).sort(),[0,1]);
for(const r of modified) {
  r.result.selectedEvaluation={nonfinite:'NaN'};
  r.result.evaluationBreakdown.total={nonfinite:'NaN'};
  r.repeatKey=repeatKey(r);
}
mkdirSync(output,{recursive:false});
const mutated=rows.map(json).join('\n')+'\n';
writeFileSync(join(output,'input.jsonl'),mutated,{flag:'wx'});
const summary=summarizeV4(mutated);
writeFileSync(join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
const group=summary.fixed.groups.find(g=>g.id===id);
const condition=group.conditions.find(c=>c.name==='baseline');
const invalid=summary.fixed.invalidObservations;
assert.equal(condition.reproducible,false);
assert.equal(condition.judgment.delta,null);
assert.equal(condition.actual,null);
assert.equal(condition.alternative,null);
assert.equal(invalid.count,2);
assert.deepEqual(invalid.byReason,{'non-finite-evaluation':2});
assert.ok(invalid.rows.every(r=>r.type==='pair-fixed'&&r.id===id&&r.condition==='baseline'&&r.kind==='actual'&&r.reason==='non-finite-evaluation'));
assert.deepEqual(invalid.rows.map(r=>r.rep).sort(),[0,1]);
assert.equal(summary.fixed.rootReproducibility.filter(r=>r.reproducible).length,24);
assert.ok(group.factors.every(f=>f.status==='EXPERIMENT_INVALID'&&f.deltaChange===null));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={recordedAt:new Date().toISOString(),head,sourceHead:rows[0].baseHead,
  change:'Change baseline actual pair-fixed rep0 and rep1 selectedEvaluation/total to NaN tags and recompute repeatKey',
  sourceInputSha256:sha(source),mutatedInputSha256:sha(mutated),targetId:id,
  rootReproducible:24,condition,invalid,affectedFactors:group.factors,
  verdict:group.verdict,priority:summary.priority,status:'PASS'};
writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:result.status,head,id,reproducible:condition.reproducible,delta:condition.judgment.delta,invalidCount:invalid.count,byReason:invalid.byReason}));
