import assert from 'node:assert/strict';
import { type BoardState, type Player, canPromote } from '../../src/types/shogi';
import { getLegalActions, executeLegalAction, type LegalAction } from '../../src/domain/shogi/legalActions';
import { isPlayerInCheck } from '../../src/domain/shogi/checkmate';
import { createPositionKey } from '../../src/domain/shogi/repetition';
import { evaluateSearchPositionBreakdown } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { resolveSearchEvaluationPreset } from '../../src/domain/shogi/searchEvaluationPresets';
import { type AlphaBetaSearchResult, type TimeLimitedIterativeDeepeningAlphaBetaSearchResult as Timed } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { validatePartialRoot } from '../../src/application/partialRootValidation';
import { validateContract } from './partialRootMatches';
import { type TacticalPosition, other } from './tacticalPositions';
export { json, parse, hash } from './partialRootMatches';
import { json } from './partialRootMatches';

export const CONDITIONS = [
  { id: 'fixed-d1-q0', depth: 1, q: 0, budget: null },
  { id: 'fixed-d1-q1', depth: 1, q: 1, budget: null },
  { id: 'fixed-d1-q2', depth: 1, q: 2, budget: null },
  { id: 'fixed-d4-q1', depth: 4, q: 1, budget: null },
  { id: 'timed-100-q1', depth: 4, q: 1, budget: 100 },
  { id: 'timed-1000-q1', depth: 4, q: 1, budget: 1000 },
] as const;
export type Condition = typeof CONDITIONS[number];
export const options = (q: number) => ({ moveOrdering: 'standard' as const, killerMoves: false,
  quiescence: { maxTacticalDepth: q, moveOrdering: 'original' as const } });
export function apply(state: BoardState, action: LegalAction) {
  assert.ok(getLegalActions(state).some(a => json(a) === json(action)), 'illegal reference/PV action');
  const r = executeLegalAction(state, action, { proposer: 'local_ai' });
  assert.equal(r.type, 'applied'); if (r.type !== 'applied') throw Error('application');
  return r.state;
}

/** Checks problem-position consistency; does NOT certify hirate reachability.
 * Missing material is outside the problem (never silently assigned to a hand). */
export function validatePosition(p: TacticalPosition) {
  assert.match(p.id, /^[a-z][a-z0-9-]+$/); assert.ok(p.origin && p.purpose);
  const s = p.state;
  assert.ok(['sente', 'gote'].includes(s.turn));
  assert.ok(['active', 'check'].includes(s.status)); assert.equal(s.result, null);
  assert.equal(s.squares.length, 9);
  const ids = new Set<string>();
  const counts: Record<string, number> = {};
  s.squares.forEach((row, r) => { assert.equal(row.length, 9); row.forEach((sq, c) => {
    assert.equal(sq.row, r); assert.equal(sq.col, c);
    const x = sq.piece; if (!x) return;
    assert.ok(['king','rook','bishop','gold','silver','knight','lance','pawn'].includes(x.type));
    assert.ok(['sente', 'gote'].includes(x.player)); assert.ok(!ids.has(x.id)); ids.add(x.id);
    counts[x.type] = (counts[x.type] ?? 0) + 1;
    if (x.isPromoted) assert.ok(canPromote(x.type));
    if (!x.isPromoted) {
      const edge = x.player === 'sente' ? r : 8-r;
      if (x.type === 'pawn' || x.type === 'lance') assert.ok(edge > 0);
      if (x.type === 'knight') assert.ok(edge > 1);
    }
  }); });
  for (const player of ['sente', 'gote'] as const) {
    assert.equal(s.squares.flat().filter(sq => sq.piece?.type === 'king' && sq.piece.player === player).length, 1);
    for (let c=0;c<9;c++) assert.ok(s.squares.flat().filter(sq => sq.col===c && sq.piece?.type==='pawn' && !sq.piece.isPromoted && sq.piece.player===player).length<=1);
    for (const x of player === 'sente' ? s.senteHand : s.goteHand) {
      assert.ok(['rook','bishop','gold','silver','knight','lance','pawn'].includes(x.type));
      assert.equal(x.player, player); assert.notEqual(x.type, 'king'); assert.ok(!x.isPromoted);
      assert.ok(!ids.has(x.id)); ids.add(x.id); counts[x.type] = (counts[x.type] ?? 0) + 1;
    }
  }
  for (const [type, max] of Object.entries({king:2,rook:2,bishop:2,gold:4,silver:4,knight:4,lance:4,pawn:18})) assert.ok((counts[type]??0)<=max);
  assert.ok(!isPlayerInCheck(s, other(s.turn)), 'previous mover left own king checked');
  assert.equal(s.status === 'check', isPlayerInCheck(s, s.turn));
  assert.equal(s.positionHistory?.at(-1)?.key, createPositionKey(s));
  assert.ok(getLegalActions(s).length > 0);
  assert.ok(Number.isInteger(p.referenceDepth) && p.referenceDepth>=1 && p.referenceDepth<=4);
  return { consistency: 'verified', reachability: p.origin.startsWith('hirate') ? 'legal-replay' : 'not-claimed',
    turn: s.turn, legalCount: getLegalActions(s).length, inCheck: isPlayerInCheck(s, s.turn) };
}
export type MateProof = { terminal: true } | { turn: Player; quantifier: 'exists'|'all'; replies: { action:LegalAction; proof:MateProof }[] };
export interface CandidateProof { action: LegalAction; status: 'forced' | 'no-force-within-bound' | 'unverified'; distance: number | null; checkedThrough: number; proof?:MateProof }
export interface Reference { winner: Player; maxPly: number; nodes: number; elapsedMs: number; stopped: boolean; candidates: CandidateProof[] }

