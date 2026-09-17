import type { BoardState } from '../types/shogi';
import type { EvaluationPresetComparisonResult } from '../domain/shogi/evaluationPresetComparison';
import { SEARCH_EVALUATION_PRESET_IDS } from '../domain/shogi/searchEvaluationPresets';
import { getLegalActions } from '../domain/shogi/legalActions';
import { cloneBoardState } from '../domain/shogi/replay';
import { getDisplayEvaluationBreakdown } from './searchEvaluationBreakdownValidation';
import { validateAndFormatPrincipalVariation } from './searchPrincipalVariation';

/** BoardState consists solely of cloneable record data; normalize optional fields. */
export function isSameComparisonPosition(left: BoardState, right: BoardState): boolean {
  try {
    return JSON.stringify(cloneBoardState(left)) === JSON.stringify(cloneBoardState(right));
  } catch {
    return false;
  }
}

/** Fail the entire job before publishing anything. No evaluation runs here. */
export function validateEvaluationPresetComparison(
  state: BoardState, depth: number, value: unknown,
): asserts value is readonly EvaluationPresetComparisonResult[] {
  const invalid = () => { throw new Error('3プリセットの比較結果を検証できませんでした。'); };
  if (!Array.isArray(value) || value.length !== SEARCH_EVALUATION_PRESET_IDS.length) return invalid();
  const legalCount = getLegalActions(state).length;
  for (const [index, entry] of (value as unknown[]).entries()) {
    if (typeof entry !== 'object' || entry === null) return invalid();
    const result = entry as EvaluationPresetComparisonResult;
    if (!result || result.presetId !== SEARCH_EVALUATION_PRESET_IDS[index] || result.depth !== depth ||
      !Array.isArray(result.principalVariation) || result.principalVariation.length > depth ||
      !(['rootLegalActionCount', 'visitedPositionCount', 'cutoffCount', 'skippedActionCount'] as const).every(
        (key) => Number.isSafeInteger(result[key]) && result[key] >= 0) ||
      result.rootLegalActionCount !== legalCount ||
      !Number.isFinite(result.elapsedMilliseconds) || result.elapsedMilliseconds < 0) return invalid();
    // Fixed-depth search keeps selectedEvaluation null when there are no root moves.
    const noAction = result.selectedAction === null && legalCount === 0;
    if (!getDisplayEvaluationBreakdown(result.evaluationBreakdown,
      noAction ? result.evaluationBreakdown?.total : result.selectedEvaluation)) return invalid();
    if (noAction) {
      if (result.selectedEvaluation !== null || result.principalVariation.length !== 0 ||
        result.visitedPositionCount !== 0 || result.cutoffCount !== 0 || result.skippedActionCount !== 0) return invalid();
    } else if (!validateAndFormatPrincipalVariation(state, result, depth, true)) return invalid();
  }
}
