import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {areLegalActionsEqual} from '../src/domain/shogi/twoPlyAlphaBetaAi';
import {isPlayerInCheck} from '../src/domain/shogi/checkmate';
import {isDeepStrictEqual} from 'node:util';
import {evaluateSearchPositionBreakdown} from '../src/domain/shogi/twoPlyMinimaxAi';
import {getLegalActions,type LegalAction} from '../src/domain/shogi/legalActions';
import {BUDGET,CONDITIONS,CONDITION_CHANGES,ROOT_CONDITION,classificationCounts,compareFixed,fixedInvalidReason,inspectCandidate,json,repeatKey,restoreInvestigationPositions,type FixedObservation,type RestoredPosition} from './benchmarks/gameBlunderInvestigation';
import {apply} from './benchmarks/gameBlunderPilot';
import {sha256} from './benchmarks/journalIO';

function readSource(path:string,hash:string) {
  const bytes=readFileSync(path);
  assert.equal(sha256(bytes),hash,'source hash mismatch: '+path);
  return bytes.toString('utf8');
}

// Raw runner hash from the preserved schema 2 experiment.
const LEGACY_RUNNER_HASH='4c667c22246d90fd0e1431b35d35e44f3c2321dac55bc3de6111e03a1982534a';

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
  assert.equal(plan.type,'plan'); assert.ok([2,3].includes(plan.schema)); assert.equal(end.type,'end');
  const runnerHash=plan.sourceHashes?.['scripts/investigate-game-blunders.ts'];
  assert.match(runnerHash,/^[0-9a-f]{64}$/,'missing or invalid runner source hash');
  assert.equal(plan.schema===2,runnerHash===LEGACY_RUNNER_HASH,'schema does not match runner provenance');
  assert.deepEqual(plan.conditions,CONDITIONS,'plan condition contract');
  assert.deepEqual(plan.budget,BUDGET,'plan budget contract');
  assert.equal(plan.limits.fixedRootDepth,ROOT_CONDITION.depth);
  assert.equal(plan.limits.repetitions,2);
  assert.equal(plan.limits.fixedRootPositions,24);
  assert.equal(plan.limits.fixedPairPositions,4);
  assert.equal(plan.limits.maxExchangeCaptures,4);
  assert.equal(rows.filter(r=>r.type==='plan').length,1);assert.equal(rows.filter(r=>r.type==='end').length,1);
  assert.equal(rows.filter(r=>r.type==='setup').length,1);
  assert.ok(rows.every(r=>['plan','setup','timed','root-fixed','candidates','pair-fixed','probe-control','end'].includes(r.type)));
  assert.equal(end.unchanged,true); assert.deepEqual(end.after,plan.before); assert.equal(plan.before.length,4);
  assert.equal(new Set(plan.selection).size,24);assert.equal(plan.selection.length,24);
  assert.equal(new Set(plan.suspected).size,4);assert.equal(plan.suspected.length,4);
  assert.ok(plan.suspected.every((id:string)=>plan.selection.includes(id)));
  const counts=classificationCounts(plan.classificationRows);assert.deepEqual(counts,plan.counts);
  assert.ok(plan.selection.every((id:string)=>plan.classificationRows.some((r:{id:string})=>r.id===id)));
  const prior=JSON.parse(readSource(plan.priorFile,plan.priorHash)).results;
  assert.deepEqual(plan.selection,prior.map((r:{id:string})=>r.id),'selection differs from source');
  assert.deepEqual(plan.suspected,prior.filter((r:{verdict:string})=>r.verdict==='SUSPECTED').map((r:{id:string})=>r.id));
  const sourceRows=JSON.parse(readSource(plan.v3File,plan.v3Hash)).rows;
  assert.deepEqual(plan.classificationRows,sourceRows.map(({id,classification,judgment}:typeof sourceRows[number])=>({id,classification,judgment})));
  assert.equal(plan.paths.length,4);assert.equal(new Set(plan.paths).size,4);
  const io=end.ioMeasurements;assert.equal(io.length,rows.length-1);
  io.forEach((v:{index:number;type:string;serializationMs:number;saveMs:number},i:number)=>{
    assert.equal(v.index,i);assert.equal(v.type,rows[i].type);assert.ok(v.serializationMs>=0&&v.saveMs>=0);
  });
  const roots=rows.filter(r=>r.type==='root-fixed');assert.equal(roots.length,48,'root repetition count');
  assert.ok(roots.every(r=>plan.selection.includes(r.id)));
  for(const id of plan.selection) {
    const entries=roots.filter(r=>r.id===id);
    assert.equal(entries.length,2,'missing or extra root repetition: '+id);
    assert.equal(new Set(entries.map(r=>r.rep)).size,2,'duplicate root repetition: '+id);
  }
  const fixed=rows.filter(r=>r.type==='pair-fixed'),controls=rows.filter(r=>r.type==='probe-control');
  for(const r of [...roots,...fixed,...controls]) {
    assert.ok([0,1].includes(r.rep),'invalid repetition index');
    const expected=r.type==='root-fixed'?ROOT_CONDITION:r.type==='probe-control'?CONDITIONS[0]:CONDITIONS.find(c=>c.name===r.condition?.name);
    assert.ok(expected,'unknown fixed condition');
    if(plan.schema===3||Object.hasOwn(r,'condition')||(r.type!=='probe-control'&&r.status!=='not-run'))
      assert.deepEqual(r.condition,expected,'fixed condition: '+r.id);
    if(plan.schema===3||Object.hasOwn(r,'budget')||(r.type!=='probe-control'&&r.status!=='not-run'))
      assert.deepEqual(r.budget,BUDGET,'fixed budget: '+r.id);
    if(r.status!=='not-run')
      assert.equal(r.repeatKey,repeatKey(r as FixedObservation),'stored repetition key differs from observation');
    else assert.ok(!r.result,'unexpected result for skipped search');
  }
  const byId=restoreInvestigationPositions(plan.paths,plan.before,new Set<string>(plan.selection));
  assert.equal(byId.size,56);
  assert.ok(plan.classificationRows.every((r:{id:string})=>byId.has(r.id)),'classification position missing from journals');
  const position=(id:string):RestoredPosition=>{
    const c=byId.get(id);
    assert.ok(c,'position missing from journals: '+id);
    return c;
  };
  const legalById=new Map(plan.selection.map((id:string)=>[id,getLegalActions(position(id).state)])) as Map<string,LegalAction[]>;
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
  const invalid: {type:string;id:string;rep:number;condition:string;kind?:string;detailed?:boolean;reason:string}[]=[];
  const unusable=new Set<typeof rows[number]>();
  const repetitions=(entries:typeof rows)=>entries.length===2 && entries.every(r=>!unusable.has(r)) &&
    repeatKey(entries[0] as FixedObservation)===repeatKey(entries[1] as FixedObservation);
  const checkFixed=(r:typeof rows[number],c:RestoredPosition,condition:typeof CONDITIONS[number]|typeof ROOT_CONDITION,action:LegalAction|null)=>{
    const skipped=r.status==='not-run';
    // Schema 2 omitted hash on root rows, and identity on probe and skipped rows.
    // Replay supplies the expected position for validation, not historical runtime metadata.
    if(plan.schema===3 || Object.hasOwn(r,'positionHash') || (r.type==='pair-fixed'&&!skipped))
      assert.equal(r.positionHash,c.positionHash,'fixed position hash: '+r.id);
    if(plan.schema===3 || Object.hasOwn(r,'mode') || (r.type!=='probe-control'&&!skipped))
      assert.equal(r.mode,c.mode,'fixed mode: '+r.id);
    if(!skipped) {
      assert.ok(Number.isInteger(r.nodes.normal)&&Number.isInteger(r.nodes.quiescence)&&r.nodes.normal>=0&&r.nodes.quiescence>=0);
      assert.ok(r.nodes.normal+r.nodes.quiescence<=BUDGET.nodes);
      const legal=legalById.get(r.id)!;
      assert.equal(r.rootLegalCount,legal.length,'fixed legal count: '+r.id);
      assert.equal(r.candidateCount,action?1:legal.length,'fixed candidate count: '+r.id);
      assert.deepEqual(r.action,action,'fixed root restriction: '+r.id);
    }
    let reason=fixedInvalidReason(r,condition.depth);
    if(!reason) {
      if(r.result.rootLegalActionCount!==r.candidateCount) reason='inconsistent-result-candidate-count';
      let state=c.state;
      const pv=r.result.principalVariation;
      const qDepth=condition.options.quiescence!.maxTacticalDepth;
      if(pv.length>condition.depth+qDepth) reason='pv-exceeds-search-horizon';
      for(const [ply,move] of pv.entries()) {
        if(!getLegalActions(state).some(a=>areLegalActionsEqual(a,move))) {reason='illegal-pv';break;}
        const target=state.squares[move.to.row][move.to.col].piece;
        const capture=move.kind==='move'&&target!==null&&target.player!==move.player;
        if(ply>=condition.depth&&!capture&&!isPlayerInCheck(state,state.turn)) {
          reason='non-tactical-quiescence-pv';break;
        }
        state=apply(state,move);
      }
      if(!reason&&pv.length<condition.depth&&state.status!=='ended') reason='pv-shorter-than-completed-depth';
      if(!reason) {
        const expected=evaluateSearchPositionBreakdown(state,c.state.turn,{pieceSafetyMode:c.mode});
        // Normalize through the evidence encoder, including numeric -0 and terminal values.
        if(!isDeepStrictEqual(JSON.parse(json(expected)),r.result.evaluationBreakdown)) reason='pv-evaluation-mismatch';
      }
    }
    if(reason) {
      unusable.add(r);
      invalid.push({type:r.type,id:r.id,rep:r.rep,condition:condition.name,kind:r.kind,detailed:r.detailed,reason});
    }
  };
  const rootReproducibility=plan.selection.map((id:string)=>{
    const entries=roots.filter(r=>r.id===id);
    const c=position(id);
    entries.forEach(r=>checkFixed(r,c,ROOT_CONDITION,null));
    const reproducible=repetitions(entries),result=reproducible?entries[0].result:null;
    return {id,reproducible,status:entries.map(r=>r.status),nodes:entries.map(r=>r.nodes??null),
      selectedAction:result?.selectedAction??null,score:result?.selectedEvaluation??null,pv:result?.principalVariation??null};
  });
  const candidates=rows.filter(r=>r.type==='candidates');
  assert.equal(candidates.length,4);assert.equal(new Set(candidates.map(r=>r.id)).size,4);
  assert.ok(candidates.every(r=>plan.suspected.includes(r.id)));
  const groups=candidates.map(c=>{
    const restored=position(c.id);
    const legal=legalById.get(c.id)!;
    const alternative=prior.find((r:{id:string})=>r.id===c.id).alternative;
    const hasLegalAlternative=alternative && legal.some(a=>areLegalActionsEqual(a,alternative));
    if(c.status==='invalid') {
      assert.ok(!hasLegalAlternative,'invalid status for a legal pilot candidate');
      assert.ok(!fixed.some(r=>r.id===c.id));
      return {id:c.id,status:'invalid',reason:c.reason};
    }
    assert.equal(c.journal,restored.path);
    assert.equal(c.ply,restored.move.ply);
    assert.equal(c.player,restored.state.turn);
    assert.equal(c.mode,restored.mode);
    assert.equal(c.positionHash,restored.positionHash);
    assert.deepEqual(c.actual.action,restored.move.action,'actual candidate differs from journal');
    assert.deepEqual(c.alternative.action,alternative,'alternative differs from pilot');
    for(const kind of ['actual','alternative']) {
      assert.ok(legal.some(a=>areLegalActionsEqual(a,c[kind].action)),'illegal '+kind+' candidate');
      assert.deepEqual(c[kind],JSON.parse(json(inspectCandidate(restored.state,c[kind].action,plan.limits.maxExchangeCaptures))),
        'candidate reply or exchange metadata mismatch: '+c.id+' '+kind);
    }
    const conditions=CONDITIONS.map(condition=>{
      const entries=fixed.filter(r=>r.id===c.id&&r.condition.name===condition.name);assert.equal(entries.length,4);
      assert.equal(new Set(entries.map(r=>r.kind+':'+r.rep)).size,4);
      entries.forEach(r=>{
        assert.ok(['actual','alternative'].includes(r.kind));
        checkFixed(r,restored,condition,c[r.kind].action);
      });
      const actual=entries.filter(r=>r.kind==='actual'),alt=entries.filter(r=>r.kind==='alternative');
      const reproducible=repetitions(actual)&&repetitions(alt);
      const judgment=reproducible?compareFixed(actual[0],alt[0]):{verdict:'INDETERMINATE',delta:null,reason:'Repetition incomplete or inconsistent.'};
      return {name:condition.name,reproducible,judgment,
        actual:reproducible?actual[0].result.selectedEvaluation:null,alternative:reproducible?alt[0].result.selectedEvaluation:null,
        pvActual:reproducible?actual[0].result.principalVariation:null,pvAlternative:reproducible?alt[0].result.principalVariation:null,
        nodes:entries.map(r=>r.nodes??null),status:entries.map(r=>r.status),reason:entries.map(r=>r.reason)};
    });
    const baseline=conditions[0];
    const factors=conditions.slice(1).map((v:typeof baseline,i:number)=>{
      const changes=[CONDITION_CHANGES[i]];
      const deltaChange=baseline.judgment.delta===null||v.judgment.delta===null?null:v.judgment.delta-baseline.judgment.delta;
      const valid=baseline.reproducible&&v.reproducible&&deltaChange!==null&&Number.isFinite(deltaChange);
      const differs=valid&&(v.actual!==baseline.actual||v.alternative!==baseline.alternative||json(v.pvActual)!==json(baseline.pvActual)||json(v.pvAlternative)!==json(baseline.pvAlternative));
      return {condition:v.name,changedFields:changes,fixed:['position','candidate actions','perspective','mode','node/time caps','other settings'],
        status:!valid?'EXPERIMENT_INVALID':differs?'OBSERVED_EFFECT':'NO_OBSERVED_VALUE_OR_PV_CHANGE',
        deltaChange:valid?deltaChange:null,
        interpretation:v.name==='see-order'?'Existing ordering policy, not isolated SEE arithmetic; original standard ordering does not use SEE.':'Effect within bounded search; cause of historical move UNKNOWN.'};
    });
    return {id:c.id,journal:c.journal,ply:c.ply,player:c.player,mode:c.mode,conditions,factors,
      legalReplies:{actual:c.actual.replies.length,alternative:c.alternative.replies.length},
      legalCaptures:{actual:c.actual.captures.length,alternative:c.alternative.captures.length},
      exchangeScope:c.actual.exchangeScope,verdict:'INDETERMINATE',
      reason:'Direction may depend on depth/quiescence. Bounded evidence does not establish historical move error or component causality.'};
  });
  assert.equal(fixed.length,candidates.filter(c=>c.status!=='invalid').length*plan.conditions.length*4);
  const probeControls=candidates.filter(c=>c.status!=='invalid').map(c=>{
    const entries=controls.filter(r=>r.id===c.id);assert.equal(entries.length,4);
    assert.ok(entries.every(r=>typeof r.detailed==='boolean'));
    assert.equal(new Set(entries.map(r=>r.detailed+':'+r.rep)).size,4);
    const restored=position(c.id);
    entries.forEach(r=>checkFixed(r,restored,CONDITIONS[0],c.actual.action));
    return {id:c.id,sameResult:entries.every(r=>!unusable.has(r))&&new Set(entries.map(r=>repeatKey(r))).size===1,
      timings:entries.map(r=>({detailed:r.detailed,rep:r.rep,searchMs:r.searchMs??null}))};
  });
  assert.equal(controls.length,probeControls.length*4);
  return {schema:plan.schema,baseHead:plan.baseHead,journals:plan.paths,hashBefore:plan.before,hashAfter:end.after,
    counts,plies:setup.plies,setup:setup.extraction,elapsedMs:end.elapsedMs,
    timed:{count:timed.length,status:frequencies(timed.map(r=>r.status)),completedDepth:frequencies(timed.map(r=>r.completedDepth)),
      interruptedPhase:frequencies(timed.map(r=>r.interruptedPhase)),interruptedStage:frequencies(timed.map(r=>r.interruptedStage)),
      crossedDeadlinePhase:frequencies(timed.map(r=>r.crossedDeadlinePhase)),phaseTotals,
      searchMs:timed.reduce((n,r)=>n+(r.searchMs??0),0),legalMs:timed.reduce((n,r)=>n+(r.legalMs??0),0),
      candidateMs:timed.reduce((n,r)=>n+(r.candidateMs??0),0),preparationMs:timed.reduce((n,r)=>n+(r.preparationMs??0),0),
      normalizationMs:timed.reduce((n,r)=>n+(r.normalizationMs??0),0)},
    io:{serializationMs:io.reduce((n:number,r:{serializationMs:number})=>n+r.serializationMs,0),saveMs:io.reduce((n:number,r:{saveMs:number})=>n+r.saveMs,0),scope:end.ioScope},
    fixed:{rootCalls:roots.length,pairCalls:fixed.length,rootReproducibility,groups,probeControls,
      rootPositionHashSource:plan.schema===3?'recorded-and-journal-verified':'journal-reconstructed',
      invalidObservations:{count:invalid.length,byReason:frequencies(invalid.map(r=>r.reason)),rows:invalid}},
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
