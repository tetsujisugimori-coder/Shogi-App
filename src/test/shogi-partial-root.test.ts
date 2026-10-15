import { cloneBoardState } from '../domain/shogi/replay';
import { runSelfPlayGame } from '../domain/shogi/selfPlayGame';
import { serializeShogiGameRecordV1 } from '../domain/shogi/gameRecord';
import { importShogiGameRecord } from '../domain/shogi/gameRecordImport';
import { selfPlayJson } from '../../scripts/benchmarks/quiescenceOrderingSelfPlay';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialBoardState } from '../types/shogi';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch as timed } from '../domain/shogi/twoPlyAlphaBetaAi';
import { getLegalActions, executeLegalAction } from '../domain/shogi/legalActions';
import { evaluateSearchPositionBreakdown } from '../domain/shogi/twoPlyMinimaxAi';
import * as q from '../domain/shogi/quiescenceSearch';
import { validatePartialRoot } from '../application/partialRootValidation';

function run(expireAt: number, quiescence = false, turn: 'sente' | 'gote' = 'sente', maxDepth = 1) {
  const state = createInitialBoardState(); state.turn = turn;
  const before = structuredClone(state);
  let reads = 0;
  const result = timed(state, maxDepth, 100, undefined, () => ++reads >= expireAt ? 100 : 0,
    quiescence ? { quiescence: { maxTacticalDepth: 1 } } : undefined);
  expect(state).toEqual(before);
  return { result, state, reads };
}
function mockScores(values: number[]) {
  let index = 0;
  return vi.spyOn(q, 'analyzeQuiescenceSearchWithinBounds').mockImplementation(() => {
    const value = values[index++] ?? -1000;
    return { selectedEvaluation: value, principalVariation: [], evaluationBreakdown: {
      total: value, material: Number.isFinite(value) ? value : 0, pieceSquare: 0,
      kingSafety: 0, undefendedPieceSafety: 0,
      terminal: value === Infinity ? 'win' : value === -Infinity ? 'loss' : null,
    }, visitedPositionCount: 0, cutoffCount: 0, skippedActionCount: 0, maxTacticalDepth: 1 };
  });
}
afterEach(() => vi.restoreAllMocks());

