import { describe, expect, it } from 'vitest';
import { getLegalActions, executeLegalAction } from '../domain/shogi/legalActions';
import { analyzeAlphaBetaSearch, analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch } from '../domain/shogi/twoPlyAlphaBetaAi';
import { QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS } from '../../scripts/benchmarks/quiescenceOrderingSelfPlayScenarios';

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

describe('時間制限探索の局面複製削減', () => {
  it('履歴を持つ凍結中盤でも公開着手経路と探索は入力を変更せず、深さ1保証を保つ', () => {
    const position = QUIESCENCE_ORDERING_SELF_PLAY_SCENARIOS.find(
      (scenario) => scenario.id === 'quiet-double-static-rook-middlegame'
    );
    if (!position) throw new Error('Missing fixed middlegame scenario');
    const state = freezeDeep(position.create());
    const snapshot = JSON.stringify(state);
    const firstAction = getLegalActions(state)[0];
    const execution = executeLegalAction(state, firstAction);
    expect(execution.type).toBe('applied');
    expect(JSON.stringify(state)).toBe(snapshot);

    const options = { quiescence: { maxTacticalDepth: 1 } } as const;
    const fixed = analyzeAlphaBetaSearch(state, 1, undefined, () => 0, options);
    const timed = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch(state, 2, 0, undefined, () => 0, options);
    expect(timed).toMatchObject({ completedDepth: 1, timedOut: true, requestedMaxDepth: 2 });
    expect(timed.iterations).toHaveLength(1);
    expect(timed.selectedAction).toEqual(fixed.selectedAction);
    expect(timed.selectedEvaluation).toBe(fixed.selectedEvaluation);
    expect(timed.principalVariation).toEqual(fixed.principalVariation);
    expect(timed.evaluationBreakdown).toEqual(fixed.evaluationBreakdown);
    for (const [total, field] of [
      ['totalVisitedPositionCount', 'visitedPositionCount'],
      ['totalCutoffCount', 'cutoffCount'],
      ['totalSkippedActionCount', 'skippedActionCount'],
      ['totalQuiescenceLeafCount', 'quiescenceLeafCount'],
      ['totalQuiescenceVisitedPositionCount', 'quiescenceVisitedPositionCount'],
      ['totalQuiescenceCutoffCount', 'quiescenceCutoffCount'],
      ['totalQuiescenceSkippedActionCount', 'quiescenceSkippedActionCount'],
    ] as const) {
      expect(timed[total]).toBe(timed.iterations[0][field]);
    }
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
