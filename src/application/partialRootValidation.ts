import type { TimeLimitedIterativeDeepeningAlphaBetaSearchResult as Result } from '../domain/shogi/twoPlyAlphaBetaAi';
import { areLegalActionsEqual } from '../domain/shogi/twoPlyAlphaBetaAi';
import type { BoardState } from '../types/shogi';
import { getLegalActions } from '../domain/shogi/legalActions';
import { getDisplayEvaluationBreakdown } from './searchEvaluationBreakdownValidation';
import { validateAndFormatPrincipalVariation } from './searchPrincipalVariation';

const statistics = ['visitedPositionCount', 'cutoffCount', 'skippedActionCount', 'quiescenceLeafCount',
  'quiescenceVisitedPositionCount', 'quiescenceCutoffCount', 'quiescenceSkippedActionCount'] as const;
const totals = ['totalVisitedPositionCount', 'totalCutoffCount', 'totalSkippedActionCount', 'totalQuiescenceLeafCount',
  'totalQuiescenceVisitedPositionCount', 'totalQuiescenceCutoffCount', 'totalQuiescenceSkippedActionCount'] as const;
const count = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Checks the candidate contract without re-evaluating it or extending its PV. */
export function validatePartialRoot(state: BoardState, result: Result, extension: number): string[] | null {
  try {
    const meta = result.partialRoot;
    const legal = getLegalActions(state);
    if (state.status === 'ended' || result.resultSource !== 'partial-root' || result.depth !== 0 ||
      result.completedDepth !== 0 || result.timedOut !== true || result.iterations.length !== 0 ||
      result.terminalResult !== undefined || result.rootLegalActionCount !== legal.length ||
      !meta || meta.candidateDepth !== 1 || !count(meta.selectedRootOriginalIndex) ||
      !count(meta.completedRootCandidateCount) || !count(meta.exactRootCandidateCount) ||
      meta.exactRootCandidateCount < 1 || meta.exactRootCandidateCount > meta.completedRootCandidateCount ||
      meta.completedRootCandidateCount > legal.length || meta.selectedRootOriginalIndex >= meta.completedRootCandidateCount ||
      !result.selectedAction || !areLegalActionsEqual(legal[meta.selectedRootOriginalIndex], result.selectedAction) ||
      !Number.isFinite(result.elapsedMilliseconds) || result.elapsedMilliseconds < 0 ||
      typeof result.selectedEvaluation !== 'number' || Number.isNaN(result.selectedEvaluation) ||
      !getDisplayEvaluationBreakdown(result.evaluationBreakdown, result.selectedEvaluation) ||
      statistics.some(key => result[key] !== 0 || !count(meta.attemptedStatistics[key])) ||
      totals.some(key => result[key] !== 0) ||
      meta.attemptedStatistics.visitedPositionCount < meta.completedRootCandidateCount ||
      !Array.isArray(result.principalVariation) || result.principalVariation.length > 1 + extension) return null;
    return validateAndFormatPrincipalVariation(state, result, 1 + extension);
  } catch { return null; }
}
