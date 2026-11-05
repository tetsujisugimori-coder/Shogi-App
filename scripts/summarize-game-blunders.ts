import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {areLegalActionsEqual} from '../src/domain/shogi/twoPlyAlphaBetaAi';
import {classificationCounts,compareFixed,json,repeatKey,type FixedObservation} from './benchmarks/gameBlunderInvestigation';

const frequencies=(xs:unknown[])=>Object.fromEntries([...new Set(xs.map(String))].sort().map(x=>[x,xs.filter(y=>String(y)===x).length]));
export function changedFields(a:unknown,b:unknown,prefix=''):string[] {
  if (json(a)===json(b)) return [];
  if(a && b && typeof a==='object' && typeof b==='object' && !Array.isArray(a) && !Array.isArray(b)) {
    const left=a as Record<string,unknown>,right=b as Record<string,unknown>;
    return [...new Set([...Object.keys(left),...Object.keys(right)])].flatMap(k=>changedFields(left[k],right[k],prefix?prefix+'.'+k:k));
  }
  return [prefix];
}
/** Saved evidence is data: recompute repetition keys, count coverage and check
 * condition/candidate identity before reporting an evaluation or effect. */
export function summarizeV4(raw:string) {
  // JSON schema is validated below at the fields used for comparison.
  const rows=raw.trim().split('\n').map(line=>JSON.parse(line));
  const plan=rows[0],end=rows.at(-1);
  assert.equal(plan.type,'plan'); assert.equal(plan.schema,2); assert.equal(end.type,'end');
  assert.equal(rows.filter(r=>r.type==='plan').length,1);assert.equal(rows.filter(r=>r.type==='end').length,1);
  assert.equal(rows.filter(r=>r.type==='setup').length,1);
  assert.ok(rows.every(r=>['plan','setup','timed','root-fixed','candidates','pair-fixed','probe-control','end'].includes(r.type)));
  assert.equal(end.unchanged,true); assert.deepEqual(end.after,plan.before); assert.equal(plan.before.length,4);
  assert.equal(new Set(plan.selection).size,24);assert.equal(plan.selection.length,24);
  assert.equal(new Set(plan.suspected).size,4);assert.equal(plan.suspected.length,4);
  assert.ok(plan.suspected.every((id:string)=>plan.selection.includes(id)));
  const counts=classificationCounts(plan.classificationRows);assert.deepEqual(counts,plan.counts);
  assert.ok(plan.selection.every((id:string)=>plan.classificationRows.some((r:{id:string})=>r.id===id)));
  const setup=rows.find(r=>r.type==='setup'),timed=rows.filter(r=>r.type==='timed');
  assert.equal(timed.length,24);assert.deepEqual(timed.map(r=>r.id),plan.selection);
  const phaseTotals:Record<string,number>={rootLegal:0,normal:0,quiescence:0,apiOther:0};
  for(const r of timed) {
    if (!r.result) {assert.ok(['error','not-run'].includes(r.status));continue;}
    assert.ok(['completed','deadline'].includes(r.status));
    assert.equal(r.completedDepth,r.result.completedDepth);
    assert.equal(r.status==='deadline',r.result.timedOut);
    for(const [phase,v] of Object.entries(r.phases) as [string,{milliseconds:number}][]) {
      assert.ok(Number.isFinite(v.milliseconds)&&v.milliseconds>=0);
      phaseTotals[phase==='root-legal'?'rootLegal':phase==='quiescence'||phase.startsWith('q-')?'quiescence':'normal']+=v.milliseconds;
    }
    phaseTotals.apiOther+=r.finished.apiOtherMilliseconds;
  }
  const roots=rows.filter(r=>r.type==='root-fixed');assert.equal(roots.length,48);
  const repetitions=(entries:typeof rows)=>entries.length===2 && entries.every(r=>r.status==='completed') &&
    repeatKey(entries[0] as FixedObservation)===repeatKey(entries[1] as FixedObservation);
  const checkFixed=(r:typeof rows[number])=>{
    assert.ok([0,1].includes(r.rep));
    assert.ok(['completed','interrupted','error','not-run'].includes(r.status));
    if(r.status==='not-run') {assert.ok(!r.result);return;}
    assert.equal(r.repeatKey,repeatKey(r as FixedObservation),'stored repetition key differs from observation');
    assert.ok(Number.isInteger(r.nodes.normal)&&Number.isInteger(r.nodes.quiescence)&&r.nodes.normal>=0&&r.nodes.quiescence>=0);
    assert.ok(r.nodes.normal+r.nodes.quiescence<=plan.budget.nodes);
    if(r.status==='completed') {
      assert.ok(r.result);assert.equal(r.result.depth,r.requestedDepth);assert.equal(r.completedDepth,r.requestedDepth);
      assert.ok(r.result.selectedAction);assert.ok(r.result.principalVariation.length>0);
      assert.ok(areLegalActionsEqual(r.result.selectedAction,r.result.principalVariation[0]));
      if(r.action) assert.ok(areLegalActionsEqual(r.result.selectedAction,r.action));
    } else {assert.equal(r.result,null);assert.equal(r.completedDepth,0);assert.equal(r.validity,'unusable');}
  };
  roots.forEach(r=>{assert.ok(plan.selection.includes(r.id));assert.deepEqual(r.budget,plan.budget);checkFixed(r);});
  const rootReproducibility=plan.selection.map((id:string)=>{
    const entries=roots.filter(r=>r.id===id); assert.equal(entries.length,2);assert.equal(new Set(entries.map(r=>r.rep)).size,2);
    assert.ok(entries.every(r=>r.condition.depth===plan.limits.fixedRootDepth));
    return {id,reproducible:repetitions(entries),status:entries.map(r=>r.status),nodes:entries.map(r=>r.nodes),
      selectedAction:entries[0].result?.selectedAction??null,score:entries[0].result?.selectedEvaluation??null,pv:entries[0].result?.principalVariation??null};
  });
  const candidates=rows.filter(r=>r.type==='candidates'),fixed=rows.filter(r=>r.type==='pair-fixed');
  assert.equal(candidates.length,4);assert.equal(new Set(candidates.map(r=>r.id)).size,4);
  assert.ok(candidates.every(r=>plan.suspected.includes(r.id)));
  const groups=candidates.map(c=>{
    if(c.status==='invalid') {assert.ok(!fixed.some(r=>r.id===c.id));return {id:c.id,status:'invalid',reason:c.reason};}
    const conditions=plan.conditions.map((condition:{name:string;depth:number;options:unknown})=>{
      const entries=fixed.filter(r=>r.id===c.id&&r.condition.name===condition.name);assert.equal(entries.length,4);
      assert.equal(new Set(entries.map(r=>r.kind+':'+r.rep)).size,4);
      entries.forEach(r=>{
        assert.ok(['actual','alternative'].includes(r.kind));assert.deepEqual(r.condition,condition);assert.deepEqual(r.budget,plan.budget);
        assert.equal(r.mode,c.mode);assert.equal(r.positionHash,c.positionHash);checkFixed(r);
        if(r.action)assert.ok(areLegalActionsEqual(r.action,c[r.kind].action));
      });
      const actual=entries.filter(r=>r.kind==='actual'),alt=entries.filter(r=>r.kind==='alternative');
      const reproducible=repetitions(actual)&&repetitions(alt);
      const judgment=reproducible?compareFixed(actual[0],alt[0]):{verdict:'INDETERMINATE',delta:null,reason:'Repetition incomplete or inconsistent.'};
      return {name:condition.name,reproducible,judgment,
        actual:actual[0].result?.selectedEvaluation??null,alternative:alt[0].result?.selectedEvaluation??null,
        pvActual:actual[0].result?.principalVariation??null,pvAlternative:alt[0].result?.principalVariation??null,
        nodes:entries.map(r=>r.nodes??null),status:entries.map(r=>r.status),reason:entries.map(r=>r.reason)};
    });
    const baseline=conditions[0];
    const factors=conditions.slice(1).map((v:typeof baseline,i:number)=>{
      const {name:_base,...base}=plan.conditions[0],{name:_changed,...changed}=plan.conditions[i+1];
      const changes=changedFields(base,changed);assert.equal(changes.length,1,'one-factor contract');
      const valid=baseline.reproducible&&v.reproducible&&baseline.judgment.delta!==null&&v.judgment.delta!==null;
      const differs=valid&&(v.actual!==baseline.actual||v.alternative!==baseline.alternative||json(v.pvActual)!==json(baseline.pvActual)||json(v.pvAlternative)!==json(baseline.pvAlternative));
      return {condition:v.name,changedFields:changes,fixed:['position','candidate actions','perspective','mode','node/time caps','other settings'],
        status:!valid?'EXPERIMENT_INVALID':differs?'OBSERVED_EFFECT':'NO_OBSERVED_VALUE_OR_PV_CHANGE',
        deltaChange:valid?v.judgment.delta!-baseline.judgment.delta!:null,
        interpretation:v.name==='see-order'?'Existing ordering policy, not isolated SEE arithmetic; original standard ordering does not use SEE.':'Effect within bounded search; cause of historical move UNKNOWN.'};
    });
    return {id:c.id,journal:c.journal,ply:c.ply,player:c.player,mode:c.mode,conditions,factors,
      legalReplies:{actual:c.actual.replies.length,alternative:c.alternative.replies.length},
      legalCaptures:{actual:c.actual.captures.length,alternative:c.alternative.captures.length},
      exchangeScope:c.actual.exchangeScope,verdict:'INDETERMINATE',
      reason:'Direction may depend on depth/quiescence. Bounded evidence does not establish historical move error or component causality.'};
  });
  assert.equal(fixed.length,candidates.filter(c=>c.status!=='invalid').length*plan.conditions.length*4);
  const controls=rows.filter(r=>r.type==='probe-control');
  const probeControls=candidates.filter(c=>c.status!=='invalid').map(c=>{
    const entries=controls.filter(r=>r.id===c.id);assert.equal(entries.length,4);
    assert.equal(new Set(entries.map(r=>r.detailed+':'+r.rep)).size,4);entries.forEach(checkFixed);
    return {id:c.id,sameResult:entries.every(r=>r.status==='completed')&&new Set(entries.map(r=>repeatKey(r))).size===1,
      timings:entries.map(r=>({detailed:r.detailed,rep:r.rep,searchMs:r.searchMs??null}))};
  });
  const io=end.ioMeasurements;assert.equal(io.length,rows.length-1);
  io.forEach((v:{index:number;type:string;serializationMs:number;saveMs:number},i:number)=>{
    assert.equal(v.index,i);assert.equal(v.type,rows[i].type);assert.ok(v.serializationMs>=0&&v.saveMs>=0);
  });
  return {schema:2,baseHead:plan.baseHead,journals:plan.paths,hashBefore:plan.before,hashAfter:end.after,
    counts,plies:setup.plies,setup:setup.extraction,elapsedMs:end.elapsedMs,
    timed:{count:timed.length,status:frequencies(timed.map(r=>r.status)),completedDepth:frequencies(timed.map(r=>r.completedDepth)),
      interruptedPhase:frequencies(timed.map(r=>r.interruptedPhase)),interruptedStage:frequencies(timed.map(r=>r.interruptedStage)),
      crossedDeadlinePhase:frequencies(timed.map(r=>r.crossedDeadlinePhase)),phaseTotals,
      searchMs:timed.reduce((n,r)=>n+(r.searchMs??0),0),legalMs:timed.reduce((n,r)=>n+(r.legalMs??0),0),
      candidateMs:timed.reduce((n,r)=>n+(r.candidateMs??0),0),preparationMs:timed.reduce((n,r)=>n+(r.preparationMs??0),0),
      normalizationMs:timed.reduce((n,r)=>n+(r.normalizationMs??0),0)},
    io:{serializationMs:io.reduce((n:number,r:{serializationMs:number})=>n+r.serializationMs,0),saveMs:io.reduce((n:number,r:{saveMs:number})=>n+r.saveMs,0),scope:end.ioScope},
    fixed:{rootCalls:roots.length,pairCalls:fixed.length,rootReproducibility,groups,probeControls},
    priority:'NOT_READY',strengthImprovement:'UNKNOWN',
    hypotheses:[{factor:'quiescence/depth/ordering',status:'See per-position factors; effects do not establish historical causality.'},
      {factor:'pure SEE arithmetic',status:'UNKNOWN',reason:'Original standard path disables SEE; existing SEE policy changes ordering priorities too.'},
      {factor:'time budget / evaluation weights',status:'UNKNOWN',reason:'No isolated counterfactual in this bounded experiment.'},
      {factor:'legal generator defect',status:'UNKNOWN',reason:'No defect demonstrated; legal replies and recaptures recorded.'}]};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/summarize-game-blunders.ts')) {
  const dir=process.argv[2];assert.ok(dir,'OUTPUT_DIR');
  writeFileSync(join(dir,'summary.json'),JSON.stringify(summarizeV4(readFileSync(join(dir,'observations.jsonl'),'utf8')),null,2)+'\n',{flag:'wx'});
}
