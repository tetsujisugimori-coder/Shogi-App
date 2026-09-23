import { describe, expect, it, vi } from 'vitest';
import { analyzeTimeLimitedQuiescenceComparison } from '../domain/shogi/timeLimitedQuiescenceComparison';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { createComparisonSnapshot } from '../domain/shogi/evaluationPresetComparison';
import { executeLegalAction, getLegalActions } from '../domain/shogi';
import { comparisonCaptureTrap } from './fixtures/quiescenceComparisonPositions';
import { handleTimeLimitedQuiescenceComparisonWorkerRequest } from '../workers/timeLimitedQuiescenceComparisonWorkerHandler';
import { validateTimeLimitedQuiescenceComparison } from '../application/timeLimitedQuiescenceComparisonValidation';

describe('同一時間の静止探索比較ドメイン', () => {
  it('各API呼出しで時計を読み直し、独立した1000msとスナップショットで直列実行する', () => {
    const state = comparisonCaptureTrap();
    const before = structuredClone(state);
    let now = 0;
    const starts: number[] = [];
    const events: string[] = [];
    const clock = () => { const value = now; now += 600; return value; };
    const search = vi.fn<typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>((...args) => {
      starts.push(now); events.push('start');
      const result = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(...args);
      events.push('end'); return result;
    });
    const found = analyzeTimeLimitedQuiescenceComparison(state, 4, 1000, clock, search);
    expect(events).toEqual(['start', 'end', 'start', 'end', 'start', 'end']);
    expect(found.map(r => r.quiescenceMaxTacticalDepth)).toEqual([null, 1, 2]);
    expect(found.map(r => r.completedDepth)).toEqual([0, 0, 0]);
    expect(found.map(r => r.resultSource)).toEqual(['fallback', 'fallback', 'fallback']);
    expect(found.map(r => r.elapsedMilliseconds)).toEqual([2400, 2400, 2400]);
    expect(starts).toEqual([0, 3000, 6000]);
    expect(new Set(search.mock.calls.map(c => c[0])).size).toBe(3);
    for (const [i, [snapshot, depth, milliseconds, evaluation, usedClock, options]] of search.mock.calls.entries()) {
      expect(snapshot).toEqual(createComparisonSnapshot(state)); expect(snapshot).not.toBe(state);
      expect(Object.isFrozen(snapshot.squares[5][4].piece)).toBe(true);
      expect(depth).toBe(4); expect(milliseconds).toBe(1000);
      expect(evaluation).toBeUndefined(); expect(usedClock).toBe(clock);
      expect(options).toEqual(i === 0 ? { moveOrdering: 'standard' } : { moveOrdering: 'standard', quiescence: { maxTacticalDepth: i } });
      if (i === 0) expect(options).not.toHaveProperty('quiescence');
    }
    expect(state).toEqual(before);
    validateTimeLimitedQuiescenceComparison(state, 4, 1000, found);
  });

  it.each([2, 3])('第%s条件で例外が起きると部分結果を返さずhandler全体が失敗する', (failure) => {
    let call = 0;
    const search = vi.fn<typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>((state) => {
      if (++call === failure) throw new Error('pass failed');
      let now = 0;
      return analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 4, 1000, undefined, () => now += 600);
    });
    const response = handleTimeLimitedQuiescenceComparisonWorkerRequest({ type: 'compare-time-limited-quiescence-settings',
      requestId: 'atomic', state: comparisonCaptureTrap(), maxDepth: 4, timeLimitMilliseconds: 1000 },
    (state, depth, milliseconds) => analyzeTimeLimitedQuiescenceComparison(state, depth, milliseconds, undefined, search));
    expect(response).toEqual({ type: 'time-limited-quiescence-comparison-failed', requestId: 'atomic', errorName: 'Error', errorMessage: 'pass failed' });
    expect(search).toHaveBeenCalledTimes(failure);
    expect(response).not.toHaveProperty('results');
  });

  it('持ち駒・棋譜を含む凍結入力を保持する', () => {
    const state = comparisonCaptureTrap();
    const capture = getLegalActions(state).find(a => a.kind === 'move' && a.to.row === 4 && a.to.col === 4)!;
    const execution = executeLegalAction(state, capture);
    if (execution.type !== 'applied') throw new Error('fixture');
    const frozen = createComparisonSnapshot(execution.state); const before = structuredClone(frozen);
    let now = 0;
    analyzeTimeLimitedQuiescenceComparison(frozen, 4, 1000, () => now += 600);
    expect(frozen).toEqual(before); expect(frozen.senteHand).toHaveLength(1);
  });

  it.each([[3, 1000], [4, 999], [NaN, 1000], [4, Infinity]])('固定条件以外を探索前に拒否する (%s, %s)', (depth, milliseconds) => {
    const search = vi.fn<typeof analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch>();
    expect(() => analyzeTimeLimitedQuiescenceComparison(comparisonCaptureTrap(), depth, milliseconds, undefined, search)).toThrow(RangeError);
    expect(search).not.toHaveBeenCalled();
  });
});
