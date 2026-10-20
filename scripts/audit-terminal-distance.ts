import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distancePositions, observePv, exhaustive, compareReference, apply } from './benchmarks/terminalDistanceReference';
import { getLegalActions } from '../src/domain/shogi/legalActions';
import { json, parse, hash } from './benchmarks/partialRootMatches';
import { validatePartialRoot } from '../src/application/partialRootValidation';

const [mode,root,out] = process.argv.slice(2);
const positions=distancePositions();
if (mode==='reference') {
  const api=await import(pathToFileURL(join(resolve(root),'src/domain/shogi/twoPlyAlphaBetaAi.ts')).href);
  const rows=[];
  for (const id of ['mixed-distance','terminal-resistance','terminal-resistance-gote']) {
    const s=positions.find(p=>p.id===id)!.state;
    const candidates=getLegalActions(s).map(action=>({action,...exhaustive(apply(s,action),3,null,s.turn,1)}));
    if (id==='mixed-distance') {
      assert.ok(candidates.some(c=>c.breakdown.terminal==='win'&&c.terminalDistancePly===1));
      assert.ok(candidates.some(c=>c.breakdown.terminal==='win'&&c.terminalDistancePly===3));
    } else {
      assert.ok(candidates.every(c=>c.breakdown.terminal==='loss'));
      assert.deepEqual([...new Set(candidates.map(c=>c.terminalDistancePly))].sort(),[2,4]);
    }
    // Compare pruned product against independently unpruned minimax with
    // both normal and reversed reference order, including finite controls.
    for (const [d,q] of [[4,null],[3,1],[1,0],[1,1],[1,2]] as const) {
      const reference=exhaustive(s,d,q);
      const reverse=exhaustive(s,d,q,s.turn,0,true);
      assert.equal(compareReference(reference,reverse),0);
      const result=api.analyzeAlphaBetaSearch(s,d,undefined,undefined,q===null?undefined:{quiescence:{maxTacticalDepth:q}});
      const observed=observePv(s,result.principalVariation);
      assert.equal(compareReference(observed,reference),0,`${id} d${d} q${q}`);
      assert.deepEqual(result.evaluationBreakdown,observed.breakdown);
      rows.push({id,d,q,candidates:d===4?candidates:undefined,reference,result,observed});
    }
    console.log(id);
  }
  writeFileSync(out,json(rows)+'\n',{flag:'wx'});
} else if (mode==='measurements') {
  const plan=parse(readFileSync(join(root,'plan.json'),'utf8'));
  const rows=parse(readFileSync(join(root,'raw.json'),'utf8')) as any[];
  const completed=parse(readFileSync(join(root,'completed.json'),'utf8'));
  assert.equal(hash(rows),completed.rawHash);
  assert.equal(rows.length,completed.rows);
  assert.equal(rows.length,positions.length*28);
  const seen=new Set();
  for (const row of rows) {
    const key=json([row.engine,row.position,row.phase,row.budget,row.repeat]); assert.ok(!seen.has(key)); seen.add(key);
    const s=positions.find(p=>p.id===row.position)!.state;
    const r=row.result, pv=observePv(s,r.principalVariation);
    assert.equal(row.terminalReason,pv.reason); assert.equal(row.terminalDistancePly,pv.terminalDistancePly);
    if (r.resultSource==='fallback') {
      assert.equal(r.selectedEvaluation,null); assert.equal(r.evaluationBreakdown,null); assert.equal(pv.pv.length,0);
    } else { assert.equal(r.selectedEvaluation,r.evaluationBreakdown.total); assert.deepEqual(r.evaluationBreakdown,pv.breakdown); }
    if (r.selectedAction) assert.deepEqual(r.selectedAction,r.principalVariation[0]??r.selectedAction);
    if (r.resultSource==='partial-root') {
      assert.ok(validatePartialRoot(s,r,1));
      if (row.engine==='candidate') {
        const ref=exhaustive(apply(s,r.selectedAction),0,1,s.turn,1);
        assert.equal(compareReference(pv,ref),0,'partial exact candidate independently checked');
      }
    }
    assert.ok(row.callMs>=0&&row.apiMs>=0);
  }
  const measurements=rows.filter(r=>r.phase==='measurement');
  const percentile=(values:number[],p:number)=>values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
  const summary=[];
  for (const engine of ['main','candidate']) for (const budget of [100,1000]) {
    const group=measurements.filter(r=>r.engine===engine&&r.budget===budget);
    const sources=Object.fromEntries(['completed-iteration','partial-root','fallback'].map(source=>[source,group.filter(r=>r.result.resultSource===source).length]));
    summary.push({engine,budget,n:group.length,callP50:percentile(group.map(r=>r.callMs),.5),callP95:percentile(group.map(r=>r.callMs),.95),
      apiP50:percentile(group.map(r=>r.apiMs),.5),apiP95:percentile(group.map(r=>r.apiMs),.95),maxOverrun:Math.max(...group.map(r=>r.overrunMs)),sources});
  }
  const fixed=measurements.filter(r=>r.budget===null).map(r=>({engine:r.engine,position:r.position,action:r.result.selectedAction,evaluation:r.result.selectedEvaluation,
    reason:r.terminalReason,distance:r.terminalDistancePly,pv:r.result.principalVariation,depth:r.result.depth,visited:r.result.visitedPositionCount,qVisited:r.result.quiescenceVisitedPositionCount}));
  for (const id of ['evasion','recapture','capture','recapture-gote','hirate-exchange']) {
    const before=fixed.find(r=>r.engine==='main'&&r.position===id)!;
    const after=fixed.find(r=>r.engine==='candidate'&&r.position===id)!;
    const {engine:_before,...a}=before, {engine:_after,...b}=after;
    assert.deepEqual(a,b,'fixed non-terminal control unchanged');
  }
  const data={planStartedAt:plan.startedAt,summary,fixed};
  try { assert.deepEqual(parse(readFileSync(out,'utf8')),data); } catch(e) {
    if ((e as NodeJS.ErrnoException).code!=='ENOENT') throw e;
    writeFileSync(out,json(data)+'\n',{flag:'wx'});
  }
  console.log(json(summary));
} else throw Error('reference <candidate-root> <new-file> | measurements <run-dir> <summary-file>');
