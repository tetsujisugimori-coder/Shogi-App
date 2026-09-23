import type { BoardState } from '../types/shogi';
import { TIME_LIMITED_QUIESCENCE_COMPARISON_MAX_DEPTH, TIME_LIMITED_QUIESCENCE_COMPARISON_MILLISECONDS,
  TIME_LIMITED_QUIESCENCE_COMPARISON_SETTINGS, type TimeLimitedQuiescenceComparisonResult } from '../domain/shogi/timeLimitedQuiescenceComparison';
import type { AlphaBetaSearchResult } from '../domain/shogi/twoPlyAlphaBetaAi';
import { getLegalActions } from '../domain/shogi/legalActions';
import { areLegalActionsEqual } from '../domain/shogi/twoPlyAlphaBetaAi';
import { getDisplayEvaluationBreakdown } from './searchEvaluationBreakdownValidation';
import { validateAndFormatPrincipalVariation } from './searchPrincipalVariation';
import { quiescenceComparisonProtocolError } from './quiescenceComparisonValidation';

const statistics = [
  ['visitedPositionCount', 'totalVisitedPositionCount'],
  ['cutoffCount', 'totalCutoffCount'],
  ['skippedActionCount', 'totalSkippedActionCount'],
  ['quiescenceLeafCount', 'totalQuiescenceLeafCount'],
  ['quiescenceVisitedPositionCount', 'totalQuiescenceVisitedPositionCount'],
  ['quiescenceCutoffCount', 'totalQuiescenceCutoffCount'],
  ['quiescenceSkippedActionCount', 'totalQuiescenceSkippedActionCount'],
] as const;
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Validate completed passes and their aggregate without evaluating the position again. */
export function validateTimeLimitedQuiescenceComparison(
  state: BoardState, maxDepth: number, milliseconds: number, value: unknown,
): asserts value is readonly TimeLimitedQuiescenceComparisonResult[] {
  let setting = 'all';
  const invalid = (): never => { throw quiescenceComparisonProtocolError('同一時間の静止探索比較結果を検証できませんでした。', setting); };
  if (maxDepth !== TIME_LIMITED_QUIESCENCE_COMPARISON_MAX_DEPTH || milliseconds !== TIME_LIMITED_QUIESCENCE_COMPARISON_MILLISECONDS ||
    !Array.isArray(value) || value.length !== 3) return invalid();
  const legalCount = getLegalActions(state).length;
  const validatePass = (pass: AlphaBetaSearchResult, depth: number, extension: number | null) => {
    if (!pass || typeof pass !== 'object' || pass.depth !== depth ||
      !Array.isArray(pass.principalVariation) || pass.principalVariation.length > depth + (extension ?? 0) ||
      !count(pass.rootLegalActionCount) || pass.rootLegalActionCount !== legalCount ||
      !statistics.every(([key]) => count(pass[key])) ||
      !Number.isFinite(pass.elapsedMilliseconds) || pass.elapsedMilliseconds < 0 ||
      pass.quiescenceLeafCount > pass.visitedPositionCount ||
      ((extension === null || pass.quiescenceLeafCount === 0) && statistics.slice(3).some(([key]) => pass[key] !== 0))) return invalid();
    const noAction = pass.selectedAction === null && legalCount === 0;
    if (!getDisplayEvaluationBreakdown(pass.evaluationBreakdown,
      noAction ? pass.evaluationBreakdown?.total : pass.selectedEvaluation)) return invalid();
    if (noAction) {
      const terminal = state.status !== 'ended' ? null : state.result?.winner === null
        ? 'draw' : state.result?.winner === state.turn ? 'win' : 'loss';
      if (pass.selectedEvaluation !== null || pass.principalVariation.length !== 0 ||
        statistics.some(([key]) => pass[key] !== 0) || pass.evaluationBreakdown.terminal !== terminal) return invalid();
    } else if (!validateAndFormatPrincipalVariation(state, pass, Math.max(depth, pass.principalVariation.length), true)) return invalid();
  };
  for (const [index, entry] of (value as unknown[]).entries()) {
    setting = String(TIME_LIMITED_QUIESCENCE_COMPARISON_SETTINGS[index] ?? 'disabled');
    if (typeof entry !== 'object' || entry === null) return invalid();
    const result = entry as TimeLimitedQuiescenceComparisonResult;
    const extension = TIME_LIMITED_QUIESCENCE_COMPARISON_SETTINGS[index];
    if (result.quiescenceMaxTacticalDepth !== extension || result.requestedMaxDepth !== maxDepth ||
      !Number.isSafeInteger(result.completedDepth) || result.completedDepth < 0 || result.completedDepth > maxDepth ||
      typeof result.timedOut !== 'boolean' || result.timedOut !== (result.completedDepth < maxDepth) ||
      !Array.isArray(result.iterations) || result.iterations.length !== result.completedDepth) return invalid();
    if (result.completedDepth === 0) {
      const fallback = legalCount === 0 ? null : getLegalActions(state)[0];
      if (result.resultSource !== 'fallback' || result.depth !== 0 ||
        !Number.isFinite(result.elapsedMilliseconds) || result.elapsedMilliseconds < 0 ||
        result.rootLegalActionCount !== legalCount || result.selectedEvaluation !== null ||
        result.evaluationBreakdown !== null || !Array.isArray(result.principalVariation) ||
        result.principalVariation.length !== 0 ||
        (fallback === null ? result.selectedAction !== null :
          !result.selectedAction || !areLegalActionsEqual(result.selectedAction, fallback)) ||
        statistics.some(([key, total]) => result[key] !== 0 || result[total] !== 0)) return invalid();
      continue;
    }
    if (result.resultSource !== 'completed-iteration' || result.evaluationBreakdown === null) return invalid();
    validatePass(result as AlphaBetaSearchResult, result.completedDepth, extension);
    for (const [i, pass] of result.iterations.entries()) validatePass(pass, i + 1, extension);
    const deepest: AlphaBetaSearchResult = result.iterations[result.completedDepth - 1];
    if (statistics.some(([key, total]) => result[key] !== deepest[key] || !count(result[total]) ||
      result[total] !== result.iterations.reduce((sum, pass) => sum + pass[key], 0)) ||
      result.selectedEvaluation !== deepest.selectedEvaluation ||
      result.principalVariation.length !== deepest.principalVariation.length ||
      result.principalVariation.some((action, i) => !areLegalActionsEqual(action, deepest.principalVariation[i])) ||
      (Object.keys(deepest.evaluationBreakdown) as (keyof typeof deepest.evaluationBreakdown)[])
        .some((key) => result.evaluationBreakdown![key] !== deepest.evaluationBreakdown[key])) return invalid();
  }
}
