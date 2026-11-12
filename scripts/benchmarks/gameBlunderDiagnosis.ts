import assert from 'node:assert/strict';
import type { BoardState, Player } from '../../src/types/shogi';
import { getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';
import { evaluateMaterial, getBoardPieceMaterialValue, DEFAULT_MATERIAL_VALUE_TABLE } from '../../src/domain/shogi/materialEvaluation';
import { countSquareAttackersBy } from '../../src/domain/shogi/attacks';
import { areLegalActionsEqual } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { apply } from './gameBlunderPilot';

/** Follow only the recorded same-square exchange, not a minimax proof. */
export function traceExchange(before: BoardState, played: LegalAction, continuation: readonly LegalAction[], maxCaptures=6) {
  assert.ok(Number.isInteger(maxCaptures) && maxCaptures>=1 && maxCaptures<=6);
  const perspective=before.turn, base=evaluateMaterial(before,perspective);
  let state=apply(before,played), captures=0;
  const target=played.to;
  const steps: {action:LegalAction; material:number; check:boolean; ended:boolean; legalRecaptures:LegalAction[]}[]=[];
  let stop='recorded-line-ends', nextLegalRecaptures:LegalAction[]=[];
  for (const action of continuation) {
    const occupant=state.squares[target.row][target.col].piece;
    const legal=getLegalActions(state);
    const recaptures=legal.filter(a=>a.kind==='move' && a.to.row===target.row && a.to.col===target.col && occupant!==null && occupant.player!==a.player);
    nextLegalRecaptures=recaptures;
    if (!recaptures.some(a=>areLegalActionsEqual(a,action))) {stop='recorded-move-leaves-square';break;}
    if (captures>=maxCaptures) {stop='capture-limit';break;}
    state=apply(state,action); captures++;
    steps.push({action,material:evaluateMaterial(state,perspective)-base,check:state.status==='check',ended:state.status==='ended',legalRecaptures:recaptures});
    if (state.status==='ended') {stop='terminal';nextLegalRecaptures=[];break;}
  }
  if (stop==='recorded-line-ends' && state.status!=='ended') {
    const occupant=state.squares[target.row][target.col].piece;
    nextLegalRecaptures=getLegalActions(state).filter(a=>a.kind==='move' && a.to.row===target.row && a.to.col===target.col && occupant!==null && occupant.player!==a.player);
  }
  return {perspective,baselineMaterial:base,afterPlayedMaterial:evaluateMaterial(apply(before,played),perspective)-base,steps,stop,nextLegalRecaptures,
    limitation:'Recorded legal same-square line only; declining the exchange, checks elsewhere, sacrifices and alternative branches are not solved.'};
}
export type Verdict='CONFIRMED'|'SUSPECTED'|'NOT_CONFIRMED'|'INDETERMINATE'|'NOT_RUN';
type SearchResult = {resultSource:string; timedOut:boolean; completedDepth:number; selectedEvaluation:number|null};
/** Child scores have the opposite perspective. Infinity encodes terminal preference, never a centipawn difference. */
export function evaluateComparison(actual: SearchResult|null, alternate: SearchResult|null, threshold=300, root?: SearchResult): {verdict:Verdict; delta:number|null; reason:string} {
  if (root && (root.resultSource!=='completed-iteration' || root.timedOut || root.completedDepth<1)) return {verdict:'INDETERMINATE',delta:null,reason:'Alternative selection was interrupted or incomplete.'};
  if (!actual || !alternate) return {verdict:'INDETERMINATE',delta:null,reason:'No paired child searches.'};
  if (actual.resultSource!=='completed-iteration' || alternate.resultSource!=='completed-iteration' || actual.timedOut || alternate.timedOut || actual.completedDepth<1 || actual.completedDepth!==alternate.completedDepth)
    return {verdict:'INDETERMINATE',delta:null,reason:'Interrupted, partial, failed, or unequal-depth search.'};
  if (actual.selectedEvaluation===null || alternate.selectedEvaluation===null || !Number.isFinite(actual.selectedEvaluation) || !Number.isFinite(alternate.selectedEvaluation))
    return {verdict:'INDETERMINATE',delta:null,reason:'Missing or non-finite terminal score; no numerical subtraction.'};
  const delta=actual.selectedEvaluation-alternate.selectedEvaluation;
  return {verdict:delta>=threshold?'SUSPECTED':'NOT_CONFIRMED',delta,reason:'Equal-depth completed finite comparison; finite preference does not prove an error.'};
}
export function classify(state: BoardState, trace: ReturnType<typeof traceExchange>, recordedEvaluation: number|null, delta:number|null, played?:LegalAction, depths?:{original:number|null;reference:number}) {
  const labels:string[]=[]; const features:string[]=[];
  const first=trace.steps[0];
  if(first && first.material <= -300) {labels.push('A');features.push('recorded immediate material change <= -300');}
  if(trace.steps.length%2===1 && trace.stop==='recorded-move-leaves-square' && trace.nextLegalRecaptures.length>0) {labels.push('B');features.push('legal recapture available after recorded capture, but next recorded action leaves the square');}
  if(state.status==='check' || trace.steps.some(s=>s.check||s.ended)) {labels.push('C');features.push('check or terminal in recorded line');}
  // Pre-move raw attack is only an influence hint; require a legal capture after
  // the move, the same piece, and zero raw defenders. This is not a pin proof.
  if (played) {
    const after=apply(state,played), enemy=after.turn;
    const legalCaptures=getLegalActions(after).filter(a=>a.kind==='move' && after.squares[a.to.row][a.to.col].piece?.player===state.turn);
    const exposed=legalCaptures.filter(a=>{
      const piece=after.squares[a.to.row][a.to.col].piece;
      const previous=state.squares[a.to.row][a.to.col].piece;
      return piece && previous?.id===piece.id && getBoardPieceMaterialValue(piece,DEFAULT_MATERIAL_VALUE_TABLE)>=500 &&
        countSquareAttackersBy(state.squares,a.to,enemy)>0 && countSquareAttackersBy(after.squares,a.to,state.turn)===0;
    });
    if(exposed.length) {labels.push('D'); features.push(`previous raw attack, no raw defenders, and ${exposed.length} legal captures of a stationary valuable piece`);}
  }
  if(delta!==null && delta>=300 && depths && depths.original!==null && depths.reference!==depths.original) {labels.push('E');features.push('finite preference with different original and reference depths');}
  if(first && first.material<=-300 && recordedEvaluation!==null && Number.isFinite(recordedEvaluation) && recordedEvaluation>=0) {labels.push('F');features.push('nonnegative recorded score and negative immediate material change');}
  return {labels,features,unverified:['A/F: compensation and full continuation','B: optimality of exchange','C: all legal forcing branches and mate proof','D: pre-existing attacks and defence','E: deeper independent reference']};
}
export const causes = [
  {name:'SEE',code:'src/domain/shogi/staticExchangeEvaluation.ts:84',state:'additional-investigation',why:'Existing SEE already considers legal recaptures; original standard ordering did not enable it.'},
  {name:'quiescence candidate generation',code:'src/domain/shogi/quiescenceSearch.ts:270',state:'additional-investigation',why:'q1 searches captures and legal evasions; no counterfactual measurement.'},
  {name:'quiescence cutoff',code:'src/domain/shogi/quiescenceSearch.ts',state:'additional-investigation',why:'One tactical ply limits continuation; no evidence this caused the move.'},
  {name:'check and legality',code:'src/domain/shogi/legalActions.ts',state:'insufficient-evidence',why:'Recorded moves audited legal; no generator defect demonstrated.'},
  {name:'normal search depth',code:'src/domain/shogi/twoPlyAlphaBetaAi.ts:1040',state:'additional-investigation',why:'Depth and PV recorded; no controlled depth comparison.'},
  {name:'search time',code:'src/domain/shogi/twoPlyAlphaBetaAi.ts:1040',state:'additional-investigation',why:'Deadline and depth recorded; runtime variation is not causal proof.'},
  {name:'evaluation',code:'src/domain/shogi/materialEvaluation.ts:19',state:'additional-investigation',why:'Material and full evaluation differ in scope; no isolated evaluation counterfactual.'},
  {name:'ordering',code:'src/domain/shogi/twoPlyAlphaBetaAi.ts:378',state:'additional-investigation',why:'Standard ordering recorded; no controlled ordering comparison.'},
  {name:'unknown',code:null,state:'insufficient-evidence',why:'No component has been isolated as the cause.'}
] as const;
