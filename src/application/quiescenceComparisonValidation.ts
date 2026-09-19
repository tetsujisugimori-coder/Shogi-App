import type { BoardState } from '../types/shogi';
import { QUIESCENCE_COMPARISON_SETTINGS, type QuiescenceComparisonResult } from '../domain/shogi/quiescenceComparison';
import { getLegalActions } from '../domain/shogi/legalActions';
import { getDisplayEvaluationBreakdown } from './searchEvaluationBreakdownValidation';
import { validateAndFormatPrincipalVariation } from './searchPrincipalVariation';

export function quiescenceComparisonProtocolError(message: string, comparisonSetting?: string): Error {
  const error = Object.assign(new Error(message), { comparisonSetting });
  error.name = 'WorkerProtocolError';
  return error;
}

/** Validate all three passes before publishing any result. Never re-evaluate. */
export function validateQuiescenceComparison(
  state: BoardState, depth: number, value: unknown,
): asserts value is readonly QuiescenceComparisonResult[] {
  let setting = 'all';
  const invalid = () => { throw quiescenceComparisonProtocolError('3条件の静止探索比較結果を検証できませんでした。', setting); };
  if (!Number.isSafeInteger(depth) || depth < 1 || !Array.isArray(value) || value.length !== 3) return invalid();
  const legalCount = getLegalActions(state).length;
  const normalKeys = ['visitedPositionCount', 'cutoffCount', 'skippedActionCount'] as const;
  const tacticalKeys = ['quiescenceLeafCount', 'quiescenceVisitedPositionCount', 'quiescenceCutoffCount', 'quiescenceSkippedActionCount'] as const;
  for (const [index, entry] of (value as unknown[]).entries()) {
    setting = String(QUIESCENCE_COMPARISON_SETTINGS[index] ?? 'disabled');
    if (typeof entry !== 'object' || entry === null) return invalid();
    const result = entry as QuiescenceComparisonResult;
    const extension = QUIESCENCE_COMPARISON_SETTINGS[index];
    if (result.quiescenceMaxTacticalDepth !== extension || result.depth !== depth ||
      !Array.isArray(result.principalVariation) || result.principalVariation.length > depth + (extension ?? 0) ||
      !(['rootLegalActionCount', ...normalKeys, ...tacticalKeys] as const).every(
        (key) => Number.isSafeInteger(result[key]) && result[key] >= 0) ||
      result.rootLegalActionCount !== legalCount ||
      !Number.isFinite(result.elapsedMilliseconds) || result.elapsedMilliseconds < 0 ||
      (extension === null && tacticalKeys.some((key) => result[key] !== 0)) ||
      result.quiescenceLeafCount > result.visitedPositionCount ||
      (result.quiescenceLeafCount === 0 && tacticalKeys.some((key) => result[key] !== 0))) return invalid();
    const noAction = result.selectedAction === null && legalCount === 0;
    if (!getDisplayEvaluationBreakdown(result.evaluationBreakdown,
      noAction ? result.evaluationBreakdown?.total : result.selectedEvaluation)) return invalid();
    if (noAction) {
      if (result.selectedEvaluation !== null || result.principalVariation.length !== 0 ||
        [...normalKeys, ...tacticalKeys].some((key) => result[key] !== 0)) return invalid();
      const terminal = state.status !== 'ended' ? null : state.result?.winner === null
        ? 'draw' : state.result?.winner === state.turn ? 'win' : 'loss';
      if (result.evaluationBreakdown.terminal !== terminal) return invalid();
    } else if (!validateAndFormatPrincipalVariation(state, result,
      Math.max(depth, result.principalVariation.length), true)) return invalid();
  }
}
