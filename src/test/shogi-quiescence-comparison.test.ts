import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeQuiescenceComparison, QUIESCENCE_COMPARISON_DEPTH, QUIESCENCE_COMPARISON_SETTINGS } from '../domain/shogi/quiescenceComparison';
import * as alphaBeta from '../domain/shogi/twoPlyAlphaBetaAi';
import { createInitialBoardState } from '../types/shogi';
import { createComparisonSnapshot } from '../domain/shogi/evaluationPresetComparison';
import { getLegalActions, executeLegalAction, evaluateSearchPositionBreakdown } from '../domain/shogi';
import { comparisonCaptureTrap } from './fixtures/quiescenceComparisonPositions';

const clock = () => 0;
afterEach(() => vi.restoreAllMocks());

describe('静止探索設定の独立した固定深さ比較', () => {
  it('固定順・深さ3・既定評価・standardを使用し、無効ではquiescenceを渡さない', () => {
    expect(QUIESCENCE_COMPARISON_DEPTH).toBe(3);
    const state = comparisonCaptureTrap();
    const before = structuredClone(state);
    const legal = getLegalActions(state);
    const spy = vi.spyOn(alphaBeta, 'analyzeAlphaBetaSearch');
    const results = analyzeQuiescenceComparison(state, QUIESCENCE_COMPARISON_DEPTH, clock);
    expect(results.map((r) => r.quiescenceMaxTacticalDepth)).toEqual([null, 1, 2]);
    expect(spy).toHaveBeenCalledTimes(3);
    const calls = spy.mock.calls.slice();
    expect(new Set(calls.map((call) => call[0])).size).toBe(3);
    for (const [index, [snapshot, depth, config, usedClock, options]] of calls.entries()) {
      expect(snapshot).toEqual(createComparisonSnapshot(state));
      expect(snapshot).not.toBe(state);
      expect(Object.isFrozen(snapshot.squares[5][4].piece)).toBe(true);
      expect(depth).toBe(3);
      expect(config).toBeUndefined();
      expect(usedClock).toBe(clock);
      expect(options).toEqual(index === 0 ? { moveOrdering: 'standard' } : { moveOrdering: 'standard', quiescence: { maxTacticalDepth: index } });
      expect(results[index]).toEqual({ ...alphaBeta.analyzeAlphaBetaSearch(state, 3, undefined, clock, options), quiescenceMaxTacticalDepth: QUIESCENCE_COMPARISON_SETTINGS[index] });
    }
    expect(state).toEqual(before);
    expect(Object.isFrozen(state)).toBe(false);
    expect(getLegalActions(state)).toEqual(legal);
    expect(analyzeQuiescenceComparison(state, 3, clock)).toEqual(results);
    for (const key of ['quiescenceLeafCount', 'quiescenceVisitedPositionCount', 'quiescenceCutoffCount', 'quiescenceSkippedActionCount'] as const) expect(results[0][key]).toBe(0);
  });

  it('持ち駒・履歴を含む凍結局面を変更せず、PV末端の評価内訳を返す', () => {
    const state = comparisonCaptureTrap();
    const capture = getLegalActions(state).find((a) => a.kind === 'move' && a.to.row === 4 && a.to.col === 4)!;
    const execution = executeLegalAction(state, capture);
    if (execution.type !== 'applied') throw new Error('Fixture failed');
    const frozen = createComparisonSnapshot(execution.state);
    const before = structuredClone(frozen);
    const results = analyzeQuiescenceComparison(frozen, 3, clock);
    for (const result of results) {
      let leaf = frozen;
      for (const action of result.principalVariation) {
        const next = executeLegalAction(leaf, action);
        if (next.type !== 'applied') throw new Error('Invalid PV');
        leaf = next.state;
      }
      expect(evaluateSearchPositionBreakdown(leaf, frozen.turn)).toEqual(result.evaluationBreakdown);
    }
    expect(frozen).toEqual(before);
  });

  it('既存の取り返し専用局面では追加2手が毒入り捕獲を見抜く（通常深さ1）', () => {
    const [off, one, two] = analyzeQuiescenceComparison(comparisonCaptureTrap(), 1, clock);
    expect(off.selectedAction).toMatchObject({ from: { row: 5, col: 4 }, to: { row: 4, col: 4 } });
    expect(off.selectedEvaluation).toBe(911);
    expect(two.selectedAction).toMatchObject({ from: { row: 5, col: 4 }, to: { row: 5, col: 7 } });
    expect(two.selectedEvaluation).toBe(798);
    expect(one.selectedAction).toEqual(two.selectedAction);
  });

  it('金を追加した専用局面の深さ3で読み足しによる手・評価の変化を再現する', () => {
    const results = analyzeQuiescenceComparison(comparisonCaptureTrap(true), 3, clock);
    expect(results.map((r) => r.selectedEvaluation)).toEqual([547, 498, 506]);
    expect(results.map((r) => r.selectedAction)).toEqual([6, 2, 5].map((col) => expect.objectContaining({ to: { row: 5, col } })));
  });

  it('固定深さ3でもPV末端の毒入り捕獲を追加2手が避ける', () => {
    const state = comparisonCaptureTrap();
    state.squares[6][4].piece = { id: 'gg', type: 'gold', player: 'gote' };
    const [off, one, two] = analyzeQuiescenceComparison(state, 3, clock);
    expect([off.selectedEvaluation, one.selectedEvaluation, two.selectedEvaluation]).toEqual([1411, 1308, 1308]);
    expect(off.principalVariation[2]).toMatchObject({ kind: 'move', from: { row: 6, col: 4 }, to: { row: 4, col: 4 } });
    let leaf = state;
    for (const action of off.principalVariation) {
      const next = executeLegalAction(leaf, action);
      if (next.type !== 'applied') throw new Error('Invalid fixture PV');
      leaf = next.state;
    }
    // The pawn can legally recapture the rook just beyond the ordinary horizon.
    expect(getLegalActions(leaf)).toContainEqual(expect.objectContaining({
      kind: 'move', from: { row: 3, col: 4 }, to: { row: 4, col: 4 },
    }));
    expect(two.principalVariation[2]).toMatchObject({ kind: 'drop', pieceType: 'gold', to: { row: 3, col: 3 } });
    expect(one.selectedAction).toEqual(two.selectedAction);
    expect(off.selectedAction).toEqual(two.selectedAction);
  });

  it.each([-1, 0, 0.5, Infinity, NaN])('不正な深さを拒否する: %s', (depth) => {
    expect(() => analyzeQuiescenceComparison(createInitialBoardState(), depth)).toThrow(RangeError);
  });

  it('第2条件の失敗で全体を失敗させ第3条件へ進まない', () => {
    const state = comparisonCaptureTrap();
    const first = alphaBeta.analyzeAlphaBetaSearch(state, 3, undefined, clock);
    const spy = vi.spyOn(alphaBeta, 'analyzeAlphaBetaSearch').mockReturnValueOnce(first)
      .mockImplementationOnce(() => { throw new Error('second pass failed'); });
    expect(() => analyzeQuiescenceComparison(state, 3, clock)).toThrow('second pass failed');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
