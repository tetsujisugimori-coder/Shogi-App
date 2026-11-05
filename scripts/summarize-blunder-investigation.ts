import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// JSONL is an append-only experiment log; reject missing completion or duplicate observations.
export function summarize(text:string) {
  const rows=text.trim().split('\n').map(line=>JSON.parse(line));
  const plan=rows[0],end=rows.at(-1);assert.equal(plan.type,'plan');assert.equal(end.type,'end');assert.equal(end.unchanged,true);
  const timed=rows.filter(r=>r.type==='timed'),fixed=rows.filter(r=>r.type==='fixed');
  assert.equal(new Set(timed.map(r=>r.id)).size,plan.selection.length);
  const frequencies=(items:string[])=>Object.fromEntries([...new Set(items)].sort().map(x=>[x,items.filter(i=>i===x).length]));
  const groups=[];
  for(const c of rows.filter(r=>r.type==='candidates')) {
    const conditions=[];
    for(const q of [0,1]) {
      const entries=fixed.filter(r=>r.id===c.id&&r.q===q);
      assert.equal(entries.length,4);
      const actual=entries.filter(r=>r.kind==='actual'),alternative=entries.filter(r=>r.kind==='alternative');
      assert.equal(new Set(entries.map(r=>r.kind+':'+r.rep)).size,4);
      const reproducible=actual[0].stableKey===actual[1].stableKey&&alternative[0].stableKey===alternative[1].stableKey;
      const comparable=entries.every(r=>r.status==='completed'&&Number.isFinite(r.result?.selectedEvaluation));
      conditions.push({q,reproducible,comparable,actual:actual[0].result?.selectedEvaluation??null,alternative:alternative[0].result?.selectedEvaluation??null,
        delta:comparable?alternative[0].result.selectedEvaluation-actual[0].result.selectedEvaluation:null,
        nodes:entries.map(r=>r.nodes),status:entries.map(r=>r.status)});
    }
    groups.push({id:c.id,journal:c.journal,ply:c.ply,player:c.player,legalReplyCounts:c.children.map((p:{legalReplies:unknown[]})=>p.legalReplies.length),conditions});
  }
  const sumPhase=(name:string)=>timed.reduce((n,r)=>n+(r.phases?.[name]?.milliseconds??0),0);
  return {schema:1,counts:plan.counts,journalAuditAndReplayMs:plan.restoreMs,elapsedMs:end.elapsedMs,journalHashes:plan.before,journals:plan.paths,
    timed:{count:timed.length,status:frequencies(timed.map(r=>String(r.status))),completedDepth:frequencies(timed.map(r=>String(r.completedDepth))),
      lastPhase:frequencies(timed.map(r=>String(r.lastPhase))),lastStage:frequencies(timed.map(r=>String(r.lastStage))),
      rootLegalMs:sumPhase('root-legal'),normalOtherMs:sumPhase('normal-other'),quiescenceMs:sumPhase('quiescence'),
      searchMs:timed.reduce((n,r)=>n+(r.searchMs??0),0),externalLegalMs:timed.reduce((n,r)=>n+(r.legalMs??0),0)},
    fixed:{calls:fixed.length,status:frequencies(fixed.map(r=>String(r.status))),groups}};
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/summarize-blunder-investigation.ts')) {
  const dir=process.argv[2];assert.ok(dir,'OUTPUT_DIR');
  const summary=summarize(readFileSync(join(dir,'observations.jsonl'),'utf8'));
  writeFileSync(join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
}