describe('partial-root deadline and exact selection', () => {
  it.each([4, 5, 6])('keeps fallback with no deadline-approved candidate (read %i)', limit => {
    const { result, state } = run(limit);
    expect(result).toMatchObject({ resultSource: 'fallback', selectedAction: getLegalActions(state)[0],
      selectedEvaluation: null, evaluationBreakdown: null, principalVariation: [], completedDepth: 0 });
  });
  it('retains the first candidate when the following candidate is interrupted or rejected after return', () => {
    for (const boundary of [7, 8]) {
      const { result, state } = run(boundary);
      const child = executeLegalAction(state, getLegalActions(state)[0]);
      expect(child.type).toBe('applied');
      if (child.type !== 'applied') throw new Error('fixture');
      expect(result).toMatchObject({ resultSource: 'partial-root', depth: 0, completedDepth: 0,
        timedOut: true, iterations: [], selectedAction: getLegalActions(state)[0],
        selectedEvaluation: evaluateSearchPositionBreakdown(child.state, state.turn).total,
        visitedPositionCount: 0, totalVisitedPositionCount: 0,
        partialRoot: { completedRootCandidateCount: 1, exactRootCandidateCount: 1,
          attemptedStatistics: { visitedPositionCount: 2 } } });
      expect(validatePartialRoot(state, structuredClone(result), 0)).not.toBeNull();
    }
  });
  it.each(['sente', 'gote'] as const)('uses root perspective and original-order ties for %s', turn => {
    mockScores([10, 20, 20]);
    const { result, state } = run(11, true, turn);
    expect(result.selectedEvaluation).toBe(20);
    expect(result.selectedAction).toEqual(getLegalActions(state)[1]);
    expect(result.partialRoot).toMatchObject({ completedRootCandidateCount: 3, exactRootCandidateCount: 2,
      selectedRootOriginalIndex: 1 }); // equal finite alpha is only upper, never promoted to exact.
  });
  it.each(['sente', 'gote'] as const)('static candidate evaluation has the actual %s root perspective', turn => {
    const { state, result } = run(7, false, turn);
    const child = executeLegalAction(state, result.selectedAction!);
    if (child.type !== 'applied') throw new Error('fixture');
    expect(result.selectedEvaluation).toBe(evaluateSearchPositionBreakdown(child.state, turn).total);
  });
  it('does not adopt missing runtime values', () => {
    vi.spyOn(q, 'analyzeQuiescenceSearchWithinBounds').mockReturnValue({ selectedEvaluation: undefined,
      principalVariation: [], evaluationBreakdown: { total: undefined, material: 0, pieceSquare: 0,
        kingSafety: 0, undefendedPieceSafety: 0, terminal: null },
      visitedPositionCount: 0, cutoffCount: 0, skippedActionCount: 0, maxTacticalDepth: 1 } as unknown as q.QuiescenceSearchResult);
    expect(run(7, true).result.resultSource).toBe('fallback');
  });
  it('does not adopt fail-low bounds or indeterminate values', () => {
    mockScores([20, 15, NaN]);
    const { result } = run(11, true);
    expect(result.selectedEvaluation).toBe(20);
    expect(result.partialRoot).toMatchObject({ completedRootCandidateCount: 3, exactRootCandidateCount: 1 });
  });
  it('falls back when the only returned value is indeterminate', () => {
    mockScores([NaN]);
    expect(run(7, true).result.resultSource).toBe('fallback');
  });
  it.each([Infinity, -Infinity])('preserves exact absolute endpoint %s and its actual PV', value => {
    mockScores([value, value]);
    const { result, state } = run(9, true);
    expect(result.selectedEvaluation).toBe(value);
    expect(result.partialRoot?.exactRootCandidateCount).toBe(2);
    expect(result.principalVariation).toEqual([getLegalActions(state)[0]]);
    expect(structuredClone(result).selectedEvaluation).toBe(value);
  });
  it('rejects the last candidate on the final existing deadline check', () => {
    const { result } = run(64);
    expect(result).toMatchObject({ resultSource: 'partial-root', completedDepth: 0, iterations: [],
      partialRoot: { completedRootCandidateCount: 29, exactRootCandidateCount: 29 } });
  });
  it('prefers a completed pass and preserves fixed search statistics/PV', () => {
    const { result, state } = run(65, false, 'sente', 2);
    const fixed = analyzeAlphaBetaSearch(state, 1, undefined, () => 0);
    expect(result.resultSource).toBe('completed-iteration');
    expect(result.completedDepth).toBe(1);
    expect(result.partialRoot).toBeUndefined();
    for (const key of ['selectedAction','selectedEvaluation','principalVariation','evaluationBreakdown',
      'visitedPositionCount','cutoffCount','skippedActionCount'] as const) expect(result[key]).toEqual(fixed[key]);
  });
  it('propagates exceptions rather than returning a saved candidate', () => {
    vi.spyOn(q, 'analyzeQuiescenceSearchWithinBounds').mockImplementation(() => { throw new Error('evaluation failed'); });
    expect(() => run(100, true)).toThrow('evaluation failed');
  });
  it('rejects missing evaluation and malformed candidate metadata at the UI boundary', () => {
    const { result, state } = run(7);
    expect(validatePartialRoot(state, { ...result, selectedEvaluation: null }, 0)).toBeNull();
    expect(validatePartialRoot(state, { ...result, partialRoot: undefined }, 0)).toBeNull();
  });
  it('records partial self-play and round trips the applied action in the unchanged v1 game format', () => {
    const { result, state } = run(7);
    const participant = { settings: undefined, search: () => result };
    const game = runSelfPlayGame({ initialState: state, maxPlies: 1, sente: participant, gote: participant });
    expect(game.status).toBe('max_plies');
    expect(game.plies[0]).toMatchObject({ resultSource: 'partial-root', completedDepth: 0,
      selectedEvaluation: result.selectedEvaluation, principalVariation: result.principalVariation });
    expect(game.plies[0].partialRoot).toEqual(result.partialRoot);
    expect(game.plies[0].partialRoot).not.toBe(result.partialRoot);
    expect(game.plies[0].partialRoot?.attemptedStatistics).not.toBe(result.partialRoot?.attemptedStatistics);
    const recorded = JSON.parse(selfPlayJson(game));
    expect(recorded.plies[0].resultSource).toBe('partial-root');
    expect(recorded.plies[0].partialRoot).toEqual(result.partialRoot);
    expect(JSON.parse(selfPlayJson({ value: Infinity, missing: null }))).toEqual({ value: 'Infinity', missing: null });
    const restored = importShogiGameRecord(serializeShogiGameRecordV1(game.finalState, new Date('2026-10-15T00:00:00+09:00')));
    expect(restored.ok).toBe(true);
    if (!restored.ok) throw new Error(restored.message);
    expect(restored.state.history).toHaveLength(1);
    expect(restored.state.turn).toBe(game.finalState.turn);
    expect(serializeShogiGameRecordV1(restored.state, new Date('2026-10-15T00:00:00+09:00')))
      .toBe(serializeShogiGameRecordV1(game.finalState, new Date('2026-10-15T00:00:00+09:00')));
    expect(JSON.stringify(restored.state)).not.toContain('partial-root');
  });

  const invalidMetadata: [string, (result: ReturnType<typeof run>['result']) => void][] = [
    ['missing metadata', r => { delete r.partialRoot; }],
    ['null metadata', r => { Reflect.set(r, 'partialRoot', null); }],
    ['non-object metadata', r => { Reflect.set(r, 'partialRoot', 1); }],
    ['array metadata', r => { Reflect.set(r, 'partialRoot', []); }],
    ['candidate depth', r => { Reflect.set(r.partialRoot!, 'candidateDepth', 2); }],
    ['no completed candidates', r => { r.partialRoot!.completedRootCandidateCount = 0; }],
    ['non-integer candidate count', r => { r.partialRoot!.completedRootCandidateCount = 1.5; }],
    ['no exact candidates', r => { r.partialRoot!.exactRootCandidateCount = 0; }],
    ['invalid exact count', r => { r.partialRoot!.exactRootCandidateCount = NaN; }],
    ['too many exact candidates', r => { r.partialRoot!.exactRootCandidateCount = 2; }],
    ['more candidates than legal actions', r => { r.partialRoot!.completedRootCandidateCount = r.rootLegalActionCount + 1; }],
    ['negative selected index', r => { r.partialRoot!.selectedRootOriginalIndex = -1; }],
    ['unsafe selected index', r => { r.partialRoot!.selectedRootOriginalIndex = Number.MAX_SAFE_INTEGER + 1; }],
    ['selected index outside completed subset', r => { r.partialRoot!.selectedRootOriginalIndex = 1; }],
    ['selected index points to another legal action', r => {
      r.partialRoot!.completedRootCandidateCount = 2; r.partialRoot!.selectedRootOriginalIndex = 1;
    }],
    ['missing attempted statistics', r => { Reflect.deleteProperty(r.partialRoot!, 'attemptedStatistics'); }],
    ['non-object attempted statistics', r => { Reflect.set(r.partialRoot!, 'attemptedStatistics', 1); }],
    ['array attempted statistics', r => { Reflect.set(r.partialRoot!, 'attemptedStatistics', []); }],
    ['inconsistent visited count', r => { r.partialRoot!.attemptedStatistics.visitedPositionCount = 0; }],
    ['non-boolean timeout', r => { Reflect.set(r, 'timedOut', 1); }],
  ];
  it.each(invalidMetadata)('rejects partial self-play with %s before recording a move', (_name, mutate) => {
    const { result, state } = run(7);
    mutate(result);
    const participant = { settings: undefined, search: () => result };
    const game = runSelfPlayGame({ initialState: state, maxPlies: 1, sente: participant, gote: participant });
    expect(game).toMatchObject({ status: 'failed', failure: { stage: 'result', code: 'invalid_result' }, plies: [] });
    expect(game.finalState).toEqual(cloneBoardState(state));
  });
  it('rejects every invalid attempted statistic using the existing statistic keys', () => {
    const original = run(7).result.partialRoot!.attemptedStatistics;
    for (const key of Object.keys(original)) {
      for (const value of [undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const { result, state } = run(7);
        Reflect.set(result.partialRoot!.attemptedStatistics, key, value);
        const participant = { settings: undefined, search: () => result };
        const game = runSelfPlayGame({ initialState: state, maxPlies: 1, sente: participant, gote: participant });
        expect(game).toMatchObject({ status: 'failed', failure: { stage: 'result', code: 'invalid_result' }, plies: [] });
        expect(game.finalState).toEqual(cloneBoardState(state));
      }
    }
  });

});
