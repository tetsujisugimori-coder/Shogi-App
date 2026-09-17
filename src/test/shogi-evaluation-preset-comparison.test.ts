import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialBoardState, type BoardState } from '../types/shogi';
import { analyzeEvaluationPresetComparison, createComparisonSnapshot } from '../domain/shogi/evaluationPresetComparison';
import * as alphaBeta from '../domain/shogi/twoPlyAlphaBetaAi';
import { SEARCH_EVALUATION_PRESET_IDS, SEARCH_EVALUATION_PRESETS, resolveSearchEvaluationPreset } from '../domain/shogi/searchEvaluationPresets';
import { cloneBoardState, executeLegalAction, evaluateSearchPositionBreakdown, getLegalActions } from '../domain/shogi';

const clock = () => 0;
afterEach(() => vi.restoreAllMocks());

describe('同一局面の評価プリセット比較', () => {
  it('固定順・同一の不変スナップショット・深さ3だけを使い、各既存探索と一致する', () => {
    const state = createInitialBoardState();
    const original = structuredClone(state);
    const settings = structuredClone(SEARCH_EVALUATION_PRESETS);
    const spy = vi.spyOn(alphaBeta, 'analyzeAlphaBetaSearch');
    const results = analyzeEvaluationPresetComparison(state, 3, clock);
    expect(results.map((result) => result.presetId)).toEqual(SEARCH_EVALUATION_PRESET_IDS);
    expect(spy).toHaveBeenCalledTimes(3);
    const calls = spy.mock.calls.slice();
    for (const [index, [snapshot, depth, config]] of calls.entries()) {
      expect(snapshot).toBe(calls[0][0]);
      expect(snapshot).not.toBe(state);
      expect(Object.isFrozen(snapshot.squares[0][0])).toBe(true);
      expect(depth).toBe(3);
      expect(config).toEqual(resolveSearchEvaluationPreset(SEARCH_EVALUATION_PRESET_IDS[index]));
      expect(results[index]).toEqual({
        ...alphaBeta.analyzeAlphaBetaSearch(state, 3, config, clock), presetId: SEARCH_EVALUATION_PRESET_IDS[index],
      });
    }
    expect(results[0]).toEqual({ ...alphaBeta.analyzeAlphaBetaSearch(state, 3, undefined, clock), presetId: SEARCH_EVALUATION_PRESET_IDS[0] });
    expect(state).toEqual(original);
    expect(SEARCH_EVALUATION_PRESETS).toEqual(settings);
    expect(analyzeEvaluationPresetComparison(state, 3, clock)).toEqual(results);
  });

  it('採用手、PV末端、内訳、評価値が一致し、同じ推奨手も正常に返す', () => {
    const state = createInitialBoardState();
    const results = analyzeEvaluationPresetComparison(state, 3, clock);
    for (const result of results) {
      expect(result.principalVariation[0]).toEqual(result.selectedAction);
      expect(result.selectedEvaluation).toBe(result.evaluationBreakdown.total);
      let leaf = cloneBoardState(state);
      for (const action of result.principalVariation) {
        const execution = executeLegalAction(leaf, action);
        expect(execution.type).toBe('applied');
        if (execution.type !== 'applied') throw new Error('Invalid fixture PV');
        leaf = execution.state;
      }
      expect(result.evaluationBreakdown).toEqual(evaluateSearchPositionBreakdown(leaf, state.turn, resolveSearchEvaluationPreset(result.presetId)));
    }
    // The initial position naturally shares a recommendation; uniqueness is not required.
    expect(results.every((result) => result.selectedAction !== null)).toBe(true);
  });

  it.each(['sente', 'gote', null] as const)('終局は既存の選択手なしと内訳の無限値・0を維持する: %s', (winner) => {
    const state: BoardState = { ...createInitialBoardState(), status: 'ended', result: winner === null
      ? { winner: null, loser: null, endReason: 'repetition' }
      : { winner, loser: winner === 'sente' ? 'gote' : 'sente', endReason: 'resignation' } };
    for (const result of analyzeEvaluationPresetComparison(state, 3, clock)) {
      expect(result.selectedAction).toBeNull();
      expect(result.selectedEvaluation).toBeNull();
      expect(result.principalVariation).toEqual([]);
      expect(result.evaluationBreakdown.total).toBe(winner === 'sente' ? Infinity : winner === 'gote' ? -Infinity : 0);
      expect(result.evaluationBreakdown.terminal).toBe(winner === 'sente' ? 'win' : winner === 'gote' ? 'loss' : 'draw');
    }
  });

  it('履歴と持ち駒の参照を共有せず、呼出元の凍結・変更をしない', () => {
    const initial = createInitialBoardState();
    const execution = executeLegalAction(initial, getLegalActions(initial)[0]);
    if (execution.type !== 'applied') throw new Error('Invalid fixture');
    const original = structuredClone(execution.state);
    const snapshot = createComparisonSnapshot(execution.state);
    expect(snapshot.history).not.toBe(execution.state.history);
    expect(snapshot.senteHand).not.toBe(execution.state.senteHand);
    analyzeEvaluationPresetComparison(snapshot, 3, clock);
    expect(execution.state).toEqual(original);
    expect(Object.isFrozen(execution.state)).toBe(false);
  });

  it('不正深さと途中の例外は部分成功を返さず失敗する', () => {
    expect(() => analyzeEvaluationPresetComparison(createInitialBoardState(), -1)).toThrow();
    vi.spyOn(alphaBeta, 'analyzeAlphaBetaSearch').mockImplementationOnce((state, depth, config) =>
      ({ ...alphaBeta.analyzeTwoPlyAlphaBetaSearch(state, config, clock), depth, cutoffCount: 0, skippedActionCount: 0 }))
      .mockImplementationOnce(() => { throw new Error('second pass failed'); });
    expect(() => analyzeEvaluationPresetComparison(createInitialBoardState(), 3, clock)).toThrow('second pass failed');
  });
});
