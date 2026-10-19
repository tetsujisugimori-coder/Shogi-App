import assert from 'node:assert/strict';
import { getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';
import { type BoardState } from '../../src/types/shogi';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';
import { apply, json, verifyReference, type Reference, type Sample } from './tacticalDiagnostics';
import { type TacticalPosition } from './tacticalPositions';
import {evaluateSearchPositionBreakdown} from '../../src/domain/shogi/twoPlyMinimaxAi';
import {resolveSearchEvaluationPreset} from '../../src/domain/shogi/searchEvaluationPresets';

/** Ended-state getLegalActions intentionally returns [] without enumeration.
 * Reactivate only an independent copy to verify actual absence of responses.
 * The original full game state/history is never modified or replayed onward. */
export function verifyAdjudication(s:BoardState) {
  if (s.status!=='ended') return;
  const reason=s.result?.endReason;
  if (reason!=='checkmate' && reason!=='no_legal_actions') return;
  const inCheck=isPlayerInCheck(s,s.turn);
  const active={...s,status:inCheck?'check' as const:'active' as const,result:null};
  assert.equal(getLegalActions(active).length,0,'ended status alone is not a legal-response proof');
  assert.equal(inCheck,reason==='checkmate');
}
export function auditProofAdjudications(p:TacticalPosition,ref:Reference) {
  verifyReference(p,ref);
  function walk(s:BoardState, proof:NonNullable<Reference['candidates'][number]['proof']>):void {
    if ('terminal' in proof) {verifyAdjudication(s);return;}
    for (const r of proof.replies) walk(apply(s,r.action),r.proof);
  }
  for (const c of ref.candidates) if(c.proof) walk(apply(p.state,c.action),c.proof);
}
function replay(p:TacticalPosition,pv:LegalAction[]) {
  let s=p.state;for(const a of pv) s=apply(s,a);verifyAdjudication(s);return s;
}
export function observations(positions:TacticalPosition[],refs:Record<string,Reference>,rows:Sample[],probes:Record<string,{
  scores:{action:LegalAction;score:number;pv:LegalAction[]}[];
  originalTieSelection:{action:LegalAction;score:number;pv:LegalAction[]};
  reversedTieSelection:{action:LegalAction;score:number;pv:LegalAction[]};
}>) {
  for(const p of positions) auditProofAdjudications(p,refs[p.id]);
  return {
    method:'Saved raw and certificate replay only; no new search/positions/conditions. Re-enumerates terminal responses with ended gate removed in a copy.',
    selectedLines:rows.filter(r=>r.phase==='measurement').map(r=>{
      const p=positions.find(p=>p.id===r.position);assert.ok(p);
      const leaf=r.result?replay(p,r.result.principalVariation):null;
      return {position:p.id,condition:r.condition,pvPly:r.result?.principalVariation.length??null,
        terminalReason:leaf?.result?.endReason??null,winner:leaf?.result?.winner??null,
        referenceObjective:'checkmate-only; terminal-score-returned alone does not identify end reason'};
    }),
    candidateProbes:Object.entries(probes).map(([id,probe])=>{
      const p=positions.find(p=>p.id===id);assert.ok(p);assert.ok(probe.scores);
      assert.deepEqual(probe.scores.map(r=>r.action),getLegalActions(p.state));
      const describe=(x:typeof probe.scores[number])=>{
        const leaf=replay(p,x.pv);const ref=refs[id].candidates.find(c=>json(c.action)===json(x.action));assert.ok(ref);
        assert.equal(x.score,evaluateSearchPositionBreakdown(leaf,p.state.turn,resolveSearchEvaluationPreset('standard')).total);
        return {action:x.action,score:x.score,pvPly:x.pv.length,pvTerminalReason:leaf.result?.endReason??null,
          forcedMateDistance:ref.distance,referenceStatus:ref.status};
      };
      return {position:id,candidates:probe.scores.map(describe),original:describe(probe.originalTieSelection),reversed:describe(probe.reversedTieSelection),
        limitation:id==='resistance'?'4/2 checkmate-only proof is not 4/2 optimal game prolongation: saved PVs end by no_legal_actions/checkmate at 2 ply. General longest-resistance remains unverified.':null};
    }),
  };
}
