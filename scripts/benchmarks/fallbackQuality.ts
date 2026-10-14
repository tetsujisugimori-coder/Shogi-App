import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BoardState, Player } from '../../src/types/shogi';
import { executeLegalAction, getLegalActions, type LegalAction } from '../../src/domain/shogi/legalActions';
import { isPlayerInCheck, isCheckmate } from '../../src/domain/shogi/checkmate';
import { analyzeAlphaBetaSearch, areLegalActionsEqual, type TimeLimitedIterativeDeepeningAlphaBetaSearchResult as TimedResult } from '../../src/domain/shogi/twoPlyAlphaBetaAi';
import { analyzeQuiescenceSearch } from '../../src/domain/shogi/quiescenceSearch';
import { evaluateSearchPositionBreakdown } from '../../src/domain/shogi/twoPlyMinimaxAi';
import { resolveSearchEvaluationPreset } from '../../src/domain/shogi/searchEvaluationPresets';
import { evaluateMaterial } from '../../src/domain/shogi/materialEvaluation';
import { protectSearchInput } from '../../src/domain/shogi/selfPlayGame';
import { replayPositions, POSITION_IDS } from './timedDepthOneDiagnostics';

export const targets = [...POSITION_IDS, { game: 1, ply: 44, band: 'few-evasions' },
  { game: 1, ply: 93, band: 'late' }, { game: 3, ply: 117, band: 'late' }];
export const options = { moveOrdering: 'standard' as const, killerMoves: false,
  quiescence: { maxTacticalDepth: 1, moveOrdering: 'original' as const } };
export const evaluation = resolveSearchEvaluationPreset('standard');
export const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type Score = number | '+Infinity' | '-Infinity' | null;
export function encodeScore(value: number | null): Score {
  assert.ok(value === null || !Number.isNaN(value));
  return value === Infinity ? '+Infinity' : value === -Infinity ? '-Infinity' : value;
}
export function finiteLoss(best: Score | undefined, candidate: Score | undefined) {
  return typeof best === 'number' && Number.isFinite(best) && typeof candidate === 'number' && Number.isFinite(candidate)
    ? best - candidate : null;
}
// Domain search scores already use the root player's perspective. This helper
// is only for material witnesses when the stored measurement has another perspective.
export function movingSide(value: number, perspective: Player, turn: Player) {
  return perspective === turn ? value : -value;
}
export function loadPositions() {
  const replay = replayPositions(undefined, targets);
  assert.equal(new Set(replay.positions.map(p => p.positionKeySha256)).size, replay.positions.length,
    'Repeated board/hand/turn positions must not count as independent positions');
  return replay;
}
export function apply(state: BoardState, action: LegalAction) {
  const next = executeLegalAction(state, action);
  assert.equal(next.type, 'applied');
  if (next.type !== 'applied') throw new Error('Legal action rejected');
  return next.state;
}
export function classify(result: TimedResult) {
  const source = result.resultSource;
  if (source === 'fallback') {
    assert.equal(result.completedDepth, 0); assert.equal(result.iterations.length, 0);
    assert.ok(result.selectedAction); assert.equal(result.selectedEvaluation, null);
    assert.equal(result.evaluationBreakdown, null); assert.deepEqual(result.principalVariation, []);
  } else if (source === 'completed-iteration') {
    assert.ok(result.completedDepth >= 1); assert.equal(result.iterations.at(-1)?.depth, result.completedDepth);
  } else {
    assert.equal(result.selectedAction, null); assert.equal(result.completedDepth, 0);
    assert.equal(result.timedOut, false); assert.equal(result.iterations.length, 0);
  }
  return source;
}
export function verifyAction(state: BoardState, result: TimedResult, legal = getLegalActions(state)) {
  classify(result);
  if (result.selectedAction) {
    assert.ok(legal.some(a => areLegalActionsEqual(a, result.selectedAction!)));
    apply(state, result.selectedAction);
  }
  if (result.resultSource === 'fallback') assert.ok(areLegalActionsEqual(legal[0], result.selectedAction!));
}
export function reference(state: BoardState) {
  const before = JSON.stringify(state);
  const input = protectSearchInput(state);
  const result = analyzeAlphaBetaSearch(input.snapshot, 1, evaluation, undefined, options);
  const fallback = getLegalActions(input.snapshot)[0];
  assert.ok(fallback && result.selectedAction && result.selectedEvaluation !== null);
  const child = apply(input.snapshot, fallback);
  // Exactly the depth-zero node path used by depth 1: ended adjudication first,
  // otherwise q1 with the original root perspective and an unbounded window.
  const q = child.status === 'ended' ? null
    : analyzeQuiescenceSearch(child, state.turn, 1, evaluation, undefined, 'original');
  const candidate = q?.selectedEvaluation ?? evaluateSearchPositionBreakdown(child, state.turn, evaluation).total;
  assert.ok(result.selectedEvaluation >= candidate);
  assert.equal(input.wasMutated(), false); assert.equal(JSON.stringify(state), before);
  return { status: 'complete' as const, result, fallback, fallbackEvaluation: candidate,
    fallbackPv: [fallback, ...(q?.principalVariation ?? [])],
    actionMatches: areLegalActionsEqual(fallback, result.selectedAction),
    bestScore: encodeScore(result.selectedEvaluation), fallbackScore: encodeScore(candidate),
    finiteLoss: finiteLoss(encodeScore(result.selectedEvaluation), encodeScore(candidate)), inputUnchanged: true };
}

/** Exhaustive mate-in-one scan at root, and all legal replies after fallback
 * and the reference action. Material is a one-reply horizon, never a proof
 * that a capture is free or cannot subsequently be recaptured. */
