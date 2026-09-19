import {
  analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch,
  type AlphaBetaSearchOptions,
  type TimeLimitedIterativeDeepeningAlphaBetaSearchResult,
} from '../domain/shogi/twoPlyAlphaBetaAi';
import type { SearchEvaluationConfig } from '../domain/shogi/twoPlyMinimaxAi';
import { DEFAULT_SEARCH_EVALUATION_PRESET_ID, resolveSearchEvaluationPreset } from '../domain/shogi/searchEvaluationPresets';
import type {
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFailureResponse,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse,
} from './timeLimitedIterativeDeepeningAlphaBetaWorkerProtocol';

export type TimeLimitedIterativeDeepeningAlphaBetaSearch = (
  state: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest['state'],
  maxDepth: number,
  timeLimitMilliseconds: number,
  evaluation?: SearchEvaluationConfig,
  clock?: () => number,
  options?: AlphaBetaSearchOptions
) => TimeLimitedIterativeDeepeningAlphaBetaSearchResult;

function resolveWorkerQuiescenceOptions(value: unknown): {
  readonly maxTacticalDepth: 1 | 2;
} | undefined {
  if (value === undefined) return undefined;
  if (value === 1 || value === 2) return { maxTacticalDepth: value };
  throw new RangeError('Worker quiescence maximum tactical depth must be either 1 or 2 when supplied.');
}

function toWorkerFailureResponse(
  requestId: string | null,
  error: unknown
): TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerFailureResponse {
  if (error instanceof Error) {
    return {
      type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
      requestId,
      errorName: error.name || 'Error',
      errorMessage: error.message || 'Worker search failed.',
    };
  }

  return {
    type: 'time-limited-iterative-deepening-alpha-beta-search-failed',
    requestId,
    errorName: 'UnknownWorkerSearchError',
    errorMessage: typeof error === 'string' && error.length > 0
      ? error
      : 'Worker search failed with a non-Error value.',
  };
}

/**
 * Pure worker-side request handling. Keeping this independent of `self` makes
 * search behavior testable without a browser Worker implementation.
 */
export function handleTimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest(
  request: TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerRequest,
  search: TimeLimitedIterativeDeepeningAlphaBetaSearch =
    analyzeTimeLimitedIterativeDeepeningAlphaBetaSearch
): TimeLimitedIterativeDeepeningAlphaBetaSearchWorkerResponse {
  try {
    const evaluationPresetId = request.evaluationPresetId === undefined
      ? DEFAULT_SEARCH_EVALUATION_PRESET_ID : request.evaluationPresetId;
    const evaluation = resolveSearchEvaluationPreset(evaluationPresetId);
    const quiescence = resolveWorkerQuiescenceOptions(request.quiescenceMaxTacticalDepth);
    return {
      type: 'time-limited-iterative-deepening-alpha-beta-search-succeeded',
      requestId: request.requestId,
      result: {
        ...(quiescence === undefined
          ? search(request.state, request.maxDepth, request.timeLimitMilliseconds, evaluation)
          : search(
            request.state,
            request.maxDepth,
            request.timeLimitMilliseconds,
            evaluation,
            undefined,
            { quiescence }
          )),
        evaluationPresetId,
        quiescenceMaxTacticalDepth: quiescence?.maxTacticalDepth ?? null,
      },
    };
  } catch (error) {
    return toWorkerFailureResponse(request.requestId, error);
  }
}