/** Independent CHECKMATE-ONLY Boolean AND/OR solver: no engine score, ordering,
 * qsearch, alpha-beta, or engine PV. Distances optimize the checkmate objective,
 * not the distance to any decisive ending (e.g. no_legal_actions is excluded).
 * All defending replies must succeed; existential attacker nodes may stop at a
 * witness. No transposition cache: repetition histories stay distinct. */
export function reference(p: TacticalPosition, maxNodes = 60000, maxMs = 8000): Reference {
  validatePosition(p);
  const start = performance.now(); let nodes = 0; let stopped = false;
  const stop = Symbol('reference limit');
  function force(s: BoardState, depth: number): MateProof | null {
    if (++nodes > maxNodes || performance.now() - start > maxMs) throw stop;
    const legal = getLegalActions(s);
    if (s.status === 'ended') {
      if (s.result?.endReason === 'checkmate') {
        assert.equal(legal.length, 0); assert.ok(isPlayerInCheck(s, s.turn));
      }
      return s.result?.endReason === 'checkmate' && s.result.winner === p.referenceWinner ? {terminal:true} : null;
    }
    if (legal.length === 0) return isPlayerInCheck(s, s.turn) && s.turn !== p.referenceWinner ? {terminal:true} : null;
    if (depth === 0) return null;
    if (s.turn === p.referenceWinner) {
      for (const a of legal) { const proof=force(apply(s,a),depth-1); if (proof) return {turn:s.turn,quantifier:'exists',replies:[{action:a,proof}]}; }
      return null;
    }
    const replies: {action:LegalAction;proof:MateProof}[]=[];
    for (const a of legal) { const proof=force(apply(s,a),depth-1); if (!proof) return null; replies.push({action:a,proof}); }
    return {turn:s.turn,quantifier:'all',replies};
  }
  const candidates: CandidateProof[] = getLegalActions(p.state).map(action => ({ action, status: 'unverified', distance: null, checkedThrough: 0 }));
  // Breadth by horizon prevents one expensive candidate starving all one-ply checks.
  try {
    for (let d=1; d<=p.referenceDepth; d++) for (const c of candidates) {
      if (c.status === 'forced') continue;
      const proven = force(apply(p.state,c.action), d-1);
      c.checkedThrough = d;
      c.status = proven ? 'forced' : 'no-force-within-bound';
      if (proven) { c.distance = d; c.proof = proven; }
    }
  } catch (e) { if (e !== stop) throw e; stopped = true; }
  // Partial negative checks cannot be presented as having reached the requested horizon.
  for (const c of candidates) if (c.status !== 'forced' && c.checkedThrough < p.referenceDepth) c.status = 'unverified';
  return { winner: p.referenceWinner, maxPly: p.referenceDepth, nodes, elapsedMs: performance.now()-start, stopped, candidates };
}
/** Audits saved positive certificates by public legal replay; no search engine. */
export function verifyReference(p:TacticalPosition, ref:Reference) {
  assert.equal(ref.winner,p.referenceWinner);assert.equal(ref.maxPly,p.referenceDepth);
  assert.deepEqual(ref.candidates.map(c=>c.action),getLegalActions(p.state));
  function check(s:BoardState, proof:MateProof):number {
    const legal=getLegalActions(s);
    if ('terminal' in proof) {
      assert.equal(legal.length,0); assert.ok(isPlayerInCheck(s,s.turn)); assert.notEqual(s.turn,ref.winner);
      if(s.status==='ended') {assert.equal(s.result?.endReason,'checkmate');assert.equal(s.result?.winner,ref.winner);}
      return 0;
    }
    assert.equal(proof.turn,s.turn);assert.equal(proof.quantifier,s.turn===ref.winner?'exists':'all');
    if(proof.quantifier==='all') assert.deepEqual(proof.replies.map(r=>r.action),legal);
    else assert.equal(proof.replies.length,1);
    assert.ok(proof.replies.length>0);
    return 1+Math.max(...proof.replies.map(r=>check(apply(s,r.action),r.proof)));
  }
  for (const c of ref.candidates) {
    assert.ok(['forced','no-force-within-bound','unverified'].includes(c.status));
    assert.ok(Number.isInteger(c.checkedThrough)&&c.checkedThrough>=0&&c.checkedThrough<=ref.maxPly);
    if(c.status==='forced') {assert.ok(c.proof);assert.ok(c.distance!>=1&&c.distance!<=ref.maxPly);assert.equal(1+check(apply(p.state,c.action),c.proof),c.distance);}
    else {assert.equal(c.distance,null);assert.equal(c.proof,undefined);if(c.status==='no-force-within-bound') assert.equal(c.checkedThrough,ref.maxPly);}
  }
}
export type Result = AlphaBetaSearchResult | Timed;
export function validateResult(p: TacticalPosition, c: Condition, r: Result) {
  assert.ok(r && r.selectedAction); const legal = getLegalActions(p.state);
  assert.equal(r.rootLegalActionCount, legal.length);
  assert.ok(legal.some(a => json(a) === json(r.selectedAction)));
  assert.equal(r.depth, c.budget === null ? c.depth : (r as Timed).completedDepth);
  assert.ok(Number.isFinite(r.elapsedMilliseconds) && r.elapsedMilliseconds >= 0);
  assert.ok(r.selectedEvaluation === null || typeof r.selectedEvaluation === 'number' && !Number.isNaN(r.selectedEvaluation));
  for (const key of ['visitedPositionCount','quiescenceVisitedPositionCount','quiescenceLeafCount','cutoffCount','skippedActionCount','quiescenceCutoffCount','quiescenceSkippedActionCount'] as const) assert.ok(Number.isSafeInteger(r[key]) && r[key]>=0);
  if (c.budget !== null) {
    validateContract(p.state, r as Timed, 'c');
    if ((r as Timed).resultSource === 'partial-root') assert.ok(validatePartialRoot(p.state, r as Timed, c.q));
    if ((r as Timed).resultSource === 'fallback') {
      assert.equal(r.selectedEvaluation, null); assert.equal(r.evaluationBreakdown,null); assert.deepEqual(r.principalVariation,[]); return;
    }
  }
  assert.equal(r.evaluationBreakdown?.total, r.selectedEvaluation);
  assert.ok(r.principalVariation.length > 0 && r.principalVariation.length <= Math.max(1,r.depth)+c.q);
  assert.equal(json(r.principalVariation[0]),json(r.selectedAction));
  let leaf = p.state;
  for (const a of r.principalVariation) leaf = apply(leaf, a);
  assert.deepEqual(evaluateSearchPositionBreakdown(leaf,p.state.turn,resolveSearchEvaluationPreset('standard')),r.evaluationBreakdown);
}
export function classify(p: TacticalPosition, ref: Reference, r: Result | null) {
  if (!r || r.selectedEvaluation === null) return { verdict: 'indeterminate', reason: 'no-evaluated-result' };
  const chosen = ref.candidates.find(x => json(x.action)===json(r.selectedAction)); assert.ok(chosen);
  if (p.target) {
    const a = r.selectedAction;
    const hit = a?.kind === 'move' && json([a.from.row,a.from.col])===json(p.target.from) && json([a.to.row,a.to.col])===json(p.target.to);
    return { verdict: hit !== p.target.avoid ? 'match' : 'mismatch', reason: 'fixture-capture-predicate' };
  }
  const forced = ref.candidates.filter(x=>x.status==='forced');
  if (p.expectation === 'shortest-win') {
    // A negative bounded checkmate result does not refute other winning endings.
    // Neither an Infinity score nor a single PV supplies an all-terminal proof.
    const scope = 'checkmate-only' as const;
    if (!forced.length) return { verdict:'indeterminate',reason:'no-proven-checkmate',scope };
    const shortestMatePly = Math.min(...forced.map(x=>x.distance!));
    if (chosen.status !== 'forced') return {
      verdict:'indeterminate', scope, shortestMatePly, selectedMatePly:null,
      reason:chosen.status==='unverified'?'selected-checkmate-unverified':'selected-win-outside-checkmate-proof',
    };
    return { verdict:chosen.distance===shortestMatePly?'match':'mismatch', scope,
      reason:chosen.distance===shortestMatePly?'shortest-proven-checkmate-selected':'longer-proven-checkmate-selected',
      shortestMatePly,selectedMatePly:chosen.distance };
  }
  if (p.expectation === 'longest-resistance') {
    // Even complete checkmate-only certificates cannot prove actual prolongation:
    // the winning side may choose a different, earlier decisive ending.
    const checkmateOnly = forced.length!==ref.candidates.length
      ? { scope:'checkmate-only' as const,verdict:'indeterminate',reason:'checkmate-loss-unproved',longestMatePly:null,selectedMatePly:null }
      : { scope:'checkmate-only' as const,
        verdict:chosen.distance===Math.max(...forced.map(x=>x.distance!))?'match':'mismatch',
        reason:'checkmate-only-distance-comparison',
        longestMatePly:Math.max(...forced.map(x=>x.distance!)),selectedMatePly:chosen.distance };
    return { verdict:'indeterminate',reason:'all-terminal-resistance-distance-unproved',
      scope:'all-terminal-distance' as const,checkmateOnly };
  }
  // A finite horizon cannot establish that mate is avoided forever.
  return { verdict: chosen.status==='forced'?'mismatch':'indeterminate',reason:chosen.status==='forced'?'selected-proven-losing-move':'no-force-within-bound-is-not-safety' };
}
export interface Sample { position: string; condition: string; phase: 'warmup'|'measurement'; result: Result|null; callMs: number|null; apiMs: number|null; overrunMs: number|null; status:'ok'|'hard-stop'|'error'; error?:string; parentWallMs?:number }
export function summarize(positions: TacticalPosition[], refs: Record<string,Reference>, rows: Sample[]) {
  assert.ok(rows.every(r=>['measurement','warmup'].includes(r.phase)&&['ok','hard-stop','error'].includes(r.status)));
  const expected = positions.flatMap(p=>CONDITIONS.map(c=>`${p.id}/${c.id}`)).sort();
  const main = rows.filter(r=>r.phase==='measurement');
  assert.deepEqual(main.map(r=>`${r.position}/${r.condition}`).sort(),expected,'missing/duplicate/unknown samples');
  return main.map(row=>{
    const p=positions.find(p=>p.id===row.position)!; const c=CONDITIONS.find(c=>c.id===row.condition)!;
    assert.ok(row.callMs===null&&row.status!=='ok'||typeof row.callMs==='number'&&Number.isFinite(row.callMs)&&row.callMs>=0);
    assert.equal(row.overrunMs,c.budget===null||row.callMs===null?null:Math.max(0,row.callMs-c.budget));
    if (row.status==='ok') { assert.ok(row.result); validateResult(p,c,row.result); assert.equal(row.apiMs,row.result.elapsedMilliseconds); }
    else { assert.equal(row.result,null); assert.equal(row.apiMs,null); }
    return { position:p.id,condition:c.id,mode:c.budget===null?'fixed':'timed',status:row.status,
      ...classify(p,refs[p.id],row.result), score:row.result?.selectedEvaluation ?? null,
      discovery: (()=>{
        const ref=refs[p.id], forced=ref.candidates.filter(x=>x.status==='forced');
        const expected=ref.winner===p.state.turn && forced.length>0 ? Infinity : ref.winner!==p.state.turn && forced.length===ref.candidates.length ? -Infinity : null;
        return expected===null?'reference-inconclusive':row.result?.selectedEvaluation===expected?'terminal-score-returned':'terminal-score-not-returned';
      })(),
      completedDepth: row.result ? ('completedDepth' in row.result ? row.result.completedDepth : row.result.depth) : null,
      resultSource: row.result && 'resultSource' in row.result ? row.result.resultSource : null,
      timedOut:row.result && 'timedOut' in row.result ? row.result.timedOut : null,
      callMs:row.callMs,apiMs:row.apiMs,overrunMs:row.overrunMs };
  });
}
