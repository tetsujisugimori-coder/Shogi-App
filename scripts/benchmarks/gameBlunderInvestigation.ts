import assert from 'node:assert/strict';
import type {BoardState} from '../../src/types/shogi';
import {getLegalActions, type LegalAction} from '../../src/domain/shogi/legalActions';
import {analyzeAlphaBetaSearch, areLegalActionsEqual, type AlphaBetaSearchOptions} from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import {SearchDiagnostics} from '../../src/domain/shogi/searchDiagnostics';
import {stateHash} from './matchJournal';
import {apply} from './gameBlunderPilot';
import {traceExchange} from './gameBlunderDiagnosis';
import {fixedOptions} from './gameBlunderFixed';

export const json = (value:unknown) => JSON.stringify(value, (_key,v) =>
  typeof v==='number' && !Number.isFinite(v) ? {nonfinite:String(v)} : v);
export const BUDGET = {nodes:1500, ms:3000} as const;
export const CONDITIONS = [
  {name:'baseline',depth:2,options:fixedOptions(1)},
  {name:'q0',depth:2,options:fixedOptions(0)},
  {name:'depth1',depth:1,options:fixedOptions(1)},
  // Existing SEE ordering policy also changes capture/promotion priorities.
  // This is one API setting, not a pure ablation of SEE arithmetic.
  {name:'see-order',depth:2,options:{...fixedOptions(1),moveOrdering:'static-exchange' as const}},
] as const;
export type Condition = {name:string;depth:number;options:AlphaBetaSearchOptions};
class Stop extends Error {
  constructor(readonly reason:'node-limit'|'deadline') {super(reason);}
}

/** Diagnostic-only cooperative guard. Node entries include normal/q horizon
 * entries, exclude the root and are NOT the engine's successor-state metric.
 * A synchronous legal generation, SEE or executor cannot be preempted. */
export function runFixed(state:BoardState, saved:LegalAction|null, mode:'legacy'|'experimental',
  condition:Condition, limits:{nodes:number;ms:number}=BUDGET, clock=()=>performance.now(), detailed=true) {
  assert.ok(Number.isInteger(condition.depth) && condition.depth>=1 && condition.depth<=2);
  assert.ok(Number.isInteger(limits.nodes) && limits.nodes>=1 && limits.nodes<=1500);
  assert.ok(Number.isFinite(limits.ms) && limits.ms>0 && limits.ms<=3000);
  const before=stateHash(state), began=clock(), legalAt=clock(), legal=getLegalActions(state), legalMs=clock()-legalAt;
  const candidateAt=clock();
  const action=saved ? legal.find(a=>areLegalActionsEqual(a,saved)) : null;
  const candidateMs=clock()-candidateAt;
  assert.ok(!saved || action,'candidate is not legal');
  const prepAt=clock(), diag=new SearchDiagnostics(false,false);
  if (action) diag.rootAction=action;
  // The control path keeps only the root restriction and node guard; no span clocks.
  if (!detailed) {
    diag.measure=(_phase,fn)=>fn(); diag.checked=()=>{}; diag.finish=()=>({apiOtherMilliseconds:0,totalMilliseconds:0});
  }
  const nodes={normal:0,quiescence:0}; let lastEvent:unknown=null;
  diag.traceNode=e=>{
    lastEvent={kind:e.kind,phase:e.phase,ply:e.ply,remainingDepth:e.remainingDepth,reason:e.reason??null};
    if (e.kind!=='enter') return;
    if (nodes.normal+nodes.quiescence>=limits.nodes) throw new Stop('node-limit');
    if (clock()-began>=limits.ms) throw new Stop('deadline');
    nodes[e.phase]++;
  };
  const preparationMs=clock()-prepAt, searchAt=clock();
  let result:ReturnType<typeof analyzeAlphaBetaSearch>|null=null;
  let status:'completed'|'interrupted'|'error'='completed', reason:string|null=null;
  try {
    result=analyzeAlphaBetaSearch(state,condition.depth,{pieceSafetyMode:mode},clock,condition.options,diag);
    // A long final operation must not publish an evaluation past the soft deadline.
    if (clock()-began>=limits.ms) throw new Stop('deadline');
  } catch(e) {
    status=e instanceof Stop?'interrupted':'error'; reason=e instanceof Stop?e.reason:String(e); result=null;
  } finally {assert.equal(stateHash(state),before,'input state mutated');}
  const searchMs=clock()-searchAt;
  return {status,reason,requestedDepth:condition.depth,completedDepth:result?.depth??0,
    validity:result && Number.isFinite(result.selectedEvaluation) ? 'finite-completed' : 'unusable',
    rootLegalCount:legal.length,candidateCount:action?1:legal.length,action:action??null,
    nodes,lastEvent,elapsedMs:clock()-began,legalMs,candidateMs,preparationMs,searchMs,
    phases:detailed?diag.phases:null,result};
}
export type FixedObservation=ReturnType<typeof runFixed>;
export function repeatKey(r:FixedObservation) {
  return json({status:r.status,reason:r.reason,selected:r.result?.selectedAction??null,
    score:r.result?.selectedEvaluation??null,pv:r.result?.principalVariation??null,
    completedDepth:r.completedDepth,nodes:r.nodes});
}
/** Both roots are the original mover; unlike paired child searches, no sign flip. */
export function compareFixed(a:FixedObservation,b:FixedObservation, threshold=300) {
  assert.ok(Number.isFinite(threshold) && threshold>=0);
  const valid=(x:FixedObservation)=>x.status==='completed' && x.validity==='finite-completed' &&
    x.result!==null && typeof x.result.selectedEvaluation==='number' && Number.isFinite(x.result.selectedEvaluation) &&
    x.completedDepth===x.requestedDepth && x.result.depth===x.completedDepth;
  if (!valid(a)||!valid(b)||a.completedDepth!==b.completedDepth)
    return {verdict:'INDETERMINATE',delta:null,reason:'Interrupted, non-finite, invalid or unequal-depth pair.'} as const;
  const delta=b.result!.selectedEvaluation!-a.result!.selectedEvaluation!;
  return {verdict:delta>=threshold?'SUSPECTED':'NOT_CONFIRMED',delta,
    reason:'Finite bounded preference from original mover perspective; no proof of a blunder.'} as const;
}

