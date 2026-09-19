import type { BoardState } from '../../types/shogi';
import { createComparisonSnapshot } from './evaluationPresetComparison';
import { analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch, type TimeLimitedIterativeDeepeningAlphaBetaSearchResult } from './twoPlyAlphaBetaAi';
import type { SearchClock } from './twoPlyMinimaxAi';

export const TIME_LIMITED_QUIESCENCE_COMPARISON_MAX_DEPTH = 4;
export const TIME_LIMITED_QUIESCENCE_COMPARISON_MILLISECONDS = 1000;
export const TIME_LIMITED_QUIESCENCE_COMPARISON_SETTINGS = [null, 1, 2] as const;
export type TimeLimitedQuiescenceComparisonResult = TimeLimitedIterativeDeepeningAlphaBetaSearchResult & {
  readonly quiescenceMaxTacticalDepth: typeof TIME_LIMITED_QUIESCENCE_COMPARISON_SETTINGS[number];
};

/** Each API call initializes its own deadline; no budget is shared between passes. */
export function analyzeTimeLimitedQuiescenceComparison(
  state: BoardState, maxDepth: number, timeLimitMilliseconds: number,
  clock?: SearchClock,
  search = analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
): readonly TimeLimitedQuiescenceComparisonResult[] {
  if (maxDepth !== TIME_LIMITED_QUIESCENCE_COMPARISON_MAX_DEPTH ||
    timeLimitMilliseconds !== TIME_LIMITED_QUIESCENCE_COMPARISON_MILLISECONDS) {
    throw new RangeError('Time-limited comparison requires maximum depth 4 and 1000 milliseconds per setting.');
  }
  const start = createComparisonSnapshot(state);
  return TIME_LIMITED_QUIESCENCE_COMPARISON_SETTINGS.map((quiescenceMaxTacticalDepth) => ({
    ...search(createComparisonSnapshot(start), maxDepth, timeLimitMilliseconds, undefined, clock, {
      moveOrdering: 'standard',
      ...(quiescenceMaxTacticalDepth === null ? {} : { quiescence: { maxTacticalDepth: quiescenceMaxTacticalDepth } }),
    }),
    quiescenceMaxTacticalDepth,
  }));
}
