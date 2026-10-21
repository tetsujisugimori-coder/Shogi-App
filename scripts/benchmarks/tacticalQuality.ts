import assert from 'node:assert/strict';
import { createInitialBoardState, type BoardState } from '../../src/types/shogi';
import { getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';
import { evaluateSearchPositionBreakdown } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { validatePosition, apply, json, hash, type Result } from './tacticalDiagnostics';
import { compareReference, observePv, type ReferenceLeaf } from './terminalDistanceReference';
import { checkEvasionPositions } from './checkEvasionPositions';
import type { TacticalPosition } from './tacticalPositions';

export function loadPositions(input: unknown): TacticalPosition[] {
  assert.ok(Array.isArray(input) && input.length > 0, 'nonempty position array required');
  const seen = new Set<string>();
  for (const p of input) {
    validatePosition(p); assert.ok(!seen.has(p.id), 'duplicate position ID'); seen.add(p.id);
    assert.ok(Array.isArray(p.state.history));
    assert.ok(Array.isArray(p.state.positionHistory) && Array.isArray(p.state.positionSnapshots));
    if(p.origin.startsWith('hirate')) {
      let replay=createInitialBoardState(); replay.recordId=p.state.recordId;
      for(const move of p.state.history) {
        const action=getLegalActions(replay).find(a=>a.kind===move.kind && a.player===move.player &&
          a.pieceType===move.pieceType && a.promotion===move.promotion && json(a.to)===json(move.to) &&
          (a.kind==='move' && move.kind==='move' ? json(a.from)===json(move.from) : a.kind==='drop' && move.kind==='drop' && a.pieceId===move.pieceId));
        assert.ok(action,'history must replay legally from hirate'); replay=apply(replay,action);
      }
      assert.equal(hash(replay),hash(p.state),'serialized history/hand/snapshots must match full legal replay');
    }
  }
  return input;
}
export const categories = (p: TacticalPosition): string[] => p.expectation === 'capture' || p.origin.startsWith('hirate')
  ? ['exchange','horizon'] : p.expectation === 'shortest-win' || p.expectation === 'longest-resistance'
    ? ['mate-distance'] : ['check-evasion','horizon'];
export interface CandidateValue { action: LegalAction; value: ReferenceLeaf; closed: boolean }
export interface QualityReference {
  method: 'bounded-full-width'; depth: number; maxNodes: number; nodes: number; stopped: boolean;
  positionHash: string; candidates: CandidateValue[]; reverseVerified: boolean;
}
/** Shares public rules/evaluation but no engine search, ordering, qsearch or SearchValue.
 * closed requires EVERY branch to reach an actual adjudicated terminal, never a horizon.
 * Node cap is deterministic; an interrupted position is entirely inconclusive. */
export function qualityReference(p: TacticalPosition, depth = 3, maxNodes = 6000): QualityReference {
  validatePosition(p); assert.ok(Number.isInteger(depth) && depth >= 1 && depth <= 4);
  assert.ok(Number.isInteger(maxNodes) && maxNodes > 0);
  let nodes = 0;
  const stop = Symbol('node budget');
  function visit(s: BoardState, left: number, ply: number, reverse: boolean): {value: ReferenceLeaf; closed: boolean} {
    if (++nodes > maxNodes) throw stop;
    const breakdown = evaluateSearchPositionBreakdown(s,p.state.turn);
    if (s.status === 'ended' || left === 0) return {closed:s.status === 'ended',value:{breakdown,pv:[],
      terminalDistancePly:(breakdown.terminal === 'win' || breakdown.terminal === 'loss') ? ply : null,reason:s.result?.endReason ?? null}};
    const actions = getLegalActions(s); assert.ok(actions.length > 0, 'unadjudicated no-legal state');
    if (reverse) actions.reverse();
    let best: ReferenceLeaf | null = null, closed = true;
    for (const a of actions) {
      const child=visit(apply(s,a),left-1,ply+1,reverse); closed &&= child.closed;
      const v={...child.value,pv:[a,...child.value.pv]};
      if (!best || (s.turn === p.state.turn ? compareReference(v,best)>0 : compareReference(v,best)<0)) best=v;
    }
    return {value:best!,closed};
  }
  const candidates: CandidateValue[]=[];
  try {
    for (const action of getLegalActions(p.state)) {
      const child=apply(p.state,action), forward=visit(child,depth-1,1,false), backward=visit(child,depth-1,1,true);
      assert.equal(compareReference(forward.value,backward.value),0,'reverse traversal value differs');
      assert.equal(forward.closed,backward.closed);
      candidates.push({action,value:{...forward.value,pv:[action,...forward.value.pv]},closed:forward.closed});
    }
    return {method:'bounded-full-width',depth,maxNodes,nodes,stopped:false,positionHash:hash(p),candidates,reverseVerified:true};
  } catch(e) {
    if(e!==stop) throw e;
    return {method:'bounded-full-width',depth,maxNodes,nodes,stopped:true,positionHash:hash(p),candidates,reverseVerified:false};
  }
}
export type Quality = 'ProvenError'|'QualityGap'|'Inconclusive'|'NoObservedDifference';
export function qualityClassify(p: TacticalPosition, ref: QualityReference, r: Result | null): {
  quality: Quality; evidence: string; referenceDepth: number; selectedReference: CandidateValue|null; betterReference: CandidateValue|null;
} {
  assert.equal(ref.positionHash,hash(p));
  const out=(quality:Quality,evidence:string,selectedReference:CandidateValue|null=null,betterReference:CandidateValue|null=null)=>
    ({quality,evidence,referenceDepth:ref.depth,selectedReference,betterReference});
  if(!r || r.selectedEvaluation===null) return out('Inconclusive','missing evaluation / fallback');
  assert.ok(getLegalActions(p.state).some(a=>json(a)===json(r.selectedAction)),'illegal selected action');
  if(ref.stopped || !ref.reverseVerified) return out('Inconclusive','reference node limit / incomplete traversal');
  assert.deepEqual(ref.candidates.map(c=>c.action),getLegalActions(p.state));
  const selected=ref.candidates.find(c=>json(c.action)===json(r.selectedAction))!;
  const better=ref.candidates.find(c=>compareReference(c.value,selected.value)>0);
  if(!better) return out('NoObservedDifference','selected action tied for best within bounded reference; no global optimality claim',selected);
  // Existential better alternative is sufficient only when both subtrees are fully terminal.
  const proven=ref.candidates.find(c=>c.closed && selected.closed && compareReference(c.value,selected.value)>0);
  if(proven) return out('ProvenError','all-terminal exhaustive subtrees; all legal replies; root-relative outcome/distance',selected,proven);
  return out('QualityGap','finite-horizon full-width preference only; shared evaluator; not a proven error',selected,better);
}
export function auditQualityResult(p:TacticalPosition,r:Result,extra:number) {
  assert.ok(getLegalActions(p.state).some(a=>json(a)===json(r.selectedAction)));
  if(r.selectedEvaluation===null) { assert.equal('resultSource' in r?r.resultSource:null,'fallback'); assert.deepEqual(r.principalVariation,[]); return null; }
  assert.deepEqual(r.selectedAction,r.principalVariation[0]);
  assert.ok(r.principalVariation.length<=Math.max(1,r.depth)+1+extra);
  const observed=observePv(p.state,r.principalVariation);
  assert.deepEqual(observed.breakdown,r.evaluationBreakdown); assert.equal(observed.breakdown.total,r.selectedEvaluation);
  return observed;
}
export function aggregateQuality(positions:TacticalPosition[], rows:{position:string;condition:string;extra:number;rep:number;quality:Quality;callMs:number;overrunMs:number|null;result:Result}[]) {
  const groups:Record<string,typeof rows>={};
  for(const row of rows) {
    const p=positions.find(p=>p.id===row.position); assert.ok(p);
    for(const key of [`position/${p.id}`,`condition/${row.condition}/extra${row.extra}`,...categories(p).map(c=>`category/${c}/extra${row.extra}`)]) (groups[key]??=[]).push(row);
  }
  const stats=Object.fromEntries(Object.entries(groups).map(([key,rs])=>{
    const times=rs.map(r=>r.callMs).sort((a,b)=>a-b);
    return [key,{n:rs.length,counts:Object.fromEntries(['ProvenError','QualityGap','Inconclusive','NoObservedDifference'].map(q=>[q,rs.filter(r=>r.quality===q).length])),
      p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1),maxOverrun:Math.max(...rs.map(r=>r.overrunMs??0))}];
  }));
  const differences=rows.filter(r=>r.extra!==0).flatMap(r=>{
    const baseline=rows.find(b=>b.position===r.position&&b.condition===r.condition&&b.rep===r.rep&&b.extra===0); assert.ok(baseline);
    return json(baseline.result.selectedAction)===json(r.result.selectedAction)?[]:[{position:r.position,condition:r.condition,rep:r.rep,extra:r.extra,
      baselineDepth:baseline.result.depth,depth:r.result.depth,quality:r.quality}];
  });
  return {stats,differences,firstDifference:differences[0]??null};
}

/** Predeclared collection: two successive legal plies after the existing hirate replay.
 * First legal capture if present, otherwise first legal action; no engine score or RNG. */
export function qualityPositions(): TacticalPosition[] {
  const positions=checkEvasionPositions();
  const base=positions.find(p=>p.id==='hirate-exchange')!;
  let state=base.state;
  for(let ply=1;ply<=2;ply++) {
    const legal=getLegalActions(state);
    const action=legal.find(a=>a.kind==='move' && state.squares[a.to.row][a.to.col].piece!==null) ?? legal[0];
    assert.ok(action); state=apply(state,action);
    positions.push({...base,id:`hirate-followup-${ply}`,state,origin:'hirate legal replay; deterministic capture-first continuation',
      purpose:'predeclared consecutive exchange/history/hand candidates; no outcome filtering'});
  }
  return loadPositions(positions);
}