/** Enumerate all immediate legal replies, then trace one bounded, deterministic
 * same-square branch. Other reply/exchange branches remain explicitly unsolved. */
export function inspectCandidate(state:BoardState, saved:LegalAction, maxCaptures=4) {
  assert.ok(Number.isInteger(maxCaptures) && maxCaptures>=1 && maxCaptures<=6);
  const action=getLegalActions(state).find(a=>areLegalActionsEqual(a,saved)); assert.ok(action,'candidate is not legal');
  const child=apply(state,action), replies=getLegalActions(child);
  const capturesAt=(s:BoardState)=>getLegalActions(s).filter(a=>a.kind==='move' &&
    a.to.row===action.to.row && a.to.col===action.to.col &&
    s.squares[a.to.row][a.to.col].piece!==null && s.squares[a.to.row][a.to.col].piece!.player!==a.player);
  const captures=capturesAt(child), branches=captures.map(reply=>{
    const after=apply(child,reply); return {reply,legalRecaptures:capturesAt(after)};
  });
  let leaf=child; const line:LegalAction[]=[];
  for (let i=0;i<maxCaptures;i++) {
    const next=capturesAt(leaf)[0]; if (!next) break;
    line.push(next); leaf=apply(leaf,next); if (leaf.status==='ended') break;
  }
  return {action,childStatus:child.status,replies,captures,branches,
    deterministicExchange:traceExchange(state,action,line,maxCaptures),
    exchangeScope:'First legal same-square capture at each step, at most '+maxCaptures+' captures. All immediate captures and legal recaptures listed separately; no minimax exchange or compensation proof.'};
}

export function classificationCounts(rows:{id:string;classification:{labels:string[]};judgment:{verdict:string}}[]) {
  assert.equal(rows.length,56); assert.equal(new Set(rows.map(r=>r.id)).size,56);
  const flags=['A','B','C','D','E','F'];
  assert.ok(rows.every(r=>r.classification.labels.every(f=>flags.includes(f)) && new Set(r.classification.labels).size===r.classification.labels.length));
  return {total:rows.length,features:Object.fromEntries(flags.map(f=>[f,rows.filter(r=>r.classification.labels.includes(f)).length])),
    overlap:rows.filter(r=>r.classification.labels.length>1).length,
    noFeature:rows.filter(r=>r.classification.labels.length===0).length,noFeatureMeaning:'UNKNOWN',
    indeterminate:rows.filter(r=>r.judgment.verdict==='INDETERMINATE').length,
    notRun:rows.filter(r=>r.judgment.verdict==='NOT_RUN').length};
}