export function tacticalEvidence(state: BoardState, alternative: LegalAction) {
  const before = JSON.stringify(state);
  const input = protectSearchInput(state);
  const legal = getLegalActions(input.snapshot);
  const fallback = legal[0]; assert.ok(fallback);
  const mates: LegalAction[] = [];
  for (const action of legal) {
    const child = apply(input.snapshot, action);
    if (child.result?.endReason === 'checkmate' && child.result.winner === state.turn && isCheckmate(child, child.turn)) mates.push(action);
  }
  function replies(action: LegalAction) {
    const child = apply(input.snapshot, action);
    const replies = getLegalActions(child);
    let worst = evaluateMaterial(child, state.turn);
    let witness: LegalAction | null = null;
    const matingReplies: LegalAction[] = [];
    for (const reply of replies) {
      const after = apply(child, reply);
      if (after.result?.endReason === 'checkmate' && after.result.winner !== state.turn && isCheckmate(after, state.turn)) matingReplies.push(reply);
      const material = evaluateMaterial(after, state.turn);
      if (material < worst) { worst = material; witness = reply; }
    }
    return { action, legalReplyCount: replies.length, matingReplies, worstMaterial: worst, witness,
      worstDeltaFromRoot: worst - evaluateMaterial(state, state.turn),
      worstDeltaFromChild: worst - evaluateMaterial(child, state.turn) };
  }
  const first = replies(fallback);
  const other = areLegalActionsEqual(fallback, alternative) ? first : replies(alternative);
  assert.equal(input.wasMutated(), false); assert.equal(JSON.stringify(state), before);
  return { rootLegalCount: legal.length, mateInOneActions: mates, fallback: first, alternative: other,
    missedMateInOne: mates.length > 0 && !mates.some(a => areLegalActionsEqual(a, fallback)),
    allowsMateInOne: first.matingReplies.length > 0,
    alternativeAvoidsMateInOne: first.matingReplies.length > 0 && other.matingReplies.length === 0,
    // This deliberately says horizon, not an unqualified avoidable material loss.
    betterOneReplyMaterialHorizon: other.worstMaterial > first.worstMaterial,
    inputUnchanged: true };
}

export type TimedSample = { type: 'sample'; positionId: string; budget: number; phase: 'warmup' | 'measurement'; run: number;
  resultSource: string; completedDepth: number; timedOut: boolean; callMs: number; apiMs: number;
  overrunMs: number; action: LegalAction | null; result: TimedResult };
export type ReferenceRow = { type: 'reference'; positionId: string; status: string;
  bestScore?: Score; fallbackScore?: Score; actionMatches?: boolean; finiteLoss?: number | null };
export function summarize(samples: TimedSample[], references: ReferenceRow[]) {
  const validScore = (s: unknown) => (typeof s === 'number' && Number.isFinite(s)) || s === '+Infinity' || s === '-Infinity';
  const refs = new Map<string, ReferenceRow>();
  for (const ref of references) { assert.ok(!refs.has(ref.positionId), 'Duplicate reference'); refs.set(ref.positionId, ref); }
  const rows = samples.filter(s => s.phase === 'measurement');
  const keys = rows.map(s => `${s.positionId}/${s.budget}/${s.run}`);
  assert.equal(new Set(keys).size, keys.length, 'Duplicate measurement');
  const median = (values: number[]) => {
    const sorted = [...values].sort((a,b) => a-b); const n = sorted.length;
    return n ? (sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2 : null;
  };
  return [...new Set(rows.map(s => `${s.positionId}/${s.budget}`))].map(key => {
    const own = rows.filter(s => `${s.positionId}/${s.budget}` === key);
    for (const row of own) {
      assert.ok(Number.isFinite(row.callMs) && row.callMs >= 0 && Number.isFinite(row.apiMs) && row.apiMs >= 0);
      assert.equal(row.resultSource, classify(row.result)); assert.equal(row.completedDepth, row.result.completedDepth);
      assert.equal(row.timedOut, row.result.timedOut);
      assert.equal(row.overrunMs, Math.max(0, row.callMs - row.budget));
    }
    const first = own[0]; const ref = refs.get(first.positionId);
    const complete = ref?.status === 'complete' && typeof ref.actionMatches === 'boolean' &&
      validScore(ref.bestScore) && validScore(ref.fallbackScore);
    const loss = complete ? finiteLoss(ref.bestScore, ref.fallbackScore) : null;
    return { positionId: first.positionId, budget: first.budget, samples: own.length,
      fallback: own.filter(s => s.resultSource === 'fallback').length,
      depthDistribution: Object.fromEntries([...new Set(own.map(s => s.completedDepth))].map(d => [d, own.filter(s => s.completedDepth === d).length])),
      sources: Object.fromEntries([...new Set(own.map(s => s.resultSource))].map(v => [v, own.filter(s => s.resultSource === v).length])),
      callMedianMs: median(own.map(s => s.callMs)), callMinMs: Math.min(...own.map(s => s.callMs)), callMaxMs: Math.max(...own.map(s => s.callMs)),
      apiMedianMs: median(own.map(s => s.apiMs)), overrunMedianMs: median(own.map(s => s.overrunMs)),
      overrunMaxMs: Math.max(...own.map(s => s.overrunMs)), overBudget: own.filter(s => s.callMs > s.budget).length,
      referenceStatus: ref?.status ?? 'missing', actionMatches: complete ? ref.actionMatches : null,
      finiteComparable: loss !== null, finiteLoss: loss,
      terminalComparison: complete && loss === null ? { best: ref.bestScore, fallback: ref.fallbackScore } : null };
  });
}

export function positionMetadata(state: BoardState) {
  return { turn: state.turn, inCheck: isPlayerInCheck(state, state.turn), rootLegalCount: getLegalActions(state).length,
    handCount: state.senteHand.length + state.goteHand.length };
}
