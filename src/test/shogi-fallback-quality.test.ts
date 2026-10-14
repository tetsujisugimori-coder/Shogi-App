import { describe, expect, it } from 'vitest';
import { createInitialBoardState, type BoardState, type Player } from '../types/shogi';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed, analyzeAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { analyzeQuiescenceSearch } from '../domain/shogi/quiescenceSearch';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import { getLegalActions } from '../domain/shogi/legalActions';
import { protectSearchInput } from '../domain/shogi/selfPlayGame';
import { noLegalActionsCase } from './no-legal-actions.cases';
import { replayPositions, SOURCE } from '../../scripts/benchmarks/timedDepthOneDiagnostics';
import { apply, classify, encodeScore, finiteLoss, movingSide, reference, options, evaluation, summarize,
  verifyAction, sha256, tacticalEvidence, type TimedSample, type ReferenceRow } from '../../scripts/benchmarks/fallbackQuality';
import { evaluateMaterial } from '../domain/shogi/materialEvaluation';

function kings(turn: Player = 'sente'): BoardState {
  const state = createInitialBoardState();
  state.squares.forEach(row => row.forEach(s => { s.piece = null; }));
  state.squares[8][8].piece = { id: 'sente-king', player: 'sente', type: 'king' };
  state.squares[0][0].piece = { id: 'gote-king', player: 'gote', type: 'king' };
  state.turn = turn; state.positionHistory = []; state.positionSnapshots = [];
  return state;
}
function sample(run = 1): TimedSample {
  const result = timed(kings(), 1, 0, evaluation, () => 0, options);
  return { type: 'sample', positionId: 'p', budget: 100, phase: 'measurement', run,
    resultSource: result.resultSource, completedDepth: 0, timedOut: true,
    callMs: 101, apiMs: 0, overrunMs: 1, action: result.selectedAction, result };
}
describe('fallback quality diagnostics', () => {
  it('keeps ended, genuine no-legal, 0ms fallback and completed iterations distinct', () => {
    const { before, coord } = noLegalActionsCase();
    const gold = getLegalActions(before).find(a => a.kind === 'move' && a.from.row === coord(5,0).row &&
      a.from.col === coord(5,0).col && a.to.row === coord(6,0).row && a.to.col === coord(6,0).col)!;
    const ended = apply(before, gold);
    expect(ended.result?.endReason).toBe('no_legal_actions');
    const noLegal = { ...ended, status: 'active' as const, result: null };
    expect(getLegalActions(noLegal)).toEqual([]);
    expect(classify(timed(ended, 1, 0))).toBe('ended-position');
    expect(classify(timed(noLegal, 1, 0))).toBe('no-legal-actions');
    const state = kings(); const saved = structuredClone(state);
    const fallback = timed(state, 1, 0);
    expect(classify(fallback)).toBe('fallback'); verifyAction(state, fallback);
    expect(classify(timed(state, 1, 1000, evaluation, () => 0, options))).toBe('completed-iteration');
    expect(state).toEqual(saved);
  });
  it.each(['sente', 'gote'] as const)('%s reference uses q1 root perspective and does not mutate input', turn => {
    const state = kings(turn);
    state.squares[4][4].piece = { id: 'rook', player: turn, type: 'rook' };
    const saved = structuredClone(state);
    const ref = reference(state);
    const child = apply(state, ref.fallback);
    const q = child.status === 'ended' ? evaluateSearchPositionBreakdown(child, turn, evaluation).total
      : analyzeQuiescenceSearch(child, turn, 1, evaluation, undefined, 'original').selectedEvaluation;
    expect(ref.fallbackEvaluation).toBe(q);
    expect(ref.finiteLoss).toBeGreaterThanOrEqual(0);
    expect(state).toEqual(saved);
    expect(movingSide(500, 'sente', turn)).toBe(turn === 'sente' ? 500 : -500);
    expect(finiteLoss(50, -50)).toBe(100); // already root-relative, for either side
  });
  it('restores a saved real-game position with legal APIs and stable normalized hash', () => {
    const a = replayPositions(SOURCE, [{ game: 1, ply: 5, band: 'opening' }]);
    const b = replayPositions(SOURCE, [{ game: 1, ply: 5, band: 'opening' }]);
    expect(a.sourceSha256).toBe(b.sourceSha256);
    const state = { ...a.positions[0].state, recordId: 'replayed' };
    expect(sha256(state)).toBe(a.positions[0].stateSha256);
    expect(a.positions[0].stateSha256).toBe(b.positions[0].stateSha256);
    const input = protectSearchInput(state); const before = JSON.stringify(state);
    analyzeAlphaBetaSearch(input.snapshot, 0, evaluation);
    expect(input.wasMutated()).toBe(false); expect(JSON.stringify(state)).toBe(before);
  });
  it('saves a legally replayable material witness and an alternative, without claiming a free capture', () => {
    const state = replayPositions(SOURCE, [{ game: 4, ply: 89, band: 'late' }]).positions[0].state;
    const ref = reference(state); const before = JSON.stringify(state);
    const evidence = tacticalEvidence(state, ref.result.selectedAction!);
    const child = apply(state, evidence.fallback.action);
    const after = apply(child, evidence.fallback.witness!);
    expect(evaluateMaterial(after, state.turn) - evaluateMaterial(child, state.turn)).toBe(-600);
    expect(evidence.alternative.worstDeltaFromRoot).toBe(0);
    expect(evidence.betterOneReplyMaterialHorizon).toBe(true);
    expect(evidence.missedMateInOne).toBe(false); expect(evidence.allowsMateInOne).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('detects a verified missed mate and preserves its terminal reference score', () => {
    const state = kings();
    state.squares[2][0].piece = state.squares[8][8].piece; state.squares[8][8].piece = null;
    state.squares[2][1].piece = { id: 'gold', player: 'sente', type: 'gold' };
    const ref = reference(state);
    expect(ref.bestScore).toBe('+Infinity'); expect(ref.finiteLoss).toBeNull();
    const evidence = tacticalEvidence(state, ref.result.selectedAction!);
    expect(evidence.missedMateInOne).toBe(true);
    expect(evidence.mateInOneActions.length).toBeGreaterThan(0);
    for (const action of evidence.mateInOneActions) expect(apply(state, action).result?.endReason).toBe('checkmate');
  });
  it('keeps terminal scores lossless and excludes missing/incomplete reference scores', () => {
    expect(JSON.parse(JSON.stringify([encodeScore(Infinity), encodeScore(-Infinity), encodeScore(null)])))
      .toEqual(['+Infinity', '-Infinity', null]);
    expect(() => encodeScore(NaN)).toThrow();
    const base: ReferenceRow = { type: 'reference', positionId: 'p', status: 'complete',
      bestScore: 100, fallbackScore: 100, actionMatches: false };
    expect(summarize([sample()], [base])[0]).toMatchObject({ actionMatches: false, finiteComparable: true, finiteLoss: 0 });
    for (const bad of [{ ...base, status: 'process-timeout' }, { ...base, bestScore: null },
      { ...base, fallbackScore: undefined }, { ...base, bestScore: NaN }, { ...base, actionMatches: undefined }]) {
      expect(summarize([sample()], [bad])[0]).toMatchObject({ actionMatches: null, finiteComparable: false, finiteLoss: null });
    }
    expect(summarize([sample()], [])[0].referenceStatus).toBe('missing');
    expect(summarize([sample()], [{ ...base, bestScore: '+Infinity' }])[0])
      .toMatchObject({ finiteComparable: false, finiteLoss: null, terminalComparison: { best: '+Infinity', fallback: 100 } });
    expect(finiteLoss('+Infinity', '-Infinity')).toBeNull();
  });
  it('does not count warmups as measurements, rejects duplicates and inconsistent timing/classification', () => {
    const warmup = { ...sample(), phase: 'warmup' as const };
    expect(summarize([sample(), sample(2), warmup], [])[0]).toMatchObject({ samples: 2, fallback: 2, depthDistribution: { 0: 2 } });
    expect(() => summarize([sample(), sample()], [])).toThrow('Duplicate');
    expect(() => summarize([sample()], [{ type: 'reference', positionId: 'p', status: 'failed' },
      { type: 'reference', positionId: 'p', status: 'complete' }])).toThrow('Duplicate');
    expect(() => summarize([{ ...sample(), callMs: NaN }], [])).toThrow();
    expect(() => summarize([{ ...sample(), overrunMs: 0 }], [])).toThrow();
    expect(() => summarize([{ ...sample(), resultSource: 'completed-iteration' }], [])).toThrow();
  });
});
