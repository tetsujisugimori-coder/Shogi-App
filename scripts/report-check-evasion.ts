// Offline only: reproduce position-level tables from the audited summary.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { json, parse, hash } from './benchmarks/tacticalDiagnostics';
import type { LegalAction } from '../src/domain/shogi/legalActions';
const dir=path.resolve(process.argv[2]);
const read=(name:string)=>parse(readFileSync(path.join(dir,name),'utf8'));
const rows=read('summary.json'),plan=read('plan.json'),env=read('environment.json'),done=read('completed.json');
assert.equal(env.planHash,hash(plan)); assert.equal(done.rawHash,hash(readFileSync(path.join(dir,'raw.jsonl'),'utf8')));
const action=(a:LegalAction|null)=>!a?'none':a.kind==='move'
  ? `${a.pieceType} (${a.from.row},${a.from.col})→(${a.to.row},${a.to.col}) ${a.promotion}`
  : `${a.pieceType}*(${a.to.row},${a.to.col})`;
const metrics=plan.conditions.flatMap((c:{id:string})=>[0,1,2].map(extra=>{
  const rs=rows.filter((r:any)=>r.condition===c.id&&r.extra===extra);
  const sum=(f:(r:any)=>number)=>rs.reduce((v:number,r:any)=>v+f(r),0);
  const counts=(f:(r:any)=>unknown)=>Object.fromEntries([...new Set(rs.map(f))].map(k=>[String(k),rs.filter((r:any)=>f(r)===k).length]));
  return {condition:c.id,extra,n:rs.length,wallSumMs:sum(r=>r.callMs),apiSumMs:sum(r=>r.apiMs),
    resultSources:counts(r=>r.resultSource),depths:counts(r=>r.completedDepth),evasions:counts(r=>r.evasion),
    observedTerminal:counts(r=>r.terminalDiscovery),verdicts:counts(r=>r.verdict),
    capCount:sum(r=>r.stats.limitReachedCount),maxExtra:Math.max(...rs.map((r:any)=>r.stats.maxExtensionDepth))};
}));
const changes=rows.filter((r:any)=>r.extra!==0).map((r:any)=>{
  const a=rows.find((a:any)=>a.extra===0&&a.position===r.position&&a.condition===r.condition&&a.rep===r.rep);
  return {position:r.position,condition:r.condition,rep:r.rep,extra:r.extra,
    selectedActionChanged:json(a.result.selectedAction)!==json(r.result.selectedAction),
    scoreChanged:a.result.selectedEvaluation!==r.result.selectedEvaluation,
    pvChanged:json(a.result.principalVariation)!==json(r.result.principalVariation),
    depthChange:r.completedDepth-a.completedDepth,verdictChanged:a.verdict!==r.verdict};
});
const table=['# Position comparison (0-based row,col)','',
  '|position|d4 selected action A / B / C (one entry when identical)|d4 score A / B / C|reference verdict A/B/C|d4 wall ms A / B / C|',
  '|---|---|---|---|---|'];
for(const p of plan.positions){
  const rs=[0,1,2].map(extra=>rows.find((r:any)=>r.position===p.id&&r.condition==='d4'&&r.extra===extra));
  const same=rs.every(r=>json(r.result.selectedAction)===json(rs[0].result.selectedAction));
  table.push(`|${p.id}|${same?action(rs[0].result.selectedAction):rs.map(r=>action(r.result.selectedAction)).join(' / ')}|${rs.map(r=>String(r.result.selectedEvaluation)).join(' / ')}|${rs.map(r=>r.verdict).join(' / ')}|${rs.map(r=>r.callMs.toFixed(3)).join(' / ')}|`);
}
table.push('','Scores and PV endings are observations; only the saved bounded reference supports quality verdicts.',
  'Every selected action, breakdown, PV, deadline/source/depth and all counters are retained in summary.json/raw.jsonl.',
  `${changes.filter((r:any)=>r.selectedActionChanged).length} selected actions and ${changes.filter((r:any)=>r.verdictChanged).length} reference verdicts changed in ${changes.length} paired B/C versus A observations.`);
const write=(name:string,content:string)=>{
  const dest=path.join(dir,name);if(existsSync(dest))assert.equal(readFileSync(dest,'utf8'),content);else writeFileSync(dest,content,{flag:'wx'});
};
write('comparison.json',json({metrics,changes})+'\n');
write('positions-details.md',table.join('\n')+'\n');
console.log(`Offline position comparison and ${changes.length} paired observations verified.`);
