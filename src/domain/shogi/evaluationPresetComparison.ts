import type { BoardState } from '../../types/shogi';
import { cloneBoardState } from './replay';
import { analyzeAlphaBetaSearch, type AlphaBetaSearchResult } from './twoPlyAlphaBetaAi';
import type { SearchClock } from './twoPlyMinimaxAi';
import { SEARCH_EVALUATION_PRESET_IDS, resolveSearchEvaluationPreset, type SearchEvaluationPresetId } from './searchEvaluationPresets';

export const EVALUATION_PRESET_COMPARISON_DEPTH = 3;

export type EvaluationPresetComparisonResult = AlphaBetaSearchResult & {
  readonly presetId: SearchEvaluationPresetId;
};

/** One independent snapshot, shared read-only by every fixed-depth pass. */
export function createComparisonSnapshot(state: BoardState): BoardState {
  const freeze = (value: object): void => {
    Object.values(value).forEach((child: unknown) => {
      if (child !== null && typeof child === 'object') freeze(child);
    });
    Object.freeze(value);
  };
  const snapshot = cloneBoardState(state);
  freeze(snapshot);
  return snapshot;
}

/** Atomic, deterministic preset comparison; no deadline or previous-best seed. */
export function analyzeEvaluationPresetComparison(
  state: BoardState,
  depth: number,
  clock?: SearchClock,
): readonly EvaluationPresetComparisonResult[] {
  const snapshot = createComparisonSnapshot(state);
  return SEARCH_EVALUATION_PRESET_IDS.map((presetId) => ({
    ...analyzeAlphaBetaSearch(snapshot, depth, resolveSearchEvaluationPreset(presetId), clock),
    presetId,
  }));
}
