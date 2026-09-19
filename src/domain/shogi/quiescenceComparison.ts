import type { BoardState } from '../../types/shogi';
import { createComparisonSnapshot } from './evaluationPresetComparison';
import { analyzeAlphaBetaSearch, type AlphaBetaSearchResult } from './twoPlyAlphaBetaAi';
import type { SearchClock } from './twoPlyMinimaxAi';

export const QUIESCENCE_COMPARISON_DEPTH = 3;
export const QUIESCENCE_COMPARISON_SETTINGS = [null, 1, 2] as const;
export type QuiescenceComparisonSetting = typeof QUIESCENCE_COMPARISON_SETTINGS[number];
export type QuiescenceComparisonResult = AlphaBetaSearchResult & {
  readonly quiescenceMaxTacticalDepth: QuiescenceComparisonSetting;
};

/** Atomic passes with independent frozen snapshots and the default evaluation. */
export function analyzeQuiescenceComparison(
  state: BoardState, depth: number, clock?: SearchClock,
): readonly QuiescenceComparisonResult[] {
  if (!Number.isSafeInteger(depth) || depth < 1) throw new RangeError('Comparison depth must be a positive integer.');
  const start = createComparisonSnapshot(state);
  return QUIESCENCE_COMPARISON_SETTINGS.map((quiescenceMaxTacticalDepth) => ({
    ...analyzeAlphaBetaSearch(createComparisonSnapshot(start), depth, undefined, clock, {
      moveOrdering: 'standard',
      ...(quiescenceMaxTacticalDepth === null ? {} : { quiescence: { maxTacticalDepth: quiescenceMaxTacticalDepth } }),
    }),
    quiescenceMaxTacticalDepth,
  }));
}
