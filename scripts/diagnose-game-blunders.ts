import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { extract, compare } from './benchmarks/gameBlunderPilot';
import { traceExchange, evaluateComparison, classify, causes } from './benchmarks/gameBlunderDiagnosis';
import { stateHash } from './benchmarks/matchJournal';
import { sha256 } from './benchmarks/journalIO';
const [out, priorPath,...paths]=process.argv.slice(2);
assert.ok(out && priorPath && paths.length, 'NEW_OUTPUT_DIR PRIOR_JSON JOURNAL...');
const prior=JSON.parse(readFileSync(priorPath,'utf8')) as {results:{id:string;verdict:string;delta:number|null}[]};
assert.equal(prior.results.length,24);
const initial=paths.map(path=>sha256(readFileSync(path)));
const {games,candidates}=extract(paths);
assert.ok(games.every(g=>g.audit.status==='complete'),'only fully audited completed journals accepted');
const selected=new Set(prior.results.map(r=>r.id)); assert.equal(selected.size,24);
assert.ok(prior.results.every(r=>candidates.some(c=>c.id===r.id)),'prior sample must match');
const started=performance.now();
const rows=[];
for (const c of candidates) {
  const game=games.find(g=>g.path===c.path)!;
  const trajectory=game.audit.moves.slice(c.move.ply).map(m=>m.action);
  const trace=traceExchange(c.state,c.move.action,trajectory);
  const previous=prior.results.find(r=>r.id===c.id) ?? null;
  let reference: ReturnType<typeof compare>|null=null, failure:string|null=null;
  if(previous && performance.now()-started<120000) {
    try {reference=compare(c,1000);} catch(e) {failure=String(e);}
  }
  const judgment=previous ? failure ? {verdict:'INDETERMINATE',delta:null,reason:failure} : reference ? evaluateComparison(reference.actual,reference.reference,300,reference.root) : {verdict:'NOT_RUN',delta:null,reason:'Total soft limit reached.'} : {verdict:'NOT_RUN',delta:null,reason:'Outside original 24 sample.'};
  const cls=classify(c.state,trace,c.move.search.selectedEvaluation,judgment.delta,c.move.action,reference ? {original:c.move.search.completedDepth,reference:reference.root.completedDepth} : undefined);
  rows.push({id:c.id,positionHash:stateHash(c.state),journal:c.path,journalSha256:c.hash,ply:c.move.ply,moveNumber:c.move.moveNumber,player:c.move.player,mode:c.mode,
    conditions:c.conditions,action:c.move.action,trigger:'next recorded move captures moved piece',recordedSearch:c.move.search,
    trace,classification:cls,prior:previous,reference,judgment,causes});
}
const final=paths.map(path=>sha256(readFileSync(path))); assert.deepEqual(final,initial,'original journal changed during diagnosis');
const counts=(xs:string[])=>Object.fromEntries([...new Set(xs)].sort().map(x=>[x,xs.filter(y=>y===x).length]));
const result={schema:1,sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:true,reference:{maxPositions:24,msPerSearch:1000,maxDepth:4,softTotalMs:120000,elapsedMs:performance.now()-started},
  journals:games.map(({path,audit},i)=>({path,hashBefore:initial[i],hashAfter:final[i],status:audit.status,plies:audit.moves.length,end:audit.end?.reason,seats:audit.start?.seats})),
  priorPath, priorSha256:sha256(readFileSync(priorPath)), counts:{candidates:rows.length,selected:rows.filter(r=>r.prior).length,verdicts:counts(rows.map(r=>r.judgment.verdict)),classes:counts(rows.flatMap(r=>r.classification.labels)),perGame:counts(rows.map(r=>r.journal))},rows};
mkdirSync(resolve(out),{recursive:false});
const json=JSON.stringify(result,(_k,v)=>typeof v==='number' && !Number.isFinite(v) ? {nonfinite:String(v)} : v,2)+'\n';
writeFileSync(resolve(out,'diagnosis.json'),json,{flag:'wx'});
writeFileSync(resolve(out,'report.md'),`# 再診断結果\n\n監査済み ${games.length} 局、${rows.length} 候補、元24候補の再探索 ${rows.filter(r=>r.reference).length}。時限探索・元実戦探索は厳密な反復決定性を保証しない。\n\n判定: ${JSON.stringify(result.counts.verdicts)}。分類（複数可）: ${JSON.stringify(result.counts.classes)}。\n\n有限評価差は証明でない。交換は実際の同一マスの手順だけで、別の合法手、捨て駒の補償や強制詰みは未検証。\n\n`+rows.filter(r=>r.prior?.verdict==='SUSPECTED').map(r=>`- ${r.journal} ply ${r.ply}: 旧 ${r.prior!.verdict} 差 ${r.prior!.delta} → ${r.judgment.verdict} (${r.judgment.reason}); labels ${r.classification.labels.join(',') || 'なし'}; 即時駒差 ${r.trace.steps[0]?.material ?? '未測定'}。`).join('\n')+'\n',{flag:'wx'});
