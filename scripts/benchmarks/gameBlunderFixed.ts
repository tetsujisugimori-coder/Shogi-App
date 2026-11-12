import assert from 'node:assert/strict';
import type {BoardState} from '../../src/types/shogi';
import {getLegalActions,type LegalAction} from '../../src/domain/shogi/legalActions';
import {analyzeAlphaBetaSearch,areLegalActionsEqual,type AlphaBetaSearchOptions} from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import {SearchDiagnostics} from '../../src/domain/shogi/searchDiagnostics';
import {stateHash} from './matchJournal';

export const fixedOptions=(q:0|1):AlphaBetaSearchOptions=>({moveOrdering:'standard',killerMoves:false,usePreviousIterationPv:false,useTranspositionTable:false,
  quiescence:{maxTacticalDepth:q,moveOrdering:'original',includeQuietPromotions:false,maxCheckEvasionExtensions:0}});
class Stop extends Error {constructor(readonly reason:'node-limit'|'time-limit'){super(reason);}}
/** Diagnostic-only root action, fixed-depth engine; a stopped search yields no score. */
export function fixedCandidate(state:BoardState, saved:LegalAction, mode:'legacy'|'experimental', q:0|1, limits={depth:2,nodes:1500,ms:3000}) {
  assert.ok(Number.isInteger(limits.depth) && limits.depth>=1 && limits.depth<=2 && Number.isInteger(limits.nodes) && limits.nodes>=1 && limits.nodes<=1500 && limits.ms>0 && limits.ms<=3000);
  const before=stateHash(state), prep=performance.now(), legal=getLegalActions(state), action=legal.find(a=>areLegalActionsEqual(a,saved));
  assert.ok(action,'candidate is not legal');
  const setupMs=performance.now()-prep, diag=new SearchDiagnostics(false,false); diag.rootAction=action;
  let nodes=0, phase:string|null=null; const started=performance.now();
  diag.traceNode=e=>{if(e.kind!=='enter')return;phase=e.phase;if(nodes>=limits.nodes)throw new Stop('node-limit');if(performance.now()-started>=limits.ms)throw new Stop('time-limit');nodes++;};
  try {
    const result=analyzeAlphaBetaSearch(state,limits.depth,{pieceSafetyMode:mode},()=>performance.now(),fixedOptions(q),diag);
    assert.equal(stateHash(state),before,'input mutated');
    return {status:'completed' as const,reason:null,rootLegalCount:legal.length,action,setupMs,nodes,phase,elapsedMs:performance.now()-started,result};
  } catch(e) {
    assert.equal(stateHash(state),before,'input mutated');
    return {status:e instanceof Stop?'interrupted' as const:'error' as const,reason:e instanceof Stop?e.reason:String(e),rootLegalCount:legal.length,action,setupMs,nodes,phase,elapsedMs:performance.now()-started,result:null};
  }
}
export function stableKey(x:ReturnType<typeof fixedCandidate>) {
  return JSON.stringify({status:x.status,reason:x.reason,nodes:x.nodes,action:x.result?.selectedAction??null,
    evaluation:x.result?.selectedEvaluation??null,pv:x.result?.principalVariation??null,depth:x.result?.depth??null},(_k,v)=>typeof v==='number' && !Number.isFinite(v) ? {nonfinite:String(v)} : v);
}

/** Preserve a completed pass when a later pass times out; never promote partial-root. */
export function completedTimedIteration(r: import('../../src/domain/shogi/twoPlyAlphaBetaAi').TimeLimitedIterativeDeepeningAlphaBetaSearchResult) {
  const last=r.iterations.at(-1);
  if (r.resultSource!=='completed-iteration' || !last || r.completedDepth<1 || last.depth!==r.completedDepth || r.depth!==r.completedDepth ||
      r.selectedEvaluation===null || !Number.isFinite(r.selectedEvaluation) || last.selectedEvaluation!==r.selectedEvaluation ||
      !last.selectedAction || !r.selectedAction || !areLegalActionsEqual(last.selectedAction,r.selectedAction) ||
      JSON.stringify(last.principalVariation)!==JSON.stringify(r.principalVariation))
    return {status:'unusable' as const,reason:'No consistent finite completed iteration.',depth:null,score:null};
  return {status:r.timedOut?'completed-with-later-deadline' as const:'completed' as const,
    reason:r.timedOut?'Next iteration interrupted; value is limited to the completed depth.':'Requested search completed.',depth:r.completedDepth,score:r.selectedEvaluation};
}
