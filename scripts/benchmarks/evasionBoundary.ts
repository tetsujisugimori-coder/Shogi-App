import assert from 'node:assert/strict';
import type { BoardState, Player } from '../../src/types/shogi';
import { getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';
import { evaluateSearchPositionBreakdown } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { resolveSearchEvaluationPreset } from '../../src/domain/shogi/searchEvaluationPresets';
import { analyzeAlphaBetaSearch } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { SearchDiagnostics, type SearchTraceEvent } from '../../src/domain/shogi/searchDiagnostics';
import { compareSearchValues, type SearchValue } from '../../src/domain/shogi/searchValue';
import { createPositionKey } from '../../src/domain/shogi/repetition';
import { apply, json, hash } from './tacticalDiagnostics';
import { observePv } from './terminalDistanceReference';

export const settings = (extra: number, q = 1) => ({ moveOrdering:'standard' as const, killerMoves:false,
  usePreviousIterationPv:false, useTranspositionTable:false,
  quiescence:{maxTacticalDepth:q, moveOrdering:'original' as const, maxCheckEvasionExtensions:extra} });
export const limits = { nodes:50000, milliseconds:10000, traceBytes:524288, traceEvents:1000 };
export type Limits = typeof limits;
export type Bound = 'exact'|'upper'|'lower';
export function bound(value: SearchValue, alpha: SearchValue, beta: SearchValue): Bound {
  return compareSearchValues(value,alpha)<=0 ? 'upper' : compareSearchValues(value,beta)>=0 ? 'lower' : 'exact';
}
export const rootScore = (value:number, perspective:Player, original:Player) => perspective===original ? value : -value;
export function validateInput(state:BoardState) {
  assert.equal(state.positionHistory?.at(-1)?.key,createPositionKey(state),'history tail mismatch');
  assert.ok(Array.isArray(state.history)&&Array.isArray(state.positionSnapshots));
}
export function replay(state:BoardState, pv:readonly LegalAction[], depth:number, extra:number, q=1, offset=0, root=state.turn) {
  let s=state, normal=depth, tactical=q, extensions=extra;
  const rows=[];
  const snapshot=(action:LegalAction|null, previous:BoardState|null) => ({
    plyFromOriginalRoot:offset+rows.length, stateHash:hash(s), turn:s.turn,
    inCheck:isPlayerInCheck(s,s.turn), action, legalReplay:true,
    captured:action?.kind==='move' ? previous?.squares[action.to.row][action.to.col].piece??null : null,
    promotion:action?.promotion??null, senteHand:s.senteHand, goteHand:s.goteHand,
    historyLength:s.history.length, positionHistoryLength:s.positionHistory?.length,
    phase:normal>0?'normal':tactical>0?'quiescence':'check-evasion-boundary',
    remainingNormal:normal, remainingQ:tactical, remainingEvasions:extensions,
    evaluationPerspective:root, breakdown:evaluateSearchPositionBreakdown(s,root,resolveSearchEvaluationPreset('standard')),
  });
  rows.push(snapshot(null,null));
  for(const action of pv) {
    if(normal>0) normal--; else if(tactical>0) tactical--;
    else { assert.ok(isPlayerInCheck(s,s.turn)&&extensions>0,'PV exceeded evasion budget'); extensions--; }
    const previous=s; s=apply(s,action); rows.push(snapshot(action,previous));
  }
  const checked=isPlayerInCheck(s,s.turn);
  const captures=getLegalActions(s).filter(a=>a.kind==='move'&&s.squares[a.to.row][a.to.col].piece!==null);
  const leafReason=s.status==='ended'?'terminal':normal>0?'no-legal-actions':tactical===0?
    checked&&extensions===0?'evasion-cap':checked?'unresolved-check-boundary':'q-horizon':
    checked?'no-legal-evasion':captures.length?'stand-pat-selected':'no-tactical-candidate';
  return {rows, leafReason, terminalReason:s.result?.endReason??null,
    omittedQuietActions:s.status==='ended'?0:getLegalActions(s).length-captures.length};
}
function traceSnapshot(e:SearchTraceEvent, start:BoardState) {
  const {state,...event}=e;
  const path:LegalAction[]=state.history.slice(start.history.length).map(m=>m.kind==='move'?
    {kind:m.kind,player:m.player,from:m.from,to:m.to,pieceType:m.pieceType,promotion:m.promotion}:
    {kind:m.kind,player:m.player,pieceId:m.pieceId,to:m.to,pieceType:m.pieceType,promotion:m.promotion});
  return {...event,stateHash:hash(state),turn:state.turn,inCheck:isPlayerInCheck(state,state.turn),path,
    lastCapture:state.history.at(-1)?.capturedPieceType??null,senteHand:state.senteHand,goteHand:state.goteHand,
    evaluationPerspective:start.turn,staticBreakdown:evaluateSearchPositionBreakdown(state,start.turn,resolveSearchEvaluationPreset('standard'))};
}
export function diagnose(state:BoardState, depth:number, extra:number, candidate:LegalAction|null=null,
  budget:Limits=limits, control:{now?:()=>number; interrupted?:()=>boolean}={}, q=1) {
  validateInput(state); assert.ok(Number.isInteger(depth)&&depth>=1&&depth<=4);
  assert.ok(Number.isInteger(extra)&&extra>=0&&extra<=2);
  for(const k of Object.keys(budget) as (keyof Limits)[]) assert.ok(Number.isFinite(budget[k])&&budget[k]>=0);
  const inputHash=hash(state), now=control.now??(()=>performance.now()), began=now();
  let nodes=0, bytes=0, omitted=0, reason:string|null=null;
  const trace:ReturnType<typeof traceSnapshot>[]=[], rootCandidates:{action:LegalAction;value:SearchValue;bound:Bound}[]=[];
  const stops:Record<string,number>={}; const sentinel=Symbol('diagnostic limit');
  const diagnostics=new SearchDiagnostics(); diagnostics.rootAction=candidate??undefined;
  const actions=getLegalActions(state);
  const traceNode=(e:SearchTraceEvent) => {
    if(e.kind==='enter') {
      reason=control.interrupted?.()?'interrupted':now()-began>=budget.milliseconds?'time':nodes>=budget.nodes?'nodes':null;
      if(reason) throw sentinel;
      nodes++;
    }
    if(e.reason) stops[e.reason]=(stops[e.reason]??0)+1;
    if(e.kind==='return'&&e.phase==='normal'&&e.ply===1) {
      // Match the applied root action by complete successor state, including history.
      const action=(candidate?[candidate]:actions).find(a=>hash(apply(state,a))===hash(e.state));
      assert.ok(action); rootCandidates.push({action,value:e.value!,bound:bound(e.value!,e.alpha!,e.beta!)});
    }
    if(trace.length>=budget.traceEvents||bytes>=budget.traceBytes) {omitted++;return;}
    const row=traceSnapshot(e,state);
    const size=Buffer.byteLength(json(row));
    if(trace.length>=budget.traceEvents||bytes+size>budget.traceBytes) omitted++;
    else {trace.push(row);bytes+=size;}
  };
  diagnostics.traceNode=traceNode;
  let result:ReturnType<typeof analyzeAlphaBetaSearch>|null=null, error:string|null=null;
  try { result=analyzeAlphaBetaSearch(state,depth,resolveSearchEvaluationPreset('standard'),undefined,settings(extra,q),diagnostics); }
  catch(e) { if(e!==sentinel) {reason='exception'; error=String(e);} }
  assert.equal(hash(state),inputHash,'diagnosis mutated input');
  if(result?.selectedEvaluation!==null&&result) {
    assert.deepEqual(observePv(state,result.principalVariation).breakdown,result.evaluationBreakdown);
    if(candidate) assert.deepEqual(result.selectedAction,candidate);
  }
  return {inputHash, depthIncludesCandidate:true, requestedDepth:depth, extra, q, candidate,
    resultSource:result?'fixed-depth':'incomplete-fixed-depth', completedDepth:result?depth:0,
    timedOut:reason==='time', interrupted:reason==='interrupted', limitReason:reason, error,
    valueKind:result?'exact' as const:null, exactScope:'completed finite product horizon; evasion cap remains a static approximation',
    nodes, elapsedMs:now()-began, result, rootCandidates,
    trace, traceBytes:bytes, traceOmitted:omitted, traceLimitReached:omitted>0, stops,
    pv:result?replay(state,result.principalVariation,depth,extra,q):null};
}
export type Diagnosis=ReturnType<typeof diagnose>;
export function aggregate(state:BoardState, rows:Diagnosis[]) {
  const cache=new Map<string,BoardState>([['[]',state]]);
  const position=(path:LegalAction[]):BoardState=>{
    const key=json(path), known=cache.get(key);if(known)return known;
    const next=apply(position(path.slice(0,-1)),path.at(-1)!);cache.set(key,next);return next;
  };
  return rows.map(row=>{
    assert.equal(row.inputHash,hash(state));
    let traceBytes=0;
    for(const entry of row.trace) {
      const s=position(entry.path);assert.equal(hash(s),entry.stateHash);
      assert.equal(entry.ply,entry.path.length);assert.equal(entry.turn,s.turn);
      assert.equal(entry.inCheck,isPlayerInCheck(s,s.turn));assert.equal(entry.evaluationPerspective,state.turn);
      assert.deepEqual(entry.senteHand,s.senteHand);assert.deepEqual(entry.goteHand,s.goteHand);
      assert.deepEqual(entry.staticBreakdown,evaluateSearchPositionBreakdown(s,state.turn,resolveSearchEvaluationPreset('standard')));
      traceBytes+=Buffer.byteLength(json(entry));
    }
    assert.equal(traceBytes,row.traceBytes);
    if(!row.result) {assert.equal(row.completedDepth,0);assert.equal(row.valueKind,null);assert.equal(row.pv,null);}
    else {
      assert.equal(row.completedDepth,row.requestedDepth); assert.equal(row.valueKind,'exact');
      assert.deepEqual(row.pv,replay(state,row.result.principalVariation,row.requestedDepth,row.extra,row.q));
      assert.deepEqual(observePv(state,row.result.principalVariation).breakdown,row.result.evaluationBreakdown);
    }
    return {depth:row.requestedDepth,extra:row.extra,q:row.q,candidate:row.candidate,
      source:row.resultSource,completedDepth:row.completedDepth,valueKind:row.valueKind,
      score:row.result?.selectedEvaluation??null,selected:row.result?.selectedAction??null,
      pv:row.result?.principalVariation??[],leafReason:row.pv?.leafReason??null,stop:row.limitReason,
      rootCandidates:row.rootCandidates,traceOmitted:row.traceOmitted,
      ties:row.rootCandidates.filter(c=>c.bound==='exact'&&row.result&&
        c.value.category==='non-terminal'&&c.value.evaluation===row.result.selectedEvaluation).map(c=>c.action),
      tieScope:'only exact observed root candidates; bound equality is not an exact tie',
    };
  });
}
